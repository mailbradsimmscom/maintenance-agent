/**
 * Force run Step 6 for a specific system
 * Usage: node scripts/force-step6.js <asset_uid>
 */

import { orchestrator } from '../src/services/pipeline-orchestrator.service.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('force-step6');

const assetUid = process.argv[2];

if (!assetUid) {
  console.error('Usage: node scripts/force-step6.js <asset_uid>');
  process.exit(1);
}

async function main() {
  try {
    logger.info('Force running Step 6', { assetUid });
    console.log(`\n🚀 Starting Step 6 for: ${assetUid}\n`);

    const result = await orchestrator.processStep6(assetUid);

    console.log('\n✅ Step 6 Complete!');
    console.log('Results:', JSON.stringify(result, null, 2));
    console.log('\nStatus should now be: pending_final_review');
    console.log(`Link: http://localhost:3001/maintenance-tasks-list.html?asset_uid=${assetUid}`);

    process.exit(0);
  } catch (error) {
    logger.error('Step 6 failed', { error: error.message, stack: error.stack });
    console.error('\n❌ Step 6 Failed:', error.message);
    process.exit(1);
  }
}

main();
