/**
 * Test extraction with random systems
 * Run: node scripts/test-random-systems.js
 */

import { extractionService } from '../src/services/extraction.service.js';
import db from '../src/repositories/supabase.repository.js';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import { chunkTrackingService } from '../src/services/chunk-tracking.service.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

async function testRandomSystems() {
  console.log('\n=== TESTING RANDOM SYSTEMS ===\n');

  try {
    // Initialize Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Get total count of systems
    const { count } = await supabase
      .from('systems')
      .select('*', { count: 'exact', head: true });

    console.log(`Total systems in database: ${count}`);

    // Get 2 random systems by using random offset
    const randomOffset1 = Math.floor(Math.random() * count);
    const randomOffset2 = Math.floor(Math.random() * count);

    const { data: system1 } = await supabase
      .from('systems')
      .select('*')
      .range(randomOffset1, randomOffset1)
      .single();

    const { data: system2 } = await supabase
      .from('systems')
      .select('*')
      .range(randomOffset2, randomOffset2)
      .single();

    const systems = [system1, system2];

    for (const system of systems) {
      console.log('\n========================================');
      console.log(`SYSTEM: ${system.description || system.asset_uid}`);
      console.log(`Manufacturer: ${system.manufacturer_norm || 'Unknown'}`);
      console.log(`Model: ${system.model_norm || 'Unknown'}`);
      console.log(`System Type: ${system.system_norm || 'Unknown'}`);
      console.log(`Asset UID: ${system.asset_uid}`);
      console.log('========================================\n');

      // Check if system has documents
      const documents = await db.systems.getSystemDocuments(system.asset_uid);
      console.log(`📄 Documents found: ${documents.length}`);

      if (documents.length === 0) {
        console.log('⏭️  Skipping - no documents\n');
        continue;
      }

      // Check Pinecone for vectors
      let hasAnyVectors = false;
      for (const doc of documents) {
        const hasVectors = await pineconeRepository.documentHasVectors(doc.doc_id);
        if (hasVectors) {
          hasAnyVectors = true;
          console.log(`✅ Document ${doc.doc_id.substring(0, 8)}... has vectors`);
        } else {
          console.log(`❌ Document ${doc.doc_id.substring(0, 8)}... NO vectors`);
        }
      }

      if (!hasAnyVectors) {
        console.log('⏭️  Skipping - no vectorized documents\n');
        continue;
      }

      // Run extraction
      console.log('\n🔍 RUNNING EXTRACTION...');
      const startTime = Date.now();

      // Clear chunk cache for clean test
      chunkTrackingService.clearCache();

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
        console.log('\n📋 EXTRACTED MAINTENANCE TASKS:');
        tasks.forEach((task, i) => {
          console.log(`\n   ${i + 1}. ${task.description}`);
          console.log(`      • Frequency: Every ${task.frequency_value} ${task.frequency_type}`);
          console.log(`      • Criticality: ${task.criticality}`);
          console.log(`      • Confidence: ${(task.confidence * 100).toFixed(0)}%`);
          console.log(`      • Duration: ${task.estimated_duration_hours} hours`);
          if (task.parts_required && task.parts_required.length > 0) {
            console.log(`      • Parts: ${task.parts_required.join(', ')}`);
          }
        });
      } else {
        console.log('\n⚠️  No maintenance tasks extracted');
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
testRandomSystems();