import { createLogger } from '../utils/logger.js';
import { openaiRepository } from '../repositories/openai.repository.js';
import { pineconeRepository } from '../repositories/pinecone.repository.js';

const logger = createLogger('task-embedding');

/**
 * Task type classification keywords
 * Used to automatically categorize tasks
 */
const TASK_TYPE_KEYWORDS = {
  fluid_check: ['check', 'inspect', 'verify', 'level', 'oil', 'coolant', 'hydraulic', 'fluid'],
  filter_replacement: ['replace', 'change', 'filter', 'element'],
  visual_inspection: ['inspect', 'visual', 'check', 'exterior', 'look', 'examine'],
  lubrication: ['lubricate', 'grease', 'oil application', 'apply lubricant'],
  cleaning: ['clean', 'wash', 'flush', 'drain', 'remove deposits'],
  adjustment: ['adjust', 'tension', 'clearance', 'alignment', 'tighten', 'torque'],
  parts_replacement: ['replace', 'change', 'renew', 'anode', 'belt', 'hose', 'seal', 'mount', 'diaphragm'],
  fluid_replacement: ['change', 'replace', 'refill', 'oil', 'coolant', 'hydraulic'],
  condition_based: ['lifting', 'storage', 'winterization', 'boat lifting', 'as needed', 'when necessary']
};

/**
 * Classify task type based on description keywords
 */
export function classifyTaskType(description) {
  if (!description) return 'unknown';

  const descLower = description.toLowerCase();
  const scores = {};

  // Score each type based on keyword matches
  for (const [type, keywords] of Object.entries(TASK_TYPE_KEYWORDS)) {
    scores[type] = keywords.filter(kw => descLower.includes(kw)).length;
  }

  // Get type with highest score
  const sorted = Object.entries(scores)
    .filter(([_, score]) => score > 0)
    .sort(([_, a], [__, b]) => b - a);

  if (sorted.length === 0) return 'unknown';

  return sorted[0][0];
}

/**
 * Normalize frequency to hours for comparison
 */
export function normalizeFrequencyToHours(task) {
  if (!task.frequency_type) {
    return null;
  }

  // Handle condition_based FIRST (frequency_value is null for these)
  if (task.frequency_type === 'condition_based') {
    return 999999; // Special value for condition-based
  }

  // For all other types, frequency_value is required
  if (task.frequency_value === null) {
    return null;
  }

  switch (task.frequency_type) {
    case 'hours':
      return task.frequency_value;
    case 'days':
      return task.frequency_value * 24;
    case 'months':
      return task.frequency_value * 30 * 24;
    case 'years':
      return task.frequency_value * 365 * 24;
    default:
      return null;
  }
}

/**
 * Check if two frequencies are similar (within 10% tolerance)
 */
export function areFrequenciesSimilar(freq1Hours, freq2Hours) {
  if (freq1Hours === null || freq2Hours === null) {
    return false;
  }

  // Exact match for condition-based
  if (freq1Hours === 999999 && freq2Hours === 999999) {
    return true;
  }

  // 10% tolerance
  const diff = Math.abs(freq1Hours - freq2Hours);
  const avg = (freq1Hours + freq2Hours) / 2;

  return diff / avg <= 0.1;
}

/**
 * Generate embedding for a task description
 */
export async function generateTaskEmbedding(description) {
  try {
    logger.debug('Generating embedding', {
      description: description.substring(0, 50)
    });

    // Use the same embedding model as document chunks for consistency
    const embedding = await openaiRepository.createEmbedding(description);

    logger.debug('Embedding generated', {
      dimension: embedding.length
    });

    return embedding;
  } catch (error) {
    logger.error('Failed to generate embedding', {
      error: error.message,
      description: description.substring(0, 50)
    });
    throw error;
  }
}

/**
 * Find similar tasks in Pinecone
 * Returns tasks above similarity threshold
 */
export async function findSimilarTasks(embedding, task, options = {}) {
  const {
    topK = 5,
    similarityThreshold = 0.88,
    requireSameSystem = true,
    requireSameType = false  // Changed to false - don't filter by type (AI-assigned, inconsistent)
  } = options;

  try {
    logger.debug('Searching for similar tasks', {
      assetUid: task.asset_uid,
      taskType: task.task_type,
      topK
    });

    // Build filter - ONLY filter by asset_uid (objective)
    // Do NOT filter by task_type (AI-assigned, subjective, inconsistent)
    const filter = {};

    if (requireSameSystem && task.asset_uid) {
      filter.asset_uid = { $eq: task.asset_uid };
    }

    // Task type is used in decision logic, NOT as a query filter
    // if (requireSameType && task.task_type && task.task_type !== 'unknown') {
    //   filter.task_type = { $eq: task.task_type };
    // }

    // Query Pinecone MAINTENANCE_TASKS namespace
    const results = await pineconeRepository.queryTasks(
      embedding,
      filter,
      topK
    );

    // Filter by similarity threshold
    const similarTasks = results.filter(r => r.score >= similarityThreshold);

    logger.info('Similar tasks found', {
      total: results.length,
      aboveThreshold: similarTasks.length,
      threshold: similarityThreshold
    });

    return similarTasks.map(r => ({
      taskId: r.id,
      score: r.score,
      metadata: r.metadata
    }));

  } catch (error) {
    logger.error('Failed to find similar tasks', {
      error: error.message
    });
    throw error;
  }
}

/**
 * Check if a task is a duplicate based on embedding similarity + frequency
 * Uses compound logic: multiple signals (similarity + frequency + type) for better accuracy
 */
export async function checkForDuplicates(task, embedding, options = {}) {
  const {
    autoMergeThreshold = 0.92,
    reviewThreshold = 0.85,
    compoundReviewThreshold = 0.80  // Lower threshold when metadata matches
  } = options;

  try {
    // Find similar tasks (query down to 80% for compound logic)
    const similarTasks = await findSimilarTasks(embedding, task, {
      topK: 5,
      similarityThreshold: compoundReviewThreshold
    });

    if (similarTasks.length === 0) {
      return {
        isDuplicate: false,
        action: 'insert',
        matches: []
      };
    }

    // Get the best match
    const bestMatch = similarTasks[0];

    // Check frequency similarity
    const taskFreqHours = normalizeFrequencyToHours(task);
    const matchFreqHours = bestMatch.metadata.frequency_hours;
    const frequenciesMatch = areFrequenciesSimilar(taskFreqHours, matchFreqHours);

    // ============================================================
    // COMPOUND LOGIC DECISION TREE
    // Uses: Similarity + Frequency (NO task type - AI-assigned, unreliable)
    // ============================================================

    // 1. HIGH CONFIDENCE AUTO-MERGE
    // Similarity ≥92% + frequency match
    if (bestMatch.score >= autoMergeThreshold && frequenciesMatch) {
      return {
        isDuplicate: true,
        action: 'auto_merge',
        primaryTask: bestMatch,
        reason: `High similarity (${(bestMatch.score * 100).toFixed(1)}%) + matching frequency`
      };
    }

    // 2. MODERATE CONFIDENCE REVIEW
    // Option A: High similarity alone (≥85%)
    // Option B: Moderate similarity (≥80%) + frequency match
    const highSimilarity = bestMatch.score >= reviewThreshold;
    const compoundMatch = bestMatch.score >= compoundReviewThreshold && frequenciesMatch;

    if (highSimilarity || compoundMatch) {
      let reason;
      if (compoundMatch && bestMatch.score < reviewThreshold) {
        reason = `Compound match: ${(bestMatch.score * 100).toFixed(1)}% similarity + matching frequency`;
      } else if (frequenciesMatch) {
        reason = `Moderate similarity (${(bestMatch.score * 100).toFixed(1)}%) + matching frequency`;
      } else {
        reason = `Similarity ${(bestMatch.score * 100).toFixed(1)}% but different frequencies`;
      }

      return {
        isDuplicate: true,
        action: 'review_required',
        primaryTask: bestMatch,
        matches: similarTasks,
        reason
      };
    }

    // 3. LOW CONFIDENCE INSERT
    // Similarity <80% or metadata doesn't match
    return {
      isDuplicate: false,
      action: 'insert',
      matches: similarTasks
    };

  } catch (error) {
    logger.error('Error checking for duplicates', {
      error: error.message
    });
    throw error;
  }
}

/**
 * Add a task to Pinecone (inserts embedding + metadata)
 */
export async function addTaskToPinecone(task, embedding) {
  try {
    const taskId = task.id;
    const frequencyHours = normalizeFrequencyToHours(task);

    const metadata = {
      task_id: taskId,
      description: task.description.substring(0, 500), // Limit for metadata
      asset_uid: task.asset_uid,
      system_name: task.system_name,

      frequency_hours: frequencyHours !== null ? frequencyHours : -1, // Use -1 for unknown
      frequency_type: task.frequency_type || 'unknown',
      frequency_value: task.frequency_value !== null ? task.frequency_value : -1,

      criticality: task.criticality || 'routine',
      confidence: task.confidence || 0.5,

      task_type: task.task_type || 'unknown',
      task_category: task.task_category || 'maintenance',

      source: task.source || 'unknown',
      doc_id: task.source_details?.doc_id || 'none',

      status: task.status || 'pending',
      created_at: Date.now(),

      is_merged: false,
      merge_count: 0
    };

    await pineconeRepository.upsertTask(taskId, embedding, metadata);

    logger.info('Task added to Pinecone', {
      taskId,
      systemName: task.system_name,
      taskType: task.task_type
    });

    return taskId;

  } catch (error) {
    logger.error('Failed to add task to Pinecone', {
      error: error.message,
      taskId: task.id
    });
    throw error;
  }
}

/**
 * Merge a duplicate task into an existing primary task
 */
export async function mergeDuplicateTask(primaryTaskId, duplicateTask, similarity) {
  try {
    logger.info('Merging duplicate task', {
      primaryTaskId,
      duplicateTaskId: duplicateTask.id,
      similarity
    });

    // Update Pinecone metadata (increment merge_count, mark as merged)
    await pineconeRepository.updateTaskMetadata(primaryTaskId, {
      is_merged: true,
      merge_count: (duplicateTask.metadata?.merge_count || 0) + 1
    });

    return {
      primaryTaskId,
      duplicateTaskId: duplicateTask.id,
      similarity,
      mergedAt: new Date().toISOString()
    };

  } catch (error) {
    logger.error('Failed to merge tasks', {
      error: error.message,
      primaryTaskId,
      duplicateTaskId: duplicateTask.id
    });
    throw error;
  }
}

/**
 * Process a batch of tasks: generate embeddings, check duplicates, insert/merge
 */
export async function processTasks(tasks, options = {}) {
  const {
    autoMerge = false,
    dryRun = false
  } = options;

  const results = {
    processed: 0,
    inserted: 0,
    autoMerged: 0,
    needsReview: 0,
    errors: 0,
    details: []
  };

  logger.info('Processing tasks batch', {
    totalTasks: tasks.length,
    autoMerge,
    dryRun
  });

  for (const task of tasks) {
    try {
      // Classify task type
      task.task_type = classifyTaskType(task.description);

      // Generate embedding
      const embedding = await generateTaskEmbedding(task.description);

      // Check for duplicates
      const dupCheck = await checkForDuplicates(task, embedding, {
        autoMergeThreshold: 0.92,
        reviewThreshold: 0.85,
        compoundReviewThreshold: 0.80
      });

      // Take action based on result
      let action = 'none';

      if (dupCheck.action === 'insert') {
        if (!dryRun) {
          await addTaskToPinecone(task, embedding);
        }
        results.inserted++;
        action = 'inserted';
      } else if (dupCheck.action === 'auto_merge' && autoMerge) {
        if (!dryRun) {
          await mergeDuplicateTask(dupCheck.primaryTask.taskId, task, dupCheck.primaryTask.score);
        }
        results.autoMerged++;
        action = 'auto_merged';
      } else if (dupCheck.action === 'review_required') {
        results.needsReview++;
        action = 'needs_review';
      }

      results.processed++;
      results.details.push({
        taskId: task.id,
        description: task.description.substring(0, 50),
        action,
        similarity: dupCheck.primaryTask?.score,
        reason: dupCheck.reason
      });

    } catch (error) {
      logger.error('Error processing task', {
        taskId: task.id,
        error: error.message
      });
      results.errors++;
    }
  }

  logger.info('Batch processing complete', results);

  return results;
}

export const taskEmbeddingService = {
  classifyTaskType,
  generateTaskEmbedding,
  findSimilarTasks,
  checkForDuplicates,
  addTaskToPinecone,
  mergeDuplicateTask,
  processTasks,
  normalizeFrequencyToHours,
  areFrequenciesSimilar
};
