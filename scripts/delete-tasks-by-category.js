/**
 * Delete Tasks by Category
 * Removes tasks from Pinecone based on their task_category metadata
 *
 * Usage:
 *   node scripts/delete-tasks-by-category.js --categories "INSTALLATION,PRE_USE_CHECK,VAGUE"
 *   node scripts/delete-tasks-by-category.js --categories "VAGUE" --asset-uid "abc-123"
 */

import dotenv from 'dotenv';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';

dotenv.config();

// Get categories from command line args
const args = process.argv.slice(2);
const categoriesFlag = args.findIndex(arg => arg === '--categories');
const categoriesArg = categoriesFlag !== -1 ? args[categoriesFlag + 1] : null;

const assetUidFlag = args.findIndex(arg => arg === '--asset-uid');
const assetUidArg = assetUidFlag !== -1 ? args[assetUidFlag + 1] : null;

if (!categoriesArg) {
  console.error('❌ Error: --categories flag required');
  console.log('Usage:');
  console.log('  node scripts/delete-tasks-by-category.js --categories "INSTALLATION,PRE_USE_CHECK,VAGUE"');
  console.log('  node scripts/delete-tasks-by-category.js --categories "VAGUE" --asset-uid "abc-123"');
  console.log('\nValid categories:');
  console.log('  - INSTALLATION');
  console.log('  - PRE_USE_CHECK');
  console.log('  - VAGUE');
  console.log('  - MAINTENANCE');
  console.log('\nOptional filters:');
  console.log('  --asset-uid "uid"  Only delete tasks for a specific asset');
  process.exit(1);
}

const categoriesToDelete = categoriesArg.split(',').map(c => c.trim());

async function deleteTasksByCategory() {
  console.log('🗑️  DELETE TASKS BY CATEGORY\n');
  console.log('='.repeat(80));
  console.log(`Categories to delete: ${categoriesToDelete.join(', ')}`);
  if (assetUidArg) {
    console.log(`Asset UID filter: ${assetUidArg}`);
  }
  console.log();

  // Fetch all tasks
  console.log('📥 Fetching all tasks from Pinecone...\n');
  const allRecords = await pineconeRepository.listAllTasks();
  console.log(`✅ Found ${allRecords.length} total tasks\n`);

  // Filter tasks that match categories AND asset_uid (if provided)
  const tasksToDelete = allRecords.filter(record => {
    const matchesCategory = categoriesToDelete.includes(record.metadata.task_category);
    const matchesAsset = !assetUidArg || record.metadata.asset_uid === assetUidArg;
    return matchesCategory && matchesAsset;
  });

  console.log('='.repeat(80));
  console.log('\n📊 DELETION PREVIEW\n');

  // Count by category
  const categoryCounts = {};
  tasksToDelete.forEach(task => {
    const cat = task.metadata.task_category;
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  console.log('Tasks to be deleted:');
  Object.entries(categoryCounts).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count} tasks`);
  });

  // Show affected systems if filtering by asset
  if (assetUidArg && tasksToDelete.length > 0) {
    const systemNames = [...new Set(tasksToDelete.map(t => t.metadata.system_name))];
    console.log(`\nAffected system(s):`);
    systemNames.forEach(name => console.log(`  - ${name}`));
  }

  console.log(`\nTotal: ${tasksToDelete.length} tasks will be deleted`);
  console.log(`Remaining: ${allRecords.length - tasksToDelete.length} tasks will be kept`);

  if (tasksToDelete.length === 0) {
    console.log('\n✅ No tasks found matching the specified categories');
    console.log('Nothing to delete.\n');
    return;
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n🗑️  DELETING TASKS...\n');

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < tasksToDelete.length; i++) {
    const task = tasksToDelete[i];
    const taskId = task.id;
    const category = task.metadata.task_category;
    const description = task.metadata.description?.substring(0, 60) || 'N/A';

    console.log(`[${i + 1}/${tasksToDelete.length}] ${taskId}`);
    console.log(`   Category: ${category}`);
    console.log(`   Description: "${description}..."`);

    try {
      await pineconeRepository.deleteTask(taskId);
      console.log(`   ✅ Deleted\n`);
      successCount++;
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`);
      errorCount++;
    }
  }

  console.log('='.repeat(80));
  console.log('\n📊 DELETION SUMMARY\n');
  console.log(`Total tasks processed: ${tasksToDelete.length}`);
  console.log(`Successfully deleted: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`\nRemaining tasks in Pinecone: ${allRecords.length - successCount}`);
  console.log('\n✅ Deletion complete\n');
  console.log('='.repeat(80) + '\n');
}

deleteTasksByCategory().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
