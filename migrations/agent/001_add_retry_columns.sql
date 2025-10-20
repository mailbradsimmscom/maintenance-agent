-- Migration: Add retry tracking columns to maintenance_agent_memory
-- Date: 2025-10-19
-- Author: Maintenance Agent Team

-- UP Migration
ALTER TABLE maintenance_agent_memory
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

ALTER TABLE maintenance_agent_memory
ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE maintenance_agent_memory
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE maintenance_agent_memory
ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE maintenance_agent_memory
ADD COLUMN IF NOT EXISTS tasks_queued INTEGER DEFAULT 0;

-- Add index for finding systems that need retry
CREATE INDEX IF NOT EXISTS idx_memory_retry
ON maintenance_agent_memory(next_retry_at)
WHERE processing_status = 'failed';

-- DOWN Migration (Rollback)
-- ALTER TABLE maintenance_agent_memory DROP COLUMN IF EXISTS retry_count;
-- ALTER TABLE maintenance_agent_memory DROP COLUMN IF EXISTS last_retry_at;
-- ALTER TABLE maintenance_agent_memory DROP COLUMN IF EXISTS next_retry_at;
-- ALTER TABLE maintenance_agent_memory DROP COLUMN IF EXISTS last_error;
-- ALTER TABLE maintenance_agent_memory DROP COLUMN IF EXISTS tasks_queued;
-- DROP INDEX IF EXISTS idx_memory_retry;