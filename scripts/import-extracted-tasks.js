import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import {
  classifyTaskType,
  generateTaskEmbedding,
  checkForDuplicates,
  addTaskToPinecone
} from '../src/services/task-embedding.service.js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function importTasksWithDeduplication() {
  console.log('📂 Reading extracted tasks from JSON...\n');

  const tasksJson = readFileSync('extracted_tasks_2025-10-19.json', 'utf-8');
  const tasks = JSON.parse(tasksJson);

  console.log(`Found ${tasks.length} tasks to import`);
  console.log(`Using Pinecone embedding-based deduplication\n`);

  const stats = {
    total: tasks.length,
    inserted: 0,
    needsReview: 0,
    autoMerged: 0,
    errors: 0,
    details: []
  };

  for (const task of tasks) {
    try {
      // Step 1: Classify task type
      task.task_type = classifyTaskType(task.description);

      // Step 2: Generate embedding
      const embedding = await generateTaskEmbedding(task.description);

      // Step 3: Check for duplicates (with compound logic)
      const dupCheck = await checkForDuplicates(task, embedding, {
        autoMergeThreshold: 0.92,
        reviewThreshold: 0.85,
        compoundReviewThreshold: 0.80
      });

      let action = 'none';

      // Step 4: Handle based on duplicate check result
      if (dupCheck.action === 'insert') {
        // NEW UNIQUE TASK - Write to Supabase + Pinecone
        const taskId = randomUUID();

        const { error } = await supabase
          .from('maintenance_tasks_queue')
          .insert({
            id: taskId,
            asset_uid: task.asset_uid,
            system_name: task.system_name,
            description: task.description,
            frequency_type: task.frequency_type,
            frequency_value: task.frequency_value,
            parts_required: task.parts_required || [],
            estimated_duration_hours: task.estimated_duration_hours,
            criticality: task.criticality,
            confidence: task.confidence,
            source: task.source,
            source_details: task.source_details,
            status: 'pending',
            task_type: task.task_type,
            duplicate_status: 'unique',
            embedding_generated: true,
            pinecone_task_id: taskId,
            created_at: task.created_at || new Date().toISOString()
          });

        if (error) {
          throw new Error(`Supabase insert failed: ${error.message}`);
        }

        // Add to Pinecone
        await addTaskToPinecone({ ...task, id: taskId }, embedding);

        stats.inserted++;
        action = 'inserted';

      } else if (dupCheck.action === 'review_required') {
        // SUSPECTED DUPLICATE - Write to Supabase with metadata, skip Pinecone
        const taskId = randomUUID();

        const { error } = await supabase
          .from('maintenance_tasks_queue')
          .insert({
            id: taskId,
            asset_uid: task.asset_uid,
            system_name: task.system_name,
            description: task.description,
            frequency_type: task.frequency_type,
            frequency_value: task.frequency_value,
            parts_required: task.parts_required || [],
            estimated_duration_hours: task.estimated_duration_hours,
            criticality: task.criticality,
            confidence: task.confidence,
            source: task.source,
            source_details: task.source_details,
            status: 'pending',
            task_type: task.task_type,
            duplicate_status: 'needs_review',
            duplicate_of: dupCheck.primaryTask.metadata.task_id,
            similarity_score: dupCheck.primaryTask.score,
            embedding_generated: false,
            created_at: task.created_at || new Date().toISOString()
          });

        if (error) {
          throw new Error(`Supabase insert failed: ${error.message}`);
        }

        stats.needsReview++;
        action = 'needs_review';

      } else if (dupCheck.action === 'auto_merge') {
        // HIGH CONFIDENCE DUPLICATE - Skip entirely (would auto-merge in production)
        stats.autoMerged++;
        action = 'auto_merged (skipped)';
      }

      stats.details.push({
        system: task.system_name,
        description: task.description.substring(0, 50) + '...',
        action,
        similarity: dupCheck.primaryTask?.score,
        reason: dupCheck.reason
      });

      // Progress indicator
      const processed = stats.inserted + stats.needsReview + stats.autoMerged;
      if (processed % 5 === 0) {
        console.log(`✅ Processed ${processed}/${stats.total} tasks...`);
      }

    } catch (error) {
      console.error(`❌ Error processing task: ${task.description.substring(0, 50)}`);
      console.error(`   ${error.message}\n`);
      stats.errors++;
    }
  }

  // Final Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 IMPORT SUMMARY (Pinecone Deduplication)');
  console.log('='.repeat(60));
  console.log(`Total tasks:              ${stats.total}`);
  console.log(`✅ Inserted (unique):     ${stats.inserted}`);
  console.log(`⚠️  Needs review:          ${stats.needsReview}`);
  console.log(`🔄 Auto-merged (skipped): ${stats.autoMerged}`);
  console.log(`❌ Errors:                ${stats.errors}`);
  console.log('='.repeat(60) + '\n');

  if (stats.inserted > 0) {
    console.log(`🎉 ${stats.inserted} unique tasks written to Supabase + Pinecone!`);
  }

  if (stats.needsReview > 0) {
    console.log(`⚠️  ${stats.needsReview} suspected duplicates flagged for review`);
  }

  if (stats.autoMerged > 0) {
    console.log(`🔄 ${stats.autoMerged} high-confidence duplicates skipped`);
  }

  console.log('\n📝 Next Steps:');
  console.log('   1. Review suspected duplicates in the maintenance UI');
  console.log('   2. Approve merges or keep separate');
  console.log('   3. Check Pinecone namespace for task count\n');

  // Show sample details
  if (stats.details.length > 0) {
    console.log('='.repeat(60));
    console.log('📋 Sample Results:\n');
    stats.details.slice(0, 10).forEach((d, i) => {
      console.log(`${i + 1}. [${d.system}] ${d.description}`);
      console.log(`   Action: ${d.action}`);
      if (d.similarity) {
        console.log(`   Similarity: ${(d.similarity * 100).toFixed(1)}%`);
      }
      if (d.reason) {
        console.log(`   Reason: ${d.reason}`);
      }
      console.log('');
    });
  }
}

// Run the import
importTasksWithDeduplication().catch(console.error);
