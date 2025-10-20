import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import {
  classifyTaskType,
  generateTaskEmbedding,
  checkForDuplicates,
  normalizeFrequencyToHours,
  areFrequenciesSimilar
} from '../src/services/task-embedding.service.js';

dotenv.config();

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Check task against simulated Pinecone (in-memory)
 * Mimics the real checkForDuplicates but queries local array instead of Pinecone
 */
async function checkAgainstSimulated(task, embedding, simulatedPinecone, options = {}) {
  const {
    autoMergeThreshold = 0.92,
    reviewThreshold = 0.85
  } = options;

  // Filter by same system and task type (if applicable)
  const candidates = simulatedPinecone.filter(existing => {
    if (task.asset_uid && existing.metadata.asset_uid !== task.asset_uid) {
      return false;
    }
    if (task.task_type && task.task_type !== 'unknown' &&
        existing.metadata.task_type !== task.task_type) {
      return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    return { isDuplicate: false, action: 'insert', matches: [] };
  }

  // Calculate similarity scores
  const scoredCandidates = candidates.map(candidate => ({
    ...candidate,
    score: cosineSimilarity(embedding, candidate.embedding)
  }));

  // Sort by score descending
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Get all matches above 70% for analysis (but decision uses reviewThreshold)
  const allMatches = scoredCandidates.filter(c => c.score >= 0.70);
  const similarTasks = scoredCandidates.filter(c => c.score >= reviewThreshold);

  if (similarTasks.length === 0) {
    // No matches above review threshold, but return all matches for borderline analysis
    return { isDuplicate: false, action: 'insert', matches: allMatches.map(t => ({
      taskId: t.id,
      score: t.score,
      metadata: t.metadata
    })) };
  }

  const bestMatch = similarTasks[0];

  // Check frequency similarity
  const taskFreqHours = normalizeFrequencyToHours(task);
  const matchFreqHours = bestMatch.metadata.frequency_hours;
  const frequenciesMatch = areFrequenciesSimilar(taskFreqHours, matchFreqHours);

  // Check task type match
  const taskTypeMatches = task.task_type &&
                          task.task_type !== 'unknown' &&
                          task.task_type === bestMatch.metadata.task_type;

  // ============================================================
  // COMPOUND LOGIC DECISION TREE
  // ============================================================

  // 1. HIGH CONFIDENCE AUTO-MERGE
  // Similarity ≥92% + frequency match + type match
  if (bestMatch.score >= autoMergeThreshold && frequenciesMatch && taskTypeMatches) {
    return {
      isDuplicate: true,
      action: 'auto_merge',
      primaryTask: {
        taskId: bestMatch.id,
        score: bestMatch.score,
        metadata: bestMatch.metadata
      },
      reason: `High similarity (${(bestMatch.score * 100).toFixed(1)}%) + matching frequency + matching type`
    };
  }

  // 2. MODERATE CONFIDENCE REVIEW
  // Option A: High similarity alone (≥85%)
  // Option B: Moderate similarity (≥80%) + multiple matching signals
  const compoundReviewThreshold = 0.80;
  const highSimilarity = bestMatch.score >= reviewThreshold;
  const compoundMatch = bestMatch.score >= compoundReviewThreshold &&
                        frequenciesMatch &&
                        taskTypeMatches;

  if (highSimilarity || compoundMatch) {
    let reason;
    if (compoundMatch && bestMatch.score < reviewThreshold) {
      reason = `Compound match: ${(bestMatch.score * 100).toFixed(1)}% similarity + matching frequency + matching type`;
    } else if (frequenciesMatch) {
      reason = `Moderate similarity (${(bestMatch.score * 100).toFixed(1)}%) + matching frequency`;
    } else {
      reason = `Similarity ${(bestMatch.score * 100).toFixed(1)}% but different frequencies`;
    }

    return {
      isDuplicate: true,
      action: 'review_required',
      primaryTask: {
        taskId: bestMatch.id,
        score: bestMatch.score,
        metadata: bestMatch.metadata
      },
      matches: similarTasks.map(t => ({
        taskId: t.id,
        score: t.score,
        metadata: t.metadata
      })),
      reason
    };
  }

  // 3. LOW CONFIDENCE INSERT
  // Similarity <80% or metadata doesn't match
  return {
    isDuplicate: false,
    action: 'insert',
    matches: similarTasks.map(t => ({
      taskId: t.id,
      score: t.score,
      metadata: t.metadata
    }))
  };
}

async function analyzeDuplication() {
  console.log('📊 DRY-RUN: Analyzing Deduplication Decisions\n');
  console.log('='.repeat(80));

  const tasksJson = readFileSync('extracted_tasks_2025-10-19.json', 'utf-8');
  const tasks = JSON.parse(tasksJson);

  console.log(`Loaded ${tasks.length} tasks from JSON`);
  console.log('Simulating incremental import (tasks check against previously processed)\n');

  const categories = {
    insert: [],
    needsReview: [],
    autoMerge: [],
    borderline: []  // 70-85% similarity - not flagged but worth reviewing
  };

  const stats = {
    total: tasks.length,
    inserted: 0,
    needsReview: 0,
    autoMerged: 0,
    borderline: 0,
    errors: 0
  };

  // In-memory simulation of Pinecone - stores embeddings and metadata of "inserted" tasks
  const simulatedPinecone = [];

  console.log('Processing tasks (this will take a few minutes)...\n');

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];

    try {
      // Classify and embed
      task.task_type = classifyTaskType(task.description);
      const embedding = await generateTaskEmbedding(task.description);

      // Check against simulated Pinecone (previously inserted tasks)
      const dupCheck = await checkAgainstSimulated(task, embedding, simulatedPinecone, {
        autoMergeThreshold: 0.92,
        reviewThreshold: 0.85,
        compoundReviewThreshold: 0.80
      });

      // Categorize
      if (dupCheck.action === 'insert') {
        // Check if this has borderline matches (70-85% similarity)
        const hasBorderlineMatch = dupCheck.matches && dupCheck.matches.some(m => m.score >= 0.70 && m.score < 0.85);

        if (hasBorderlineMatch) {
          categories.borderline.push({ task, dupCheck, taskIndex: i });
          stats.borderline++;
        } else {
          categories.insert.push({ task, dupCheck, taskIndex: i });
        }

        stats.inserted++;

        // Add to simulated Pinecone for future comparisons
        simulatedPinecone.push({
          id: `task-${i}`,
          embedding,
          metadata: {
            task_id: `task-${i}`,
            description: task.description,
            asset_uid: task.asset_uid,
            system_name: task.system_name,
            frequency_hours: normalizeFrequencyToHours(task),
            frequency_type: task.frequency_type,
            frequency_value: task.frequency_value,
            task_type: task.task_type
          }
        });

      } else if (dupCheck.action === 'review_required') {
        categories.needsReview.push({ task, dupCheck, taskIndex: i });
        stats.needsReview++;
      } else if (dupCheck.action === 'auto_merge') {
        categories.autoMerge.push({ task, dupCheck, taskIndex: i });
        stats.autoMerged++;
      }

      // Progress indicator
      if ((i + 1) % 10 === 0) {
        console.log(`✅ Processed ${i + 1}/${tasks.length} tasks... (${simulatedPinecone.length} in simulated Pinecone)`);
      }

    } catch (error) {
      console.error(`❌ Error processing: ${task.description.substring(0, 50)}`);
      console.error(`   ${error.message}\n`);
      stats.errors++;
    }
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '='.repeat(80));
  console.log('📊 DEDUPLICATION ANALYSIS SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total tasks:                ${stats.total}`);
  console.log(`✅ Would insert (unique):   ${stats.inserted}`);
  console.log(`   ├─ Truly unique:         ${categories.insert.length}`);
  console.log(`   └─ Borderline (70-85%):  ${stats.borderline}`);
  console.log(`⚠️  Would flag for review:  ${stats.needsReview}`);
  console.log(`🔄 Would auto-merge:        ${stats.autoMerged}`);
  console.log(`❌ Errors:                  ${stats.errors}`);
  console.log('='.repeat(80) + '\n');

  // ============================================================
  // AUTO-MERGE CANDIDATES (≥92% + freq match)
  // ============================================================
  if (categories.autoMerge.length > 0) {
    console.log('🔄 AUTO-MERGE CANDIDATES (≥92% + Frequency Match)\n');
    console.log('='.repeat(80));
    console.log('These tasks would be automatically merged (skipped during import):\n');

    categories.autoMerge.forEach((item, idx) => {
      const { task, dupCheck } = item;
      const primary = dupCheck.primaryTask;

      console.log(`${idx + 1}. [${task.system_name}]`);
      console.log(`   NEW TASK:     ${task.description}`);
      console.log(`   Frequency:    ${task.frequency_value} ${task.frequency_type}`);
      console.log(`   Task Type:    ${task.task_type}`);
      console.log('');
      console.log(`   MATCHES:      ${primary.metadata.description}`);
      console.log(`   Frequency:    ${primary.metadata.frequency_value} ${primary.metadata.frequency_type}`);
      console.log(`   Task Type:    ${primary.metadata.task_type}`);
      console.log('');
      console.log(`   📊 Similarity: ${(primary.score * 100).toFixed(1)}%`);
      console.log(`   📊 Freq Match: ${areFrequenciesSimilar(
        normalizeFrequencyToHours(task),
        primary.metadata.frequency_hours
      ) ? 'YES' : 'NO'}`);
      console.log(`   📊 Reason:    ${dupCheck.reason}`);
      console.log('-'.repeat(80));
    });
  } else {
    console.log('✅ No auto-merge candidates found\n');
  }

  // ============================================================
  // REVIEW REQUIRED (85-91%)
  // ============================================================
  if (categories.needsReview.length > 0) {
    console.log('\n⚠️  REVIEW REQUIRED (85-91% Similarity)\n');
    console.log('='.repeat(80));
    console.log('These tasks would be flagged for manual review:\n');

    categories.needsReview.forEach((item, idx) => {
      const { task, dupCheck } = item;
      const primary = dupCheck.primaryTask;

      console.log(`${idx + 1}. [${task.system_name}]`);
      console.log(`   NEW TASK:     ${task.description}`);
      console.log(`   Frequency:    ${task.frequency_value} ${task.frequency_type}`);
      console.log('');
      console.log(`   SIMILAR TO:   ${primary.metadata.description}`);
      console.log(`   Frequency:    ${primary.metadata.frequency_value} ${primary.metadata.frequency_type}`);
      console.log('');
      console.log(`   📊 Similarity: ${(primary.score * 100).toFixed(1)}%`);
      console.log(`   📊 Freq Match: ${areFrequenciesSimilar(
        normalizeFrequencyToHours(task),
        primary.metadata.frequency_hours
      ) ? 'YES' : 'NO'}`);
      console.log(`   📊 Reason:    ${dupCheck.reason}`);
      console.log('-'.repeat(80));
    });
  } else {
    console.log('\n✅ No tasks need manual review\n');
  }

  // ============================================================
  // BORDERLINE CASES (70-85%)
  // ============================================================
  if (categories.borderline.length > 0) {
    console.log('\n🔍 BORDERLINE CASES (70-85% Similarity)\n');
    console.log('='.repeat(80));
    console.log('These tasks would be inserted as unique, but have some similarity:\n');

    categories.borderline.forEach((item, idx) => {
      const { task, dupCheck } = item;

      // Find the best borderline match
      const borderlineMatches = dupCheck.matches
        .filter(m => m.score >= 0.70 && m.score < 0.85)
        .sort((a, b) => b.score - a.score);

      const bestMatch = borderlineMatches[0];

      console.log(`${idx + 1}. [${task.system_name}]`);
      console.log(`   NEW TASK:     ${task.description}`);
      console.log(`   Frequency:    ${task.frequency_value} ${task.frequency_type}`);
      console.log('');
      console.log(`   SIMILAR TO:   ${bestMatch.metadata.description}`);
      console.log(`   Frequency:    ${bestMatch.metadata.frequency_value} ${bestMatch.metadata.frequency_type}`);
      console.log('');
      console.log(`   📊 Similarity: ${(bestMatch.score * 100).toFixed(1)}%`);
      console.log(`   📊 Freq Match: ${areFrequenciesSimilar(
        normalizeFrequencyToHours(task),
        bestMatch.metadata.frequency_hours
      ) ? 'YES' : 'NO'}`);
      console.log(`   💡 Note: Below 85% threshold, treated as separate task`);
      console.log('-'.repeat(80));
    });
  } else {
    console.log('\n✅ No borderline cases\n');
  }

  // ============================================================
  // UNIQUE TASKS (<70%)
  // ============================================================
  console.log('\n✅ TRULY UNIQUE TASKS (<70% Similarity)\n');
  console.log('='.repeat(80));
  console.log(`${categories.insert.length} tasks would be inserted with no similar matches\n`);

  if (categories.insert.length > 0) {
    console.log('Sample unique tasks (showing first 10):\n');
    categories.insert.slice(0, 10).forEach((item, idx) => {
      const { task } = item;
      console.log(`${idx + 1}. [${task.system_name}] ${task.description}`);
      console.log(`   Frequency: ${task.frequency_value} ${task.frequency_type}`);
      console.log(`   Type: ${task.task_type}`);
      console.log('');
    });
  }

  // ============================================================
  // RECOMMENDATIONS
  // ============================================================
  console.log('='.repeat(80));
  console.log('\n💡 RECOMMENDATIONS\n');

  if (categories.autoMerge.length > 0) {
    console.log(`⚠️  You have ${categories.autoMerge.length} auto-merge candidates.`);
    console.log('   Review the list above carefully before proceeding.');
    console.log('   If thresholds seem too aggressive, we can adjust them.\n');
  }

  if (categories.needsReview.length > 0) {
    console.log(`📋 You have ${categories.needsReview.length} tasks that need manual review.`);
    console.log('   These will be flagged in the UI for you to approve or reject.\n');
  }

  console.log('Next Steps:');
  console.log('  1. Review the auto-merge candidates above');
  console.log('  2. Adjust thresholds if needed (currently 92% auto, 85% review)');
  console.log('  3. Run the actual import: node scripts/import-extracted-tasks.js\n');

  console.log('='.repeat(80) + '\n');
}

// Run the analysis
analyzeDuplication().catch(console.error);
