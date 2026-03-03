/**
 * Forecast Email Ingestion Service
 * Gmail → DB. No LLM calls. No parsing.
 * Searches Gmail for forecast emails, stores them in weather_forecast_emails.
 * Keeps 6 most recent emails (rolling week Mon-Sat).
 */

import { gmailRepository } from '../repositories/gmail.repository.js';
import { forecastEmailRepository } from '../repositories/forecast-email.repository.js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('forecast-email-service');

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
