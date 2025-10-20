/**
 * Show text for high-scoring chunks
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function showHighScores() {
  console.log('\n=== CHUNKS WITH SCORE >= 0.50 ===\n');

  const { data: chunks, error } = await supabase
    .from('pinecone_search_results')
    .select('*')
    .gte('relevance_score', 0.50)
    .order('relevance_score', { ascending: false });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Found ${chunks.length} chunks\n`);

  chunks.forEach((chunk, i) => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`CHUNK ${i + 1}/${chunks.length}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`System: ${chunk.system_name}`);
    console.log(`Manufacturer: ${chunk.manufacturer} | Model: ${chunk.model}`);
    console.log(`Score: ${chunk.relevance_score}`);
    console.log(`Section: ${chunk.section_title || 'N/A'}`);
    console.log(`Pages: ${chunk.page_start || 'N/A'}-${chunk.page_end || 'N/A'}`);
    console.log(`Has Lists: ${chunk.has_lists} | Has Tables: ${chunk.has_tables}`);
    console.log(`\n--- FULL TEXT ---\n`);

    const fullText = chunk.chunk_metadata?.text || 'No text available';
    console.log(fullText);
    console.log(`\n--- END TEXT (${fullText.length} chars) ---`);
  });
}

showHighScores();