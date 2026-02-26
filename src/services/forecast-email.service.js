/**
 * Forecast Email Service
 * Orchestrates the full pipeline: check Gmail inbox → ingest → parse → map to areas
 * Parse runs in background (fire-and-forget) so the check endpoint returns immediately.
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
   * Check Gmail for new forecast emails and ingest them.
   * Returns immediately after ingestion — parsing runs in background.
   * @returns {Object} { emailsFound, emailsIngested, parseTriggered, errors }
   */
  async checkAndIngest() {
    if (!config.forecastEmail.enabled) {
      logger.info('Forecast email feature disabled');
      return { emailsFound: 0, emailsIngested: 0, parseTriggered: 0, errors: [], disabled: true };
    }

    const senderEmail = config.forecastEmail.senderEmail;
    const searchDays = config.forecastEmail.gmailSearchDays;
    const results = { emailsFound: 0, emailsIngested: 0, parseTriggered: 0, errors: [] };

    // Parse region filter (comma-separated keywords for subject-line gating)
    const allowedRegions = config.forecastEmail.regionFilter
      ?.split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length > 0) || [];

    try {
      // Recover stale parse locks (stuck in 'parsing' for >10 minutes)
      const staleCount = await forecastEmailRepository.recoverStaleLocks(10);
      if (staleCount > 0) {
        logger.info('Recovered stale parse locks', { count: staleCount });
      }

      // Step 1: Search Gmail for recent emails from the forecast sender
      // Gmail query subject filter does the real work; code filter below is a safety net
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

      // Step 2: Ingest each message (store in DB, no parsing yet)
      const emailsToProcess = [];

      for (const { id: gmailMessageId } of messages) {
        try {
          // Check if already ingested
          const existing = await forecastEmailRepository.emailExists(gmailMessageId);
          if (existing && existing.parse_status === 'parsed') {
            logger.debug('Email already parsed, skipping', { gmailMessageId });
            continue;
          }
          if (existing && existing.parse_status === 'parsing') {
            logger.debug('Email currently being parsed, skipping', { gmailMessageId });
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

          // Code safety-net filter (Gmail query already filters, this is redundant protection)
          if (allowedRegions.length > 0) {
            const subjectLower = headers.subject?.toLowerCase() || '';
            if (!allowedRegions.some(region => subjectLower.includes(region))) {
              logger.debug('Skipping email due to region filter', {
                subject: headers.subject, allowedRegions,
              });
              continue;
            }
          }

          const regionTag = this._extractRegionTag(headers.subject);

          // Insert or re-use existing record
          let emailRecord;
          if (existing) {
            logger.info('Existing email found', { gmailMessageId, parse_status: existing.parse_status });
            emailRecord = { id: existing.id };
          } else {
            emailRecord = await forecastEmailRepository.insertEmail({
              gmail_message_id: gmailMessageId,
              sender_email: headers.from,
              subject: headers.subject,
              received_at: headers.date ? new Date(headers.date).toISOString() : new Date().toISOString(),
              raw_text: rawText,
              forecast_date: null,
              region_tag: regionTag,
            });
            results.emailsIngested++;
          }

          emailsToProcess.push({
            ...emailRecord,
            subject: headers.subject,
            raw_text: rawText,
            received_at: headers.date ? new Date(headers.date).toISOString() : new Date().toISOString(),
          });
        } catch (err) {
          logger.error('Failed to ingest email', { gmailMessageId, error: err.message });
          results.errors.push({ gmailMessageId, error: err.message });
        }
      }

      // Step 3: Parse emails synchronously (v4 is fast enough to await)
      results.parseTriggered = emailsToProcess.length;
      results.parseResults = [];
      for (const email of emailsToProcess) {
        const parseResult = await this._parseEmail(email);
        results.parseResults.push(parseResult || { emailId: email.id, forecastsWritten: 0 });
      }
      results.totalForecastsWritten = results.parseResults.reduce(
        (sum, r) => sum + (r.forecastsWritten || 0), 0
      );

      // Step 4: Cleanup old emails
      await this._cleanup();

    } catch (err) {
      logger.error('Forecast email check failed', { error: err.message });
      results.errors.push({ error: err.message });
    }

    logger.info('Forecast email check completed', results);
    return results;
  },

  /**
   * Parse an email in the background with job lock protection.
   */
  async _parseEmail(email) {
    try {
      const locked = await forecastEmailRepository.acquireParseLock(email.id);
      if (!locked) {
        logger.debug('Could not acquire parse lock, skipping', { emailId: email.id });
        return { emailId: email.id, forecastsWritten: 0, skipped: true };
      }

      const result = await forecastEmailParserService.parseAndMap(email);
      logger.info('Parse completed', {
        emailId: email.id,
        subject: email.subject,
        forecastsWritten: result.forecastsWritten,
      });
      return { emailId: email.id, ...result };
    } catch (err) {
      logger.error('Parse failed', { emailId: email.id, error: err.message });
      return { emailId: email.id, forecastsWritten: 0, error: err.message };
    }
  },

  /**
   * Get ingestion status for the status endpoint
   */
  async getStatus() {
    const recentEmails = await forecastEmailRepository.getRecentEmails(20);
    const counts = { queued: 0, parsing: 0, parsed: 0, partial: 0, failed: 0 };
    for (const e of recentEmails) {
      if (counts[e.parse_status] !== undefined) {
        counts[e.parse_status]++;
      }
    }

    return {
      enabled: config.forecastEmail.enabled,
      senderEmail: config.forecastEmail.senderEmail,
      recentEmails: recentEmails.length,
      ...counts,
      pending: counts.queued + counts.parsing, // for backwards compat
      lastEmail: recentEmails[0] || null,
    };
  },

  /**
   * Get parse progress (for frontend polling)
   */
  async getParseProgress() {
    const recentEmails = await forecastEmailRepository.getRecentEmails(20);
    const queued = recentEmails.filter(e => e.parse_status === 'queued').length;
    const parsing = recentEmails.filter(e => e.parse_status === 'parsing').length;
    const parsed = recentEmails.filter(e => e.parse_status === 'parsed').length;
    const partial = recentEmails.filter(e => e.parse_status === 'partial').length;
    const failed = recentEmails.filter(e => e.parse_status === 'failed').length;

    return {
      inProgress: queued + parsing > 0,
      queued,
      parsing,
      parsed,
      partial,
      failed,
      total: recentEmails.length,
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
   * Clean up old emails using configured retention
   */
  async _cleanup() {
    try {
      const days = config.forecastEmail.retentionDays;
      const deleted = await forecastEmailRepository.deleteOlderThan(days);
      if (deleted > 0) {
        logger.info('Cleaned up old forecast emails', { deleted, retentionDays: days });
      }
    } catch (err) {
      logger.error('Failed to clean up old emails', { error: err.message });
    }
  },
};

export default forecastEmailService;
