/**
 * Rate Limiter Utility
 * Prevents API rate limit violations
 */

import { createLogger } from './logger.js';

const logger = createLogger('rate-limiter');

export class RateLimiter {
  constructor(options = {}) {
    this.requestsPerMinute = options.requestsPerMinute || 60;
    this.requestsPerDay = options.requestsPerDay || 1000;
    this.name = options.name || 'default';

    // Track requests
    this.minuteWindow = [];
    this.dayWindow = [];

    // Circuit breaker
    this.consecutiveFailures = 0;
    this.circuitBreakerThreshold = options.circuitBreakerThreshold || 5;
    this.circuitBreakerTimeout = options.circuitBreakerTimeout || 5 * 60 * 1000; // 5 minutes
    this.circuitBreakerResetTime = null;
  }

  /**
   * Check if we can make a request
   * @returns {Promise<boolean>} True if request allowed
   */
  async canMakeRequest() {
    // Check circuit breaker
    if (this.isCircuitOpen()) {
      logger.warn('Circuit breaker is open', {
        name: this.name,
        resetTime: this.circuitBreakerResetTime
      });
      return false;
    }

    // Clean old entries
    this.cleanWindows();

    // Check rate limits
    if (this.minuteWindow.length >= this.requestsPerMinute) {
      logger.warn('Minute rate limit reached', {
        name: this.name,
        limit: this.requestsPerMinute
      });
      return false;
    }

    if (this.dayWindow.length >= this.requestsPerDay) {
      logger.warn('Daily rate limit reached', {
        name: this.name,
        limit: this.requestsPerDay
      });
      return false;
    }

    return true;
  }

  /**
   * Record a successful request
   */
  recordSuccess() {
    const now = Date.now();
    this.minuteWindow.push(now);
    this.dayWindow.push(now);
    this.consecutiveFailures = 0; // Reset failure count

    logger.debug('Request recorded', {
      name: this.name,
      minuteCount: this.minuteWindow.length,
      dayCount: this.dayWindow.length
    });
  }

  /**
   * Record a failed request
   */
  recordFailure() {
    this.consecutiveFailures++;

    if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
      this.circuitBreakerResetTime = Date.now() + this.circuitBreakerTimeout;
      logger.error('Circuit breaker triggered', {
        name: this.name,
        failures: this.consecutiveFailures,
        resetTime: new Date(this.circuitBreakerResetTime)
      });
    }
  }

  /**
   * Check if circuit breaker is open
   * @returns {boolean} True if circuit is open (blocking requests)
   */
  isCircuitOpen() {
    if (!this.circuitBreakerResetTime) {
      return false;
    }

    if (Date.now() >= this.circuitBreakerResetTime) {
      // Reset circuit breaker
      this.circuitBreakerResetTime = null;
      this.consecutiveFailures = 0;
      logger.info('Circuit breaker reset', { name: this.name });
      return false;
    }

    return true;
  }

  /**
   * Clean old entries from tracking windows
   */
  cleanWindows() {
    const now = Date.now();
    const minuteAgo = now - 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    this.minuteWindow = this.minuteWindow.filter(time => time > minuteAgo);
    this.dayWindow = this.dayWindow.filter(time => time > dayAgo);
  }

  /**
   * Get current usage stats
   * @returns {Object} Usage statistics
   */
  getStats() {
    this.cleanWindows();

    return {
      name: this.name,
      minuteUsage: this.minuteWindow.length,
      minuteLimit: this.requestsPerMinute,
      minuteRemaining: Math.max(0, this.requestsPerMinute - this.minuteWindow.length),
      dayUsage: this.dayWindow.length,
      dayLimit: this.requestsPerDay,
      dayRemaining: Math.max(0, this.requestsPerDay - this.dayWindow.length),
      circuitOpen: this.isCircuitOpen(),
      consecutiveFailures: this.consecutiveFailures
    };
  }

  /**
   * Wait until we can make a request
   * @returns {Promise<void>}
   */
  async waitForSlot() {
    while (!(await this.canMakeRequest())) {
      // Wait 1 second and try again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Pre-configured rate limiters for different services
export const rateLimiters = {
  openai: new RateLimiter({
    name: 'openai',
    requestsPerMinute: 50,
    requestsPerDay: 1000,
    circuitBreakerThreshold: 5
  }),

  pinecone: new RateLimiter({
    name: 'pinecone',
    requestsPerMinute: 100,
    requestsPerDay: 10000,
    circuitBreakerThreshold: 10
  }),

  webSearch: new RateLimiter({
    name: 'web-search',
    requestsPerMinute: 10,
    requestsPerDay: 500,
    circuitBreakerThreshold: 3
  })
};

export default RateLimiter;