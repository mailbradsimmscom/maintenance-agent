/**
 * Error Handler Middleware
 * Catches and formats errors in Express routes
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('error-handler');

/**
 * Express error handling middleware
 * Must have 4 parameters for Express to recognize it as error handler
 */
export function errorHandler(err, req, res, next) {
  // Log the error
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
  });

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Determine error code
  const errorCode = err.code || 'INTERNAL_SERVER_ERROR';

  // Send error response in envelope format
  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: err.message || 'An unexpected error occurred',
      ...(process.env.NODE_ENV === 'development' && {
        stack: err.stack,
        details: err.details,
      }),
    },
  });
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.path}`,
    },
  });
}

/**
 * Async route wrapper to catch errors
 * Wraps async route handlers to automatically catch errors
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => {
 *     const data = await someAsyncOperation();
 *     res.json({ success: true, data });
 *   }));
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
