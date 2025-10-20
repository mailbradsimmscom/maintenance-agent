import { createLogger } from '../utils/logger.js';

const logger = createLogger('task-deduplication');

/**
 * Calculate word overlap similarity between two texts
 * Returns a score from 0 (no overlap) to 1 (identical)
 */
export function calculateTextSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;

  // Normalize: lowercase, remove punctuation, split into words
  const normalize = (text) => {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(word => word.length > 2); // Ignore short words like "a", "is"
  };

  const words1 = normalize(text1);
  const words2 = normalize(text2);

  if (words1.length === 0 || words2.length === 0) return 0;

  // Calculate overlap
  const set1 = new Set(words1);
  const set2 = new Set(words2);

  const intersection = new Set([...set1].filter(word => set2.has(word)));
  const union = new Set([...set1, ...set2]);

  // Jaccard similarity: intersection / union
  return intersection.size / union.size;
}

/**
 * Convert frequency to hours for comparison
 */
function frequencyToHours(task) {
  if (!task.frequency_type || !task.frequency_value) {
    return null;
  }

  if (task.frequency_type === 'hours') {
    return task.frequency_value;
  } else if (task.frequency_type === 'days') {
    return task.frequency_value * 24;
  } else if (task.frequency_type === 'months') {
    return task.frequency_value * 30 * 24;
  } else if (task.frequency_type === 'years') {
    return task.frequency_value * 365 * 24;
  }

  return null; // Condition-based, unknown, etc.
}

/**
 * Check if two frequencies are similar (within 10% tolerance)
 */
function haveSimilarFrequency(task1, task2) {
  const hours1 = frequencyToHours(task1);
  const hours2 = frequencyToHours(task2);

  if (hours1 === null || hours2 === null) {
    // If either is condition-based or unknown, check exact match
    return task1.frequency_type === task2.frequency_type &&
           task1.frequency_value === task2.frequency_value;
  }

  // Allow 10% tolerance (e.g., 24 hours vs 1 day = same)
  const tolerance = 0.1;
  const diff = Math.abs(hours1 - hours2);
  const avg = (hours1 + hours2) / 2;

  return diff / avg <= tolerance;
}

/**
 * Check if two tasks are duplicates
 */
export function areDuplicates(task1, task2, options = {}) {
  const {
    textSimilarityThreshold = 0.75,  // 75% word overlap
    requireSameFrequency = true,
    requireSameSystem = true
  } = options;

  // Must be same system (unless explicitly disabled)
  if (requireSameSystem && task1.asset_uid !== task2.asset_uid) {
    return false;
  }

  // Check text similarity
  const textSim = calculateTextSimilarity(task1.description, task2.description);

  // Check frequency similarity
  const freqSim = haveSimilarFrequency(task1, task2);

  // Decision logic:
  // - Very high text similarity (90%+) = duplicate regardless of frequency
  // - High text similarity (75%+) + same frequency = duplicate
  if (textSim >= 0.9) {
    return true;
  }

  if (textSim >= textSimilarityThreshold && (!requireSameFrequency || freqSim)) {
    return true;
  }

  return false;
}

/**
 * Merge two duplicate tasks
 * Keeps the best information from both
 */
export function mergeTasks(existingTask, newTask) {
  // Keep highest confidence
  if (newTask.confidence > existingTask.confidence) {
    existingTask.confidence = newTask.confidence;
  }

  // Keep highest criticality
  const criticalityOrder = ['optional', 'routine', 'important', 'critical'];
  const existingLevel = criticalityOrder.indexOf(existingTask.criticality || 'routine');
  const newLevel = criticalityOrder.indexOf(newTask.criticality || 'routine');
  if (newLevel > existingLevel) {
    existingTask.criticality = newTask.criticality;
  }

  // Average duration estimates if both provided
  if (newTask.estimated_duration_hours && existingTask.estimated_duration_hours) {
    existingTask.estimated_duration_hours =
      (existingTask.estimated_duration_hours + newTask.estimated_duration_hours) / 2;
  } else if (newTask.estimated_duration_hours && !existingTask.estimated_duration_hours) {
    existingTask.estimated_duration_hours = newTask.estimated_duration_hours;
  }

  // Combine parts (unique)
  if (newTask.parts_required && newTask.parts_required.length > 0) {
    existingTask.parts_required = [
      ...new Set([
        ...(existingTask.parts_required || []),
        ...newTask.parts_required
      ])
    ];
  }

  // Track alternative sources
  if (!existingTask.source_details.alternativeSources) {
    existingTask.source_details.alternativeSources = [];
  }

  existingTask.source_details.alternativeSources.push({
    doc_id: newTask.source_details?.doc_id,
    chunk_id: newTask.source_details?.chunk_id,
    relevance_score: newTask.source_details?.relevance_score,
    section_title: newTask.source_details?.section_title
  });

  // Use longer, more detailed description
  if (newTask.description.length > existingTask.description.length) {
    existingTask.description = newTask.description;
  }

  return existingTask;
}

/**
 * Deduplicate an array of tasks
 * Returns array of unique tasks with duplicates merged
 */
export function deduplicateTasks(tasks, options = {}) {
  logger.info('Starting task deduplication', {
    totalTasks: tasks.length,
    options
  });

  const uniqueTasks = [];
  const duplicateCount = { total: 0, bySystem: {} };

  // Group by system first for efficiency
  const bySystem = {};
  for (const task of tasks) {
    const systemId = task.asset_uid || 'unknown';
    if (!bySystem[systemId]) {
      bySystem[systemId] = [];
    }
    bySystem[systemId].push(task);
  }

  // Process each system's tasks
  for (const [systemId, systemTasks] of Object.entries(bySystem)) {
    logger.debug('Processing system', {
      systemId,
      taskCount: systemTasks.length
    });

    let systemDupes = 0;

    for (const task of systemTasks) {
      // Check if this task is a duplicate of any existing unique task
      let foundDuplicate = false;

      for (const uniqueTask of uniqueTasks) {
        if (areDuplicates(task, uniqueTask, options)) {
          // Merge the duplicate into the existing task
          mergeTasks(uniqueTask, task);
          foundDuplicate = true;
          systemDupes++;
          logger.debug('Found duplicate', {
            original: uniqueTask.description.substring(0, 50),
            duplicate: task.description.substring(0, 50),
            similarity: calculateTextSimilarity(task.description, uniqueTask.description)
          });
          break;
        }
      }

      // If not a duplicate, add as new unique task
      if (!foundDuplicate) {
        uniqueTasks.push({ ...task }); // Clone to avoid mutations
      }
    }

    duplicateCount.bySystem[systemId] = systemDupes;
    duplicateCount.total += systemDupes;
  }

  logger.info('Deduplication complete', {
    originalCount: tasks.length,
    uniqueCount: uniqueTasks.length,
    duplicatesRemoved: duplicateCount.total,
    reductionPercent: ((duplicateCount.total / tasks.length) * 100).toFixed(1)
  });

  return {
    uniqueTasks,
    stats: {
      original: tasks.length,
      unique: uniqueTasks.length,
      duplicates: duplicateCount.total,
      reductionPercent: ((duplicateCount.total / tasks.length) * 100).toFixed(1),
      bySystem: duplicateCount.bySystem
    }
  };
}

/**
 * Analyze tasks for potential duplicates without merging
 * Useful for reporting/debugging
 */
export function analyzeDuplicates(tasks, options = {}) {
  const duplicateGroups = [];
  const processed = new Set();

  for (let i = 0; i < tasks.length; i++) {
    if (processed.has(i)) continue;

    const task1 = tasks[i];
    const group = [{ index: i, task: task1 }];

    for (let j = i + 1; j < tasks.length; j++) {
      if (processed.has(j)) continue;

      const task2 = tasks[j];
      if (areDuplicates(task1, task2, options)) {
        group.push({ index: j, task: task2 });
        processed.add(j);
      }
    }

    if (group.length > 1) {
      duplicateGroups.push(group);
      processed.add(i);
    }
  }

  return {
    totalTasks: tasks.length,
    duplicateGroups: duplicateGroups.length,
    duplicateTasks: processed.size,
    groups: duplicateGroups.map(group => ({
      count: group.length,
      tasks: group.map(g => ({
        description: g.task.description,
        frequency: `${g.task.frequency_value} ${g.task.frequency_type}`,
        system: g.task.system_name
      }))
    }))
  };
}
