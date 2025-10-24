--
-- Phase 1: System Maintenance and Hours History Tables
-- Created: 2025-10-23
-- Purpose: Track current operational state and complete audit trail of hour readings
--

--
-- Table 1: system_maintenance
-- Purpose: Current operational state per system
--
CREATE TABLE system_maintenance (
  asset_uid UUID PRIMARY KEY
    REFERENCES systems(asset_uid) ON DELETE CASCADE,
  current_operating_hours INTEGER NOT NULL DEFAULT 0
    CHECK (current_operating_hours >= 0),
  installation_date TIMESTAMPTZ,
  last_hours_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_system_maintenance_hours
  ON system_maintenance(current_operating_hours);
CREATE INDEX idx_system_maintenance_updated
  ON system_maintenance(last_hours_update);

COMMENT ON TABLE system_maintenance IS
  'Current operational state for systems with usage-based maintenance';
COMMENT ON COLUMN system_maintenance.installation_date IS
  'Auto-set on first hours entry if NULL';

-- Add updated_at trigger
CREATE TRIGGER system_maintenance_updated_at
  BEFORE UPDATE ON system_maintenance
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

--
-- Table 2: system_hours_history
-- Purpose: Complete audit trail of all hour meter readings
--
CREATE TABLE system_hours_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_uid UUID NOT NULL
    REFERENCES systems(asset_uid) ON DELETE CASCADE,
  hours INTEGER NOT NULL CHECK (hours >= 0),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_by TEXT NOT NULL DEFAULT 'user',
  notes TEXT,
  meter_replaced BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hours_history_asset
  ON system_hours_history(asset_uid, submitted_at DESC);
CREATE INDEX idx_hours_history_submitted
  ON system_hours_history(submitted_at DESC);

COMMENT ON TABLE system_hours_history IS
  'Audit trail of all hour meter readings with validation support';
COMMENT ON COLUMN system_hours_history.meter_replaced IS
  'TRUE allows lower reading than previous (with required note)';
