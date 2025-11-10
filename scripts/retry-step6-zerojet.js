/**
 * Retry Step 6 for ZeroJet
 */

import { orchestrator } from '../src/services/pipeline-orchestrator.service.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('retry-step6');

const zerojetAssetUid = 'd2084302-7190-480e-a255-eef83a24b09b';

async function retryStep6() {
  console.log('\n=== RETRYING STEP 6 FOR ZEROJET ===\n');
  console.log(`Asset UID: ${zerojetAssetUid}\n`);
  console.log('Starting Step 6 (Classify & Discover)...\n');

  try {
    await orchestrator.processStep6(zerojetAssetUid);
    console.log('\n✅ Step 6 completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Step 6 failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

retryStep6();
