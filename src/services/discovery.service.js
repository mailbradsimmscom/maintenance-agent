/**
 * Discovery Service
 * Searches real-world sources and infers dependencies
 */

import { openaiRepository } from '../repositories/openai.repository.js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('discovery-service');

export const discoveryService = {
  /**
   * Search real-world sources for maintenance knowledge
   * @param {Object} system - System to research
   * @returns {Promise<Array>} Maintenance tasks from real-world knowledge
   */
  async searchRealWorld(system) {
    // Check if feature is enabled
    if (!config.features.realWorldSearch) {
      logger.debug('Real-world search disabled');
      return [];
    }

    try {
      logger.info('Starting real-world search', { assetUid: system.asset_uid });

      const result = await openaiRepository.searchRealWorldMaintenance(system);

      // Format tasks with source information
      const tasks = (result.tasks || []).map(task => ({
        ...task,
        source: 'real_world',
        source_details: {
          method: 'llm_knowledge',
          related_systems: result.related_systems || [],
        },
      }));

      logger.info('Real-world search completed', {
        assetUid: system.asset_uid,
        taskCount: tasks.length,
        relatedSystems: result.related_systems?.length || 0,
      });

      return tasks;
    } catch (error) {
      logger.error('Real-world search failed', {
        assetUid: system.asset_uid,
        error: error.message,
      });
      return [];
    }
  },

  /**
   * Infer hidden dependencies and their maintenance
   * @param {Object} system - System to analyze
   * @returns {Promise<Array>} Inferred maintenance tasks
   */
  async inferDependencies(system) {
    // Check if feature is enabled
    if (!config.features.dependencyInference) {
      logger.debug('Dependency inference disabled');
      return [];
    }

    try {
      logger.info('Starting dependency inference', { assetUid: system.asset_uid });

      const result = await openaiRepository.inferDependencies(system);

      // Flatten dependency tasks
      const tasks = [];
      for (const dep of result.dependencies || []) {
        for (const task of dep.maintenance_tasks || []) {
          tasks.push({
            ...task,
            description: `[${dep.component}] ${task.description}`,
            source: 'inferred',
            source_details: {
              component: dep.component,
              relationship: dep.relationship,
              inference_method: 'dependency_analysis',
            },
            confidence: task.confidence || 0.7,
          });
        }
      }

      logger.info('Dependency inference completed', {
        assetUid: system.asset_uid,
        dependencyCount: result.dependencies?.length || 0,
        taskCount: tasks.length,
      });

      return tasks;
    } catch (error) {
      logger.error('Dependency inference failed', {
        assetUid: system.asset_uid,
        error: error.message,
      });
      return [];
    }
  },

  /**
   * Discover related systems that might need tracking
   * @param {Object} system - Current system
   * @returns {Promise<Array>} Suggested related systems
   */
  async discoverRelatedSystems(system) {
    try {
      logger.debug('Discovering related systems', { assetUid: system.asset_uid });

      // Get from real-world search results
      const result = await openaiRepository.searchRealWorldMaintenance(system);
      const relatedSystems = result.related_systems || [];

      // Get from dependency inference
      const dependencies = await openaiRepository.inferDependencies(system);
      const depComponents = dependencies.dependencies?.map(d => d.component) || [];

      // Combine and deduplicate
      const allSystems = [...new Set([...relatedSystems, ...depComponents])];

      logger.info('Related systems discovered', {
        assetUid: system.asset_uid,
        relatedCount: allSystems.length,
        systems: allSystems,
      });

      return allSystems;
    } catch (error) {
      logger.error('Failed to discover related systems', {
        assetUid: system.asset_uid,
        error: error.message,
      });
      return [];
    }
  },
};

export default discoveryService;