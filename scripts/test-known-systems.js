/**
 * Test extraction with systems we know have vectors
 */

import { extractionService } from '../src/services/extraction.service.js';
import db from '../src/repositories/supabase.repository.js';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import { chunkTrackingService } from '../src/services/chunk-tracking.service.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

async function testKnownSystems() {
  console.log('\n=== TESTING SYSTEMS WITH KNOWN VECTORS ===\n');

  try {
    // Initialize Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Known systems with vectors (from Pinecone metadata)
    const knownAssetUids = [
      '75b1f767-c270-4df0-97ae-88cc1f497151',  // CZone waterproof keypad
      '603ed86f-0d7a-4ee9-a681-d3a97b600764'   // Fortress anchor
    ];

    for (const assetUid of knownAssetUids) {
      // Get system details
      const { data: system } = await supabase
        .from('systems')
        .select('*')
        .eq('asset_uid', assetUid)
        .single();

      if (!system) {
        console.log(`❌ System ${assetUid} not found in database`);
        continue;
      }

      console.log('\n========================================');
      console.log(`SYSTEM: ${system.description || system.asset_uid}`);
      console.log(`Manufacturer: ${system.manufacturer_norm || 'Unknown'}`);
      console.log(`Model: ${system.model_norm || 'Unknown'}`);
      console.log(`System Type: ${system.system_norm || 'Unknown'}`);
      console.log(`Asset UID: ${system.asset_uid}`);
      console.log('========================================\n');

      // Run extraction
      console.log('🔍 RUNNING EXTRACTION...');
      const startTime = Date.now();

      // Clear chunk cache for clean test
      chunkTrackingService.clearCache();

      try {
        const tasks = await extractionService.extractFromManuals(system);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        // Show results
        console.log(`\n✅ Extraction completed in ${duration} seconds`);
        console.log(`📊 Tasks found: ${tasks.length}`);

        // Show chunk processing stats
        const stats = chunkTrackingService.getStats();
        console.log('\n📈 Chunk Processing Stats:');
        console.log(`   Total chunks processed: ${stats.totalChunksProcessed}`);
        console.log(`   Unique content blocks: ${stats.uniqueContentBlocks}`);
        console.log(`   Duplicates skipped: ${stats.duplicatesSkipped}`);

        if (tasks.length > 0) {
          console.log('\n📋 MAINTENANCE TASKS EXTRACTED:');
          tasks.forEach((task, i) => {
            console.log(`\n   ${i + 1}. ${task.description}`);
            console.log(`      • Frequency: Every ${task.frequency_value} ${task.frequency_type}`);
            console.log(`      • Criticality: ${task.criticality}`);
            console.log(`      • Confidence: ${(task.confidence * 100).toFixed(0)}%`);
            console.log(`      • Duration: ${task.estimated_duration_hours} hours`);
            if (task.parts_required && task.parts_required.length > 0) {
              console.log(`      • Parts: ${task.parts_required.join(', ')}`);
            }
            console.log(`      • Source: Page ${task.source_details?.page_start || 'N/A'}-${task.source_details?.page_end || 'N/A'}`);
          });
        } else {
          console.log('\n⚠️  No maintenance tasks extracted');
        }
      } catch (error) {
        console.error(`❌ Extraction failed: ${error.message}`);
      }
    }

    console.log('\n=== TEST COMPLETE ===\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }

  process.exit(0);
}

// Run test
testKnownSystems();