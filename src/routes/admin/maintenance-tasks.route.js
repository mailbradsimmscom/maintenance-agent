/**
 * Maintenance Tasks Routes (Maintenance Agent)
 * API endpoints for task approvals
 */

import express from 'express';
import taskApprovalService from '../../services/task-approval.service.js';
import { createLogger } from '../../utils/logger.js';

const router = express.Router();
const logger = createLogger('maintenance-tasks-route');

/**
 * GET /admin/api/maintenance-tasks/pending
 * Get tasks pending review
 */
router.get('/pending', async (req, res, next) => {
  
  const { assetUid, limit } = req.query;

  try {
    logger.info('Fetching pending review tasks', { assetUid, limit });

    const tasks = await taskApprovalService.getPendingTasks({
      assetUid: assetUid || null,
      limit: limit ? parseInt(limit) : 50,
    });

    return res.json({
      success: true,
      data: {
        tasks,
        count: tasks.length,
      },
    });

  } catch (error) {
    logger.error('Error fetching pending tasks', { error: error.message });
    return next(error);
  }
});

/**
 * GET /admin/api/maintenance-tasks/pending-count
 * [v2.1] Get count of pending review tasks (for UI badges)
 */
router.get('/pending-count', async (req, res, next) => {
  
  const { assetUid } = req.query;

  try {
    logger.info('Fetching pending count', { assetUid });

    const count = await taskApprovalService.getPendingCount(assetUid || null);

    return res.json({
      success: true,
      data: {
        count,
      },
    });

  } catch (error) {
    logger.error('Error fetching pending count', { error: error.message });
    return next(error);
  }
});

/**
 * GET /admin/api/maintenance-tasks/approval-stats
 * Get approval statistics
 */
router.get('/approval-stats', async (req, res, next) => {
  
  const { assetUid } = req.query;

  try {
    logger.info('Fetching approval statistics', { assetUid });

    const stats = await taskApprovalService.getApprovalStatistics(assetUid || null);

    return res.json({
      success: true,
      data: stats,
    });

  } catch (error) {
    logger.error('Error fetching approval stats', { error: error.message });
    return next(error);
  }
});

/**
 * POST /admin/api/maintenance-tasks/:taskId/approve
 * Approve a task
 */
router.post('/:taskId/approve', async (req, res, next) => {
  
  const { taskId } = req.params;
  const { approvedBy, notes } = req.body;

  try {
    logger.info('Approving task', { taskId });

    const result = await taskApprovalService.approveTask(
      taskId,
      approvedBy || 'user',
      notes || null
    );

    logger.info('Task approved', { taskId });

    return res.json({
      success: true,
      data: result,
    });

  } catch (error) {
    logger.error('Error approving task', { taskId, error: error.message });
    return next(error);
  }
});

/**
 * POST /admin/api/maintenance-tasks/:taskId/reject
 * Reject a task
 */
router.post('/:taskId/reject', async (req, res, next) => {
  
  const { taskId } = req.params;
  const { rejectedBy, reason } = req.body;

  try {
    logger.info('Rejecting task', { taskId });

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REASON_REQUIRED',
          message: 'Rejection reason is required',
        },
      });
    }

    const result = await taskApprovalService.rejectTask(
      taskId,
      rejectedBy || 'user',
      reason
    );

    logger.info('Task rejected', { taskId });

    return res.json({
      success: true,
      data: result,
    });

  } catch (error) {
    logger.error('Error rejecting task', { taskId, error: error.message });
    return next(error);
  }
});

/**
 * POST /admin/api/maintenance-tasks/bulk-approve
 * Bulk approve tasks
 */
router.post('/bulk-approve', async (req, res, next) => {
  
  const { taskIds, approvedBy } = req.body;

  try {
    logger.info('Bulk approving tasks', { count: taskIds?.length });

    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_TASK_IDS',
          message: 'taskIds must be a non-empty array',
        },
      });
    }

    const results = await taskApprovalService.bulkApprove(
      taskIds,
      approvedBy || 'user'
    );

    logger.info('Bulk approval complete', {
      total: taskIds.length,
      successful: results.successful.length,
      failed: results.failed.length,
    });

    return res.json({
      success: true,
      data: results,
    });

  } catch (error) {
    logger.error('Error bulk approving tasks', { error: error.message });
    return next(error);
  }
});

/**
 * POST /admin/api/maintenance-tasks/bulk-reject
 * Bulk reject tasks
 */
router.post('/bulk-reject', async (req, res, next) => {
  
  const { taskIds, rejectedBy, reason } = req.body;

  try {
    logger.info('Bulk rejecting tasks', { count: taskIds?.length });

    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_TASK_IDS',
          message: 'taskIds must be a non-empty array',
        },
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REASON_REQUIRED',
          message: 'Rejection reason is required',
        },
      });
    }

    const results = await taskApprovalService.bulkReject(
      taskIds,
      rejectedBy || 'user',
      reason
    );

    logger.info('Bulk rejection complete', {
      total: taskIds.length,
      successful: results.successful.length,
      failed: results.failed.length,
    });

    return res.json({
      success: true,
      data: results,
    });

  } catch (error) {
    logger.error('Error bulk rejecting tasks', { error: error.message });
    return next(error);
  }
});

export default router;
