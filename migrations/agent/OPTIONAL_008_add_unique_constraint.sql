/**
 * OPTIONAL Migration 008: Add unique constraint on asset_uid
 *
 * Current state: maintenance_agent_memory has 'id' as primary key
 * Code expects: One row per asset_uid (uses asset_uid for upserts)
 *
 * This migration adds a unique constraint to ensure one row per system.
 * OPTIONAL because the code will still work without it, but this prevents
 * duplicate entries for the same system.
 */

-- Add unique constraint on asset_uid
ALTER TABLE maintenance_agent_memory
ADD CONSTRAINT maintenance_agent_memory_asset_uid_unique
UNIQUE (asset_uid);

-- Add index for faster lookups (if not already exists)
CREATE INDEX IF NOT EXISTS idx_agent_memory_asset_uid
  ON maintenance_agent_memory(asset_uid);

-- Make asset_uid NOT NULL (optional - only if you want stricter validation)
-- Uncomment the line below if you want to enforce asset_uid is always present:
-- ALTER TABLE maintenance_agent_memory ALTER COLUMN asset_uid SET NOT NULL;

COMMENT ON CONSTRAINT maintenance_agent_memory_asset_uid_unique
  ON maintenance_agent_memory IS
  'Ensures one memory record per system (asset_uid)';
