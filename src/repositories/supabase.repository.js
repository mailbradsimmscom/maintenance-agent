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

  /**
   * Get all systems (for enriching task data)
   * @returns {Promise<Array>} All systems with asset_uid, manufacturer_norm, model_norm
   */
  async getAllSystems() {
    const { data, error } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm, system_norm');

    if (error) {
      logger.error('Failed to fetch all systems', { error: error.message });
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
      }, { onConflict: 'asset_uid' })
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

/**
 * Maintenance Tasks Index Repository
 * Fast queryable index for maintenance tasks (mirrors Pinecone metadata)
 * Used for sub-100ms todo list and approval workflow queries
 */
export const maintenanceTasksIndexRepository = {
  /**
   * Upsert a task (create or update)
   * @param {Object} task - Task data
   * @returns {Promise<Object>} Upserted task
   */
  async upsert(task) {
    const { data, error } = await supabase
      .from('maintenance_tasks_index')
      .upsert({
        id: task.id,
        asset_uid: task.asset_uid,
        description: task.description,
        system_name: task.system_name,
        frequency_basis: task.frequency_basis,
        frequency_value: task.frequency_value,
        is_recurring: task.is_recurring ?? true,
        next_due_hours: task.next_due_hours,
        next_due_date: task.next_due_date,
        review_status: task.review_status || 'pending',
        last_completed_at: task.last_completed_at,
        completion_count: task.completion_count || 0,
        task_category: task.task_category,
        criticality: task.criticality,
        confidence: task.confidence,
        source_step: task.source_step,
        source_type: task.source_type,
        synced_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to upsert task to index', { taskId: task.id, error: error.message });
      throw error;
    }

    logger.info('Task upserted to index', { taskId: task.id });
    return data;
  },

  /**
   * Update specific fields of a task
   * @param {string} taskId - Task ID
   * @param {Object} fields - Fields to update
   * @returns {Promise<Object>} Updated task
   */
  async update(taskId, fields) {
    const { data, error } = await supabase
      .from('maintenance_tasks_index')
      .update({
        ...fields,
        synced_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update task in index', { taskId, error: error.message });
      throw error;
    }

    logger.info('Task updated in index', { taskId, fields: Object.keys(fields) });
    return data;
  },

  /**
   * Delete a task
   * @param {string} taskId - Task ID
   * @returns {Promise<void>}
   */
  async delete(taskId) {
    const { error } = await supabase
      .from('maintenance_tasks_index')
      .delete()
      .eq('id', taskId);

    if (error) {
      logger.error('Failed to delete task from index', { taskId, error: error.message });
      throw error;
    }

    logger.info('Task deleted from index', { taskId });
  },

  /**
   * Get a single task by ID
   * @param {string} taskId - Task ID
   * @returns {Promise<Object|null>} Task or null
   */
  async getById(taskId) {
    const { data, error } = await supabase
      .from('maintenance_tasks_index')
      .select('*')
      .eq('id', taskId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to get task by ID', { taskId, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get approved tasks that are due or due soon
   * FAST QUERY: Uses idx_tasks_approved_due_* indexes
   * @param {number|null} currentHours - Current operating hours (for usage-based tasks)
   * @returns {Promise<Array>} Approved tasks that are due
   */
  async getApprovedDueTasks(currentHours = null) {
    const now = new Date().toISOString();

    // Query both usage-based and calendar-based tasks
    // Note: We fetch all approved tasks and filter in-memory for "due soon" logic
    // This is necessary because "due soon" threshold varies by frequency
    const { data, error } = await supabase
      .from('maintenance_tasks_index')
      .select('*')
      .eq('review_status', 'approved')
      .or(
        currentHours !== null
          ? `and(frequency_basis.eq.usage,next_due_hours.lte.${currentHours + 200}),and(frequency_basis.eq.calendar,next_due_date.lte.${now})`
          : `frequency_basis.eq.calendar,next_due_date.lte.${now}`
      );

    if (error) {
      logger.error('Failed to get approved due tasks', { currentHours, error: error.message });
      throw error;
    }

    logger.info('Fetched approved due tasks', {
      count: data?.length || 0,
      currentHours,
    });

    return data || [];
  },

  /**
   * Get pending tasks for approval workflow
   * FAST QUERY: Uses idx_tasks_pending_review index
   * @param {string|null} assetUid - Optional filter by system
   * @param {number} limit - Max number of tasks
   * @returns {Promise<Array>} Pending tasks
   */
  async getPendingTasks(assetUid = null, limit = 50) {
    let query = supabase
      .from('maintenance_tasks_index')
      .select('*')
      .eq('review_status', 'pending')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (assetUid) {
      query = query.eq('asset_uid', assetUid);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to get pending tasks', { assetUid, limit, error: error.message });
      throw error;
    }

    logger.info('Fetched pending tasks', {
      count: data?.length || 0,
      assetUid,
    });

    return data || [];
  },

  /**
   * Get all task IDs (for reconciliation)
   * @returns {Promise<Array<string>>} Array of task IDs
   */
  async getAllTaskIds() {
    const { data, error } = await supabase
      .from('maintenance_tasks_index')
      .select('id');

    if (error) {
      logger.error('Failed to get all task IDs', { error: error.message });
      throw error;
    }

    return (data || []).map(row => row.id);
  },

  /**
   * Get tasks by asset UID
   * FAST QUERY: Uses idx_tasks_by_asset index
   * @param {string} assetUid - System asset UID
   * @param {string|null} status - Optional filter by review_status
   * @returns {Promise<Array>} Tasks for the system
   */
  async getTasksByAsset(assetUid, status = null) {
    let query = supabase
      .from('maintenance_tasks_index')
      .select('*')
      .eq('asset_uid', assetUid);

    if (status) {
      query = query.eq('review_status', status);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to get tasks by asset', { assetUid, status, error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Get count by status (for metrics)
   * @returns {Promise<Object>} Count by status: { pending, approved, rejected }
   */
  async getCountsByStatus() {
    const { data, error } = await supabase
      .from('maintenance_tasks_index')
      .select('review_status');

    if (error) {
      logger.error('Failed to get counts by status', { error: error.message });
      throw error;
    }

    const counts = {
      pending: 0,
      approved: 0,
      rejected: 0,
    };

    (data || []).forEach(row => {
      if (counts[row.review_status] !== undefined) {
        counts[row.review_status]++;
      }
    });

    return counts;
  },
};

/**
 * Sync Errors Repository
 * Tracks sync failures between Pinecone and Supabase
 */
export const syncErrorsRepository = {
  /**
   * Log a sync error
   * @param {Object} errorData - Error details
   * @returns {Promise<Object>} Created error record
   */
  async logError(errorData) {
    const { data, error } = await supabase
      .from('sync_errors')
      .insert({
        task_id: errorData.taskId,
        operation: errorData.operation,
        error_message: errorData.errorMessage,
        error_stack: errorData.errorStack,
        pinecone_success: errorData.pineconeSuccess,
        supabase_success: errorData.supabaseSuccess,
        retry_count: errorData.retryCount || 0,
      })
      .select()
      .single();

    if (error) {
      // Don't throw - this is a logging function
      logger.error('Failed to log sync error', { errorData, error: error.message });
      return null;
    }

    return data;
  },

  /**
   * Get unresolved errors
   * @param {number} limit - Max number of errors
   * @returns {Promise<Array>} Unresolved sync errors
   */
  async getUnresolvedErrors(limit = 100) {
    const { data, error } = await supabase
      .from('sync_errors')
      .select('*')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to get unresolved errors', { error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Mark error as resolved
   * @param {string} errorId - Error ID
   * @param {string} resolvedBy - Who/what resolved it
   * @param {string|null} notes - Optional notes
   * @returns {Promise<Object>} Updated error
   */
  async resolveError(errorId, resolvedBy, notes = null) {
    const { data, error } = await supabase
      .from('sync_errors')
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedBy,
        resolution_notes: notes,
      })
      .eq('id', errorId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to resolve error', { errorId, error: error.message });
      throw error;
    }

    logger.info('Sync error resolved', { errorId, resolvedBy });
    return data;
  },

  /**
   * Bulk resolve errors for a task
   * @param {string} taskId - Task ID
   * @param {string} resolvedBy - Who/what resolved it
   * @param {string|null} notes - Optional notes
   * @returns {Promise<number>} Count of resolved errors
   */
  async resolveTaskErrors(taskId, resolvedBy, notes = null) {
    const { data, error } = await supabase
      .from('sync_errors')
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedBy,
        resolution_notes: notes,
      })
      .eq('task_id', taskId)
      .is('resolved_at', null)
      .select();

    if (error) {
      logger.error('Failed to resolve task errors', { taskId, error: error.message });
      throw error;
    }

    const count = data?.length || 0;
    logger.info('Task sync errors resolved', { taskId, count, resolvedBy });
    return count;
  },
};

// Export all repositories as a single object for convenience
export default {
  client: supabase,  // Raw Supabase client for direct queries
  systems: systemsRepository,
  tasks: maintenanceTasksRepository,
  memory: agentMemoryRepository,
  chunks: documentChunksRepository,
  tasksIndex: maintenanceTasksIndexRepository,
  syncErrors: syncErrorsRepository,
};