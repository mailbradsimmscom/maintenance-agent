--
-- Phase 1: Task Completions Table
-- Created: 2025-10-23
-- Purpose: History of maintenance task completions for scheduling recurring tasks
--

CREATE TABLE task_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id TEXT NOT NULL,
  asset_uid UUID NOT NULL
    REFERENCES systems(asset_uid) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hours_at_completion INTEGER CHECK (hours_at_completion >= 0),
  completed_by TEXT NOT NULL DEFAULT 'user',
  source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'ai_inferred', 'sensor_trigger', 'user_input')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_completions_task
  ON task_completions(task_id, completed_at DESC);
CREATE INDEX idx_task_completions_asset
  ON task_completions(asset_uid, completed_at DESC);
CREATE INDEX idx_task_completions_source
  ON task_completions(source_type, completed_at DESC);

COMMENT ON TABLE task_completions IS
  'History of maintenance task completions for scheduling recurring tasks';
COMMENT ON COLUMN task_completions.hours_at_completion IS
  'Hour meter reading when completed (NULL for calendar-based tasks)';
COMMENT ON COLUMN task_completions.source_type IS
  'Provenance for audit/analytics: manual, ai_inferred, sensor_trigger, user_input';
