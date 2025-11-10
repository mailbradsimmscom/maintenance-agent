/**
 * Step 6: Classify & Discover
 *
 * For a single system:
 * 1. Classify all existing tasks (MAINTENANCE/INSTALLATION/PRE_USE_CHECK/VAGUE)
 * 2. Determine if tasks are recurring or one-time
 * 3. Discover missing tasks based on industry best practices
 * 4. Create BoatOS tasks if system has usage-based maintenance
 */

import { openaiRepository } from '../../repositories/openai.repository.js';
import { pineconeRepository } from '../../repositories/pinecone.repository.js';
import boatosTasksService from '../boatos-tasks.service.js';
import { createLogger } from '../../utils/logger.js';
import db from '../../repositories/supabase.repository.js';

const logger = createLogger('step6-classify-discover');

/**
 * Calculate frequency in hours
 */
function calculateFrequencyHours(value, type) {
  const hourMapping = {
    hours: 1,
    days: 24,
    weeks: 24 * 7,
    months: 24 * 30,
    years: 24 * 365,
    cycles: null,
    condition_based: null
  };

  const multiplier = hourMapping[type];
  return multiplier ? value * multiplier : null;
}

/**
 * Execute Step 6: Classify & Discover
 * @param {string} assetUid - System asset UID
 * @param {Object} options - Options (rateLimiter, onProgress)
 * @returns {Promise<Object>} Results
 */
export async function executeClassifyDiscover(assetUid, options = {}) {
  const { rateLimiter, onProgress } = options;

  try {
    logger.info('Step 6 started', { assetUid });

    if (onProgress) {
      onProgress({ message: 'Fetching tasks from Pinecone...', progress: 0 });
    }

    // Step 1: Fetch system info
    const { data: system, error: systemError } = await db.client
      .from('systems')
      .select('asset_uid, description, manufacturer_norm, model_norm')
      .eq('asset_uid', assetUid)
      .single();

    if (systemError) {
      throw new Error(`Failed to fetch system: ${systemError.message}`);
    }

    const systemName = system.description || `${system.manufacturer_norm} ${system.model_norm}`;

    // Step 2: Fetch all tasks for this system from Pinecone (exclude already-marked duplicates)
    const allRecords = await pineconeRepository.listAllTasks();
    const hiddenStatuses = ['auto_duplicate_hidden', 'duplicate_hidden', 'invalid_task'];
    const systemRecords = allRecords.filter(record =>
      record.metadata.asset_uid === assetUid &&
      !hiddenStatuses.includes(record.metadata.review_status)
    );

    logger.info(`Found ${systemRecords.length} existing tasks`, {
      assetUid,
      systemName,
      excludedDuplicates: allRecords.filter(r =>
        r.metadata.asset_uid === assetUid &&
        hiddenStatuses.includes(r.metadata.review_status)
      ).length
    });

    const existingTasks = systemRecords.map(record => ({
      id: record.id,
      description: record.metadata.description,
      frequency_value: record.metadata.frequency_value ?? null,
      frequency_type: record.metadata.frequency_type ?? null,
      frequency_basis: record.metadata.frequency_basis,
      task_type: record.metadata.task_type,
      system_name: record.metadata.system_name,
      asset_uid: record.metadata.asset_uid
    }));

    // =================================================================
    // PART 1: DISCOVER NEW TASKS (runs even if existing tasks = 0)
    // =================================================================

    if (onProgress) {
      onProgress({ message: 'Discovering missing tasks with LLM...', progress: 20 });
    }

    // Step 3: Build discovery prompt (shows existing tasks for context, asks for NEW ones)
    const discoverySystemPrompt = `You are a marine systems maintenance expert.
Your task: Identify 3-5 MISSING maintenance tasks for this system based on industry best practices.

Focus on tasks that:
- Are NOT already in the existing tasks list
- Are common in real-world marine operations
- Are often omitted from equipment manuals
- Cover: preventive measures, environmental factors, integration points, common failure modes`;

    const existingTasksList = existingTasks.length > 0
      ? existingTasks.map((t, i) => `${i + 1}. "${t.description}"`).join('\n')
      : '(No existing tasks found in documentation)';

    const discoveryUserPrompt = `System: ${systemName}
Manufacturer: ${system.manufacturer_norm || 'Unknown'}
Model: ${system.model_norm || 'Unknown'}

EXISTING TASKS (do NOT suggest duplicates of these):
${existingTasksList}

Identify 3-5 NEW maintenance tasks that are missing but important for this system.

Return ONLY valid JSON:
{
  "discovered_tasks": [
    {
      "description": "Task description",
      "frequency_value": 30,
      "frequency_type": "days",
      "frequency_basis": "calendar",
      "task_type": "inspection",
      "criticality": "high",
      "confidence": 0.85,
      "reasoning": "Why this task is important"
    }
  ]
}`;

    // Rate limit OpenAI call
    if (rateLimiter) {
      await rateLimiter.waitForTurn('openai');
    }

    // Step 4: Call LLM for discovery
    const discoveryResult = await openaiRepository.classifyAndDiscoverTasks(discoverySystemPrompt, discoveryUserPrompt);

    logger.info('LLM discovery complete', {
      assetUid,
      discovered: discoveryResult.discovered_tasks?.length || 0
    });

    // Step 5: Upload discovered tasks to Pinecone
    if (onProgress) {
      onProgress({ message: 'Uploading discovered tasks...', progress: 40 });
    }

    const discoveredTasks = discoveryResult.discovered_tasks || [];
    let uploadedCount = 0;

    for (let i = 0; i < discoveredTasks.length; i++) {
      const task = discoveredTasks[i];

      if (onProgress) {
        onProgress({
          message: `Uploading discovered task ${i + 1}/${discoveredTasks.length}...`,
          progress: 60 + (i / discoveredTasks.length) * 20
        });
      }

      // Generate embedding
      if (rateLimiter) {
        await rateLimiter.waitForTurn('openai');
      }

      const embedding = await openaiRepository.createEmbedding(task.description);
      const frequencyHours = calculateFrequencyHours(task.frequency_value, task.frequency_type);

      const taskId = `task-discovered-${Date.now()}-${i}`;
      const metadata = {
        description: task.description,
        asset_uid: assetUid,
        system_name: systemName,
        frequency_value: task.frequency_value,
        frequency_type: task.frequency_type,
        frequency_basis: task.frequency_basis,
        frequency_hours: frequencyHours,
        task_type: task.task_type,
        criticality: task.criticality,
        confidence: task.confidence,
        source: 'real_world',
        review_status: 'pending',
        is_completed: false,
        task_category: 'MAINTENANCE',
        task_category_confidence: task.confidence,
        task_category_reasoning: task.reasoning,
        classified_at: new Date().toISOString()
      };

      if (task.is_recurring !== undefined && task.is_recurring !== null) {
        metadata.is_recurring = task.is_recurring;
      }

      try {
        await pineconeRepository.upsertTask(taskId, embedding, metadata);
        uploadedCount++;
      } catch (error) {
        logger.error('Failed to upload discovered task', {
          task: task.description,
          error: error.message
        });
      }
    }

    logger.info('Discovered tasks uploaded', { assetUid, uploadedCount });

    // =================================================================
    // PART 1.5: DISCOVER CROSS-SYSTEM DEPENDENCY TASKS
    // =================================================================

    if (onProgress) {
      onProgress({ message: 'Discovering cross-system dependencies...', progress: 50 });
    }

    // Call LLM to discover dependency tasks
    if (rateLimiter) {
      await rateLimiter.waitForTurn('openai');
    }

    const dependencyResult = await openaiRepository.discoverDependencyTasks(
      systemName,
      system.manufacturer_norm,
      system.model_norm
    );

    logger.info('LLM dependency discovery complete', {
      assetUid,
      dependencyTasks: dependencyResult.dependency_tasks?.length || 0,
      systemChain: dependencyResult.system_chain || 'N/A'
    });

    // Upload dependency tasks to Pinecone
    if (onProgress) {
      onProgress({ message: 'Uploading dependency tasks...', progress: 55 });
    }

    const dependencyTasks = dependencyResult.dependency_tasks || [];
    let dependencyUploadedCount = 0;

    for (let i = 0; i < dependencyTasks.length; i++) {
      const task = dependencyTasks[i];

      if (onProgress) {
        onProgress({
          message: `Uploading dependency task ${i + 1}/${dependencyTasks.length}...`,
          progress: 55 + (i / dependencyTasks.length) * 5
        });
      }

      // Generate embedding
      if (rateLimiter) {
        await rateLimiter.waitForTurn('openai');
      }

      const embedding = await openaiRepository.createEmbedding(task.description);
      const frequencyHours = calculateFrequencyHours(task.frequency_value, task.frequency_type);

      // Build metadata with dependency-specific fields
      const taskId = `task-${assetUid}-dep-${Date.now()}-${i}`;
      const metadata = {
        description: task.description,
        asset_uid: assetUid,
        system_name: systemName,
        frequency_value: task.frequency_value,
        frequency_type: task.frequency_type,
        frequency_basis: task.frequency_basis || 'calendar',
        frequency_hours: frequencyHours,
        task_type: task.task_type,
        criticality: task.criticality || 'medium',
        review_status: 'pending',
        source: 'real_world', // Tag as real-world knowledge (LLM)
        confidence: task.confidence || 0.8,
        created_at: new Date().toISOString(),
        // Dependency-specific metadata
        related_system: task.related_system, // The system this task is performed on
        impact: task.impact, // What happens if this is skipped
        reasoning: task.reasoning // Why this dependency is critical
      };

      try {
        await pineconeRepository.upsertTask(taskId, embedding, metadata);
        dependencyUploadedCount++;
      } catch (error) {
        logger.error('Failed to upload dependency task', {
          task: task.description,
          error: error.message
        });
      }
    }

    logger.info('Dependency tasks uploaded', {
      assetUid,
      uploadedCount: dependencyUploadedCount,
      systemChain: dependencyResult.system_chain
    });

    // =================================================================
    // PART 2: CLASSIFY ALL TASKS (existing + discovered + dependencies)
    // =================================================================

    if (onProgress) {
      onProgress({ message: 'Fetching all tasks for classification...', progress: 60 });
    }

    // Step 6: Re-fetch ALL tasks for this system (now includes discovered + dependency tasks)
    const allRecordsNow = await pineconeRepository.listAllTasks();
    const allSystemTasks = allRecordsNow.filter(record =>
      record.metadata.asset_uid === assetUid &&
      !hiddenStatuses.includes(record.metadata.review_status)
    );

    logger.info(`Now have ${allSystemTasks.length} total tasks to classify`, {
      assetUid,
      existing: existingTasks.length,
      discovered: uploadedCount,
      dependencies: dependencyUploadedCount
    });

    let classifiedCount = 0;

    if (allSystemTasks.length > 0) {
      if (onProgress) {
        onProgress({ message: `Classifying ${allSystemTasks.length} tasks with LLM...`, progress: 65 });
      }

      // Build classification prompt
      const classifySystemPrompt = `You are a marine systems maintenance expert.
Classify each task into ONE category and determine if it's recurring.

Categories:
- MAINTENANCE: Recurring preventive maintenance with clear schedule
- INSTALLATION: One-time setup during commissioning
- PRE_USE_CHECK: Operational check before using equipment
- VAGUE: No clear frequency or actionable timeframe

Recurring vs One-Time:
- RECURRING: Tasks that repeat indefinitely (keywords: "every", "regularly", "periodically")
- ONE-TIME: Tasks that happen once (keywords: "first", "initial", "break-in", "commissioning")

Default to RECURRING if unclear.`;

      const tasksToClassify = allSystemTasks.map(record => ({
        id: record.id,
        description: record.metadata.description,
        frequency_value: record.metadata.frequency_value,
        frequency_type: record.metadata.frequency_type
      }));

      // BATCH CLASSIFICATION - Process in groups of 30 to avoid timeouts
      const BATCH_SIZE = 30;
      const allClassifications = [];

      for (let batchStart = 0; batchStart < tasksToClassify.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, tasksToClassify.length);
        const batch = tasksToClassify.slice(batchStart, batchEnd);
        const batchNumber = Math.floor(batchStart / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(tasksToClassify.length / BATCH_SIZE);

        logger.info(`Classifying batch ${batchNumber}/${totalBatches}`, {
          assetUid,
          batchSize: batch.length,
          range: `${batchStart + 1}-${batchEnd}`
        });

        if (onProgress) {
          onProgress({
            message: `Classifying batch ${batchNumber}/${totalBatches} (${batch.length} tasks)...`,
            progress: 65 + (batchStart / tasksToClassify.length) * 10
          });
        }

        const classifyUserPrompt = `System: ${systemName}

TASKS TO CLASSIFY (Batch ${batchNumber}/${totalBatches}):
${batch.map((t, i) => `${i + 1}. "${t.description}"
   Frequency: ${t.frequency_value ? `${t.frequency_value} ${t.frequency_type}` : 'N/A'}`).join('\n\n')}

Return ONLY valid JSON:
{
  "classifications": [
    {
      "task_number": 1,
      "category": "MAINTENANCE",
      "is_recurring": true,
      "confidence": 0.95,
      "reasoning": "Brief explanation"
    }
  ]
}`;

        // Rate limit
        if (rateLimiter) {
          await rateLimiter.waitForTurn('openai');
        }

        // Call LLM for this batch
        const classifyResult = await openaiRepository.classifyAndDiscoverTasks(classifySystemPrompt, classifyUserPrompt);

        logger.info(`Batch ${batchNumber}/${totalBatches} classification complete`, {
          assetUid,
          classifications: classifyResult.classifications?.length || 0
        });

        // Store classifications with adjusted task numbers
        if (classifyResult.classifications) {
          classifyResult.classifications.forEach(c => {
            allClassifications.push({
              ...c,
              task_number: c.task_number + batchStart  // Adjust for batch offset
            });
          });
        }
      }

      logger.info('All batches classified', {
        assetUid,
        totalClassifications: allClassifications.length,
        totalTasks: tasksToClassify.length
      });

      if (onProgress) {
        onProgress({ message: 'Applying classifications...', progress: 75 });
      }

      // Apply classifications
      for (let i = 0; i < tasksToClassify.length; i++) {
        const task = tasksToClassify[i];
        const classification = allClassifications.find(c => c.task_number === i + 1);

        if (!classification) {
          logger.warn('No classification for task', { taskId: task.id, taskNumber: i + 1 });
          continue;
        }

        const metadataUpdate = {
          task_category: classification.category,
          task_category_confidence: classification.confidence,
          task_category_reasoning: classification.reasoning,
          classified_at: new Date().toISOString()
        };

        if (classification.is_recurring !== undefined) {
          metadataUpdate.is_recurring = classification.is_recurring;
        }

        try {
          await pineconeRepository.updateTaskMetadata(task.id, metadataUpdate);
          classifiedCount++;
        } catch (error) {
          logger.error('Failed to update task metadata', {
            taskId: task.id,
            error: error.message
          });
        }
      }

      logger.info('Classifications applied', { assetUid, classifiedCount });
    } else {
      logger.warn('No tasks to classify (edge case: 0 existing + 0 discovered)', { assetUid });
    }

    if (onProgress) {
      onProgress({ message: 'Creating BoatOS tasks if needed...', progress: 85 });
    }

    // Step 7: Create BoatOS task if system has usage-based tasks
    let boatosTaskCreated = false;
    const hasUsageBasedTasks = existingTasks.some(t => t.frequency_basis === 'usage') ||
                               discoveredTasks.some(t => t.frequency_basis === 'usage') ||
                               dependencyTasks.some(t => t.frequency_basis === 'usage');

    if (hasUsageBasedTasks) {
      try {
        const needsTask = await boatosTasksService.needsHoursUpdateTask(assetUid);
        if (needsTask) {
          await boatosTasksService.createHoursUpdateTask(assetUid);
          boatosTaskCreated = true;
          logger.info('BoatOS hours update task created', { assetUid });
        }
      } catch (error) {
        logger.error('Failed to create BoatOS task', {
          assetUid,
          error: error.message
        });
      }
    }

    if (onProgress) {
      onProgress({ message: 'Classification and discovery complete!', progress: 100 });
    }

    const summary = {
      success: true,
      tasksClassified: classifiedCount,
      tasksDiscovered: uploadedCount,
      tasksDependencies: dependencyUploadedCount,
      boatosTaskCreated
    };

    logger.info('Step 6 completed', { assetUid, ...summary });

    return summary;

  } catch (error) {
    logger.error('Step 6 failed', {
      assetUid,
      error: error.message,
      stack: error.stack
    });

    throw error;
  }
}
