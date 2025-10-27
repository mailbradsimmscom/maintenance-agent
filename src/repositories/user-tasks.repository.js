/**
 * User Tasks Repository
 * Data access layer for user-created tasks
 */

import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('user-tasks-repository');

// Initialize Supabase client
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey
);

const userTasksRepository = {
  /**
   * Create a new user task
   * @param {Object} task - Task data
   * @returns {Promise<Object>} Created task
   */
  async create(task) {
    const { data, error } = await supabase
      .from('user_tasks')
      .insert(task)
      .select()
      .single();

    if (error) {
      logger.error('Failed to create user task', { error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get all active user tasks
   * @param {string} assetUid - Optional filter by system
   * @returns {Promise<Array>} Active tasks
   */
  async getActiveTasks(assetUid = null) {
    let query = supabase
      .from('user_tasks')
      .select('*')
      .eq('status', 'active')
      .order('due_date', { ascending: true });

    if (assetUid) {
      query = query.eq('asset_uid', assetUid);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to fetch active tasks', { error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Get upcoming tasks (due within X days)
   * @param {number} days - Days ahead to look
   * @returns {Promise<Array>} Upcoming tasks
   */
  async getUpcomingTasks(days = 7) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const { data, error } = await supabase
      .from('user_tasks')
      .select('*')
      .eq('status', 'active')
      .lte('due_date', futureDate.toISOString())
      .gte('due_date', new Date().toISOString())
      .order('due_date', { ascending: true });

    if (error) {
      logger.error('Failed to fetch upcoming tasks', { error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Get overdue tasks
   * @returns {Promise<Array>} Overdue tasks
   */
  async getOverdueTasks() {
    const { data, error } = await supabase
      .from('user_tasks')
      .select('*')
      .eq('status', 'active')
      .lt('due_date', new Date().toISOString())
      .order('due_date', { ascending: true });

    if (error) {
      logger.error('Failed to fetch overdue tasks', { error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Get a single task by ID
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Task data
   */
  async getById(taskId) {
    const { data, error } = await supabase
      .from('user_tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (error) {
      logger.error('Failed to fetch task', { taskId, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Update a user task
   * @param {string} taskId - Task ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated task
   */
  async update(taskId, updates) {
    const { data, error } = await supabase
      .from('user_tasks')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update task', { taskId, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Reschedule a task (update due date)
   * @param {string} taskId - Task ID
   * @param {Date} newDueDate - New due date
   * @returns {Promise<Object>} Updated task
   */
  async reschedule(taskId, newDueDate) {
    return this.update(taskId, { due_date: newDueDate });
  },

  /**
   * Mark task as completed
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Updated task with next due date if recurring
   */
  async markComplete(taskId) {
    // Get the task to check if it's recurring
    const task = await this.getById(taskId);

    const updates = {
      last_completed_at: new Date().toISOString(),
      completion_count: (task.completion_count || 0) + 1
    };

    if (task.is_recurring && task.frequency_value && task.frequency_unit) {
      // Calculate next due date
      const currentDue = new Date(task.due_date);
      const nextDue = new Date(currentDue);

      if (task.frequency_unit === 'days') {
        nextDue.setDate(nextDue.getDate() + task.frequency_value);
      } else if (task.frequency_unit === 'hours') {
        // For usage-based, this would need to integrate with hours tracking
        // For now, estimate based on average daily usage
        const estimatedDaysForHours = Math.ceil(task.frequency_value / 8); // Assume 8 hours/day
        nextDue.setDate(nextDue.getDate() + estimatedDaysForHours);
      }

      updates.due_date = nextDue.toISOString();
    } else {
      // One-time task - mark as completed
      updates.status = 'completed';
      updates.completed_at = new Date().toISOString();
    }

    return this.update(taskId, updates);
  },

  /**
   * Pause a recurring task
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Updated task
   */
  async pause(taskId) {
    return this.update(taskId, { status: 'paused' });
  },

  /**
   * Resume a paused task
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Updated task
   */
  async resume(taskId) {
    return this.update(taskId, { status: 'active' });
  },

  /**
   * Soft delete a task
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Updated task
   */
  async delete(taskId) {
    return this.update(taskId, { status: 'deleted' });
  },

  /**
   * Hard delete a task (permanent)
   * @param {string} taskId - Task ID
   * @returns {Promise<boolean>} Success status
   */
  async hardDelete(taskId) {
    const { error } = await supabase
      .from('user_tasks')
      .delete()
      .eq('id', taskId);

    if (error) {
      logger.error('Failed to delete task', { taskId, error: error.message });
      throw error;
    }

    return true;
  }
};

export default userTasksRepository;