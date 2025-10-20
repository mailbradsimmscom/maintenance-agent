import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import { openaiRepository } from '../src/repositories/openai.repository.js';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import { createLogger } from '../src/utils/logger.js';

dotenv.config();

const logger = createLogger('import-ai-enrichment');

/**
 * TASK TYPE DEFINITIONS
 */
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
 * Use GPT-4o-mini to classify task frequency_basis and task_type
 */
async function classifyTaskWithAI(task) {
  const prompt = `You are analyzing a maintenance task for a marine catamaran system.

TASK DESCRIPTION: "${task.description}"

FREQUENCY DATA:
- frequency_type: ${task.frequency_type || 'null'}
- frequency_value: ${task.frequency_value !== null ? task.frequency_value : 'null'}

Your job is to classify TWO things:

1. FREQUENCY BASIS - How is this task scheduled?
   Options:
   - "calendar": Time-based (every X days/months/years regardless of use)
   - "usage": Usage-based (every X operating hours, depends on equipment running)
   - "event": Triggered by specific events (startup, installation, winterization, boat lifting)
   - "condition": As-needed based on condition/inspection
   - "unknown": Cannot determine from information given

   Signals:
   - "hours" in frequency_type usually means USAGE (operating hours on equipment)
   - "days", "months", "years" in frequency_type means CALENDAR
   - "startup", "install", "commissioning" keywords mean EVENT
   - "as needed", "when necessary", "if required" mean CONDITION
   - "before operation", "after use" mean EVENT

2. TASK TYPE - What kind of maintenance is this?
   Options: ${TASK_TYPES.join(', ')}

   Definitions:
   - fluid_check: Checking fluid levels, inspecting for leaks
   - filter_replacement: Replacing or changing filters
   - visual_inspection: Visual examination of components
   - lubrication: Applying grease or lubricant
   - cleaning: Washing, flushing, draining
   - adjustment: Adjusting tension, clearance, alignment
   - parts_replacement: Replacing worn parts (anodes, belts, hoses, seals)
   - fluid_replacement: Changing fluids (oil, coolant, hydraulic)
   - condition_based: Tasks done as-needed, during storage/lifting

RESPOND WITH ONLY THIS JSON (no markdown, no explanation):
{
  "frequency_basis": "one of the options above",
  "task_type": "one of the options above",
  "reasoning": "brief explanation of your choices"
}`;

  try {
    const response = await openaiRepository.createChatCompletion([
      { role: 'system', content: 'You are a marine maintenance expert. Respond only with valid JSON.' },
      { role: 'user', content: prompt }
    ], {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 200
    });

    const jsonText = response.trim();
    const classification = JSON.parse(jsonText);

    logger.debug('AI classification', {
      description: task.description.substring(0, 50),
      classification
    });

    return classification;

  } catch (error) {
    logger.error('AI classification failed', {
      error: error.message,
      description: task.description.substring(0, 50)
    });

    // Fallback to safe defaults
    return {
      frequency_basis: 'unknown',
      task_type: 'condition_based',
      reasoning: 'AI classification failed, using defaults'
    };
  }
}

/**
 * Normalize frequency to hours (for range queries)
 * Returns null if cannot be normalized
 */
function normalizeFrequencyToHours(task) {
  // Can only normalize calendar and usage bases
  if (!['calendar', 'usage'].includes(task.frequency_basis)) {
    return null;
  }

  if (!task.frequency_type || task.frequency_value === null) {
    return null;
  }

  switch (task.frequency_type) {
    case 'hours':
      return task.frequency_value;
    case 'days':
      return task.frequency_value * 24;
    case 'months':
      return task.frequency_value * 30 * 24;
    case 'years':
      return task.frequency_value * 365 * 24;
    default:
      return null;
  }
}

/**
 * Main import function
 */
async function importWithAIEnrichment() {
  console.log('🚀 IMPORT WITH AI ENRICHMENT\n');
  console.log('='.repeat(80));

  // ============================================================
  // STEP 1: Load tasks from JSON
  // ============================================================
  console.log('\n📂 STEP 1: Loading tasks from JSON...\n');

  const tasksJson = readFileSync('extracted_tasks_2025-10-19.json', 'utf-8');
  const rawTasks = JSON.parse(tasksJson);

  console.log(`✅ Loaded ${rawTasks.length} tasks\n`);

  // ============================================================
  // STEP 2: Enrich each task with AI classification
  // ============================================================
  console.log('='.repeat(80));
  console.log('\n🤖 STEP 2: AI Classification (GPT-4o-mini)\n');

  const enrichedTasks = [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < rawTasks.length; i++) {
    const task = rawTasks[i];
    const elapsed = i > 0 ? `(${i}/${rawTasks.length})` : '';

    console.log(`${elapsed} Classifying: ${task.description.substring(0, 60)}...`);

    try {
      // Call AI for classification
      const aiClassification = await classifyTaskWithAI(task);

      // Build enriched task
      const enrichedTask = {
        // Core Identity
        asset_uid: task.asset_uid,
        system_name: task.system_name,

        // Frequency - The Triple
        frequency_value: task.frequency_value,
        frequency_type: task.frequency_type,
        frequency_basis: aiClassification.frequency_basis,

        // Normalized (for range queries)
        frequency_hours: null, // Will calculate after we have basis

        // Classification
        task_type: aiClassification.task_type,

        // Description - store FULL text
        description: task.description,

        // Original metadata (for reference)
        criticality: task.criticality,
        confidence: task.confidence,
        parts_required: task.parts_required,
        estimated_duration_hours: task.estimated_duration_hours,
        source_details: task.source_details,

        // Tracking
        created_at: Date.now(),
        source: 'manual_import',

        // AI reasoning (for debugging)
        ai_reasoning: aiClassification.reasoning
      };

      // Calculate normalized hours (now that we have basis)
      enrichedTask.frequency_hours = normalizeFrequencyToHours(enrichedTask);

      enrichedTasks.push(enrichedTask);
      successCount++;

      console.log(`  ✅ basis: ${aiClassification.frequency_basis}, type: ${aiClassification.task_type}`);

      // Rate limiting: small delay between AI calls
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      errorCount++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n✅ Classification complete: ${successCount} success, ${errorCount} errors\n`);

  // ============================================================
  // STEP 3: Generate embeddings for all tasks
  // ============================================================
  console.log('='.repeat(80));
  console.log('\n🔢 STEP 3: Generating embeddings...\n');

  const tasksWithEmbeddings = [];
  let embeddingCount = 0;

  for (let i = 0; i < enrichedTasks.length; i++) {
    const task = enrichedTasks[i];

    console.log(`[${i + 1}/${enrichedTasks.length}] Embedding: ${task.description.substring(0, 60)}...`);

    try {
      const embedding = await openaiRepository.createEmbedding(task.description);

      tasksWithEmbeddings.push({
        task,
        embedding
      });

      embeddingCount++;
      console.log(`  ✅ Generated (${embedding.length} dimensions)`);

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n✅ Embeddings generated: ${embeddingCount}/${enrichedTasks.length}\n`);

  // ============================================================
  // STEP 4: Load all tasks to Pinecone
  // ============================================================
  console.log('='.repeat(80));
  console.log('\n📤 STEP 4: Loading to Pinecone...\n');

  let uploadCount = 0;
  let uploadErrors = 0;

  for (let i = 0; i < tasksWithEmbeddings.length; i++) {
    const { task, embedding } = tasksWithEmbeddings[i];

    // Generate unique ID
    const pineconeId = `task-${Date.now()}-${i}`;

    console.log(`[${i + 1}/${tasksWithEmbeddings.length}] Uploading: ${task.description.substring(0, 60)}...`);

    try {
      // Build Pinecone metadata - only include non-null values
      const metadata = {
        // Core Identity (always present)
        task_id: pineconeId,
        asset_uid: task.asset_uid,
        system_name: task.system_name,
        description: task.description,

        // Classification (AI always returns these)
        frequency_basis: task.frequency_basis,
        task_type: task.task_type,

        // Tracking (always present)
        created_at: task.created_at,
        source: task.source,
        source_index: i
      };

      // Conditionally add frequency fields (only if not null)
      if (task.frequency_value !== null) {
        metadata.frequency_value = task.frequency_value;
      }
      if (task.frequency_type !== null) {
        metadata.frequency_type = task.frequency_type;
      }
      if (task.frequency_hours !== null) {
        metadata.frequency_hours = task.frequency_hours;
      }

      // Conditionally add other metadata
      if (task.criticality) {
        metadata.criticality = task.criticality;
      }
      if (task.confidence) {
        metadata.confidence = task.confidence;
      }

      // Upsert to Pinecone
      await pineconeRepository.upsertTask(pineconeId, embedding, metadata);

      uploadCount++;
      console.log(`  ✅ Uploaded (ID: ${pineconeId})`);

      // Small delay between uploads
      await new Promise(resolve => setTimeout(resolve, 50));

    } catch (error) {
      console.error(`  ❌ Upload failed: ${error.message}`);
      uploadErrors++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n✅ Upload complete: ${uploadCount} uploaded, ${uploadErrors} errors\n`);

  // ============================================================
  // FINAL SUMMARY
  // ============================================================
  console.log('='.repeat(80));
  console.log('\n🎯 FINAL SUMMARY\n');
  console.log(`Total tasks loaded:     ${rawTasks.length}`);
  console.log(`AI classification:      ${successCount} success, ${errorCount} errors`);
  console.log(`Embeddings generated:   ${embeddingCount}`);
  console.log(`Uploaded to Pinecone:   ${uploadCount}`);
  console.log(`\n✅ Import complete!\n`);

  // Show frequency_basis distribution
  console.log('='.repeat(80));
  console.log('\n📊 FREQUENCY BASIS DISTRIBUTION\n');
  const basisCounts = {};
  enrichedTasks.forEach(t => {
    basisCounts[t.frequency_basis] = (basisCounts[t.frequency_basis] || 0) + 1;
  });
  Object.entries(basisCounts).forEach(([basis, count]) => {
    console.log(`  ${basis}: ${count}`);
  });

  // Show task_type distribution
  console.log('\n📊 TASK TYPE DISTRIBUTION\n');
  const typeCounts = {};
  enrichedTasks.forEach(t => {
    typeCounts[t.task_type] = (typeCounts[t.task_type] || 0) + 1;
  });
  Object.entries(typeCounts).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

  console.log('\n' + '='.repeat(80) + '\n');
}

// Run the import
importWithAIEnrichment().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
