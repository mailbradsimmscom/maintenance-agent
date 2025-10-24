/**
 * Migration 007: Add missing total_tasks_found column
 * Fixes: "Could not find the 'total_tasks_found' column" error
 *
 * The maintenance_agent_memory table already exists but is missing this column
 * that the system processor job tries to write to.
 */

-- Add the missing column
ALTER TABLE maintenance_agent_memory
ADD COLUMN IF NOT EXISTS total_tasks_found INTEGER DEFAULT 0 CHECK (total_tasks_found >= 0);

-- Add comment
COMMENT ON COLUMN maintenance_agent_memory.total_tasks_found IS
  'Sum of manual_tasks_count + realworld_tasks_count + inferred_tasks_count';

-- Create index on this column for performance
CREATE INDEX IF NOT EXISTS idx_agent_memory_total_tasks
  ON maintenance_agent_memory(total_tasks_found);
