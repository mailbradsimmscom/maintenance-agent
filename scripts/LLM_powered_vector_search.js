/**
 * LLM-Powered Vector Search
 *
 * Purpose: Generate system-specific maintenance search terms using LLM,
 *          then find relevant chunks in Pinecone for each system
 *
 * Flow:
 * 1. For each system, send details to GPT-4o-mini
 * 2. LLM generates 5-8 maintenance search terms specific to that system
 * 3. Create embedding from those terms
 * 4. Query Pinecone (filtered by asset_uid)
 * 5. Store results in pinecone_search_results
 *
 * Usage:
 *   node scripts/LLM_powered_vector_search.js
 *   node scripts/LLM_powered_vector_search.js --system "watermaker"
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
const LLM_DELAY_MS = 1000; // 1 second between LLM calls to avoid rate limits

/**
 * Generate maintenance search terms for a specific system using LLM
 */
async function generateMaintenanceTerms(system) {
  const prompt = `Generate 5-8 technical maintenance search terms for this marine system:

System Type: ${system.system_norm}
Manufacturer: ${system.manufacturer_norm}
Model: ${system.model_norm}

Focus on:
- System-specific maintenance terminology
- Common maintenance procedures
- Parts that require service/replacement
- Industry-standard terms for this equipment type

Return only the search terms as a comma-separated list.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 150
    });

    const termsText = response.choices[0].message.content.trim();
    return termsText;
  } catch (error) {
    console.error(`  ❌ Failed to generate terms: ${error.message}`);
    return null;
  }
}

/**
 * Create embedding from search terms
 */
async function createEmbedding(searchTerms) {
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: searchTerms,
    dimensions: 3072
  });
  return embeddingResponse.data[0].embedding;
}

/**
 * Query Pinecone for maintenance chunks
 */
async function queryPinecone(index, embedding, assetUid, topK = 20) {
  const results = await index.namespace('REIMAGINEDDOCS').query({
    vector: embedding,
    topK,
    filter: { 'linked_asset_uid': { $eq: assetUid } },
    includeMetadata: true
  });

  return results.matches || [];
}

/**
 * Main LLM-powered search
 */
async function llmPoweredSearch() {
  console.log('\n=== LLM-POWERED VECTOR SEARCH ===\n');
  console.log(`Score threshold: ${SCORE_THRESHOLD}`);
  console.log(`Batch size: ${BATCH_SIZE}\n`);

  // Check for filter arguments
  const args = process.argv.slice(2);
  const systemIndex = args.indexOf('--system');
  const assetUidIndex = args.indexOf('--asset-uid');

  const systemFilter = systemIndex !== -1 ? args[systemIndex + 1] : null;
  const assetUidFilter = assetUidIndex !== -1 ? args[assetUidIndex + 1] : null;

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
        // Step 1: Generate system-specific maintenance terms
        const searchTerms = await generateMaintenanceTerms(system);

        if (!searchTerms) {
          console.log(' ⚠️  No terms generated');
          continue;
        }

        // Rate limiting: Wait after LLM call
        await new Promise(resolve => setTimeout(resolve, LLM_DELAY_MS));

        // Step 2: Create embedding from terms
        const embedding = await createEmbedding(searchTerms);

        // Step 3: Query Pinecone with asset filter
        const matches = await queryPinecone(index, embedding, system.asset_uid);

        // Step 4: Filter by score threshold
        const relevantChunks = matches.filter(m => m.score >= SCORE_THRESHOLD);

        if (relevantChunks.length > 0) {
          systemsWithChunks++;
          totalChunksFound += relevantChunks.length;

          // Step 5: Store in database
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
            search_terms: searchTerms, // Store the terms used
            type: 'LLM' // Mark as LLM-powered search
          }));

          const { error: insertError } = await supabase
            .from('pinecone_search_results')
            .insert(records);

          if (insertError) {
            console.log(` ❌ DB error`);
            console.error(insertError);
          } else {
            console.log(` ✅ ${relevantChunks.length} chunks (scores: ${relevantChunks[0].score.toFixed(3)}-${relevantChunks[relevantChunks.length-1].score.toFixed(3)})`);
            console.log(`    Terms: ${searchTerms.substring(0, 60)}...`);
          }
        } else {
          console.log(` - no chunks`);
        }

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
    .from('pinecone_search_results')
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

  console.log('\n✅ Done! Results stored in pinecone_search_results table\n');
}

llmPoweredSearch().catch(console.error);
