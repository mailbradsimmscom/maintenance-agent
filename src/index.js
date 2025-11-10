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
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import url from 'url';
import db from './repositories/supabase.repository.js';
import { pineconeRepository } from './repositories/pinecone.repository.js';
import { systemProcessorJob } from './jobs/system-processor.job.js';
import { schedulerJob } from './jobs/scheduler.job.js';
import { orchestrator } from './services/pipeline-orchestrator.service.js';
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
 * WebSocket client management
 */
const wsClients = new Map();

/**
 * Create WebSocket server
 */
function createWebSocketServer() {
  const wss = new WebSocketServer({
    noServer: true,
    path: '/api/ws'
  });

  // Handle WebSocket connection
  wss.on('connection', (ws, req) => {
    const clientId = generateClientId();
    ws.clientId = clientId;

    logger.info(`WebSocket client ${clientId} connected`);

    // Store client
    wsClients.set(clientId, {
      ws,
      subscriptions: new Set(),
      connectedAt: new Date(),
      isAlive: true
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connection_established',
      clientId,
      serverTime: new Date().toISOString()
    }));

    // Handle messages from client
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        handleWebSocketMessage(clientId, data);
      } catch (error) {
        logger.error('Invalid WebSocket message:', { error: error.message });
      }
    });

    // Handle pong (heartbeat response)
    ws.on('pong', () => {
      const client = wsClients.get(clientId);
      if (client) client.isAlive = true;
    });

    // Handle disconnect
    ws.on('close', () => {
      logger.info(`WebSocket client ${clientId} disconnected`);
      wsClients.delete(clientId);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket error for ${clientId}:`, { error: error.message });
    });
  });

  return wss;
}

/**
 * Handle WebSocket messages from clients
 */
function handleWebSocketMessage(clientId, data) {
  const client = wsClients.get(clientId);
  if (!client) return;

  switch(data.type) {
    case 'subscribe_run':
      client.subscriptions.add(data.runId);
      logger.debug(`Client ${clientId} subscribed to run ${data.runId}`);
      break;

    case 'unsubscribe_run':
      client.subscriptions.delete(data.runId);
      logger.debug(`Client ${clientId} unsubscribed from run ${data.runId}`);
      break;

    case 'ping':
      client.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    default:
      logger.warn(`Unknown message type from ${clientId}: ${data.type}`);
  }
}

/**
 * Broadcast message to all connected WebSocket clients
 */
function broadcastToWebSockets(data) {
  const message = JSON.stringify(data);
  let sentCount = 0;

  wsClients.forEach((client) => {
    if (client.ws.readyState === 1) { // 1 = OPEN
      client.ws.send(message);
      sentCount++;
    }
  });

  logger.debug(`Broadcast to ${sentCount} WebSocket clients`, { type: data.type });
}

/**
 * Generate unique client ID
 */
function generateClientId() {
  return Math.random().toString(36).substr(2, 9);
}

/**
 * Start heartbeat interval for WebSocket connections
 */
function startWebSocketHeartbeat() {
  setInterval(() => {
    wsClients.forEach((client, id) => {
      if (client.isAlive === false) {
        logger.info(`Terminating inactive WebSocket client ${id}`);
        client.ws.terminate();
        wsClients.delete(id);
        return;
      }
      client.isAlive = false;
      client.ws.ping();
    });
  }, 30000); // Every 30 seconds
}

/**
 * Start HTTP server with WebSocket upgrade support
 */
function startHttpServer(app) {
  const port = config.port;

  // Create HTTP server (needed for WebSocket upgrade)
  const server = createServer(app);

  // Create WebSocket server
  const wss = createWebSocketServer();

  // Handle HTTP upgrade to WebSocket
  server.on('upgrade', async (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;

    if (pathname === '/api/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.clientId = generateClientId();
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // Start listening
  server.listen(port, () => {
    logger.info(`✅ HTTP API server listening on port ${port}`, {
      port,
      environment: config.nodeEnv,
    });
    logger.info(`✅ WebSocket server ready at ws://localhost:${port}/api/ws`);
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

  // Start WebSocket heartbeat
  startWebSocketHeartbeat();

  return server;
}

/**
 * Wire up orchestrator events to WebSocket broadcasts
 */
function setupOrchestratorEvents() {
  // Processing started
  orchestrator.on('processing_started', (data) => {
    logger.info('Broadcasting processing_started', { runId: data.runId });
    broadcastToWebSockets({ type: 'processing_started', ...data });
  });

  // Step started
  orchestrator.on('step_started', (data) => {
    logger.debug('Broadcasting step_started', { runId: data.runId, step: data.step });
    broadcastToWebSockets({ type: 'step_started', ...data });
  });

  // Progress update
  orchestrator.on('progress', (data) => {
    logger.debug('Broadcasting progress_update', { runId: data.runId, step: data.step });
    broadcastToWebSockets({ type: 'progress_update', ...data });
  });

  // Step completed
  orchestrator.on('step_completed', (data) => {
    logger.info('Broadcasting step_completed', { runId: data.runId, step: data.step });
    broadcastToWebSockets({ type: 'step_completed', ...data });
  });

  // Step failed
  orchestrator.on('step_failed', (data) => {
    logger.warn('Broadcasting step_failed', { runId: data.runId, step: data.step });
    broadcastToWebSockets({ type: 'step_failed', ...data });
  });

  // Manual review required
  orchestrator.on('manual_review_required', (data) => {
    logger.info('Broadcasting manual_review_required', { runId: data.runId });
    broadcastToWebSockets({ type: 'manual_review_required', ...data });
  });

  // Processing complete
  orchestrator.on('processing_complete', (data) => {
    logger.info('Broadcasting processing_complete', { runId: data.runId });
    broadcastToWebSockets({ type: 'processing_complete', ...data });
  });

  // Processing failed
  orchestrator.on('processing_failed', (data) => {
    logger.error('Broadcasting processing_failed', { runId: data.runId });
    broadcastToWebSockets({ type: 'error', ...data });
  });

  // Processing cancelled
  orchestrator.on('processing_cancelled', (data) => {
    logger.info('Broadcasting processing_cancelled', { runId: data.runId });
    broadcastToWebSockets({ type: 'processing_cancelled', ...data });
  });

  logger.info('Orchestrator events wired to WebSocket broadcasts');
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

  // Wire up orchestrator events to WebSocket
  logger.info('Connecting orchestrator to WebSocket...');
  setupOrchestratorEvents();

  // Set up cron jobs
  logger.info('Starting background job scheduler...');
  schedulerJob.setupCronJobs();

  // Run initial check (disabled for Phase 1 - causes errors with old tables)
  // logger.info('Running initial system check...');
  // await systemProcessorJob.checkForNewSystems();

  logger.info('🤖 Maintenance Agent is running (HTTP + Cron + Pipeline)');
  logger.info('   HTTP API: http://localhost:' + config.port);
  logger.info('   WebSocket: ws://localhost:' + config.port + '/api/ws');
  logger.info('   Background jobs: Active');
  logger.info('   Pipeline orchestrator: Ready');
  logger.info('Press Ctrl+C to stop');

  // Store server reference for graceful shutdown
  global.httpServer = httpServer;
}

/**
 * Graceful shutdown handler
 */
function handleShutdown() {
  logger.info('Shutting down...');

  // Close all WebSocket connections
  logger.info('Closing WebSocket connections...');
  wsClients.forEach((client, id) => {
    client.ws.close(1000, 'Server shutting down');
  });
  wsClients.clear();

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

// Export WebSocket broadcast function for use by services
export { broadcastToWebSockets };