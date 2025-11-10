-- Migration 001: Pipeline Processing Status Tables
-- Phase 1: Agent Status Page Implementation
-- Created: 2025-10-29
--
-- Description:
-- Creates two tables for tracking the maintenance agent's 6-step processing pipeline:
-- 1. pipeline_processing_status - per-system step tracking
-- 2. pipeline_runs - overall run metrics and history
--
-- Run this in Supabase SQL Editor

-- ============================================================================
-- Table 1: pipeline_processing_status
-- Tracks processing status for each system through the 6-step pipeline
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_processing_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- System identification
  asset_uid UUID REFERENCES systems(asset_uid) ON DELETE CASCADE,
  system_name TEXT NOT NULL,

  -- Step 1: Extract (from manuals)
  step1_extract_status TEXT DEFAULT 'not_started'
    CHECK (step1_extract_status IN ('not_started', 'in_progress', 'completed', 'failed')),
  step1_started_at TIMESTAMPTZ,
  step1_completed_at TIMESTAMPTZ,
  step1_error TEXT,
  step1_tasks_extracted INTEGER DEFAULT 0,
  step1_tasks_skipped INTEGER DEFAULT 0,  -- For retry idempotency tracking

  -- Step 2: Classify (categorize tasks)
  step2_classify_status TEXT DEFAULT 'not_started'
    CHECK (step2_classify_status IN ('not_started', 'in_progress', 'completed', 'failed')),
  step2_started_at TIMESTAMPTZ,
  step2_completed_at TIMESTAMPTZ,
  step2_error TEXT,
  step2_tasks_classified INTEGER DEFAULT 0,
  step2_tasks_skipped INTEGER DEFAULT 0,

  -- Step 3: Discover (real-world search)
  step3_discover_status TEXT DEFAULT 'not_started'
    CHECK (step3_discover_status IN ('not_started', 'in_progress', 'completed', 'failed')),
  step3_started_at TIMESTAMPTZ,
  step3_completed_at TIMESTAMPTZ,
  step3_error TEXT,
  step3_tasks_discovered INTEGER DEFAULT 0,

  -- Step 4: Deduplicate
  step4_dedupe_status TEXT DEFAULT 'not_started'
    CHECK (step4_dedupe_status IN ('not_started', 'in_progress', 'completed', 'failed')),
  step4_started_at TIMESTAMPTZ,
  step4_completed_at TIMESTAMPTZ,
  step4_error TEXT,
  step4_duplicate_pairs INTEGER DEFAULT 0,

  -- Step 5: Manual Review (pauses for human approval)
  step5_review_status TEXT DEFAULT 'not_started'
    CHECK (step5_review_status IN ('not_started', 'in_progress', 'completed', 'paused', 'failed')),
  step5_started_at TIMESTAMPTZ,
  step5_completed_at TIMESTAMPTZ,
  step5_pairs_reviewed INTEGER DEFAULT 0,
  step5_pairs_pending INTEGER DEFAULT 0,

  -- Step 6: BoatOS Integration
  step6_boatos_status TEXT DEFAULT 'not_started'
    CHECK (step6_boatos_status IN ('not_started', 'in_progress', 'completed', 'failed')),
  step6_started_at TIMESTAMPTZ,
  step6_completed_at TIMESTAMPTZ,
  step6_error TEXT,
  step6_tasks_uploaded INTEGER DEFAULT 0,

  -- Overall status (computed from steps)
  overall_status TEXT DEFAULT 'not_started'
    CHECK (overall_status IN ('not_started', 'processing', 'completed', 'failed', 'paused')),
  last_processed_at TIMESTAMPTZ,

  -- Performance metrics
  total_processing_time_ms INTEGER,
  api_calls_made INTEGER DEFAULT 0,
  api_calls_failed INTEGER DEFAULT 0,

  -- Audit fields
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  -- Constraints
  UNIQUE(asset_uid)  -- One status record per system
);

-- Indexes for pipeline_processing_status
CREATE INDEX IF NOT EXISTS idx_pipeline_status_overall ON pipeline_processing_status(overall_status);
CREATE INDEX IF NOT EXISTS idx_pipeline_status_asset ON pipeline_processing_status(asset_uid);
CREATE INDEX IF NOT EXISTS idx_pipeline_status_updated ON pipeline_processing_status(updated_at DESC);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_pipeline_status_timestamp ON pipeline_processing_status;
CREATE TRIGGER update_pipeline_status_timestamp
  BEFORE UPDATE ON pipeline_processing_status
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Table 2: pipeline_runs
-- Tracks overall pipeline execution runs (for history and debugging)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Run identification
  initiated_by TEXT DEFAULT 'user',  -- 'user' or 'agent' (Phase 2)
  trigger_type TEXT DEFAULT 'manual',  -- 'manual', 'scheduled', 'event' (Phase 2)

  -- Systems being processed
  system_count INTEGER NOT NULL,
  systems_processed UUID[] NOT NULL,  -- Array of asset_uids

  -- Timing
  started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- Status
  status TEXT DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  current_step INTEGER,  -- Which step (1-6) is currently running
  current_system UUID,   -- Which system is being processed

  -- Aggregate metrics (rolled up from all systems)
  total_tasks_extracted INTEGER DEFAULT 0,
  total_tasks_classified INTEGER DEFAULT 0,
  total_tasks_discovered INTEGER DEFAULT 0,
  total_duplicates_found INTEGER DEFAULT 0,
  total_api_calls INTEGER DEFAULT 0,
  total_api_errors INTEGER DEFAULT 0,

  -- Error tracking
  errors JSONB DEFAULT '[]'::jsonb,  -- Array of error objects: [{step, system, message, timestamp}]

  -- Audit
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for pipeline_runs
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON pipeline_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_initiated_by ON pipeline_runs(initiated_by);

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE pipeline_processing_status IS 'Tracks step-by-step processing status for each system through the 6-step maintenance pipeline';
COMMENT ON TABLE pipeline_runs IS 'Historical log of pipeline execution runs with aggregate metrics';

COMMENT ON COLUMN pipeline_processing_status.overall_status IS 'Computed status: not_started, processing, completed, failed, or paused (waiting for manual review)';
COMMENT ON COLUMN pipeline_processing_status.step1_tasks_skipped IS 'Number of tasks skipped during extraction (already exist) - used for retry idempotency';
COMMENT ON COLUMN pipeline_processing_status.step5_review_status IS 'Can be "paused" when manual deduplication review is required';

COMMENT ON COLUMN pipeline_runs.errors IS 'Array of error objects for debugging: [{step: 1, system: "uuid", message: "error", timestamp: "iso"}]';

-- ============================================================================
-- Verification Queries (run these to confirm successful creation)
-- ============================================================================

-- Check table exists and structure
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'pipeline_processing_status'
-- ORDER BY ordinal_position;

-- Check indexes
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename IN ('pipeline_processing_status', 'pipeline_runs');

-- ============================================================================
-- End of Migration 001
-- ============================================================================
