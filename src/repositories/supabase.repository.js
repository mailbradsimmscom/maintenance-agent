/**
 * Supabase Repository
 * All database operations for the maintenance agent
 */

import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('supabase-repository');

// Initialize Supabase client
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey
);

export const systemsRepository = {
  /**
   * Get systems that need processing
   * @param {number} limit - Number of systems to fetch
   * @returns {Promise<Array>} Systems with their maintenance memory
   */
  async getUnprocessedSystems(limit = 5) {
    // First approach: Get all systems and filter in memory
    // This works better with left join behavior
    const { data, error } = await supabase
      .from('systems')
      .select(`
        *,
        maintenance_agent_memory!left (
          last_manual_extraction,
          last_realworld_search,
          manual_tasks_count,
          processing_status
        )
      `)
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch unprocessed systems', { error: error.message });
      throw error;
    }

    // Filter for systems that haven't been processed or failed
    const unprocessed = (data || []).filter(system => {
      const memory = system.maintenance_agent_memory?.[0];
      return !memory || memory.processing_status !== 'completed';
    });

    return unprocessed;
  },

  /**
   * Get a single system by asset_uid
   * @param {string} assetUid - The system's asset UID
   * @returns {Promise<Object>} System details
   */
  async getSystemById(assetUid) {
    const { data, error } = await supabase
      .from('systems')
      .select('*')
      .eq('asset_uid', assetUid)
      .single();

    if (error) {
      logger.error('Failed to fetch system', { assetUid, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get documents associated with a system
   * @param {string} assetUid - The system's asset UID
   * @returns {Promise<Array>} Documents for the system
   */
  async getSystemDocuments(assetUid) {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('asset_uid', assetUid);

    if (error) {
      logger.error('Failed to fetch system documents', { assetUid, error: error.message });
      throw error;
    }

    return data || [];
  },
};

export const maintenanceTasksRepository = {
  /**
   * Check if a task already exists
   * @param {string} extractionHash - Hash of the task for deduplication
   * @returns {Promise<boolean>} True if task exists
   */
  async taskExists(extractionHash) {
    const { data, error } = await supabase
      .from('maintenance_tasks_queue')
      .select('id')
      .eq('extraction_hash', extractionHash)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      logger.error('Failed to check task existence', { extractionHash, error: error.message });
      throw error;
    }

    return !!data;
  },

  /**
   * Queue a new maintenance task
   * @param {Object} task - Task details
   * @returns {Promise<Object>} Created task
   */
  async queueTask(task) {
    const { data, error } = await supabase
      .from('maintenance_tasks_queue')
      .insert(task)
      .select()
      .single();

    if (error) {
      logger.error('Failed to queue task', { task, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get pending tasks for review
   * @param {number} limit - Number of tasks to fetch
   * @returns {Promise<Array>} Pending tasks
   */
  async getPendingTasks(limit = 10) {
    const { data, error } = await supabase
      .from('maintenance_tasks_queue')
      .select('*')
      .eq('status', 'pending')
      .order('confidence_score', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch pending tasks', { error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Update task status
   * @param {string} taskId - Task ID
   * @param {string} status - New status
   * @param {Object} additionalData - Additional data to update
   * @returns {Promise<Object>} Updated task
   */
  async updateTaskStatus(taskId, status, additionalData = {}) {
    const { data, error } = await supabase
      .from('maintenance_tasks_queue')
      .update({ status, ...additionalData, updated_at: new Date().toISOString() })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update task status', { taskId, status, error: error.message });
      throw error;
    }

    return data;
  },
};

export const agentMemoryRepository = {
  /**
   * Get agent memory for a system
   * @param {string} assetUid - The system's asset UID
   * @returns {Promise<Object|null>} Agent memory or null
   */
  async getMemory(assetUid) {
    const { data, error } = await supabase
      .from('maintenance_agent_memory')
      .select('*')
      .eq('asset_uid', assetUid)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to fetch agent memory', { assetUid, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Update or create agent memory
   * @param {string} assetUid - The system's asset UID
   * @param {Object} memoryData - Memory data to store
   * @returns {Promise<Object>} Updated memory
   */
  async upsertMemory(assetUid, memoryData) {
    const { data, error } = await supabase
      .from('maintenance_agent_memory')
      .upsert({
        asset_uid: assetUid,
        ...memoryData,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to upsert agent memory', { assetUid, memoryData, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Mark system as processed
   * @param {string} assetUid - The system's asset UID
   * @param {Object} processingResults - Results of processing
   * @returns {Promise<Object>} Updated memory
   */
  async markSystemProcessed(assetUid, processingResults = {}) {
    return this.upsertMemory(assetUid, {
      last_manual_extraction: new Date().toISOString(),
      processing_status: 'completed',
      ...processingResults,
    });
  },
};

export const documentChunksRepository = {
  /**
   * Get document chunks for a document
   * @param {string} docId - Document ID
   * @param {number} limit - Number of chunks to fetch
   * @returns {Promise<Array>} Document chunks
   */
  async getChunksForDocument(docId, limit = 100) {
    const { data, error } = await supabase
      .from('document_chunks')
      .select('*')
      .eq('doc_id', docId)
      .order('chunk_index', { ascending: true })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch document chunks', { docId, error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Search chunks by content
   * @param {string} query - Search query
   * @param {string} assetUid - Optional system filter
   * @returns {Promise<Array>} Matching chunks
   */
  async searchChunks(query, assetUid = null) {
    let queryBuilder = supabase
      .from('document_chunks')
      .select('*')
      .textSearch('text', query, {
        type: 'websearch',
        config: 'english',
      });

    if (assetUid) {
      // Join with documents to filter by asset_uid
      queryBuilder = queryBuilder.eq('documents.asset_uid', assetUid);
    }

    const { data, error } = await queryBuilder.limit(20);

    if (error) {
      logger.error('Failed to search chunks', { query, assetUid, error: error.message });
      throw error;
    }

    return data || [];
  },
};

// Export all repositories as a single object for convenience
export default {
  systems: systemsRepository,
  tasks: maintenanceTasksRepository,
  memory: agentMemoryRepository,
  chunks: documentChunksRepository,
};