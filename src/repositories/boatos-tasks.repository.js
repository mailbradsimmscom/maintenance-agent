/**
 * BoatOS Tasks Repository
 * Database operations for boatos_tasks table (system-generated user prompts)
 */

import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('boatos-tasks-repository');

// Initialize Supabase client
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey
);

export const boatosTasksRepository = {
  /**
   * Create a new BoatOS task
   * @param {Object} task - Task data
   * @param {string} task.taskType - Task type (currently only 'update_usage_hours')
   * @param {string} task.assetUid - System asset UID
   * @param {number} task.frequencyDays - Frequency in days (default: 7)
   * @param {Date} task.nextDue - Next due date
   * @returns {Promise<Object>} Created task
   */
  async createTask({ taskType = 'update_usage_hours', assetUid, frequencyDays = 7, nextDue }) {
    const { data, error } = await supabase
      .from('boatos_tasks')
      .insert({
        task_type: taskType,
        asset_uid: assetUid,
        frequency_days: frequencyDays,
        next_due: nextDue.toISOString(),
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create BoatOS task', { taskType, assetUid, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get active task for a system and task type
   * @param {string} assetUid - System asset UID
   * @param {string} taskType - Task type (default: 'update_usage_hours')
   * @returns {Promise<Object|null>} Active task or null
   */
  async getActiveTask(assetUid, taskType = 'update_usage_hours') {
    const { data, error } = await supabase
      .from('boatos_tasks')
      .select('*')
      .eq('asset_uid', assetUid)
      .eq('task_type', taskType)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to fetch active BoatOS task', { assetUid, taskType, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get all active tasks for a system
   * @param {string} assetUid - System asset UID
   * @returns {Promise<Array>} Active tasks for the system
   */
  async getActiveTasksForSystem(assetUid) {
    const { data, error } = await supabase
      .from('boatos_tasks')
      .select('*')
      .eq('asset_uid', assetUid)
      .eq('is_active', true)
      .order('next_due', { ascending: true });

    if (error) {
      logger.error('Failed to fetch active tasks for system', { assetUid, error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Get all due tasks (across all systems)
   * @param {Date} asOfDate - Check due status as of this date (default: now)
   * @returns {Promise<Array>} Due tasks
   */
  async getDueTasks(asOfDate = new Date()) {
    const { data, error } = await supabase
      .from('boatos_tasks')
      .select('*')
      .eq('is_active', true)
      .lte('next_due', asOfDate.toISOString())
      .order('next_due', { ascending: true });

    if (error) {
      logger.error('Failed to fetch due tasks', { asOfDate, error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Mark task as completed
   * @param {string} taskId - Task ID
   * @param {Date} completedAt - Completion time (default: now)
   * @param {number} frequencyDays - Frequency for calculating next due (default: use existing)
   * @returns {Promise<Object>} Updated task
   */
  async markCompleted(taskId, completedAt = new Date(), frequencyDays = null) {
    // Calculate next due date
    const nextDue = new Date(completedAt);
    const freq = frequencyDays || config.tracking.hoursUpdatePromptIntervalDays;
    nextDue.setDate(nextDue.getDate() + freq);

    const { data, error } = await supabase
      .from('boatos_tasks')
      .update({
        last_completed: completedAt.toISOString(),
        next_due: nextDue.toISOString(),
        last_dismissed: null, // Clear dismissed flag
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to mark task completed', { taskId, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Mark task as dismissed (will reappear tomorrow if still due)
   * @param {string} taskId - Task ID
   * @param {Date} dismissedAt - Dismissal time (default: now)
   * @returns {Promise<Object>} Updated task
   */
  async markDismissed(taskId, dismissedAt = new Date()) {
    const { data, error } = await supabase
      .from('boatos_tasks')
      .update({
        last_dismissed: dismissedAt.toISOString(),
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to mark task dismissed', { taskId, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Update next due date
   * @param {string} taskId - Task ID
   * @param {Date} nextDue - New next due date
   * @returns {Promise<Object>} Updated task
   */
  async updateNextDue(taskId, nextDue) {
    const { data, error } = await supabase
      .from('boatos_tasks')
      .update({
        next_due: nextDue.toISOString(),
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update next due', { taskId, nextDue, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Deactivate a task
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Updated task
   */
  async deactivateTask(taskId) {
    const { data, error } = await supabase
      .from('boatos_tasks')
      .update({
        is_active: false,
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to deactivate task', { taskId, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Reactivate a task
   * @param {string} taskId - Task ID
   * @param {Date} nextDue - Next due date for reactivated task
   * @returns {Promise<Object>} Updated task
   */
  async reactivateTask(taskId, nextDue) {
    const { data, error } = await supabase
      .from('boatos_tasks')
      .update({
        is_active: true,
        next_due: nextDue.toISOString(),
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to reactivate task', { taskId, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Create or update a BoatOS task (upsert pattern)
   * @param {Object} task - Task data
   * @param {string} task.assetUid - System asset UID
   * @param {string} task.taskType - Task type
   * @param {number} task.frequencyDays - Frequency in days
   * @param {Date} task.nextDue - Next due date
   * @returns {Promise<Object>} Created or updated task
   */
  async upsertTask({ assetUid, taskType = 'update_usage_hours', frequencyDays = 7, nextDue }) {
    // Check if active task exists
    const existing = await this.getActiveTask(assetUid, taskType);

    if (existing) {
      // Update existing task
      return this.updateNextDue(existing.id, nextDue);
    } else {
      // Create new task
      return this.createTask({ assetUid, taskType, frequencyDays, nextDue });
    }
  },

  /**
   * Get tasks dismissed recently (within last N days)
   * @param {number} daysAgo - Number of days to look back (default: 1)
   * @returns {Promise<Array>} Recently dismissed tasks
   */
  async getRecentlyDismissed(daysAgo = 1) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysAgo);

    const { data, error } = await supabase
      .from('boatos_tasks')
      .select('*')
      .eq('is_active', true)
      .not('last_dismissed', 'is', null)
      .gte('last_dismissed', cutoffDate.toISOString())
      .order('last_dismissed', { ascending: false });

    if (error) {
      logger.error('Failed to fetch recently dismissed tasks', { daysAgo, error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Delete a task (use with caution - prefer deactivation)
   * @param {string} taskId - Task ID
   * @returns {Promise<void>}
   */
  async deleteTask(taskId) {
    const { error } = await supabase
      .from('boatos_tasks')
      .delete()
      .eq('id', taskId);

    if (error) {
      logger.error('Failed to delete task', { taskId, error: error.message });
      throw error;
    }
  },
};

export default boatosTasksRepository;
