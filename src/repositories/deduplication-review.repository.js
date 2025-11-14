/**
 * Deduplication Review Repository
 * Data access layer for duplicate task review workflow
 */

import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('dedup-review-repository');

// Initialize Supabase client
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey
);

const deduplicationReviewRepository = {
  /**
   * Create a new analysis run record
   * @param {Object} metadata - Analysis metadata
   * @returns {Promise<string>} Analysis ID
   */
  async createAnalysisRun(metadata) {
    const { data, error } = await supabase
      .from('deduplication_analyses')
      .insert({
        analysis_date: metadata.analysis_date,
        total_tasks: metadata.total_tasks,
        duplicate_pairs_found: metadata.duplicate_pairs_found,
        duplicate_groups_found: metadata.duplicate_groups_found || 0,
        thresholds: metadata.thresholds,
        filters: metadata.filters || null
      })
      .select('id')
      .single();

    if (error) {
      logger.error('Failed to create analysis run', { error: error.message });
      throw error;
    }

    logger.info('Created analysis run', { analysisId: data.id });
    return data.id;
  },

  /**
   * Save duplicate pairs in bulk
   * @param {string} analysisId - Analysis run ID
   * @param {Array} pairs - Array of duplicate pairs
   * @returns {Promise<number>} Number of pairs saved
   */
  async bulkSavePairs(analysisId, pairs) {
    if (!pairs || pairs.length === 0) {
      logger.info('No pairs to save');
      return 0;
    }

    // Transform pairs to database format
    const reviews = pairs.map(pair => ({
      analysis_id: analysisId,
      task1_id: pair.taskA.id,
      task1_description: pair.taskA.description,
      task1_metadata: pair.taskA,
      task2_id: pair.taskB.id,
      task2_description: pair.taskB.description,
      task2_metadata: pair.taskB,
      similarity_score: pair.similarity_score,
      match_reason: pair.reason,
      warning: pair.warning || null,
      review_status: 'pending'
    }));

    // Batch insert (Supabase can handle up to 1000 rows at once)
    const batchSize = 1000;
    let totalInserted = 0;

    for (let i = 0; i < reviews.length; i += batchSize) {
      const batch = reviews.slice(i, i + batchSize);

      const { data, error } = await supabase
        .from('deduplication_reviews')
        .insert(batch)
        .select('id');

      if (error) {
        logger.error('Failed to save batch of pairs', {
          batchStart: i,
          batchSize: batch.length,
          error: error.message
        });
        throw error;
      }

      totalInserted += data.length;
      logger.info('Saved batch of pairs', {
        batchStart: i,
        count: data.length,
        total: totalInserted
      });
    }

    logger.info('All pairs saved', { analysisId, totalInserted });
    return totalInserted;
  },

  /**
   * Get pending reviews with pagination and filters
   * @param {number} limit - Max results
   * @param {number} offset - Offset for pagination
   * @param {string} systemFilter - Optional system name filter
   * @returns {Promise<Array>} Pending reviews
   */
  async getPendingReviews(limit = 50, offset = 0, systemFilter = null) {
    // If filtering by system, fetch all and filter in JS to avoid PostgREST escaping issues
    if (systemFilter) {
      const { data, error } = await supabase
        .from('deduplication_pending_reviews')
        .select('*');

      if (error) {
        logger.error('Failed to fetch pending reviews', { error: error.message, systemFilter });
        throw error;
      }

      // Filter in JavaScript to handle special characters properly
      const filtered = (data || []).filter(review => {
        const system1 = (review.task1_system || '').toLowerCase();
        const system2 = (review.task2_system || '').toLowerCase();
        const filter = systemFilter.toLowerCase();
        return system1.includes(filter) || system2.includes(filter);
      });

      // Apply pagination
      const paginated = filtered.slice(offset, offset + 50);

      logger.info('Fetched and filtered pending reviews', {
        total: data.length,
        filtered: filtered.length,
        returned: paginated.length,
        systemFilter
      });

      return paginated;
    }

    // No filter - use database query with pagination
    const { data, error } = await supabase
      .from('deduplication_pending_reviews')
      .select('*')
      .range(offset, offset + 50 - 1);

    if (error) {
      logger.error('Failed to fetch pending reviews', { error: error.message });
      throw error;
    }

    logger.info('Fetched pending reviews', { count: data?.length });
    return data || [];
  },

  /**
   * Get unique list of systems from pending reviews
   * Returns display names in "Manufacturer Model" format
   * @returns {Promise<Array>} List of system display names
   */
  async getSystemsList() {
    // Fetch review metadata with asset_uids from main table (not view)
    const { data: reviews, error: reviewsError } = await supabase
      .from('deduplication_reviews')
      .select('task1_metadata, task2_metadata')
      .eq('review_status', 'pending'); // Only get pending reviews

    if (reviewsError) {
      logger.error('Failed to fetch systems list', { error: reviewsError.message });
      throw reviewsError;
    }

    // Extract unique asset UIDs
    const assetUids = new Set();
    reviews.forEach(row => {
      if (row.task1_metadata?.asset_uid) assetUids.add(row.task1_metadata.asset_uid);
      if (row.task2_metadata?.asset_uid) assetUids.add(row.task2_metadata.asset_uid);
    });

    if (assetUids.size === 0) {
      return []; // No systems to look up
    }

    // Fetch systems data to build display names
    const { data: systems, error: systemsError } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm')
      .in('asset_uid', Array.from(assetUids));

    if (systemsError) {
      logger.error('Failed to fetch systems for display names', { error: systemsError.message });
      throw systemsError;
    }

    // Build display names (Manufacturer Model format)
    const displayNames = systems.map(s =>
      `${s.manufacturer_norm} ${s.model_norm}`.trim()
    );

    return Array.from(new Set(displayNames)).sort();
  },

  /**
   * Get all reviews for a specific analysis
   * @param {string} analysisId - Analysis ID
   * @returns {Promise<Array>} Reviews
   */
  async getReviewsByAnalysis(analysisId) {
    const { data, error } = await supabase
      .from('deduplication_reviews')
      .select('*')
      .eq('analysis_id', analysisId)
      .order('similarity_score', { ascending: false });

    if (error) {
      logger.error('Failed to fetch reviews by analysis', {
        analysisId,
        error: error.message
      });
      throw error;
    }

    return data || [];
  },

  /**
   * Get a single review by ID
   * @param {string} reviewId - Review ID
   * @returns {Promise<Object>} Review data
   */
  async getReviewById(reviewId) {
    const { data, error } = await supabase
      .from('deduplication_reviews')
      .select('*')
      .eq('id', reviewId)
      .single();

    if (error) {
      logger.error('Failed to fetch review', { reviewId, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Update review status and decision
   * @param {string} reviewId - Review ID
   * @param {string} status - New status
   * @param {string} notes - Optional review notes
   * @param {string} reviewedBy - User who reviewed
   * @returns {Promise<Object>} Updated review
   */
  async updateReviewStatus(reviewId, status, notes = null, reviewedBy = 'user') {
    const updates = {
      review_status: status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString()
    };

    if (notes) {
      updates.review_notes = notes;
    }

    const { data, error } = await supabase
      .from('deduplication_reviews')
      .update(updates)
      .eq('id', reviewId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update review status', {
        reviewId,
        status,
        error: error.message
      });
      throw error;
    }

    logger.info('Review status updated', { reviewId, status, reviewedBy });
    return data;
  },

  /**
   * Bulk update multiple reviews
   * @param {Array<string>} reviewIds - Array of review IDs
   * @param {string} status - New status
   * @param {string} reviewedBy - User who reviewed
   * @returns {Promise<number>} Number of reviews updated
   */
  async bulkUpdateStatus(reviewIds, status, reviewedBy = 'user') {
    if (!reviewIds || reviewIds.length === 0) {
      return 0;
    }

    const { data, error } = await supabase
      .from('deduplication_reviews')
      .update({
        review_status: status,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString()
      })
      .in('id', reviewIds)
      .select('id');

    if (error) {
      logger.error('Failed to bulk update reviews', {
        count: reviewIds.length,
        status,
        error: error.message
      });
      throw error;
    }

    logger.info('Bulk updated reviews', { count: data.length, status, reviewedBy });
    return data.length;
  },

  /**
   * Get count of reviewed but not executed decisions
   * @returns {Promise<number>} Count of pending commits
   */
  async getPendingCommitsCount() {
    const { count, error } = await supabase
      .from('deduplication_reviews')
      .select('*', { count: 'exact', head: true })
      .eq('executed', false)
      .neq('review_status', 'pending');

    if (error) {
      logger.error('Failed to get pending commits count', { error: error.message });
      throw error;
    }

    return count || 0;
  },

  /**
   * Get all unexecuted reviewed decisions
   * @returns {Promise<Array>} Reviews ready to execute
   */
  async getUnexecutedReviews() {
    const { data, error } = await supabase
      .from('deduplication_reviews')
      .select('*')
      .eq('executed', false)
      .neq('review_status', 'pending')
      .order('reviewed_at', { ascending: true });

    if (error) {
      logger.error('Failed to get unexecuted reviews', { error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Mark review as executed
   * @param {string} reviewId - Review ID
   * @param {boolean} success - Whether execution succeeded
   * @param {string} error - Error message if failed
   * @returns {Promise<Object>} Updated review
   */
  async markExecuted(reviewId, success = true, error = null) {
    const updates = {
      executed: success,
      executed_at: new Date().toISOString()
    };

    if (error) {
      updates.execution_error = error;
    }

    const { data, error: dbError } = await supabase
      .from('deduplication_reviews')
      .update(updates)
      .eq('id', reviewId)
      .select()
      .single();

    if (dbError) {
      logger.error('Failed to mark review as executed', {
        reviewId,
        error: dbError.message
      });
      throw dbError;
    }

    logger.info('Review marked as executed', { reviewId, success });
    return data;
  },

  /**
   * Get review statistics
   * @returns {Promise<Object>} Stats by status
   */
  async getReviewStats() {
    // Count by status
    const { data, error } = await supabase
      .from('deduplication_reviews')
      .select('review_status', { count: 'exact' });

    if (error) {
      logger.error('Failed to fetch review stats', { error: error.message });
      throw error;
    }

    // Aggregate by status
    const stats = {
      pending: 0,
      keep_both: 0,
      merge: 0,
      delete_task1: 0,
      delete_task2: 0,
      delete_both: 0,
      dismissed: 0,
      total: data.length
    };

    data.forEach(row => {
      if (stats.hasOwnProperty(row.review_status)) {
        stats[row.review_status]++;
      }
    });

    return stats;
  },

  /**
   * Get recent analysis runs
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Recent analyses
   */
  async getRecentAnalyses(limit = 10) {
    const { data, error } = await supabase
      .from('deduplication_analyses')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch recent analyses', { error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Get analysis by ID
   * @param {string} analysisId - Analysis ID
   * @returns {Promise<Object>} Analysis data
   */
  async getAnalysisById(analysisId) {
    const { data, error } = await supabase
      .from('deduplication_analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (error) {
      logger.error('Failed to fetch analysis', { analysisId, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Delete an analysis run and all its reviews (cascade)
   * @param {string} analysisId - Analysis ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteAnalysis(analysisId) {
    const { error } = await supabase
      .from('deduplication_analyses')
      .delete()
      .eq('id', analysisId);

    if (error) {
      logger.error('Failed to delete analysis', { analysisId, error: error.message });
      throw error;
    }

    logger.info('Analysis deleted', { analysisId });
    return true;
  },

  /**
   * Get count of pending reviews for a specific asset
   * @param {string} assetUid - Asset UID
   * @returns {Promise<number>} Count of pending reviews
   */
  async getPendingReviewCountForAsset(assetUid) {
    // Fetch all pending reviews and filter in JavaScript
    // (JSONB operators in .or() clause fail silently in Supabase)
    const { data, error } = await supabase
      .from('deduplication_reviews')
      .select('task1_metadata, task2_metadata')
      .eq('review_status', 'pending');

    if (error) {
      logger.error('Failed to get pending review count', {
        assetUid,
        error: error.message
      });
      throw error;
    }

    // Filter by asset_uid in JavaScript
    const matchingReviews = (data || []).filter(review =>
      review.task1_metadata?.asset_uid === assetUid ||
      review.task2_metadata?.asset_uid === assetUid
    );

    logger.debug('Pending review count for asset', {
      assetUid,
      count: matchingReviews.length,
      totalPending: data?.length || 0
    });

    return matchingReviews.length;
  },

  /**
   * Check if all reviews for an asset are resolved and sync pipeline status
   * @param {string} assetUid - Asset UID to check
   * @returns {Promise<boolean>} True if status was updated to completed
   */
  async checkAndSyncPipelineStatus(assetUid) {
    try {
      // Get count of pending reviews for this asset
      const { count, error: countError } = await supabase
        .from('deduplication_reviews')
        .select('*', { count: 'exact', head: true })
        .eq('review_status', 'pending')
        .or(`task1_metadata->asset_uid.eq.${assetUid},task2_metadata->asset_uid.eq.${assetUid}`);

      if (countError) {
        logger.error('Failed to check pending reviews', {
          assetUid,
          error: countError.message
        });
        return false;
      }

      logger.info('Checked pending reviews for asset', {
        assetUid,
        pendingCount: count
      });

      // If no pending reviews, update pipeline status to completed
      if (count === 0) {
        const { error: updateError } = await supabase
          .from('pipeline_processing_status')
          .update({
            overall_status: 'completed',
            pending_review_count: 0,
            review_url: null,
            updated_at: new Date().toISOString()
          })
          .eq('asset_uid', assetUid);

        if (updateError) {
          logger.error('Failed to update pipeline status', {
            assetUid,
            error: updateError.message
          });
          return false;
        }

        logger.info('Pipeline status updated to completed', { assetUid });
        return true;
      }

      // If there are still pending reviews, update the count
      const { error: updateError } = await supabase
        .from('pipeline_processing_status')
        .update({
          pending_review_count: count,
          updated_at: new Date().toISOString()
        })
        .eq('asset_uid', assetUid);

      if (updateError) {
        logger.error('Failed to update pending review count', {
          assetUid,
          error: updateError.message
        });
      }

      return false;
    } catch (error) {
      logger.error('Error in checkAndSyncPipelineStatus', {
        assetUid,
        error: error.message
      });
      return false;
    }
  }
};

export default deduplicationReviewRepository;
