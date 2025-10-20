/**
 * Structured Logging Utility
 * No console.log allowed in the codebase - use this instead
 */

import winston from 'winston';
import { getConfig } from '../config/env.js';

const config = getConfig();

// Custom format for pretty printing in development
const prettyFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;

    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      // Filter out empty objects and undefined values
      const cleanMeta = Object.entries(meta).reduce((acc, [key, value]) => {
        if (value !== undefined && !(typeof value === 'object' && Object.keys(value).length === 0)) {
          acc[key] = value;
        }
        return acc;
      }, {});

      if (Object.keys(cleanMeta).length > 0) {
        log += ` ${JSON.stringify(cleanMeta, null, 2)}`;
      }
    }

    return log;
  })
);

// JSON format for production
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create the logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: config.logging.format === 'json' ? jsonFormat : prettyFormat,
  defaultMeta: {
    service: 'maintenance-agent',
    environment: config.nodeEnv
  },
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
});

// Create specialized loggers for different components
export function createLogger(component) {
  return logger.child({ component });
}

// Agent-specific logging helpers
export const agentLogger = {
  systemProcessed: (systemId, taskCount) => {
    logger.info('System processed', {
      systemId,
      taskCount,
      event: 'system_processed'
    });
  },

  taskQueued: (taskId, systemId, confidence) => {
    logger.info('Task queued for review', {
      taskId,
      systemId,
      confidence,
      event: 'task_queued'
    });
  },

  extractionStarted: (systemId, source) => {
    logger.debug('Extraction started', {
      systemId,
      source,
      event: 'extraction_started'
    });
  },

  extractionCompleted: (systemId, source, taskCount) => {
    logger.info('Extraction completed', {
      systemId,
      source,
      taskCount,
      event: 'extraction_completed'
    });
  },

  error: (message, error, metadata = {}) => {
    logger.error(message, {
      error: error.message,
      stack: error.stack,
      ...metadata,
      event: 'error'
    });
  },

  cronJobScheduled: (jobName, schedule) => {
    logger.info('Cron job scheduled', {
      jobName,
      schedule,
      event: 'cron_scheduled'
    });
  },

  cronJobExecuted: (jobName) => {
    logger.info('Cron job executed', {
      jobName,
      event: 'cron_executed'
    });
  },
};

export default logger;