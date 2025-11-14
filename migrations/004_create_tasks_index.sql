-- Migration 004: Maintenance Tasks Index Table
-- Phase: Todo List Performance Optimization
-- Created: 2025-11-11
--
-- Description:
-- Creates a PostgreSQL table to mirror Pinecone task metadata for fast querying.
-- This enables sub-100ms todo list queries instead of 6+ second Pinecone fetches.
--
-- Architecture:
-- - Pinecone = source of truth for embeddings and search
-- - Supabase = source of truth for filtering and queries
-- - Dual-write on every task operation (upsert/update/delete)
-- - Nightly reconciliation job ensures consistency
--
-- Run this in Supabase SQL Editor

-- ============================================================================
-- Table: maintenance_tasks_index
-- Fast queryable index of all maintenance tasks
-- ============================================================================

CREATE TABLE IF NOT EXISTS maintenance_tasks_index (
  -- Identity (matches Pinecone task ID)
  id TEXT PRIMARY KEY,
  asset_uid UUID REFERENCES systems(asset_uid) ON DELETE CASCADE,
  description TEXT NOT NULL,
  system_name TEXT,

  -- Scheduling
  frequency_basis TEXT CHECK (frequency_basis IS NULL OR frequency_basis IN ('usage', 'calendar')),
  frequency_value INTEGER,  -- Hours for usage-based, days for calendar-based
  is_recurring BOOLEAN DEFAULT true,

  -- Due tracking
  next_due_hours INTEGER,       -- For usage-based tasks (hours)
  next_due_date TIMESTAMPTZ,    -- For calendar-based tasks

  -- Status
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected')),

  -- Completion history
  last_completed_at TIMESTAMPTZ,
  completion_count INTEGER DEFAULT 0,

  -- Classification (from Step 6)
  task_category TEXT,           -- 'preventive', 'inspection', 'service', etc.
  criticality TEXT,             -- 'critical', 'important', 'routine'
  confidence NUMERIC(3,2),      -- 0.00 to 1.00

  -- Source tracking
  source_step INTEGER,          -- 3 (extract) or 6 (discover)
  source_type TEXT,             -- 'manual', 'llm', 'inference'

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()  -- Last successful sync with Pinecone
);

-- ============================================================================
-- Indexes for Fast Queries
-- ============================================================================

-- Index 1: Usage-based approved tasks (for todo list)
-- WHERE clause makes this a partial index (smaller and faster)
CREATE INDEX IF NOT EXISTS idx_tasks_approved_due_hours
  ON maintenance_tasks_index(review_status, next_due_hours)
  WHERE review_status = 'approved' AND frequency_basis = 'usage';

-- Index 2: Calendar-based approved tasks (for todo list)
CREATE INDEX IF NOT EXISTS idx_tasks_approved_due_date
  ON maintenance_tasks_index(review_status, next_due_date)
  WHERE review_status = 'approved' AND frequency_basis = 'calendar';

-- Index 3: Tasks by asset (for system-specific queries)
CREATE INDEX IF NOT EXISTS idx_tasks_by_asset
  ON maintenance_tasks_index(asset_uid, review_status);

-- Index 4: Pending review tasks (for approval workflow)
CREATE INDEX IF NOT EXISTS idx_tasks_pending_review
  ON maintenance_tasks_index(review_status, created_at DESC)
  WHERE review_status = 'pending';

-- Index 5: Sync timestamp (for reconciliation job)
CREATE INDEX IF NOT EXISTS idx_tasks_synced_at
  ON maintenance_tasks_index(synced_at);

-- Index 6: Task category (for filtering/reporting)
CREATE INDEX IF NOT EXISTS idx_tasks_category
  ON maintenance_tasks_index(task_category)
  WHERE task_category IS NOT NULL;

-- ============================================================================
-- Auto-update Timestamp Trigger
-- ============================================================================

-- Reuse existing function from migration 001
DROP TRIGGER IF EXISTS update_tasks_index_timestamp ON maintenance_tasks_index;
CREATE TRIGGER update_tasks_index_timestamp
  BEFORE UPDATE ON maintenance_tasks_index
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE maintenance_tasks_index IS 'Fast queryable mirror of Pinecone MAINTENANCE_TASKS namespace. Enables sub-100ms queries for todo lists and approval workflows.';

COMMENT ON COLUMN maintenance_tasks_index.id IS 'Matches Pinecone vector ID (format: asset_uid|hash)';
COMMENT ON COLUMN maintenance_tasks_index.frequency_basis IS 'usage = hours-based, calendar = date-based';
COMMENT ON COLUMN maintenance_tasks_index.next_due_hours IS 'For usage-based tasks: due when system reaches this hour count';
COMMENT ON COLUMN maintenance_tasks_index.next_due_date IS 'For calendar-based tasks: due on this date';
COMMENT ON COLUMN maintenance_tasks_index.review_status IS 'pending = awaiting approval, approved = active in schedule, rejected = dismissed';
COMMENT ON COLUMN maintenance_tasks_index.synced_at IS 'Last successful sync with Pinecone (for reconciliation)';
COMMENT ON COLUMN maintenance_tasks_index.source_step IS 'Which pipeline step created this: 3=extraction, 6=discovery';

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Check table structure
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'maintenance_tasks_index'
-- ORDER BY ordinal_position;

-- Check indexes (should see 6 indexes + primary key)
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'maintenance_tasks_index';

-- Count rows (should be 0 initially, 407 after migration)
-- SELECT COUNT(*) FROM maintenance_tasks_index;

-- ============================================================================
-- Performance Notes
-- ============================================================================

-- Expected query performance:
-- - Todo list (approved + due): <100ms (uses idx_tasks_approved_due_*)
-- - Pending tasks (approval workflow): <50ms (uses idx_tasks_pending_review)
-- - System-specific tasks: <50ms (uses idx_tasks_by_asset)
--
-- Maintenance:
-- - Table size: ~1KB per task (407 tasks = ~400KB currently)
-- - Index size: ~50KB per index (~300KB total for 6 indexes)
-- - VACUUM recommended monthly if tasks deleted frequently

-- ============================================================================
-- End of Migration 004
-- ============================================================================
