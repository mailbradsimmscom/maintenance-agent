-- Fix for the trigger - use the correct function name

-- Option 1: If update_updated_at_column() already exists in your DB, just create the trigger:
CREATE TRIGGER update_user_tasks_updated_at
  BEFORE UPDATE ON user_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Option 2: If the function doesn't exist at all, create it first:
/*
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_tasks_updated_at
  BEFORE UPDATE ON user_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
*/