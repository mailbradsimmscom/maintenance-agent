--
-- Phase 1: Trigger Function for updated_at columns
-- Created: 2025-10-23
-- Purpose: Automatically update updated_at timestamp on row updates
--

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column() IS
  'Trigger function to automatically update updated_at column on UPDATE';
