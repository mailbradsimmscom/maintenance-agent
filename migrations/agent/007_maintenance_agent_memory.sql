/**
 * Migration 007: Maintenance Agent Memory Table
 * Stores processing state and learning patterns for the autonomous agent
 *
 * Purpose: Track which systems have been processed and what was found
 * Used by: Autonomous background job processor
 */

-- Create maintenance_agent_memory table
CREATE TABLE IF NOT EXISTS maintenance_agent_memory (
  -- Primary key
  asset_uid UUID PRIMARY KEY
    REFERENCES systems(asset_uid) ON DELETE CASCADE,

  -- Processing status
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'in_progress', 'completed', 'failed')),
  processing_stage TEXT DEFAULT 'not_started'
    CHECK (processing_stage IN ('not_started', 'extraction', 'discovery', 'inference', 'queueing', 'completed', 'error')),

  -- Extraction timestamps
  last_manual_extraction TIMESTAMPTZ,
  last_realworld_search TIMESTAMPTZ,
  last_dependency_check TIMESTAMPTZ,

  -- Task counts (what was found)
  manual_tasks_count INTEGER DEFAULT 0 CHECK (manual_tasks_count >= 0),
  realworld_tasks_count INTEGER DEFAULT 0 CHECK (realworld_tasks_count >= 0),
  inferred_tasks_count INTEGER DEFAULT 0 CHECK (inferred_tasks_count >= 0),
  total_tasks_found INTEGER DEFAULT 0 CHECK (total_tasks_found >= 0),
  tasks_queued INTEGER DEFAULT 0 CHECK (tasks_queued >= 0),

  -- Error handling
  last_error TEXT,
  retry_count INTEGER DEFAULT 0 CHECK (retry_count >= 0),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_agent_memory_status
  ON maintenance_agent_memory(processing_status);

CREATE INDEX IF NOT EXISTS idx_agent_memory_last_extraction
  ON maintenance_agent_memory(last_manual_extraction DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memory_failed
  ON maintenance_agent_memory(processing_status, retry_count)
  WHERE processing_status = 'failed';

-- Add comments
COMMENT ON TABLE maintenance_agent_memory IS
  'Tracks autonomous agent processing state per system';

COMMENT ON COLUMN maintenance_agent_memory.processing_status IS
  'Current processing status: pending/in_progress/completed/failed';

COMMENT ON COLUMN maintenance_agent_memory.total_tasks_found IS
  'Sum of manual_tasks_count + realworld_tasks_count + inferred_tasks_count';

COMMENT ON COLUMN maintenance_agent_memory.tasks_queued IS
  'Number of tasks actually queued for review (may be less than total_tasks_found after deduplication)';

COMMENT ON COLUMN maintenance_agent_memory.retry_count IS
  'Number of times processing failed and was retried';

-- Add updated_at trigger
CREATE TRIGGER maintenance_agent_memory_updated_at
  BEFORE UPDATE ON maintenance_agent_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
