/**
 * Pipeline Processing Routes
 * Phase 1: Manual Mode - User triggers processing via UI
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../../repositories/supabase.repository.js';
import { pineconeRepository } from '../../repositories/pinecone.repository.js';
import deduplicationReviewRepository from '../../repositories/deduplication-review.repository.js';
import logger from '../../utils/logger.js';
import { orchestrator } from '../../services/pipeline-orchestrator.service.js';

const router = express.Router();

/**
 * GET /api/pipeline/systems
 * Get all systems from pinecone_search_results with processing status
 *
 * Query params:
 * - page: page number (default: 1)
 * - limit: items per page (default: 50)
 * - status: filter by overall_status (optional)
 * - search: search by system_name (optional)
 */
router.get('/systems', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      status = null,
      search = null
    } = req.query;

    logger.info('Fetching systems for pipeline status page', {
      page,
      limit,
      status,
      search
    });

    // Step 1: Get unique systems from documents table (systems with uploaded manuals)
    const { data: documentsRecords, error: documentsError } = await db.client
      .from('documents')
      .select('asset_uid');

    if (documentsError) {
      logger.error('Failed to fetch from documents', {
        error: documentsError.message
      });
      throw documentsError;
    }

    // Step 2: Get unique asset_uids
    const uniqueAssetUids = [...new Set(documentsRecords.map(d => d.asset_uid).filter(Boolean))];

    logger.info(`Found ${uniqueAssetUids.length} unique systems with documents`);

    // Step 3: Get system details from systems table
    const { data: systemsRecords, error: systemsError } = await db.client
      .from('systems')
      .select('asset_uid, description, manufacturer_norm, model_norm')
      .in('asset_uid', uniqueAssetUids);

    if (systemsError) {
      logger.error('Failed to fetch from systems', {
        error: systemsError.message
      });
      throw systemsError;
    }

    let systems = systemsRecords.map(s => ({
      asset_uid: s.asset_uid,
      system_name: s.description || `${s.manufacturer_norm} ${s.model_norm}`,
      manufacturer: s.manufacturer_norm,
      model: s.model_norm
    }));

    logger.info(`Found ${systems.length} systems with details`);

    // Step 3: Get ALL processing statuses in one query (avoid N+1)
    const { data: allStatuses, error: statusesError } = await db.client
      .from('pipeline_processing_status')
      .select('*')
      .in('asset_uid', uniqueAssetUids);

    if (statusesError) {
      logger.error('Failed to fetch processing statuses', {
        error: statusesError.message
      });
      throw statusesError;
    }

    // Create a Map for O(1) lookups
    const statusMap = new Map(allStatuses?.map(s => [s.asset_uid, s]) || []);

    // Step 4: Join statuses with systems in memory
    const defaultStatus = {
      overall_status: 'not_started',
      step1_extract_status: 'not_started',
      step2_classify_status: 'not_started',
      step3_discover_status: 'not_started',
      step4_dedupe_status: 'not_started',
      step5_review_status: 'not_started',
      step6_boatos_status: 'not_started',
      last_processed_at: null
    };

    for (const system of systems) {
      system.processing_status = statusMap.get(system.asset_uid) || defaultStatus;
    }

    // Step 5: Apply filters
    if (status) {
      systems = systems.filter(s => s.processing_status.overall_status === status);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      systems = systems.filter(s =>
        s.system_name.toLowerCase().includes(searchLower)
      );
    }

    // Step 6: Sort by last processed (most recent first), then by name
    systems.sort((a, b) => {
      const aProcessed = a.processing_status.last_processed_at;
      const bProcessed = b.processing_status.last_processed_at;

      if (aProcessed && bProcessed) {
        return new Date(bProcessed) - new Date(aProcessed);
      }
      if (aProcessed && !bProcessed) return -1;
      if (!aProcessed && bProcessed) return 1;

      return a.system_name.localeCompare(b.system_name);
    });

    // Step 7: Pagination
    const total = systems.length;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paginatedSystems = systems.slice(offset, offset + parseInt(limit));

    logger.info('Returning systems list', {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      returned: paginatedSystems.length
    });

    res.json({
      success: true,
      data: {
        systems: paginatedSystems,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: total,
          pages: Math.ceil(total / parseInt(limit))
        }
      },
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to get system statuses', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve systems',
      message: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/pipeline/systems/:assetUid
 * Get detailed status for a specific system
 */
router.get('/systems/:assetUid', async (req, res) => {
  try {
    const { assetUid } = req.params;

    logger.info('Fetching detailed status for system', { assetUid });

    // Get system info
    const { data: system, error: systemError } = await db.client
      .from('systems')
      .select('*')
      .eq('asset_uid', assetUid)
      .single();

    if (systemError) {
      throw new Error(`System not found: ${systemError.message}`);
    }

    // Get processing status
    const { data: status, error: statusError } = await db.client
      .from('pipeline_processing_status')
      .select('*')
      .eq('asset_uid', assetUid)
      .single();

    if (statusError && statusError.code !== 'PGRST116') {
      throw new Error(`Failed to get status: ${statusError.message}`);
    }

    res.json({
      success: true,
      data: {
        system,
        status: status || { overall_status: 'not_started' }
      },
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to get system details', {
      error: error.message,
      assetUid: req.params.assetUid
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve system details',
      message: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/pipeline/process
 * Start processing selected systems (Manual Mode)
 *
 * Body:
 * {
 *   "systems": ["asset_uid_1", "asset_uid_2", ...]
 * }
 */
router.post('/process', async (req, res) => {
  try {
    const { systems } = req.body;

    if (!systems || !Array.isArray(systems) || systems.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        message: 'Please provide an array of system asset_uids',
        requestId: res.locals.requestId
      });
    }

    logger.info('Starting pipeline processing', {
      systemCount: systems.length,
      systems
    });

    // Validate all systems exist (systems table might not have system_name)
    const { data: validSystems, error: validationError } = await db.client
      .from('systems')
      .select('asset_uid')
      .in('asset_uid', systems);

    if (validationError) {
      throw validationError;
    }

    if (validSystems.length !== systems.length) {
      const found = validSystems.map(s => s.asset_uid);
      const missing = systems.filter(s => !found.includes(s));

      return res.status(400).json({
        success: false,
        error: 'Invalid systems',
        message: `The following system IDs were not found: ${missing.join(', ')}`,
        requestId: res.locals.requestId
      });
    }

    // Get system names from pinecone_search_results for display
    const { data: systemsWithNames } = await db.client
      .from('pinecone_search_results')
      .select('asset_uid, system_name')
      .in('asset_uid', systems);

    const systemsMap = new Map(systemsWithNames?.map(s => [s.asset_uid, s]) || []);
    const systemsList = systems.map(uid => systemsMap.get(uid) || { asset_uid: uid, system_name: 'Unknown' });

    // Start processing via PipelineOrchestrator (in background)
    logger.info('Starting pipeline processing via orchestrator', {
      systemCount: systems.length
    });

    // Process systems sequentially in background
    // We don't await here - return immediately and let WebSocket provide updates
    Promise.all(
      systems.map(assetUid =>
        orchestrator.processSystem(assetUid)
          .catch(error => {
            logger.error(`Failed to process ${assetUid}`, {
              error: error.message,
              assetUid
            });
            return { error: error.message, assetUid };
          })
      )
    ).then(results => {
      const failures = results.filter(r => r.error);
      logger.info('Pipeline processing batch completed', {
        total: systems.length,
        succeeded: results.length - failures.length,
        failed: failures.length
      });
    });

    res.json({
      success: true,
      data: {
        message: `Processing started for ${systems.length} system(s)`,
        systems: systemsList,
        note: 'Monitor progress via WebSocket connection'
      },
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to start processing', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Failed to start processing',
      message: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/pipeline/runs
 * Get history of pipeline runs
 */
router.get('/runs', async (req, res) => {
  try {
    const { limit = 20, status = null } = req.query;

    logger.info('Fetching pipeline runs', { limit, status });

    let query = db.client
      .from('pipeline_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(parseInt(limit));

    if (status) {
      query = query.eq('status', status);
    }

    const { data: runs, error } = await query;

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: {
        runs,
        count: runs.length
      },
      requestId: res.locals.requestId
    });
  } catch (error) {
    logger.error('Failed to get pipeline runs', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve pipeline runs',
      message: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/pipeline/check-and-advance/:assetUid
 * Check status and advance pipeline if ready
 * - If pending_review + all duplicates cleared → Run Step 6
 * - If pending_final_review + final_review_completed → Set to completed
 */
router.post('/check-and-advance/:assetUid', async (req, res) => {
  try {
    const { assetUid } = req.params;

    logger.info('Checking pipeline status for advancement', { assetUid });

    // Get current status
    const { data: status, error: statusError } = await db.client
      .from('pipeline_processing_status')
      .select('*')
      .eq('asset_uid', assetUid)
      .single();

    if (statusError || !status) {
      return res.status(404).json({
        success: false,
        error: 'System not found or not processed',
        requestId: res.locals.requestId
      });
    }

    let action = null;
    let result = null;

    // Check A: pending_review + all duplicates cleared → Run Step 6
    if (status.overall_status === 'pending_review') {
      // Count pending duplicate reviews using repository
      const count = await deduplicationReviewRepository.getPendingReviewCountForAsset(assetUid);

      if (count === 0) {
        action = 'run_step_6';
        logger.info('All duplicates cleared, running Step 6', { assetUid });

        // Run Step 6 in background (don't wait)
        orchestrator.processStep6(assetUid).catch(error => {
          logger.error('Step 6 failed', { assetUid, error: error.message });
        });

        result = {
          action: 'step_6_started',
          message: 'Classification and discovery started',
          pendingReviews: 0
        };
      } else {
        result = {
          action: 'none',
          message: 'Duplicate reviews still pending',
          pendingReviews: count
        };
      }
    }
    // Check B: pending_final_review + all tasks reviewed → Set to completed
    else if (status.overall_status === 'pending_final_review') {
      // Count pending tasks in Pinecone
      const pendingTasksCount = await pineconeRepository.countPendingTasksForAsset(assetUid);

      if (pendingTasksCount === 0) {
        action = 'mark_completed';
        logger.info('All tasks reviewed, marking as done', { assetUid });

        await db.client
          .from('pipeline_processing_status')
          .update({
            overall_status: 'completed',
            last_processed_at: new Date().toISOString()
          })
          .eq('asset_uid', assetUid);

        result = {
          action: 'completed',
          message: 'System processing complete! All tasks reviewed.'
        };
      } else {
        result = {
          action: 'none',
          message: `${pendingTasksCount} task${pendingTasksCount !== 1 ? 's' : ''} still need review`,
          pendingTasksCount
        };
      }
    }
    // No action needed
    else {
      result = {
        action: 'none',
        message: `System status is ${status.overall_status}, no action needed`,
        currentStatus: status.overall_status
      };
    }

    res.json({
      success: true,
      data: result,
      requestId: res.locals.requestId
    });

  } catch (error) {
    logger.error('Failed to check and advance pipeline', {
      error: error.message,
      assetUid: req.params.assetUid
    });
    res.status(500).json({
      success: false,
      error: 'Failed to check pipeline status',
      message: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/pipeline/mark-review-complete/:assetUid
 * Mark final review as complete
 */
router.post('/mark-review-complete/:assetUid', async (req, res) => {
  try {
    const { assetUid } = req.params;

    logger.info('Marking final review as complete', { assetUid });

    // Update status
    const { error } = await db.client
      .from('pipeline_processing_status')
      .update({
        final_review_completed: true,
        updated_at: new Date().toISOString()
      })
      .eq('asset_uid', assetUid);

    if (error) {
      throw error;
    }

    logger.info('Final review marked complete', { assetUid });

    res.json({
      success: true,
      data: {
        message: 'Final review marked as complete',
        assetUid
      },
      requestId: res.locals.requestId
    });

  } catch (error) {
    logger.error('Failed to mark review complete', {
      error: error.message,
      assetUid: req.params.assetUid
    });
    res.status(500).json({
      success: false,
      error: 'Failed to mark review complete',
      message: error.message,
      requestId: res.locals.requestId
    });
  }
});

export default router;
