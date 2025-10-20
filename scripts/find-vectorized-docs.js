/**
 * Find systems with vectorized documents
 */

import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

async function findVectorizedDocs() {
  console.log('Finding systems with vectorized documents...\n');

  // Get all documents
  const { data: documents } = await supabase
    .from('documents')
    .select('doc_id, asset_uid, manufacturer, model')
    .limit(20);

  if (!documents || documents.length === 0) {
    console.log('No documents found');
    return;
  }

  const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
  const vectorizedDocs = [];

  for (const doc of documents) {
    try {
      // Check if this doc has vectors
      const dummyVector = new Array(3072).fill(0);
      const result = await index.query({
        vector: dummyVector,
        filter: { doc_id: { $eq: doc.doc_id } },
        topK: 1,
        includeMetadata: false
      });

      if (result.matches && result.matches.length > 0) {
        vectorizedDocs.push(doc);
        console.log(`✅ ${doc.manufacturer} ${doc.model} (${doc.doc_id.substring(0, 8)}...)`);
      } else {
        console.log(`❌ ${doc.manufacturer} ${doc.model} - No vectors`);
      }
    } catch (error) {
      console.log(`❌ ${doc.manufacturer} ${doc.model} - Error: ${error.message}`);
    }
  }

  console.log(`\nFound ${vectorizedDocs.length} documents with vectors`);

  if (vectorizedDocs.length > 0) {
    console.log('\nFirst vectorized document:');
    const first = vectorizedDocs[0];
    console.log(`Asset UID: ${first.asset_uid}`);
    console.log(`Doc ID: ${first.doc_id}`);
    console.log(`Manufacturer: ${first.manufacturer}`);
    console.log(`Model: ${first.model}`);
  }
}

findVectorizedDocs().catch(console.error);