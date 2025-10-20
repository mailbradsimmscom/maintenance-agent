#!/usr/bin/env node

/**
 * Test Pinecone Connection
 * Debug script to identify Pinecone configuration issues
 */

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

console.log('Testing Pinecone connection...\n');

// Show current configuration (without API key)
console.log('Configuration:');
console.log('- Environment:', process.env.PINECONE_ENVIRONMENT);
console.log('- Index Name:', process.env.PINECONE_INDEX_NAME);
console.log('- API Key:', process.env.PINECONE_API_KEY ? '***SET***' : 'NOT SET');
console.log();

// Test different configurations
async function testConnection() {
  // Test 1: With environment parameter
  console.log('Test 1: With environment parameter...');
  try {
    const pc1 = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT,
    });

    const index1 = pc1.index(process.env.PINECONE_INDEX_NAME);
    const stats1 = await index1.describeIndexStats();
    console.log('✅ Success with environment!');
    console.log('Stats:', stats1);
  } catch (error) {
    console.log('❌ Failed with environment:', error.message);
  }

  console.log();

  // Test 2: Without environment (newer SDK style)
  console.log('Test 2: Without environment parameter...');
  try {
    const pc2 = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    // List available indexes
    console.log('Listing indexes...');
    const indexList = await pc2.listIndexes();
    console.log('Available indexes:', indexList);

    // Try to connect to our index
    const index2 = pc2.index(process.env.PINECONE_INDEX_NAME);
    const stats2 = await index2.describeIndexStats();
    console.log('✅ Success without environment!');
    console.log('Stats:', stats2);
  } catch (error) {
    console.log('❌ Failed without environment:', error.message);
  }

  console.log();

  // Test 3: Try different environment values
  console.log('Test 3: Trying alternate environment values...');
  const environments = [
    'us-east-1',
    'us-east-1-aws',
    'gcp-starter',
    'us-west1-gcp',
    'us-east1-gcp'
  ];

  for (const env of environments) {
    try {
      console.log(`  Trying: ${env}...`);
      const pc3 = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
        environment: env,
      });

      const index3 = pc3.index(process.env.PINECONE_INDEX_NAME);
      await index3.describeIndexStats();
      console.log(`  ✅ Success with environment: ${env}`);
      break;
    } catch (error) {
      console.log(`  ❌ Failed with ${env}`);
    }
  }
}

testConnection().catch(console.error);