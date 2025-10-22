/**
 * Capture raw Pinecone results for all systems
 * NO OpenAI extraction - just store scores for analysis
 */

import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SCORE_THRESHOLD = 0.30;
const BATCH_SIZE = 10;

async function captureAllPineconeScores() {
  console.log('\n=== CAPTURING PINECONE SCORES FOR ALL SYSTEMS ===\n');
  console.log(`Score threshold: ${SCORE_THRESHOLD}`);
  console.log(`Batch size: ${BATCH_SIZE}\n`);

  // Check for filter arguments
  const args = process.argv.slice(2);
  const systemIndex = args.indexOf('--system');
  const assetUidIndex = args.indexOf('--asset-uid');
  const isTestMode = args.includes('--test');

  const systemFilter = systemIndex !== -1 ? args[systemIndex + 1] : null;
  const assetUidFilter = assetUidIndex !== -1 ? args[assetUidIndex + 1] : null;

  // Determine table name
  const tableName = isTestMode ? 'pinecone_search_results_test' : 'pinecone_search_results';

  if (isTestMode) {
    console.log('🧪 TEST MODE - Writing to pinecone_search_results_test table\n');
  }

  // Create table if it doesn't exist
  console.log(`Ensuring ${tableName} table exists...`);
  const { error: tableError } = await supabase
    .from(tableName)
    .select('count')
    .limit(0);

  if (tableError && tableError.message.includes('does not exist')) {
    console.log(`⚠️  Table does not exist. Please run the migration:`);
    console.log('   migrations/agent/002_create_pinecone_results_temp.sql');
    console.log('   in your Supabase SQL editor\n');
    return;
  }
  console.log('✅ Table ready\n');

  // Get systems (with optional filters)
  let query = supabase
    .from('systems')
    .select('asset_uid, description, manufacturer_norm, model_norm, system_norm');

  if (systemFilter) {
    console.log(`🔍 Filtering by system name: "${systemFilter}"\n`);
    query = query.ilike('description', `%${systemFilter}%`);
  }

  if (assetUidFilter) {
    console.log(`🔍 Filtering by asset_uid: "${assetUidFilter}"\n`);
    query = query.eq('asset_uid', assetUidFilter);
  }

  const { data: systems, error } = await query;

  if (error) {
    console.error('Failed to fetch systems:', error);
    return;
  }

  const isFiltered = systemFilter || assetUidFilter;
  console.log(`Total systems${isFiltered ? ' (filtered)' : ''}: ${systems.length}\n`);

  if (isFiltered && systems.length > 0) {
    console.log('Systems to process:');
    systems.forEach(s => console.log(`  - ${s.description || `${s.manufacturer_norm} ${s.model_norm}`} (${s.asset_uid})`));
    console.log('');
  }

  const index = pinecone.index(process.env.PINECONE_INDEX_NAME);

  // Create maintenance query embedding (only once!)
  console.log('Creating query embedding...');
  const maintenanceQuery = 'maintenance schedule inspection service interval replacement';

  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: maintenanceQuery,
    dimensions: 3072
  });
  const queryVector = embeddingResponse.data[0].embedding;
  console.log('✅ Embedding created\n');

  let totalChunksFound = 0;
  let systemsWithChunks = 0;
  let processedCount = 0;

  // Process in batches
  for (let i = 0; i < systems.length; i += BATCH_SIZE) {
    const batch = systems.slice(i, i + BATCH_SIZE);

    console.log(`\n--- Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(systems.length / BATCH_SIZE)} ---`);

    for (const system of batch) {
      processedCount++;
      const systemName = system.description || `${system.manufacturer_norm} ${system.model_norm}`;

      process.stdout.write(`[${processedCount}/${systems.length}] ${systemName.substring(0, 40)}...`);

      try {
        // Query Pinecone
        const results = await index.namespace('REIMAGINEDDOCS').query({
          vector: queryVector,
          topK: 20,
          filter: { 'linked_asset_uid': { $eq: system.asset_uid } },
          includeMetadata: true
        });

        const relevantChunks = (results.matches || []).filter(m => m.score >= SCORE_THRESHOLD);

        if (relevantChunks.length > 0) {
          systemsWithChunks++;
          totalChunksFound += relevantChunks.length;

          // Store in database
          const records = relevantChunks.map(chunk => ({
            asset_uid: system.asset_uid,
            system_name: systemName,
            manufacturer: system.manufacturer_norm,
            model: system.model_norm,
            chunk_id: chunk.id,
            doc_id: chunk.metadata?.doc_id,
            relevance_score: chunk.score,
            section_title: chunk.metadata?.section_title,
            content_snippet: chunk.metadata?.content_snippet?.substring(0, 200),
            has_lists: chunk.metadata?.has_lists,
            has_tables: chunk.metadata?.has_tables,
            page_start: chunk.metadata?.page_start,
            page_end: chunk.metadata?.page_end,
            chunk_metadata: chunk.metadata,
            type: 'generic' // Mark as generic search
          }));

          const { error: insertError } = await supabase
            .from(tableName)
            .insert(records);

          if (insertError) {
            console.log(` ❌ DB error`);
            console.error(insertError);
          } else {
            console.log(` ✅ ${relevantChunks.length} chunks (scores: ${relevantChunks[0].score.toFixed(3)}-${relevantChunks[relevantChunks.length-1].score.toFixed(3)})`);
          }
        } else {
          console.log(` - no chunks`);
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.log(` ❌ Error: ${error.message}`);
      }
    }
  }

  console.log('\n\n=== SUMMARY ===');
  console.log(`Systems processed: ${processedCount}`);
  console.log(`Systems with chunks: ${systemsWithChunks}`);
  console.log(`Total chunks found: ${totalChunksFound}`);
  console.log(`Average chunks per system: ${(totalChunksFound / systemsWithChunks).toFixed(1)}`);

  // Get score distribution
  console.log('\n=== SCORE DISTRIBUTION ===');
  const { data: distribution } = await supabase
    .from(tableName)
    .select('relevance_score')
    .order('relevance_score', { ascending: false });

  if (distribution && distribution.length > 0) {
    const scores = distribution.map(r => r.relevance_score);
    console.log(`Highest score: ${Math.max(...scores).toFixed(4)}`);
    console.log(`Lowest score: ${Math.min(...scores).toFixed(4)}`);
    console.log(`Median score: ${scores[Math.floor(scores.length / 2)].toFixed(4)}`);

    // Score buckets
    const buckets = {
      '0.30-0.40': 0,
      '0.40-0.50': 0,
      '0.50-0.60': 0,
      '0.60-0.70': 0,
      '0.70+': 0
    };

    scores.forEach(score => {
      if (score >= 0.70) buckets['0.70+']++;
      else if (score >= 0.60) buckets['0.60-0.70']++;
      else if (score >= 0.50) buckets['0.50-0.60']++;
      else if (score >= 0.40) buckets['0.40-0.50']++;
      else buckets['0.30-0.40']++;
    });

    console.log('\nScore Buckets:');
    Object.entries(buckets).forEach(([range, count]) => {
      const pct = ((count / scores.length) * 100).toFixed(1);
      console.log(`  ${range}: ${count} (${pct}%)`);
    });
  }

  console.log(`\n✅ Done! Results stored in ${tableName} table\n`);
}

captureAllPineconeScores().catch(console.error);