/**
 * Weather Credits Service
 * Manages Meteoblue API credit tracking and alerts
 */

import { weatherRepository } from '../repositories/weather.repository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('weather-credits-service');

export const weatherCreditsService = {
  /**
   * Check if we can fetch from an API (has remaining credits)
   * @param {string} apiName - e.g. 'meteoblue'
   * @returns {Promise<boolean>} True if credits available
   */
  async canFetch(apiName) {
    try {
      const credits = await weatherRepository.getCredits(apiName);
      if (!credits) {
        logger.warn('No credit record found', { apiName });
        return false;
      }
      return credits.credits_remaining > 0;
    } catch (error) {
      logger.error('Failed to check credits', { apiName, error: error.message });
      return false;
    }
  },

  /**
   * Record credit usage after a successful API call
   * @param {string} apiName - e.g. 'meteoblue'
   * @param {number} creditsUsed - Number of credits consumed
   */
  async recordUsage(apiName, creditsUsed) {
    try {
      await weatherRepository.updateCredits(apiName, creditsUsed);

      // Check for low credit alert
      const credits = await weatherRepository.getCredits(apiName);
      if (credits && credits.credits_remaining < credits.low_credit_threshold) {
        logger.warn('Low credits alert', {
          api: apiName,
          remaining: credits.credits_remaining,
          threshold: credits.low_credit_threshold
        });
      }
    } catch (error) {
      logger.error('Failed to record credit usage', { apiName, creditsUsed, error: error.message });
    }
  },

  /**
   * Get current credit status for an API
   * @param {string} apiName - e.g. 'meteoblue'
   * @returns {Promise<Object|null>} Credit status or null
   */
  async getStatus(apiName) {
    try {
      return await weatherRepository.getCredits(apiName);
    } catch (error) {
      logger.error('Failed to get credit status', { apiName, error: error.message });
      return null;
    }
  },

  /**
   * Reset credit totals (e.g. for monthly reset)
   * @param {string} apiName - e.g. 'meteoblue'
   * @param {number} newTotal - New credit total
   */
  async resetCredits(apiName, newTotal) {
    try {
      // This would need a new repository method
      // For now, log and skip
      logger.info('Credit reset requested', { apiName, newTotal });
    } catch (error) {
      logger.error('Failed to reset credits', { apiName, error: error.message });
    }
  }
};

export default weatherCreditsService;
