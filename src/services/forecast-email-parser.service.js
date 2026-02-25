/**
 * Forecast Email Parser Service (v3)
 * Split-brain pipeline: extract first, normalize only what we need.
 *
 *   Step 1  (LLM):  Extract raw blocks from email (simple, won't refuse)
 *   Step 1b (Code): GPS-match areas to extracted sections
 *   Step 2  (LLM):  Normalize matched sections only (parallelized, one per section)
 *   Step 3  (LLM):  Render structured JSON → plain English prose (one call, all areas)
 *   Step 4  (Code): Compute change summaries by diffing structured data
 */

import OpenAI from 'openai';
import crypto from 'crypto';
import { getConfig } from '../config/env.js';
import { weatherRepository } from '../repositories/weather.repository.js';
import { forecastEmailRepository } from '../repositories/forecast-email.repository.js';
import supabaseRepo from '../repositories/supabase.repository.js';
import { createLogger } from '../utils/logger.js';
import { normalizeSection as regexNormalize } from './forecast-shorthand-parser.js';

const config = getConfig();
const logger = createLogger('forecast-email-parser');

const openai = new OpenAI({ apiKey: config.openai.apiKey, timeout: 120000 });

const FT_TO_M = 0.3048;

// 16-point → 8-point compass bucketing (each maps to nearest 8-point)
const COMPASS_BUCKET = {
  N: 'N', NNE: 'NE', NE: 'NE', ENE: 'NE', E: 'E', ESE: 'E',
  SE: 'SE', SSE: 'SE', S: 'S', SSW: 'SW', SW: 'SW', WSW: 'W',
  W: 'W', WNW: 'NW', NW: 'NW', NNW: 'N',
};

function compassBucket(dir16) {
  return COMPASS_BUCKET[dir16] || dir16;
}

// Safe nested property access — returns null if any part is missing
function safeGet(obj, path) {
  const parts = path.split('.');
  let val = obj;
  for (const p of parts) {
    val = val?.[p];
    if (val == null) return null;
  }
  return val;
}

export const forecastEmailParserService = {
  /**
   * Parse a forecast email and map sections to weather areas.
   * Main entry point — runs the full pipeline.
   */
  async parseAndMap(email) {
    const areas = await weatherRepository.getAllAreas();
    if (areas.length === 0) {
      logger.warn('No active weather areas to map forecasts to');
      await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, null);
      return { forecastsWritten: 0, errors: [] };
    }

    try {
      // Track regex parse success/fail for final status determination
      let successCount;
      let failCount;

      // Step 1: Extract raw blocks (or reuse existing structured data)
      let structured = await forecastEmailRepository.getStructuredForecast(email.id);
      if (!structured) {
        // Step 1a: Extract raw text blocks from email (simple LLM call)
        const extracted = await this._extractRawBlocks(email);
        const emailHash = crypto.createHash('sha256').update(email.raw_text).digest('hex');

        if (!extracted.sections || extracted.sections.length === 0) {
          logger.warn('No sections extracted from email');
          // Store the extracted data as-is so we don't re-process
          await forecastEmailRepository.storeStructuredForecast(email.id, extracted, emailHash);
          await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, extracted.primary_date);
          return { forecastsWritten: 0, errors: [] };
        }

        // Step 1b: GPS-match areas to extracted sections (code)
        const matchedSectionNames = this._matchSectionsToAreas(extracted.sections, areas);

        if (matchedSectionNames.length === 0) {
          logger.info('No extracted sections match our weather areas — skipping normalize', {
            emailSubject: email.subject,
            sectionCount: extracted.sections.length,
            sectionNames: extracted.sections.map(s => s.section_name),
          });
          await forecastEmailRepository.storeStructuredForecast(email.id, extracted, emailHash);
          await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, extracted.primary_date);
          return { forecastsWritten: 0, errors: [] };
        }

        // Step 2: Normalize only matched sections (regex, synchronous)
        const matchedSections = extracted.sections.filter(s => matchedSectionNames.includes(s.section_name));
        const normalizeResult = this._normalizeSections(matchedSections, email);
        const normalizedSections = normalizeResult.normalized;
        successCount = normalizeResult.successCount;
        failCount = normalizeResult.failCount;

        // Build final structured forecast
        structured = {
          issue_time: extracted.issue_time,
          region_name: extracted.region_name,
          primary_date: extracted.primary_date,
          synopsis: extracted.synopsis_raw,
          outlook: extracted.outlook_raw,
          sections: normalizedSections,
        };

        await forecastEmailRepository.storeStructuredForecast(email.id, structured, emailHash);
      } else {
        logger.info('Reusing existing structured forecast (retry/resume)', { emailId: email.id });
      }

      if (!structured.sections || structured.sections.length === 0) {
        logger.warn('No sections in structured forecast (email may not cover our region)');
        await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, structured.primary_date);
        return { forecastsWritten: 0, errors: [] };
      }

      // Step 2b: Map areas to normalized sections (code)
      const areaMapping = this._mapAreasToSections(structured, areas);
      const mappedAreas = Object.values(areaMapping).flat();
      if (mappedAreas.length === 0) {
        logger.warn('No areas matched any section bounding boxes');
        await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, structured.primary_date);
        return { forecastsWritten: 0, errors: [] };
      }

      // Step 3: Render to prose (LLM — one call for all areas)
      let proseByArea;
      try {
        proseByArea = await this._buildForecastsForAreas(structured, areaMapping);
      } catch (err) {
        logger.error('Step 3 (render) failed — marking as partial', { error: err.message });
        await forecastEmailRepository.updateParseStatus(email.id, 'partial', err.message, structured.primary_date);
        return { forecastsWritten: 0, errors: [{ step: 'render', error: err.message }] };
      }

      // Step 4: Get previous structured data for diffs, then insert forecasts
      let forecastsWritten = 0;
      const errors = [];

      for (const [sectionId, sectionAreas] of Object.entries(areaMapping)) {
        const section = structured.sections.find(s => s.section_id === sectionId);
        if (!section) continue;

        for (const area of sectionAreas) {
          const areaForecasts = proseByArea[area.id];
          if (!areaForecasts || areaForecasts.length === 0) continue;

          // Get previous structured data for this area (for diffs)
          const previousForecasts = await forecastEmailRepository.getExpertForecastsByArea(area.id);

          const insertedIds = [];
          for (const forecast of areaForecasts) {
            try {
              const row = await forecastEmailRepository.insertExpertForecast({
                email_id: email.id,
                area_id: area.id,
                forecast_date: forecast.date,
                region_name: section.section_name,
                synopsis: forecast.synopsis || null,
                outlook: forecast.outlook || null,
                wind_forecast: forecast.wind_forecast || null,
                swell_forecast: forecast.swell_forecast || null,
                sailing_suggestion: forecast.sailing_suggestion || null,
                precipitation: forecast.precipitation || null,
                buoy_readings: null,
                full_excerpt: null,
                llm_raw_response: null,
              });
              insertedIds.push(row.id);
              forecastsWritten++;
            } catch (err) {
              logger.error('Failed to insert expert forecast', { area_id: area.id, error: err.message });
              errors.push({ area_id: area.id, error: err.message });
            }
          }

          // Step 4: Compute change summary from structured data (code — no LLM)
          if (previousForecasts.length > 0 && insertedIds.length > 0) {
            try {
              const prevEmailId = previousForecasts[0].email_id;
              const prevStructured = await forecastEmailRepository.getStructuredForecast(prevEmailId);

              if (prevStructured) {
                const prevSection = this._findSectionForArea(prevStructured, area);
                if (prevSection) {
                  const summary = this._computeChangeSummary(prevSection.days, section.days);
                  if (summary) {
                    await forecastEmailRepository.updateChangeSummary(insertedIds[0], summary);
                  }
                }
              }
            } catch (err) {
              logger.warn('Failed to compute change summary', { area: area.name, error: err.message });
            }
          }
        }
      }

      const primaryDate = structured.primary_date || new Date(email.received_at).toISOString().split('T')[0];
      // Determine parse_status from regex success/fail counts (if available from this run)
      let finalStatus = 'parsed';
      if (typeof successCount !== 'undefined' && typeof failCount !== 'undefined') {
        if (successCount > 0 && failCount > 0) finalStatus = 'partial';
        else if (successCount === 0 && failCount > 0) finalStatus = 'failed';
      }
      await forecastEmailRepository.updateParseStatus(email.id, finalStatus, null, primaryDate);

      logger.info('Forecast email parsed successfully', {
        emailId: email.id,
        forecastsWritten,
        errorCount: errors.length,
      });

      return { forecastsWritten, errors, primaryDate, regionName: structured.region_name };
    } catch (err) {
      await forecastEmailRepository.updateParseStatus(email.id, 'failed', err.message);
      logger.error('Forecast email parsing failed', { emailId: email.id, error: err.message });
      throw err;
    }
  },

  /**
   * Parse the most recent email for a single newly-added area.
   * Reuses stored structured data — no Step 1 LLM call needed.
   */
  async parseForNewArea(area) {
    const recentEmails = await forecastEmailRepository.getRecentEmails(10);
    const email = recentEmails.find(e => e.parse_status === 'parsed' || e.parse_status === 'partial');
    if (!email) {
      logger.info('No parsed emails available for new area', { area: area.name });
      return { forecastsWritten: 0 };
    }

    const structured = await forecastEmailRepository.getStructuredForecast(email.id);
    if (!structured) {
      logger.info('No structured forecast available for new area', { area: area.name, emailId: email.id });
      return { forecastsWritten: 0 };
    }

    try {
      const areaMapping = this._mapAreasToSections(structured, [area]);
      if (Object.keys(areaMapping).length === 0) {
        logger.warn('New area did not match any email section', { area: area.name });
        return { forecastsWritten: 0 };
      }

      const proseByArea = await this._buildForecastsForAreas(structured, areaMapping);
      const areaForecasts = proseByArea[area.id];
      if (!areaForecasts || areaForecasts.length === 0) {
        return { forecastsWritten: 0 };
      }

      const sectionId = Object.keys(areaMapping)[0];
      const section = structured.sections.find(s => s.section_id === sectionId);
      let forecastsWritten = 0;

      for (const forecast of areaForecasts) {
        try {
          await forecastEmailRepository.insertExpertForecast({
            email_id: email.id,
            area_id: area.id,
            forecast_date: forecast.date,
            region_name: section?.section_name || structured.region_name,
            synopsis: forecast.synopsis || null,
            outlook: forecast.outlook || null,
            wind_forecast: forecast.wind_forecast || null,
            swell_forecast: forecast.swell_forecast || null,
            sailing_suggestion: forecast.sailing_suggestion || null,
            precipitation: forecast.precipitation || null,
            buoy_readings: null,
            full_excerpt: null,
            llm_raw_response: null,
          });
          forecastsWritten++;
        } catch (err) {
          logger.error('Failed to insert expert forecast for new area', { area_id: area.id, error: err.message });
        }
      }

      logger.info('Parsed forecasts for new area', { area: area.name, forecastsWritten });
      return { forecastsWritten };
    } catch (err) {
      logger.error('Failed to parse for new area', { area: area.name, error: err.message });
      return { forecastsWritten: 0, error: err.message };
    }
  },

  // ==================== STEP 1: Extract raw blocks (LLM) ====================

  /**
   * Step 1: Simple extraction — pull raw text blocks from the email.
   * Low cognitive load: no normalization, no numeric parsing, no date resolution.
   * Uses summary model since this is straightforward text splitting.
   */
  async _extractRawBlocks(email) {
    const receivedDate = new Date(email.received_at);
    const dateStr = receivedDate.toISOString().split('T')[0];

    const prompt = `Extract the major sections from this sailing weather forecast email. Do NOT normalize, parse numbers, or resolve dates — just extract the raw text blocks.

EMAIL SUBJECT: ${email.subject}
EMAIL DATE: ${dateStr}

EMAIL BODY:
${email.raw_text}

Extract into this JSON structure:
{
  "issue_time": "best guess ISO timestamp from subject/header",
  "region_name": "region from subject (e.g. 'E Caribbean', 'W Caribbean')",
  "primary_date": "${dateStr}",
  "synopsis_raw": "raw text of the SYNOPSIS section as-is",
  "outlook_raw": "raw text of the OUTLOOK section as-is, or null if none",
  "sections": [
    {
      "section_name": "Name of geographic sub-region (e.g. 'Mexico', 'Antigua-StMartin')",
      "lat_range": [south_lat, north_lat],
      "lon_range": [west_lon, east_lon],
      "wind_block": "raw WIND text for this section, copied as-is",
      "seas_block": "raw SEAS text for this section, copied as-is, or null",
      "precip_block": "raw PRECIP text for this section, copied as-is, or null",
      "suggest_block": "raw SUGGEST text for this section, copied as-is, or null"
    }
  ]
}

RULES:
- One section per geographic sub-region mentioned in the WIND section.
- Copy the text for each block verbatim — do NOT rephrase, summarize, or parse.
- lat_range/lon_range: approximate decimal degrees. Caribbean longitudes are NEGATIVE. Use GENEROUS bounding boxes — extend 1 degree beyond the region in each direction to ensure overlap. lon_range must be [west, east] where west is more negative (e.g. [-63.5, -61.0]).
- If a section (SEAS, PRECIP, SUGGEST) doesn't exist for a region, set to null.
- Include ALL geographic sub-regions, even "OTHER AREAS".`;

    const response = await openai.chat.completions.create({
      model: config.openai.summaryModel,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '';
    logger.info('Step 1 (extract raw blocks) complete', {
      length: content.length,
      preview: content.substring(0, 200),
    });

    const parsed = JSON.parse(content);

    // Auto-fix positive Caribbean longitudes
    for (const section of (parsed.sections || [])) {
      if (section.lon_range && (section.lon_range[0] > 0 || section.lon_range[1] > 0)) {
        section.lon_range = section.lon_range.map(v => v > 0 ? -v : v);
      }
    }

    return parsed;
  },

  // ==================== STEP 1b: GPS-match sections to areas (CODE) ====================

  /**
   * Step 1b: Filter extracted sections to only those covering our weather areas.
   * Returns array of section_name strings that match at least one area.
   */
  _matchSectionsToAreas(sections, areas) {
    const matched = new Set();
    const TOLERANCE = 1.0; // 1 degree padding for imprecise LLM bounding boxes

    for (const area of areas) {
      for (const section of sections) {
        let latRange = section.lat_range;
        let lonRange = section.lon_range;
        if (!latRange || !lonRange) continue;

        // Fix reversed lon_range (LLM sometimes swaps west/east)
        const lonMin = Math.min(lonRange[0], lonRange[1]);
        const lonMax = Math.max(lonRange[0], lonRange[1]);

        if (area.latitude >= (latRange[0] - TOLERANCE) && area.latitude <= (latRange[1] + TOLERANCE) &&
            area.longitude >= (lonMin - TOLERANCE) && area.longitude <= (lonMax + TOLERANCE)) {
          matched.add(section.section_name);
        }
      }
    }

    logger.info('GPS match complete', {
      totalSections: sections.length,
      matchedSections: [...matched],
      areaCount: areas.length,
    });

    return [...matched];
  },

  // ==================== STEP 2: Normalize matched sections (LLM) ====================

  /**
   * Step 2: Normalize raw text blocks into structured JSON.
   * One LLM call per matched section, parallelized.
   * Uses summary model — the heavy lifting is parsing meteorological shorthand.
   */
  _normalizeSections(sections, email) {
    const receivedDate = new Date(email.received_at);
    const primaryDate = receivedDate.toISOString().split('T')[0];

    let successCount = 0;
    let failCount = 0;
    const normalized = [];

    for (const section of sections) {
      try {
        const result = regexNormalize(section, primaryDate);
        this._validateNormalizedSection(result, receivedDate);
        normalized.push(result);
        successCount++;
        logger.info('Step 2 (regex normalize) complete for section', {
          section: section.section_name,
          days: result.days?.length || 0,
        });
      } catch (err) {
        failCount++;
        logger.error('Regex parse failed for section', {
          section: section.section_name,
          error: err.message,
          wind_block: section.wind_block?.substring(0, 200),
        });
      }
    }

    logger.info('Step 2 normalize summary', { successCount, failCount, total: sections.length });

    // Return { normalized, successCount, failCount } so caller can set parse_status
    return { normalized, successCount, failCount };
  },

  /**
   * Validate a normalized section — reject absurd values.
   */
  _validateNormalizedSection(section, receivedDate) {
    const warnings = [];

    // Validate lon_range is negative (Caribbean)
    if (section.lon_range && (section.lon_range[0] > 0 || section.lon_range[1] > 0)) {
      warnings.push(`Section "${section.section_name}" has positive longitude — auto-fixing`);
      section.lon_range = section.lon_range.map(v => v > 0 ? -v : v);
    }

    for (const day of (section.days || [])) {
      const dayDate = new Date(day.date + 'T12:00:00Z');
      const diffDays = Math.abs((dayDate - receivedDate) / (24 * 60 * 60 * 1000));
      if (diffDays > 10) {
        warnings.push(`Day "${day.date}" is ${diffDays.toFixed(0)} days from received_at`);
      }

      const windMax = safeGet(day, 'wind.range_kt.1');
      if (windMax != null && (windMax < 0 || windMax > 150)) {
        warnings.push(`Wind max ${windMax}kt out of range for "${day.date}"`);
      }

      // Swell is now an array of components — validate each
      const swellArr = Array.isArray(day.swell) ? day.swell : [];
      for (const sw of swellArr) {
        const swMax = sw.ft?.[1];
        if (swMax != null && (swMax < 0 || swMax > 30)) {
          warnings.push(`Swell max ${swMax}ft out of range for "${day.date}"`);
        }
      }
    }

    if (warnings.length > 0) {
      logger.warn('Section validation warnings', { section: section.section_name, warnings });
    }
  },

  // ==================== STEP 2b: Map areas to sections (CODE) ====================

  /**
   * Map weather areas to normalized sections by lat/lon bounding boxes.
   * Uses closest-center tiebreaker if multiple sections match.
   * Returns: { section_id: [area, area, ...] }
   */
  _mapAreasToSections(structured, areas) {
    const mapping = {};
    const TOLERANCE = 1.0;

    for (const area of areas) {
      let bestSection = null;
      let bestDist = Infinity;

      for (const section of (structured.sections || [])) {
        const latRange = section.lat_range;
        const lonRange = section.lon_range;
        if (!latRange || !lonRange) continue;

        const lonMin = Math.min(lonRange[0], lonRange[1]);
        const lonMax = Math.max(lonRange[0], lonRange[1]);

        if (area.latitude >= (latRange[0] - TOLERANCE) && area.latitude <= (latRange[1] + TOLERANCE) &&
            area.longitude >= (lonMin - TOLERANCE) && area.longitude <= (lonMax + TOLERANCE)) {
          const centerLat = (latRange[0] + latRange[1]) / 2;
          const centerLon = (lonMin + lonMax) / 2;
          const dist = Math.hypot(area.latitude - centerLat, area.longitude - centerLon);
          if (dist < bestDist) {
            bestDist = dist;
            bestSection = section;
          }
        }
      }

      if (bestSection) {
        if (!mapping[bestSection.section_id]) mapping[bestSection.section_id] = [];
        mapping[bestSection.section_id].push(area);
      }
    }

    logger.info('Area mapping complete', {
      sections: Object.keys(mapping).length,
      areas: Object.values(mapping).flat().map(a => a.name),
    });

    return mapping;
  },

  /**
   * Find the section in a structured forecast that covers a given area.
   */
  _findSectionForArea(structured, area) {
    const mapping = this._mapAreasToSections(structured, [area]);
    const sectionId = Object.keys(mapping)[0];
    if (!sectionId) return null;
    return structured.sections.find(s => s.section_id === sectionId) || null;
  },

  // ==================== STEP 3: Render to prose (LLM) ====================

  /**
   * Step 3: Single LLM call — render structured JSON to plain English for all areas.
   * Uses cheap model (config.openai.summaryModel).
   * Returns: { areaId: [{ date, synopsis, outlook, wind_forecast, ... }] }
   */
  async _buildForecastsForAreas(structured, areaMapping) {
    const areaDescriptions = [];
    const dateSet = new Set();

    for (const [sectionId, sectionAreas] of Object.entries(areaMapping)) {
      const section = structured.sections.find(s => s.section_id === sectionId);
      if (!section) continue;

      for (const day of (section.days || [])) {
        dateSet.add(day.date);
      }

      for (const area of sectionAreas) {
        areaDescriptions.push({
          id: area.id,
          name: area.name,
          sailing_direction: area.sailing_direction || 'none',
          section_id: sectionId,
          section_name: section.section_name,
        });
      }
    }

    const dates = [...dateSet].sort();

    const relevantSectionIds = new Set(Object.keys(areaMapping));
    const compactSections = structured.sections
      .filter(s => relevantSectionIds.has(s.section_id))
      .map(s => ({
        section_id: s.section_id,
        section_name: s.section_name,
        days: s.days,
      }));

    const prompt = `Render this structured weather forecast data into plain English for each area.

SYNOPSIS: ${structured.synopsis || 'Not available'}
OUTLOOK: ${structured.outlook || 'Not available'}

STRUCTURED DATA:
${JSON.stringify(compactSections, null, 2)}

AREAS TO RENDER:
${JSON.stringify(areaDescriptions, null, 2)}

RULES:
- Convert feet to meters (1 ft = ${FT_TO_M}m, round to 1 decimal). Do NOT include feet.
- Use nautical standard: knots for wind, meters for wave/swell heights.
- Expand abbreviations: "ESE" → "East-southeast", etc.
- For each area, use its sailing_direction to select the relevant sailing advice from sailing_notes. If direction is "none", give general conditions.
- Do NOT add, change, or reinterpret any numeric values from the structured data.
- Synopsis and outlook: render once as plain English, include in every entry.
- One to three sentences per field.
- "swell" is an array of swell components (primary swell first). Describe all components in swell_forecast (e.g. "Primary east swell 1.2-1.8m at 8s, secondary NNW swell at 13s").

Return JSON:
{
  "areas": {
    "<area-id>": [
      {
        "date": "YYYY-MM-DD",
        "synopsis": "plain English",
        "outlook": "plain English",
        "wind_forecast": "plain English wind",
        "swell_forecast": "plain English swell",
        "sailing_suggestion": "plain English sailing advice",
        "precipitation": "plain English precip or null"
      }
    ]
  }
}

Each area must have exactly ${dates.length} entries for dates: ${dates.join(', ')}.`;

    const response = await openai.chat.completions.create({
      model: config.openai.summaryModel,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '';
    logger.info('Step 3 (render) complete', { length: content.length, areaCount: areaDescriptions.length });

    const parsed = JSON.parse(content);
    return parsed.areas || {};
  },

  // ==================== STEP 4: Change summaries (CODE) ====================

  /**
   * Step 4: Compute change summary between two sets of structured day data.
   * Returns JSON string of bullet array, or null if no meaningful changes.
   */
  _computeChangeSummary(prevDays, currDays) {
    if (!prevDays || !currDays) return null;

    const bullets = [];

    for (const curr of currDays) {
      const prev = prevDays.find(p => p.date === curr.date);
      if (!prev) continue;

      const diffs = [];

      // Wind range
      const prevWindKt = safeGet(prev, 'wind.range_kt');
      const currWindKt = safeGet(curr, 'wind.range_kt');
      if (prevWindKt && currWindKt &&
          (prevWindKt[0] !== currWindKt[0] || prevWindKt[1] !== currWindKt[1])) {
        const dir = currWindKt[1] > prevWindKt[1] ? 'up' : 'down';
        diffs.push(`Wind ${dir} ${prevWindKt.join('-')}kt → ${currWindKt.join('-')}kt`);
      }

      // Wind direction (only if bucket changes)
      const prevWindDir = safeGet(prev, 'wind.dir');
      const currWindDir = safeGet(curr, 'wind.dir');
      if (prevWindDir && currWindDir &&
          compassBucket(prevWindDir) !== compassBucket(currWindDir)) {
        diffs.push(`Wind shifted ${prevWindDir} → ${currWindDir}`);
      }

      // Gusts
      const prevGust = safeGet(prev, 'wind.gust_kt');
      const currGust = safeGet(curr, 'wind.gust_kt');
      if (prevGust != null && currGust != null && prevGust !== currGust) {
        diffs.push(`Gusts ${prevGust}kt → ${currGust}kt`);
      }

      // Swell (array — compare primary swell component [0])
      const prevSwellArr = Array.isArray(prev.swell) ? prev.swell : [];
      const currSwellArr = Array.isArray(curr.swell) ? curr.swell : [];
      const prevSwellFt = prevSwellArr[0]?.ft;
      const currSwellFt = currSwellArr[0]?.ft;
      if (prevSwellFt && currSwellFt &&
          (prevSwellFt[0] !== currSwellFt[0] || prevSwellFt[1] !== currSwellFt[1])) {
        const prevM = prevSwellFt.map(f => (f * FT_TO_M).toFixed(1));
        const currM = currSwellFt.map(f => (f * FT_TO_M).toFixed(1));
        const dir = currSwellFt[1] > prevSwellFt[1] ? 'up' : 'down';
        diffs.push(`Swell ${dir} ${prevM.join('-')}m → ${currM.join('-')}m`);
      }

      // Seas
      const prevSeasFt = safeGet(prev, 'seas_ft');
      const currSeasFt = safeGet(curr, 'seas_ft');
      if (prevSeasFt && currSeasFt &&
          (prevSeasFt[0] !== currSeasFt[0] || prevSeasFt[1] !== currSeasFt[1])) {
        const prevM = prevSeasFt.map(f => (f * FT_TO_M).toFixed(1));
        const currM = currSeasFt.map(f => (f * FT_TO_M).toFixed(1));
        const dir = currSeasFt[1] > prevSeasFt[1] ? 'up' : 'down';
        diffs.push(`Seas ${dir} ${prevM.join('-')}m → ${currM.join('-')}m`);
      }

      if (diffs.length > 0) {
        const label = new Date(curr.date + 'T12:00:00Z')
          .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        bullets.push({ label, text: diffs.join('. ') + '.' });
      }
    }

    return bullets.length > 0 ? JSON.stringify(bullets) : null;
  },
};

export default forecastEmailParserService;
