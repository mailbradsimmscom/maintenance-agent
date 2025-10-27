-- User Tasks Table (FIXED VERSION)
-- Custom tasks created by users that appear in their todo list

-- First ensure the trigger function exists (may already exist)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the user_tasks table
CREATE TABLE IF NOT EXISTS user_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core fields
  description TEXT NOT NULL,
  asset_uid UUID REFERENCES systems(asset_uid) ON DELETE SET NULL, -- NULL = General task

  -- Scheduling
  due_date TIMESTAMPTZ NOT NULL,
  is_recurring BOOLEAN DEFAULT false,
  frequency_basis TEXT CHECK (frequency_basis IN ('calendar', 'usage')), -- NULL for one-time
  frequency_value INTEGER, -- e.g., 30 (days) or 50 (hours)
  frequency_unit TEXT CHECK (frequency_unit IN ('days', 'hours')), -- matches frequency_basis

  -- Status tracking
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'deleted')),
  completed_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  completion_count INTEGER DEFAULT 0,

  -- Metadata
  notes TEXT,
  created_by TEXT DEFAULT 'user',
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient queries
CREATE INDEX idx_user_tasks_status ON user_tasks(status);
CREATE INDEX idx_user_tasks_due_date ON user_tasks(due_date);
CREATE INDEX idx_user_tasks_asset_uid ON user_tasks(asset_uid);
CREATE INDEX idx_user_tasks_created_at ON user_tasks(created_at);

-- Trigger to update updated_at timestamp (FIXED - using correct function name)
CREATE TRIGGER update_user_tasks_updated_at
  BEFORE UPDATE ON user_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE user_tasks IS 'User-created custom tasks and reminders';
COMMENT ON COLUMN user_tasks.description IS 'What needs to be done';
COMMENT ON COLUMN user_tasks.asset_uid IS 'Link to specific system, NULL for general tasks';
COMMENT ON COLUMN user_tasks.due_date IS 'When the task is due';
COMMENT ON COLUMN user_tasks.is_recurring IS 'Whether task repeats after completion';
COMMENT ON COLUMN user_tasks.frequency_basis IS 'calendar (date-based) or usage (hours-based)';
COMMENT ON COLUMN user_tasks.frequency_value IS 'How often it repeats (e.g., every 30)';
COMMENT ON COLUMN user_tasks.frequency_unit IS 'Units for frequency (days or hours)';
COMMENT ON COLUMN user_tasks.status IS 'active, paused, completed, or soft-deleted';
COMMENT ON COLUMN user_tasks.priority IS 'Task priority for sorting in UI';

-- Grant permissions (adjust as needed)
GRANT SELECT, INSERT, UPDATE, DELETE ON user_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_tasks TO service_role;