/**
 * Task Completions Service
 * Business logic for recording task completions and calculating next due dates
 */

import taskCompletionsRepo from '../repositories/task-completions.repository.js';
import { pineconeRepository } from '../repositories/pinecone.repository.js';
import systemMaintenanceRepo from '../repositories/system-maintenance.repository.js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('task-completions-service');

export const taskCompletionsService = {
  /**
   * Complete a maintenance task with next due calculation
   * @param {Object} params - Completion parameters
   * @param {string} params.taskId - Task ID (from Pinecone)
   * @param {string} params.assetUid - System asset UID
   * @param {number} params.hoursAtCompletion - Current operating hours (null for calendar tasks)
   * @param {string} params.completedBy - Who completed (default: 'user')
   * @param {string} params.sourceType - Source type (manual, ai_inferred, sensor_trigger, user_input)
   * @param {string} params.notes - Optional notes
   * @returns {Promise<Object>} Completion record with next due calculation
   */
  async completeTask({ taskId, assetUid, hoursAtCompletion = null, completedBy = 'user', sourceType = 'manual', notes = null }) {
    try {
      logger.info('Recording task completion', { taskId, assetUid, hoursAtCompletion });

      // Record completion in database
      const completion = await taskCompletionsRepo.recordCompletion({
        taskId,
        assetUid,
        hoursAtCompletion,
        completedBy,
        sourceType,
        notes,
      });

      // Fetch task from Pinecone to calculate next due
      const task = await pineconeRepository.getTaskById(taskId);

      if (!task || !task.metadata) {
        logger.warn('Task not found in Pinecone, skipping next due calculation', { taskId });
        return {
          completion,
          nextDue: null,
        };
      }

      const metadata = task.metadata;

      // Calculate next due date based on frequency
      let nextDue = null;

      if (metadata.is_recurring) {
        if (metadata.frequency_basis === 'usage') {
          // Usage-based: next due = current hours + frequency
          nextDue = {
            type: 'usage',
            hours: hoursAtCompletion + (metadata.frequency_value || 0),
          };

          logger.info('Calculated next due (usage-based)', {
            taskId,
            currentHours: hoursAtCompletion,
            frequencyHours: metadata.frequency_value,
            nextDueHours: nextDue.hours,
          });

        } else if (metadata.frequency_basis === 'calendar') {
          // Calendar-based: add time to completion date
          const completedAt = new Date(completion.completed_at);
          const nextDueDate = this._addCalendarTime(
            completedAt,
            metadata.frequency_value,
            metadata.frequency_unit || 'months'
          );

          nextDue = {
            type: 'calendar',
            date: nextDueDate,
          };

          logger.info('Calculated next due (calendar-based)', {
            taskId,
            completedAt: completedAt.toISOString(),
            frequency: `${metadata.frequency_value} ${metadata.frequency_unit}`,
            nextDueDate: nextDueDate.toISOString(),
          });
        }
      }

      // Update task metadata in Pinecone with completion info
      await pineconeRepository.updateMetadata(taskId, {
        last_completed_at: completion.completed_at,
        last_completed_hours: hoursAtCompletion,
        completion_count: (metadata.completion_count || 0) + 1,
        next_due_hours: nextDue?.type === 'usage' ? nextDue.hours : null,
        next_due_date: nextDue?.type === 'calendar' ? nextDue.date.toISOString() : null,
      });

      logger.info('Task completion recorded successfully', {
        taskId,
        assetUid,
        completionId: completion.id,
        nextDue,
      });

      return {
        completion,
        nextDue,
        taskMetadata: metadata,
      };

    } catch (error) {
      logger.error('Failed to complete task', {
        taskId,
        assetUid,
        error: error.message,
      });
      throw error;
    }
  },

  /**
   * Get task completion history with statistics
   * @param {string} taskId - Task ID
   * @param {string} assetUid - System asset UID
   * @returns {Promise<Object>} Completion history and stats
   */
  async getTaskHistory(taskId, assetUid) {
    try {
      const completions = await taskCompletionsRepo.getCompletionsForTask(taskId, assetUid);
      const count = completions.length;

      if (count === 0) {
        return {
          completions: [],
          stats: {
            totalCompletions: 0,
            firstCompletion: null,
            lastCompletion: null,
            averageInterval: null,
          },
        };
      }

      // Calculate statistics
      const sortedCompletions = [...completions].sort((a, b) =>
        new Date(a.completed_at) - new Date(b.completed_at)
      );

      const firstCompletion = sortedCompletions[0];
      const lastCompletion = sortedCompletions[sortedCompletions.length - 1];

      // Calculate average interval between completions
      let averageInterval = null;
      if (count > 1) {
        const intervals = [];
        for (let i = 1; i < sortedCompletions.length; i++) {
          const prev = new Date(sortedCompletions[i - 1].completed_at);
          const curr = new Date(sortedCompletions[i].completed_at);
          intervals.push(curr - prev);
        }

        const avgMs = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
        averageInterval = Math.floor(avgMs / (1000 * 60 * 60 * 24)); // Convert to days
      }

      return {
        completions,
        stats: {
          totalCompletions: count,
          firstCompletion: firstCompletion.completed_at,
          lastCompletion: lastCompletion.completed_at,
          averageIntervalDays: averageInterval,
        },
      };

    } catch (error) {
      logger.error('Failed to get task history', { taskId, assetUid, error: error.message });
      throw error;
    }
  },

  /**
   * Calculate task due status
   * @param {Object} task - Task with metadata from Pinecone
   * @param {number} currentHours - Current system operating hours
   * @returns {Object} Due status information
   */
  calculateDueStatus(task, currentHours = null) {
    const metadata = task.metadata;

    // If not recurring, check if ever completed
    if (!metadata.is_recurring) {
      return {
        isDue: !metadata.last_completed_at,
        status: metadata.last_completed_at ? 'completed' : 'pending',
        message: metadata.last_completed_at ? 'One-time task completed' : 'One-time task pending',
      };
    }

    // Recurring task - check based on frequency basis
    if (metadata.frequency_basis === 'usage') {
      if (currentHours === null) {
        return {
          isDue: false,
          status: 'unknown',
          message: 'Current hours not provided',
        };
      }

      const nextDueHours = metadata.next_due_hours;

      if (!nextDueHours) {
        // Never completed, use initial due
        return {
          isDue: currentHours >= (metadata.initial_due_hours || 0),
          status: currentHours >= (metadata.initial_due_hours || 0) ? 'due' : 'not_due',
          hoursUntilDue: (metadata.initial_due_hours || 0) - currentHours,
        };
      }

      const hoursUntilDue = nextDueHours - currentHours;

      return {
        isDue: currentHours >= nextDueHours,
        status: currentHours >= nextDueHours ? 'overdue' : 'not_due',
        hoursUntilDue,
        nextDueHours,
      };

    } else if (metadata.frequency_basis === 'calendar') {
      const nextDueDate = metadata.next_due_date ? new Date(metadata.next_due_date) : null;

      if (!nextDueDate) {
        return {
          isDue: true,
          status: 'due',
          message: 'No next due date set',
        };
      }

      const now = new Date();
      const daysUntilDue = Math.floor((nextDueDate - now) / (1000 * 60 * 60 * 24));
      const dueSoonThreshold = config.tracking.taskDueSoonWarningDays;

      let status = 'not_due';
      if (now >= nextDueDate) {
        status = 'overdue';
      } else if (daysUntilDue <= dueSoonThreshold) {
        status = 'due_soon';
      }

      return {
        isDue: now >= nextDueDate,
        status,
        daysUntilDue,
        nextDueDate: nextDueDate.toISOString(),
      };
    }

    return {
      isDue: false,
      status: 'unknown',
      message: 'Unknown frequency basis',
    };
  },

  /**
   * Add calendar time to a date
   * @private
   * @param {Date} date - Start date
   * @param {number} value - Amount to add
   * @param {string} unit - Unit (days, weeks, months, years)
   * @returns {Date} New date
   */
  _addCalendarTime(date, value, unit) {
    const result = new Date(date);

    switch (unit) {
      case 'days':
        result.setDate(result.getDate() + value);
        break;
      case 'weeks':
        result.setDate(result.getDate() + (value * 7));
        break;
      case 'months':
        result.setMonth(result.getMonth() + value);
        break;
      case 'years':
        result.setFullYear(result.getFullYear() + value);
        break;
      default:
        throw new Error(`Unknown calendar unit: ${unit}`);
    }

    return result;
  },
};

export default taskCompletionsService;
