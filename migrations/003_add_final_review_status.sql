-- Migration 003: Add Final Review Status and Tracking
-- Created: 2025-10-31
--
-- Adds support for Step 6 (Classify+Discover) and Step 7 (Final Review)
-- - Adds 'pending_final_review' status
-- - Adds final_review_completed boolean column

-- Add final review completed tracking column
ALTER TABLE pipeline_processing_status
  ADD COLUMN IF NOT EXISTS final_review_completed BOOLEAN DEFAULT FALSE;

-- Update overall_status constraint to include 'pending_final_review'
ALTER TABLE pipeline_processing_status
  DROP CONSTRAINT IF EXISTS pipeline_processing_status_overall_status_check;

ALTER TABLE pipeline_processing_status
  ADD CONSTRAINT pipeline_processing_status_overall_status_check
  CHECK (overall_status IN (
    'not_started',
    'processing',
    'completed',
    'failed',
    'paused',
    'pending_review',
    'pending_final_review'
  ));

-- Update pipeline_runs status constraint to include 'pending_final_review'
ALTER TABLE pipeline_runs
  DROP CONSTRAINT IF EXISTS pipeline_runs_status_check;

ALTER TABLE pipeline_runs
  ADD CONSTRAINT pipeline_runs_status_check
  CHECK (status IN (
    'running',
    'completed',
    'failed',
    'cancelled',
    'pending_review',
    'pending_final_review'
  ));

-- Add comments
COMMENT ON COLUMN pipeline_processing_status.final_review_completed IS 'Set to true when user completes final task review in maintenance-tasks-list.html';

-- ============================================================================
-- Verification Query
-- ============================================================================
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'pipeline_processing_status'
-- AND column_name = 'final_review_completed';
