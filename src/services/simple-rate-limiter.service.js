/**
 * Simple Rate Limiter Service
 * Phase 1: In-memory rate limiting for API calls
 *
 * This is a simple rate limiter that tracks the last call time for each service
 * and enforces minimum delays between calls to avoid rate limit violations.
 *
 * Phase 2 will replace this with Redis-based distributed rate limiting.
 */

import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('rate-limiter');

export class SimpleRateLimiter {
  constructor() {
    // Track last call time for each service
    this.lastCallTimes = new Map();

    // Track failure counts for monitoring
    this.failures = new Map();

    // Configure delays per service (in milliseconds)
    this.delays = {
      openai: config.openai.delayMs || 1200,  // 1.2 seconds between OpenAI calls
      pinecone: 100,  // 100ms between Pinecone calls
      supabase: 50    // 50ms between Supabase calls
    };

    logger.info('SimpleRateLimiter initialized', {
      delays: this.delays
    });
  }

  /**
   * Wait for rate limit clearance before making an API call
   * @param {string} service - Service name ('openai', 'pinecone', 'supabase')
   * @returns {Promise<void>}
   */
  async waitForTurn(service) {
    const delay = this.delays[service] || 1000;
    const lastCall = this.lastCallTimes.get(service) || 0;
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall < delay) {
      const waitTime = delay - timeSinceLastCall;

      logger.debug(`Rate limiting ${service}`, {
        service,
        waitTime,
        lastCallAgo: timeSinceLastCall
      });

      await this.sleep(waitTime);
    }

    // Update last call time
    this.lastCallTimes.set(service, Date.now());
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Record a failed API call for monitoring
   * @param {string} service - Service name
   * @param {Error} error - The error that occurred
   */
  recordFailure(service, error = null) {
    const count = this.failures.get(service) || 0;
    this.failures.set(service, count + 1);

    logger.warn('API call failed', {
      service,
      totalFailures: count + 1,
      error: error?.message
    });
  }

  /**
   * Record a successful API call
   * @param {string} service - Service name
   */
  recordSuccess(service) {
    // We could track success metrics here if needed
    logger.debug('API call succeeded', { service });
  }

  /**
   * Get failure count for a service
   * @param {string} service - Service name
   * @returns {number}
   */
  getFailureCount(service) {
    return this.failures.get(service) || 0;
  }

  /**
   * Get all failure counts
   * @returns {Object} Map of service -> failure count
   */
  getAllFailureCounts() {
    return Object.fromEntries(this.failures);
  }

  /**
   * Reset failure counts for a service (or all services)
   * @param {string} [service] - Optional service name to reset
   */
  resetFailures(service = null) {
    if (service) {
      this.failures.delete(service);
      logger.info('Reset failure count', { service });
    } else {
      this.failures.clear();
      logger.info('Reset all failure counts');
    }
  }

  /**
   * Get statistics about rate limiting
   * @returns {Object}
   */
  getStats() {
    const stats = {
      services: {},
      totalFailures: 0
    };

    for (const [service, delay] of Object.entries(this.delays)) {
      const lastCall = this.lastCallTimes.get(service);
      const failures = this.failures.get(service) || 0;

      stats.services[service] = {
        delay,
        lastCall: lastCall ? new Date(lastCall).toISOString() : null,
        timeSinceLastCall: lastCall ? Date.now() - lastCall : null,
        failures
      };

      stats.totalFailures += failures;
    }

    return stats;
  }

  /**
   * Check if a service is ready for a call (without waiting)
   * @param {string} service - Service name
   * @returns {boolean}
   */
  isReady(service) {
    const delay = this.delays[service] || 1000;
    const lastCall = this.lastCallTimes.get(service) || 0;
    const timeSinceLastCall = Date.now() - lastCall;

    return timeSinceLastCall >= delay;
  }

  /**
   * Get time until service is ready
   * @param {string} service - Service name
   * @returns {number} Milliseconds until ready (0 if ready now)
   */
  timeUntilReady(service) {
    const delay = this.delays[service] || 1000;
    const lastCall = this.lastCallTimes.get(service) || 0;
    const timeSinceLastCall = Date.now() - lastCall;

    if (timeSinceLastCall >= delay) {
      return 0;
    }

    return delay - timeSinceLastCall;
  }
}

// Export singleton instance
export const rateLimiter = new SimpleRateLimiter();

export default rateLimiter;
