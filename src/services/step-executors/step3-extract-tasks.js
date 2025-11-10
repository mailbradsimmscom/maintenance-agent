/**
 * Step 3: Extract, Enrich, and Upload Tasks
 *
 * Reads high-scoring chunks from pinecone_search_results (≥50%),
 * extracts tasks using OpenAI (with classification in one call),
 * generates embeddings, and uploads to Pinecone MAINTENANCE_TASKS namespace
 */

import crypto from 'crypto';
import { franc } from 'franc';
import { openaiRepository } from '../../repositories/openai.repository.js';
import { pineconeRepository } from '../../repositories/pinecone.repository.js';
import { getConfig } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';
import db from '../../repositories/supabase.repository.js';

const config = getConfig();
const logger = createLogger('step3-extract-tasks');

const SCORE_THRESHOLD = 0.50;

const TASK_TYPES = [
  'fluid_check',
  'filter_replacement',
  'visual_inspection',
  'lubrication',
  'cleaning',
  'adjustment',
  'parts_replacement',
  'fluid_replacement',
  'condition_based'
];

/**
 * Generate hash for task deduplication
 */
function generateTaskHash(task) {
  const key = `${task.description}|${task.frequency_value}|${task.frequency_type}`;
  return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
}

/**
 * Detect if text is in English
 * @param {string} text - Text to analyze
 * @returns {boolean} True if English, false otherwise
 */
function isEnglish(text) {
  if (!text || text.trim().length < 10) {
    // Too short to reliably detect, assume English
    return true;
  }

  const detectedLang = franc(text, { minLength: 10 });

  // franc returns 'und' for undetermined, treat as English
  if (detectedLang === 'und') {
    return true;
  }

  // 'eng' is the ISO 639-3 code for English
  return detectedLang === 'eng';
}

/**
 * Extract tasks AND classify in ONE call to OpenAI
 */
async function extractAndClassifyTasks(chunkText, context, rateLimiter) {
  const systemPrompt = `You are a marine systems maintenance expert. Extract all maintenance tasks from the provided text AND classify them.

For each task, provide:
1. description: Clear description of the maintenance task
2. frequency_type: One of [hours, days, weeks, months, years, cycles, condition_based]
3. frequency_value: Numeric value for the frequency (or null for condition_based)
4. frequency_basis: How is this task scheduled?
   - "calendar": Time-based (every X days/months/years regardless of use)
   - "usage": Usage-based (every X operating hours, depends on equipment running)
   - "event": Triggered by specific events (startup, installation, winterization, boat lifting)
   - "condition": As-needed based on condition/inspection
   - "unknown": Cannot determine from information given
5. task_type: Type of maintenance - one of [${TASK_TYPES.join(', ')}]
6. parts_required: Array of parts/consumables needed
7. estimated_duration_hours: Estimated time to complete
8. criticality: One of [critical, important, routine, optional]
9. confidence: Your confidence in this extraction (0.0-1.0)

Classification Signals:
- "hours" in frequency usually means USAGE (operating hours)
- "days/months/years" means CALENDAR
- "startup", "before operation", "after use", "boat lifting", "install" means EVENT
- "as needed", "when necessary", "if required" means CONDITION

Focus on:
- Regular maintenance schedules
- Inspection requirements
- Cleaning procedures
- Part replacement intervals
- Lubrication schedules
- Calibration requirements

Return a JSON object with a "tasks" array containing all extracted tasks.`;

  const userPrompt = `System: ${context.manufacturer || 'Unknown'} ${context.model || 'Unknown'}
Asset: ${context.assetUid || 'Unknown'}

Text to analyze:
${chunkText}`;

  await rateLimiter?.waitForTurn('openai');

  const response = await openaiRepository.createChatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], {
    model: 'gpt-4o-mini',
    temperature: 0.0,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  });

  const result = JSON.parse(response);
  return result.tasks || [];
}

/**
 * Normalize frequency to hours (for range queries)
 */
function normalizeFrequencyToHours(task) {
  if (!['calendar', 'usage'].includes(task.frequency_basis)) {
    return null;
  }

  if (task.frequency_value === null || task.frequency_value === undefined) {
    return null;
  }

  const value = task.frequency_value;
  const type = task.frequency_type;

  if (type === 'hours') return value;
  if (type === 'days') return value * 24;
  if (type === 'weeks') return value * 24 * 7;
  if (type === 'months') return value * 24 * 30;
  if (type === 'years') return value * 24 * 365;

  return null;
}

/**
 * Execute task extraction for a system
 * @param {string} assetUid - System asset UID
 * @param {Object} options - Execution options
 * @param {Object} options.rateLimiter - Rate limiter instance
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Results
 */
export async function executeExtractTasks(assetUid, options = {}) {
  const { rateLimiter, onProgress } = options;

  logger.info('Starting task extraction', { assetUid });

  const supabase = db.client;

  try {
    // Step 1: Check existing tasks (idempotency)
    onProgress?.({ message: 'Checking for existing tasks...' });

    const allExistingTasks = await pineconeRepository.listAllTasks();
    const existingTasks = allExistingTasks.filter(t => t.metadata?.asset_uid === assetUid);
    const existingHashes = new Set(
      existingTasks
        .map(t => t.metadata?.task_hash)
        .filter(Boolean)
    );

    logger.info('Found existing tasks', {
      assetUid,
      existingCount: existingTasks.length
    });

    // Step 2: Get high-scoring chunks from pinecone_search_results
    onProgress?.({ message: 'Fetching high-scoring chunks...' });

    const { data: chunks, error: chunksError } = await supabase
      .from('pinecone_search_results')
      .select('*')
      .eq('asset_uid', assetUid)
      .gte('relevance_score', SCORE_THRESHOLD)
      .order('relevance_score', { ascending: false });

    if (chunksError) {
      throw new Error(`Failed to fetch chunks: ${chunksError.message}`);
    }

    if (!chunks || chunks.length === 0) {
      return {
        success: true,
        tasksExtracted: 0,
        tasksSkipped: existingTasks.length,
        message: 'No chunks found above 50% threshold'
      };
    }

    logger.info('Processing chunks', {
      assetUid,
      chunksToProcess: chunks.length
    });

    // Step 3: Extract tasks from each chunk
    const allTasks = [];
    let processedChunks = 0;

    for (const chunk of chunks) {
      processedChunks++;

      onProgress?.({
        message: `Processing chunk ${processedChunks}/${chunks.length}...`,
        current: processedChunks,
        total: chunks.length
      });

      const fullText = chunk.chunk_metadata?.text;
      if (!fullText) {
        logger.warn('Chunk has no text', { chunkId: chunk.chunk_id });
        continue;
      }

      try {
        const tasks = await extractAndClassifyTasks(fullText, {
          manufacturer: chunk.manufacturer,
          model: chunk.model,
          assetUid: chunk.asset_uid
        }, rateLimiter);

        if (tasks.length > 0) {
          logger.info('Extracted tasks from chunk', {
            chunkId: chunk.chunk_id,
            taskCount: tasks.length
          });

          // Enhance tasks with metadata and generate hash
          const enrichedTasks = tasks.map(task => {
            const frequency_hours = normalizeFrequencyToHours(task);
            const task_hash = generateTaskHash(task);

            return {
              ...task,
              task_hash,
              asset_uid: chunk.asset_uid,
              system_name: chunk.system_name,
              frequency_hours,
              source: 'manual',
              source_details: {
                doc_id: chunk.doc_id,
                chunk_id: chunk.chunk_id,
                relevance_score: chunk.relevance_score,
                section_title: chunk.section_title,
                page_start: chunk.page_start,
                page_end: chunk.page_end
              },
              status: 'pending',
              created_at: new Date().toISOString()
            };
          });

          // Filter out non-English tasks
          const englishTasks = enrichedTasks.filter(task => {
            const taskIsEnglish = isEnglish(task.description);

            if (!taskIsEnglish) {
              const detectedLang = franc(task.description, { minLength: 10 });
              logger.info('Filtered non-English task', {
                chunkId: chunk.chunk_id,
                description: task.description.substring(0, 100),
                detectedLanguage: detectedLang,
                assetUid: chunk.asset_uid
              });
            }

            return taskIsEnglish;
          });

          if (englishTasks.length < enrichedTasks.length) {
            logger.info('Language filtering applied', {
              chunkId: chunk.chunk_id,
              totalTasks: enrichedTasks.length,
              englishTasks: englishTasks.length,
              filtered: enrichedTasks.length - englishTasks.length
            });
          }

          allTasks.push(...englishTasks);
        }
      } catch (error) {
        logger.error('Failed to extract from chunk', {
          chunkId: chunk.chunk_id,
          error: error.message
        });
      }
    }

    logger.info('Extraction complete', {
      assetUid,
      totalTasksExtracted: allTasks.length
    });

    // Step 4: Filter out existing tasks by hash
    const newTasks = allTasks.filter(task => !existingHashes.has(task.task_hash));

    logger.info('Filtered duplicate tasks', {
      assetUid,
      totalExtracted: allTasks.length,
      newTasks: newTasks.length,
      duplicatesSkipped: allTasks.length - newTasks.length
    });

    if (newTasks.length === 0) {
      return {
        success: true,
        tasksExtracted: 0,
        tasksSkipped: allTasks.length,
        message: `All ${allTasks.length} tasks already exist in Pinecone`
      };
    }

    // Step 5: Upload new tasks to Pinecone
    onProgress?.({ message: `Uploading ${newTasks.length} new tasks to Pinecone...` });

    let uploadedCount = 0;

    for (let i = 0; i < newTasks.length; i++) {
      const task = newTasks[i];

      onProgress?.({
        message: `Uploading task ${i + 1}/${newTasks.length}...`,
        current: i + 1,
        total: newTasks.length
      });

      try {
        // Generate embedding
        await rateLimiter?.waitForTurn('openai');
        const embedding = await openaiRepository.createEmbedding(task.description);

        // Generate unique ID
        const taskId = `task-${Date.now()}-${i}`;

        // Prepare metadata (only non-null values for Pinecone)
        const metadata = {
          task_id: taskId,
          task_hash: task.task_hash,
          description: task.description,
          asset_uid: task.asset_uid,
          system_name: task.system_name,
          frequency_basis: task.frequency_basis,
          task_type: task.task_type,
          criticality: task.criticality,
          confidence: task.confidence,
          source: task.source,
          review_status: 'pending',
          is_completed: false
        };

        // Add optional fields only if not null
        if (task.frequency_type !== null) metadata.frequency_type = task.frequency_type;
        if (task.frequency_value !== null) metadata.frequency_value = task.frequency_value;
        if (task.frequency_hours !== null) metadata.frequency_hours = task.frequency_hours;
        if (task.estimated_duration_hours !== null) metadata.estimated_duration_hours = task.estimated_duration_hours;

        // Upload to Pinecone
        await rateLimiter?.waitForTurn('pinecone');
        await pineconeRepository.upsertTask(taskId, embedding, metadata);

        uploadedCount++;
      } catch (error) {
        logger.error('Failed to upload task', {
          task: task.description?.substring(0, 50),
          error: error.message
        });
      }
    }

    logger.info('Task extraction completed successfully', {
      assetUid,
      tasksExtracted: uploadedCount,
      tasksSkipped: allTasks.length - newTasks.length
    });

    return {
      success: true,
      tasksExtracted: uploadedCount,
      tasksSkipped: allTasks.length - newTasks.length,
      message: `Extracted ${uploadedCount} new tasks, skipped ${allTasks.length - newTasks.length} duplicates`
    };

  } catch (error) {
    logger.error('Task extraction failed', {
      assetUid,
      error: error.message,
      stack: error.stack
    });

    throw error;
  }
}
