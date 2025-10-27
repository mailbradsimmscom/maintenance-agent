/**
 * User Tasks Routes
 * API endpoints for user-created tasks
 */

import express from 'express';
import userTasksRepository from '../../repositories/user-tasks.repository.js';
import { createLogger } from '../../utils/logger.js';

const router = express.Router();
const logger = createLogger('user-tasks-route');

/**
 * GET /admin/api/user-tasks
 * Get all active user tasks
 */
router.get('/', async (req, res, next) => {
  try {
    const { assetUid } = req.query;

    logger.info('Fetching active user tasks', { assetUid });

    const tasks = await userTasksRepository.getActiveTasks(assetUid);

    return res.json({
      success: true,
      data: tasks,
    });

  } catch (error) {
    logger.error('Error fetching user tasks', { error: error.message });
    return next(error);
  }
});

/**
 * GET /admin/api/user-tasks/:taskId
 * Get a single user task
 */
router.get('/:taskId', async (req, res, next) => {
  try {
    const { taskId } = req.params;

    logger.info('Fetching user task', { taskId });

    const task = await userTasksRepository.getById(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Task not found',
        },
      });
    }

    return res.json({
      success: true,
      data: task,
    });

  } catch (error) {
    logger.error('Error fetching user task', { error: error.message });
    return next(error);
  }
});

/**
 * POST /admin/api/user-tasks
 * Create a new user task
 */
router.post('/', async (req, res, next) => {
  try {
    const taskData = req.body;

    logger.info('Creating user task', { taskData });

    // Validate required fields
    if (!taskData.description) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Description is required',
        },
      });
    }

    if (!taskData.due_date) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Due date is required',
        },
      });
    }

    // Create the task
    const task = await userTasksRepository.create(taskData);

    logger.info('User task created', { taskId: task.id });

    return res.json({
      success: true,
      data: task,
    });

  } catch (error) {
    logger.error('Error creating user task', { error: error.message });
    return next(error);
  }
});

/**
 * PATCH /admin/api/user-tasks/:taskId
 * Update a user task
 */
router.patch('/:taskId', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const updates = req.body;

    logger.info('Updating user task', { taskId, updates });

    const task = await userTasksRepository.update(taskId, updates);

    logger.info('User task updated', { taskId });

    return res.json({
      success: true,
      data: task,
    });

  } catch (error) {
    logger.error('Error updating user task', { error: error.message });
    return next(error);
  }
});

/**
 * POST /admin/api/user-tasks/:taskId/complete
 * Mark a user task as complete
 */
router.post('/:taskId/complete', async (req, res, next) => {
  try {
    const { taskId } = req.params;

    logger.info('Marking user task complete', { taskId });

    const task = await userTasksRepository.markComplete(taskId);

    logger.info('User task completed', { taskId, isRecurring: task.is_recurring });

    return res.json({
      success: true,
      data: task,
    });

  } catch (error) {
    logger.error('Error completing user task', { error: error.message });
    return next(error);
  }
});

/**
 * POST /admin/api/user-tasks/:taskId/reschedule
 * Reschedule a user task
 */
router.post('/:taskId/reschedule', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { due_date } = req.body;

    if (!due_date) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'New due date is required',
        },
      });
    }

    logger.info('Rescheduling user task', { taskId, due_date });

    const task = await userTasksRepository.reschedule(taskId, due_date);

    logger.info('User task rescheduled', { taskId });

    return res.json({
      success: true,
      data: task,
    });

  } catch (error) {
    logger.error('Error rescheduling user task', { error: error.message });
    return next(error);
  }
});

/**
 * DELETE /admin/api/user-tasks/:taskId
 * Delete a user task (soft delete by default)
 */
router.delete('/:taskId', async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { hard } = req.query; // ?hard=true for permanent delete

    logger.info('Deleting user task', { taskId, hard: !!hard });

    if (hard === 'true') {
      await userTasksRepository.hardDelete(taskId);
    } else {
      await userTasksRepository.delete(taskId); // Soft delete
    }

    logger.info('User task deleted', { taskId });

    return res.json({
      success: true,
      data: { deleted: true },
    });

  } catch (error) {
    logger.error('Error deleting user task', { error: error.message });
    return next(error);
  }
});

export default router;