/**
 * Verification for Migration 007: Maintenance Agent Memory
 * Run this after executing 007_maintenance_agent_memory.sql
 */

-- Check table exists
SELECT
  'Table Exists' as check_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'maintenance_agent_memory'
    ) THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as status;

-- Check all required columns exist
SELECT
  'All Columns Exist' as check_name,
  CASE
    WHEN (
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_name = 'maintenance_agent_memory'
      AND column_name IN (
        'asset_uid',
        'processing_status',
        'processing_stage',
        'last_manual_extraction',
        'last_realworld_search',
        'last_dependency_check',
        'manual_tasks_count',
        'realworld_tasks_count',
        'inferred_tasks_count',
        'total_tasks_found',
        'tasks_queued',
        'last_error',
        'retry_count',
        'created_at',
        'updated_at'
      )
    ) = 15 THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as status;

-- Check foreign key constraint
SELECT
  'Foreign Key to systems' as check_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'maintenance_agent_memory'
      AND constraint_type = 'FOREIGN KEY'
    ) THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as status;

-- Check indexes
SELECT
  'Indexes Created' as check_name,
  CASE
    WHEN (
      SELECT COUNT(*)
      FROM pg_indexes
      WHERE tablename = 'maintenance_agent_memory'
      AND indexname LIKE 'idx_agent_memory%'
    ) >= 3 THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as status;

-- Check trigger
SELECT
  'Updated At Trigger' as check_name,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.triggers
      WHERE event_object_table = 'maintenance_agent_memory'
      AND trigger_name = 'maintenance_agent_memory_updated_at'
    ) THEN '✅ PASS'
    ELSE '❌ FAIL'
  END as status;

-- Show column details
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'maintenance_agent_memory'
ORDER BY ordinal_position;
