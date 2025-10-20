import { Pinecone } from '@pinecone-database/pinecone';
import { getConfig } from '../src/config/env.js';
import dotenv from 'dotenv';

dotenv.config();

const config = getConfig();

async function clearNamespace() {
  console.log('🗑️  Clearing MAINTENANCE_TASKS namespace...\n');

  const pinecone = new Pinecone({ apiKey: config.pinecone.apiKey });
  const index = pinecone.index(config.pinecone.indexName);

  try {
    // Delete all vectors in the namespace
    await index.namespace('MAINTENANCE_TASKS').deleteAll();

    console.log('✅ Namespace cleared successfully!\n');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

clearNamespace();
