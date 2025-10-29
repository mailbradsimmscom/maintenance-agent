import dotenv from 'dotenv';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import deduplicationReviewRepository from '../src/repositories/deduplication-review.repository.js';

dotenv.config();

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * DEDUPLICATION THRESHOLDS
 */
const THRESHOLDS = {
  semantic: {
    min: 0.65,           // 65% - Minimum similarity to consider as duplicate (REVIEW MODE - more aggressive)
    highConfidence: 0.75 // 75% - Override frequency check (typos/exact matches)
  },
  frequency: {
    tight: 0.10,         // ±10% for frequent tasks (<100 hours)
    medium: 0.15,        // ±15% for medium tasks (100-1000 hours)
    loose: 0.20          // ±20% for rare tasks (>1000 hours)
  }
};

/**
 * Enhancement #2: Dynamic tolerance based on frequency range
 */
function getToleranceForFrequency(hours) {
  if (hours === null) return null;
  if (hours < 100) return THRESHOLDS.frequency.tight;
  if (hours < 1000) return THRESHOLDS.frequency.medium;
  return THRESHOLDS.frequency.loose;
}

/**
 * Check if two frequencies are similar with dynamic tolerance
 */
function areFrequenciesSimilar(freq1Hours, freq2Hours, customTolerance = null) {
  if (freq1Hours === null || freq2Hours === null) {
    return null; // Can't compare
  }

  // Determine tolerance based on frequency range
  const tolerance = customTolerance || getToleranceForFrequency((freq1Hours + freq2Hours) / 2);

  const diff = Math.abs(freq1Hours - freq2Hours);
  const avg = (freq1Hours + freq2Hours) / 2;

  return diff / avg <= tolerance;
}

/**
 * Fetch all tasks from Pinecone MAINTENANCE_TASKS namespace with embeddings
 */
async function fetchAllTasksFromPinecone() {
  console.log('📥 Fetching all tasks from Pinecone...\n');

  try {
    // Use listAllTasks to get vectors with embeddings
    const records = await pineconeRepository.listAllTasks();

    console.log(`✅ Fetched ${records.length} tasks with embeddings\n`);

    // Transform to easier format with stored embeddings
    return records.map(record => ({
      id: record.id,
      embedding: record.values, // Use stored embedding!
      description: record.metadata.description,
      asset_uid: record.metadata.asset_uid,
      system_name: record.metadata.system_name,
      frequency_basis: record.metadata.frequency_basis,
      frequency_type: record.metadata.frequency_type ?? null,
      frequency_value: record.metadata.frequency_value ?? null,
      frequency_hours: record.metadata.frequency_hours ?? null,
      task_type: record.metadata.task_type,
      criticality: record.metadata.criticality ?? null,
      confidence: record.metadata.confidence ?? null
    }));
  } catch (error) {
    console.error('❌ Error fetching tasks:', error.message);
    throw error;
  }
}

/**
 * Check if two tasks are duplicates based on metadata and similarity
 */
function checkIfDuplicate(taskA, taskB, similarity) {
  // Quick metadata filters first
  if (taskA.asset_uid !== taskB.asset_uid) {
    return { isDuplicate: false, reason: 'different_asset' };
  }

  // Enhancement #4: Handle unknown basis differently
  if (taskA.frequency_basis !== 'unknown' && taskB.frequency_basis !== 'unknown') {
    if (taskA.frequency_basis !== taskB.frequency_basis) {
      return { isDuplicate: false, reason: 'different_frequency_basis' };
    }
  }

  // Optional: Filter by task_type
  if (taskA.task_type !== taskB.task_type) {
    return { isDuplicate: false, reason: 'different_task_type' };
  }

  // Check semantic similarity threshold
  if (similarity < THRESHOLDS.semantic.min) {
    return { isDuplicate: false, reason: 'low_similarity' };
  }

  // Enhancement #1: Event & Condition basis don't need frequency comparison
  if (['event', 'condition'].includes(taskA.frequency_basis)) {
    return {
      isDuplicate: true,
      reason: 'semantic_match_event_or_condition_based',
      score: similarity
    };
  }

  // Enhancement #3: Handle null frequencies
  if (taskA.frequency_hours === null && taskB.frequency_hours === null) {
    return {
      isDuplicate: true,
      reason: 'semantic_match_no_frequency',
      score: similarity
    };
  }

  if (taskA.frequency_hours === null || taskB.frequency_hours === null) {
    return {
      isDuplicate: false,
      reason: 'frequency_data_mismatch'
    };
  }

  // Enhancement #4: Unknown basis requires strict frequency match
  const tolerance = taskA.frequency_basis === 'unknown'
    ? 0.05  // 5% strict tolerance
    : null; // Use dynamic tolerance

  const frequenciesMatch = areFrequenciesSimilar(taskA.frequency_hours, taskB.frequency_hours, tolerance);

  // Compound decision
  if (similarity >= THRESHOLDS.semantic.min && frequenciesMatch) {
    return {
      isDuplicate: true,
      reason: 'semantic_and_frequency_match',
      score: similarity
    };
  }

  // Enhancement: High-confidence override (95%+ = duplicate regardless)
  if (similarity >= THRESHOLDS.semantic.highConfidence) {
    return {
      isDuplicate: true,
      reason: 'high_confidence_semantic_match',
      score: similarity,
      warning: 'frequency_mismatch'
    };
  }

  return {
    isDuplicate: false,
    reason: 'frequency_mismatch'
  };
}

/**
 * Build duplicate groups from pairwise duplicates
 * Groups tasks that are duplicates of each other into clusters
 */
function buildDuplicateGroups(duplicatePairs) {
  const groups = new Map();
  const taskToGroup = new Map();

  duplicatePairs.forEach(pair => {
    const { taskA, taskB } = pair;

    // If neither task is in a group yet, create new group
    if (!taskToGroup.has(taskA.id) && !taskToGroup.has(taskB.id)) {
      const groupId = taskA.id; // Use first task as primary
      groups.set(groupId, {
        primary: taskA,
        duplicates: [taskB]
      });
      taskToGroup.set(taskA.id, groupId);
      taskToGroup.set(taskB.id, groupId);
    }
    // If taskA is already in a group, add taskB to it
    else if (taskToGroup.has(taskA.id)) {
      const groupId = taskToGroup.get(taskA.id);
      const group = groups.get(groupId);
      if (!group.duplicates.find(d => d.id === taskB.id) && group.primary.id !== taskB.id) {
        group.duplicates.push(taskB);
        taskToGroup.set(taskB.id, groupId);
      }
    }
    // If taskB is already in a group, add taskA to it
    else if (taskToGroup.has(taskB.id)) {
      const groupId = taskToGroup.get(taskB.id);
      const group = groups.get(groupId);
      if (!group.duplicates.find(d => d.id === taskA.id) && group.primary.id !== taskA.id) {
        group.duplicates.push(taskA);
        taskToGroup.set(taskA.id, groupId);
      }
    }
  });

  return Array.from(groups.values());
}

/**
 * Save deduplication results to database
 */
async function saveResultsToDatabase(results, systemFilter, assetUidFilter) {
  try {
    // Create analysis run record
    const analysisId = await deduplicationReviewRepository.createAnalysisRun({
      analysis_date: results.analysis_date,
      total_tasks: results.total_tasks,
      duplicate_pairs_found: results.duplicate_pairs_count,
      duplicate_groups_found: results.duplicate_groups_count,
      thresholds: results.thresholds,
      filters: {
        systemFilter: systemFilter || null,
        assetUidFilter: assetUidFilter || null
      }
    });

    console.log(`📊 Created analysis run: ${analysisId}`);

    // Save all duplicate pairs
    if (results.duplicate_pairs.length > 0) {
      const count = await deduplicationReviewRepository.bulkSavePairs(
        analysisId,
        results.duplicate_pairs
      );
      console.log(`✅ Saved ${count} duplicate pairs for review`);
    } else {
      console.log(`ℹ️  No duplicate pairs to save`);
    }

    return analysisId;
  } catch (error) {
    console.error('❌ Failed to save results to database:', error.message);
    throw error;
  }
}

/**
 * Main deduplication analysis (in-memory pairwise comparison)
 */
async function analyzeDuplicates() {
  console.log('🔍 TASK DEDUPLICATION ANALYSIS\n');
  console.log('='.repeat(80));
  console.log('This script identifies suspected duplicates WITHOUT modifying Pinecone\n');

  // Fetch all tasks with stored embeddings
  const allTasks = await fetchAllTasksFromPinecone();

  // Parse filter arguments
  const args = process.argv.slice(2);
  const systemIndex = args.indexOf('--system');
  const assetUidIndex = args.indexOf('--asset-uid');
  const systemFilter = systemIndex !== -1 ? args[systemIndex + 1] : null;
  const assetUidFilter = assetUidIndex !== -1 ? args[assetUidIndex + 1] : null;

  // Filter tasks
  let filteredTasks = allTasks;
  if (systemFilter) {
    console.log(`🔍 Filtering by system name: "${systemFilter}"\n`);
    filteredTasks = filteredTasks.filter(t =>
      t.system_name && t.system_name.toLowerCase().includes(systemFilter.toLowerCase())
    );
  }
  if (assetUidFilter) {
    console.log(`🔍 Filtering by asset_uid: "${assetUidFilter}"\n`);
    filteredTasks = filteredTasks.filter(t => t.asset_uid === assetUidFilter);
  }

  if (systemFilter || assetUidFilter) {
    console.log(`Filtered to ${filteredTasks.length} tasks (from ${allTasks.length} total)\n`);
  }

  console.log('='.repeat(80));
  console.log('\n🧪 Performing pairwise comparison (in-memory)...\n');

  const duplicatePairs = [];
  const totalComparisons = (filteredTasks.length * (filteredTasks.length - 1)) / 2;
  let comparisonsProcessed = 0;

  console.log(`Total comparisons to perform: ${totalComparisons}\n`);

  // Pairwise comparison - O(n²) but in-memory (fast and free)
  for (let i = 0; i < filteredTasks.length; i++) {
    const taskA = filteredTasks[i];

    for (let j = i + 1; j < filteredTasks.length; j++) {
      const taskB = filteredTasks[j];
      comparisonsProcessed++;

      // Quick metadata filters before expensive similarity calculation
      if (taskA.asset_uid !== taskB.asset_uid) continue;
      if (taskA.frequency_basis !== 'unknown' && taskB.frequency_basis !== 'unknown') {
        if (taskA.frequency_basis !== taskB.frequency_basis) continue;
      }
      if (taskA.task_type !== taskB.task_type) continue;

      // Calculate cosine similarity
      const similarity = cosineSimilarity(taskA.embedding, taskB.embedding);

      // Check if duplicate
      const result = checkIfDuplicate(taskA, taskB, similarity);

      if (result.isDuplicate) {
        duplicatePairs.push({
          taskA,
          taskB,
          similarity_score: result.score,
          reason: result.reason,
          warning: result.warning || null
        });

        // Log discovery
        console.log(`[${comparisonsProcessed}/${totalComparisons}] DUPLICATE FOUND:`);
        console.log(`  ${taskA.id}: "${taskA.description.substring(0, 50)}..."`);
        console.log(`  ${taskB.id}: "${taskB.description.substring(0, 50)}..."`);
        console.log(`  Similarity: ${(similarity * 100).toFixed(1)}% | Reason: ${result.reason}\n`);
      }
    }

    // Progress update every 10 tasks
    if ((i + 1) % 10 === 0) {
      const progress = ((comparisonsProcessed / totalComparisons) * 100).toFixed(1);
      console.log(`Progress: ${comparisonsProcessed}/${totalComparisons} comparisons (${progress}%)`);
    }
  }

  // Build duplicate groups
  console.log('\n🔗 Building duplicate groups...\n');
  const duplicateGroups = buildDuplicateGroups(duplicatePairs);

  // Count total duplicate tasks
  const totalDuplicateTasks = duplicateGroups.reduce((sum, group) => sum + group.duplicates.length, 0);
  const uniqueTaskCount = filteredTasks.length - totalDuplicateTasks;

  console.log('='.repeat(80));
  console.log('\n🎯 DEDUPLICATION SUMMARY\n');
  console.log(`Total tasks analyzed:     ${filteredTasks.length}`);
  console.log(`Duplicate pairs found:    ${duplicatePairs.length}`);
  console.log(`Duplicate groups:         ${duplicateGroups.length}`);
  console.log(`Total duplicate tasks:    ${totalDuplicateTasks}`);
  console.log(`Unique tasks:             ${uniqueTaskCount}`);
  console.log(`Reduction:                ${((totalDuplicateTasks / filteredTasks.length) * 100).toFixed(1)}%\n`);

  // Group by reason
  console.log('='.repeat(80));
  console.log('\n📊 DUPLICATE REASONS\n');
  const reasonCounts = {};
  duplicatePairs.forEach(d => {
    reasonCounts[d.reason] = (reasonCounts[d.reason] || 0) + 1;
  });
  Object.entries(reasonCounts).forEach(([reason, count]) => {
    console.log(`  ${reason}: ${count}`);
  });

  // Display duplicate groups
  console.log('\n' + '='.repeat(80));
  console.log('\n📋 DUPLICATE GROUPS\n');

  duplicateGroups.forEach((group, idx) => {
    console.log(`${idx + 1}. Group (${group.duplicates.length} duplicates):`);
    console.log(`   Primary:   [${group.primary.id}]`);
    console.log(`              "${group.primary.description.substring(0, 70)}..."`);
    console.log(`              Basis: ${group.primary.frequency_basis}, Freq: ${group.primary.frequency_hours}hrs`);
    console.log(`   Duplicates:`);
    group.duplicates.forEach((dup, dupIdx) => {
      const pair = duplicatePairs.find(p =>
        (p.taskA.id === group.primary.id && p.taskB.id === dup.id) ||
        (p.taskB.id === group.primary.id && p.taskA.id === dup.id)
      );
      console.log(`     ${dupIdx + 1}. [${dup.id}]`);
      console.log(`        "${dup.description.substring(0, 70)}..."`);
      if (pair) {
        console.log(`        Similarity: ${(pair.similarity_score * 100).toFixed(1)}% | Reason: ${pair.reason}`);
      }
    });
    console.log('');
  });

  // Save results to database
  const results = {
    analysis_date: new Date().toISOString(),
    total_tasks: filteredTasks.length,
    duplicate_pairs_count: duplicatePairs.length,
    duplicate_groups_count: duplicateGroups.length,
    total_duplicate_tasks: totalDuplicateTasks,
    unique_tasks: uniqueTaskCount,
    reduction_percent: ((totalDuplicateTasks / filteredTasks.length) * 100).toFixed(1),
    thresholds: THRESHOLDS,
    duplicate_pairs: duplicatePairs.map(p => ({
      taskA: {
        id: p.taskA.id,
        description: p.taskA.description,
        system_name: p.taskA.system_name,
        asset_uid: p.taskA.asset_uid,
        frequency_type: p.taskA.frequency_type,
        frequency_value: p.taskA.frequency_value,
        frequency_hours: p.taskA.frequency_hours,
        frequency_basis: p.taskA.frequency_basis,
        task_type: p.taskA.task_type,
        criticality: p.taskA.criticality,
        confidence: p.taskA.confidence
      },
      taskB: {
        id: p.taskB.id,
        description: p.taskB.description,
        system_name: p.taskB.system_name,
        asset_uid: p.taskB.asset_uid,
        frequency_type: p.taskB.frequency_type,
        frequency_value: p.taskB.frequency_value,
        frequency_hours: p.taskB.frequency_hours,
        frequency_basis: p.taskB.frequency_basis,
        task_type: p.taskB.task_type,
        criticality: p.taskB.criticality,
        confidence: p.taskB.confidence
      },
      similarity_score: p.similarity_score,
      reason: p.reason,
      warning: p.warning
    })),
    duplicate_groups: duplicateGroups.map(g => ({
      primary_id: g.primary.id,
      primary_description: g.primary.description,
      duplicate_ids: g.duplicates.map(d => d.id),
      duplicate_count: g.duplicates.length
    }))
  };

  // Save to database
  console.log('='.repeat(80));
  console.log('\n💾 Saving results to database...\n');

  const analysisId = await saveResultsToDatabase(results, systemFilter, assetUidFilter);

  console.log('='.repeat(80));
  console.log(`\n✅ Results saved to database (Analysis ID: ${analysisId})\n`);
  console.log('='.repeat(80));
  console.log('\n✅ Deduplication analysis complete!\n');

  // Return results for potential deletion
  return {
    duplicateGroups,
    duplicatePairs,
    totalDuplicateTasks
  };
}

/**
 * Delete duplicate tasks from Pinecone
 */
async function deleteDuplicates(duplicateGroups) {
  console.log('='.repeat(80));
  console.log('\n🗑️  DELETING DUPLICATES FROM PINECONE\n');

  // Collect all duplicate IDs (not primary IDs)
  const duplicateIds = [];
  duplicateGroups.forEach(group => {
    group.duplicates.forEach(dup => {
      duplicateIds.push(dup.id);
    });
  });

  console.log(`Found ${duplicateIds.length} duplicate tasks to delete\n`);

  let deletedCount = 0;
  let errorCount = 0;

  for (const id of duplicateIds) {
    try {
      await pineconeRepository.deleteTask(id);
      deletedCount++;
      console.log(`✅ Deleted: ${id} (${deletedCount}/${duplicateIds.length})`);
    } catch (error) {
      console.error(`❌ Failed to delete ${id}: ${error.message}`);
      errorCount++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n📊 DELETION SUMMARY\n');
  console.log(`Successfully deleted:  ${deletedCount}`);
  console.log(`Failed:                ${errorCount}`);
  console.log(`\n✅ Deletion complete!\n`);
  console.log('='.repeat(80) + '\n');
}

// Main execution
async function main() {
  // Step 1: Run deduplication analysis
  const results = await analyzeDuplicates();

  // Step 2: Ask user if they want to delete duplicates
  if (results.totalDuplicateTasks > 0) {
    console.log('⚠️  Do you want to DELETE the duplicate tasks from Pinecone?');
    console.log('   This will remove the duplicate tasks, keeping only the primary tasks.\n');
    console.log('   Type "yes" to delete, or anything else to skip: ');

    // Check if running with --delete flag
    const args = process.argv.slice(2);
    if (args.includes('--delete')) {
      console.log('   --delete flag detected, proceeding with deletion...\n');
      await deleteDuplicates(results.duplicateGroups);
    } else {
      console.log('   Run with --delete flag to delete duplicates\n');
      console.log('   Example: node scripts/deduplicate-tasks.js --delete\n');
    }
  } else {
    console.log('No duplicates found - nothing to delete.\n');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
