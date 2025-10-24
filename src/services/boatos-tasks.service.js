/**
 * BoatOS Tasks Service
 * Business logic for system-generated user prompts (autonomous tasks)
 */

import boatosTasksRepo from '../repositories/boatos-tasks.repository.js';
import systemMaintenanceRepo from '../repositories/system-maintenance.repository.js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('boatos-tasks-service');

export const boatosTasksService = {
  /**
   * Create hours update prompt task for a system
   * @param {string} assetUid - System asset UID
   * @returns {Promise<Object>} Created task
   */
  async createHoursUpdateTask(assetUid) {
    try {
      logger.info('Creating hours update task', { assetUid });

      const frequencyDays = config.tracking.hoursUpdatePromptIntervalDays;
      const nextDue = new Date();
      nextDue.setDate(nextDue.getDate() + frequencyDays);

      const task = await boatosTasksRepo.upsertTask({
        assetUid,
        taskType: 'update_usage_hours',
        frequencyDays,
        nextDue,
      });

      logger.info('Hours update task created', {
        assetUid,
        taskId: task.id,
        nextDue: task.next_due,
      });

      return task;

    } catch (error) {
      logger.error('Failed to create hours update task', { assetUid, error: error.message });
      throw error;
    }
  },

  /**
   * Get all tasks due for display in to-do list
   * @param {string} userId - Optional user ID filter (future use)
   * @returns {Promise<Array>} Due tasks with enriched data
   */
  async getDueTasks(userId = null) {
    try {
      const now = new Date();
      const dueTasks = await boatosTasksRepo.getDueTasks(now);

      // Filter out recently dismissed tasks (dismissed within last 24 hours)
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      const filteredTasks = dueTasks.filter(task => {
        if (!task.last_dismissed) return true; // Never dismissed

        const dismissedAt = new Date(task.last_dismissed);
        return dismissedAt < yesterday; // Dismissed more than 24 hours ago
      });

      // Enrich with system information
      const enrichedTasks = await Promise.all(
        filteredTasks.map(async (task) => {
          try {
            const maintenanceState = await systemMaintenanceRepo.maintenance.getMaintenanceState(task.asset_uid);

            return {
              ...task,
              systemInfo: maintenanceState ? {
                currentHours: maintenanceState.current_operating_hours,
                lastUpdate: maintenanceState.last_hours_update,
                daysSinceUpdate: Math.floor(
                  (now - new Date(maintenanceState.last_hours_update)) / (1000 * 60 * 60 * 24)
                ),
              } : null,
              overdueDays: Math.floor((now - new Date(task.next_due)) / (1000 * 60 * 60 * 24)),
            };
          } catch (error) {
            logger.warn('Failed to enrich task with system info', {
              taskId: task.id,
              assetUid: task.asset_uid,
              error: error.message,
            });
            return task;
          }
        })
      );

      logger.info('Fetched due tasks', { count: enrichedTasks.length });

      return enrichedTasks;

    } catch (error) {
      logger.error('Failed to get due tasks', { error: error.message });
      throw error;
    }
  },

  /**
   * Mark task as completed (user updated hours)
   * @param {string} taskId - BoatOS task ID
   * @returns {Promise<Object>} Updated task with next due date
   */
  async markTaskCompleted(taskId) {
    try {
      logger.info('Marking BoatOS task as completed', { taskId });

      const completedAt = new Date();
      const frequencyDays = config.tracking.hoursUpdatePromptIntervalDays;

      const updatedTask = await boatosTasksRepo.markCompleted(taskId, completedAt, frequencyDays);

      logger.info('BoatOS task completed', {
        taskId,
        nextDue: updatedTask.next_due,
        frequencyDays,
      });

      return updatedTask;

    } catch (error) {
      logger.error('Failed to mark task completed', { taskId, error: error.message });
      throw error;
    }
  },

  /**
   * Dismiss a task (user postpones)
   * @param {string} taskId - BoatOS task ID
   * @returns {Promise<Object>} Updated task
   */
  async dismissTask(taskId) {
    try {
      logger.info('Dismissing BoatOS task', { taskId });

      const updatedTask = await boatosTasksRepo.markDismissed(taskId);

      logger.info('BoatOS task dismissed', {
        taskId,
        dismissedAt: updatedTask.last_dismissed,
      });

      return updatedTask;

    } catch (error) {
      logger.error('Failed to dismiss task', { taskId, error: error.message });
      throw error;
    }
  },

  /**
   * Check if system needs hours update task created
   * @param {string} assetUid - System asset UID
   * @returns {Promise<boolean>} True if task needs to be created
   */
  async needsHoursUpdateTask(assetUid) {
    try {
      // Check if system has usage-based maintenance tasks (via Pinecone or DB)
      // For now, assume if system has maintenance state, it needs prompts

      const maintenanceState = await systemMaintenanceRepo.maintenance.getMaintenanceState(assetUid);

      if (!maintenanceState) {
        return false; // No usage tracking yet
      }

      // Check if active task already exists
      const existingTask = await boatosTasksRepo.getActiveTask(assetUid, 'update_usage_hours');

      return !existingTask; // Needs task if doesn't exist

    } catch (error) {
      logger.error('Failed to check if system needs hours update task', { assetUid, error: error.message });
      throw error;
    }
  },

  /**
   * Auto-create hours update tasks for systems that need them
   * @returns {Promise<Object>} Creation stats
   */
  async autoCreateHoursUpdateTasks() {
    try {
      logger.info('Auto-creating hours update tasks');

      // Get all systems with maintenance tracking
      const systems = await systemMaintenanceRepo.maintenance.getAllMaintenanceStates(1000);

      let created = 0;
      let skipped = 0;

      for (const system of systems) {
        try {
          const needsTask = await this.needsHoursUpdateTask(system.asset_uid);

          if (needsTask) {
            await this.createHoursUpdateTask(system.asset_uid);
            created++;
          } else {
            skipped++;
          }
        } catch (error) {
          logger.warn('Failed to process system for task creation', {
            assetUid: system.asset_uid,
            error: error.message,
          });
        }
      }

      logger.info('Auto-creation complete', {
        systemsProcessed: systems.length,
        tasksCreated: created,
        skipped,
      });

      return {
        systemsProcessed: systems.length,
        tasksCreated: created,
        skipped,
      };

    } catch (error) {
      logger.error('Failed to auto-create hours update tasks', { error: error.message });
      throw error;
    }
  },

  /**
   * Get summary statistics for BoatOS tasks
   * @returns {Promise<Object>} Task statistics
   */
  async getTaskStatistics() {
    try {
      const now = new Date();
      const dueTasks = await boatosTasksRepo.getDueTasks(now);
      const recentlyDismissed = await boatosTasksRepo.getRecentlyDismissed(1);

      // Calculate overdue stats
      const overdueByDays = dueTasks.reduce((acc, task) => {
        const overdueDays = Math.floor((now - new Date(task.next_due)) / (1000 * 60 * 60 * 24));
        if (overdueDays > 7) acc.over7Days++;
        else if (overdueDays > 3) acc.over3Days++;
        else acc.within3Days++;
        return acc;
      }, { within3Days: 0, over3Days: 0, over7Days: 0 });

      return {
        totalDue: dueTasks.length,
        recentlyDismissed: recentlyDismissed.length,
        overdueBreakdown: overdueByDays,
      };

    } catch (error) {
      logger.error('Failed to get task statistics', { error: error.message });
      throw error;
    }
  },
};

export default boatosTasksService;
