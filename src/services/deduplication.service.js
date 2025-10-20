/**
 * Deduplication Service
 * Handles task deduplication and fingerprinting
 */

import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('deduplication-service');

export const deduplicationService = {
  /**
   * Create a hash for task deduplication
   * @param {string} assetUid - System asset UID
   * @param {Object} task - Task details
   * @returns {string} Hash string
   */
  createTaskHash(assetUid, task) {
    // Normalize the task description for consistent hashing
    const normalizedDesc = task.description
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Include key properties in the hash
    const hashInput = [
      assetUid,
      normalizedDesc,
      task.frequency_type,
      task.frequency_value,
    ].join('|');

    // Create SHA256 hash
    return crypto.createHash('sha256').update(hashInput).digest('hex');
  },

  /**
   * Deduplicate a list of tasks
   * @param {Array} tasks - Tasks to deduplicate
   * @param {string} assetUid - System asset UID
   * @returns {Array} Deduplicated tasks
   */
  deduplicateTasks(tasks, assetUid) {
    const seen = new Map();
    const duplicates = [];

    for (const task of tasks) {
      const hash = this.createTaskHash(assetUid, task);

      if (seen.has(hash)) {
        // Merge duplicate task information
        const existing = seen.get(hash);
        duplicates.push({
          original: existing,
          duplicate: task,
        });

        // Update confidence if higher
        if (task.confidence > existing.confidence) {
          existing.confidence = task.confidence;
        }

        // Merge source information
        if (!Array.isArray(existing.source)) {
          existing.source = [existing.source];
        }
        if (!existing.source.includes(task.source)) {
          existing.source.push(task.source);
        }

        // Merge source details
        if (!Array.isArray(existing.source_details)) {
          existing.source_details = [existing.source_details];
        }
        existing.source_details.push(task.source_details);

        // Merge parts if different
        if (task.parts_required) {
          existing.parts_required = [
            ...new Set([...(existing.parts_required || []), ...task.parts_required]),
          ];
        }
      } else {
        seen.set(hash, { ...task, extraction_hash: hash });
      }
    }

    if (duplicates.length > 0) {
      logger.info('Tasks deduplicated', {
        assetUid,
        originalCount: tasks.length,
        uniqueCount: seen.size,
        duplicatesFound: duplicates.length,
      });
    }

    return Array.from(seen.values());
  },

  /**
   * Calculate similarity between two task descriptions
   * @param {string} desc1 - First description
   * @param {string} desc2 - Second description
   * @returns {number} Similarity score (0-1)
   */
  calculateSimilarity(desc1, desc2) {
    // Simple token-based similarity
    const tokens1 = new Set(desc1.toLowerCase().split(/\s+/));
    const tokens2 = new Set(desc2.toLowerCase().split(/\s+/));

    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);

    return intersection.size / union.size;
  },

  /**
   * Find similar tasks (fuzzy matching)
   * @param {Array} tasks - Tasks to check
   * @param {number} threshold - Similarity threshold (0-1)
   * @returns {Array} Groups of similar tasks
   */
  findSimilarTasks(tasks, threshold = 0.7) {
    const groups = [];
    const assigned = new Set();

    for (let i = 0; i < tasks.length; i++) {
      if (assigned.has(i)) continue;

      const group = [tasks[i]];
      assigned.add(i);

      for (let j = i + 1; j < tasks.length; j++) {
        if (assigned.has(j)) continue;

        const similarity = this.calculateSimilarity(
          tasks[i].description,
          tasks[j].description
        );

        if (similarity >= threshold) {
          group.push(tasks[j]);
          assigned.add(j);
        }
      }

      if (group.length > 1) {
        groups.push(group);
      }
    }

    if (groups.length > 0) {
      logger.info('Similar tasks found', {
        groupCount: groups.length,
        totalSimilar: groups.reduce((sum, g) => sum + g.length, 0),
      });
    }

    return groups;
  },

  /**
   * Merge similar tasks into a single representative task
   * @param {Array} taskGroup - Group of similar tasks
   * @returns {Object} Merged task
   */
  mergeSimilarTasks(taskGroup) {
    if (taskGroup.length === 0) return null;
    if (taskGroup.length === 1) return taskGroup[0];

    // Sort by confidence to use the highest confidence task as base
    taskGroup.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    const merged = { ...taskGroup[0] };

    // Collect all sources
    const sources = new Set();
    const sourceDetails = [];

    for (const task of taskGroup) {
      sources.add(task.source);
      sourceDetails.push(task.source_details);
    }

    merged.source = Array.from(sources);
    merged.source_details = sourceDetails;

    // Use highest confidence
    merged.confidence = Math.max(...taskGroup.map(t => t.confidence || 0));

    // Merge parts lists
    const allParts = taskGroup.flatMap(t => t.parts_required || []);
    merged.parts_required = [...new Set(allParts)];

    // Note the merge in metadata
    merged.merged_from_count = taskGroup.length;

    return merged;
  },
};

export default deduplicationService;