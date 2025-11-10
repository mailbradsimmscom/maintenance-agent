/**
 * Step 2: LLM-Powered Vector Search
 *
 * Uses GPT to generate system-specific maintenance search terms,
 * then finds relevant document chunks and stores them in pinecone_search_results table
 */

import OpenAI from 'openai';
import { getConfig } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';
import db from '../../repositories/supabase.repository.js';
import { pineconeRepository } from '../../repositories/pinecone.repository.js';

const config = getConfig();
const logger = createLogger('step2-llm-search');

const SCORE_THRESHOLD = 0.30;

/**
 * Generate maintenance search terms for a specific system using LLM
 */
async function generateMaintenanceTerms(system, openai, rateLimiter) {
  const prompt = `Generate 5-8 technical maintenance search terms for this marine system:

System Type: ${system.system_norm}
Manufacturer: ${system.manufacturer_norm}
Model: ${system.model_norm}

Focus on:
- System-specific maintenance terminology
- Common maintenance procedures
- Parts that require service/replacement
- Industry-standard terms for this equipment type

Return only the search terms as a comma-separated list.`;

  await rateLimiter?.waitForTurn('openai');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 150
  });

  return response.choices[0].message.content.trim();
}

/**
 * Execute LLM-powered Pinecone search for a system
 * @param {string} assetUid - System asset UID
 * @param {Object} options - Execution options
 * @param {Object} options.rateLimiter - Rate limiter instance
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Results
 */
export async function executeLLMSearch(assetUid, options = {}) {
  const { rateLimiter, onProgress } = options;

  logger.info('Starting LLM-powered Pinecone search', { assetUid });

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
      .eq('type', 'LLM');

    if (existingError) {
      throw new Error(`Failed to check existing results: ${existingError.message}`);
    }

    if (existing && existing.length > 0) {
      logger.info('LLM search already run for this system', {
        assetUid,
        existingChunks: existing.length
      });

      return {
        success: true,
        chunksFound: 0,
        chunksSkipped: existing.length,
        message: `LLM search already completed. ${existing.length} chunks found previously.`,
        skipReason: 'already_executed'
      };
    }

    // Step 3: Generate system-specific maintenance terms
    onProgress?.({ message: 'Generating system-specific search terms...' });

    const searchTerms = await generateMaintenanceTerms(system, openai, rateLimiter);

    if (!searchTerms) {
      throw new Error('Failed to generate search terms');
    }

    logger.info('Generated search terms', { assetUid, searchTerms });

    // Step 4: Create embedding from terms
    onProgress?.({ message: 'Creating custom search embedding...' });

    await rateLimiter?.waitForTurn('openai');

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: searchTerms,
      dimensions: 3072
    });

    const queryVector = embeddingResponse.data[0].embedding;

    // Step 5: Query Pinecone
    onProgress?.({ message: 'Searching Pinecone with custom terms...' });

    await rateLimiter?.waitForTurn('pinecone');

    const results = await pineconeRepository.query(queryVector, {
      topK: 20,
      filter: { 'linked_asset_uid': { $eq: assetUid } },
      includeMetadata: true
    });

    const matches = results.matches || [];
    const relevantChunks = matches.filter(m => m.score >= SCORE_THRESHOLD);

    logger.info('LLM-powered search completed', {
      assetUid,
      totalMatches: matches.length,
      relevantChunks: relevantChunks.length
    });

    if (relevantChunks.length === 0) {
      return {
        success: true,
        chunksFound: 0,
        chunksSkipped: 0,
        searchTerms,
        message: 'No relevant chunks found above threshold'
      };
    }

    // Step 6: Store results in database
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
      search_terms: searchTerms,
      type: 'LLM'
    }));

    await rateLimiter?.waitForTurn('supabase');

    const { error: insertError } = await supabase
      .from('pinecone_search_results')
      .insert(records);

    if (insertError) {
      throw new Error(`Failed to insert results: ${insertError.message}`);
    }

    logger.info('LLM search completed successfully', {
      assetUid,
      chunksFound: relevantChunks.length,
      searchTerms
    });

    return {
      success: true,
      chunksFound: relevantChunks.length,
      chunksSkipped: 0,
      searchTerms,
      scoreRange: {
        highest: relevantChunks[0]?.score || 0,
        lowest: relevantChunks[relevantChunks.length - 1]?.score || 0
      },
      message: `Found ${relevantChunks.length} relevant chunks using custom terms`
    };

  } catch (error) {
    logger.error('LLM search failed', {
      assetUid,
      error: error.message,
      stack: error.stack
    });

    throw error;
  }
}
