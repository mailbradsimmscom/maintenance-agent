/**
 * Test Script for Step Executors
 *
 * Tests all connections and basic functionality:
 * - Supabase connection
 * - Pinecone connection
 * - OpenAI connection
 * - Basic repository operations
 */

import { getConfig } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import db from '../src/repositories/supabase.repository.js';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import OpenAI from 'openai';

const config = getConfig();
const logger = createLogger('test-step-executors');

const TESTS = {
  passed: 0,
  failed: 0,
  results: []
};

function logTest(name, passed, details = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`\n${status}: ${name}`);
  if (details) {
    console.log(`   ${details}`);
  }

  if (passed) {
    TESTS.passed++;
  } else {
    TESTS.failed++;
  }
  TESTS.results.push({ name, passed, details });
}

async function testSupabaseConnection() {
  console.log('\n=== Testing Supabase Connection ===');

  try {
    // Test 1: Can we connect?
    const { data, error } = await db.client
      .from('systems')
      .select('asset_uid')
      .limit(1);

    if (error) {
      logTest('Supabase Connection', false, error.message);
      return false;
    }

    logTest('Supabase Connection', true, 'Connected successfully');

    // Test 2: Can we count systems?
    const { count, error: countError } = await db.client
      .from('systems')
      .select('asset_uid', { count: 'exact', head: true });

    if (countError) {
      logTest('Supabase Count Systems', false, countError.message);
      return false;
    }

    logTest('Supabase Count Systems', true, `Found ${count} systems`);

    // Test 3: Check if pinecone_search_results table exists
    const { error: tableError } = await db.client
      .from('pinecone_search_results')
      .select('id')
      .limit(1);

    if (tableError && tableError.code === '42P01') {
      logTest('Table: pinecone_search_results', false, 'Table does not exist');
      return false;
    }

    logTest('Table: pinecone_search_results', true, 'Table exists');

    // Test 4: Check if deduplication_reviews table exists
    const { error: dedupError } = await db.client
      .from('deduplication_reviews')
      .select('id')
      .limit(1);

    if (dedupError && dedupError.code === '42P01') {
      logTest('Table: deduplication_reviews', false, 'Table does not exist (may need migration)');
    } else {
      logTest('Table: deduplication_reviews', true, 'Table exists');
    }

    return true;
  } catch (error) {
    logTest('Supabase Connection', false, error.message);
    return false;
  }
}

async function testPineconeConnection() {
  console.log('\n=== Testing Pinecone Connection ===');

  try {
    // First, get a test asset_uid from the database
    const { data: docs } = await db.client
      .from('documents')
      .select('asset_uid')
      .limit(1);

    if (!docs || docs.length === 0) {
      logTest('Pinecone Connection', false, 'No documents found to test with');
      return false;
    }

    const testAssetUid = docs[0].asset_uid;

    // Test 1: Can we query Pinecone with a filter?
    const testVector = new Array(3072).fill(0.1);

    const results = await pineconeRepository.query(testVector, {
      topK: 1,
      filter: { 'linked_asset_uid': { $eq: testAssetUid } },
      includeMetadata: true
    });

    if (results && results.matches !== undefined) {
      logTest('Pinecone Query', true, `Query returned ${results.matches.length} results`);
      logTest('Pinecone Connection', true, 'Connected and queried successfully');
    } else {
      logTest('Pinecone Query', false, 'Query returned invalid response');
    }

    return true;
  } catch (error) {
    logTest('Pinecone Connection', false, error.message);
    return false;
  }
}

async function testOpenAIConnection() {
  console.log('\n=== Testing OpenAI Connection ===');

  try {
    const openai = new OpenAI({ apiKey: config.openai.apiKey });

    // Test 1: Can we create embeddings?
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: 'test',
      dimensions: 3072
    });

    if (embeddingResponse.data[0].embedding.length === 3072) {
      logTest('OpenAI Embeddings', true, 'Created 3072-dimension embedding');
    } else {
      logTest('OpenAI Embeddings', false, `Expected 3072 dimensions, got ${embeddingResponse.data[0].embedding.length}`);
    }

    // Test 2: Can we make chat completions?
    const chatResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say "test successful" and nothing else.' }],
      temperature: 0
    });

    if (chatResponse.choices[0].message.content) {
      logTest('OpenAI Chat Completion', true, `Response: ${chatResponse.choices[0].message.content.substring(0, 50)}...`);
    } else {
      logTest('OpenAI Chat Completion', false, 'No response received');
    }

    return true;
  } catch (error) {
    logTest('OpenAI Connection', false, error.message);
    return false;
  }
}

async function testGetTestSystem() {
  console.log('\n=== Finding Test System ===');

  try {
    // Get a system that has documents
    const { data: docs, error: docsError } = await db.client
      .from('documents')
      .select('asset_uid')
      .limit(10);

    if (docsError) {
      logTest('Find Test System', false, docsError.message);
      return null;
    }

    if (!docs || docs.length === 0) {
      logTest('Find Test System', false, 'No systems with documents found');
      return null;
    }

    const assetUid = docs[0].asset_uid;

    // Get system details
    const { data: system, error: systemError } = await db.client
      .from('systems')
      .select('asset_uid, description, manufacturer_norm, model_norm, system_norm')
      .eq('asset_uid', assetUid)
      .single();

    if (systemError) {
      logTest('Find Test System', false, systemError.message);
      return null;
    }

    const systemName = system.description || `${system.manufacturer_norm} ${system.model_norm}`;
    logTest('Find Test System', true, `Found: ${systemName} (${assetUid})`);

    return system;
  } catch (error) {
    logTest('Find Test System', false, error.message);
    return null;
  }
}

async function testRepositories() {
  console.log('\n=== Testing Repository Functions ===');

  try {
    // Test Supabase repository methods (import systemsRepository)
    const { systemsRepository } = await import('../src/repositories/supabase.repository.js');

    const systems = await systemsRepository.getUnprocessedSystems(5);
    logTest('Get Unprocessed Systems', true, `Retrieved ${systems?.length || 0} systems`);

    return true;
  } catch (error) {
    logTest('Repository Functions', false, error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║   STEP EXECUTOR CONNECTION TESTS               ║');
  console.log('╚════════════════════════════════════════════════╝');

  try {
    // Run all tests
    const supabaseOk = await testSupabaseConnection();
    const pineconeOk = await testPineconeConnection();
    const openaiOk = await testOpenAIConnection();
    const reposOk = await testRepositories();

    let testSystem = null;
    if (supabaseOk) {
      testSystem = await testGetTestSystem();
    }

    // Print summary
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║   TEST SUMMARY                                 ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log(`\n✅ Passed: ${TESTS.passed}`);
    console.log(`❌ Failed: ${TESTS.failed}`);
    console.log(`📊 Total:  ${TESTS.passed + TESTS.failed}`);

    if (TESTS.failed === 0) {
      console.log('\n🎉 All tests passed! Step executors are ready to use.');

      if (testSystem) {
        console.log('\n📝 You can test step executors with this system:');
        console.log(`   Asset UID: ${testSystem.asset_uid}`);
        console.log(`   System: ${testSystem.description || testSystem.system_norm}`);
        console.log('\n   To test Step 1:');
        console.log(`   node scripts/test-single-step.js ${testSystem.asset_uid} 1`);
      }
    } else {
      console.log('\n⚠️  Some tests failed. Please fix the issues above.');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runAllTests();
