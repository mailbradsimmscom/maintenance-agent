/**
 * Step 1: Generic Pinecone Search
 *
 * Uses generic maintenance search terms to find relevant document chunks
 * and stores them in pinecone_search_results table
 */

import OpenAI from 'openai';
import { getConfig } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';
import db from '../../repositories/supabase.repository.js';
import { pineconeRepository } from '../../repositories/pinecone.repository.js';

const config = getConfig();
const logger = createLogger('step1-generic-search');

const SCORE_THRESHOLD = 0.30;

/**
 * Execute generic Pinecone search for a system
 * @param {string} assetUid - System asset UID
 * @param {Object} options - Execution options
 * @param {Object} options.rateLimiter - Rate limiter instance
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Results
 */
export async function executeGenericSearch(assetUid, options = {}) {
  const { rateLimiter, onProgress } = options;

  logger.info('Starting generic Pinecone search', { assetUid });

  const supabase = db.client;
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  try {
    // Step 1: Get system details
    onProgress?.({ message: 'Fetching system details...' });

    const { data: system, error: systemError } = await supabase
      .from('systems')
      .select('asset_uid, description, manufacturer_norm, model_norm, system_norm')
      .eq('asset_uid', assetUid)
      .single();

    if (systemError) {
      throw new Error(`Failed to fetch system: ${systemError.message}`);
    }

    const systemName = system.description || `${system.manufacturer_norm} ${system.model_norm}`;

    logger.info('Processing system', { assetUid, systemName });

    // Step 2: Check if already processed (idempotency)
    const { data: existing, error: existingError } = await supabase
      .from('pinecone_search_results')
      .select('chunk_id')
      .eq('asset_uid', assetUid)
      .eq('type', 'generic');

    if (existingError) {
      throw new Error(`Failed to check existing results: ${existingError.message}`);
    }

    if (existing && existing.length > 0) {
      logger.info('Generic search already run for this system', {
        assetUid,
        existingChunks: existing.length
      });

      return {
        success: true,
        chunksFound: 0,
        chunksSkipped: existing.length,
        message: `Generic search already completed. ${existing.length} chunks found previously.`,
        skipReason: 'already_executed'
      };
    }

    // Step 3: Create generic maintenance query embedding
    onProgress?.({ message: 'Creating search embedding...' });

    const maintenanceQuery = 'maintenance schedule inspection service interval replacement';

    await rateLimiter?.waitForTurn('openai');

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: maintenanceQuery,
      dimensions: 3072
    });

    const queryVector = embeddingResponse.data[0].embedding;

    logger.info('Embedding created');

    // Step 4: Query Pinecone
    onProgress?.({ message: 'Searching Pinecone for relevant chunks...' });

    await rateLimiter?.waitForTurn('pinecone');

    const results = await pineconeRepository.query(queryVector, {
      topK: 20,
      filter: { 'linked_asset_uid': { $eq: assetUid } },
      includeMetadata: true
    });

    const matches = results.matches || [];
    const relevantChunks = matches.filter(m => m.score >= SCORE_THRESHOLD);

    logger.info('Pinecone search completed', {
      assetUid,
      totalMatches: matches.length,
      relevantChunks: relevantChunks.length
    });

    if (relevantChunks.length === 0) {
      return {
        success: true,
        chunksFound: 0,
        chunksSkipped: 0,
        message: 'No relevant chunks found above threshold'
      };
    }

    // Step 5: Store results in database
    onProgress?.({ message: `Saving ${relevantChunks.length} chunks to database...` });

    const records = relevantChunks.map(chunk => ({
      asset_uid: assetUid,
      system_name: systemName,
      manufacturer: system.manufacturer_norm,
      model: system.model_norm,
      chunk_id: chunk.id,
      doc_id: chunk.metadata?.doc_id,
      relevance_score: chunk.score,
      section_title: chunk.metadata?.section_title,
      content_snippet: chunk.metadata?.content_snippet?.substring(0, 200),
      has_lists: chunk.metadata?.has_lists,
      has_tables: chunk.metadata?.has_tables,
      page_start: chunk.metadata?.page_start,
      page_end: chunk.metadata?.page_end,
      chunk_metadata: chunk.metadata,
      type: 'generic'
    }));

    await rateLimiter?.waitForTurn('supabase');

    const { error: insertError } = await supabase
      .from('pinecone_search_results')
      .insert(records);

    if (insertError) {
      throw new Error(`Failed to insert results: ${insertError.message}`);
    }

    logger.info('Generic search completed successfully', {
      assetUid,
      chunksFound: relevantChunks.length
    });

    return {
      success: true,
      chunksFound: relevantChunks.length,
      chunksSkipped: 0,
      scoreRange: {
        highest: relevantChunks[0]?.score || 0,
        lowest: relevantChunks[relevantChunks.length - 1]?.score || 0
      },
      message: `Found ${relevantChunks.length} relevant chunks`
    };

  } catch (error) {
    logger.error('Generic search failed', {
      assetUid,
      error: error.message,
      stack: error.stack
    });

    throw error;
  }
}
