-- Migration: Add 'deleted_both' to action_taken constraint
-- Date: 2025-10-20
-- Purpose: Allow "Delete Both Tasks" feature in review UI

-- Drop existing constraint
ALTER TABLE duplicate_review_decisions
DROP CONSTRAINT IF EXISTS duplicate_review_decisions_action_taken_check;

-- Add new constraint with 'deleted_both' option
ALTER TABLE duplicate_review_decisions
ADD CONSTRAINT duplicate_review_decisions_action_taken_check
CHECK (action_taken IN ('deleted_task_a', 'deleted_task_b', 'deleted_both', 'kept_both'));
