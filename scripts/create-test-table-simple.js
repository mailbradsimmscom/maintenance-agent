/**
 * Create test table by copying structure from main table
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function createTestTable() {
  console.log('\n=== CREATING TEST TABLE ===\n');

  // First, get the structure by reading from main table
  const { data: sample, error: sampleError } = await supabase
    .from('pinecone_search_results')
    .select('*')
    .limit(1);

  if (sampleError) {
    console.error('❌ Cannot read main table:', sampleError);
    return;
  }

  console.log('SQL to run in Supabase SQL Editor:\n');
  console.log('----------------------------------------');
  console.log(`
CREATE TABLE IF NOT EXISTS pinecone_search_results_test (
  LIKE pinecone_search_results INCLUDING ALL
);
  `);
  console.log('----------------------------------------\n');

  console.log('Steps:');
  console.log('1. Go to: https://supabase.com/dashboard/project/_/sql');
  console.log('2. Paste the SQL above');
  console.log('3. Click "Run"');
  console.log('4. Re-run: node scripts/copy-to-test-table.js --system "yanmar" --clear\n');
}

createTestTable().catch(console.error);
