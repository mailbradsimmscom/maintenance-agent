/**
 * Request Logger Middleware
 * Logs incoming HTTP requests with timing information
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('http');

/**
 * Request logging middleware
 * Logs request method, path, and response time
 */
export function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Capture original end function
  const originalEnd = res.end;

  // Override end to log after response is sent
  res.end = function (...args) {
    const duration = Date.now() - startTime;

    // Log request details
    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    // Call original end
    originalEnd.apply(res, args);
  };

  next();
}

/**
 * Body logging middleware (for debugging)
 * Only use in development - logs request/response bodies
 */
export function bodyLogger(req, res, next) {
  if (process.env.NODE_ENV !== 'development') {
    return next();
  }

  // Log request body if present
  if (req.body && Object.keys(req.body).length > 0) {
    logger.debug('Request body', {
      path: req.path,
      body: req.body,
    });
  }

  next();
}
