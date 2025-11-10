/**
 * Step 5: Low-Confidence Deduplication (Manual Review)
 *
 * Finds potential duplicate tasks using 65% semantic similarity threshold
 * and saves them to deduplication_reviews table for manual review
 */

import { pineconeRepository } from '../../repositories/pinecone.repository.js';
import deduplicationReviewRepository from '../../repositories/deduplication-review.repository.js';
import db from '../../repositories/supabase.repository.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('step5-dedupe-review');

const THRESHOLDS = {
  semantic: {
    min: 0.65,  // 65% - Lower threshold for review mode
    highConfidence: 0.75  // 75% - Override frequency check
  },
  frequency: {
    tight: 0.10,
    medium: 0.15,
    loose: 0.20
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

  // Check semantic similarity threshold (lower for review)
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

  // High-confidence override
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
 * Execute low-confidence deduplication for a system
 * @param {string} assetUid - System asset UID
 * @param {Object} options - Execution options
 * @param {Object} options.rateLimiter - Rate limiter instance
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Results
 */
export async function executeLowConfidenceDedupe(assetUid, options = {}) {
  const { onProgress } = options;

  logger.info('Starting low-confidence deduplication', { assetUid });

  try {
    // Step 1: Check if already run (idempotency)
    onProgress?.({ message: 'Checking for existing reviews...' });

    // Query database directly since there's no getReviewsByAsset method
    const { data: existingReviews, error: existingError } = await db.client
      .from('deduplication_reviews')
      .select('id, review_status')
      .or(`task1_metadata->>asset_uid.eq.${assetUid},task2_metadata->>asset_uid.eq.${assetUid}`);

    if (existingReviews && existingReviews.length > 0) {
      const pendingCount = existingReviews.filter(r => r.review_status === 'pending').length;

      logger.info('Deduplication review already run', {
        assetUid,
        existingReviews: existingReviews.length,
        pending: pendingCount
      });

      return {
        success: true,
        duplicatePairs: 0,
        pairsForReview: pendingCount,
        message: `Deduplication already run. ${pendingCount} reviews pending.`,
        skipReason: 'already_executed',
        reviewUrl: `/dedup-review.html?system=${encodeURIComponent(assetUid)}`
      };
    }

    // Step 2: Fetch all tasks for this system
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
        confidence: record.metadata.confidence ?? null,
        review_status: record.metadata.review_status
      }))
      .filter(t => {
        // Only include tasks for this asset that haven't been marked as duplicates
        if (t.asset_uid !== assetUid) return false;

        const hiddenStatuses = ['auto_duplicate_hidden', 'duplicate_hidden', 'invalid_task'];
        if (hiddenStatuses.includes(t.review_status)) return false;

        return true;
      });

    logger.info('Fetched tasks', {
      assetUid,
      taskCount: systemTasks.length
    });

    if (systemTasks.length < 2) {
      return {
        success: true,
        duplicatePairs: 0,
        pairsForReview: 0,
        message: 'Not enough tasks to deduplicate'
      };
    }

    // Step 3: Pairwise comparison
    onProgress?.({ message: 'Finding potential duplicates...' });

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
            taskA: {
              id: taskA.id,
              description: taskA.description,
              system_name: taskA.system_name,
              asset_uid: taskA.asset_uid,
              frequency_type: taskA.frequency_type,
              frequency_value: taskA.frequency_value,
              frequency_hours: taskA.frequency_hours,
              frequency_basis: taskA.frequency_basis,
              task_type: taskA.task_type,
              criticality: taskA.criticality,
              confidence: taskA.confidence
            },
            taskB: {
              id: taskB.id,
              description: taskB.description,
              system_name: taskB.system_name,
              asset_uid: taskB.asset_uid,
              frequency_type: taskB.frequency_type,
              frequency_value: taskB.frequency_value,
              frequency_hours: taskB.frequency_hours,
              frequency_basis: taskB.frequency_basis,
              task_type: taskB.task_type,
              criticality: taskB.criticality,
              confidence: taskB.confidence
            },
            similarity_score: result.score,
            reason: result.reason,
            warning: result.warning || null
          });

          logger.info('Potential duplicate found', {
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
        pairsForReview: 0,
        message: 'No potential duplicates found'
      };
    }

    // Step 4: Save to database for review
    onProgress?.({ message: `Saving ${duplicatePairs.length} pairs for review...` });

    const analysisId = await deduplicationReviewRepository.createAnalysisRun({
      analysis_date: new Date().toISOString(),
      total_tasks: systemTasks.length,
      duplicate_pairs_found: duplicatePairs.length,
      duplicate_groups_found: 0,  // Not calculating groups for review mode
      thresholds: THRESHOLDS,
      filters: {
        assetUidFilter: assetUid
      }
    });

    const savedCount = await deduplicationReviewRepository.bulkSavePairs(
      analysisId,
      duplicatePairs
    );

    logger.info('Low-confidence deduplication complete', {
      assetUid,
      duplicatePairs: duplicatePairs.length,
      savedCount,
      analysisId
    });

    return {
      success: true,
      duplicatePairs: duplicatePairs.length,
      pairsForReview: savedCount,
      analysisId,
      reviewUrl: `/dedup-review.html?system=${encodeURIComponent(assetUid)}`,
      message: `Found ${duplicatePairs.length} potential duplicates for review`
    };

  } catch (error) {
    logger.error('Low-confidence deduplication failed', {
      assetUid,
      error: error.message,
      stack: error.stack
    });

    throw error;
  }
}
