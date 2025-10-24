/**
 * Task Completions Repository
 * Database operations for task_completions table
 */

import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('task-completions-repository');

// Initialize Supabase client
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey
);

export const taskCompletionsRepository = {
  /**
   * Record a task completion
   * @param {Object} completion - Completion data
   * @param {string} completion.taskId - Task ID (from Pinecone)
   * @param {string} completion.assetUid - System asset UID
   * @param {number} completion.hoursAtCompletion - Operating hours when completed (null for calendar tasks)
   * @param {string} completion.completedBy - Who completed (default: 'user')
   * @param {string} completion.sourceType - Source type (manual, ai_inferred, sensor_trigger, user_input)
   * @param {string} completion.notes - Optional notes
   * @returns {Promise<Object>} Created completion record
   */
  async recordCompletion({
    taskId,
    assetUid,
    hoursAtCompletion = null,
    completedBy = 'user',
    sourceType = 'manual',
    notes = null,
  }) {
    const { data, error } = await supabase
      .from('task_completions')
      .insert({
        task_id: taskId,
        asset_uid: assetUid,
        hours_at_completion: hoursAtCompletion,
        completed_by: completedBy,
        source_type: sourceType,
        notes,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to record task completion', { taskId, assetUid, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get latest completion for a specific task
   * @param {string} taskId - Task ID
   * @param {string} assetUid - System asset UID
   * @returns {Promise<Object|null>} Latest completion or null
   */
  async getLatestForTask(taskId, assetUid) {
    const { data, error } = await supabase
      .from('task_completions')
      .select('*')
      .eq('task_id', taskId)
      .eq('asset_uid', assetUid)
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to fetch latest task completion', { taskId, assetUid, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get all completions for a specific task
   * @param {string} taskId - Task ID
   * @param {string} assetUid - System asset UID
   * @param {number} limit - Number of completions to fetch
   * @returns {Promise<Array>} Task completion history
   */
  async getCompletionsForTask(taskId, assetUid, limit = 50) {
    const { data, error } = await supabase
      .from('task_completions')
      .select('*')
      .eq('task_id', taskId)
      .eq('asset_uid', assetUid)
      .order('completed_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch task completions', { taskId, assetUid, error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Get all completions for a system
   * @param {string} assetUid - System asset UID
   * @param {number} limit - Number of completions to fetch
   * @returns {Promise<Array>} All completions for the system
   */
  async getCompletionsForSystem(assetUid, limit = 100) {
    const { data, error } = await supabase
      .from('task_completions')
      .select('*')
      .eq('asset_uid', assetUid)
      .order('completed_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch system completions', { assetUid, error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Get completions within a date range
   * @param {string} assetUid - System asset UID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Completions in range
   */
  async getCompletionsInRange(assetUid, startDate, endDate) {
    const { data, error } = await supabase
      .from('task_completions')
      .select('*')
      .eq('asset_uid', assetUid)
      .gte('completed_at', startDate.toISOString())
      .lte('completed_at', endDate.toISOString())
      .order('completed_at', { ascending: true });

    if (error) {
      logger.error('Failed to fetch completions in range', { assetUid, startDate, endDate, error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Get completions by source type
   * @param {string} sourceType - Source type filter
   * @param {number} limit - Number of completions to fetch
   * @returns {Promise<Array>} Completions by source type
   */
  async getCompletionsBySource(sourceType, limit = 100) {
    const { data, error } = await supabase
      .from('task_completions')
      .select('*')
      .eq('source_type', sourceType)
      .order('completed_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch completions by source', { sourceType, error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Count completions for a task
   * @param {string} taskId - Task ID
   * @param {string} assetUid - System asset UID
   * @returns {Promise<number>} Number of completions
   */
  async countCompletions(taskId, assetUid) {
    const { count, error } = await supabase
      .from('task_completions')
      .select('*', { count: 'exact', head: true })
      .eq('task_id', taskId)
      .eq('asset_uid', assetUid);

    if (error) {
      logger.error('Failed to count completions', { taskId, assetUid, error: error.message });
      throw error;
    }

    return count || 0;
  },

  /**
   * Get recent completions (all systems)
   * @param {number} limit - Number of completions to fetch
   * @returns {Promise<Array>} Recent completions across all systems
   */
  async getRecentCompletions(limit = 50) {
    const { data, error } = await supabase
      .from('task_completions')
      .select('*')
      .order('completed_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch recent completions', { error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Get completion statistics for a system
   * @param {string} assetUid - System asset UID
   * @returns {Promise<Object>} Statistics (total, by source, etc.)
   */
  async getStatistics(assetUid) {
    // Get all completions for the system
    const { data, error } = await supabase
      .from('task_completions')
      .select('source_type, completed_at')
      .eq('asset_uid', assetUid);

    if (error) {
      logger.error('Failed to fetch completion statistics', { assetUid, error: error.message });
      throw error;
    }

    const completions = data || [];

    // Calculate statistics
    const stats = {
      total: completions.length,
      bySource: {},
      lastCompletion: null,
    };

    // Count by source type
    completions.forEach(completion => {
      stats.bySource[completion.source_type] = (stats.bySource[completion.source_type] || 0) + 1;
    });

    // Find most recent completion
    if (completions.length > 0) {
      const sorted = completions.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
      stats.lastCompletion = sorted[0].completed_at;
    }

    return stats;
  },
};

export default taskCompletionsRepository;
