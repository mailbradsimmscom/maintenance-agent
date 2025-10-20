/**
 * Test extraction with UV system
 */

import { extractionService } from '../src/services/extraction.service.js';
import { chunkTrackingService } from '../src/services/chunk-tracking.service.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

async function testUVSystem() {
  console.log('\n=== TESTING UV WATER PURIFICATION SYSTEM ===\n');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const assetUid = '87517a2e-8bc4-8379-5718-e88bb81cb796';

  const { data: system } = await supabase
    .from('systems')
    .select('*')
    .eq('asset_uid', assetUid)
    .single();

  console.log(`System: ${system.description}`);
  console.log(`Manufacturer: ${system.manufacturer_norm}`);
  console.log(`Model: ${system.model_norm}\n`);

  console.log('🔍 RUNNING EXTRACTION...\n');

  chunkTrackingService.clearCache();

  const startTime = Date.now();
  const tasks = await extractionService.extractFromManuals(system);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n✅ Completed in ${duration} seconds`);
  console.log(`📊 Tasks extracted: ${tasks.length}\n`);

  const stats = chunkTrackingService.getStats();
  console.log('📈 Chunk Stats:');
  console.log(`   Processed: ${stats.totalChunksProcessed}`);
  console.log(`   Unique: ${stats.uniqueContentBlocks}`);
  console.log(`   Duplicates skipped: ${stats.duplicatesSkipped}\n`);

  if (tasks.length > 0) {
    console.log('📋 EXTRACTED TASKS:\n');
    tasks.forEach((task, i) => {
      console.log(`${i + 1}. ${task.description}`);
      console.log(`   Frequency: Every ${task.frequency_value} ${task.frequency_type}`);
      console.log(`   Criticality: ${task.criticality}`);
      console.log(`   Confidence: ${(task.confidence * 100).toFixed(0)}%`);
      if (task.parts_required?.length) {
        console.log(`   Parts: ${task.parts_required.join(', ')}`);
      }
      console.log('');
    });
  }

  process.exit(0);
}

testUVSystem();