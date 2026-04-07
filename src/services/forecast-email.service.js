/**
 * Forecast Email Service
 * Gmail → DB ingestion, then LLM structuring via OpenAI.
 * Searches Gmail for forecast emails, stores them in weather_forecast_emails,
 * then sends unstructured emails to OpenAI to populate structured_forecast.
 * Keeps 6 most recent emails (rolling week Mon-Sat).
 */

import OpenAI from 'openai';
import { gmailRepository } from '../repositories/gmail.repository.js';
import { forecastEmailRepository } from '../repositories/forecast-email.repository.js';
import { weatherRepository } from '../repositories/weather.repository.js';
import { getConfig, getEnv } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const env = getEnv();
const logger = createLogger('forecast-email-service');

export const CANONICAL_CORRIDORS = [
  'Trinidad–St Vincent',
  'St Lucia–Guadeloupe',
  'Antigua–St Martin',
  'Anegada Passage–Eastern Puerto Rico–Virgin Islands',
  'Mona Passage–Dominican Republic',
  'ABC Islands–Venezuela',
];

const STRUCTURING_SYSTEM_PROMPT = `Produce the full structured output immediately. Do not ask questions, request confirmations, or offer choices. Do not comment on length or formatting constraints. Just output the structured forecast.

OUTPUT FORMAT IS STRICT MACHINE-PARSE STYLE.

Use only plain text.
Do not use Markdown.
Do not use bold.
Do not use tables.
Do not use separators.
Do not use decorative characters.

Every section must begin with an uppercase token followed by a colon.

Allowed tokens are:

SECTION:
CORRIDOR:
SUGGEST:
DATE:
WIND:
SEAS:
SWELL:
PRECIP:
KEY:

You are a marine forecast structuring engine.

Transform the following Caribbean marine forecast email into a fully normalized structured format using the exact rules below.

STRUCTURE RULES (MANDATORY)
1. GENERAL COMMENTARY SECTION (ALWAYS FIRST)

Create a section titled:

GENERAL COMMENTARY (Applies to All Corridors)

This must:

Summarize the macro pattern (high pressure, trades, swell drivers).

Include outlook information.

Include precip timing notes.

Include any "no eastbound windows" type global notes.

Do NOT repeat corridor-specific routing guidance here.

2. CORRIDOR STRUCTURE

Organize output strictly by combined sailing corridors.

Use ONLY these exact corridor names, regardless of how the source email labels them:
- Trinidad–St Vincent
- St Lucia–Guadeloupe
- Antigua–St Martin
- Anegada Passage–Eastern Puerto Rico–Virgin Islands
- Mona Passage–Dominican Republic
- ABC Islands–Venezuela

Each corridor must follow this format:

CORRIDOR: [Corridor Name]

Suggest

Include routing direction guidance.

Include diurnal acceleration notes.

Include "too rough" / "salty" commentary.

Move any operational notes here.

Do NOT include raw wind numbers here.

3. DATE NORMALIZATION (CRITICAL)

The email received date is provided in the user message. Use it to determine the month and year. The subject line day/number (e.g. "Wed4") confirms the day of month.

If received date is 2026-03-04 and subject says "Wed4 8am":

Today = Wednesday, March 4 – 5:00 AM

Tonight = Wednesday, March 4 – 5:00 PM

Rules:

Today must always be labeled:
[Full Weekday], [Month] [Day] – 5:00 AM

Tonight must always be labeled:
[Full Weekday], [Month] [Day] – 5:00 PM

All other days must be written as:
[Full Weekday], [Month] [Day]

Never use shorthand like "Wed4".

Always expand ranges into individual days if possible.

If dates cross into the next month, increment the month accordingly.

4. WITHIN EACH DATE BLOCK USE EXACT ORDER

For every date, use this order exactly:

Wind:
Seas (wind-driven):
Swell:
Precip:

Never combine Seas and Swell.
Never combine Wind and Seas.
Always separate them.

If seas are implied from wind (e.g. "/ 5–8'"), move them to Seas.

If swell is defined in a separate section, map it correctly to that corridor and day.

If swell only applies regionally (e.g. Trinidad–Guadeloupe band), attach appropriately.

5. CORRIDOR INTEGRATION RULES

Some corridors combine subzones.

For example:
Mona Passage–Dominican Republic includes:

Mona Passage

East DR (near Samaná)

West DR (Rio San Juan–Luperón)

If subzones exist:

Preserve subzone breakdown inside Wind and Seas.

Do NOT flatten them.

6. PRECIP HANDLING

If precip is given as a range (e.g., today–Sat7):

Expand it into each individual day.

If email states:
"Coverage highest overnights into mornings"

Mention that in Suggest or Tonight block.

7. AT END CREATE:

COMBINED SAILING CORRIDORS (Key)

List every corridor used in this output.

If a corridor includes subzones, indent them beneath it.

8. STYLE RULES

Do not summarize away detail.

Preserve numeric fidelity exactly.

Preserve gust values.

Preserve swell periods.

Do not editorialize.

Do not add new forecast interpretation.

Do not omit locations.

Maintain professional marine tone.

IMPORTANT: The subject line is the authoritative source for the issuance date and day of week. Never ask clarifying questions. Always produce the full structured output in a single response. Do not truncate or summarize.

Now transform the following forecast email:`;

const CORRIDOR_EXTRACTION_PROMPT = `You are a marine forecast data extractor. Extract numeric forecast data from the corridor section below into JSON.

RULES:

1. DATES: Resolve all date text to ISO format (YYYY-MM-DD). The email received date will be provided in the user message — use it to determine the correct month and year. "Wed4" or "Wednesday the 4th" means the 4th of that same month. "Thursday the 5th" means the 5th of that same month. If dates cross into the next month, increment accordingly.

2. AM/PM MERGE: If a day has separate AM and PM blocks, merge into ONE entry for that date. Use worst-case values across both blocks.

3. WIND RANGE: Extract as [low, high] in knots. If "decreasing to" or "increasing to" appears, use the widest envelope (lowest low, highest high across all sub-ranges).

4. WIND DIRECTION: Pick the dominant/first direction. Normalize compound directions to simple compass: "ENE-E to NE-ENE" → "ENE", "NE to ENE" → "ENE".

5. GUSTS: Extract the highest gust value mentioned for that day. If no gust mentioned, set to null.

6. SEAS: Use the HIGH END of the range only, single number in feet. "5–8 feet" → 8. If AM/PM differ, use the highest value.

7. SWELL HEIGHT: Use the HIGH END only, single number in feet. "7–10 feet" → 10.

8. SWELL PERIOD: Use the LOW END only, single number in seconds. "8–10 seconds" → 8. Shorter period = steeper waves = worst case.

9. SWELL DIRECTION: Simple compass direction.

10. NO SWELL: If swell says "Mostly wind-driven chop" or similar, return empty array.

11. PRECIP: Short text, e.g. "Isolated showers". Drop the "+5 knots" part.

12. PROSE: Return wind_forecast and swell_forecast as the raw WIND: and SWELL: line text verbatim from the input.

OUTPUT FORMAT:
Return ONLY valid JSON, no markdown fences, no explanation.

{
  "dates": [
    {
      "date": "YYYY-MM-DD",
      "wind": { "range_kt": [low, high], "dir": "ENE", "gust_kt": 28 },
      "seas_ft": 8,
      "swell": [{ "ft": 10, "period_s": 8, "dir": "ENE" }],
      "precip": "Isolated showers",
      "wind_forecast": "raw WIND line text",
      "swell_forecast": "raw SWELL line text"
    }
  ]
}`;

export const forecastEmailService = {
  /**
   * Check Gmail for new forecast emails and store them in DB.
   * No LLM calls. No parsing. Just ingestion.
   * @returns {Object} { emailsFound, emailsIngested, errors }
   */
  async checkAndIngest() {
    if (!config.forecastEmail.enabled) {
      logger.info('Forecast email feature disabled');
      return { emailsFound: 0, emailsIngested: 0, errors: [], disabled: true };
    }

    const senderEmail = config.forecastEmail.senderEmail;
    const searchDays = config.forecastEmail.gmailSearchDays;
    const results = { emailsFound: 0, emailsIngested: 0, errors: [] };
    const step3Promises = [];

    // Region filter from .env (comma-separated keywords for subject-line gating)
    const allowedRegions = config.forecastEmail.regionFilter
      ?.split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length > 0) || [];

    try {
      // Search Gmail for recent emails from the forecast sender
      let query = `from:${senderEmail} newer_than:${searchDays}d`;
      if (allowedRegions.length > 0) {
        const subjectFilter = allowedRegions.map(r => `subject:"${r}"`).join(' OR ');
        query += ` (${subjectFilter})`;
      }
      logger.info('Searching Gmail for forecast emails', { query });

      const messages = await gmailRepository.searchMessages(query);
      results.emailsFound = messages.length;
      logger.info('Gmail search results', { count: messages.length });

      if (messages.length === 0) {
        logger.info('No new forecast emails found');
        await this._cleanup();
        return results;
      }

      // Ingest each message into DB
      for (const { id: gmailMessageId } of messages) {
        try {
          // Check if already in DB
          const existing = await forecastEmailRepository.emailExists(gmailMessageId);

          if (existing && existing.raw_text) {
            // Already ingested with content — skip
            continue;
          }

          // Fetch full message from Gmail
          const message = await gmailRepository.getMessage(gmailMessageId);
          const headers = gmailRepository.extractHeaders(message);
          const rawText = gmailRepository.extractPlainText(message);

          if (!rawText) {
            logger.warn('Empty email body, skipping', { gmailMessageId, subject: headers.subject });
            results.errors.push({ gmailMessageId, error: 'Empty email body' });
            continue;
          }

          // Region safety-net filter (Gmail query already filters, this is backup)
          if (allowedRegions.length > 0) {
            const subjectLower = headers.subject?.toLowerCase() || '';
            if (!allowedRegions.some(region => subjectLower.includes(region))) {
              continue;
            }
          }

          const regionTag = this._extractRegionTag(headers.subject);
          const receivedAt = headers.date ? new Date(headers.date).toISOString() : new Date().toISOString();

          if (existing) {
            // Exists but missing content (failed ingest) — update it
            await forecastEmailRepository.updateEmailContent(existing.id, {
              raw_text: rawText,
              sender_email: headers.from,
              subject: headers.subject,
              received_at: receivedAt,
              region_tag: regionTag,
              parse_status: 'ingested',
            });
            logger.info('Re-ingested email with missing content', { gmailMessageId });
            results.emailsIngested++;

            // Stamp corridors_included (step 3, parallel with step 2)
            step3Promises.push(
              this._stampCorridorsIncluded(existing.id)
                .catch(err => logger.error('Failed to stamp corridors_included', { emailId: existing.id, error: err.message }))
            );
          } else {
            // New email — insert
            const inserted = await forecastEmailRepository.insertEmail({
              gmail_message_id: gmailMessageId,
              sender_email: headers.from,
              subject: headers.subject,
              received_at: receivedAt,
              raw_text: rawText,
              forecast_date: null,
              region_tag: regionTag,
            });
            results.emailsIngested++;

            // Stamp corridors_included (step 3, parallel with step 2)
            step3Promises.push(
              this._stampCorridorsIncluded(inserted.id)
                .catch(err => logger.error('Failed to stamp corridors_included', { emailId: inserted.id, error: err.message }))
            );
          }
        } catch (err) {
          logger.error('Failed to ingest email', { gmailMessageId, error: err.message });
          results.errors.push({ gmailMessageId, error: err.message });
        }
      }

      // Keep 6 most recent emails
      await this._cleanup();

    } catch (err) {
      logger.error('Forecast email check failed', { error: err.message });
      results.errors.push({ error: err.message });
    }

    // Step 2: Structure any emails missing structured_forecast
    try {
      const structureResult = await this.structureEmails();
      results.structured = structureResult.structured;
    } catch (err) {
      logger.error('Step 2 (structuring) failed', { error: err.message });
      results.structured = 0;
    }

    // Step 3: Ensure corridors_included stamps are complete
    if (step3Promises.length > 0) {
      await Promise.all(step3Promises);
      logger.info('Step 3 (corridors_included) complete', { count: step3Promises.length });
    }

    // Step 4: Extract corridor-level JSON from structured emails
    try {
      const corridorResult = await this.extractCorridorData();
      results.corridorDataProcessed = corridorResult.processed;
      logger.info('Step 4 (corridor data extraction) complete', corridorResult);
    } catch (err) {
      logger.error('Step 4 (corridor data extraction) failed', { error: err.message });
      results.corridorDataProcessed = 0;
    }

    // Step 5: Fan out corridor_data to per-area weather_forecasts rows
    try {
      const fanOutResult = await this.fanOutToForecasts();
      results.forecastsWritten = fanOutResult.rowsWritten;
      logger.info('Step 5 (fan-out) complete', fanOutResult);
    } catch (err) {
      logger.error('Step 5 (fan-out) failed', { error: err.message });
      results.forecastsWritten = 0;
    }

    logger.info('Forecast email pipeline completed', results);
    return results;
  },

  /**
   * Get ingestion status
   */
  async getStatus() {
    const recentEmails = await forecastEmailRepository.getRecentEmails(20);

    return {
      enabled: config.forecastEmail.enabled,
      senderEmail: config.forecastEmail.senderEmail,
      recentEmails: recentEmails.length,
      lastEmail: recentEmails[0] || null,
    };
  },

  /**
   * Send unstructured emails to OpenAI for LLM structuring.
   * Populates structured_forecast and sets parse_status='parsed'.
   * @returns {Object} { structured, skipped, errors }
   */
  async structureEmails() {
    const results = { structured: 0, skipped: 0, errors: [] };

    const emails = await forecastEmailRepository.getEmailsNeedingStructure();
    if (emails.length === 0) {
      logger.info('No emails need structuring');
      return results;
    }

    logger.info('Structuring emails with LLM', { count: emails.length });

    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 120000 });
    const model = config.openai.model;

    for (const email of emails) {
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4.1',
          temperature: 0,
          top_p: 1,
          max_completion_tokens: 6000,
          messages: [
            { role: 'system', content: STRUCTURING_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Email received: ${email.received_at}\nSubject: ${email.subject}\n\n${email.raw_text}`,
            },
          ],
        });

        const structuredText = response.choices[0]?.message?.content;
        if (!structuredText) {
          logger.warn('Empty LLM response for email', { emailId: email.id });
          results.errors.push({ emailId: email.id, error: 'Empty LLM response' });
          continue;
        }

        // Extract corridors from COMBINED SAILING CORRIDORS (Key) section
        const corridors = this._extractCorridors(structuredText);

        // Store structured forecast, corridors, and mark as parsed
        await forecastEmailRepository.storeStructuredForecast(email.id, structuredText, null, corridors);
        await forecastEmailRepository.updateParseStatus(email.id, 'parsed');

        logger.info('Email structured successfully', {
          emailId: email.id,
          subject: email.subject,
          responseLength: structuredText.length,
        });
        results.structured++;
      } catch (err) {
        logger.error('Failed to structure email', { emailId: email.id, error: err.message });
        results.errors.push({ emailId: email.id, error: err.message });
      }
    }

    logger.info('Email structuring completed', results);
    return results;
  },

  /**
   * Extract a region tag from the email subject
   */
  _extractRegionTag(subject) {
    if (!subject) return null;
    const dashMatch = subject.match(/[-–]\s*(.+)$/);
    if (dashMatch) return dashMatch[1].trim();
    return subject.trim();
  },

  /**
   * Extract corridor names from the COMBINED SAILING CORRIDORS (Key) section.
   * Returns a JSON array of corridor names (including subzones).
   */
  _extractCorridors(structuredText) {
    const keySection = structuredText.match(/COMBINED SAILING CORRIDORS \(Key\)\s*\n([\s\S]*?)$/i);
    if (!keySection) return [];

    return keySection[1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('SECTION') && !line.startsWith('KEY:'));
  },

  /**
   * Step 4a: Extract corridor-level structured JSON from parsed emails.
   * For each corridor in corridors_included, extracts the DATE blocks from
   * the structured text and sends to gpt-4.1-mini for JSON extraction.
   * Stores result in corridor_data jsonb column.
   */
  async extractCorridorData() {
    const results = { processed: 0, skipped: 0, errors: [] };

    const emails = await forecastEmailRepository.getEmailsNeedingCorridorData();
    if (emails.length === 0) {
      logger.info('No emails need corridor data extraction');
      return results;
    }

    logger.info('Extracting corridor data', { count: emails.length });

    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 60000 });

    for (const email of emails) {
      try {
        const corridorsIncluded = email.corridors_included;
        if (!corridorsIncluded || corridorsIncluded.length === 0) {
          results.skipped++;
          continue;
        }

        const corridorData = {};

        for (const corridor of corridorsIncluded) {
          const sectionText = this._extractCorridorSection(email.structured_forecast, corridor);
          if (!sectionText) {
            logger.warn('Corridor section not found in structured text', { emailId: email.id, corridor });
            continue;
          }

          const response = await openai.chat.completions.create({
            model: 'gpt-4.1-mini',
            temperature: 0,
            max_completion_tokens: 2000,
            messages: [
              {
                role: 'system',
                content: CORRIDOR_EXTRACTION_PROMPT,
              },
              {
                role: 'user',
                content: `Email received: ${email.received_at}\nEmail subject: ${email.subject}\n\nCorridor section:\n${sectionText}`,
              }
            ],
          });

          const content = response.choices[0]?.message?.content?.trim();
          if (!content) {
            logger.warn('Empty LLM response for corridor', { emailId: email.id, corridor });
            continue;
          }

          // Strip markdown fences if present
          const jsonStr = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

          try {
            const parsed = JSON.parse(jsonStr);
            corridorData[corridor] = parsed;
          } catch (parseErr) {
            logger.error('Failed to parse corridor JSON', { emailId: email.id, corridor, error: parseErr.message, content: content.substring(0, 300) });
          }
        }

        if (Object.keys(corridorData).length > 0) {
          await forecastEmailRepository.storeCorridorData(email.id, corridorData);
          logger.info('Corridor data stored', { emailId: email.id, corridors: Object.keys(corridorData) });
          results.processed++;
        } else {
          results.skipped++;
        }
      } catch (err) {
        logger.error('Failed to extract corridor data', { emailId: email.id, error: err.message });
        results.errors.push({ emailId: email.id, error: err.message });
      }
    }

    logger.info('Corridor data extraction completed', results);
    return results;
  },

  /**
   * Normalize a corridor name for fuzzy matching.
   * Strips periods, normalizes dashes, collapses whitespace, lowercases.
   */
  _normalizeCorridor(name) {
    return name
      .replace(/\./g, '')
      .replace(/[–—-]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  },

  /**
   * Find the exact corridor name used in structured text by fuzzy-matching
   * against the provided corridorName. Returns the exact text name or null.
   */
  _findCorridorInText(structuredText, corridorName) {
    const normalized = this._normalizeCorridor(corridorName);
    const matches = structuredText.match(/CORRIDOR:\s*(.+)/gi) || [];
    // Exact normalized match first
    for (const m of matches) {
      const name = m.replace(/^CORRIDOR:\s*/i, '').trim();
      if (this._normalizeCorridor(name) === normalized) {
        return name;
      }
    }
    // Substring match fallback — handles LLM dropping or adding suffixes
    for (const m of matches) {
      const name = m.replace(/^CORRIDOR:\s*/i, '').trim();
      const norm = this._normalizeCorridor(name);
      if (normalized.includes(norm) || norm.includes(normalized)) {
        return name;
      }
    }
    return null;
  },

  /**
   * Find a key in a corridor_data object by fuzzy matching.
   * Handles exact, normalized, and substring matches.
   */
  _findKeyFuzzy(data, corridorName) {
    if (!data || !corridorName) return null;
    if (data[corridorName]) return corridorName;
    const normalized = this._normalizeCorridor(corridorName);
    for (const key of Object.keys(data)) {
      const norm = this._normalizeCorridor(key);
      if (norm === normalized || normalized.includes(norm) || norm.includes(normalized)) {
        return key;
      }
    }
    return null;
  },

  /**
   * Extract a single corridor's DATE blocks from the structured text.
   * Returns the text between CORRIDOR: [name] and the next CORRIDOR: (or COMBINED SAILING CORRIDORS),
   * with SUGGEST: block removed — only DATE/WIND/SEAS/SWELL/PRECIP lines.
   */
  _extractCorridorSection(structuredText, corridorName) {
    if (!structuredText || !corridorName) return null;

    const actualName = this._findCorridorInText(structuredText, corridorName);
    if (!actualName) return null;

    const escaped = actualName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`CORRIDOR:\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=CORRIDOR:|COMBINED SAILING CORRIDORS|$)`, 'i');
    const match = structuredText.match(pattern);
    if (!match) return null;

    const sectionText = match[1];

    // Remove SUGGEST block (from SUGGEST: to the next DATE: or end of section)
    const withoutSuggest = sectionText.replace(/SUGGEST:[\s\S]*?(?=DATE:|$)/i, '');

    return withoutSuggest.trim();
  },

  /**
   * Step 4b: Fan out corridor_data to per-area rows in weather_forecasts.
   * For each area, looks up its corridor, finds matching data in corridor_data,
   * writes one row per date with data_source='expert', model_name='expert'.
   */
  async fanOutToForecasts() {
    const results = { rowsWritten: 0, areasProcessed: 0, errors: [] };

    // Get the most recent email with corridor_data
    const emails = await forecastEmailRepository.getEmailsWithCorridorData();
    if (emails.length === 0) {
      logger.info('No emails with corridor_data to fan out');
      return results;
    }

    const email = emails[0]; // most recent
    const corridorData = email.corridor_data;

    // Get all active areas with corridors
    const areas = await weatherRepository.getAllAreas();
    const areasWithCorridor = areas.filter(a => a.corridor);

    if (areasWithCorridor.length === 0) {
      logger.info('No areas with corridor assignments');
      return results;
    }

    const forecastRows = [];

    for (const area of areasWithCorridor) {
      const corridorKey = this._findKeyFuzzy(corridorData, area.corridor);
      const corridor = corridorKey ? corridorData[corridorKey] : null;
      if (!corridor || !corridor.dates) {
        logger.warn('No corridor data for area', { areaId: area.id, corridor: area.corridor });
        continue;
      }

      for (const day of corridor.dates) {
        if (!day.date) continue;

        const row = {
          area_id: area.id,
          forecast_time: `${day.date}T12:00:00Z`,
          data_source: 'expert',
          model_name: 'expert',
          fetched_at: new Date().toISOString(),
          wind_speed_10m: day.wind?.range_kt?.[1] ?? null,       // high end
          wind_direction_10m: this._compassToDeg(day.wind?.dir),
          wind_gusts_10m: day.wind?.gust_kt ?? null,
          wave_height: day.seas_ft != null ? day.seas_ft / 3.281 : null,  // ft → meters
          swell_wave_height: day.swell?.[0]?.ft != null ? day.swell[0].ft / 3.281 : null,
          swell_wave_period: day.swell?.[0]?.period_s ?? null,
          swell_wave_direction: this._compassToDeg(day.swell?.[0]?.dir),
        };

        forecastRows.push(row);
      }

      results.areasProcessed++;
    }

    if (forecastRows.length > 0) {
      const { count } = await weatherRepository.storeForecasts(forecastRows);
      results.rowsWritten = count;
      logger.info('Expert forecasts fanned out to weather_forecasts', {
        emailId: email.id,
        areas: results.areasProcessed,
        rows: count,
      });
    }

    return results;
  },

  /**
   * Fan out existing corridor_data to a single newly-created area.
   * Called after corridor assignment on new area creation.
   */
  async fanOutForNewArea(areaId, corridor) {
    const result = { rowsWritten: 0 };

    const emails = await forecastEmailRepository.getEmailsWithCorridorData();
    if (emails.length === 0) return result;

    const email = emails[0];
    const corridorDates = email.corridor_data?.[corridor]?.dates;
    if (!corridorDates || corridorDates.length === 0) return result;

    const forecastRows = corridorDates
      .filter(day => day.date)
      .map(day => ({
        area_id: areaId,
        forecast_time: `${day.date}T12:00:00Z`,
        data_source: 'expert',
        model_name: 'expert',
        fetched_at: new Date().toISOString(),
        wind_speed_10m: day.wind?.range_kt?.[1] ?? null,
        wind_direction_10m: this._compassToDeg(day.wind?.dir),
        wind_gusts_10m: day.wind?.gust_kt ?? null,
        wave_height: day.seas_ft != null ? day.seas_ft / 3.281 : null,
        swell_wave_height: day.swell?.[0]?.ft != null ? day.swell[0].ft / 3.281 : null,
        swell_wave_period: day.swell?.[0]?.period_s ?? null,
        swell_wave_direction: this._compassToDeg(day.swell?.[0]?.dir),
      }));

    if (forecastRows.length > 0) {
      const { count } = await weatherRepository.storeForecasts(forecastRows);
      result.rowsWritten = count;
    }

    return result;
  },

  /**
   * Convert compass direction string to degrees.
   * Returns null if not recognized.
   */
  _compassToDeg(dir) {
    if (!dir) return null;
    const map = {
      'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
      'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
      'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
      'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5,
    };
    return map[dir.toUpperCase()] ?? null;
  },

  /**
   * Stamp corridors_included on an email row — the deduplicated list of
   * corridors from active weather_areas that we care about.
   */
  async _stampCorridorsIncluded(emailId) {
    const corridors = await weatherRepository.getActiveCorridors();
    if (corridors.length === 0) {
      logger.info('No active corridors to stamp', { emailId });
      return;
    }
    await forecastEmailRepository.updateCorridorsIncluded(emailId, corridors);
    logger.info('Corridors included stamped', { emailId, count: corridors.length });
  },

  /**
   * Backfill corridors_included on all emails that don't have it yet
   */
  async backfillCorridorsIncluded() {
    const corridors = await weatherRepository.getActiveCorridors();
    if (corridors.length === 0) {
      return { updated: 0, message: 'No active corridors found' };
    }

    const emails = await forecastEmailRepository.getRecentEmails(50);
    let updated = 0;

    for (const email of emails) {
      try {
        await forecastEmailRepository.updateCorridorsIncluded(email.id, corridors);
        updated++;
      } catch (err) {
        logger.error('Failed to backfill corridors_included', { emailId: email.id, error: err.message });
      }
    }

    logger.info('Corridors included backfill complete', { updated, corridors: corridors.length });
    return { updated, corridors };
  },

  /**
   * Get corridor display data for weather-areas.html.
   * Returns general commentary, per-corridor suggest text, and trend comparison
   * between the two most recent emails with corridor_data.
   */
  async getCorridorDisplay() {
    const emails = await forecastEmailRepository.getEmailsForCorridorDisplay();

    if (emails.length === 0) {
      return { hasData: false };
    }

    const latest = emails[0];
    const previous = emails[1] || null;
    const corridors = latest.corridors_included || [];

    // General commentary
    const commentary = this._extractGeneralCommentary(latest.structured_forecast);

    // Per-corridor suggest + trend
    const corridorSections = [];
    for (const corridor of corridors) {
      const suggest = this._extractSuggest(latest.structured_forecast, corridor);

      let trends = null;
      if (previous) {
        trends = this._compareCorridor(latest.corridor_data, previous.corridor_data, corridor);
      }

      corridorSections.push({ corridor, suggest, trends });
    }

    return {
      hasData: true,
      emailSubject: latest.subject,
      emailDate: latest.received_at,
      previousDate: previous?.received_at || null,
      commentary,
      corridors: corridorSections,
    };
  },

  /**
   * Extract GENERAL COMMENTARY section from structured text.
   */
  _extractGeneralCommentary(structuredText) {
    if (!structuredText) return null;
    const match = structuredText.match(
      /SECTION:\s*GENERAL COMMENTARY[^\n]*\n([\s\S]*?)(?=CORRIDOR:|$)/i
    );
    return match ? match[1].trim() : null;
  },

  /**
   * Extract SUGGEST text for a specific corridor from structured text.
   */
  _extractSuggest(structuredText, corridorName) {
    if (!structuredText || !corridorName) return null;

    const actualName = this._findCorridorInText(structuredText, corridorName);
    if (!actualName) return null;

    const escaped = actualName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `CORRIDOR:\\s*${escaped}\\s*\\n[\\s\\S]*?SUGGEST:\\s*\\n?([\\s\\S]*?)(?=DATE:|CORRIDOR:|COMBINED SAILING|$)`,
      'i'
    );
    const match = structuredText.match(pattern);
    return match ? match[1].trim() : null;
  },

  /**
   * Compare corridor_data between two emails and generate plain-English trend bullets.
   */
  _compareCorridor(todayData, yesterdayData, corridorName) {
    const todayKey = this._findKeyFuzzy(todayData, corridorName);
    const yesterdayKey = this._findKeyFuzzy(yesterdayData, corridorName);
    const today = todayKey ? todayData[todayKey]?.dates : null;
    const yesterday = yesterdayKey ? yesterdayData[yesterdayKey]?.dates : null;

    if (!today || !yesterday) return null;

    const todayByDate = {};
    for (const d of today) todayByDate[d.date] = d;
    const yesterdayByDate = {};
    for (const d of yesterday) yesterdayByDate[d.date] = d;

    const overlapping = Object.keys(todayByDate).filter(d => yesterdayByDate[d]);
    if (overlapping.length === 0) return null;

    const trends = [];

    // Wind
    const windChanges = overlapping.map(d => {
      const tHigh = todayByDate[d].wind?.range_kt?.[1];
      const yHigh = yesterdayByDate[d].wind?.range_kt?.[1];
      return (tHigh != null && yHigh != null) ? tHigh - yHigh : 0;
    });
    const avgWind = windChanges.reduce((a, b) => a + b, 0) / windChanges.length;
    if (Math.abs(avgWind) >= 2) {
      trends.push(`Wind ${avgWind > 0 ? 'increasing' : 'decreasing'} by ~${Math.abs(Math.round(avgWind))}kt vs yesterday's forecast`);
    } else {
      trends.push('Wind forecast largely unchanged');
    }

    // Seas
    const seasChanges = overlapping.map(d => {
      const t = todayByDate[d].seas_ft;
      const y = yesterdayByDate[d].seas_ft;
      return (t != null && y != null) ? t - y : 0;
    });
    const avgSeas = seasChanges.reduce((a, b) => a + b, 0) / seasChanges.length;
    if (Math.abs(avgSeas) >= 1) {
      trends.push(`Seas ${avgSeas > 0 ? 'building' : 'dropping'} by ~${Math.abs(Math.round(avgSeas))}ft`);
    } else {
      trends.push('Seas forecast steady');
    }

    // Swell
    const swellChanges = overlapping.map(d => {
      const t = todayByDate[d].swell?.[0]?.ft;
      const y = yesterdayByDate[d].swell?.[0]?.ft;
      return (t != null && y != null) ? t - y : 0;
    });
    const avgSwell = swellChanges.reduce((a, b) => a + b, 0) / swellChanges.length;
    if (Math.abs(avgSwell) >= 1) {
      trends.push(`Swell ${avgSwell > 0 ? 'building' : 'easing'} by ~${Math.abs(Math.round(avgSwell))}ft`);
    } else {
      trends.push('Swell forecast unchanged');
    }

    // Gusts
    const gustChanges = overlapping.map(d => {
      const t = todayByDate[d].wind?.gust_kt;
      const y = yesterdayByDate[d].wind?.gust_kt;
      return (t != null && y != null) ? t - y : 0;
    });
    const avgGust = gustChanges.reduce((a, b) => a + b, 0) / gustChanges.length;
    if (Math.abs(avgGust) >= 3) {
      trends.push(`Gusts trending ${avgGust > 0 ? 'higher' : 'lower'} (~${Math.abs(Math.round(avgGust))}kt)`);
    }

    return { overlappingDates: overlapping.length, trends };
  },

  /**
   * Keep the 6 most recent emails (full rolling week Mon-Sat)
   */
  async _cleanup() {
    try {
      const deleted = await forecastEmailRepository.deleteOldEmails(6);
      if (deleted > 0) {
        logger.info('Cleaned up old forecast emails', { deleted, kept: 6 });
      }
    } catch (err) {
      logger.error('Failed to clean up old emails', { error: err.message });
    }
  },
};

export default forecastEmailService;
