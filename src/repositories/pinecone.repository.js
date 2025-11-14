/**
 * Pinecone Repository
 * Vector search operations for the maintenance agent
 *
 * HYBRID SYNC ARCHITECTURE:
 * - Pinecone = source of truth for embeddings and search
 * - Supabase = source of truth for filtering and queries
 * - All write operations dual-write to both systems
 * - Retry logic (3x with exponential backoff) for Supabase sync
 * - Sync errors logged to sync_errors table for reconciliation
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import {
  maintenanceTasksIndexRepository,
  syncErrorsRepository
} from './supabase.repository.js';

const config = getConfig();
const logger = createLogger('pinecone-repository');

// Initialize Pinecone client (v2+ doesn't need environment for serverless)
const pinecone = new Pinecone({
  apiKey: config.pinecone.apiKey,
});

// Get the index (recreate each time to avoid cache issues)
async function getIndex() {
  // Pinecone v2+ - use index name only, SDK handles host resolution
  logger.info('Getting Pinecone index', { indexName: config.pinecone.indexName });
  return pinecone.index(config.pinecone.indexName);
}

/**
 * Sync helper: Retry sync operation to Supabase with exponential backoff
 * @param {string} operation - Operation type ('upsert', 'update', 'delete')
 * @param {Function} syncFn - Async function to execute
 * @param {string} taskId - Task ID for logging
 * @param {number} maxRetries - Max retry attempts
 * @returns {Promise<boolean>} True if successful, false if all retries failed
 */
async function syncToSupabaseWithRetry(operation, syncFn, taskId, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await syncFn();
      logger.info('Supabase sync successful', { taskId, operation, attempt });
      return true;
    } catch (error) {
      logger.warn('Supabase sync attempt failed', {
        taskId,
        operation,
        attempt,
        error: error.message
      });

      if (attempt === maxRetries) {
        // Log permanent failure to sync_errors table
        await logSyncError(taskId, operation, error, true, false);
        logger.error('Supabase sync failed after retries', {
          taskId,
          operation,
          maxRetries,
          error: error.message
        });
        return false;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      logger.debug('Retrying sync after delay', { taskId, delayMs });
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return false;
}

/**
 * Log sync error to sync_errors table
 * @param {string} taskId - Task ID
 * @param {string} operation - Operation type
 * @param {Error} error - Error object
 * @param {boolean} pineconeSuccess - Did Pinecone operation succeed?
 * @param {boolean} supabaseSuccess - Did Supabase operation succeed?
 */
async function logSyncError(taskId, operation, error, pineconeSuccess, supabaseSuccess) {
  try {
    await syncErrorsRepository.logError({
      taskId,
      operation,
      errorMessage: error.message,
      errorStack: error.stack,
      pineconeSuccess,
      supabaseSuccess,
      retryCount: 3
    });
  } catch (logError) {
    // Don't throw - this is a best-effort logging function
    logger.error('Failed to log sync error', {
      taskId,
      operation,
      logError: logError.message
    });
  }
}

export const pineconeRepository = {
  /**
   * Query vectors for similar content
   * @param {Array<number>} queryVector - Query embedding
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Query results
   */
  async query(queryVector, options = {}) {
    const {
      topK = 10,
      filter = {},
      includeMetadata = true,
      includeValues = false,
    } = options;

    try {
      const idx = await getIndex();
      // Use REIMAGINEDDOCS namespace where vectors are stored
      const queryResponse = await idx.namespace('REIMAGINEDDOCS').query({
        vector: queryVector,
        topK,
        filter,
        includeMetadata,
        includeValues,
      });

      return queryResponse;
    } catch (error) {
      logger.error('Pinecone query failed', { error: error.message });
      throw error;
    }
  },

  /**
   * Search for maintenance-related content in manuals
   * @param {Array<number>} queryVector - Query embedding
   * @param {string} assetUid - System to filter by
   * @returns {Promise<Array>} Relevant document chunks
   */
  async searchMaintenanceContent(queryVector, assetUid = null) {
    // Filter only by asset UID - semantic search will find maintenance content
    const filter = assetUid ? { 'linked_asset_uid': { $eq: assetUid } } : {};

    logger.debug('Searching maintenance content', {
      assetUid,
      filter: JSON.stringify(filter),
      vectorDimension: queryVector.length
    });

    const results = await this.query(queryVector, {
      topK: 20,
      filter,
      includeMetadata: true,
    });

    logger.debug('Maintenance search results', {
      matchCount: results.matches?.length || 0,
      topScores: results.matches?.slice(0, 3).map(m => m.score)
    });

    return results.matches || [];
  },

  /**
   * Search for parts and spares information
   * @param {Array<number>} queryVector - Query embedding
   * @param {string} assetUid - System to filter by
   * @returns {Promise<Array>} Parts-related chunks
   */
  async searchPartsContent(queryVector, assetUid = null) {
    // Filter by asset UID - semantic search will find parts content
    const filter = assetUid ? { 'linked_asset_uid': { $eq: assetUid } } : {};

    const results = await this.query(queryVector, {
      topK: 15,
      filter,
      includeMetadata: true,
    });

    return results.matches || [];
  },

  /**
   * Get all chunks for a specific document
   * @param {string} docId - Document ID
   * @returns {Promise<Array>} All chunks for the document
   */
  async getDocumentChunks(docId) {
    const filter = {
      doc_id: { $eq: docId },
    };

    // Use a dummy vector for metadata-only retrieval
    const dummyVector = new Array(3072).fill(0);  // Updated for text-embedding-3-small

    const results = await this.query(dummyVector, {
      topK: 100,
      filter,
      includeMetadata: true,
    });

    return results.matches || [];
  },

  /**
   * Check if vectors exist for a document
   * @param {string} docId - Document ID
   * @returns {Promise<boolean>} True if vectors exist
   */
  async documentHasVectors(docId) {
    const chunks = await this.getDocumentChunks(docId);
    return chunks.length > 0;
  },

  /**
   * Get chunk by ID
   * @param {string} chunkId - Chunk ID
   * @returns {Promise<Object|null>} Chunk data or null
   */
  async getChunkById(chunkId) {
    try {
      const idx = await getIndex();
      const fetchResponse = await idx.namespace('REIMAGINEDDOCS').fetch([chunkId]);

      const records = fetchResponse.records;
      if (records && records[chunkId]) {
        return records[chunkId];
      }

      return null;
    } catch (error) {
      logger.error('Failed to fetch chunk', { chunkId, error: error.message });
      throw error;
    }
  },

  /**
   * Health check for Pinecone connection
   * @returns {Promise<Object>} Index statistics
   */
  async healthCheck() {
    try {
      const idx = await getIndex();
      const stats = await idx.namespace('REIMAGINEDDOCS').describeIndexStats();
      logger.info('Pinecone health check', { stats });
      return stats;
    } catch (error) {
      logger.error('Pinecone health check failed', { error: error.message });
      throw error;
    }
  },

  // ============================================================
  // MAINTENANCE_TASKS Namespace Methods
  // ============================================================

  /**
   * Query tasks for similarity search
   * @param {Array<number>} queryVector - Query embedding
   * @param {Object} filter - Metadata filter
   * @param {number} topK - Number of results
   * @returns {Promise<Array>} Similar tasks
   */
  async queryTasks(queryVector, filter = {}, topK = 5) {
    try {
      const idx = await getIndex();
      const queryResponse = await idx.namespace('MAINTENANCE_TASKS').query({
        vector: queryVector,
        topK,
        filter,
        includeMetadata: true,
        includeValues: false
      });

      logger.debug('Task query results', {
        matchCount: queryResponse.matches?.length || 0,
        topScore: queryResponse.matches?.[0]?.score
      });

      return queryResponse.matches || [];
    } catch (error) {
      logger.error('Task query failed', { error: error.message });
      throw error;
    }
  },

  /**
   * Upsert (insert or update) a task in Pinecone
   * DUAL-WRITE: Also writes to Supabase maintenance_tasks_index
   * @param {string} taskId - Task ID
   * @param {Array<number>} embedding - Task embedding vector
   * @param {Object} metadata - Task metadata
   */
  async upsertTask(taskId, embedding, metadata) {
    try {
      // 1. Write to Pinecone (source of truth for embeddings)
      const idx = await getIndex();
      await idx.namespace('MAINTENANCE_TASKS').upsert([
        {
          id: taskId,
          values: embedding,
          metadata
        }
      ]);

      logger.info('Task upserted to Pinecone', { taskId });

      // 2. Sync to Supabase (best effort with retry)
      await syncToSupabaseWithRetry(
        'upsert',
        () => maintenanceTasksIndexRepository.upsert({
          id: taskId,
          ...metadata
        }),
        taskId
      );

      return { id: taskId, metadata };
    } catch (error) {
      logger.error('Task upsert failed', {
        taskId,
        error: error.message
      });
      throw error;
    }
  },

  /**
   * Update task metadata without changing embedding
   * DUAL-WRITE: Also updates Supabase maintenance_tasks_index
   * @param {string} taskId - Task ID
   * @param {Object} metadata - Updated metadata (will be merged with existing)
   * @returns {Promise<Object>} Merged metadata
   */
  async updateTaskMetadata(taskId, metadata) {
    try {
      const idx = await getIndex();

      // Fetch existing record
      const fetchResponse = await idx.namespace('MAINTENANCE_TASKS').fetch([taskId]);
      const existing = fetchResponse.records[taskId];

      if (!existing) {
        throw new Error(`Task ${taskId} not found in Pinecone`);
      }

      // Merge metadata
      const updatedMetadata = {
        ...existing.metadata,
        ...metadata
      };

      // 1. Update Pinecone (source of truth)
      await idx.namespace('MAINTENANCE_TASKS').upsert([
        {
          id: taskId,
          values: existing.values,
          metadata: updatedMetadata
        }
      ]);

      logger.info('Task metadata updated in Pinecone', { taskId, fields: Object.keys(metadata) });

      // 2. Sync to Supabase (best effort with retry)
      // Only sync the changed fields, not the full metadata
      await syncToSupabaseWithRetry(
        'update',
        () => maintenanceTasksIndexRepository.update(taskId, metadata),
        taskId
      );

      return updatedMetadata;
    } catch (error) {
      logger.error('Task metadata update failed', {
        taskId,
        error: error.message
      });
      throw error;
    }
  },

  /**
   * [v2.1] Generic wrapper for updating task metadata
   * Recommended method for all metadata updates to ensure embeddings are preserved
   * @param {string} taskId - Task ID
   * @param {Object} metadataUpdates - Metadata fields to update (will be merged with existing)
   * @returns {Promise<void>}
   * @throws {Error} If task not found in Pinecone
   */
  async updateMetadata(taskId, metadataUpdates) {
    // Wrapper around updateTaskMetadata for consistency with Phase 1 naming
    return this.updateTaskMetadata(taskId, metadataUpdates);
  },

  /**
   * Get task by ID from Pinecone
   * @param {string} taskId - Task ID
   * @returns {Promise<Object|null>} Task data or null
   */
  async getTaskById(taskId) {
    try {
      const idx = await getIndex();
      const fetchResponse = await idx.namespace('MAINTENANCE_TASKS').fetch([taskId]);

      const records = fetchResponse.records;
      if (records && records[taskId]) {
        return records[taskId];
      }

      return null;
    } catch (error) {
      logger.error('Failed to fetch task', { taskId, error: error.message });
      throw error;
    }
  },

  /**
   * List all tasks from MAINTENANCE_TASKS namespace with embeddings
   * @returns {Promise<Array>} Array of tasks with vectors and metadata
   */
  async listAllTasks() {
    try {
      const idx = await getIndex();
      const namespace = idx.namespace('MAINTENANCE_TASKS');

      let allVectors = [];
      let paginationToken = undefined;

      // Paginate through all vectors
      do {
        const listResponse = await namespace.listPaginated({
          prefix: 'task-',
          limit: 100,
          paginationToken
        });

        if (listResponse.vectors) {
          allVectors.push(...listResponse.vectors);
        }

        paginationToken = listResponse.pagination?.next;
      } while (paginationToken);

      logger.info('Listed all task IDs', { count: allVectors.length });

      // Fetch all vectors with metadata and embeddings in batches
      const ids = allVectors.map(v => v.id);
      const batchSize = 1000; // Pinecone fetch limit
      const allRecords = [];

      for (let i = 0; i < ids.length; i += batchSize) {
        const batchIds = ids.slice(i, i + batchSize);
        const fetchResponse = await namespace.fetch(batchIds);

        if (fetchResponse.records) {
          allRecords.push(...Object.values(fetchResponse.records));
        }
      }

      logger.info('Fetched all tasks with embeddings', { count: allRecords.length });

      return allRecords;
    } catch (error) {
      logger.error('Failed to list all tasks', { error: error.message });
      throw error;
    }
  },

  /**
   * Count pending tasks for a specific asset
   * @param {string} assetUid - Asset UID to filter by
   * @returns {Promise<number>} Count of tasks with review_status='pending'
   */
  async countPendingTasksForAsset(assetUid) {
    try {
      logger.debug('Counting pending tasks for asset', { assetUid });

      // Get all tasks
      const allTasks = await this.listAllTasks();

      // Filter by asset_uid and review_status='pending'
      const pendingTasks = allTasks.filter(task =>
        task.metadata?.asset_uid === assetUid &&
        task.metadata?.review_status === 'pending'
      );

      logger.info('Counted pending tasks', {
        assetUid,
        pendingCount: pendingTasks.length,
        totalCount: allTasks.length
      });

      return pendingTasks.length;
    } catch (error) {
      logger.error('Failed to count pending tasks', { assetUid, error: error.message });
      throw error;
    }
  },

  /**
   * Delete a task from Pinecone
   * DUAL-WRITE: Also deletes from Supabase maintenance_tasks_index
   * @param {string} taskId - Task ID
   */
  async deleteTask(taskId) {
    try {
      // 1. Delete from Pinecone (source of truth)
      const idx = await getIndex();
      await idx.namespace('MAINTENANCE_TASKS').deleteOne(taskId);

      logger.info('Task deleted from Pinecone', { taskId });

      // 2. Sync to Supabase (best effort with retry)
      await syncToSupabaseWithRetry(
        'delete',
        () => maintenanceTasksIndexRepository.delete(taskId),
        taskId
      );
    } catch (error) {
      logger.error('Task deletion failed', { taskId, error: error.message });
      throw error;
    }
  },

  /**
   * Get statistics for MAINTENANCE_TASKS namespace
   * @returns {Promise<Object>} Namespace statistics
   */
  async getTasksNamespaceStats() {
    try {
      const idx = await getIndex();
      const stats = await idx.namespace('MAINTENANCE_TASKS').describeIndexStats();

      logger.info('MAINTENANCE_TASKS namespace stats', { stats });
      return stats;
    } catch (error) {
      logger.error('Failed to get namespace stats', { error: error.message });
      throw error;
    }
  }
};

export default pineconeRepository;