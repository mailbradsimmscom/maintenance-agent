/**
 * Clear Classification Metadata
 * Removes task_category, task_category_confidence, task_category_reasoning from all tasks
 */

import dotenv from 'dotenv';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';

dotenv.config();

async function clearClassificationMetadata() {
  console.log('🗑️  CLEARING CLASSIFICATION METADATA\n');
  console.log('='.repeat(80));

  // Fetch all tasks
  console.log('📥 Fetching all tasks from Pinecone...\n');
  const allRecords = await pineconeRepository.listAllTasks();
  console.log(`✅ Found ${allRecords.length} tasks\n`);

  console.log('='.repeat(80));
  console.log('\n🧹 Removing classification fields...\n');

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < allRecords.length; i++) {
    const record = allRecords[i];

    console.log(`[${i + 1}/${allRecords.length}] ${record.id}`);

    try {
      // Fetch current metadata
      const existingTask = await pineconeRepository.getTaskById(record.id);

      if (!existingTask) {
        console.log(`   ⚠️  Task not found, skipping\n`);
        continue;
      }

      // Create new metadata without classification fields
      const {
        task_category,
        task_category_confidence,
        task_category_reasoning,
        classified_at,
        ...cleanMetadata
      } = existingTask.metadata;

      // Upsert with cleaned metadata (keeps same embedding)
      await pineconeRepository.upsertTask(record.id, existingTask.values, cleanMetadata);

      console.log(`   ✅ Cleared\n`);
      successCount++;
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`);
      errorCount++;
    }
  }

  console.log('='.repeat(80));
  console.log('\n📊 SUMMARY\n');
  console.log(`Total tasks: ${allRecords.length}`);
  console.log(`Successfully cleared: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log('\n✅ Classification metadata removed from all tasks');
  console.log('Ready for fresh batch classification + discovery\n');
  console.log('='.repeat(80) + '\n');
}

clearClassificationMetadata().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
