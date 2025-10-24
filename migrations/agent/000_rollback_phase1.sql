--
-- Phase 1: ROLLBACK Script
-- Created: 2025-10-23
-- Purpose: Safely remove all Phase 1 tables and functions
--
-- WARNING: This will delete all data in these tables!
-- Only run if you need to completely undo Phase 1 migration
--

-- Drop tables in reverse order (respecting foreign keys)
DROP TABLE IF EXISTS task_completions CASCADE;
DROP TABLE IF EXISTS boatos_tasks CASCADE;
DROP TABLE IF EXISTS system_hours_history CASCADE;
DROP TABLE IF EXISTS system_maintenance CASCADE;

-- Drop trigger function
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Verification: List any remaining objects
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'task_completions',
    'boatos_tasks',
    'system_hours_history',
    'system_maintenance'
  );

-- Should return 0 rows if rollback successful
