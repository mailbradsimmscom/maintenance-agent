/**
 * Debug Pinecone filtering
 */

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function debugPineconeFilter() {
  console.log('\n=== DEBUGGING PINECONE FILTER ===\n');

  const index = pinecone.index(process.env.PINECONE_INDEX_NAME);

  // Create embedding
  const query = 'maintenance service inspection cleaning replacement schedule interval check replace';
  console.log('Creating embedding for query:', query);
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: query,
    dimensions: 3072
  });
  const queryVector = response.data[0].embedding;
  console.log(`Vector dimensions: ${queryVector.length}\n`);

  // Test 1: UV Water Purification System (should have maintenance!)
  const assetUid = '87517a2e-8bc4-8379-5718-e88bb81cb796';
  console.log('TEST 1: UV Water Purification - Filter by Linked Asset UID only');
  console.log('Asset UID:', assetUid);

  const result1 = await index.namespace('REIMAGINEDDOCS').query({
    vector: queryVector,
    topK: 10,
    filter: { 'linked_asset_uid': { $eq: assetUid } },  // lowercase with underscores
    includeMetadata: true
  });

  console.log(`Results: ${result1.matches?.length || 0} matches`);
  if (result1.matches && result1.matches.length > 0) {
    console.log('\nTop 3 matches:');
    result1.matches.slice(0, 3).forEach((match, i) => {
      console.log(`\n${i + 1}. Score: ${match.score.toFixed(4)}`);
      console.log(`   Has content_type: ${!!match.metadata?.content_type}`);
      console.log(`   Has section_path: ${!!match.metadata?.section_path}`);
      console.log(`   Section: ${match.metadata?.section_title || 'N/A'}`);
      console.log(`   Snippet: ${match.metadata?.content_snippet?.substring(0, 100)}...`);
    });
  }

  // Test 2: With content_type filter
  console.log('\n\nTEST 2: With content_type filter');
  const result2 = await index.namespace('REIMAGINEDDOCS').query({
    vector: queryVector,
    topK: 10,
    filter: {
      'linked_asset_uid': { $eq: assetUid },
      $or: [
        { content_type: { $eq: 'maintenance' } },
        { content_type: { $eq: 'service' } },
      ],
    },
    includeMetadata: true
  });

  console.log(`Results: ${result2.matches?.length || 0} matches\n`);

  // Test 3: Check what metadata fields exist
  console.log('\nTEST 3: Sample metadata structure');
  if (result1.matches && result1.matches.length > 0) {
    console.log('Available metadata fields:');
    console.log(Object.keys(result1.matches[0].metadata).sort());
  }
}

debugPineconeFilter().catch(console.error);