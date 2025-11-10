/**
 * Pipeline Orchestrator Service
 * Phase 1: Manual Mode - Orchestrates the 5-step maintenance task pipeline
 *
 * Steps:
 * 1. Generic Pinecone Search - Find relevant chunks using generic terms
 * 2. LLM-Powered Search - Find chunks using system-specific LLM-generated terms
 * 3. Extract & Upload Tasks - Extract tasks from chunks and upload to Pinecone
 * 4. High-Confidence Deduplication - Auto-delete duplicates (85% threshold)
 * 5. Low-Confidence Deduplication - Queue duplicates for manual review (65% threshold)
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { rateLimiter } from './simple-rate-limiter.service.js';
import db from '../repositories/supabase.repository.js';
import { executeGenericSearch } from './step-executors/step1-generic-search.js';
import { executeLLMSearch } from './step-executors/step2-llm-search.js';
import { executeExtractTasks } from './step-executors/step3-extract-tasks.js';
import { executeHighConfidenceDedupe } from './step-executors/step4-dedupe-auto.js';
import { executeLowConfidenceDedupe } from './step-executors/step5-dedupe-review.js';
import { executeClassifyDiscover } from './step-executors/step6-classify-discover.js';

const config = getConfig();
const logger = createLogger('pipeline-orchestrator');

export class PipelineOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.rateLimiter = rateLimiter;
    this.activeRuns = new Map();

    logger.info('PipelineOrchestrator initialized');
  }

  /**
   * Process a single system through the 6-step pipeline
   * @param {string} assetUid - System asset UID
   * @returns {Promise<Object>} Processing results
   */
  async processSystem(assetUid) {
    const runId = uuidv4();
    const startTime = Date.now();

    try {
      // Create run record
      await this.createRun(runId, [assetUid]);
      this.activeRuns.set(runId, { assetUid, startTime });

      logger.info('Starting system processing', { runId, assetUid });

      // Emit start event
      this.emit('processing_started', {
        runId,
        assetUid
      });

      // Execute steps sequentially
      const results = {};

      // Step 1: Generic Pinecone Search
      results.step1 = await this.executeStep(1, assetUid, runId, async () => {
        logger.info('Step 1: Generic Pinecone search', { runId, assetUid });
        return await executeGenericSearch(assetUid, {
          rateLimiter: this.rateLimiter,
          onProgress: (progress) => {
            this.emit('progress_update', { runId, assetUid, step: 1, ...progress });
          }
        });
      });

      // Step 2: LLM-Powered Pinecone Search
      results.step2 = await this.executeStep(2, assetUid, runId, async () => {
        logger.info('Step 2: LLM-powered search', { runId, assetUid });
        return await executeLLMSearch(assetUid, {
          rateLimiter: this.rateLimiter,
          onProgress: (progress) => {
            this.emit('progress_update', { runId, assetUid, step: 2, ...progress });
          }
        });
      });

      // Step 3: Extract & Upload Tasks
      results.step3 = await this.executeStep(3, assetUid, runId, async () => {
        logger.info('Step 3: Extract and upload tasks', { runId, assetUid });
        return await executeExtractTasks(assetUid, {
          rateLimiter: this.rateLimiter,
          onProgress: (progress) => {
            this.emit('progress_update', { runId, assetUid, step: 3, ...progress });
          }
        });
      });

      // Step 4: High-Confidence Deduplication (Auto-Delete)
      results.step4 = await this.executeStep(4, assetUid, runId, async () => {
        logger.info('Step 4: High-confidence deduplication', { runId, assetUid });
        return await executeHighConfidenceDedupe(assetUid, {
          rateLimiter: this.rateLimiter,
          onProgress: (progress) => {
            this.emit('progress_update', { runId, assetUid, step: 4, ...progress });
          }
        });
      });

      // Step 5: Low-Confidence Deduplication (Manual Review)
      results.step5 = await this.executeStep(5, assetUid, runId, async () => {
        logger.info('Step 5: Low-confidence deduplication', { runId, assetUid });
        return await executeLowConfidenceDedupe(assetUid, {
          rateLimiter: this.rateLimiter,
          onProgress: (progress) => {
            this.emit('progress_update', { runId, assetUid, step: 5, ...progress });
          }
        });
      });

      // Calculate duration and prepare variables
      const duration = Date.now() - startTime;
      let pendingReviews = 0;
      let reviewUrl = null;

      // Check if manual dedup review is required
      if (results.step5?.pairsForReview > 0) {
        // Stop here - Step 6 will run later via check-and-advance endpoint
        pendingReviews = results.step5.pairsForReview;
        reviewUrl = results.step5.reviewUrl;

        this.emit('manual_review_required', {
          runId,
          assetUid,
          pendingReviews,
          reviewUrl
        });
        logger.info('Manual dedup review required, pausing before Step 6', {
          runId,
          assetUid,
          pendingReviews
        });

        await this.completeRun(runId, results, duration, reviewUrl, pendingReviews);
      } else {
        // No dedup review needed - run Step 6 automatically
        logger.info('No dedup review needed, running Step 6', { runId, assetUid });

        results.step6 = await this.executeStep(6, assetUid, runId, async () => {
          logger.info('Step 6: Classify and discover', { runId, assetUid });
          return await executeClassifyDiscover(assetUid, {
            rateLimiter: this.rateLimiter,
            onProgress: (progress) => {
              this.emit('progress_update', { runId, assetUid, step: 6, ...progress });
            }
          });
        });

        // Determine final status based on Step 6 results
        const totalTasks = (results.step6?.tasksClassified || 0) + (results.step6?.tasksDiscovered || 0);

        if (totalTasks > 0) {
          // Tasks need final review/approval
          await this.completeRun(runId, results, duration, null, 0, 'pending_final_review');
          this.emit('final_review_required', {
            runId,
            assetUid,
            tasksToReview: results.step6.tasksClassified,
            tasksDiscovered: results.step6.tasksDiscovered
          });
          logger.info('Final task review required', {
            runId,
            assetUid,
            tasksClassified: results.step6.tasksClassified,
            tasksDiscovered: results.step6.tasksDiscovered
          });
        } else {
          // Edge case: 0 existing + 0 discovered = no maintenance
          await this.completeRun(runId, results, duration, null, 0, 'completed');
          logger.warn('No tasks found or discovered - system has no maintenance', { runId, assetUid });
        }
      }

      this.emit('processing_complete', {
        runId,
        assetUid,
        results,
        duration,
        pendingReviews,
        reviewUrl
      });

      logger.info('System processing complete', {
        runId,
        assetUid,
        duration,
        results: Object.keys(results)
      });

      return results;

    } catch (error) {
      logger.error('Processing failed', {
        runId,
        assetUid,
        error: error.message,
        stack: error.stack
      });

      await this.failRun(runId, error);

      this.emit('processing_failed', {
        runId,
        assetUid,
        error: error.message
      });

      throw error;
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  /**
   * Execute a single step with error handling and status updates
   * @param {number} stepNum - Step number (1-6)
   * @param {string} assetUid - System asset UID
   * @param {string} runId - Run ID
   * @param {Function} stepFn - Async function to execute
   * @returns {Promise<Object>}
   */
  async executeStep(stepNum, assetUid, runId, stepFn) {
    await this.updateStatus(assetUid, stepNum, 'in_progress');
    this.emit('step_started', { runId, assetUid, step: stepNum });

    try {
      const result = await stepFn();
      await this.updateStatus(assetUid, stepNum, 'completed', result);
      this.emit('step_completed', { runId, assetUid, step: stepNum, results: result });
      return result;
    } catch (error) {
      await this.updateStatus(assetUid, stepNum, 'failed', { error: error.message });
      this.emit('step_failed', { runId, assetUid, step: stepNum, error: error.message });
      throw error;
    }
  }

  /**
   * Create a new pipeline run record
   * @param {string} runId - Run ID
   * @param {Array<string>} assetUids - Array of asset UIDs to process
   */
  async createRun(runId, assetUids) {
    const { error } = await db.client.from('pipeline_runs').insert({
      id: runId,
      initiated_by: 'user',
      trigger_type: 'manual',
      system_count: assetUids.length,
      systems_processed: assetUids,
      started_at: new Date().toISOString(),
      status: 'running',
      current_step: 1,
      current_system: assetUids[0]
    });

    if (error) {
      logger.error('Failed to create run record', { error: error.message, runId });
      throw new Error(`Failed to create run: ${error.message}`);
    }

    logger.info('Pipeline run created', { runId, systemCount: assetUids.length });
  }

  /**
   * Update processing status for a specific step
   * @param {string} assetUid - System asset UID
   * @param {number} stepNum - Step number (1-6)
   * @param {string} status - Status (in_progress, completed, failed, paused)
   * @param {Object} data - Additional data to store
   */
  async updateStatus(assetUid, stepNum, status, data = {}) {
    // Map step numbers to column name prefixes
    const stepNames = {
      1: 'step1_extract',
      2: 'step2_classify',
      3: 'step3_discover',
      4: 'step4_dedupe',
      5: 'step5_review',
      6: 'step6_boatos'
    };

    const stepName = stepNames[stepNum];
    if (!stepName) {
      throw new Error(`Invalid step number: ${stepNum}`);
    }

    const updates = {
      asset_uid: assetUid,
      [`${stepName}_status`]: status,  // e.g., step1_extract_status
      overall_status: status === 'failed' ? 'failed' : 'processing',
      updated_at: new Date().toISOString()
    };

    // Set timestamps (uses step number only, not full name)
    if (status === 'in_progress') {
      updates[`step${stepNum}_started_at`] = new Date().toISOString();
    } else if (status === 'completed') {
      updates[`step${stepNum}_completed_at`] = new Date().toISOString();
    }

    // Add step-specific data (uses step number only)
    if (data.error) {
      updates[`step${stepNum}_error`] = data.error;
    }
    if (data.tasksExtracted !== undefined) {
      updates.step1_tasks_extracted = data.tasksExtracted;
      updates.step1_tasks_skipped = data.tasksSkipped || 0;
    }
    if (data.tasksClassified !== undefined) {
      updates.step2_tasks_classified = data.tasksClassified;
      updates.step2_tasks_skipped = data.tasksSkipped || 0;
    }
    if (data.tasksDiscovered !== undefined) {
      updates.step3_tasks_discovered = data.tasksDiscovered;
    }
    if (data.duplicatePairs !== undefined) {
      updates.step4_duplicate_pairs = data.duplicatePairs;
    }
    if (data.pairs_pending !== undefined) {
      updates.step5_pairs_pending = data.pairs_pending;
    }
    if (data.pairs_reviewed !== undefined) {
      updates.step5_pairs_reviewed = data.pairs_reviewed;
    }
    if (data.tasksUploaded !== undefined) {
      updates.step6_tasks_uploaded = data.tasksUploaded;
    }

    // Get system name from systems table
    const { data: system } = await db.client
      .from('systems')
      .select('description, system_norm, manufacturer_norm, model_norm')
      .eq('asset_uid', assetUid)
      .single();

    if (system) {
      // Use description if available, otherwise build from system_norm
      updates.system_name = system.description || system.system_norm || `${system.manufacturer_norm} ${system.model_norm}`;
    }

    // Upsert status
    const { error } = await db.client
      .from('pipeline_processing_status')
      .upsert(updates, { onConflict: 'asset_uid' });

    if (error) {
      logger.error('Failed to update status', {
        error: error.message,
        assetUid,
        step: stepNum
      });
      throw new Error(`Failed to update status: ${error.message}`);
    }

    logger.debug('Status updated', { assetUid, step: stepNum, status });
  }

  /**
   * Check for pending deduplication reviews
   * @param {string} assetUid - System asset UID
   * @returns {Promise<number>} Number of pending reviews
   */
  async checkPendingReviews(assetUid) {
    const { count, error } = await db.client
      .from('deduplication_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('review_status', 'pending')
      .or(`task1_metadata->>asset_uid.eq.${assetUid},task2_metadata->>asset_uid.eq.${assetUid}`);

    if (error) {
      logger.error('Failed to check pending reviews', {
        error: error.message,
        assetUid
      });
      return 0;
    }

    return count || 0;
  }

  /**
   * Mark run as complete
   * @param {string} runId - Run ID
   * @param {Object} results - Results from all steps
   * @param {number} duration - Duration in milliseconds
   * @param {string} reviewUrl - Review URL if manual review required
   * @param {number} pendingReviews - Number of pending reviews
   * @param {string} overrideStatus - Optional status override (e.g., 'pending_final_review')
   */
  async completeRun(runId, results, duration, reviewUrl = null, pendingReviews = 0, overrideStatus = null) {
    const finalStatus = overrideStatus || (pendingReviews > 0 ? 'pending_review' : 'completed');

    const { error } = await db.client
      .from('pipeline_runs')
      .update({
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        status: finalStatus,
        total_tasks_extracted: results.step1?.tasksExtracted || 0,
        total_tasks_classified: results.step2?.tasksClassified || 0,
        total_tasks_discovered: results.step3?.tasksDiscovered || 0,
        total_duplicates_found: results.step4?.duplicatePairs || 0
      })
      .eq('id', runId);

    if (error) {
      logger.error('Failed to complete run', { error: error.message, runId });
    }

    // Update overall status
    const run = this.activeRuns.get(runId);
    if (run) {
      const statusUpdate = {
        overall_status: finalStatus,
        last_processed_at: new Date().toISOString(),
        total_processing_time_ms: duration
      };

      // Store review URL if manual review is required
      if (pendingReviews > 0 && reviewUrl) {
        statusUpdate.review_url = reviewUrl;
        statusUpdate.pending_review_count = pendingReviews;
      }

      await db.client
        .from('pipeline_processing_status')
        .update(statusUpdate)
        .eq('asset_uid', run.assetUid);
    }

    logger.info('Run completed', { runId, duration, status: finalStatus, pendingReviews });
  }

  /**
   * Mark run as failed
   * @param {string} runId - Run ID
   * @param {Error} error - Error that caused failure
   */
  async failRun(runId, error) {
    const { error: dbError } = await db.client
      .from('pipeline_runs')
      .update({
        completed_at: new Date().toISOString(),
        status: 'failed',
        errors: [{
          message: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString()
        }]
      })
      .eq('id', runId);

    if (dbError) {
      logger.error('Failed to mark run as failed', {
        error: dbError.message,
        runId
      });
    }

    // Mark system as failed
    const run = this.activeRuns.get(runId);
    if (run) {
      await db.client
        .from('pipeline_processing_status')
        .update({
          overall_status: 'failed',
          updated_at: new Date().toISOString()
        })
        .eq('asset_uid', run.assetUid);
    }

    logger.error('Run failed', { runId, error: error.message });
  }

  /**
   * Cancel an active run
   * @param {string} runId - Run ID
   */
  async cancelRun(runId) {
    const run = this.activeRuns.get(runId);
    if (!run) {
      throw new Error(`No active run with ID ${runId}`);
    }

    await db.client
      .from('pipeline_runs')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString()
      })
      .eq('id', runId);

    this.emit('processing_cancelled', { runId });
    this.activeRuns.delete(runId);

    logger.info('Run cancelled', { runId });
  }

  /**
   * Process Step 6: Classify & Discover (called independently after manual review)
   * @param {string} assetUid - System asset UID
   * @returns {Promise<Object>} Processing results
   */
  async processStep6(assetUid) {
    const runId = uuidv4();
    const startTime = Date.now();

    try {
      logger.info('Starting Step 6 (Classify & Discover)', { runId, assetUid });

      // Set overall status to processing
      await db.client
        .from('pipeline_processing_status')
        .update({ overall_status: 'processing' })
        .eq('asset_uid', assetUid);

      // Emit start event
      this.emit('step_started', { runId, assetUid, step: 6 });

      // Execute Step 6
      const result = await this.executeStep(6, assetUid, runId, async () => {
        return await executeClassifyDiscover(assetUid, {
          rateLimiter: this.rateLimiter,
          onProgress: (progress) => {
            this.emit('progress_update', { runId, assetUid, step: 6, ...progress });
          }
        });
      });

      // Set overall status to pending_final_review
      await db.client
        .from('pipeline_processing_status')
        .update({
          overall_status: 'pending_final_review',
          last_processed_at: new Date().toISOString()
        })
        .eq('asset_uid', assetUid);

      const duration = Date.now() - startTime;

      this.emit('step_completed', {
        runId,
        assetUid,
        step: 6,
        results: result,
        duration
      });

      logger.info('Step 6 complete', {
        runId,
        assetUid,
        duration,
        tasksClassified: result.tasksClassified,
        tasksDiscovered: result.tasksDiscovered
      });

      return result;

    } catch (error) {
      logger.error('Step 6 failed', {
        runId,
        assetUid,
        error: error.message,
        stack: error.stack
      });

      // Set status to failed
      await db.client
        .from('pipeline_processing_status')
        .update({
          overall_status: 'failed',
          step6_boatos_status: 'failed',
          step6_error: error.message
        })
        .eq('asset_uid', assetUid);

      this.emit('step_failed', {
        runId,
        assetUid,
        step: 6,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Get active runs
   * @returns {Array} Array of active run info
   */
  getActiveRuns() {
    return Array.from(this.activeRuns.entries()).map(([runId, data]) => ({
      runId,
      ...data
    }));
  }
}

// Export singleton instance
export const orchestrator = new PipelineOrchestrator();

export default orchestrator;
