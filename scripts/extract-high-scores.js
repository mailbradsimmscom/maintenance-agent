/**
 * Extract maintenance tasks from high-scoring chunks using OpenAI
 */

import { createClient } from '@supabase/supabase-js';
import { openaiRepository } from '../src/repositories/openai.repository.js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SCORE_THRESHOLD = 0.50;

async function extractHighScores() {
  console.log('\n=== EXTRACTING MAINTENANCE FROM HIGH-SCORING CHUNKS ===\n');
  console.log(`Threshold: ${SCORE_THRESHOLD}+\n`);

  // Get high-scoring chunks
  const { data: chunks, error } = await supabase
    .from('pinecone_search_results')
    .select('*')
    .gte('relevance_score', SCORE_THRESHOLD)
    .order('relevance_score', { ascending: false });

  if (error) {
    console.error('Failed to fetch chunks:', error);
    return;
  }

  console.log(`Found ${chunks.length} chunks to process\n`);

  let totalTasks = 0;
  let processedCount = 0;
  const allTasks = [];

  for (const chunk of chunks) {
    processedCount++;
    const systemName = chunk.system_name || 'Unknown';

    console.log(`\n[${processedCount}/${chunks.length}] Processing: ${systemName.substring(0, 50)}`);
    console.log(`  Score: ${chunk.relevance_score} | Section: ${chunk.section_title || 'N/A'}`);

    try {
      const fullText = chunk.chunk_metadata?.text;

      if (!fullText) {
        console.log('  ⚠️  No text found in chunk');
        continue;
      }

      console.log(`  📄 Text length: ${fullText.length} chars`);
      console.log('  🤖 Calling OpenAI...');

      // Extract tasks using OpenAI
      const tasks = await openaiRepository.extractMaintenanceTasks(fullText, {
        manufacturer: chunk.manufacturer,
        model: chunk.model,
        assetUid: chunk.asset_uid,
        docId: chunk.doc_id,
      });

      if (tasks.length > 0) {
        console.log(`  ✅ Extracted ${tasks.length} tasks`);

        // Add source information
        const tasksWithSource = tasks.map(task => ({
          ...task,
          asset_uid: chunk.asset_uid,
          system_name: systemName,
          source: 'manual',
          source_details: {
            doc_id: chunk.doc_id,
            chunk_id: chunk.chunk_id,
            relevance_score: chunk.relevance_score,
            section_title: chunk.section_title,
            page_start: chunk.page_start,
            page_end: chunk.page_end,
          },
          status: 'pending',
          created_at: new Date().toISOString(),
        }));

        allTasks.push(...tasksWithSource);
        totalTasks += tasks.length;

        // Show sample tasks
        if (tasks.length <= 3) {
          tasks.forEach(task => {
            console.log(`     • ${task.description.substring(0, 60)}...`);
          });
        } else {
          console.log(`     • ${tasks[0].description.substring(0, 60)}...`);
          console.log(`     • ${tasks[1].description.substring(0, 60)}...`);
          console.log(`     ... and ${tasks.length - 2} more`);
        }
      } else {
        console.log('  ⚠️  No tasks extracted');
      }

      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }

  console.log('\n\n=== EXTRACTION SUMMARY ===');
  console.log(`Chunks processed: ${processedCount}`);
  console.log(`Total tasks extracted: ${totalTasks}`);
  console.log(`Average tasks per chunk: ${(totalTasks / processedCount).toFixed(1)}`);

  // Store tasks in database
  if (allTasks.length > 0) {
    console.log('\n💾 Storing tasks in database...');

    // Check if maintenance_tasks_queue table exists
    const { error: tableError } = await supabase
      .from('maintenance_tasks_queue')
      .select('count')
      .limit(0);

    if (tableError && tableError.message.includes('does not exist')) {
      console.log('\n⚠️  maintenance_tasks_queue table does not exist');
      console.log('Tasks will be saved to JSON file instead...');

      // Save to file
      const fs = await import('fs');
      const filename = `extracted_tasks_${new Date().toISOString().split('T')[0]}.json`;
      fs.writeFileSync(filename, JSON.stringify(allTasks, null, 2));
      console.log(`✅ Saved to ${filename}`);

    } else {
      // Store in database
      const { error: insertError } = await supabase
        .from('maintenance_tasks_queue')
        .insert(allTasks);

      if (insertError) {
        console.error('❌ Failed to store tasks:', insertError);
        console.log('\nSaving to JSON file as fallback...');
        const fs = await import('fs');
        const filename = `extracted_tasks_${new Date().toISOString().split('T')[0]}.json`;
        fs.writeFileSync(filename, JSON.stringify(allTasks, null, 2));
        console.log(`✅ Saved to ${filename}`);
      } else {
        console.log(`✅ Stored ${allTasks.length} tasks in maintenance_tasks_queue`);
      }
    }
  }

  // Show task breakdown by system
  console.log('\n=== TASKS BY SYSTEM ===');
  const tasksBySystem = {};
  allTasks.forEach(task => {
    const system = task.system_name || 'Unknown';
    if (!tasksBySystem[system]) {
      tasksBySystem[system] = 0;
    }
    tasksBySystem[system]++;
  });

  Object.entries(tasksBySystem)
    .sort((a, b) => b[1] - a[1])
    .forEach(([system, count]) => {
      console.log(`  ${system}: ${count} tasks`);
    });

  console.log('\n✅ Done!\n');
}

extractHighScores().catch(console.error);