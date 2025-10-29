/**
 * Deduplication Review Routes
 * API endpoints for reviewing and managing duplicate task pairs
 */

import express from 'express';
import deduplicationReviewRepository from '../../repositories/deduplication-review.repository.js';
import { pineconeRepository } from '../../repositories/pinecone.repository.js';
import { createLogger } from '../../utils/logger.js';

const router = express.Router();
const logger = createLogger('dedup-review-route');

/**
 * GET /admin/api/dedup-reviews/stats
 * Get review statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await deduplicationReviewRepository.getReviewStats();

    res.json({
      success: true,
      data: stats,
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to get review stats', {
      error: error.message,
      requestId: res.locals.requestId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get review stats',
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /admin/api/dedup-reviews/pending
 * Get pending reviews with pagination and filters
 */
router.get('/pending', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const systemFilter = req.query.system || null;

    const reviews = await deduplicationReviewRepository.getPendingReviews(limit, offset, systemFilter);

    res.json({
      success: true,
      data: reviews,
      pagination: {
        limit,
        offset,
        count: reviews.length
      },
      filters: {
        system: systemFilter
      },
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to get pending reviews', {
      error: error.message,
      requestId: res.locals.requestId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get pending reviews',
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /admin/api/dedup-reviews/systems
 * Get list of systems in pending reviews
 */
router.get('/systems', async (req, res) => {
  try {
    const systems = await deduplicationReviewRepository.getSystemsList();

    res.json({
      success: true,
      data: systems,
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to get systems list', {
      error: error.message,
      requestId: res.locals.requestId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get systems list',
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /admin/api/dedup-reviews/analyses
 * Get recent analysis runs
 */
router.get('/analyses', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const analyses = await deduplicationReviewRepository.getRecentAnalyses(limit);

    res.json({
      success: true,
      data: analyses,
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to get analyses', {
      error: error.message,
      requestId: res.locals.requestId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get analyses',
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /admin/api/dedup-reviews/analyses/:analysisId
 * Get specific analysis with its reviews
 */
router.get('/analyses/:analysisId', async (req, res) => {
  try {
    const { analysisId } = req.params;

    const [analysis, reviews] = await Promise.all([
      deduplicationReviewRepository.getAnalysisById(analysisId),
      deduplicationReviewRepository.getReviewsByAnalysis(analysisId)
    ]);

    res.json({
      success: true,
      data: {
        analysis,
        reviews,
        reviewCount: reviews.length
      },
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to get analysis', {
      analysisId: req.params.analysisId,
      error: error.message,
      requestId: res.locals.requestId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get analysis',
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /admin/api/dedup-reviews/pending-commits
 * Get count of reviewed but not yet executed decisions
 */
router.get('/pending-commits', async (req, res) => {
  try {
    const count = await deduplicationReviewRepository.getPendingCommitsCount();

    res.json({
      success: true,
      data: { count },
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to get pending commits count', {
      error: error.message,
      requestId: res.locals.requestId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get pending commits count',
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /admin/api/dedup-reviews/execute
 * Execute all reviewed decisions (commit to Pinecone)
 */
router.post('/execute', async (req, res) => {
  try {
    // Get all unexecuted reviews
    const reviews = await deduplicationReviewRepository.getUnexecutedReviews();

    if (reviews.length === 0) {
      return res.json({
        success: true,
        data: {
          executed: 0,
          failed: 0,
          message: 'No decisions to execute'
        },
        requestId: res.locals.requestId
      });
    }

    logger.info('Executing deduplication decisions', {
      count: reviews.length,
      requestId: res.locals.requestId
    });

    let executed = 0;
    let failed = 0;
    const errors = [];

    // Execute each decision
    for (const review of reviews) {
      try {
        // Skip 'keep_both' - no action needed
        if (review.review_status === 'keep_both') {
          await deduplicationReviewRepository.markExecuted(review.id, true);
          executed++;
          continue;
        }

        // Execute delete decisions
        if (review.review_status === 'delete_task1') {
          // Mark task1 as duplicate in Pinecone
          await pineconeRepository.updateTaskMetadata(review.task1_id, {
            is_duplicate: true,
            duplicate_of: review.task2_id,
            review_status: 'duplicate_hidden',
            deduplicated_at: new Date().toISOString()
          });
          await deduplicationReviewRepository.markExecuted(review.id, true);
          executed++;
          logger.info('Marked task as duplicate', {
            taskId: review.task1_id,
            duplicateOf: review.task2_id
          });
        } else if (review.review_status === 'delete_task2') {
          // Mark task2 as duplicate in Pinecone
          await pineconeRepository.updateTaskMetadata(review.task2_id, {
            is_duplicate: true,
            duplicate_of: review.task1_id,
            review_status: 'duplicate_hidden',
            deduplicated_at: new Date().toISOString()
          });
          await deduplicationReviewRepository.markExecuted(review.id, true);
          executed++;
          logger.info('Marked task as duplicate', {
            taskId: review.task2_id,
            duplicateOf: review.task1_id
          });
        } else if (review.review_status === 'delete_both') {
          // Mark both tasks as garbage/invalid in Pinecone
          await pineconeRepository.updateTaskMetadata(review.task1_id, {
            is_duplicate: true,
            review_status: 'invalid_task',
            deduplicated_at: new Date().toISOString()
          });
          await pineconeRepository.updateTaskMetadata(review.task2_id, {
            is_duplicate: true,
            review_status: 'invalid_task',
            deduplicated_at: new Date().toISOString()
          });
          await deduplicationReviewRepository.markExecuted(review.id, true);
          executed++;
          logger.info('Marked both tasks as invalid', {
            task1Id: review.task1_id,
            task2Id: review.task2_id
          });
        }
      } catch (error) {
        logger.error('Failed to execute review decision', {
          reviewId: review.id,
          error: error.message
        });
        await deduplicationReviewRepository.markExecuted(review.id, false, error.message);
        failed++;
        errors.push({
          reviewId: review.id,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      data: {
        executed,
        failed,
        total: reviews.length,
        errors: errors.length > 0 ? errors : undefined
      },
      requestId: res.locals.requestId
    });

  } catch (error) {
    logger.error('Failed to execute deduplication decisions', {
      error: error.message,
      requestId: res.locals.requestId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to execute decisions',
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /admin/api/dedup-reviews/:reviewId
 * Get single review by ID
 */
router.get('/:reviewId', async (req, res) => {
  try {
    const { reviewId } = req.params;
    const review = await deduplicationReviewRepository.getReviewById(reviewId);

    res.json({
      success: true,
      data: review,
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to get review', {
      reviewId: req.params.reviewId,
      error: error.message,
      requestId: res.locals.requestId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to get review',
      requestId: res.locals.requestId
    });
  }
});

/**
 * PATCH /admin/api/dedup-reviews/:reviewId/status
 * Update review status
 */
router.patch('/:reviewId/status', async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { status, notes, reviewedBy } = req.body;

    // Validate status
    const validStatuses = ['pending', 'keep_both', 'merge', 'delete_task1', 'delete_task2', 'delete_both'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        requestId: res.locals.requestId
      });
    }

    const updated = await deduplicationReviewRepository.updateReviewStatus(
      reviewId,
      status,
      notes,
      reviewedBy || 'user'
    );

    logger.info('Review status updated', {
      reviewId,
      status,
      reviewedBy: reviewedBy || 'user',
      requestId: res.locals.requestId
    });

    res.json({
      success: true,
      data: updated,
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to update review status', {
      reviewId: req.params.reviewId,
      error: error.message,
      requestId: res.locals.requestId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to update review status',
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /admin/api/dedup-reviews/bulk-update
 * Bulk update review statuses
 */
router.post('/bulk-update', async (req, res) => {
  try {
    const { reviewIds, status, reviewedBy } = req.body;

    // Validate input
    if (!Array.isArray(reviewIds) || reviewIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'reviewIds must be a non-empty array',
        requestId: res.locals.requestId
      });
    }

    const validStatuses = ['pending', 'keep_both', 'merge', 'delete_task1', 'delete_task2', 'delete_both'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        requestId: res.locals.requestId
      });
    }

    const count = await deduplicationReviewRepository.bulkUpdateStatus(
      reviewIds,
      status,
      reviewedBy || 'user'
    );

    logger.info('Bulk updated reviews', {
      count,
      status,
      reviewedBy: reviewedBy || 'user',
      requestId: res.locals.requestId
    });

    res.json({
      success: true,
      data: {
        updatedCount: count,
        status
      },
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to bulk update reviews', {
      error: error.message,
      requestId: res.locals.requestId
    });

    res.status(500).json({
      success: false,
      error: 'Failed to bulk update reviews',
      requestId: res.locals.requestId
    });
  }
});

export default router;
