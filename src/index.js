/**
 * Maintenance Agent - Entry Point
 * Hybrid architecture: HTTP API + Autonomous background jobs
 *
 * Runs both:
 * 1. Express HTTP server (port 3001) - serves APIs from Phase 4
 * 2. Cron-based background jobs - autonomous processing
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './repositories/supabase.repository.js';
import { pineconeRepository } from './repositories/pinecone.repository.js';
import { systemProcessorJob } from './jobs/system-processor.job.js';
import { schedulerJob } from './jobs/scheduler.job.js';
import { getConfig } from './config/env.js';
import logger, { agentLogger } from './utils/logger.js';
import adminRoutes from './routes/admin/index.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
 * Create and configure Express app
 */
function createExpressApp() {
  const app = express();

  // CORS configuration
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  }));

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging
  app.use(requestLogger);

  // Serve static files from public directory
  const publicPath = path.join(__dirname, '..', 'public');
  app.use(express.static(publicPath));
  logger.info('Static files served from:', { publicPath });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      success: true,
      data: {
        status: 'healthy',
        service: 'maintenance-agent',
        mode: 'hybrid',
        components: {
          http_api: 'running',
          cron_jobs: 'running',
        },
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Admin API routes
  app.use('/admin/api', adminRoutes);

  // 404 handler
  app.use(notFoundHandler);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

/**
 * Start HTTP server
 */
function startHttpServer(app) {
  const port = config.port;

  const server = app.listen(port, () => {
    logger.info(`✅ HTTP API server listening on port ${port}`, {
      port,
      environment: config.nodeEnv,
    });
  });

  // Handle server errors
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${port} is already in use`);
    } else {
      logger.error('Server error', { error: error.message });
    }
    process.exit(1);
  });

  return server;
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

  // Create and start HTTP server
  logger.info('Starting HTTP API server...');
  const app = createExpressApp();
  const httpServer = startHttpServer(app);

  // Set up cron jobs
  logger.info('Starting background job scheduler...');
  schedulerJob.setupCronJobs();

  // Run initial check
  logger.info('Running initial system check...');
  await systemProcessorJob.checkForNewSystems();

  logger.info('🤖 Maintenance Agent is running (HTTP + Cron)');
  logger.info('   HTTP API: http://localhost:' + config.port);
  logger.info('   Background jobs: Active');
  logger.info('Press Ctrl+C to stop');

  // Store server reference for graceful shutdown
  global.httpServer = httpServer;
}

/**
 * Graceful shutdown handler
 */
function handleShutdown() {
  logger.info('Shutting down...');

  // Stop HTTP server
  if (global.httpServer) {
    logger.info('Closing HTTP server...');
    global.httpServer.close(() => {
      logger.info('✅ HTTP server closed');
    });
  }

  // Stop scheduled tasks
  logger.info('Stopping background jobs...');
  schedulerJob.stopAll();

  // Give time for cleanup and logs to flush
  setTimeout(() => {
    logger.info('Goodbye! 👋');
    process.exit(0);
  }, 2000);
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