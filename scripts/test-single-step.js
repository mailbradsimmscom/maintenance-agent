/**
 * Test a Single Step Executor
 *
 * Usage: node scripts/test-single-step.js <asset_uid> <step_number>
 * Example: node scripts/test-single-step.js e4739797-4204-fe58-4abf-1867b0fd57ff 1
 */

import { createLogger } from '../src/utils/logger.js';
import { executeGenericSearch } from '../src/services/step-executors/step1-generic-search.js';
import { executeLLMSearch } from '../src/services/step-executors/step2-llm-search.js';
import { SimpleRateLimiter } from '../src/services/simple-rate-limiter.service.js';

const logger = createLogger('test-single-step');

const STEP_EXECUTORS = {
  1: {
    name: 'Generic Pinecone Search',
    executor: executeGenericSearch
  },
  2: {
    name: 'LLM-Powered Search',
    executor: executeLLMSearch
  },
  // Steps 3-5 require more complex setup, skip for basic test
};

async function testStep(assetUid, stepNumber) {
  const stepConfig = STEP_EXECUTORS[stepNumber];

  if (!stepConfig) {
    console.error(`❌ Step ${stepNumber} is not available for testing.`);
    console.log('Available steps: 1, 2');
    process.exit(1);
  }

  console.log('\n╔════════════════════════════════════════════════╗');
  console.log(`║   Testing Step ${stepNumber}: ${stepConfig.name.padEnd(31)} ║`);
  console.log('╚════════════════════════════════════════════════╝\n');

  console.log(`Asset UID: ${assetUid}\n`);

  // Create rate limiter
  const rateLimiter = new SimpleRateLimiter();

  // Progress callback
  const onProgress = (progress) => {
    console.log(`📊 Progress: ${progress.message}`);
  };

  try {
    const startTime = Date.now();

    const result = await stepConfig.executor(assetUid, {
      rateLimiter,
      onProgress
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n✅ Step completed successfully!');
    console.log(`⏱️  Duration: ${duration}s\n`);
    console.log('📋 Results:');
    console.log(JSON.stringify(result, null, 2));

    if (result.skipReason) {
      console.log('\n⚠️  Note: Step was skipped (likely already executed)');
    }

  } catch (error) {
    console.error('\n❌ Step failed!');
    console.error(`Error: ${error.message}`);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

// Parse arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node scripts/test-single-step.js <asset_uid> <step_number>');
  console.error('\nExample:');
  console.error('  node scripts/test-single-step.js e4739797-4204-fe58-4abf-1867b0fd57ff 1');
  console.error('\nAvailable steps:');
  console.error('  1 - Generic Pinecone Search');
  console.error('  2 - LLM-Powered Search');
  process.exit(1);
}

const assetUid = args[0];
const stepNumber = parseInt(args[1], 10);

// Run the test
testStep(assetUid, stepNumber);
