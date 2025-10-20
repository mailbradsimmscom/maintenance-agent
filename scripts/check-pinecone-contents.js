/**
 * Check what's actually in Pinecone
 */

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

async function checkPinecone() {
  console.log('\n=== CHECKING PINECONE CONTENTS ===\n');

  const index = pinecone.index(process.env.PINECONE_INDEX_NAME);

  // Get index stats
  const stats = await index.describeIndexStats();
  console.log('Index Stats:', JSON.stringify(stats, null, 2));

  // Try to query for ANY vectors
  const dummyVector = new Array(3072).fill(0);

  // Query in the REIMAGINEDDOCS namespace
  const result = await index.namespace('REIMAGINEDDOCS').query({
    vector: dummyVector,
    topK: 5,
    includeMetadata: true
  });

  console.log(`\nFound ${result.matches?.length || 0} vectors in index`);

  if (result.matches && result.matches.length > 0) {
    console.log('\nSample vectors:');
    result.matches.forEach((match, i) => {
      console.log(`\n${i + 1}. Vector ID: ${match.id}`);
      console.log('   Metadata:', JSON.stringify(match.metadata, null, 2));
    });

    // Check unique Linked Asset UIDs
    const assetUids = new Set();
    result.matches.forEach(match => {
      if (match.metadata && match.metadata['Linked Asset UID']) {
        assetUids.add(match.metadata['Linked Asset UID']);
      }
    });

    if (assetUids.size > 0) {
      console.log('\nFound Linked Asset UIDs:');
      Array.from(assetUids).forEach(uid => {
        console.log(`  - ${uid}`);
      });
    }
  }
}

checkPinecone().catch(console.error);