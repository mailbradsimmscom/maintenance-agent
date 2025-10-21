-- Migration: Fix action_taken constraint to allow 'deleted_both'
-- This finds and drops the existing constraint, then recreates it

-- First, find and drop ALL check constraints on action_taken
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'duplicate_review_decisions'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%action_taken%'
    LOOP
        EXECUTE format('ALTER TABLE duplicate_review_decisions DROP CONSTRAINT %I', constraint_name);
        RAISE NOTICE 'Dropped constraint: %', constraint_name;
    END LOOP;
END $$;

-- Add the new constraint with 'deleted_both' included
ALTER TABLE duplicate_review_decisions
ADD CONSTRAINT duplicate_review_decisions_action_taken_check
CHECK (action_taken IN ('deleted_task_a', 'deleted_task_b', 'deleted_both', 'kept_both'));

-- Verify
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'duplicate_review_decisions'::regclass
  AND contype = 'c'
  AND conname LIKE '%action_taken%';
