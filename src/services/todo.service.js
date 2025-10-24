/**
 * To-Do Service
 * Aggregates to-do items from multiple sources (BoatOS tasks, maintenance tasks, approvals)
 */

import boatosTasksService from './boatos-tasks.service.js';
import taskCompletionsService from './task-completions.service.js';
import taskApprovalService from './task-approval.service.js';
import systemMaintenanceRepo from '../repositories/system-maintenance.repository.js';
import { pineconeRepository } from '../repositories/pinecone.repository.js';
import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('todo-service');

// Initialize Supabase client for system lookups
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey
);

export const todoService = {
  /**
   * Get system name (subsystem_norm) for display
   * @private
   * @param {string} assetUid - System asset UID
   * @returns {Promise<string>} System name (e.g., "Watermaker")
   */
  async _getSystemName(assetUid) {
    try {
      const { data, error } = await supabase
        .from('systems')
        .select('subsystem_norm, description')
        .eq('asset_uid', assetUid)
        .single();

      if (error || !data) {
        logger.warn('Failed to get system name', { assetUid, error: error?.message });
        return null;
      }

      // Return description (e.g., "Silken Grill") or fall back to subsystem_norm (e.g., "Watermaker")
      return data.description || data.subsystem_norm || 'System';
    } catch (error) {
      logger.warn('Error getting system name', { assetUid, error: error.message });
      return null;
    }
  },

  /**
   * Get all to-do items for a user/system
   * @param {Object} options - Query options
   * @param {string} options.assetUid - Filter by specific system (optional)
   * @param {string} options.userId - Filter by user (future use)
   * @returns {Promise<Array>} Aggregated to-do items
   */
  async getAllTodos({ assetUid = null, userId = null } = {}) {
    try {
      logger.info('Fetching all todos', { assetUid, userId });

      // Fetch all to-do sources in parallel
      const [boatosTasks, maintenanceTasks, pendingApprovals] = await Promise.all([
        this._getBoatOSTodos(assetUid),
        this._getMaintenanceTodos(assetUid),
        this._getApprovalTodos(assetUid),
      ]);

      // Combine all todos
      const allTodos = [
        ...boatosTasks,
        ...maintenanceTasks,
        ...pendingApprovals,
      ];

      // Sort by priority (due date, urgency)
      allTodos.sort((a, b) => {
        // Priority: overdue > due_soon > upcoming
        const priorityOrder = { overdue: 0, due_soon: 1, due: 2, upcoming: 3, action_required: 1.5 };
        return (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99);
      });

      logger.info('Fetched all todos', {
        total: allTodos.length,
        boatos: boatosTasks.length,
        maintenance: maintenanceTasks.length,
        approvals: pendingApprovals.length,
      });

      return allTodos;

    } catch (error) {
      logger.error('Failed to get all todos', { error: error.message });
      throw error;
    }
  },

  /**
   * Get BoatOS to-do items (system-generated prompts)
   * @private
   * @param {string} assetUid - Filter by system
   * @returns {Promise<Array>} BoatOS to-do items
   */
  async _getBoatOSTodos(assetUid = null) {
    try {
      const dueTasks = await boatosTasksService.getDueTasks();

      // Filter by assetUid if provided
      let filteredTasks = dueTasks;
      if (assetUid) {
        filteredTasks = dueTasks.filter(task => task.asset_uid === assetUid);
      }

      // Convert to to-do format (with system names)
      const todos = await Promise.all(
        filteredTasks.map(async (task) => {
          // Get system name for human-friendly display
          const systemName = await this._getSystemName(task.asset_uid);
          const titlePrefix = systemName ? `${systemName}: ` : '';

          return {
            id: `boatos-${task.id}`,
            type: 'boatos_task',
            source: 'BoatOS',
            title: `${titlePrefix}Update Operating Hours`,
            description: `Last updated ${task.systemInfo?.daysSinceUpdate || 'unknown'} days ago`,
            assetUid: task.asset_uid,
            priority: task.overdueDays > 7 ? 'overdue' : 'due',
            dueDate: task.next_due,
            overdueDays: task.overdueDays,
            actionUrl: `http://localhost:3001/hours-update.html?system=${task.asset_uid}`,
            canDismiss: true,
            metadata: {
              taskId: task.id,
              taskType: task.task_type,
              currentHours: task.systemInfo?.currentHours,
              lastUpdate: task.systemInfo?.lastUpdate,
            },
          };
        })
      );

      return todos;

    } catch (error) {
      logger.error('Failed to get BoatOS todos', { error: error.message });
      return [];
    }
  },

  /**
   * Get maintenance task to-do items
   * @private
   * @param {string} assetUid - Filter by system
   * @returns {Promise<Array>} Maintenance to-do items
   */
  async _getMaintenanceTodos(assetUid = null) {
    try {
      // Get all approved maintenance tasks
      const allTasks = await pineconeRepository.listAllTasks();

      // Filter for approved tasks only
      let approvedTasks = allTasks.filter(task => {
        const metadata = task.metadata || {};
        return metadata.review_status === 'approved';
      });

      // Filter by assetUid if provided
      if (assetUid) {
        approvedTasks = approvedTasks.filter(task => {
          return task.metadata?.asset_uid === assetUid;
        });
      }

      // Get current hours for each system (for due status calculation)
      const systemHoursMap = new Map();
      if (approvedTasks.length > 0) {
        const uniqueAssets = [...new Set(approvedTasks.map(t => t.metadata?.asset_uid).filter(Boolean))];
        await Promise.all(
          uniqueAssets.map(async (uid) => {
            try {
              const state = await systemMaintenanceRepo.maintenance.getMaintenanceState(uid);
              if (state) {
                systemHoursMap.set(uid, state.current_operating_hours);
              }
            } catch (error) {
              logger.warn('Failed to get hours for system', { assetUid: uid, error: error.message });
            }
          })
        );
      }

      // Check which tasks are due
      const dueTasks = approvedTasks
        .map(task => {
          const metadata = task.metadata;
          const currentHours = systemHoursMap.get(metadata.asset_uid) || null;
          const dueStatus = taskCompletionsService.calculateDueStatus(task, currentHours);

          return {
            task,
            metadata,
            dueStatus,
          };
        })
        .filter(({ dueStatus }) => dueStatus.isDue || dueStatus.status === 'due_soon');

      // Convert to to-do format (with system names)
      const todos = await Promise.all(
        dueTasks.map(async ({ task, metadata, dueStatus }) => {
          let priority = 'upcoming';
          if (dueStatus.status === 'overdue') priority = 'overdue';
          else if (dueStatus.status === 'due' || dueStatus.status === 'due_soon') priority = 'due_soon';

          // Get system name for human-friendly display
          const systemName = await this._getSystemName(metadata.asset_uid);
          const titlePrefix = systemName ? `${systemName}: ` : '';

          return {
            id: `maintenance-${task.id}`,
            type: 'maintenance_task',
            source: 'Maintenance Schedule',
            title: `${titlePrefix}${metadata.description || 'Maintenance Task'}`,
            description: this._formatDueDescription(dueStatus, metadata),
            assetUid: metadata.asset_uid,
            priority,
            dueDate: dueStatus.nextDueDate || null,
            dueHours: dueStatus.nextDueHours || null,
            hoursUntilDue: dueStatus.hoursUntilDue,
            daysUntilDue: dueStatus.daysUntilDue,
            actionUrl: `http://localhost:3001/task-completion.html?taskId=${task.id}&assetUid=${metadata.asset_uid}`,
            canDismiss: false,
            metadata: {
              taskId: task.id,
              assetUid: metadata.asset_uid,
              frequencyBasis: metadata.frequency_basis,
              isRecurring: metadata.is_recurring,
              lastCompleted: metadata.last_completed_at,
            },
          };
        })
      );

      return todos;

    } catch (error) {
      logger.error('Failed to get maintenance todos', { error: error.message });
      return [];
    }
  },

  /**
   * Get approval to-do items
   * @private
   * @param {string} assetUid - Filter by system
   * @returns {Promise<Array>} Approval to-do items
   */
  async _getApprovalTodos(assetUid = null) {
    try {
      const pendingCount = await taskApprovalService.getPendingCount(assetUid);

      if (pendingCount === 0) {
        return [];
      }

      // Single to-do item for pending approvals
      return [{
        id: 'approvals-pending',
        type: 'approval_required',
        source: 'Task Approvals',
        title: `${pendingCount} Task${pendingCount > 1 ? 's' : ''} Awaiting Review`,
        description: 'Review and approve extracted maintenance tasks',
        assetUid: assetUid || 'all',
        priority: 'action_required',
        actionUrl: 'http://localhost:3000/public/maintenance-tasks-list.html',
        canDismiss: false,
        metadata: {
          pendingCount,
        },
      }];

    } catch (error) {
      logger.error('Failed to get approval todos', { error: error.message });
      return [];
    }
  },

  /**
   * Format due description based on frequency basis
   * @private
   * @param {Object} dueStatus - Due status from calculateDueStatus
   * @param {Object} metadata - Task metadata
   * @returns {string} Formatted description
   */
  _formatDueDescription(dueStatus, metadata) {
    if (metadata.frequency_basis === 'usage') {
      const hoursUntil = dueStatus.hoursUntilDue || 0;
      if (hoursUntil <= 0) {
        return `Overdue by ${Math.abs(hoursUntil)} operating hours`;
      } else {
        return `Due in ${hoursUntil} operating hours`;
      }
    } else if (metadata.frequency_basis === 'calendar') {
      const daysUntil = dueStatus.daysUntilDue || 0;
      if (daysUntil <= 0) {
        return `Overdue by ${Math.abs(daysUntil)} days`;
      } else {
        return `Due in ${daysUntil} days`;
      }
    }

    return 'Due for maintenance';
  },

  /**
   * Get to-do statistics
   * @param {string} assetUid - Filter by system (optional)
   * @returns {Promise<Object>} To-do statistics
   */
  async getTodoStatistics(assetUid = null) {
    try {
      const todos = await this.getAllTodos({ assetUid });

      const stats = {
        total: todos.length,
        byType: {
          boatos_task: 0,
          maintenance_task: 0,
          approval_required: 0,
        },
        byPriority: {
          overdue: 0,
          due_soon: 0,
          due: 0,
          action_required: 0,
          upcoming: 0,
        },
      };

      todos.forEach(todo => {
        stats.byType[todo.type]++;
        stats.byPriority[todo.priority]++;
      });

      return stats;

    } catch (error) {
      logger.error('Failed to get todo statistics', { error: error.message });
      throw error;
    }
  },
};

export default todoService;
