/**
 * Extraction Service
 * Extracts maintenance tasks from manuals using Pinecone and LLM
 */

import { openaiRepository } from '../repositories/openai.repository.js';
import { pineconeRepository } from '../repositories/pinecone.repository.js';
import db from '../repositories/supabase.repository.js';
import { chunkTrackingService } from './chunk-tracking.service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('extraction-service');

export const extractionService = {
  /**
   * Extract maintenance tasks from system manuals
   * @param {Object} system - System to process
   * @returns {Promise<Array>} Extracted maintenance tasks
   */
  async extractFromManuals(system) {
    try {
      logger.info('Starting manual extraction', { assetUid: system.asset_uid });

      // Get documents for this system
      const documents = await db.systems.getSystemDocuments(system.asset_uid);

      if (!documents || documents.length === 0) {
        logger.info('No documents found for system', { assetUid: system.asset_uid });
        return [];
      }

      const allTasks = [];

      // Process each document
      for (const doc of documents) {
        logger.debug('Processing document', { docId: doc.doc_id });

        // Check if document has vectors in Pinecone
        const hasVectors = await pineconeRepository.documentHasVectors(doc.doc_id);

        if (!hasVectors) {
          logger.warn('Document has no vectors in Pinecone', { docId: doc.doc_id });
          continue;
        }

        // Query for maintenance-related content with action verbs
        const maintenanceQuery = 'maintenance service inspection cleaning replacement schedule interval check replace inspect clean lubricate adjust tighten remove drain fill flush software update';
        const queryVector = await openaiRepository.createEmbedding(maintenanceQuery);

        // Search for maintenance content
        const chunks = await pineconeRepository.searchMaintenanceContent(
          queryVector,
          system.asset_uid
        );

        // Extract tasks from chunks
        for (const chunk of chunks) {
          if (chunk.score < 0.30) continue; // Lower threshold for broader coverage

          const chunkText = chunk.metadata.text || '';

          // Skip if we've already processed this or similar content (20% overlap)
          if (chunkTrackingService.isAlreadyProcessed(chunk.id, chunkText)) {
            logger.debug('Skipping overlapping chunk', {
              chunkId: chunk.id,
              score: chunk.score
            });
            continue;
          }

          const extractedTasks = await openaiRepository.extractMaintenanceTasks(
            chunkText,
            {
              manufacturer: system.manufacturer_norm,
              model: system.model_norm,
              assetUid: system.asset_uid,
              docId: doc.doc_id,
            }
          );

          // Mark chunk as processed AFTER successful extraction
          if (extractedTasks.length > 0) {
            chunkTrackingService.markAsProcessed(chunk.id, chunkText, {
              docId: doc.doc_id,
              assetUid: system.asset_uid,
              tasksExtracted: extractedTasks.length
            });
          }

          // Add source information to each task
          const tasksWithSource = extractedTasks.map(task => ({
            ...task,
            source: 'manual',
            source_details: {
              doc_id: doc.doc_id,
              chunk_id: chunk.id,
              page_start: chunk.metadata.page_start,
              page_end: chunk.metadata.page_end,
              relevance_score: chunk.score,
            },
          }));

          allTasks.push(...tasksWithSource);
        }
      }

      // Log extraction stats including duplicate skipping
      const chunkStats = chunkTrackingService.getStats();
      logger.info('Manual extraction completed', {
        assetUid: system.asset_uid,
        taskCount: allTasks.length,
        chunksProcessed: chunkStats.totalChunksProcessed,
        duplicatesSkipped: chunkStats.duplicatesSkipped
      });

      return allTasks;
    } catch (error) {
      logger.error('Manual extraction failed', {
        assetUid: system.asset_uid,
        error: error.message,
      });
      return [];
    }
  },

  /**
   * Search for parts and spares information
   * @param {Object} system - System to process
   * @returns {Promise<Array>} Parts and spares list
   */
  async extractPartsInformation(system) {
    try {
      logger.info('Extracting parts information', { assetUid: system.asset_uid });

      const partsQuery = 'parts spares components replacement part number consumables';
      const queryVector = await openaiRepository.createEmbedding(partsQuery);

      const chunks = await pineconeRepository.searchPartsContent(
        queryVector,
        system.asset_uid
      );

      const parts = [];
      for (const chunk of chunks) {
        if (chunk.score < 0.7) continue;

        // Extract part numbers from metadata if available
        if (chunk.metadata.part_numbers) {
          parts.push(...chunk.metadata.part_numbers);
        }
      }

      return [...new Set(parts)]; // Deduplicate
    } catch (error) {
      logger.error('Parts extraction failed', {
        assetUid: system.asset_uid,
        error: error.message,
      });
      return [];
    }
  },
};

export default extractionService;