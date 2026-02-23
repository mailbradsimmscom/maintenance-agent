/**
 * Forecast Email Service
 * Orchestrates the full pipeline: check Gmail inbox → ingest → parse → map to areas
 */

import { gmailRepository } from '../repositories/gmail.repository.js';
import { forecastEmailRepository } from '../repositories/forecast-email.repository.js';
import { forecastEmailParserService } from './forecast-email-parser.service.js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('forecast-email-service');

export const forecastEmailService = {
  /**
   * Check Gmail for new forecast emails, ingest, and parse them.
   * This is the main entry point called by the cron job and manual trigger.
   * @returns {Object} { emailsFound, emailsIngested, emailsParsed, errors }
   */
  async checkAndIngest() {
    if (!config.forecastEmail.enabled) {
      logger.info('Forecast email feature disabled');
      return { emailsFound: 0, emailsIngested: 0, emailsParsed: 0, errors: [], disabled: true };
    }

    const senderEmail = config.forecastEmail.senderEmail;
    const results = { emailsFound: 0, emailsIngested: 0, emailsParsed: 0, errors: [] };

    try {
      // Step 1: Search Gmail for recent emails from the forecast sender
      const query = `from:${senderEmail} newer_than:2d`;
      logger.info('Searching Gmail for forecast emails', { query });

      const messages = await gmailRepository.searchMessages(query);
      results.emailsFound = messages.length;
      logger.info('Gmail search results', { count: messages.length });

      if (messages.length === 0) {
        logger.info('No new forecast emails found');
        // Cleanup old emails
        await this._cleanup();
        return results;
      }

      // Step 2: Process each message
      for (const { id: gmailMessageId } of messages) {
        try {
          // Check if already ingested
          const existing = await forecastEmailRepository.emailExists(gmailMessageId);
          if (existing && existing.parse_status === 'parsed') {
            logger.debug('Email already ingested and parsed, skipping', { gmailMessageId });
            continue;
          }

          // Fetch full message
          const message = await gmailRepository.getMessage(gmailMessageId);
          const headers = gmailRepository.extractHeaders(message);
          const rawText = gmailRepository.extractPlainText(message);

          if (!rawText) {
            logger.warn('Empty email body, skipping', { gmailMessageId, subject: headers.subject });
            results.errors.push({ gmailMessageId, error: 'Empty email body' });
            continue;
          }

          // Extract region tag from subject
          const regionTag = this._extractRegionTag(headers.subject);

          // Insert into database (or get existing for retry)
          let emailRecord;
          if (existing) {
            // Existing but failed - re-use record
            emailRecord = { id: existing.id };
          } else {
            emailRecord = await forecastEmailRepository.insertEmail({
              gmail_message_id: gmailMessageId,
              sender_email: headers.from,
              subject: headers.subject,
              received_at: headers.date ? new Date(headers.date).toISOString() : new Date().toISOString(),
              raw_text: rawText,
              forecast_date: null, // Will be set by parser
              region_tag: regionTag,
            });
            results.emailsIngested++;
          }

          // Step 3: Parse with GPT and map to areas
          const parseResult = await forecastEmailParserService.parseAndMap({
            ...emailRecord,
            subject: headers.subject,
            raw_text: rawText,
            received_at: headers.date ? new Date(headers.date).toISOString() : new Date().toISOString(),
          });

          results.emailsParsed++;
          logger.info('Email processed', {
            gmailMessageId,
            subject: headers.subject,
            areasMatched: parseResult.areasMatched,
          });
        } catch (err) {
          logger.error('Failed to process email', { gmailMessageId, error: err.message });
          results.errors.push({ gmailMessageId, error: err.message });
        }
      }

      // Step 4: Cleanup old emails (>10 days)
      await this._cleanup();

    } catch (err) {
      logger.error('Forecast email check failed', { error: err.message });
      results.errors.push({ error: err.message });
    }

    logger.info('Forecast email check completed', results);
    return results;
  },

  /**
   * Get ingestion status for the status endpoint
   */
  async getStatus() {
    const recentEmails = await forecastEmailRepository.getRecentEmails(10);
    const parsed = recentEmails.filter(e => e.parse_status === 'parsed').length;
    const failed = recentEmails.filter(e => e.parse_status === 'failed').length;
    const pending = recentEmails.filter(e => e.parse_status === 'pending').length;

    return {
      enabled: config.forecastEmail.enabled,
      senderEmail: config.forecastEmail.senderEmail,
      recentEmails: recentEmails.length,
      parsed,
      failed,
      pending,
      lastEmail: recentEmails[0] || null,
    };
  },

  /**
   * Extract a region tag from the email subject
   * e.g., "Caribbean Sailing Brief - Antigua Region" → "Antigua Region"
   */
  _extractRegionTag(subject) {
    if (!subject) return null;
    // Try common patterns
    const dashMatch = subject.match(/[-–]\s*(.+)$/);
    if (dashMatch) return dashMatch[1].trim();
    return subject.trim();
  },

  /**
   * Clean up old emails (>10 days) to match forecast horizon
   */
  async _cleanup() {
    try {
      const deleted = await forecastEmailRepository.deleteOlderThan(10);
      if (deleted > 0) {
        logger.info('Cleaned up old forecast emails', { deleted });
      }
    } catch (err) {
      logger.error('Failed to clean up old emails', { error: err.message });
    }
  },
};

export default forecastEmailService;
