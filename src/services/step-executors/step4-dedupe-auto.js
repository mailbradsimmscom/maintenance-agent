/**
 * Step 4: High-Confidence Deduplication (Auto-Mark)
 *
 * Finds duplicate tasks using 85% semantic similarity threshold
 * and automatically marks them as hidden in Pinecone (preserves for training data)
 */

import { pineconeRepository } from '../../repositories/pinecone.repository.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('step4-dedupe-auto');

const THRESHOLDS = {
  semantic: {
    min: 0.85,  // 85% - High confidence threshold for auto-delete
    highConfidence: 0.95  // 95% - Override frequency check
  },
  frequency: {
    tight: 0.10,  // ±10% for frequent tasks (<100 hours)
    medium: 0.15,  // ±15% for medium tasks (100-1000 hours)
    loose: 0.20  // ±20% for rare tasks (>1000 hours)
  }
};

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
 * Get tolerance based on frequency range
 */
function getToleranceForFrequency(hours) {
  if (hours === null) return null;
  if (hours < 100) return THRESHOLDS.frequency.tight;
  if (hours < 1000) return THRESHOLDS.frequency.medium;
  return THRESHOLDS.frequency.loose;
}

/**
 * Check if two frequencies are similar
 */
function areFrequenciesSimilar(freq1Hours, freq2Hours, customTolerance = null) {
  if (freq1Hours === null || freq2Hours === null) {
    return null;
  }

  const tolerance = customTolerance || getToleranceForFrequency((freq1Hours + freq2Hours) / 2);
  const diff = Math.abs(freq1Hours - freq2Hours);
  const avg = (freq1Hours + freq2Hours) / 2;

  return diff / avg <= tolerance;
}

/**
 * Check if two tasks are duplicates
 */
function checkIfDuplicate(taskA, taskB, similarity) {
  // Quick filters
  if (taskA.asset_uid !== taskB.asset_uid) {
    return { isDuplicate: false, reason: 'different_asset' };
  }

  if (taskA.frequency_basis !== 'unknown' && taskB.frequency_basis !== 'unknown') {
    if (taskA.frequency_basis !== taskB.frequency_basis) {
      return { isDuplicate: false, reason: 'different_frequency_basis' };
    }
  }

  if (taskA.task_type !== taskB.task_type) {
    return { isDuplicate: false, reason: 'different_task_type' };
  }

  // Check semantic similarity threshold
  if (similarity < THRESHOLDS.semantic.min) {
    return { isDuplicate: false, reason: 'low_similarity' };
  }

  // Event & Condition basis don't need frequency comparison
  if (['event', 'condition'].includes(taskA.frequency_basis)) {
    return {
      isDuplicate: true,
      reason: 'semantic_match_event_or_condition_based',
      score: similarity
    };
  }

  // Handle null frequencies
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

  // Unknown basis requires strict frequency match
  const tolerance = taskA.frequency_basis === 'unknown' ? 0.05 : null;
  const frequenciesMatch = areFrequenciesSimilar(taskA.frequency_hours, taskB.frequency_hours, tolerance);

  // Compound decision
  if (similarity >= THRESHOLDS.semantic.min && frequenciesMatch) {
    return {
      isDuplicate: true,
      reason: 'semantic_and_frequency_match',
      score: similarity
    };
  }

  // High-confidence override (95%+ = duplicate regardless)
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
 */
function buildDuplicateGroups(duplicatePairs) {
  const groups = new Map();
  const taskToGroup = new Map();

  duplicatePairs.forEach(pair => {
    const { taskA, taskB } = pair;

    if (!taskToGroup.has(taskA.id) && !taskToGroup.has(taskB.id)) {
      const groupId = taskA.id;
      groups.set(groupId, {
        primary: taskA,
        duplicates: [taskB]
      });
      taskToGroup.set(taskA.id, groupId);
      taskToGroup.set(taskB.id, groupId);
    } else if (taskToGroup.has(taskA.id)) {
      const groupId = taskToGroup.get(taskA.id);
      const group = groups.get(groupId);
      if (!group.duplicates.find(d => d.id === taskB.id) && group.primary.id !== taskB.id) {
        group.duplicates.push(taskB);
        taskToGroup.set(taskB.id, groupId);
      }
    } else if (taskToGroup.has(taskB.id)) {
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
 * Execute high-confidence deduplication for a system
 * @param {string} assetUid - System asset UID
 * @param {Object} options - Execution options
 * @param {Object} options.rateLimiter - Rate limiter instance
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Results
 */
export async function executeHighConfidenceDedupe(assetUid, options = {}) {
  const { onProgress } = options;

  logger.info('Starting high-confidence deduplication', { assetUid });

  try {
    // Step 1: Fetch all tasks for this system
    onProgress?.({ message: 'Fetching tasks from Pinecone...' });

    const allTasks = await pineconeRepository.listAllTasks();
    const systemTasks = allTasks
      .map(record => ({
        id: record.id,
        embedding: record.values,
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
      }))
      .filter(t => t.asset_uid === assetUid);

    logger.info('Fetched tasks', {
      assetUid,
      taskCount: systemTasks.length
    });

    if (systemTasks.length < 2) {
      return {
        success: true,
        duplicatePairs: 0,
        duplicatesDeleted: 0,
        message: 'Not enough tasks to deduplicate'
      };
    }

    // Step 2: Pairwise comparison
    onProgress?.({ message: 'Finding duplicates...' });

    const duplicatePairs = [];
    const totalComparisons = (systemTasks.length * (systemTasks.length - 1)) / 2;
    let comparisonsProcessed = 0;

    for (let i = 0; i < systemTasks.length; i++) {
      const taskA = systemTasks[i];

      for (let j = i + 1; j < systemTasks.length; j++) {
        const taskB = systemTasks[j];
        comparisonsProcessed++;

        // Quick filters
        if (taskA.asset_uid !== taskB.asset_uid) continue;
        if (taskA.frequency_basis !== 'unknown' && taskB.frequency_basis !== 'unknown') {
          if (taskA.frequency_basis !== taskB.frequency_basis) continue;
        }
        if (taskA.task_type !== taskB.task_type) continue;

        // Calculate similarity
        const similarity = cosineSimilarity(taskA.embedding, taskB.embedding);
        const result = checkIfDuplicate(taskA, taskB, similarity);

        if (result.isDuplicate) {
          duplicatePairs.push({
            taskA,
            taskB,
            similarity_score: result.score,
            reason: result.reason
          });

          logger.info('Duplicate found', {
            taskA: taskA.description?.substring(0, 50),
            taskB: taskB.description?.substring(0, 50),
            similarity: (similarity * 100).toFixed(1) + '%'
          });
        }

        if (comparisonsProcessed % 100 === 0) {
          onProgress?.({
            message: `Comparing tasks... ${comparisonsProcessed}/${totalComparisons}`,
            current: comparisonsProcessed,
            total: totalComparisons
          });
        }
      }
    }

    logger.info('Duplicate search complete', {
      assetUid,
      duplicatePairs: duplicatePairs.length
    });

    if (duplicatePairs.length === 0) {
      return {
        success: true,
        duplicatePairs: 0,
        duplicatesDeleted: 0,
        message: 'No high-confidence duplicates found'
      };
    }

    // Step 3: Build duplicate groups
    const duplicateGroups = buildDuplicateGroups(duplicatePairs);

    // Step 4: Mark duplicates as hidden (preserve for training data)
    onProgress?.({ message: `Marking ${duplicatePairs.length} duplicate tasks as hidden...` });

    const duplicateIds = [];
    duplicateGroups.forEach(group => {
      group.duplicates.forEach(dup => {
        duplicateIds.push(dup.id);
      });
    });

    let markedCount = 0;
    for (const id of duplicateIds) {
      try {
        await pineconeRepository.updateTaskMetadata(id, {
          review_status: 'auto_duplicate_hidden',
          is_duplicate: true,
          deduplicated_at: new Date().toISOString(),
          deduplication_method: 'auto_high_confidence'
        });
        markedCount++;

        if (markedCount % 10 === 0) {
          onProgress?.({
            message: `Marked ${markedCount}/${duplicateIds.length} duplicates as hidden...`,
            current: markedCount,
            total: duplicateIds.length
          });
        }
      } catch (error) {
        logger.error('Failed to mark duplicate as hidden', {
          taskId: id,
          error: error.message
        });
      }
    }

    logger.info('High-confidence deduplication complete', {
      assetUid,
      duplicatePairs: duplicatePairs.length,
      duplicatesMarked: markedCount
    });

    return {
      success: true,
      duplicatePairs: duplicatePairs.length,
      duplicatesDeleted: markedCount, // Keep property name for backward compatibility
      message: `Marked ${markedCount} high-confidence duplicates as hidden (preserved for training)`
    };

  } catch (error) {
    logger.error('High-confidence deduplication failed', {
      assetUid,
      error: error.message,
      stack: error.stack
    });

    throw error;
  }
}
