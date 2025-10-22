/**
 * OPTIMIZED: Extract, Enrich, and Upload Tasks (Combined Step 1 & 2)
 *
 * This script combines the functionality of:
 * - extract-high-scores.js (Step 1)
 * - import-all-with-ai-enrichment.js (Step 2)
 *
 * Flow:
 * 1. Read high-scoring chunks from pinecone_search_results (≥50%)
 * 2. For each chunk, call OpenAI ONCE to extract AND classify tasks
 * 3. Generate embeddings for each task
 * 4. Upload directly to Pinecone MAINTENANCE_TASKS namespace
 *
 * Benefits:
 * - 50% reduction in OpenAI calls (68 instead of 136)
 * - Faster execution (~7 mins vs ~17 mins)
 * - No intermediate JSON file
 */

import { createClient } from '@supabase/supabase-js';
import { openaiRepository } from '../src/repositories/openai.repository.js';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import { createLogger } from '../src/utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

const logger = createLogger('extract-enrich-upload');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SCORE_THRESHOLD = 0.50;

/**
 * TASK TYPE DEFINITIONS
 */
const TASK_TYPES = [
  'fluid_check',
  'filter_replacement',
  'visual_inspection',
  'lubrication',
  'cleaning',
  'adjustment',
  'parts_replacement',
  'fluid_replacement',
  'condition_based'
];

/**
 * Enhanced extraction: Extract tasks AND classify in ONE call
 */
async function extractAndClassifyTasks(chunkText, context = {}) {
  const systemPrompt = `You are a marine systems maintenance expert. Extract all maintenance tasks from the provided text AND classify them.

For each task, provide:
1. description: Clear description of the maintenance task
2. frequency_type: One of [hours, days, weeks, months, years, cycles, condition_based]
3. frequency_value: Numeric value for the frequency (or null for condition_based)
4. frequency_basis: How is this task scheduled?
   - "calendar": Time-based (every X days/months/years regardless of use)
   - "usage": Usage-based (every X operating hours, depends on equipment running)
   - "event": Triggered by specific events (startup, installation, winterization, boat lifting)
   - "condition": As-needed based on condition/inspection
   - "unknown": Cannot determine from information given
5. task_type: Type of maintenance - one of [${TASK_TYPES.join(', ')}]
6. parts_required: Array of parts/consumables needed
7. estimated_duration_hours: Estimated time to complete
8. criticality: One of [critical, important, routine, optional]
9. confidence: Your confidence in this extraction (0.0-1.0)

Classification Signals:
- "hours" in frequency usually means USAGE (operating hours)
- "days/months/years" means CALENDAR
- "startup", "before operation", "after use", "boat lifting", "install" means EVENT
- "as needed", "when necessary", "if required" means CONDITION

Focus on:
- Regular maintenance schedules
- Inspection requirements
- Cleaning procedures
- Part replacement intervals
- Lubrication schedules
- Calibration requirements

Return a JSON object with a "tasks" array containing all extracted tasks.`;

  const userPrompt = `System: ${context.manufacturer || 'Unknown'} ${context.model || 'Unknown'}
Asset: ${context.assetUid || 'Unknown'}

Text to analyze:
${chunkText}`;

  try {
    const response = await openaiRepository.createChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], {
      model: 'gpt-4o-mini',
      temperature: 0.0,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response);
    return result.tasks || [];
  } catch (error) {
    logger.error('Failed to extract and classify tasks', { error: error.message });
    return [];
  }
}

/**
 * Normalize frequency to hours (for range queries)
 */
function normalizeFrequencyToHours(task) {
  // Can only normalize calendar and usage bases
  if (!['calendar', 'usage'].includes(task.frequency_basis)) {
    return null;
  }

  if (task.frequency_value === null || task.frequency_value === undefined) {
    return null;
  }

  const value = task.frequency_value;
  const type = task.frequency_type;

  // Direct conversions
  if (type === 'hours') return value;
  if (type === 'days') return value * 24;
  if (type === 'weeks') return value * 24 * 7;
  if (type === 'months') return value * 24 * 30; // Approximate
  if (type === 'years') return value * 24 * 365; // Approximate

  return null;
}

/**
 * Main extraction and upload process
 */
async function extractEnrichAndUpload() {
  // Check for flags
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isTestMode = args.includes('--test');

  const systemIndex = args.indexOf('--system');
  const assetUidIndex = args.indexOf('--asset-uid');

  const systemFilter = systemIndex !== -1 ? args[systemIndex + 1] : null;
  const assetUidFilter = assetUidIndex !== -1 ? args[assetUidIndex + 1] : null;

  // Determine table name
  const tableName = isTestMode ? 'pinecone_search_results_test' : 'pinecone_search_results';

  console.log('\n=== OPTIMIZED: EXTRACT, ENRICH & UPLOAD TASKS ===\n');
  if (isDryRun) {
    console.log('🔍 DRY RUN MODE - No uploads will be performed\n');
  }
  if (isTestMode) {
    console.log(`🧪 TEST MODE - Reading from ${tableName} table\n`);
  }
  if (systemFilter) {
    console.log(`🔍 Filtering by system name: "${systemFilter}"\n`);
  }
  if (assetUidFilter) {
    console.log(`🔍 Filtering by asset_uid: "${assetUidFilter}"\n`);
  }
  console.log(`Threshold: ${SCORE_THRESHOLD}+ (50%)\n`);

  // Get high-scoring chunks (with optional filters)
  let query = supabase
    .from(tableName)
    .select('*')
    .gte('relevance_score', SCORE_THRESHOLD)
    .order('relevance_score', { ascending: false });

  if (systemFilter) {
    query = query.ilike('system_name', `%${systemFilter}%`);
  }

  if (assetUidFilter) {
    query = query.eq('asset_uid', assetUidFilter);
  }

  const { data: chunks, error } = await query;

  if (error) {
    console.error('Failed to fetch chunks:', error);
    return;
  }

  console.log(`Found ${chunks.length} chunks to process\n`);

  let totalTasks = 0;
  let processedCount = 0;
  let uploadedCount = 0;
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
      console.log('  🤖 Calling OpenAI (extract + classify)...');

      // Extract AND classify tasks in ONE call
      const tasks = await extractAndClassifyTasks(fullText, {
        manufacturer: chunk.manufacturer,
        model: chunk.model,
        assetUid: chunk.asset_uid,
        docId: chunk.doc_id,
      });

      if (tasks.length > 0) {
        console.log(`  ✅ Extracted ${tasks.length} tasks`);

        // Enhance tasks with metadata and normalization
        const enrichedTasks = tasks.map(task => {
          // Normalize frequency to hours
          const frequency_hours = normalizeFrequencyToHours(task);

          return {
            ...task,
            asset_uid: chunk.asset_uid,
            system_name: systemName,
            frequency_hours,
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
          };
        });

        allTasks.push(...enrichedTasks);
        totalTasks += tasks.length;

        // Show sample tasks
        if (tasks.length <= 3) {
          tasks.forEach(task => {
            console.log(`     • ${task.description.substring(0, 60)}...`);
            console.log(`       Basis: ${task.frequency_basis} | Type: ${task.task_type}`);
          });
        } else {
          console.log(`     • ${tasks[0].description.substring(0, 60)}...`);
          console.log(`       Basis: ${tasks[0].frequency_basis} | Type: ${tasks[0].task_type}`);
          console.log(`     • ${tasks[1].description.substring(0, 60)}...`);
          console.log(`       Basis: ${tasks[1].frequency_basis} | Type: ${tasks[1].task_type}`);
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

  // Show distribution
  console.log('\n=== FREQUENCY BASIS DISTRIBUTION ===');
  const basisCounts = {};
  allTasks.forEach(task => {
    basisCounts[task.frequency_basis] = (basisCounts[task.frequency_basis] || 0) + 1;
  });
  Object.entries(basisCounts).forEach(([basis, count]) => {
    console.log(`  ${basis}: ${count}`);
  });

  console.log('\n=== TASK TYPE DISTRIBUTION ===');
  const typeCounts = {};
  allTasks.forEach(task => {
    typeCounts[task.task_type] = (typeCounts[task.task_type] || 0) + 1;
  });
  Object.entries(typeCounts).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

  // Upload to Pinecone (or simulate in dry-run mode)
  if (allTasks.length > 0) {
    if (isDryRun) {
      console.log(`\n\n=== DRY RUN: SIMULATING UPLOAD ===\n`);
      console.log(`Would upload ${allTasks.length} tasks to Pinecone`);
      console.log('\nSample tasks that would be uploaded:');

      // Show first 5 tasks
      const samplesToShow = Math.min(5, allTasks.length);
      for (let i = 0; i < samplesToShow; i++) {
        const task = allTasks[i];
        console.log(`\n[${i + 1}] ${task.description}`);
        console.log(`    System: ${task.system_name}`);
        console.log(`    Frequency: ${task.frequency_value} ${task.frequency_type} (${task.frequency_basis})`);
        console.log(`    Type: ${task.task_type} | Criticality: ${task.criticality}`);
        console.log(`    Confidence: ${task.confidence} | Normalized: ${task.frequency_hours} hours`);
      }

      if (allTasks.length > samplesToShow) {
        console.log(`\n... and ${allTasks.length - samplesToShow} more tasks`);
      }

      // Save to JSON for inspection
      const fs = await import('fs');
      const filename = `dry-run-tasks-${Date.now()}.json`;
      fs.writeFileSync(filename, JSON.stringify(allTasks, null, 2));
      console.log(`\n💾 Full task list saved to: ${filename}`);
      console.log('\n⚠️  DRY RUN COMPLETE - No tasks were uploaded to Pinecone');

      uploadedCount = allTasks.length; // For statistics

    } else {
      console.log(`\n\n=== UPLOADING TO PINECONE ===\n`);
      console.log(`Total tasks to upload: ${allTasks.length}`);

      for (let i = 0; i < allTasks.length; i++) {
        const task = allTasks[i];

        try {
          console.log(`[${i + 1}/${allTasks.length}] Uploading: ${task.description.substring(0, 50)}...`);

          // Generate embedding
          const embedding = await openaiRepository.createEmbedding(task.description);

          // Generate unique ID
          const taskId = `task-${Date.now()}-${i}`;

          // Prepare metadata (only non-null values)
          const metadata = {
            task_id: taskId,
            description: task.description,
            asset_uid: task.asset_uid,
            system_name: task.system_name,
            frequency_basis: task.frequency_basis,
            task_type: task.task_type,
            criticality: task.criticality,
            confidence: task.confidence,
            source: task.source
          };

          // Add optional fields only if not null
          if (task.frequency_type !== null) metadata.frequency_type = task.frequency_type;
          if (task.frequency_value !== null) metadata.frequency_value = task.frequency_value;
          if (task.frequency_hours !== null) metadata.frequency_hours = task.frequency_hours;
          if (task.estimated_duration_hours !== null) metadata.estimated_duration_hours = task.estimated_duration_hours;

          // Upload to Pinecone
          await pineconeRepository.upsertTask(taskId, embedding, metadata);

          uploadedCount++;
          console.log(`  ✅ Uploaded (${uploadedCount}/${allTasks.length})`);

          // Small delay
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
          console.log(`  ❌ Upload failed: ${error.message}`);
        }
      }

      console.log(`\n✅ Successfully uploaded ${uploadedCount}/${allTasks.length} tasks to Pinecone`);
    }
  }

  // Show tasks by system
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
  console.log('Summary:');
  console.log(`  - Chunks processed: ${processedCount}`);
  console.log(`  - Tasks extracted: ${totalTasks}`);
  if (isDryRun) {
    console.log(`  - Tasks that would be uploaded: ${uploadedCount}`);
    console.log(`  - OpenAI calls made: ${processedCount} (extraction only, no embeddings in dry-run)`);
    console.log(`  - Estimated calls if run for real: ${processedCount + uploadedCount} total`);
    console.log(`  - Estimated savings vs old method: ${(136 - (processedCount + uploadedCount))} fewer calls`);
    console.log(`\n🔍 This was a DRY RUN - to actually upload, run without --dry-run flag\n`);
  } else {
    console.log(`  - Tasks uploaded to Pinecone: ${uploadedCount}`);
    console.log(`  - OpenAI calls: ${processedCount} (extraction) + ${uploadedCount} (embeddings) = ${processedCount + uploadedCount}`);
    console.log(`  - Savings vs old method: ${(136 - (processedCount + uploadedCount))} fewer calls\n`);
  }
}

extractEnrichAndUpload().catch(console.error);
