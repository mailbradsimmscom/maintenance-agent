--
-- Phase 1: BoatOS Tasks Table
-- Created: 2025-10-23
-- Purpose: System-generated prompts for user actions (autonomous BoatOS tasks)
--

CREATE TABLE boatos_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL DEFAULT 'update_usage_hours'
    CHECK (task_type IN ('update_usage_hours')),
  asset_uid UUID NOT NULL
    REFERENCES systems(asset_uid) ON DELETE CASCADE,
  frequency_days INTEGER NOT NULL DEFAULT 7 CHECK (frequency_days > 0),
  last_completed TIMESTAMPTZ,
  next_due TIMESTAMPTZ NOT NULL,
  last_dismissed TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_boatos_tasks_unique_active
  ON boatos_tasks(asset_uid, task_type)
  WHERE is_active = TRUE;

CREATE INDEX idx_boatos_tasks_asset
  ON boatos_tasks(asset_uid) WHERE is_active = TRUE;
CREATE INDEX idx_boatos_tasks_next_due
  ON boatos_tasks(next_due) WHERE is_active = TRUE;

COMMENT ON TABLE boatos_tasks IS
  'System-generated prompts for user actions (autonomous BoatOS tasks)';
COMMENT ON COLUMN boatos_tasks.task_type IS
  'Current: update_usage_hours. Future: check_spares, seasonal_checks';

-- Add updated_at trigger
CREATE TRIGGER boatos_tasks_updated_at
  BEFORE UPDATE ON boatos_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
