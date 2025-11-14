/**
 * Task Approval Service
 * Business logic for maintenance task approval workflow
 */

import { pineconeRepository } from '../repositories/pinecone.repository.js';
import { systemsRepository } from '../repositories/supabase.repository.js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('task-approval-service');

export const taskApprovalService = {
  /**
   * Process task for approval (auto-approve or queue for review)
   * @param {string} taskId - Task ID
   * @param {number} confidenceScore - Task confidence score (0.0-1.0)
   * @returns {Promise<Object>} Approval result
   */
  async processTaskForApproval(taskId, confidenceScore) {
    try {
      logger.info('Processing task for approval', { taskId, confidenceScore });

      const autoApproveThreshold = config.approval.autoApproveConfidence;

      // Auto-approve high confidence tasks
      if (confidenceScore >= autoApproveThreshold) {
        await pineconeRepository.updateMetadata(taskId, {
          review_status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: 'auto',
          auto_approved: true,
        });

        logger.info('Task auto-approved', { taskId, confidenceScore });

        return {
          action: 'auto_approved',
          taskId,
          confidenceScore,
        };
      }

      // Queue for manual review (aligned with main app status values)
      await pineconeRepository.updateMetadata(taskId, {
        review_status: 'pending',
        queued_for_review_at: new Date().toISOString(),
      });

      logger.info('Task queued for review', { taskId, confidenceScore });

      return {
        action: 'queued_for_review',
        taskId,
        confidenceScore,
      };

    } catch (error) {
      logger.error('Failed to process task for approval', { taskId, error: error.message });
      throw error;
    }
  },

  /**
   * Get tasks pending review
   * @param {Object} options - Query options
   * @param {string} options.assetUid - Filter by system (optional)
   * @param {number} options.limit - Max tasks to return
   * @returns {Promise<Array>} Tasks pending review
   */
  async getPendingTasks({ assetUid = null, limit = 50 } = {}) {
    try {
      logger.info('Fetching pending review tasks', { assetUid, limit });

      // Get all tasks from Pinecone
      const allTasks = await pineconeRepository.listAllTasks();

      // Filter for pending review (aligned with main app status values)
      let pendingTasks = allTasks.filter(task => {
        const metadata = task.metadata || {};
        return metadata.review_status === 'pending' || !metadata.review_status; // Treat missing status as pending
      });

      // Filter by assetUid if provided
      if (assetUid) {
        pendingTasks = pendingTasks.filter(task => {
          return task.metadata?.asset_uid === assetUid;
        });
      }

      // Sort by confidence score (lowest first - needs most attention)
      pendingTasks.sort((a, b) => {
        const scoreA = a.metadata?.confidence_score || 0;
        const scoreB = b.metadata?.confidence_score || 0;
        return scoreA - scoreB;
      });

      // Limit results
      const limitedTasks = pendingTasks.slice(0, limit);

      logger.info('Fetched pending tasks', { count: limitedTasks.length });

      return limitedTasks.map(task => ({
        id: task.id,
        metadata: task.metadata,
      }));

    } catch (error) {
      logger.error('Failed to get pending tasks', { error: error.message });
      throw error;
    }
  },

  /**
   * Approve a task
   * @param {string} taskId - Task ID
   * @param {string} approvedBy - Who approved (default: 'user')
   * @param {string} notes - Optional approval notes
   * @returns {Promise<Object>} Updated task
   */
  async approveTask(taskId, approvedBy = 'user', notes = null) {
    try {
      logger.info('Approving task', { taskId, approvedBy });

      await pineconeRepository.updateMetadata(taskId, {
        review_status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: approvedBy,
        approval_notes: notes,
        auto_approved: false,
      });

      logger.info('Task approved', { taskId, approvedBy });

      return {
        taskId,
        status: 'approved',
        approvedBy,
        approvedAt: new Date().toISOString(),
      };

    } catch (error) {
      logger.error('Failed to approve task', { taskId, error: error.message });
      throw error;
    }
  },

  /**
   * Reject a task
   * @param {string} taskId - Task ID
   * @param {string} rejectedBy - Who rejected (default: 'user')
   * @param {string} reason - Rejection reason (required)
   * @returns {Promise<Object>} Updated task
   */
  async rejectTask(taskId, rejectedBy = 'user', reason) {
    try {
      if (!reason) {
        throw new Error('Rejection reason is required');
      }

      logger.info('Rejecting task', { taskId, rejectedBy, reason });

      await pineconeRepository.updateMetadata(taskId, {
        review_status: 'rejected',
        rejected_at: new Date().toISOString(),
        rejected_by: rejectedBy,
        rejection_reason: reason,
      });

      logger.info('Task rejected', { taskId, rejectedBy });

      return {
        taskId,
        status: 'rejected',
        rejectedBy,
        rejectedAt: new Date().toISOString(),
        reason,
      };

    } catch (error) {
      logger.error('Failed to reject task', { taskId, error: error.message });
      throw error;
    }
  },

  /**
   * Bulk approve tasks
   * @param {Array<string>} taskIds - Array of task IDs
   * @param {string} approvedBy - Who approved
   * @returns {Promise<Object>} Bulk approval results
   */
  async bulkApprove(taskIds, approvedBy = 'user') {
    try {
      logger.info('Bulk approving tasks', { count: taskIds.length, approvedBy });

      const results = {
        successful: [],
        failed: [],
      };

      for (const taskId of taskIds) {
        try {
          await this.approveTask(taskId, approvedBy);
          results.successful.push(taskId);
        } catch (error) {
          logger.warn('Failed to approve task in bulk operation', { taskId, error: error.message });
          results.failed.push({ taskId, error: error.message });
        }
      }

      logger.info('Bulk approval complete', {
        total: taskIds.length,
        successful: results.successful.length,
        failed: results.failed.length,
      });

      return results;

    } catch (error) {
      logger.error('Bulk approval failed', { error: error.message });
      throw error;
    }
  },

  /**
   * Bulk reject tasks
   * @param {Array<string>} taskIds - Array of task IDs
   * @param {string} rejectedBy - Who rejected
   * @param {string} reason - Rejection reason
   * @returns {Promise<Object>} Bulk rejection results
   */
  async bulkReject(taskIds, rejectedBy = 'user', reason) {
    try {
      if (!reason) {
        throw new Error('Rejection reason is required for bulk rejection');
      }

      logger.info('Bulk rejecting tasks', { count: taskIds.length, rejectedBy });

      const results = {
        successful: [],
        failed: [],
      };

      for (const taskId of taskIds) {
        try {
          await this.rejectTask(taskId, rejectedBy, reason);
          results.successful.push(taskId);
        } catch (error) {
          logger.warn('Failed to reject task in bulk operation', { taskId, error: error.message });
          results.failed.push({ taskId, error: error.message });
        }
      }

      logger.info('Bulk rejection complete', {
        total: taskIds.length,
        successful: results.successful.length,
        failed: results.failed.length,
      });

      return results;

    } catch (error) {
      logger.error('Bulk rejection failed', { error: error.message });
      throw error;
    }
  },

  /**
   * Get approval statistics
   * @param {string} assetUid - Filter by system (optional)
   * @returns {Promise<Object>} Approval statistics
   */
  async getApprovalStatistics(assetUid = null) {
    try {
      logger.info('Fetching approval statistics', { assetUid });

      // Get all tasks from Pinecone
      const allTasks = await pineconeRepository.listAllTasks();

      // Filter by assetUid if provided
      let tasks = allTasks;
      if (assetUid) {
        tasks = tasks.filter(task => task.metadata?.asset_uid === assetUid);
      }

      // Calculate statistics
      const stats = {
        total: tasks.length,
        pending: 0,  // Aligned with main app status values
        approved: 0,
        rejected: 0,
        auto_approved: 0,
        manual_approved: 0,
        averageConfidence: 0,
        confidenceDistribution: {
          high: 0,    // > 0.90
          medium: 0,  // 0.70 - 0.90
          low: 0,     // < 0.70
        },
      };

      let totalConfidence = 0;

      tasks.forEach(task => {
        const metadata = task.metadata || {};
        const reviewStatus = metadata.review_status || 'pending'; // Default to pending if missing
        const confidence = metadata.confidence_score || 0;

        // Count by review status (aligned with main app)
        if (reviewStatus === 'pending' || !reviewStatus) stats.pending++;
        else if (reviewStatus === 'approved') {
          stats.approved++;
          if (metadata.auto_approved) stats.auto_approved++;
          else stats.manual_approved++;
        } else if (reviewStatus === 'rejected') stats.rejected++;

        // Confidence distribution
        if (confidence > 0.90) stats.confidenceDistribution.high++;
        else if (confidence >= 0.70) stats.confidenceDistribution.medium++;
        else stats.confidenceDistribution.low++;

        totalConfidence += confidence;
      });

      stats.averageConfidence = tasks.length > 0
        ? (totalConfidence / tasks.length).toFixed(2)
        : 0;

      logger.info('Approval statistics calculated', stats);

      return stats;

    } catch (error) {
      logger.error('Failed to get approval statistics', { error: error.message });
      throw error;
    }
  },

  /**
   * Get count of pending review tasks (for UI badges)
   * @param {string} assetUid - Filter by system (optional)
   * @returns {Promise<number>} Count of pending tasks
   */
  async getPendingCount(assetUid = null) {
    try {
      const allTasks = await pineconeRepository.listAllTasks();

      let pendingCount = allTasks.filter(task => {
        const metadata = task.metadata || {};
        const isPending = metadata.review_status === 'pending' || !metadata.review_status; // Aligned with main app

        if (assetUid) {
          return isPending && metadata.asset_uid === assetUid;
        }

        return isPending;
      }).length;

      return pendingCount;

    } catch (error) {
      logger.error('Failed to get pending count', { error: error.message });
      throw error;
    }
  },

  /**
   * Get ALL tasks (not just pending)
   * @param {Object} options - Query options
   * @param {string} options.assetUid - Filter by system (optional)
   * @returns {Promise<Array>} All tasks
   */
  async getAllTasks({ assetUid = null } = {}) {
    try {
      logger.info('Fetching all tasks', { assetUid });

      // Get all tasks from Pinecone
      const allTasks = await pineconeRepository.listAllTasks();

      // Get all systems to enrich with display names
      const systems = await systemsRepository.getAllSystems();
      const systemsMap = new Map(
        systems.map(s => [s.asset_uid, s])
      );

      // Filter by assetUid if provided
      let tasks = allTasks;
      if (assetUid) {
        tasks = tasks.filter(task => task.metadata?.asset_uid === assetUid);
      }

      // Format tasks for frontend and enrich with display_name
      const formattedTasks = tasks.map(task => {
        const system = systemsMap.get(task.metadata?.asset_uid);
        const display_name = system
          ? `${system.manufacturer_norm} ${system.model_norm}`.trim()
          : task.metadata?.system_name || 'Unknown System';

        return {
          id: task.id,
          ...task.metadata,
          display_name, // Add computed display name for dropdowns
        };
      });

      logger.info('Tasks fetched and enriched', { count: formattedTasks.length });

      return formattedTasks;

    } catch (error) {
      logger.error('Failed to fetch all tasks', { error: error.message });
      throw error;
    }
  },

  /**
   * Update task metadata
   * @param {string} taskId - Task ID
   * @param {Object} updates - Metadata updates
   * @returns {Promise<Object>} Update result
   */
  async updateTask(taskId, updates) {
    try {
      logger.info('Updating task', { taskId });

      await pineconeRepository.updateTaskMetadata(taskId, updates);

      logger.info('Task updated successfully', { taskId });

      return {
        taskId,
        updated: true,
      };

    } catch (error) {
      logger.error('Failed to update task', { taskId, error: error.message });
      throw error;
    }
  },

  /**
   * Delete a task
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>} Delete result
   */
  async deleteTask(taskId) {
    try {
      logger.info('Deleting task', { taskId });

      await pineconeRepository.deleteTask(taskId);

      logger.info('Task deleted successfully', { taskId });

      return {
        taskId,
        deleted: true,
      };

    } catch (error) {
      logger.error('Failed to delete task', { taskId, error: error.message });
      throw error;
    }
  },

  /**
   * Bulk update review status
   * @param {Array<string>} taskIds - Array of task IDs
   * @param {string} status - New review status (pending/approved/rejected)
   * @returns {Promise<Object>} Bulk update result
   */
  async bulkUpdateStatus(taskIds, status) {
    try {
      logger.info('Bulk updating task status', { count: taskIds.length, status });

      const results = {
        successful: 0,
        failed: 0,
        errors: [],
      };

      for (const taskId of taskIds) {
        try {
          await pineconeRepository.updateTaskMetadata(taskId, {
            review_status: status,
            updated_at: new Date().toISOString(),
          });
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            taskId,
            error: error.message,
          });
        }
      }

      logger.info('Bulk status update complete', results);

      return results;

    } catch (error) {
      logger.error('Bulk status update failed', { error: error.message });
      throw error;
    }
  },
};

export default taskApprovalService;
