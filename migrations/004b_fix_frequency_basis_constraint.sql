-- Migration 004b: Fix frequency_basis constraint to allow NULL
-- Created: 2025-11-11
-- Purpose: Allow NULL values for frequency_basis (for pending/incomplete tasks)

-- Drop existing constraint
ALTER TABLE maintenance_tasks_index
  DROP CONSTRAINT IF EXISTS maintenance_tasks_index_frequency_basis_check;

-- Add new constraint that allows NULL
ALTER TABLE maintenance_tasks_index
  ADD CONSTRAINT maintenance_tasks_index_frequency_basis_check
  CHECK (frequency_basis IS NULL OR frequency_basis IN ('usage', 'calendar'));

-- Verify
-- SELECT COUNT(*) FROM maintenance_tasks_index WHERE frequency_basis IS NULL;
-- Should show count of tasks with NULL frequency_basis
