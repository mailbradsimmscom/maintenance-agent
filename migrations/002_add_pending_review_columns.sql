-- Migration 002: Add Pending Review Tracking
-- Created: 2025-10-30
--
-- Adds columns to track pending deduplication reviews and updates
-- the overall_status constraint to include 'pending_review'

-- Add review tracking columns
ALTER TABLE pipeline_processing_status
  ADD COLUMN IF NOT EXISTS review_url TEXT,
  ADD COLUMN IF NOT EXISTS pending_review_count INTEGER DEFAULT 0;

-- Update overall_status constraint to include 'pending_review'
ALTER TABLE pipeline_processing_status
  DROP CONSTRAINT IF EXISTS pipeline_processing_status_overall_status_check;

ALTER TABLE pipeline_processing_status
  ADD CONSTRAINT pipeline_processing_status_overall_status_check
  CHECK (overall_status IN ('not_started', 'processing', 'completed', 'failed', 'paused', 'pending_review'));

-- Update pipeline_runs status constraint to include 'pending_review'
ALTER TABLE pipeline_runs
  DROP CONSTRAINT IF EXISTS pipeline_runs_status_check;

ALTER TABLE pipeline_runs
  ADD CONSTRAINT pipeline_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'pending_review'));

-- Add comments
COMMENT ON COLUMN pipeline_processing_status.review_url IS 'URL to deduplication review page when manual review is required';
COMMENT ON COLUMN pipeline_processing_status.pending_review_count IS 'Number of duplicate pairs awaiting manual review';

-- ============================================================================
-- Verification Query
-- ============================================================================
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'pipeline_processing_status'
-- AND column_name IN ('review_url', 'pending_review_count');
