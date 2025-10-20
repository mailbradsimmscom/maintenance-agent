import { Pinecone } from '@pinecone-database/pinecone';
import { getConfig } from '../src/config/env.js';
import dotenv from 'dotenv';

dotenv.config();

const config = getConfig();

async function checkIndex() {
  console.log('🔍 Checking Pinecone Index Configuration\n');

  const pinecone = new Pinecone({ apiKey: config.pinecone.apiKey });

  try {
    // Describe the index
    const indexDescription = await pinecone.describeIndex(config.pinecone.indexName);

    console.log('Index:', config.pinecone.indexName);
    console.log('Dimensions:', indexDescription.dimension);
    console.log('Metric:', indexDescription.metric);
    console.log('Host:', indexDescription.host);
    console.log('');

    // Check namespace stats
    const index = pinecone.index(config.pinecone.indexName);
    const stats = await index.describeIndexStats();

    console.log('Namespace Stats:');
    console.log('  Total vectors:', stats.totalRecordCount);
    console.log('  Namespaces:', Object.keys(stats.namespaces || {}));

    if (stats.namespaces) {
      Object.entries(stats.namespaces).forEach(([ns, data]) => {
        console.log(`    ${ns}: ${data.recordCount} vectors`);
      });
    }

    console.log('');

    // CRITICAL CHECK
    if (indexDescription.dimension !== 3072) {
      console.log('❌ MISMATCH: Index has', indexDescription.dimension, 'dimensions but we\'re using 3072!');
    } else {
      console.log('✅ Dimensions match (3072)');
    }

    if (indexDescription.metric !== 'cosine') {
      console.log('⚠️  WARNING: Index uses', indexDescription.metric, 'metric, expected cosine');
    } else {
      console.log('✅ Using cosine similarity');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkIndex();
