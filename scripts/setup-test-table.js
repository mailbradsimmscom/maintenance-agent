/**
 * Create test table: pinecone_search_results_test
 * Copy structure from pinecone_search_results
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function setupTestTable() {
  console.log('\n=== CREATING TEST TABLE ===\n');

  // SQL to create test table (same structure as original)
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS pinecone_search_results_test (
      LIKE pinecone_search_results INCLUDING ALL
    );
  `;

  console.log('Creating: pinecone_search_results_test');
  console.log('Structure: Copy of pinecone_search_results\n');

  const { error } = await supabase.rpc('exec_sql', { sql: createTableSQL });

  if (error) {
    console.error('❌ Failed to create table:', error);
    console.log('\nManual SQL (run in Supabase SQL editor):');
    console.log(createTableSQL);
    return;
  }

  console.log('✅ Test table created\n');

  // Check row count
  const { count, error: countError } = await supabase
    .from('pinecone_search_results_test')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.log('Note: Could not verify table - may need to run SQL manually');
  } else {
    console.log(`Current rows in test table: ${count || 0}`);
  }

  console.log('\n=== NEXT STEPS ===');
  console.log('1. Copy specific rows:');
  console.log('   node scripts/copy-to-test-table.js --limit 5');
  console.log('\n2. Run extraction on test table:');
  console.log('   node scripts/extract-enrich-and-upload-tasks-TEST.js');
  console.log('');
}

setupTestTable().catch(console.error);
