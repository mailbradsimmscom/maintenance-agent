--
-- Phase 1: Schema Verification Queries
-- Created: 2025-10-23
-- Purpose: Verify all tables, indexes, and triggers were created successfully
--

-- ========================================
-- 1. Verify Tables Exist
-- ========================================
SELECT tablename, schemaname
FROM pg_tables
WHERE tablename IN (
  'system_maintenance',
  'system_hours_history',
  'boatos_tasks',
  'task_completions'
)
ORDER BY tablename;
-- Expected: 4 rows

-- ========================================
-- 2. Verify Columns and Types
-- ========================================

-- system_maintenance
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'system_maintenance'
ORDER BY ordinal_position;
-- Expected: asset_uid, current_operating_hours, installation_date, last_hours_update, created_at, updated_at

-- system_hours_history
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'system_hours_history'
ORDER BY ordinal_position;
-- Expected: id, asset_uid, hours, submitted_at, submitted_by, notes, meter_replaced, created_at

-- boatos_tasks
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'boatos_tasks'
ORDER BY ordinal_position;
-- Expected: id, task_type, asset_uid, frequency_days, last_completed, next_due, last_dismissed, is_active, created_at, updated_at

-- task_completions
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'task_completions'
ORDER BY ordinal_position;
-- Expected: id, task_id, asset_uid, completed_at, hours_at_completion, completed_by, source_type, notes, created_at

-- ========================================
-- 3. Verify Indexes
-- ========================================
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN (
  'system_maintenance',
  'system_hours_history',
  'boatos_tasks',
  'task_completions'
)
ORDER BY tablename, indexname;
-- Expected: Multiple indexes per table

-- ========================================
-- 4. Verify Foreign Keys
-- ========================================
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.update_rule,
  rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN (
    'system_maintenance',
    'system_hours_history',
    'boatos_tasks',
    'task_completions'
  )
ORDER BY tc.table_name;
-- Expected: All should reference systems(asset_uid) with ON DELETE CASCADE

-- ========================================
-- 5. Verify Triggers
-- ========================================
SELECT
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE event_object_table IN ('system_maintenance', 'boatos_tasks')
ORDER BY event_object_table, trigger_name;
-- Expected: 2 triggers (one for system_maintenance, one for boatos_tasks)

-- ========================================
-- 6. Verify Trigger Function
-- ========================================
SELECT
  proname AS function_name,
  pg_get_functiondef(oid) AS function_definition
FROM pg_proc
WHERE proname = 'update_updated_at_column';
-- Expected: 1 function

-- ========================================
-- 7. Verify Check Constraints
-- ========================================
SELECT
  tc.table_name,
  tc.constraint_name,
  cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc
  ON tc.constraint_name = cc.constraint_name
WHERE tc.table_name IN (
  'system_maintenance',
  'system_hours_history',
  'boatos_tasks',
  'task_completions'
)
ORDER BY tc.table_name, tc.constraint_name;
-- Expected: Check constraints on hours >= 0, frequency_days > 0, source_type IN (...), etc.

-- ========================================
-- 8. Verify Table Comments
-- ========================================
SELECT
  c.relname AS table_name,
  d.description AS table_comment
FROM pg_class c
LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = 0
WHERE c.relname IN (
  'system_maintenance',
  'system_hours_history',
  'boatos_tasks',
  'task_completions'
)
ORDER BY c.relname;
-- Expected: All tables should have descriptive comments

-- ========================================
-- 9. Test Insert/Update/Delete
-- ========================================

-- NOTE: These are test queries - they will modify data!
-- Only run in development/testing environments!

/*
-- Test system_maintenance
INSERT INTO system_maintenance (asset_uid, current_operating_hours)
VALUES ('00000000-0000-0000-0000-000000000001', 100);

UPDATE system_maintenance
SET current_operating_hours = 150
WHERE asset_uid = '00000000-0000-0000-0000-000000000001';
-- Verify updated_at was automatically updated

SELECT * FROM system_maintenance
WHERE asset_uid = '00000000-0000-0000-0000-000000000001';

DELETE FROM system_maintenance
WHERE asset_uid = '00000000-0000-0000-0000-000000000001';
*/

-- ========================================
-- 10. Summary Report
-- ========================================
SELECT 'Phase 1 Schema Verification Complete' AS status,
       (SELECT COUNT(*) FROM pg_tables
        WHERE tablename IN ('system_maintenance', 'system_hours_history',
                           'boatos_tasks', 'task_completions')) AS tables_created,
       (SELECT COUNT(*) FROM pg_proc WHERE proname = 'update_updated_at_column') AS functions_created,
       (SELECT COUNT(*) FROM information_schema.triggers
        WHERE event_object_table IN ('system_maintenance', 'boatos_tasks')) AS triggers_created;
-- Expected: tables_created=4, functions_created=1, triggers_created=2
