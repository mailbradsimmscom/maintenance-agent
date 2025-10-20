/**
 * System Processor Job
 * Main job for processing systems and extracting maintenance tasks
 */

import db from '../repositories/supabase.repository.js';
import { extractionService } from '../services/extraction.service.js';
import { discoveryService } from '../services/discovery.service.js';
import { deduplicationService } from '../services/deduplication.service.js';
import { openaiRepository } from '../repositories/openai.repository.js';
import { getConfig } from '../config/env.js';
import { createLogger, agentLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('system-processor-job');

export const systemProcessorJob = {
  /**
   * Check for and process new systems
   * @returns {Promise<void>}
   */
  async checkForNewSystems() {
    logger.info('Starting system check');

    try {
      // Get unprocessed systems
      const systems = await db.systems.getUnprocessedSystems(config.agent.batchSize);

      if (!systems || systems.length === 0) {
        logger.info('No new systems to process');
        return;
      }

      logger.info(`Found ${systems.length} systems to process`);

      // Process each system
      for (const system of systems) {
        await this.processSystem(system);
      }

      logger.info('System check completed');
    } catch (error) {
      agentLogger.error('System check failed', error);
    }
  },

  /**
   * Process a single system
   * @param {Object} system - System to process
   * @returns {Promise<void>}
   */
  async processSystem(system) {
    // Create a display name from available fields
    const systemName = system.description ||
      `${system.manufacturer_norm || ''} ${system.model_norm || ''}`.trim() ||
      system.asset_uid;

    logger.info(`Processing system: ${systemName}`, { assetUid: system.asset_uid });

    try {
      // Update processing status
      await db.memory.upsertMemory(system.asset_uid, {
        processing_status: 'in_progress',
        processing_stage: 'extraction',
      });

      // 1. Extract from manuals
      agentLogger.extractionStarted(system.asset_uid, 'manual');
      const manualTasks = await extractionService.extractFromManuals(system);
      agentLogger.extractionCompleted(system.asset_uid, 'manual', manualTasks.length);

      // 2. Search real-world sources
      agentLogger.extractionStarted(system.asset_uid, 'real_world');
      const realWorldTasks = await discoveryService.searchRealWorld(system);
      agentLogger.extractionCompleted(system.asset_uid, 'real_world', realWorldTasks.length);

      // 3. Infer dependencies
      agentLogger.extractionStarted(system.asset_uid, 'dependencies');
      const inferredTasks = await discoveryService.inferDependencies(system);
      agentLogger.extractionCompleted(system.asset_uid, 'dependencies', inferredTasks.length);

      // 4. Combine all tasks
      const allTasks = [...manualTasks, ...realWorldTasks, ...inferredTasks];

      // 5. Deduplicate tasks
      const uniqueTasks = deduplicationService.deduplicateTasks(allTasks, system.asset_uid);

      // 6. Score task confidence if not already scored
      for (const task of uniqueTasks) {
        if (!task.confidence) {
          task.confidence = await openaiRepository.scoreTaskConfidence(task, {
            systemName,
          });
        }
      }

      // 7. Filter by confidence threshold
      const confidentTasks = uniqueTasks.filter(
        task => task.confidence >= config.agent.confidenceThreshold
      );

      // 8. Queue tasks for review
      let queuedCount = 0;
      for (const task of confidentTasks) {
        await this.queueTaskForReview(system.asset_uid, task);
        queuedCount++;
      }

      // 9. Mark system as processed
      await db.memory.markSystemProcessed(system.asset_uid, {
        manual_tasks_count: manualTasks.length,
        realworld_tasks_count: realWorldTasks.length,
        inferred_tasks_count: inferredTasks.length,
        total_tasks_found: allTasks.length,
        tasks_queued: queuedCount,
        processing_stage: 'completed',
      });

      agentLogger.systemProcessed(system.asset_uid, queuedCount);

      // 10. Discover related systems (optional)
      const relatedSystems = await discoveryService.discoverRelatedSystems(system);
      if (relatedSystems.length > 0) {
        logger.info('Related systems discovered', {
          assetUid: system.asset_uid,
          related: relatedSystems,
        });
        // TODO: Store related systems for user notification
      }

    } catch (error) {
      agentLogger.error(`Failed to process system ${systemName}`, error, {
        assetUid: system.asset_uid,
      });

      // Mark as failed
      await db.memory.upsertMemory(system.asset_uid, {
        processing_status: 'failed',
        processing_stage: 'error',
        last_error: error.message,
      });
    }
  },

  /**
   * Queue a task for review
   * @param {string} assetUid - System asset UID
   * @param {Object} task - Task to queue
   * @returns {Promise<void>}
   */
  async queueTaskForReview(assetUid, task) {
    try {
      // Check if task already exists
      if (await db.tasks.taskExists(task.extraction_hash)) {
        logger.debug('Task already queued, skipping', {
          assetUid,
          hash: task.extraction_hash,
        });
        return;
      }

      // Queue the task
      const queuedTask = await db.tasks.queueTask({
        asset_uid: assetUid,
        task_description: task.description,
        frequency_type: task.frequency_type,
        frequency_value: task.frequency_value,
        source: Array.isArray(task.source) ? task.source.join(',') : task.source,
        source_details: task.source_details || {},
        confidence_score: task.confidence || 0.5,
        status: 'pending',
        extraction_hash: task.extraction_hash,
        parts_required: task.parts_required || [],
        criticality: task.criticality || 'routine',
        estimated_duration_hours: task.estimated_duration_hours,
      });

      agentLogger.taskQueued(queuedTask.id, assetUid, task.confidence);
    } catch (error) {
      logger.error('Failed to queue task', {
        assetUid,
        task: task.description,
        error: error.message,
      });
    }
  },
};

export default systemProcessorJob;