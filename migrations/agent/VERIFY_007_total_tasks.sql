/**
 * Verification for Migration 007: total_tasks_found column
 * Run this after executing 007_add_total_tasks_found.sql
 */

-- Check that total_tasks_found column now exists
SELECT
  'total_tasks_found column exists' as check_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'maintenance_agent_memory'
      AND column_name = 'total_tasks_found'
    ) THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as status;

-- Show the column details
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'maintenance_agent_memory'
AND column_name = 'total_tasks_found';

-- Count how many rows exist (should work without error now)
SELECT
  COUNT(*) as total_rows,
  COUNT(total_tasks_found) as rows_with_tasks_found,
  SUM(total_tasks_found) as total_tasks_across_all_systems
FROM maintenance_agent_memory;
