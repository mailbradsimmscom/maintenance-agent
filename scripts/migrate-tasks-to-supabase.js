/**
 * Migrate Existing Tasks from Pinecone to Supabase
 *
 * One-time migration script to populate maintenance_tasks_index table.
 * This is required for the hybrid sync architecture to work.
 *
 * Usage:
 *   node scripts/migrate-tasks-to-supabase.js
 *
 * What it does:
 *   1. Fetches all 407 tasks from Pinecone MAINTENANCE_TASKS namespace
 *   2. Transforms metadata to match Supabase schema
 *   3. Inserts into maintenance_tasks_index table
 *   4. Verifies counts match
 *
 * Safe to re-run: Uses upsert so existing tasks will be updated
 */

import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import { maintenanceTasksIndexRepository } from '../src/repositories/supabase.repository.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('migrate-tasks');

async function migrateTasks() {
  const startTime = Date.now();

  try {
    logger.info('====================================================');
    logger.info('Starting task migration from Pinecone to Supabase');
    logger.info('====================================================');

    // 1. Fetch all tasks from Pinecone
    logger.info('Step 1: Fetching all tasks from Pinecone...');
    const allTasks = await pineconeRepository.listAllTasks();
    logger.info('Fetched tasks from Pinecone', { count: allTasks.length });

    if (allTasks.length === 0) {
      logger.warn('No tasks found in Pinecone. Nothing to migrate.');
      return;
    }

    // 2. Transform and insert into Supabase
    logger.info('Step 2: Inserting tasks into Supabase...');
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const task of allTasks) {
      try {
        const metadata = task.metadata || {};

        // Transform Pinecone metadata to Supabase schema
        await maintenanceTasksIndexRepository.upsert({
          id: task.id,
          asset_uid: metadata.asset_uid,
          description: metadata.description,
          system_name: metadata.system_name,
          frequency_basis: metadata.frequency_basis,
          frequency_value: metadata.frequency_value || metadata.frequency_hours,
          is_recurring: metadata.is_recurring ?? true,
          next_due_hours: metadata.next_due_hours,
          next_due_date: metadata.next_due_date,
          review_status: metadata.review_status || 'pending',
          last_completed_at: metadata.last_completed_at,
          completion_count: metadata.completion_count || 0,
          task_category: metadata.task_category,
          criticality: metadata.criticality,
          confidence: metadata.confidence,
          source_step: metadata.source_step,
          source_type: metadata.source_type,
        });

        successCount++;

        // Log progress every 50 tasks
        if (successCount % 50 === 0) {
          logger.info('Migration progress', {
            success: successCount,
            errors: errorCount,
            percent: Math.round((successCount / allTasks.length) * 100)
          });
        }
      } catch (error) {
        errorCount++;
        errors.push({
          taskId: task.id,
          error: error.message
        });
        logger.error('Failed to migrate task', {
          taskId: task.id,
          error: error.message
        });
      }
    }

    logger.info('Step 2 complete', {
      total: allTasks.length,
      success: successCount,
      errors: errorCount
    });

    // 3. Verify counts match
    logger.info('Step 3: Verifying migration...');
    const supabaseIds = await maintenanceTasksIndexRepository.getAllTaskIds();

    logger.info('Verification results', {
      pineconeCount: allTasks.length,
      supabaseCount: supabaseIds.length,
      match: allTasks.length === supabaseIds.length
    });

    // 4. Summary
    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('\n====================================================');
    console.log('MIGRATION SUMMARY');
    console.log('====================================================');
    console.log(`Tasks in Pinecone:  ${allTasks.length}`);
    console.log(`Tasks in Supabase:  ${supabaseIds.length}`);
    console.log(`Successfully migrated: ${successCount}`);
    console.log(`Failed: ${errorCount}`);
    console.log(`Duration: ${duration} seconds`);
    console.log(`Match: ${allTasks.length === supabaseIds.length ? '✅ YES' : '❌ NO'}`);

    if (errorCount > 0) {
      console.log('\nErrors:');
      errors.forEach((err, index) => {
        console.log(`  ${index + 1}. Task ${err.taskId}: ${err.error}`);
      });
    }

    console.log('====================================================\n');

    if (errorCount > 0) {
      logger.warn('Migration completed with errors', {
        successCount,
        errorCount,
        errors
      });
    } else {
      logger.info('Migration completed successfully', {
        successCount,
        duration: `${duration}s`
      });
    }

    // Status breakdown
    const statusCounts = await maintenanceTasksIndexRepository.getCountsByStatus();
    console.log('Task status breakdown:');
    console.log(`  Pending:  ${statusCounts.pending}`);
    console.log(`  Approved: ${statusCounts.approved}`);
    console.log(`  Rejected: ${statusCounts.rejected}`);
    console.log('');

  } catch (error) {
    logger.error('Migration failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Run migration
migrateTasks()
  .then(() => {
    console.log('✅ Migration script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration script failed:', error.message);
    process.exit(1);
  });
