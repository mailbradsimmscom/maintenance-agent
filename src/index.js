/**
 * Maintenance Agent - Entry Point
 * Autonomous maintenance discovery agent for marine systems
 */

import db from './repositories/supabase.repository.js';
import { pineconeRepository } from './repositories/pinecone.repository.js';
import { systemProcessorJob } from './jobs/system-processor.job.js';
import { schedulerJob } from './jobs/scheduler.job.js';
import { getConfig } from './config/env.js';
import logger, { agentLogger } from './utils/logger.js';

const config = getConfig();

/**
 * Test database connections
 * @returns {Promise<boolean>} True if all connections successful
 */
async function testConnections() {
  logger.info('Testing connections...');

  // Test Supabase
  try {
    const systems = await db.systems.getUnprocessedSystems(1);
    logger.info('✅ Supabase connected', { systemCount: systems.length });
  } catch (error) {
    logger.error('❌ Supabase connection failed', { error: error.message });
    return false;
  }

  // Test Pinecone
  try {
    await pineconeRepository.healthCheck();
    logger.info('✅ Pinecone connected');
  } catch (error) {
    logger.warn('⚠️ Pinecone connection failed - running without vector search', { error: error.message });
    // Continue without Pinecone for now - manual extraction will be limited
  }

  return true;
}

/**
 * Main startup function
 */
async function start() {
  logger.info('🚀 Maintenance Agent starting...', {
    environment: config.nodeEnv,
    version: '1.0.0',
  });

  // Display configuration
  logger.info('Configuration:', {
    runInterval: `${config.agent.runIntervalMinutes} minutes`,
    batchSize: config.agent.batchSize,
    confidenceThreshold: config.agent.confidenceThreshold,
    features: {
      realWorldSearch: config.features.realWorldSearch,
      dependencyInference: config.features.dependencyInference,
      autoLearning: config.features.autoLearning,
    },
  });

  // Test connections
  const connectionsOk = await testConnections();
  if (!connectionsOk) {
    logger.error('Failed to establish required connections');
    process.exit(1);
  }

  // Set up cron jobs
  schedulerJob.setupCronJobs();

  // Run initial check
  logger.info('Running initial system check...');
  await systemProcessorJob.checkForNewSystems();

  logger.info('🤖 Maintenance Agent is running');
  logger.info('Press Ctrl+C to stop');
}

/**
 * Graceful shutdown handler
 */
function handleShutdown() {
  logger.info('Shutting down...');

  // Stop scheduled tasks
  schedulerJob.stopAll();

  // Give time for logs to flush
  setTimeout(() => {
    logger.info('Goodbye! 👋');
    process.exit(0);
  }, 1000);
}

// Register shutdown handlers
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', {
    reason,
    promise,
  });
  process.exit(1);
});

// Start the agent
start().catch(error => {
  logger.error('Failed to start agent', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});