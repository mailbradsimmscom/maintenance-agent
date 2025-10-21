import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Query to get constraint information
const { data, error } = await supabase.rpc('exec_sql', {
  sql: `
    SELECT
      conname AS constraint_name,
      pg_get_constraintdef(oid) AS constraint_definition
    FROM pg_constraint
    WHERE conrelid = 'duplicate_review_decisions'::regclass
      AND contype = 'c';
  `
});

if (error) {
  console.error('Error:', error);
  console.log('\nRun this query in Supabase SQL Editor instead:');
  console.log(`
SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'duplicate_review_decisions'::regclass
  AND contype = 'c';
  `);
} else {
  console.log('Constraints on duplicate_review_decisions:');
  console.log(JSON.stringify(data, null, 2));
}
