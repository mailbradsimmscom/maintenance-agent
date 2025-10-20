/**
 * Chunk Tracking Service
 * Prevents reprocessing of overlapping chunks
 */

import { createLogger } from '../utils/logger.js';
import crypto from 'crypto';

const logger = createLogger('chunk-tracking-service');

// In-memory cache for current session
const processedChunks = new Map();

export const chunkTrackingService = {
  /**
   * Create a fingerprint for chunk content to detect overlaps
   * @param {string} text - Chunk text
   * @returns {string} Hash of normalized content
   */
  createFingerprint(text) {
    // Normalize text: lowercase, remove extra whitespace, remove punctuation
    const normalized = text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();

    // Create hash of normalized content
    return crypto
      .createHash('md5')
      .update(normalized)
      .digest('hex');
  },

  /**
   * Check if we've already processed this chunk or similar content
   * @param {string} chunkId - Pinecone chunk ID
   * @param {string} text - Chunk text
   * @param {number} overlapThreshold - Similarity threshold (0.8 = 80% similar)
   * @returns {boolean} True if already processed
   */
  isAlreadyProcessed(chunkId, text, overlapThreshold = 0.8) {
    // Quick check: exact chunk ID
    if (processedChunks.has(chunkId)) {
      logger.debug('Chunk already processed by ID', { chunkId });
      return true;
    }

    // Check for content overlap using fingerprint
    const fingerprint = this.createFingerprint(text);
    const existingEntry = Array.from(processedChunks.values()).find(
      entry => entry.fingerprint === fingerprint
    );

    if (existingEntry) {
      logger.debug('Similar content already processed', {
        currentChunkId: chunkId,
        originalChunkId: existingEntry.chunkId,
        fingerprint
      });
      return true;
    }

    return false;
  },

  /**
   * Mark chunk as processed
   * @param {string} chunkId - Pinecone chunk ID
   * @param {string} text - Chunk text
   * @param {Object} metadata - Additional metadata
   */
  markAsProcessed(chunkId, text, metadata = {}) {
    const fingerprint = this.createFingerprint(text);
    processedChunks.set(chunkId, {
      chunkId,
      fingerprint,
      processedAt: new Date().toISOString(),
      ...metadata
    });

    logger.debug('Marked chunk as processed', { chunkId, fingerprint });
  },

  /**
   * Get processing statistics
   * @returns {Object} Stats about processed chunks
   */
  getStats() {
    const uniqueFingerprints = new Set(
      Array.from(processedChunks.values()).map(e => e.fingerprint)
    );

    return {
      totalChunksProcessed: processedChunks.size,
      uniqueContentBlocks: uniqueFingerprints.size,
      duplicatesSkipped: processedChunks.size - uniqueFingerprints.size
    };
  },

  /**
   * Clear cache for a specific document or all
   * @param {string} docId - Optional document ID to clear
   */
  clearCache(docId = null) {
    if (docId) {
      // Clear only chunks from specific document
      for (const [key, value] of processedChunks.entries()) {
        if (value.docId === docId) {
          processedChunks.delete(key);
        }
      }
    } else {
      // Clear all
      processedChunks.clear();
    }
  }
};

export default chunkTrackingService;