/**
 * Task Completions Routes
 * API endpoints for recording task completions
 */

import express from 'express';
import taskCompletionsService from '../../services/task-completions.service.js';
import { createLogger } from '../../utils/logger.js';

const router = express.Router();
const logger = createLogger('task-completions-route');

/**
 * POST /admin/api/task-completions
 * Record a task completion
 */
router.post('/', async (req, res, next) => {
  
  const { taskId, assetUid, hoursAtCompletion, completedBy, sourceType, notes } = req.body;

  try {
    logger.info('Recording task completion', { taskId, assetUid });

    // Validation
    if (!taskId || !assetUid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'taskId and assetUid are required',
        },
      });
    }

    // Validate sourceType if provided
    if (sourceType) {
      const validTypes = ['manual', 'ai_inferred', 'sensor_trigger', 'user_input'];
      if (!validTypes.includes(sourceType)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_SOURCE_TYPE',
            message: `sourceType must be one of: ${validTypes.join(', ')}`,
          },
        });
      }
    }

    const result = await taskCompletionsService.completeTask({
      taskId,
      assetUid,
      hoursAtCompletion: hoursAtCompletion || null,
      completedBy: completedBy || 'user',
      sourceType: sourceType || 'manual',
      notes: notes || null,
    });

    logger.info('Task completion recorded', { taskId, assetUid, completionId: result.completion.id });

    return res.json({
      success: true,
      data: result,
    });

  } catch (error) {
    logger.error('Error recording completion', { taskId, assetUid, error: error.message });
    return next(error);
  }
});

/**
 * GET /admin/api/task-completions/task/:taskId/system/:assetUid/history
 * Get completion history for a specific task
 */
router.get('/task/:taskId/system/:assetUid/history', async (req, res, next) => {
  
  const { taskId, assetUid } = req.params;

  try {
    logger.info('Fetching task completion history', { taskId, assetUid });

    const history = await taskCompletionsService.getTaskHistory(taskId, assetUid);

    return res.json({
      success: true,
      data: history,
    });

  } catch (error) {
    logger.error('Error fetching task history', { taskId, assetUid, error: error.message });
    return next(error);
  }
});

export default router;
