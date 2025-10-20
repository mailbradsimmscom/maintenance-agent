/**
 * Test extraction with specific documents
 * Run: node scripts/test-extraction.js
 */

import { extractionService } from '../src/services/extraction.service.js';
import db from '../src/repositories/supabase.repository.js';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import { chunkTrackingService } from '../src/services/chunk-tracking.service.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

async function testExtraction() {
  console.log('\n=== EXTRACTION TEST ===\n');

  try {
    // Initialize Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // 1. Get first 2 systems with documents
    console.log('Fetching systems with documents...');
    const { data: systems } = await supabase
      .from('systems')
      .select('*')
      .limit(2);

    if (!systems || systems.length === 0) {
      console.log('No systems found');
      return;
    }

    for (const system of systems) {
      console.log('\n----------------------------------------');
      console.log(`Testing System: ${system.description || system.asset_uid}`);
      console.log(`Manufacturer: ${system.manufacturer_norm}`);
      console.log(`Model: ${system.model_norm}`);
      console.log('----------------------------------------\n');

      // 2. Check if system has documents
      const documents = await db.systems.getSystemDocuments(system.asset_uid);
      console.log(`Found ${documents.length} documents`);

      if (documents.length === 0) {
        console.log('Skipping - no documents');
        continue;
      }

      // 3. Check Pinecone for vectors
      for (const doc of documents) {
        console.log(`\nDocument: ${doc.doc_id}`);
        const hasVectors = await pineconeRepository.documentHasVectors(doc.doc_id);
        console.log(`Has vectors in Pinecone: ${hasVectors}`);

        if (hasVectors) {
          // Show sample chunks
          console.log('\nFetching sample chunks...');
          const dummyVector = new Array(3072).fill(0);  // Updated for text-embedding-3-small
          const result = await pineconeRepository.query(dummyVector, {
            filter: { doc_id: { $eq: doc.doc_id } },
            topK: 3,
            includeMetadata: true
          });

          console.log(`Total chunks in Pinecone: ${result.matches?.length || 0}`);

          if (result.matches && result.matches.length > 0) {
            console.log('\nSample chunk metadata:');
            const sample = result.matches[0];
            console.log(`- Chunk ID: ${sample.id}`);
            console.log(`- Pages: ${sample.metadata?.page_start} - ${sample.metadata?.page_end}`);
            console.log(`- Content type: ${sample.metadata?.content_type}`);
            console.log(`- Text preview: ${sample.metadata?.text?.substring(0, 100)}...`);
          }
        }
      }

      // 4. Run extraction
      console.log('\n🔍 Running extraction...');
      const startTime = Date.now();

      // Clear chunk cache for clean test
      chunkTrackingService.clearCache();

      const tasks = await extractionService.extractFromManuals(system);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      // 5. Show results
      console.log(`\n✅ Extraction completed in ${duration} seconds`);
      console.log(`Tasks found: ${tasks.length}`);

      // Show chunk processing stats
      const stats = chunkTrackingService.getStats();
      console.log('\nChunk Processing Stats:');
      console.log(`- Total chunks processed: ${stats.totalChunksProcessed}`);
      console.log(`- Unique content blocks: ${stats.uniqueContentBlocks}`);
      console.log(`- Duplicates skipped: ${stats.duplicatesSkipped}`);

      if (tasks.length > 0) {
        console.log('\nSample tasks extracted:');
        tasks.slice(0, 3).forEach((task, i) => {
          console.log(`\n${i + 1}. ${task.description}`);
          console.log(`   Frequency: Every ${task.frequency_value} ${task.frequency_type}`);
          console.log(`   Criticality: ${task.criticality}`);
          console.log(`   Confidence: ${task.confidence}`);
          console.log(`   Source: Doc ${task.source_details?.doc_id}, Page ${task.source_details?.page_start}`);
        });
      }

      // Only test first system for now
      break;
    }

  } catch (error) {
    console.error('Test failed:', error);
  }

  process.exit(0);
}

// Run test
testExtraction();