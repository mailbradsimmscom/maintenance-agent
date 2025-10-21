import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const { data, error } = await supabase
  .from('pinecone_search_results')
  .select('chunk_metadata, system_name, relevance_score')
  .limit(3);

if (error) {
  console.error('Error:', error);
} else {
  console.log(`Total records checked: ${data.length}\n`);

  data.forEach((record, i) => {
    console.log(`\n=== Record ${i + 1} ===`);
    console.log(`System: ${record.system_name}`);
    console.log(`Score: ${record.relevance_score}`);
    console.log(`chunk_metadata keys: ${Object.keys(record.chunk_metadata || {}).join(', ')}`);
    console.log(`Has 'text' field: ${!!record.chunk_metadata?.text}`);
    console.log(`Text length: ${record.chunk_metadata?.text?.length || 0} chars`);

    if (record.chunk_metadata?.text) {
      console.log(`Text preview: ${record.chunk_metadata.text.substring(0, 100)}...`);
    }
  });
}
