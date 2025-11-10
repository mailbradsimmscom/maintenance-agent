/**
 * Test Script: Step 6 with Dependency Discovery
 *
 * Tests the complete Step 6 flow including dependency discovery
 *
 * Usage:
 *   node scripts/test-step6-with-dependencies.js <asset-uid>
 */

import { executeClassifyDiscover } from '../src/services/step-executors/step6-classify-discover.js';
import { createLogger } from '../src/utils/logger.js';
import db from '../src/repositories/supabase.repository.js';

const logger = createLogger('test-step6');

async function testStep6(assetUid) {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TESTING STEP 6: CLASSIFY & DISCOVER (WITH DEPENDENCIES)');
  console.log('='.repeat(80));
  console.log(`Asset UID: ${assetUid}\n`);

  // Fetch system info
  const { data: system, error } = await db.client
    .from('systems')
    .select('asset_uid, description, manufacturer_norm, model_norm, system_norm')
    .eq('asset_uid', assetUid)
    .single();

  if (error || !system) {
    console.error('❌ System not found:', error?.message || 'No system with that asset_uid');
    process.exit(1);
  }

  console.log(`System: ${system.description || system.system_norm}`);
  console.log(`Manufacturer: ${system.manufacturer_norm || 'Unknown'}`);
  console.log(`Model: ${system.model_norm || 'Unknown'}`);
  console.log('\n' + '-'.repeat(80) + '\n');

  try {
    const result = await executeClassifyDiscover(assetUid, {
      rateLimiter: null, // No rate limiting for test
      onProgress: (progress) => {
        console.log(`[${progress.progress}%] ${progress.message}`);
      }
    });

    console.log('\n' + '='.repeat(80));
    console.log('✅ STEP 6 COMPLETED');
    console.log('='.repeat(80));
    console.log(`Tasks Classified: ${result.tasksClassified}`);
    console.log(`Tasks Discovered: ${result.tasksDiscovered}`);
    console.log(`Dependency Tasks: ${result.tasksDependencies} 🆕`);
    console.log(`BoatOS Task Created: ${result.boatosTaskCreated}`);
    console.log('='.repeat(80) + '\n');

    console.log('✅ Test completed successfully!\n');

  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ STEP 6 FAILED');
    console.error('='.repeat(80));
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    console.error('='.repeat(80) + '\n');
    process.exit(1);
  }
}

// Main
const assetUid = process.argv[2];
if (!assetUid) {
  console.error('Usage: node scripts/test-step6-with-dependencies.js <asset-uid>');
  console.error('\nTo find an asset_uid, run:');
  console.error('  curl http://localhost:3001/admin/api/pipeline/systems | jq \'.data.systems[0].asset_uid\'');
  process.exit(1);
}

testStep6(assetUid).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
