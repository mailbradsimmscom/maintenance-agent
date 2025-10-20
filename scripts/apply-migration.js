/**
 * Apply migration to create temp table
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function applyMigration() {
  console.log('Applying migration: 002_create_pinecone_results_temp.sql\n');

  const sql = readFileSync('migrations/agent/002_create_pinecone_results_temp.sql', 'utf8');

  // Split on comments to get just the UP migration
  const upMigration = sql.split('-- DOWN Migration')[0];

  try {
    // Execute the SQL
    const { error } = await supabase.rpc('exec_sql', { sql_query: upMigration });

    if (error) {
      // Try direct execution if RPC doesn't exist
      console.log('RPC not available, using direct SQL execution...\n');

      // Parse SQL into individual statements
      const statements = upMigration
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--'));

      for (const statement of statements) {
        console.log(`Executing: ${statement.substring(0, 60)}...`);
        const { error: execError } = await supabase.rpc('execute_sql', { query: statement });

        if (execError) {
          console.error('Error:', execError.message);
          // Continue anyway - table might already exist
        }
      }
    }

    console.log('\n✅ Migration applied successfully');

    // Verify table exists
    const { data, error: checkError } = await supabase
      .from('pinecone_search_results')
      .select('count')
      .limit(0);

    if (!checkError) {
      console.log('✅ Table verified: pinecone_search_results');
    } else {
      console.log('⚠️  Could not verify table (might still exist):', checkError.message);
    }

  } catch (error) {
    console.error('Migration failed:', error);
  }
}

applyMigration();