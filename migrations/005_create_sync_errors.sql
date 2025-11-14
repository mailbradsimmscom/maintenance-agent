-- Migration 005: Sync Errors Table
-- Phase: Todo List Performance Optimization
-- Created: 2025-11-11
--
-- Description:
-- Creates a table to track sync failures between Pinecone and Supabase.
-- Used for monitoring dual-write operations and debugging sync issues.
--
-- Dual-write error handling strategy:
-- 1. Write to Pinecone first (source of truth)
-- 2. Retry sync to Supabase 3x with exponential backoff
-- 3. If all retries fail, log to this table
-- 4. Reconciliation job fixes within 24 hours
--
-- Run this in Supabase SQL Editor

-- ============================================================================
-- Table: sync_errors
-- Tracks failed synchronization attempts between Pinecone and Supabase
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Task identification
  task_id TEXT NOT NULL,

  -- Operation that failed
  operation TEXT NOT NULL
    CHECK (operation IN ('upsert', 'update', 'delete')),

  -- Error details
  error_message TEXT NOT NULL,
  error_stack TEXT,  -- Full stack trace for debugging

  -- Success/failure tracking
  pinecone_success BOOLEAN NOT NULL DEFAULT true,  -- Did Pinecone operation succeed?
  supabase_success BOOLEAN NOT NULL DEFAULT false, -- Did Supabase operation succeed?

  -- Retry tracking
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,

  -- Resolution tracking
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,  -- 'reconciliation_job', 'manual', 'retry'
  resolution_notes TEXT,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes for Monitoring & Debugging
-- ============================================================================

-- Index 1: Unresolved errors (for monitoring dashboard)
CREATE INDEX IF NOT EXISTS idx_sync_errors_unresolved
  ON sync_errors(created_at DESC)
  WHERE resolved_at IS NULL;

-- Index 2: Errors by task (for debugging specific tasks)
CREATE INDEX IF NOT EXISTS idx_sync_errors_task
  ON sync_errors(task_id, created_at DESC);

-- Index 3: Errors by operation type (for pattern analysis)
CREATE INDEX IF NOT EXISTS idx_sync_errors_operation
  ON sync_errors(operation, created_at DESC)
  WHERE resolved_at IS NULL;

-- Index 4: Recent errors (for alerting)
CREATE INDEX IF NOT EXISTS idx_sync_errors_recent
  ON sync_errors(created_at DESC);

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE sync_errors IS 'Tracks sync failures between Pinecone and Supabase during dual-write operations. Unresolved errors are fixed by nightly reconciliation job.';

COMMENT ON COLUMN sync_errors.operation IS 'Type of operation that failed: upsert (create), update (modify), delete (remove)';
COMMENT ON COLUMN sync_errors.pinecone_success IS 'True if Pinecone operation succeeded (typically true, since Pinecone is written first)';
COMMENT ON COLUMN sync_errors.supabase_success IS 'True if Supabase operation succeeded (typically false for logged errors)';
COMMENT ON COLUMN sync_errors.retry_count IS 'Number of automatic retry attempts (max 3)';
COMMENT ON COLUMN sync_errors.resolved_by IS 'How the error was resolved: reconciliation_job (automatic), manual (admin), retry (automatic retry succeeded)';

-- ============================================================================
-- Monitoring Queries
-- ============================================================================

-- Count unresolved errors (should be monitored)
-- SELECT COUNT(*) FROM sync_errors WHERE resolved_at IS NULL;

-- Errors in last 24 hours
-- SELECT operation, COUNT(*), AVG(retry_count) as avg_retries
-- FROM sync_errors
-- WHERE created_at > NOW() - INTERVAL '24 hours'
-- GROUP BY operation;

-- Tasks with multiple errors (indicates systemic issue)
-- SELECT task_id, COUNT(*) as error_count, MAX(created_at) as last_error
-- FROM sync_errors
-- WHERE resolved_at IS NULL
-- GROUP BY task_id
-- HAVING COUNT(*) > 2
-- ORDER BY error_count DESC;

-- Error rate by hour (for pattern detection)
-- SELECT
--   DATE_TRUNC('hour', created_at) as hour,
--   COUNT(*) as errors,
--   COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) as resolved
-- FROM sync_errors
-- WHERE created_at > NOW() - INTERVAL '7 days'
-- GROUP BY hour
-- ORDER BY hour DESC;

-- ============================================================================
-- Maintenance Functions
-- ============================================================================

-- Function: Mark error as resolved
CREATE OR REPLACE FUNCTION resolve_sync_error(
  error_id UUID,
  resolved_by_value TEXT,
  notes TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE sync_errors
  SET
    resolved_at = NOW(),
    resolved_by = resolved_by_value,
    resolution_notes = notes
  WHERE id = error_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION resolve_sync_error IS 'Mark a sync error as resolved. Called by reconciliation job or manual intervention.';

-- Function: Bulk resolve errors for a task
CREATE OR REPLACE FUNCTION resolve_task_sync_errors(
  task_id_value TEXT,
  resolved_by_value TEXT,
  notes TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  rows_updated INTEGER;
BEGIN
  UPDATE sync_errors
  SET
    resolved_at = NOW(),
    resolved_by = resolved_by_value,
    resolution_notes = notes
  WHERE task_id = task_id_value
    AND resolved_at IS NULL;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION resolve_task_sync_errors IS 'Bulk resolve all unresolved errors for a specific task. Returns count of resolved errors.';

-- ============================================================================
-- Alerting Thresholds (Documentation)
-- ============================================================================

-- Recommended alert thresholds:
-- - Warning: > 10 unresolved errors
-- - Critical: > 50 unresolved errors
-- - Critical: > 5 errors for same task_id (indicates stuck operation)
-- - Warning: Error rate > 5% of total operations

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Check table structure
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'sync_errors'
-- ORDER BY ordinal_position;

-- Check indexes (should see 4 indexes + primary key)
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'sync_errors';

-- Check functions exist
-- SELECT routine_name, routine_type
-- FROM information_schema.routines
-- WHERE routine_name IN ('resolve_sync_error', 'resolve_task_sync_errors');

-- Count rows (should be 0 initially)
-- SELECT COUNT(*) FROM sync_errors;

-- ============================================================================
-- Cleanup Policy (Documentation)
-- ============================================================================

-- Recommended cleanup:
-- - Keep resolved errors for 30 days
-- - Keep unresolved errors indefinitely (they indicate systemic issues)
-- - Archive to separate table if > 10,000 rows

-- Cleanup query (run monthly):
-- DELETE FROM sync_errors
-- WHERE resolved_at IS NOT NULL
--   AND resolved_at < NOW() - INTERVAL '30 days';

-- ============================================================================
-- End of Migration 005
-- ============================================================================
