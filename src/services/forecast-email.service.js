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
import { getConfig, getEnv } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const env = getEnv();
const logger = createLogger('forecast-email-service');

const STRUCTURING_SYSTEM_PROMPT = `You are a marine forecast structuring engine.

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

Each corridor must follow this format:

CORRIDOR: [Corridor Name]

Suggest

Include routing direction guidance.

Include diurnal acceleration notes.

Include "too rough" / "salty" commentary.

Move any operational notes here.

Do NOT include raw wind numbers here.

3. DATE NORMALIZATION (CRITICAL)

From the subject line extract the issuance date.

If subject says:
"Wx Update, E Caribbean, Tue3 7am"

Then:

Today = Tuesday the 3rd – 5:00 AM

Tonight = Tuesday the 3rd – 5:00 PM

Rules:

Today must always be labeled:
[Full Weekday], [Month if known] [Day] – 5:00 AM

Tonight must always be labeled:
[Full Weekday], [Month if known] [Day] – 5:00 PM

All other days must be written as:
[Full Weekday] the [Day]

Never use shorthand like "Wed4".

Always expand ranges into individual days if possible.

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

Now transform the following forecast email:`;

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
          } else {
            // New email — insert
            await forecastEmailRepository.insertEmail({
              gmail_message_id: gmailMessageId,
              sender_email: headers.from,
              subject: headers.subject,
              received_at: receivedAt,
              raw_text: rawText,
              forecast_date: null,
              region_tag: regionTag,
            });
            results.emailsIngested++;
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

    // Structure any emails missing structured_forecast
    try {
      const structureResult = await this.structureEmails();
      results.structured = structureResult.structured;
    } catch (err) {
      logger.error('Structuring step failed', { error: err.message });
      results.structured = 0;
    }

    logger.info('Forecast email check completed', results);
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
        const userMessage = `Subject: ${email.subject}\n\n${email.raw_text}`;

        const response = await openai.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: STRUCTURING_SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          max_tokens: 4000,
          temperature: 0,
        });

        const structuredText = response.choices[0]?.message?.content;
        if (!structuredText) {
          logger.warn('Empty LLM response for email', { emailId: email.id });
          results.errors.push({ emailId: email.id, error: 'Empty LLM response' });
          continue;
        }

        // Store structured forecast and mark as parsed
        await forecastEmailRepository.storeStructuredForecast(email.id, structuredText);
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
