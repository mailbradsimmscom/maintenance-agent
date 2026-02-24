/**
 * Forecast Email Parser Service
 * Two-step parsing:
 *   Step 1: Lightweight call to map area GPS coordinates to email sections
 *   Step 2: Per-area call to extract day-by-day forecasts in plain English
 */

import OpenAI from 'openai';
import { getConfig } from '../config/env.js';
import { weatherRepository } from '../repositories/weather.repository.js';
import { forecastEmailRepository } from '../repositories/forecast-email.repository.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('forecast-email-parser');

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export const forecastEmailParserService = {
  /**
   * Parse a forecast email and map sections to weather areas, one row per day per area.
   * Two-step process: map areas to sections, then extract per-day forecasts.
   */
  async parseAndMap(email) {
    const areas = await weatherRepository.getAllAreas();
    if (areas.length === 0) {
      logger.warn('No active weather areas to map forecasts to');
      return { forecastsWritten: 0, errors: [] };
    }

    try {
      // Step 1: Map areas to email sections by GPS
      const sectionMapping = await this._mapAreasToSections(email, areas);
      logger.info('Section mapping complete', { mapping: sectionMapping });

      if (!sectionMapping.sections || sectionMapping.sections.length === 0) {
        logger.warn('No sections matched any areas');
        await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, sectionMapping.primary_date);
        return { forecastsWritten: 0, errors: [] };
      }

      // Step 2: For each area, extract day-by-day forecasts (one GPT call per area)
      let forecastsWritten = 0;
      const errors = [];
      const allAreas = await weatherRepository.getAllAreas();

      for (const section of sectionMapping.sections) {
        const sectionAreas = allAreas.filter(a => (section.area_ids || []).includes(a.id));

        for (const area of sectionAreas) {
          try {
            // Get previous forecasts for this area (from earlier emails) before inserting new ones
            const previousForecasts = await forecastEmailRepository.getExpertForecastsByArea(area.id);

            const result = await this._extractForecastsForArea(
              email, area, section.section_name, sectionMapping.dates,
              section.synopsis, section.outlook
            );

            const insertedIds = [];
            for (const forecast of (result.forecasts || [])) {
              try {
                const row = await forecastEmailRepository.insertExpertForecast({
                  email_id: email.id,
                  area_id: area.id,
                  forecast_date: forecast.forecast_date,
                  region_name: section.section_name,
                  synopsis: forecast.synopsis || null,
                  outlook: forecast.outlook || null,
                  wind_forecast: forecast.wind_forecast || null,
                  swell_forecast: forecast.swell_forecast || null,
                  sailing_suggestion: forecast.sailing_suggestion || null,
                  precipitation: forecast.precipitation || null,
                  buoy_readings: forecast.buoy_readings || null,
                  full_excerpt: null,
                  llm_raw_response: result.rawResponse || null,
                });
                insertedIds.push(row.id);
                forecastsWritten++;
              } catch (err) {
                logger.error('Failed to insert expert forecast', { area_id: area.id, error: err.message });
                errors.push({ area_id: area.id, error: err.message });
              }
            }

            // Generate change summary if we have previous forecasts to compare
            if (previousForecasts.length > 0 && insertedIds.length > 0) {
              try {
                const changeSummary = await this._generateChangeSummary(
                  area, previousForecasts, result.forecasts || [], sectionMapping.dates
                );
                if (changeSummary) {
                  await forecastEmailRepository.updateChangeSummary(insertedIds[0], changeSummary);
                }
              } catch (err) {
                logger.warn('Failed to generate change summary', { area: area.name, error: err.message });
              }
            }
          } catch (err) {
            logger.error('Failed to extract forecasts for area', { area: area.name, section: section.section_name, error: err.message });
            errors.push({ area: area.name, error: err.message });
          }
        }
      }

      const primaryDate = sectionMapping.primary_date || new Date(email.received_at).toISOString().split('T')[0];
      await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, primaryDate);

      logger.info('Forecast email parsed successfully', {
        emailId: email.id,
        forecastsWritten,
        errorCount: errors.length,
      });

      return { forecastsWritten, errors, primaryDate, regionName: sectionMapping.region_name };
    } catch (err) {
      await forecastEmailRepository.updateParseStatus(email.id, 'failed', err.message);
      logger.error('Forecast email parsing failed', { emailId: email.id, error: err.message });
      throw err;
    }
  },

  /**
   * Parse the most recent email for a single newly-added area.
   * Runs Step 1 (map just this area) + Step 2 (extract forecasts) against the latest parsed email.
   */
  async parseForNewArea(area) {
    // Get the most recent parsed email
    const recentEmails = await forecastEmailRepository.getRecentEmails(1);
    const email = recentEmails.find(e => e.parse_status === 'parsed');
    if (!email) {
      logger.info('No parsed emails available for new area', { area: area.name });
      return { forecastsWritten: 0 };
    }

    // Need the full email with raw_text
    const { data: fullEmail, error: fetchErr } = await (await import('../repositories/supabase.repository.js')).default.client
      .from('weather_forecast_emails')
      .select('*')
      .eq('id', email.id)
      .single();

    if (fetchErr || !fullEmail) {
      logger.error('Failed to fetch full email for new area parse', { emailId: email.id, error: fetchErr?.message });
      return { forecastsWritten: 0 };
    }

    try {
      // Step 1: Map just this one area to a section
      const sectionMapping = await this._mapAreasToSections(fullEmail, [area]);

      if (!sectionMapping.sections || sectionMapping.sections.length === 0) {
        logger.warn('New area did not match any email section', { area: area.name });
        return { forecastsWritten: 0 };
      }

      // Step 2: Extract forecasts for the new area
      let forecastsWritten = 0;
      const section = sectionMapping.sections[0];

      const result = await this._extractForecastsForArea(
        fullEmail, area, section.section_name, sectionMapping.dates,
        section.synopsis, section.outlook
      );

      for (const forecast of (result.forecasts || [])) {
        try {
          await forecastEmailRepository.insertExpertForecast({
            email_id: fullEmail.id,
            area_id: area.id,
            forecast_date: forecast.forecast_date,
            region_name: section.section_name,
            synopsis: forecast.synopsis || null,
            outlook: forecast.outlook || null,
            wind_forecast: forecast.wind_forecast || null,
            swell_forecast: forecast.swell_forecast || null,
            sailing_suggestion: forecast.sailing_suggestion || null,
            precipitation: forecast.precipitation || null,
            buoy_readings: forecast.buoy_readings || null,
            full_excerpt: null,
            llm_raw_response: result.rawResponse || null,
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

  /**
   * Step 1: Lightweight call — map area GPS coordinates to email section headers.
   * Returns which section each area belongs to, plus the list of forecast dates.
   */
  async _mapAreasToSections(email, areas) {
    const areasList = areas.map(a =>
      `- ID: ${a.id}, GPS: ${a.latitude}N, ${Math.abs(a.longitude)}W, Direction: ${a.sailing_direction || 'none'}`
    ).join('\n');

    const receivedDate = new Date(email.received_at);
    const dateStr = receivedDate.toISOString().split('T')[0];
    const month = receivedDate.toLocaleString('en-US', { month: 'long' });
    const year = receivedDate.getUTCFullYear();

    const prompt = `This sailing weather email has forecast sections for different Caribbean regions. I need to know which section applies to each of my GPS locations.

EMAIL SUBJECT: ${email.subject}
EMAIL DATE: ${dateStr}

The email contains these regional section headers (look at WIND, SWELLS, SUGGEST, PRECIP sections):
Extract every regional sub-header from the email below (e.g., "Antigua-StMartin", "StLucia-Guadeloupe", "Trinidad-StVincent", etc.)

EMAIL:
${email.raw_text}

MY LOCATIONS:
${areasList}

TASKS:
1. List every regional sub-header found in the WIND/SWELLS/SUGGEST/PRECIP sections.
2. For each of my locations (by GPS coordinates), assign it to the closest matching regional sub-header.
3. List the forecast days that have specific WIND and SUGGEST data (typically 5-6 days). Do NOT include days only mentioned in the OUTLOOK section. "Today" = ${dateStr}. Resolve day references like "Sat21" to ${year}-${String(receivedDate.getUTCMonth() + 1).padStart(2, '0')}-21 (${month} ${year}). "Tonight" counts as the same date as "Today".
4. Extract the SYNOPSIS section text (verbatim).
5. Extract the OUTLOOK section text (verbatim).

Return JSON:
{
  "region_name": "overall region from subject",
  "primary_date": "${dateStr}",
  "dates": ["YYYY-MM-DD", ...],
  "synopsis": "full synopsis text",
  "outlook": "full outlook text",
  "sections": [
    {
      "section_name": "Antigua-StMartin",
      "area_ids": ["uuid1", "uuid2"]
    }
  ]
}

The sections array must only include sections that have at least one of my locations within that section's geographic coverage area. If this email does not cover the region where my locations are (e.g., my locations are in the Eastern Caribbean but the email covers the Bahamas or US East Coast), return an EMPTY sections array. Do NOT force a match — only match if the email genuinely covers the area near my GPS coordinates.`;

    const response = await openai.chat.completions.create({
      model: config.openai.model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '';
    logger.info('Step 1 response', { length: content.length, preview: content.substring(0, 300) });

    const parsed = JSON.parse(content);

    // Attach synopsis/outlook to each section for use in step 2
    for (const section of (parsed.sections || [])) {
      section.synopsis = parsed.synopsis || null;
      section.outlook = parsed.outlook || null;
    }

    return parsed;
  },

  /**
   * Step 2: For a single area, extract day-by-day forecasts in plain English.
   * One GPT call per area keeps output small and reliable.
   */
  async _extractForecastsForArea(email, area, sectionName, dates, synopsis, outlook) {
    const direction = area.sailing_direction || 'none';
    const directionInstruction = direction === 'none'
      ? 'This is a fixed location (no sailing direction). Give general sailing conditions.'
      : `This area\'s sailing direction is ${direction}. Tailor sailing advice for ${direction}-bound travel.`;

    const datesStr = dates.join(', ');

    const prompt = `Extract day-by-day sailing forecasts from the "${sectionName}" section of this weather email for ONE area.

AREA: ${area.name} (ID: ${area.id})
SAILING DIRECTION: ${directionInstruction}

DATES TO PRODUCE (exactly ${dates.length} entries):
${datesStr}

EMAIL (use only the "${sectionName}" lines from WIND, SWELLS, SUGGEST, PRECIP):
${email.raw_text}

RULES:
- Write in plain readable English. Unpack ALL abbreviations:
  "g" = gusting, "k" = knots, "sec" = second period, "'" = feet, "@" = at
  Direction abbreviations: "ENE" = east-northeast, "SE" = southeast, etc.
- UNITS: Use nautical standard — knots for wind speed, meters only for wave/swell heights.
  Convert feet to meters (1 foot = 0.3048m, round to one decimal). Do NOT include feet values.
- Example: "SE@13-20g25k/4-6'" becomes "Southeast winds 13 to 20 knots, gusting to 25. Wind chop 1.2 to 1.8 meters."
- synopsis and outlook are provided — copy them verbatim into every entry.
- One to three sentences per field.

SYNOPSIS: ${synopsis || 'Not available'}
OUTLOOK: ${outlook || 'Not available'}

Return JSON with exactly ${dates.length} entries:
{
  "forecasts": [
    {
      "forecast_date": "${dates[0]}",
      "synopsis": "copy synopsis above verbatim",
      "outlook": "copy outlook above verbatim",
      "wind_forecast": "plain English wind for this day",
      "swell_forecast": "plain English swell for this day",
      "sailing_suggestion": "plain English sailing advice for this day",
      "precipitation": "plain English precip for this day",
      "buoy_readings": null
    }
  ]
}

You MUST return exactly ${dates.length} forecast objects, one for each date: ${datesStr}. Do not skip any dates.`;

    const response = await openai.chat.completions.create({
      model: config.openai.model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '';
    logger.info('Step 2 response', { area: area.name, section: sectionName, length: content.length, preview: content.substring(0, 200) });

    const parsed = JSON.parse(content);
    parsed.rawResponse = content;
    return parsed;
  },

  /**
   * Step 3: Generate a 5-8 sentence change summary comparing previous and current forecasts for one area.
   * Focus on wind and wave changes. Called once per area at parse time.
   */
  async _generateChangeSummary(area, previousForecasts, currentForecasts, dates) {
    const overlappingDates = dates.filter(d =>
      previousForecasts.some(p => p.forecast_date === d)
    );

    if (overlappingDates.length === 0) return null;

    const prevByDate = {};
    for (const f of previousForecasts) { prevByDate[f.forecast_date] = f; }

    const currByDate = {};
    for (const f of currentForecasts) { currByDate[f.forecast_date] = f; }

    const comparison = overlappingDates.map(d => {
      const prev = prevByDate[d] || {};
      const curr = currByDate[d] || {};
      return `DATE: ${d}
Previous wind: ${prev.wind_forecast || 'N/A'}
Current wind: ${curr.wind_forecast || 'N/A'}
Previous swell: ${prev.swell_forecast || 'N/A'}
Current swell: ${curr.swell_forecast || 'N/A'}
Previous sailing: ${prev.sailing_suggestion || 'N/A'}
Current sailing: ${curr.sailing_suggestion || 'N/A'}`;
    }).join('\n\n');

    const prompt = `Compare the PREVIOUS and CURRENT expert sailing forecasts for "${area.name}" and summarize what changed.

${comparison}

Report ONLY what changed — do not describe the full forecast. Use short delta phrases like "wind up", "swell down", "no change". Group days with similar changes. Skip days with no meaningful change.

Format: each bullet is a terse delta statement with numbers. Examples:
- "Wind up 13-20kt → 15-20kt. Swell down 1.2-1.8m → 0.9-1.5m."
- "No significant change in wind or swell."

Return JSON:
{
  "bullets": [
    { "label": "Feb 23", "text": "Wind up 13-20kt → 15-20kt. Swell down 1.2-1.8m → 0.9-1.5m." },
    { "label": "Feb 24", "text": "No significant change." },
    { "label": "Feb 25", "text": "Wind up to 21kt gusting 27 (was 20 gusting 25). Chop up 1.2-1.8m → 1.5-2.4m." },
    { "label": "Overall", "text": "Conditions rougher by Feb 25." }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: config.openai.model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '';
    logger.info('Change summary response', { area: area.name, length: content.length });

    const parsed = JSON.parse(content);
    return parsed.bullets ? JSON.stringify(parsed.bullets) : null;
  },

  /**
   * Validate and normalize a forecast date
   */
  _validateForecastDate(dateStr, receivedAt) {
    if (!dateStr) {
      return new Date(receivedAt).toISOString().split('T')[0];
    }
    const parsed = new Date(dateStr + 'T12:00:00Z');
    if (isNaN(parsed.getTime())) {
      logger.warn('Invalid forecast date from GPT, using received date', { dateStr, receivedAt });
      return new Date(receivedAt).toISOString().split('T')[0];
    }
    return dateStr;
  },
};

export default forecastEmailParserService;
