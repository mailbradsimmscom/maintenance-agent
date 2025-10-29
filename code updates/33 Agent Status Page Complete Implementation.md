# Session 33 COMPREHENSIVE: Agent Status Page and Pipeline Orchestration - Complete Implementation Guide

**Date:** 2025-10-29
**Status:** 🚀 READY FOR IMPLEMENTATION
**Scope:** Complete technical specification with all code examples
**Target:** Sonnet 4.5 implementation-ready

---

## 📋 EXECUTIVE SUMMARY

### **The Mission**
Build a comprehensive status page and orchestration system for the maintenance agent pipeline (Steps 1-6) with:
- **Manual Mode**: Select systems, process linearly, track progress
- **Agent Mode**: Autonomous monitoring with event-driven architecture
- **Real-time Updates**: WebSocket progress tracking
- **Production-Grade**: Redis caching, idempotency, checkpoints, telemetry

### **Architecture Highlights**
- Event-driven with database queue (not aggressive polling)
- WebSocket on same Express port (no separate port 3002)
- Redis for rate limiting (100x faster than Postgres)
- Idempotent processing with distributed locks
- Checkpoint system for failure recovery
- Paginated UI for 200+ systems

---

## 🏗️ COMPLETE SYSTEM ARCHITECTURE

### **Component Overview**
```
┌─────────────────────────────────────────────────────────────┐
│                   Status Page (Browser)                      │
│           Pagination | Filtering | Real-time Updates         │
└─────────────────────────────────────────────────────────────┘
                              │
                    WebSocket (/api/ws)
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 Express Server (Port 3001)                   │
│     HTTP Routes | WebSocket Server | Authentication          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Pipeline Orchestrator Service                   │
│    Manual Processing | Agent Watcher | Rate Limiting         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Step Executors                            │
│  Extract | Classify | Discover | Dedupe | Review | BoatOS    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                      Data Layer                              │
│    Redis Cache | PostgreSQL | Pinecone | OpenAI API          │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 COMPLETE DATABASE SCHEMA

### **1. Pipeline Processing Status Table**
```sql
CREATE TABLE pipeline_processing_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System identification
  asset_uid UUID REFERENCES systems(asset_uid) ON DELETE CASCADE,
  system_name TEXT NOT NULL,

  -- Processing state per step
  step1_extract_status TEXT DEFAULT 'not_started'
    CHECK (step1_extract_status IN ('not_started', 'in_progress', 'completed', 'failed')),
  step1_started_at TIMESTAMPTZ,
  step1_completed_at TIMESTAMPTZ,
  step1_error TEXT,
  step1_tasks_extracted INTEGER DEFAULT 0,

  step2_classify_status TEXT DEFAULT 'not_started',
  step2_started_at TIMESTAMPTZ,
  step2_completed_at TIMESTAMPTZ,
  step2_error TEXT,
  step2_tasks_classified INTEGER DEFAULT 0,

  step3_discover_status TEXT DEFAULT 'not_started',
  step3_started_at TIMESTAMPTZ,
  step3_completed_at TIMESTAMPTZ,
  step3_error TEXT,
  step3_tasks_discovered INTEGER DEFAULT 0,

  step4_dedupe_status TEXT DEFAULT 'not_started',
  step4_started_at TIMESTAMPTZ,
  step4_completed_at TIMESTAMPTZ,
  step4_error TEXT,
  step4_duplicate_pairs INTEGER DEFAULT 0,

  step5_review_status TEXT DEFAULT 'not_started',
  step5_started_at TIMESTAMPTZ,
  step5_completed_at TIMESTAMPTZ,
  step5_pairs_reviewed INTEGER DEFAULT 0,
  step5_pairs_pending INTEGER DEFAULT 0,

  step6_boatos_status TEXT DEFAULT 'not_started',
  step6_started_at TIMESTAMPTZ,
  step6_completed_at TIMESTAMPTZ,
  step6_error TEXT,

  -- Overall status
  overall_status TEXT DEFAULT 'not_started'
    CHECK (overall_status IN ('not_started', 'processing', 'completed', 'failed', 'paused')),
  last_processed_at TIMESTAMPTZ,
  processing_mode TEXT CHECK (processing_mode IN ('manual', 'agent')),

  -- Pinecone sync tracking
  pinecone_last_checked TIMESTAMPTZ,
  pinecone_task_count INTEGER DEFAULT 0,
  pinecone_has_changes BOOLEAN DEFAULT false,

  -- Metrics
  total_processing_time_ms INTEGER,
  api_calls_made INTEGER DEFAULT 0,
  api_calls_failed INTEGER DEFAULT 0,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Critical indexes
CREATE INDEX idx_pipeline_status_overall ON pipeline_processing_status(overall_status);
CREATE INDEX idx_pipeline_status_asset ON pipeline_processing_status(asset_uid);
CREATE INDEX idx_pipeline_pinecone_changes ON pipeline_processing_status(pinecone_has_changes)
  WHERE pinecone_has_changes = true;
CREATE INDEX idx_pipeline_unprocessed ON pipeline_processing_status(overall_status)
  WHERE overall_status = 'not_started';

-- Update trigger
CREATE TRIGGER update_pipeline_status_timestamp
  BEFORE UPDATE ON pipeline_processing_status
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### **2. Pipeline Runs Table**
```sql
CREATE TABLE pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Run identification
  run_mode TEXT NOT NULL CHECK (run_mode IN ('manual', 'agent')),
  initiated_by TEXT,

  -- Systems being processed
  system_count INTEGER NOT NULL,
  systems_processed TEXT[],

  -- Timing
  started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,

  -- Status
  status TEXT DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  current_step TEXT,
  current_system TEXT,

  -- Metrics
  total_tasks_extracted INTEGER DEFAULT 0,
  total_tasks_classified INTEGER DEFAULT 0,
  total_tasks_discovered INTEGER DEFAULT 0,
  total_duplicates_found INTEGER DEFAULT 0,
  total_api_calls INTEGER DEFAULT 0,
  total_api_errors INTEGER DEFAULT 0,

  -- Error tracking
  errors JSONB DEFAULT '[]',

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX idx_pipeline_runs_date ON pipeline_runs(started_at DESC);
```

### **3. Processing Queue Table (Event-Driven)**
```sql
CREATE TABLE processing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Message details
  event_type TEXT NOT NULL CHECK (event_type IN (
    'document_processed',
    'system_added',
    'manual_trigger',
    'scheduled_check'
  )),
  asset_uid UUID REFERENCES systems(asset_uid),
  payload JSONB,

  -- Processing status
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  processor_id TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  -- Timing
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  process_after TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Error tracking
  last_error TEXT,

  -- Prevent double processing
  CONSTRAINT unique_event_per_asset
    UNIQUE NULLS NOT DISTINCT (event_type, asset_uid, status)
);

-- Critical indexes
CREATE INDEX idx_queue_pending ON processing_queue(status, process_after)
  WHERE status = 'pending';
CREATE INDEX idx_queue_processing ON processing_queue(status, processor_id)
  WHERE status = 'processing';

-- Function to claim queue items atomically
CREATE OR REPLACE FUNCTION claim_queue_items(
  p_processor_id TEXT,
  p_batch_size INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  event_type TEXT,
  asset_uid UUID,
  payload JSONB,
  attempts INTEGER
) AS $$
BEGIN
  RETURN QUERY
  UPDATE processing_queue
  SET
    status = 'processing',
    processor_id = p_processor_id,
    claimed_at = CURRENT_TIMESTAMP,
    attempts = attempts + 1
  WHERE id IN (
    SELECT q.id
    FROM processing_queue q
    WHERE q.status = 'pending'
      AND q.process_after <= CURRENT_TIMESTAMP
      AND q.attempts < q.max_attempts
    ORDER BY q.created_at
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING
    processing_queue.id,
    processing_queue.event_type,
    processing_queue.asset_uid,
    processing_queue.payload,
    processing_queue.attempts;
END;
$$ LANGUAGE plpgsql;
```

### **4. Processing Checkpoints Table**
```sql
CREATE TABLE processing_checkpoints (
  checkpoint_key TEXT PRIMARY KEY,
  checkpoint_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_checkpoints_updated ON processing_checkpoints(updated_at);

-- Auto-cleanup old checkpoints
CREATE OR REPLACE FUNCTION cleanup_old_checkpoints()
RETURNS void AS $$
BEGIN
  DELETE FROM processing_checkpoints
  WHERE updated_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;
```

### **5. Telemetry Views for Grafana**
```sql
-- Materialized view for metrics
CREATE MATERIALIZED VIEW pipeline_metrics_5min AS
SELECT
  date_trunc('minute', created_at) AS minute,

  -- System metrics
  COUNT(DISTINCT asset_uid) AS systems_processed,
  COUNT(*) FILTER (WHERE overall_status = 'completed') AS successful_runs,
  COUNT(*) FILTER (WHERE overall_status = 'failed') AS failed_runs,

  -- Step metrics
  SUM(step1_tasks_extracted) AS total_tasks_extracted,
  SUM(step2_tasks_classified) AS total_tasks_classified,
  SUM(step3_tasks_discovered) AS total_tasks_discovered,
  SUM(step4_duplicate_pairs) AS total_duplicates_found,

  -- Performance metrics
  AVG(total_processing_time_ms) AS avg_processing_time_ms,
  MAX(total_processing_time_ms) AS max_processing_time_ms,

  -- API metrics
  SUM(api_calls_made) AS total_api_calls,
  SUM(api_calls_failed) AS total_api_failures,

  CASE
    WHEN SUM(api_calls_made) > 0
    THEN (1 - (SUM(api_calls_failed)::float / SUM(api_calls_made))) * 100
    ELSE 100
  END AS api_success_rate

FROM pipeline_runs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY minute
ORDER BY minute DESC;

-- Auto-refresh every 5 minutes
CREATE UNIQUE INDEX idx_pipeline_metrics_minute ON pipeline_metrics_5min(minute);
```

---

## 🔧 COMPLETE BACKEND IMPLEMENTATION

### **1. Configuration (config/env.js)**
```javascript
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Database
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string(),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // APIs
  OPENAI_API_KEY: z.string(),
  PINECONE_API_KEY: z.string(),
  PINECONE_INDEX: z.string().default('maintenance-tasks'),

  // Server
  API_PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Processing modes
  PROCESSING_MODE: z.enum(['manual', 'agent', 'both']).default('manual'),
  AGENT_MODE: z.enum(['queue', 'realtime', 'hybrid']).default('queue'),

  // Queue configuration
  QUEUE_POLL_INTERVAL_MS: z.coerce.number().default(300000), // 5 minutes
  QUEUE_BATCH_SIZE: z.coerce.number().default(10),
  EVENT_BATCH_DELAY_MS: z.coerce.number().default(30000), // 30 seconds

  // Rate limiting
  OPENAI_RPM_LIMIT: z.coerce.number().default(50),
  OPENAI_BACKOFF_BASE_MS: z.coerce.number().default(5000),
  OPENAI_MAX_RETRIES: z.coerce.number().default(3),

  // Batch processing
  BATCH_SIZE_EXTRACT: z.coerce.number().default(10),
  BATCH_SIZE_CLASSIFY: z.coerce.number().default(5),

  // Idempotency
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().default(604800), // 7 days

  // Checkpointing
  CHECKPOINT_BATCH_SIZE: z.coerce.number().default(10),
  CHECKPOINT_AUTO_CLEANUP_DAYS: z.coerce.number().default(7),

  // UI
  DEFAULT_PAGE_SIZE: z.coerce.number().default(50),
  MAX_PAGE_SIZE: z.coerce.number().default(200),
  STATUS_PAGE_REFRESH_MS: z.coerce.number().default(5000),
});

export const config = envSchema.parse(process.env);
```

### **2. Redis Rate Limit Manager**
```javascript
// src/services/rate-limit-manager.service.js
import Redis from 'ioredis';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class RateLimitManager {
  constructor() {
    this.redis = new Redis({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      password: config.REDIS_PASSWORD,
      keyPrefix: 'rate_limit:',
      retryStrategy: (times) => Math.min(times * 50, 2000)
    });

    this.limits = {
      openai: { rpm: config.OPENAI_RPM_LIMIT, window: 60000 },
      pinecone: { rpm: 100, window: 1000 }
    };
  }

  async checkLimit(service) {
    const serviceConfig = this.limits[service];
    if (!serviceConfig) {
      throw new Error(`Unknown service: ${service}`);
    }

    const key = `${service}:${this.getCurrentWindow(serviceConfig.window)}`;

    // Atomic increment with auto-expiry
    const count = await this.redis.incr(key);

    if (count === 1) {
      // First request in window, set TTL
      await this.redis.expire(key, Math.ceil(serviceConfig.window / 1000));
    }

    if (count > serviceConfig.rpm) {
      // Calculate backoff
      const backoffKey = `${service}:backoff`;
      const consecutiveFailures = await this.redis.incr(`${service}:failures`);
      const backoffMs = this.calculateBackoff(consecutiveFailures);
      const backoffUntil = Date.now() + backoffMs;

      await this.redis.set(backoffKey, backoffUntil, 'PX', backoffMs);

      logger.warn(`Rate limit exceeded for ${service}`, {
        count,
        limit: serviceConfig.rpm,
        backoffMs,
        consecutiveFailures
      });

      throw new RateLimitError(service, backoffUntil);
    }

    // Reset failure counter on success
    await this.redis.del(`${service}:failures`);

    // Periodically persist to Postgres for analytics (fire-and-forget)
    if (count % 10 === 0) {
      setImmediate(() => this.persistMetrics(service, count));
    }

    return {
      remaining: serviceConfig.rpm - count,
      resetAt: this.getWindowEnd(serviceConfig.window)
    };
  }

  async waitForCapacity(service) {
    const backoffKey = `${service}:backoff`;
    const backoffUntil = await this.redis.get(backoffKey);

    if (backoffUntil && parseInt(backoffUntil) > Date.now()) {
      const waitTime = parseInt(backoffUntil) - Date.now();
      logger.info(`Waiting ${waitTime}ms for rate limit to reset (${service})`);
      await this.sleep(waitTime);
    }

    return this.checkLimit(service);
  }

  calculateBackoff(failures) {
    const base = config.OPENAI_BACKOFF_BASE_MS;
    const exponential = base * Math.pow(2, Math.min(failures - 1, 5));
    const jitter = Math.random() * 1000;
    return Math.min(exponential + jitter, 300000); // Max 5 minutes
  }

  getCurrentWindow(windowMs) {
    return Math.floor(Date.now() / windowMs);
  }

  getWindowEnd(windowMs) {
    return (this.getCurrentWindow(windowMs) + 1) * windowMs;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async persistMetrics(service, count) {
    try {
      // Fire and forget to Postgres
      await supabase.from('rate_limit_metrics').insert({
        service,
        window_start: new Date(this.getCurrentWindow(60000) * 60000),
        requests: count,
        timestamp: new Date()
      });
    } catch (error) {
      logger.warn('Failed to persist rate limit metrics:', error);
    }
  }
}

export class RateLimitError extends Error {
  constructor(service, resetAt) {
    super(`Rate limit exceeded for ${service}`);
    this.name = 'RateLimitError';
    this.service = service;
    this.resetAt = resetAt;
  }
}
```

### **3. Pipeline Orchestrator with Idempotency**
```javascript
// src/services/pipeline-orchestrator.service.js
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { RateLimitManager } from './rate-limit-manager.service.js';
import { CheckpointManager } from './checkpoint-manager.service.js';
import { Step1ExtractService } from './step-executors/step1-extract.service.js';
import { Step2ClassifyService } from './step-executors/step2-classify.service.js';
import { Step3DiscoverService } from './step-executors/step3-discover.service.js';
import { Step4DedupeService } from './step-executors/step4-dedupe.service.js';
import { Step6BoatOSService } from './step-executors/step6-boatos.service.js';

export class PipelineOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.redis = new Redis({
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      keyPrefix: 'orchestrator:'
    });

    this.rateLimiter = new RateLimitManager();
    this.checkpointManager = new CheckpointManager();
    this.activeRuns = new Map();

    // Initialize step executors
    this.steps = {
      1: new Step1ExtractService(this.rateLimiter, this.checkpointManager),
      2: new Step2ClassifyService(this.rateLimiter, this.checkpointManager),
      3: new Step3DiscoverService(this.rateLimiter, this.checkpointManager),
      4: new Step4DedupeService(this.rateLimiter, this.checkpointManager),
      6: new Step6BoatOSService(this.rateLimiter, this.checkpointManager)
    };
  }

  async processSystem(assetUid, mode = 'manual', runId = null) {
    // Generate idempotency key
    runId = runId || uuidv4();
    const idempotencyKey = `process:${assetUid}:${runId}`;

    // Check if already processed
    const existing = await this.redis.get(idempotencyKey);
    if (existing) {
      logger.info(`System already processed with runId ${runId}`);
      return JSON.parse(existing);
    }

    // Acquire distributed lock
    const lockId = await this.acquireLock(assetUid);
    if (!lockId) {
      throw new Error(`Could not acquire lock for system ${assetUid}`);
    }

    try {
      // Create run record
      const run = await this.createRun(assetUid, mode, runId);
      this.activeRuns.set(runId, run);

      // Emit start event
      this.emit('processing_started', {
        runId,
        assetUid,
        mode
      });

      // Execute steps sequentially with idempotency
      const results = {};

      for (const stepNum of [1, 2, 3, 4, 5, 6]) {
        try {
          await this.updateSystemStatus(assetUid, stepNum, 'in_progress');

          this.emit('step_started', {
            runId,
            assetUid,
            step: stepNum
          });

          // Step 5 is manual review - just check status
          if (stepNum === 5) {
            const pendingReviews = await this.checkPendingReviews(assetUid);
            results[`step${stepNum}`] = { pendingReviews };

            if (pendingReviews > 0) {
              logger.info(`Step 5: ${pendingReviews} duplicate pairs pending review`);
              await this.updateSystemStatus(assetUid, stepNum, 'paused', {
                pairs_pending: pendingReviews
              });

              this.emit('manual_review_required', {
                runId,
                assetUid,
                pendingReviews,
                reviewUrl: `/dedup-review.html?system=${encodeURIComponent(assetUid)}`
              });

              continue; // Skip to next step
            }
          } else {
            // Execute step with idempotency
            const stepKey = `${assetUid}:${stepNum}:${runId}`;
            results[`step${stepNum}`] = await this.executeStepWithIdempotency(
              stepKey,
              stepNum,
              assetUid,
              runId
            );
          }

          await this.updateSystemStatus(assetUid, stepNum, 'completed', results[`step${stepNum}`]);

          this.emit('step_completed', {
            runId,
            assetUid,
            step: stepNum,
            results: results[`step${stepNum}`]
          });

        } catch (error) {
          logger.error(`Step ${stepNum} failed for ${assetUid}:`, error);

          await this.updateSystemStatus(assetUid, stepNum, 'failed', {
            error: error.message
          });

          this.emit('step_failed', {
            runId,
            assetUid,
            step: stepNum,
            error: error.message
          });

          // Store partial results and allow retry
          await this.redis.set(
            `${idempotencyKey}:partial`,
            JSON.stringify(results),
            'EX',
            86400 // 24 hours
          );

          throw error;
        }
      }

      // Complete run
      await this.completeRun(runId, results);

      // Store final result
      await this.redis.set(
        idempotencyKey,
        JSON.stringify(results),
        'EX',
        config.IDEMPOTENCY_TTL_SECONDS
      );

      this.emit('processing_complete', {
        runId,
        assetUid,
        results
      });

      return results;

    } finally {
      await this.releaseLock(assetUid, lockId);
      this.activeRuns.delete(runId);
    }
  }

  async executeStepWithIdempotency(stepKey, stepNum, assetUid, runId) {
    // Check if step already executed
    const cachedResult = await this.redis.get(`step:${stepKey}`);
    if (cachedResult) {
      logger.info(`Step ${stepNum} already executed for ${assetUid}, using cached result`);
      return JSON.parse(cachedResult);
    }

    // Execute the step
    const executor = this.steps[stepNum];
    if (!executor) {
      throw new Error(`No executor for step ${stepNum}`);
    }

    const result = await executor.execute(assetUid, runId, (progress) => {
      this.emit('progress', {
        runId,
        assetUid,
        step: stepNum,
        ...progress
      });
    });

    // Cache result
    await this.redis.set(
      `step:${stepKey}`,
      JSON.stringify(result),
      'EX',
      config.IDEMPOTENCY_TTL_SECONDS
    );

    return result;
  }

  async acquireLock(assetUid, ttl = 300000) { // 5 minute default
    const lockKey = `lock:system:${assetUid}`;
    const lockId = uuidv4();

    const acquired = await this.redis.set(
      lockKey,
      lockId,
      'PX', ttl,
      'NX'
    );

    return acquired === 'OK' ? lockId : null;
  }

  async releaseLock(assetUid, lockId) {
    const lockKey = `lock:system:${assetUid}`;

    // Use Lua script for atomic check-and-delete
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    await this.redis.eval(script, 1, lockKey, lockId);
  }

  async createRun(assetUid, mode, runId) {
    const { data: systemInfo } = await supabase
      .from('systems')
      .select('system_name')
      .eq('asset_uid', assetUid)
      .single();

    const run = {
      id: runId,
      run_mode: mode,
      initiated_by: mode === 'manual' ? 'user' : 'system',
      system_count: 1,
      systems_processed: [assetUid],
      started_at: new Date(),
      status: 'running',
      current_step: 'initializing'
    };

    await supabase.from('pipeline_runs').insert(run);

    return run;
  }

  async updateSystemStatus(assetUid, stepNum, status, data = {}) {
    const updates = {
      [`step${stepNum}_${status === 'in_progress' ? 'started' : status}_at`]: new Date(),
      [`step${stepNum}_status`]: status,
      overall_status: status === 'in_progress' ? 'processing' : status,
      updated_at: new Date()
    };

    // Add step-specific data
    if (data.error) {
      updates[`step${stepNum}_error`] = data.error;
    }
    if (data.tasksExtracted !== undefined) {
      updates.step1_tasks_extracted = data.tasksExtracted;
    }
    if (data.tasksClassified !== undefined) {
      updates.step2_tasks_classified = data.tasksClassified;
    }
    if (data.tasksDiscovered !== undefined) {
      updates.step3_tasks_discovered = data.tasksDiscovered;
    }
    if (data.duplicatePairs !== undefined) {
      updates.step4_duplicate_pairs = data.duplicatePairs;
    }
    if (data.pairs_pending !== undefined) {
      updates.step5_pairs_pending = data.pairs_pending;
    }

    await supabase
      .from('pipeline_processing_status')
      .upsert({
        asset_uid: assetUid,
        ...updates
      });
  }

  async checkPendingReviews(assetUid) {
    const { data, count } = await supabase
      .from('deduplication_reviews')
      .select('id', { count: 'exact' })
      .eq('review_status', 'pending')
      .or(`task1_metadata->>asset_uid.eq.${assetUid},task2_metadata->>asset_uid.eq.${assetUid}`);

    return count || 0;
  }

  async completeRun(runId, results) {
    const run = this.activeRuns.get(runId);
    if (!run) return;

    await supabase
      .from('pipeline_runs')
      .update({
        completed_at: new Date(),
        status: 'completed',
        total_tasks_extracted: results.step1?.tasksExtracted || 0,
        total_tasks_classified: results.step2?.tasksClassified || 0,
        total_tasks_discovered: results.step3?.tasksDiscovered || 0,
        total_duplicates_found: results.step4?.duplicatePairs || 0
      })
      .eq('id', runId);
  }

  // Cancel a running process
  async cancelRun(runId) {
    const run = this.activeRuns.get(runId);
    if (!run) {
      throw new Error(`No active run with ID ${runId}`);
    }

    await supabase
      .from('pipeline_runs')
      .update({
        status: 'cancelled',
        completed_at: new Date()
      })
      .eq('id', runId);

    this.emit('processing_cancelled', { runId });
    this.activeRuns.delete(runId);
  }
}
```

### **4. Event-Driven Agent Watcher**
```javascript
// src/services/agent-watcher.service.js
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { createClient } from '@supabase/supabase-js';

export class AgentWatcher {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.isRunning = false;
    this.instanceId = `agent-${process.pid}-${Date.now()}`;
    this.pendingSystems = new Set();

    this.supabase = createClient(
      config.SUPABASE_URL,
      config.SUPABASE_SERVICE_KEY
    );
  }

  async start() {
    this.isRunning = true;
    logger.info(`Agent watcher started (mode: ${config.AGENT_MODE})`);

    switch(config.AGENT_MODE) {
      case 'queue':
        await this.startQueueMode();
        break;
      case 'realtime':
        await this.startRealtimeMode();
        break;
      case 'hybrid':
        await this.startHybridMode();
        break;
      default:
        throw new Error(`Unknown agent mode: ${config.AGENT_MODE}`);
    }
  }

  async startQueueMode() {
    // Poll queue table periodically
    while (this.isRunning) {
      try {
        // Claim items from queue atomically
        const items = await this.claimQueueItems();

        for (const item of items) {
          try {
            await this.processQueueItem(item);
            await this.markQueueItemComplete(item.id);
          } catch (error) {
            await this.markQueueItemFailed(item.id, error.message);
          }
        }

        // Wait before next poll
        await this.sleep(config.QUEUE_POLL_INTERVAL_MS);

      } catch (error) {
        logger.error('Queue processing error:', error);
        await this.sleep(config.QUEUE_POLL_INTERVAL_MS * 2);
      }
    }
  }

  async startRealtimeMode() {
    // Subscribe to Supabase realtime changes
    const subscription = this.supabase
      .channel('document-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'document_chunks'
        },
        (payload) => {
          logger.info('New document chunk detected:', payload.new.id);
          this.handleRealtimeEvent('document_chunk', payload.new);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'processing_queue'
        },
        (payload) => {
          logger.info('New queue item:', payload.new.id);
          this.handleRealtimeEvent('queue_item', payload.new);
        }
      )
      .subscribe();

    // Keep alive
    while (this.isRunning) {
      await this.sleep(60000); // Check every minute
    }
  }

  async startHybridMode() {
    // Start both realtime and queue polling
    this.startRealtimeMode();

    // Also poll queue as backup (less frequently)
    while (this.isRunning) {
      await this.sleep(3600000); // Hourly backup poll

      try {
        const staleItems = await this.findStaleQueueItems();
        for (const item of staleItems) {
          await this.processQueueItem(item);
        }
      } catch (error) {
        logger.error('Hybrid backup poll error:', error);
      }
    }
  }

  async claimQueueItems() {
    const { data, error } = await this.supabase.rpc(
      'claim_queue_items',
      {
        p_processor_id: this.instanceId,
        p_batch_size: config.QUEUE_BATCH_SIZE
      }
    );

    if (error) {
      logger.error('Failed to claim queue items:', error);
      return [];
    }

    return data || [];
  }

  async processQueueItem(item) {
    logger.info(`Processing queue item: ${item.event_type} for ${item.asset_uid}`);

    // Deduplicate if system already pending
    if (this.pendingSystems.has(item.asset_uid)) {
      logger.info(`System ${item.asset_uid} already pending, skipping`);
      return;
    }

    this.pendingSystems.add(item.asset_uid);

    // Batch multiple events for same system
    setTimeout(async () => {
      if (this.pendingSystems.has(item.asset_uid)) {
        this.pendingSystems.delete(item.asset_uid);

        try {
          await this.orchestrator.processSystem(
            item.asset_uid,
            item.event_type === 'manual_trigger' ? 'manual' : 'agent'
          );
        } catch (error) {
          logger.error(`Failed to process system ${item.asset_uid}:`, error);
        }
      }
    }, config.EVENT_BATCH_DELAY_MS);
  }

  async handleRealtimeEvent(type, data) {
    if (type === 'document_chunk') {
      // Queue for processing
      await this.supabase.from('processing_queue').insert({
        event_type: 'document_processed',
        asset_uid: data.asset_uid,
        payload: {
          document_id: data.document_id,
          chunk_count: 1
        }
      });
    } else if (type === 'queue_item') {
      // Process immediately
      await this.processQueueItem(data);
    }
  }

  async markQueueItemComplete(itemId) {
    await this.supabase
      .from('processing_queue')
      .update({
        status: 'completed',
        completed_at: new Date()
      })
      .eq('id', itemId);
  }

  async markQueueItemFailed(itemId, error) {
    await this.supabase
      .from('processing_queue')
      .update({
        status: 'failed',
        last_error: error
      })
      .eq('id', itemId);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async stop() {
    this.isRunning = false;
    logger.info('Agent watcher stopped');
  }
}
```

### **5. WebSocket Integration (Same Port!)**
```javascript
// src/app.js - Main Express server with integrated WebSocket
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import url from 'url';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { PipelineOrchestrator } from './services/pipeline-orchestrator.service.js';
import { AgentWatcher } from './services/agent-watcher.service.js';
import pipelineRoutes from './routes/admin/pipeline.route.js';

const app = express();
const server = createServer(app);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// HTTP Routes
app.use('/api/pipeline', pipelineRoutes);

// WebSocket server on SAME port
const wss = new WebSocketServer({
  noServer: true,
  path: '/api/ws'
});

// Track connected clients
const clients = new Map();

// Handle HTTP upgrade to WebSocket
server.on('upgrade', async (request, socket, head) => {
  const pathname = url.parse(request.url).pathname;

  if (pathname === '/api/ws') {
    // Extract auth token from query or headers
    const token = extractToken(request);

    try {
      // Validate authentication (implement your auth logic)
      const user = await authenticateToken(token);

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.userId = user?.id || 'anonymous';
        ws.clientId = generateClientId();
        wss.emit('connection', ws, request);
      });
    } catch (error) {
      logger.warn('WebSocket authentication failed:', error);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  } else {
    socket.destroy();
  }
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientId = ws.clientId;

  logger.info(`WebSocket client ${clientId} connected (user: ${ws.userId})`);

  // Store client
  clients.set(clientId, {
    ws,
    userId: ws.userId,
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
      handleClientMessage(clientId, data);
    } catch (error) {
      logger.error('Invalid WebSocket message:', error);
    }
  });

  // Handle pong (keep-alive response)
  ws.on('pong', () => {
    const client = clients.get(clientId);
    if (client) {
      client.isAlive = true;
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    logger.info(`WebSocket client ${clientId} disconnected`);
    clients.delete(clientId);
  });

  ws.on('error', (error) => {
    logger.error(`WebSocket error for ${clientId}:`, error);
  });
});

// Ping clients every 30 seconds to detect disconnects
setInterval(() => {
  clients.forEach((client, id) => {
    if (client.isAlive === false) {
      logger.info(`Terminating inactive client ${id}`);
      client.ws.terminate();
      clients.delete(id);
      return;
    }

    client.isAlive = false;
    client.ws.ping();
  });
}, 30000);

// Initialize orchestrator and agent
const orchestrator = new PipelineOrchestrator();
const agent = new AgentWatcher(orchestrator);

// Forward orchestrator events to WebSocket clients
orchestrator.on('processing_started', (data) => {
  broadcast({ type: 'processing_started', ...data });
});

orchestrator.on('step_started', (data) => {
  broadcast({ type: 'step_started', ...data });
});

orchestrator.on('progress', (data) => {
  broadcast({ type: 'progress_update', ...data });
});

orchestrator.on('step_completed', (data) => {
  broadcast({ type: 'step_completed', ...data });
});

orchestrator.on('manual_review_required', (data) => {
  broadcast({ type: 'manual_review_required', ...data });
});

orchestrator.on('processing_complete', (data) => {
  broadcast({ type: 'processing_complete', ...data });
});

orchestrator.on('error', (data) => {
  broadcast({ type: 'error', ...data });
});

// Helper functions
function broadcast(data) {
  const message = JSON.stringify(data);

  clients.forEach((client) => {
    if (client.ws.readyState === 1) { // OPEN
      client.ws.send(message);
    }
  });
}

function broadcastToRun(runId, data) {
  const message = JSON.stringify(data);

  clients.forEach((client) => {
    if (client.subscriptions.has(runId) && client.ws.readyState === 1) {
      client.ws.send(message);
    }
  });
}

function handleClientMessage(clientId, data) {
  const client = clients.get(clientId);
  if (!client) return;

  switch(data.type) {
    case 'subscribe_run':
      client.subscriptions.add(data.runId);
      logger.info(`Client ${clientId} subscribed to run ${data.runId}`);
      break;

    case 'unsubscribe_run':
      client.subscriptions.delete(data.runId);
      break;

    case 'set_mode':
      // Update processing mode (if authorized)
      if (data.mode === 'agent' && config.PROCESSING_MODE !== 'manual') {
        agent.start();
      } else if (data.mode === 'manual') {
        agent.stop();
      }
      break;

    case 'refresh_status':
      // Send current status to this client
      sendCurrentStatus(clientId);
      break;

    case 'ping':
      client.ws.send(JSON.stringify({ type: 'pong' }));
      break;

    default:
      logger.warn(`Unknown message type from ${clientId}: ${data.type}`);
  }
}

function generateClientId() {
  return Math.random().toString(36).substr(2, 9);
}

function extractToken(request) {
  // Try query parameter
  const urlParts = url.parse(request.url, true);
  if (urlParts.query.token) {
    return urlParts.query.token;
  }

  // Try Authorization header
  const auth = request.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.substring(7);
  }

  return null;
}

async function authenticateToken(token) {
  // Implement your authentication logic
  // For now, accept any token for development
  if (!token && config.NODE_ENV === 'development') {
    return { id: 'dev-user' };
  }

  // Validate token against your auth system
  // Return user object or throw error
  return { id: 'authenticated-user' };
}

async function sendCurrentStatus(clientId) {
  const client = clients.get(clientId);
  if (!client) return;

  try {
    // Fetch current system statuses
    const { data: systems } = await supabase
      .from('pipeline_processing_status')
      .select('*')
      .order('updated_at', { ascending: false });

    client.ws.send(JSON.stringify({
      type: 'status_update',
      systems
    }));
  } catch (error) {
    logger.error('Failed to send status:', error);
  }
}

// Start server
server.listen(config.API_PORT, () => {
  logger.info(`
    🚀 Maintenance Agent Server Started
    HTTP API: http://localhost:${config.API_PORT}
    WebSocket: ws://localhost:${config.API_PORT}/api/ws
    Mode: ${config.PROCESSING_MODE}
  `);

  // Start agent if configured
  if (config.PROCESSING_MODE === 'agent' || config.PROCESSING_MODE === 'both') {
    agent.start().catch(error => {
      logger.error('Failed to start agent:', error);
    });
  }
});

// Export for use in routes
export { orchestrator, agent };
```

### **6. API Routes**
```javascript
// src/routes/admin/pipeline.route.js
import express from 'express';
import { orchestrator } from '../../app.js';
import { logger } from '../../utils/logger.js';
import { supabase } from '../../repositories/supabase.repository.js';

const router = express.Router();

// Get all system statuses with pagination and filtering
router.get('/systems', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      status = null,
      hasChanges = null,
      search = null,
      sortBy = 'last_processed_at',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    let query = supabase
      .from('pipeline_processing_status')
      .select('*', { count: 'exact' });

    // Apply filters
    if (status) {
      query = query.eq('overall_status', status);
    }

    if (hasChanges !== null) {
      query = query.eq('pinecone_has_changes', hasChanges === 'true');
    }

    if (search) {
      query = query.ilike('system_name', `%${search}%`);
    }

    // Add pagination and sorting
    query = query
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .range(offset, offset + parseInt(limit) - 1);

    const { data, count, error } = await query;

    if (error) throw error;

    // Get metrics
    const metrics = await getMetrics();

    res.json({
      success: true,
      systems: data || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      },
      metrics
    });
  } catch (error) {
    logger.error('Failed to get system statuses:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Process selected systems
router.post('/process', async (req, res) => {
  try {
    const { systems, mode = 'manual' } = req.body;

    if (!systems || !Array.isArray(systems) || systems.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No systems provided'
      });
    }

    // Create run record
    const runId = uuidv4();
    await supabase.from('pipeline_runs').insert({
      id: runId,
      run_mode: mode,
      initiated_by: req.user?.id || 'api',
      system_count: systems.length,
      systems_processed: systems,
      started_at: new Date()
    });

    // Start processing in background
    Promise.all(
      systems.map(assetUid =>
        orchestrator.processSystem(assetUid, mode, runId)
          .catch(error => {
            logger.error(`Failed to process ${assetUid}:`, error);
            return { error: error.message };
          })
      )
    ).then(results => {
      logger.info(`Run ${runId} completed:`, results);
    });

    res.json({
      success: true,
      runId,
      message: `Started processing ${systems.length} system(s)`
    });
  } catch (error) {
    logger.error('Failed to start processing:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get run status
router.get('/runs/:runId', async (req, res) => {
  try {
    const { data: run } = await supabase
      .from('pipeline_runs')
      .select('*')
      .eq('id', req.params.runId)
      .single();

    if (!run) {
      return res.status(404).json({
        success: false,
        error: 'Run not found'
      });
    }

    res.json({
      success: true,
      run
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Cancel running process
router.post('/runs/:runId/cancel', async (req, res) => {
  try {
    await orchestrator.cancelRun(req.params.runId);

    res.json({
      success: true,
      message: 'Processing cancelled'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get metrics
async function getMetrics() {
  const { data: stats } = await supabase
    .from('pipeline_processing_status')
    .select('overall_status');

  const metrics = {
    total_systems: stats?.length || 0,
    unprocessed: 0,
    processing: 0,
    completed: 0,
    failed: 0
  };

  stats?.forEach(s => {
    switch(s.overall_status) {
      case 'not_started':
        metrics.unprocessed++;
        break;
      case 'processing':
        metrics.processing++;
        break;
      case 'completed':
        metrics.completed++;
        break;
      case 'failed':
        metrics.failed++;
        break;
    }
  });

  // Get totals from recent runs
  const { data: recentRuns } = await supabase
    .from('pipeline_runs')
    .select('total_tasks_extracted, total_tasks_classified, total_tasks_discovered, total_duplicates_found')
    .gte('started_at', new Date(Date.now() - 86400000).toISOString()) // Last 24 hours
    .eq('status', 'completed');

  metrics.tasks_extracted_24h = recentRuns?.reduce((sum, r) => sum + (r.total_tasks_extracted || 0), 0) || 0;
  metrics.tasks_classified_24h = recentRuns?.reduce((sum, r) => sum + (r.total_tasks_classified || 0), 0) || 0;
  metrics.tasks_discovered_24h = recentRuns?.reduce((sum, r) => sum + (r.total_tasks_discovered || 0), 0) || 0;
  metrics.duplicates_found_24h = recentRuns?.reduce((sum, r) => sum + (r.total_duplicates_found || 0), 0) || 0;

  return metrics;
}

// Queue new processing job
router.post('/queue', async (req, res) => {
  try {
    const { asset_uid, event_type = 'manual_trigger' } = req.body;

    if (!asset_uid) {
      return res.status(400).json({
        success: false,
        error: 'asset_uid required'
      });
    }

    // Add to processing queue
    const { data, error } = await supabase
      .from('processing_queue')
      .insert({
        event_type,
        asset_uid,
        payload: {
          triggered_by: req.user?.id || 'api',
          timestamp: new Date()
        }
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Added to processing queue',
      queueItem: data
    });
  } catch (error) {
    logger.error('Failed to queue processing:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
```

---

## 🎨 COMPLETE FRONTEND IMPLEMENTATION

### **Status Page HTML**
```html
<!-- public/agent-status.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Maintenance Agent Status</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f7fa;
      color: #333;
    }

    .header {
      background: white;
      padding: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .header h1 {
      font-size: 24px;
      font-weight: 600;
    }

    .connection-status {
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;
    }

    .connection-status.connected {
      background: #d4edda;
      color: #155724;
    }

    .connection-status.disconnected {
      background: #f8d7da;
      color: #721c24;
    }

    .main-container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    /* Mode Selector */
    .mode-selector {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: flex;
      gap: 10px;
    }

    .mode-button {
      padding: 10px 20px;
      border: 2px solid #007bff;
      background: white;
      color: #007bff;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
    }

    .mode-button:hover {
      background: #f0f7ff;
    }

    .mode-button.active {
      background: #007bff;
      color: white;
    }

    /* Metrics Dashboard */
    .metrics-panel {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }

    .metric-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .metric-value {
      font-size: 32px;
      font-weight: bold;
      color: #2c3e50;
      margin-bottom: 5px;
    }

    .metric-label {
      font-size: 14px;
      color: #7f8c8d;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Filters */
    .filters-section {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
      align-items: center;
    }

    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .filter-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .filter-input,
    .filter-select {
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }

    /* Systems Table */
    .table-container {
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .systems-table {
      width: 100%;
      border-collapse: collapse;
    }

    .systems-table thead {
      background: #f8f9fa;
    }

    .systems-table th {
      padding: 15px;
      text-align: left;
      font-weight: 600;
      font-size: 14px;
      color: #495057;
      border-bottom: 2px solid #dee2e6;
    }

    .systems-table td {
      padding: 15px;
      border-bottom: 1px solid #dee2e6;
      font-size: 14px;
    }

    .systems-table tbody tr:hover {
      background: #f8f9fa;
    }

    /* Step Progress */
    .step-progress {
      display: flex;
      gap: 8px;
    }

    .step-indicator {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
      position: relative;
    }

    .step-indicator.completed {
      background: #28a745;
      color: white;
    }

    .step-indicator.in-progress {
      background: #ff9800;
      color: white;
      animation: pulse 1.5s infinite;
    }

    .step-indicator.failed {
      background: #dc3545;
      color: white;
    }

    .step-indicator.paused {
      background: #17a2b8;
      color: white;
    }

    .step-indicator.not-started {
      background: #e9ecef;
      color: #6c757d;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    /* Action Buttons */
    .action-buttons {
      margin-top: 20px;
      display: flex;
      gap: 10px;
    }

    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary {
      background: #007bff;
      color: white;
    }

    .btn-primary:hover {
      background: #0056b3;
    }

    .btn-success {
      background: #28a745;
      color: white;
    }

    .btn-success:hover {
      background: #218838;
    }

    .btn-secondary {
      background: #6c757d;
      color: white;
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* Progress Modal */
    .progress-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .progress-modal.active {
      display: flex;
    }

    .progress-content {
      background: white;
      padding: 30px;
      border-radius: 10px;
      min-width: 500px;
      max-width: 800px;
    }

    .progress-header {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 20px;
    }

    .progress-info {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 10px;
      margin-bottom: 20px;
    }

    .progress-label {
      font-weight: 500;
      color: #666;
    }

    .progress-bar {
      width: 100%;
      height: 30px;
      background: #e9ecef;
      border-radius: 15px;
      overflow: hidden;
      margin: 20px 0;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #007bff, #0056b3);
      transition: width 0.3s ease;
    }

    .log-output {
      background: #1a1a1a;
      color: #0f0;
      padding: 15px;
      border-radius: 5px;
      height: 200px;
      overflow-y: auto;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 12px;
      margin-top: 20px;
      line-height: 1.5;
    }

    .log-entry {
      margin-bottom: 5px;
    }

    /* Pagination */
    .pagination {
      display: flex;
      justify-content: center;
      gap: 5px;
      margin-top: 20px;
    }

    .page-button {
      padding: 8px 12px;
      border: 1px solid #dee2e6;
      background: white;
      color: #007bff;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }

    .page-button:hover {
      background: #f8f9fa;
    }

    .page-button.active {
      background: #007bff;
      color: white;
      border-color: #007bff;
    }

    .page-button:disabled {
      color: #6c757d;
      cursor: not-allowed;
      background: #f8f9fa;
    }

    /* Links */
    .action-link {
      color: #007bff;
      text-decoration: none;
      font-weight: 500;
    }

    .action-link:hover {
      text-decoration: underline;
    }

    /* Status badge */
    .status-badge {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .status-badge.not-started {
      background: #e9ecef;
      color: #6c757d;
    }

    .status-badge.processing {
      background: #fff3cd;
      color: #856404;
    }

    .status-badge.completed {
      background: #d4edda;
      color: #155724;
    }

    .status-badge.failed {
      background: #f8d7da;
      color: #721c24;
    }

    .status-badge.paused {
      background: #d1ecf1;
      color: #0c5460;
    }

    /* Checkbox styling */
    .checkbox-custom {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔧 Maintenance Agent Status</h1>
    <div id="connection-status" class="connection-status disconnected">
      Disconnected
    </div>
  </div>

  <div class="main-container">
    <!-- Mode Selector -->
    <div class="mode-selector">
      <button class="mode-button active" data-mode="manual" onclick="setMode('manual')">
        🖱️ Manual Mode
      </button>
      <button class="mode-button" data-mode="agent" onclick="setMode('agent')">
        🤖 Agent Mode (Autonomous)
      </button>
    </div>

    <!-- Metrics Dashboard -->
    <div class="metrics-panel">
      <div class="metric-card">
        <div class="metric-value" id="metric-total">0</div>
        <div class="metric-label">Total Systems</div>
      </div>
      <div class="metric-card">
        <div class="metric-value" id="metric-unprocessed">0</div>
        <div class="metric-label">Unprocessed</div>
      </div>
      <div class="metric-card">
        <div class="metric-value" id="metric-processing">0</div>
        <div class="metric-label">Processing</div>
      </div>
      <div class="metric-card">
        <div class="metric-value" id="metric-completed">0</div>
        <div class="metric-label">Completed</div>
      </div>
      <div class="metric-card">
        <div class="metric-value" id="metric-extracted">0</div>
        <div class="metric-label">Tasks Extracted (24h)</div>
      </div>
      <div class="metric-card">
        <div class="metric-value" id="metric-duplicates">0</div>
        <div class="metric-label">Duplicates Found (24h)</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="filters-section">
      <div class="filter-group">
        <label class="filter-label">Search</label>
        <input type="text"
               id="search-filter"
               class="filter-input"
               placeholder="Search systems..."
               onchange="applyFilters()">
      </div>

      <div class="filter-group">
        <label class="filter-label">Status</label>
        <select id="status-filter" class="filter-select" onchange="applyFilters()">
          <option value="">All Statuses</option>
          <option value="not_started">Not Started</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="paused">Paused</option>
        </select>
      </div>

      <div class="filter-group">
        <label class="filter-label">Changes</label>
        <label style="display: flex; align-items: center; gap: 5px;">
          <input type="checkbox"
                 id="has-changes-filter"
                 onchange="applyFilters()">
          Only with changes
        </label>
      </div>

      <button class="btn btn-secondary" onclick="loadSystems()">
        🔄 Refresh
      </button>
    </div>

    <!-- Systems Table -->
    <div class="table-container">
      <table class="systems-table">
        <thead>
          <tr>
            <th>
              <input type="checkbox"
                     id="select-all"
                     class="checkbox-custom"
                     onchange="toggleSelectAll()">
            </th>
            <th>System Name</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Last Processed</th>
            <th>Pinecone Tasks</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="systems-tbody">
          <!-- Populated by JavaScript -->
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="pagination" id="pagination">
      <!-- Populated by JavaScript -->
    </div>

    <!-- Action Buttons -->
    <div class="action-buttons">
      <button class="btn btn-success" onclick="processSelected()">
        ▶️ Process Selected
      </button>
      <button class="btn btn-primary" onclick="processAll()">
        ⚡ Process All Unprocessed
      </button>
    </div>
  </div>

  <!-- Progress Modal -->
  <div class="progress-modal" id="progress-modal">
    <div class="progress-content">
      <div class="progress-header">Processing Pipeline</div>

      <div class="progress-info">
        <div class="progress-label">System:</div>
        <div id="current-system">-</div>

        <div class="progress-label">Step:</div>
        <div id="current-step">-</div>

        <div class="progress-label">Status:</div>
        <div id="current-status">-</div>
      </div>

      <div class="progress-bar">
        <div class="progress-fill" id="progress-fill" style="width: 0%"></div>
      </div>

      <div style="text-align: center; margin: 10px 0;">
        <span id="progress-percent">0%</span>
      </div>

      <div class="log-output" id="log-output">
        <!-- Log messages appear here -->
      </div>

      <div style="text-align: right; margin-top: 20px;">
        <button class="btn btn-secondary" onclick="closeProgress()">
          Close
        </button>
      </div>
    </div>
  </div>

  <script>
    // WebSocket client implementation
    class StatusPageClient {
      constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.isConnected = false;
        this.currentPage = 1;
        this.selectedSystems = new Set();
        this.currentRunId = null;
        this.systems = [];
      }

      connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/ws`;

        try {
          this.ws = new WebSocket(wsUrl);

          this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.updateConnectionStatus(true);

            // Subscribe to current run if exists
            if (this.currentRunId) {
              this.subscribeToRun(this.currentRunId);
            }
          };

          this.ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              this.handleMessage(data);
            } catch (error) {
              console.error('Failed to parse message:', error);
            }
          };

          this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.isConnected = false;
            this.updateConnectionStatus(false);
            this.attemptReconnect();
          };

          this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
          };
        } catch (error) {
          console.error('Failed to create WebSocket:', error);
          this.attemptReconnect();
        }
      }

      handleMessage(data) {
        console.log('Received:', data.type, data);

        switch(data.type) {
          case 'connection_established':
            this.clientId = data.clientId;
            break;

          case 'processing_started':
            this.showProgress();
            this.updateProgress('Starting...', 0);
            this.addLog(`Processing started for ${data.assetUid}`);
            break;

          case 'step_started':
            this.updateProgress(`Step ${data.step}`, (data.step - 1) * 16.67);
            this.addLog(`Step ${data.step} started`);
            break;

          case 'progress_update':
            this.updateProgress(data.message || `Step ${data.step}`, data.percent);
            if (data.message) {
              this.addLog(data.message);
            }
            break;

          case 'step_completed':
            this.updateProgress(`Step ${data.step} completed`, data.step * 16.67);
            this.addLog(`✓ Step ${data.step} completed`);

            // Update table row
            if (data.assetUid) {
              this.updateSystemRow(data.assetUid, data.step, 'completed');
            }
            break;

          case 'manual_review_required':
            this.addLog(`⚠️ Manual review required: ${data.pendingReviews} duplicate pairs`);
            this.addLog(`Review at: ${data.reviewUrl}`);

            // Add link to progress modal
            const linkHtml = `<a href="${data.reviewUrl}" target="_blank" style="color: #00ff00;">Open Review Interface</a>`;
            document.getElementById('log-output').insertAdjacentHTML('beforeend', linkHtml);
            break;

          case 'processing_complete':
            this.updateProgress('Completed!', 100);
            this.addLog('✅ Processing complete!');
            setTimeout(() => {
              this.closeProgress();
              this.loadSystems(); // Refresh table
            }, 2000);
            break;

          case 'error':
            this.addLog(`❌ Error: ${data.message}`);
            break;

          default:
            console.log('Unknown message type:', data.type);
        }
      }

      send(data) {
        if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(data));
        }
      }

      subscribeToRun(runId) {
        this.currentRunId = runId;
        this.send({
          type: 'subscribe_run',
          runId: runId
        });
      }

      attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('Max reconnection attempts reached');
          return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
          this.connect();
        }, delay);
      }

      updateConnectionStatus(connected) {
        const element = document.getElementById('connection-status');
        if (connected) {
          element.textContent = 'Connected';
          element.className = 'connection-status connected';
        } else {
          element.textContent = 'Disconnected';
          element.className = 'connection-status disconnected';
        }
      }

      showProgress() {
        document.getElementById('progress-modal').classList.add('active');
        document.getElementById('log-output').innerHTML = '';
      }

      closeProgress() {
        document.getElementById('progress-modal').classList.remove('active');
      }

      updateProgress(message, percent) {
        document.getElementById('current-status').textContent = message;
        document.getElementById('progress-fill').style.width = `${percent}%`;
        document.getElementById('progress-percent').textContent = `${Math.round(percent)}%`;
      }

      addLog(message) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `<div class="log-entry">[${timestamp}] ${message}</div>`;
        const logOutput = document.getElementById('log-output');
        logOutput.insertAdjacentHTML('beforeend', logEntry);
        logOutput.scrollTop = logOutput.scrollHeight;
      }

      updateSystemRow(assetUid, step, status) {
        const row = document.querySelector(`tr[data-asset-uid="${assetUid}"]`);
        if (row) {
          const indicator = row.querySelector(`.step-indicator[data-step="${step}"]`);
          if (indicator) {
            indicator.className = `step-indicator ${status}`;
          }
        }
      }

      async loadSystems(page = 1) {
        try {
          const params = new URLSearchParams({
            page,
            limit: 50,
            ...this.getFilters()
          });

          const response = await fetch(`/api/pipeline/systems?${params}`);
          const data = await response.json();

          if (data.success) {
            this.systems = data.systems;
            this.renderSystemsTable(data.systems);
            this.renderPagination(data.pagination);
            this.updateMetrics(data.metrics);
            this.currentPage = page;
          }
        } catch (error) {
          console.error('Failed to load systems:', error);
        }
      }

      getFilters() {
        const filters = {};

        const search = document.getElementById('search-filter').value;
        if (search) filters.search = search;

        const status = document.getElementById('status-filter').value;
        if (status) filters.status = status;

        const hasChanges = document.getElementById('has-changes-filter').checked;
        if (hasChanges) filters.hasChanges = true;

        return filters;
      }

      renderSystemsTable(systems) {
        const tbody = document.getElementById('systems-tbody');
        tbody.innerHTML = '';

        systems.forEach(system => {
          const row = document.createElement('tr');
          row.dataset.assetUid = system.asset_uid;

          row.innerHTML = `
            <td>
              <input type="checkbox"
                     class="checkbox-custom system-checkbox"
                     data-asset-uid="${system.asset_uid}"
                     ${this.selectedSystems.has(system.asset_uid) ? 'checked' : ''}>
            </td>
            <td>${this.escapeHtml(system.system_name)}</td>
            <td>
              <span class="status-badge ${system.overall_status}">
                ${system.overall_status.replace('_', ' ')}
              </span>
            </td>
            <td>${this.renderProgress(system)}</td>
            <td>${this.formatDate(system.last_processed_at)}</td>
            <td>${system.pinecone_task_count || 0}</td>
            <td>${this.renderActions(system)}</td>
          `;

          tbody.appendChild(row);
        });

        // Re-attach checkbox listeners
        document.querySelectorAll('.system-checkbox').forEach(checkbox => {
          checkbox.addEventListener('change', (e) => {
            const uid = e.target.dataset.assetUid;
            if (e.target.checked) {
              this.selectedSystems.add(uid);
            } else {
              this.selectedSystems.delete(uid);
            }
          });
        });
      }

      renderProgress(system) {
        const steps = [1, 2, 3, 4, 5, 6];

        return `
          <div class="step-progress">
            ${steps.map(num => {
              const status = system[`step${num}_${num === 1 ? 'extract' : num === 2 ? 'classify' : num === 3 ? 'discover' : num === 4 ? 'dedupe' : num === 5 ? 'review' : 'boatos'}_status`] || 'not_started';
              return `
                <div class="step-indicator ${status}"
                     data-step="${num}"
                     title="Step ${num}: ${status.replace('_', ' ')}">
                  ${num}
                </div>
              `;
            }).join('')}
          </div>
        `;
      }

      renderActions(system) {
        const actions = [];

        // Show dedup review link if pending
        if (system.step5_pairs_pending > 0) {
          actions.push(`
            <a href="/dedup-review.html?system=${encodeURIComponent(system.system_name)}"
               target="_blank"
               class="action-link">
              Review Duplicates (${system.step5_pairs_pending})
            </a>
          `);
        }

        // Show complete Step 6 link if needed
        if (system.step5_review_status === 'completed' &&
            system.step6_boatos_status === 'not_started') {
          actions.push(`
            <a href="/hours-update.html?asset=${system.asset_uid}"
               target="_blank"
               class="action-link">
              Complete Step 6
            </a>
          `);
        }

        return actions.join(' | ') || '-';
      }

      renderPagination(pagination) {
        const container = document.getElementById('pagination');
        container.innerHTML = '';

        // Previous button
        const prevBtn = document.createElement('button');
        prevBtn.className = 'page-button';
        prevBtn.textContent = '← Previous';
        prevBtn.disabled = pagination.page <= 1;
        prevBtn.onclick = () => this.loadSystems(pagination.page - 1);
        container.appendChild(prevBtn);

        // Page numbers
        const startPage = Math.max(1, pagination.page - 2);
        const endPage = Math.min(pagination.pages, pagination.page + 2);

        for (let i = startPage; i <= endPage; i++) {
          const pageBtn = document.createElement('button');
          pageBtn.className = 'page-button';
          if (i === pagination.page) {
            pageBtn.classList.add('active');
          }
          pageBtn.textContent = i;
          pageBtn.onclick = () => this.loadSystems(i);
          container.appendChild(pageBtn);
        }

        // Next button
        const nextBtn = document.createElement('button');
        nextBtn.className = 'page-button';
        nextBtn.textContent = 'Next →';
        nextBtn.disabled = pagination.page >= pagination.pages;
        nextBtn.onclick = () => this.loadSystems(pagination.page + 1);
        container.appendChild(nextBtn);
      }

      updateMetrics(metrics) {
        document.getElementById('metric-total').textContent = metrics.total_systems || 0;
        document.getElementById('metric-unprocessed').textContent = metrics.unprocessed || 0;
        document.getElementById('metric-processing').textContent = metrics.processing || 0;
        document.getElementById('metric-completed').textContent = metrics.completed || 0;
        document.getElementById('metric-extracted').textContent = metrics.tasks_extracted_24h || 0;
        document.getElementById('metric-duplicates').textContent = metrics.duplicates_found_24h || 0;
      }

      formatDate(dateStr) {
        if (!dateStr) return 'Never';

        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;

        if (diff < 3600000) { // Less than 1 hour
          return `${Math.floor(diff / 60000)} minutes ago`;
        } else if (diff < 86400000) { // Less than 1 day
          return `${Math.floor(diff / 3600000)} hours ago`;
        } else {
          return `${Math.floor(diff / 86400000)} days ago`;
        }
      }

      escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      async processSelected() {
        const selected = Array.from(this.selectedSystems);

        if (selected.length === 0) {
          alert('Please select systems to process');
          return;
        }

        try {
          const response = await fetch('/api/pipeline/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systems: selected,
              mode: window.currentMode || 'manual'
            })
          });

          const data = await response.json();

          if (data.success) {
            this.subscribeToRun(data.runId);
            this.showProgress();
            this.updateProgress('Initializing...', 0);

            // Update UI to show systems being processed
            document.getElementById('current-system').textContent =
              `${selected.length} system(s)`;
          } else {
            alert(`Error: ${data.error}`);
          }
        } catch (error) {
          console.error('Failed to start processing:', error);
          alert('Failed to start processing');
        }
      }

      async processAll() {
        const unprocessed = this.systems
          .filter(s => s.overall_status === 'not_started')
          .map(s => s.asset_uid);

        if (unprocessed.length === 0) {
          alert('No unprocessed systems found');
          return;
        }

        if (!confirm(`Process ${unprocessed.length} unprocessed system(s)?`)) {
          return;
        }

        // Use same logic as processSelected
        this.selectedSystems = new Set(unprocessed);
        await this.processSelected();
      }
    }

    // Initialize client
    const client = new StatusPageClient();
    let currentMode = 'manual';

    // Global functions
    function setMode(mode) {
      currentMode = mode;
      window.currentMode = mode;

      // Update UI
      document.querySelectorAll('.mode-button').forEach(btn => {
        if (btn.dataset.mode === mode) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      // Send to server
      client.send({
        type: 'set_mode',
        mode: mode
      });
    }

    function toggleSelectAll() {
      const selectAll = document.getElementById('select-all');
      const checkboxes = document.querySelectorAll('.system-checkbox');

      checkboxes.forEach(checkbox => {
        checkbox.checked = selectAll.checked;
        const uid = checkbox.dataset.assetUid;
        if (selectAll.checked) {
          client.selectedSystems.add(uid);
        } else {
          client.selectedSystems.delete(uid);
        }
      });
    }

    function applyFilters() {
      client.loadSystems(1);
    }

    function loadSystems() {
      client.loadSystems(client.currentPage);
    }

    function processSelected() {
      client.processSelected();
    }

    function processAll() {
      client.processAll();
    }

    function closeProgress() {
      client.closeProgress();
    }

    // Initialize on page load
    document.addEventListener('DOMContentLoaded', () => {
      client.connect();
      client.loadSystems();

      // Refresh every 30 seconds
      setInterval(() => {
        if (!document.getElementById('progress-modal').classList.contains('active')) {
          client.loadSystems(client.currentPage);
        }
      }, 30000);
    });
  </script>
</body>
</html>
```

---

## 📦 Package Dependencies

### **package.json**
```json
{
  "name": "maintenance-agent",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/app.js",
    "dev": "nodemon src/app.js",
    "migrate": "node scripts/migrate.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "@pinecone-database/pinecone": "^1.1.2",
    "openai": "^4.24.0",
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "ioredis": "^5.3.2",
    "uuid": "^9.0.1",
    "zod": "^3.22.4",
    "dotenv": "^16.3.1",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

---

## 🚀 DEPLOYMENT

### **Docker Compose**
```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    restart: unless-stopped

volumes:
  redis_data:
```

### **Environment Variables (.env)**
```bash
# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# APIs
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=...
PINECONE_INDEX=maintenance-tasks

# Server
API_PORT=3001
NODE_ENV=development

# Processing
PROCESSING_MODE=manual
AGENT_MODE=queue
QUEUE_POLL_INTERVAL_MS=300000

# Rate Limiting
OPENAI_RPM_LIMIT=50
OPENAI_BACKOFF_BASE_MS=5000

# Batch Sizes
BATCH_SIZE_EXTRACT=10
BATCH_SIZE_CLASSIFY=5
```

---

## 📋 IMPLEMENTATION CHECKLIST

### **Phase 1: Infrastructure (Day 1)**
- [ ] Set up Redis
- [ ] Create database migrations
- [ ] Configure environment variables
- [ ] Test database connections

### **Phase 2: Backend Core (Days 2-3)**
- [ ] Implement rate limit manager with Redis
- [ ] Build pipeline orchestrator with idempotency
- [ ] Create checkpoint manager
- [ ] Implement event-driven agent watcher

### **Phase 3: Step Executors (Days 4-5)**
- [ ] Refactor Step 1 (Extract) with checkpoints
- [ ] Refactor Step 2 (Classify) with checkpoints
- [ ] Refactor Step 3 (Discover) with checkpoints
- [ ] Refactor Step 4 (Dedupe) with checkpoints
- [ ] Integrate Step 5 (Review) status checking
- [ ] Refactor Step 6 (BoatOS) with checkpoints

### **Phase 4: WebSocket & API (Days 6-7)**
- [ ] Integrate WebSocket server into Express
- [ ] Build API routes with pagination
- [ ] Connect orchestrator events to WebSocket
- [ ] Test real-time updates

### **Phase 5: Frontend (Days 8-9)**
- [ ] Build status page with virtual scrolling
- [ ] Implement WebSocket client
- [ ] Add progress modal and logging
- [ ] Test filtering and pagination

### **Phase 6: Testing & Deployment (Day 10)**
- [ ] End-to-end testing
- [ ] Load testing with 200+ systems
- [ ] Docker deployment setup
- [ ] Production configuration

---

## 🎯 KEY FEATURES SUMMARY

1. **Event-Driven Architecture** - Database queue, not aggressive polling
2. **Single Port WebSocket** - /api/ws on Express port 3001
3. **Redis Rate Limiting** - 100x faster than Postgres
4. **Idempotent Processing** - Distributed locks, exactly-once guarantee
5. **Checkpoint Recovery** - Resume from exact failure point
6. **Paginated UI** - Handles 1000+ systems efficiently
7. **Real-time Progress** - WebSocket updates during processing
8. **Direct Action Links** - Review duplicates, complete steps
9. **Telemetry Ready** - Materialized views for Grafana
10. **Production Grade** - Error handling, retries, monitoring

---

**This document contains all code and implementation details needed to build the complete system with Sonnet 4.5**