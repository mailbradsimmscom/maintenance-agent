/**
 * Copy rows from pinecone_search_results → pinecone_search_results_test
 *
 * Usage:
 *   node scripts/copy-to-test-table.js --system "yanmar" --clear
 *   node scripts/copy-to-test-table.js --limit 10
 *   node scripts/copy-to-test-table.js --system "yanmar" --limit 20 --clear
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function copyToTestTable() {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const systemIndex = args.indexOf('--system');
  const systemFilter = systemIndex !== -1 ? args[systemIndex + 1] : null;

  // Default limit: 1000 if system filter, 5 otherwise
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : (systemFilter ? 1000 : 5);

  const clearIndex = args.indexOf('--clear');
  const shouldClear = clearIndex !== -1;

  console.log('\n=== COPY TO TEST TABLE ===\n');

  // Clear test table if requested
  if (shouldClear) {
    console.log('Clearing test table...');
    const { error: deleteError } = await supabase
      .from('pinecone_search_results_test')
      .delete()
      .not('id', 'is', null); // Delete all rows

    if (deleteError) {
      console.error('❌ Failed to clear:', deleteError);
      return;
    }
    console.log('✅ Test table cleared\n');
  }

  // Get rows with score >= 30%
  let query = supabase
    .from('pinecone_search_results')
    .select('*')
    .gte('relevance_score', 0.30);

  if (systemFilter) {
    console.log(`🔍 Filtering for system: "${systemFilter}"\n`);
    query = query.ilike('system_name', `%${systemFilter}%`);
  } else {
    console.log('No system filter - fetching all systems\n');
  }

  query = query.order('relevance_score', { ascending: false }).limit(limit);

  console.log(`Fetching ${systemFilter ? systemFilter + ' ' : ''}rows (score >= 0.30)...`);

  const { data: rows, error: fetchError } = await query;

  if (fetchError) {
    console.error('❌ Failed to fetch:', fetchError);
    return;
  }

  console.log(`Found ${rows.length} rows\n`);

  if (rows.length === 0) {
    console.log('⚠️  No rows to copy');
    return;
  }

  // Show what we're copying
  rows.forEach((row, i) => {
    console.log(`[${i + 1}] ${row.system_name} | Score: ${row.relevance_score}`);
  });

  // Remove 'id' field (let database generate new ones)
  const rowsToInsert = rows.map(({ id, ...rest }) => rest);

  console.log(`\nInserting ${rowsToInsert.length} rows into test table...`);
  const { error: insertError } = await supabase
    .from('pinecone_search_results_test')
    .insert(rowsToInsert);

  if (insertError) {
    console.error('❌ Failed to insert:', insertError);
    return;
  }

  console.log('✅ Rows copied successfully\n');

  // Verify
  const { count } = await supabase
    .from('pinecone_search_results_test')
    .select('*', { count: 'exact', head: true });

  console.log(`Total rows in test table: ${count}`);
  console.log('\n✅ Ready to test extraction!\n');
}

copyToTestTable().catch(console.error);
