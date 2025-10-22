/**
 * Classify & Discover - Batched Classification + Real-World Discovery
 *
 * For a single system:
 * 1. Classify all existing tasks (MAINTENANCE/INSTALLATION/PRE_USE_CHECK/VAGUE)
 * 2. Discover missing tasks based on industry best practices
 *
 * Usage: node scripts/classify-and-discover.js --system "Schenker"
 */

import dotenv from 'dotenv';
import OpenAI from 'openai';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import { getConfig } from '../src/config/env.js';

dotenv.config();

const config = getConfig();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

// Get system name and asset_uid from command line args
const args = process.argv.slice(2);
const systemFlag = args.findIndex(arg => arg === '--system');
const assetUidFlag = args.findIndex(arg => arg === '--asset-uid');

const systemName = systemFlag !== -1 ? args[systemFlag + 1] : null;
const assetUid = assetUidFlag !== -1 ? args[assetUidFlag + 1] : null;

if (!systemName && !assetUid) {
  console.error('❌ Error: --system or --asset-uid flag required');
  console.log('Usage: node scripts/classify-and-discover.js --system "Schenker"');
  console.log('   or: node scripts/classify-and-discover.js --asset-uid "abc-123"');
  console.log('   or: node scripts/classify-and-discover.js --system "Schenker" --asset-uid "abc-123"');
  process.exit(1);
}

/**
 * Main workflow
 */
async function classifyAndDiscover() {
  console.log('🔍 CLASSIFY & DISCOVER\n');
  console.log('='.repeat(80));
  if (systemName) console.log(`System: ${systemName}`);
  if (assetUid) console.log(`Asset UID: ${assetUid}`);
  console.log('');

  // Step 1: Fetch all tasks for this system
  console.log('📥 Fetching tasks from Pinecone...\n');
  const allRecords = await pineconeRepository.listAllTasks();

  // Filter by system name and/or asset_uid
  let systemRecords = allRecords;

  if (systemName) {
    systemRecords = systemRecords.filter(record =>
      record.metadata.system_name?.toLowerCase().includes(systemName.toLowerCase())
    );
  }

  if (assetUid) {
    systemRecords = systemRecords.filter(record =>
      record.metadata.asset_uid === assetUid
    );
  }

  if (systemRecords.length === 0) {
    console.error(`❌ No tasks found for the specified filters`);
    if (systemName) console.error(`   System: "${systemName}"`);
    if (assetUid) console.error(`   Asset UID: "${assetUid}"`);
    process.exit(1);
  }

  const filterDesc = [systemName, assetUid].filter(Boolean).join(' / ');
  console.log(`✅ Found ${systemRecords.length} existing tasks for ${filterDesc}\n`);

  // Transform to task format
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

  // Step 2: Build combined prompt
  console.log('🤖 Sending to OpenAI (classification + discovery)...\n');

  const systemPrompt = `You are a marine systems maintenance expert. You will:
1. Classify existing maintenance tasks into categories
2. Discover missing tasks based on industry best practices

Categories:
- MAINTENANCE: Recurring preventive maintenance with clear schedule
- INSTALLATION: One-time setup during commissioning
- PRE_USE_CHECK: Operational check before using equipment
- VAGUE: No clear frequency or actionable timeframe`;

  const userPrompt = `System: ${existingTasks[0]?.system_name || systemName}

EXISTING TASKS (classify these):
${existingTasks.map((t, i) => `${i + 1}. "${t.description}"
   Frequency: ${t.frequency_value ? `${t.frequency_value} ${t.frequency_type}` : 'N/A'}
   Basis: ${t.frequency_basis}
   Task Type: ${t.task_type}`).join('\n\n')}

INSTRUCTIONS:
1. Classify each existing task above into ONE category (MAINTENANCE, INSTALLATION, PRE_USE_CHECK, VAGUE)
2. Then, based on industry best practices, identify 3-5 MISSING maintenance tasks for this system that are:
   - Not already listed above
   - Common in real-world operations
   - Often omitted from manuals
   - Focus on: preventive measures, environmental considerations, integration points, common failure points

Return ONLY valid JSON in this EXACT format:
{
  "classifications": [
    {
      "task_number": 1,
      "category": "MAINTENANCE",
      "confidence": 0.95,
      "reasoning": "Brief explanation"
    }
  ],
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

  // Send to OpenAI
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0,
    response_format: { type: "json_object" }
  });

  const result = JSON.parse(response.choices[0].message.content);

  // Step 3: Process classifications
  console.log('='.repeat(80));
  console.log('\n📊 CLASSIFICATION RESULTS\n');

  let classifiedCount = 0;
  for (let i = 0; i < existingTasks.length; i++) {
    const task = existingTasks[i];
    const classification = result.classifications.find(c => c.task_number === i + 1);

    if (!classification) {
      console.warn(`⚠️  No classification for task ${i + 1}`);
      continue;
    }

    console.log(`[${i + 1}/${existingTasks.length}] ${task.id}`);
    console.log(`   Description: "${task.description.substring(0, 60)}..."`);
    console.log(`   Category: ${classification.category} (${(classification.confidence * 100).toFixed(0)}%)`);
    console.log(`   Reasoning: ${classification.reasoning}`);

    // Update Pinecone metadata
    try {
      await pineconeRepository.updateTaskMetadata(task.id, {
        task_category: classification.category,
        task_category_confidence: classification.confidence,
        task_category_reasoning: classification.reasoning,
        classified_at: new Date().toISOString()
      });
      console.log(`   ✅ Metadata updated\n`);
      classifiedCount++;
    } catch (error) {
      console.error(`   ❌ Failed to update: ${error.message}\n`);
    }
  }

  // Step 4: Process discovered tasks
  console.log('='.repeat(80));
  console.log('\n🔎 DISCOVERED TASKS (Missing from Manual)\n');

  const discoveredTasks = result.discovered_tasks || [];
  console.log(`Found ${discoveredTasks.length} new tasks\n`);

  let uploadedCount = 0;
  for (let i = 0; i < discoveredTasks.length; i++) {
    const task = discoveredTasks[i];

    console.log(`[${i + 1}/${discoveredTasks.length}] NEW TASK`);
    console.log(`   Description: "${task.description}"`);
    console.log(`   Frequency: ${task.frequency_value} ${task.frequency_type}`);
    console.log(`   Criticality: ${task.criticality}`);
    console.log(`   Confidence: ${(task.confidence * 100).toFixed(0)}%`);
    console.log(`   Reasoning: ${task.reasoning}`);

    // Generate embedding for the task (use text-embedding-3-large for 3072 dimensions)
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',  // 3072 dimensions (matches existing tasks)
      input: task.description
    });
    const embedding = embeddingResponse.data[0].embedding;

    // Calculate frequency in hours
    const frequencyHours = calculateFrequencyHours(task.frequency_value, task.frequency_type);

    // Prepare metadata (matching Pinecone format)
    const taskId = `task-discovered-${Date.now()}-${i}`;
    const metadata = {
      description: task.description,
      asset_uid: existingTasks[0]?.asset_uid || 'unknown',
      system_name: existingTasks[0]?.system_name || systemName,
      frequency_value: task.frequency_value,
      frequency_type: task.frequency_type,
      frequency_basis: task.frequency_basis,
      frequency_hours: frequencyHours,
      task_type: task.task_type,
      criticality: task.criticality,
      confidence: task.confidence,
      source: 'real_world', // Mark as discovered
      task_category: 'MAINTENANCE', // All discovered tasks are maintenance
      task_category_confidence: task.confidence,
      task_category_reasoning: task.reasoning,
      classified_at: new Date().toISOString()
    };

    // Upload to Pinecone
    try {
      await pineconeRepository.upsertTask(taskId, embedding, metadata);
      console.log(`   ✅ Uploaded to Pinecone\n`);
      uploadedCount++;
    } catch (error) {
      console.error(`   ❌ Failed to upload: ${error.message}\n`);
    }
  }

  // Summary
  console.log('='.repeat(80));
  console.log('\n✅ SUMMARY\n');
  console.log(`Filters: ${filterDesc}`);
  console.log(`Existing tasks classified: ${classifiedCount}/${existingTasks.length}`);
  console.log(`New tasks discovered: ${uploadedCount}/${discoveredTasks.length}`);
  console.log(`Total tasks in Pinecone: ${existingTasks.length + uploadedCount}`);
  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Calculate frequency in hours
 */
function calculateFrequencyHours(value, unit) {
  if (!value || !unit) return null;

  const conversions = {
    'hours': 1,
    'days': 24,
    'weeks': 168,
    'months': 730, // ~30.4 days
    'years': 8760
  };

  return value * (conversions[unit] || 1);
}

// Run
classifyAndDiscover().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
