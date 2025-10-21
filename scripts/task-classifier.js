/**
 * Task Classifier
 * Classifies maintenance tasks into categories and updates Pinecone metadata
 *
 * Categories:
 * - INSTALLATION: One-time setup during commissioning
 * - PRE_USE_CHECK: Operational check before using equipment
 * - VAGUE: No clear frequency or actionable timeframe
 * - MAINTENANCE: Recurring preventive maintenance with clear schedule
 */

import dotenv from 'dotenv';
import OpenAI from 'openai';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import { getConfig } from '../src/config/env.js';

dotenv.config();

const config = getConfig();
const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * Classification prompt for OpenAI
 */
const CLASSIFICATION_PROMPT = `You are a maintenance task classifier. Analyze the task and classify it into ONE category:

**INSTALLATION**: One-time setup during initial commissioning or installation
- Examples: "Install the membrane", "Connect inlet hose", "Mount the unit", "Initial setup"
- Keywords: install, mount, connect (initial), commission, set up, place, position

**PRE_USE_CHECK**: Operational check performed before using equipment
- Examples: "Check pressure before starting", "Verify flow before operation", "Inspect before use"
- Keywords: before use, prior to operation, pre-start, startup procedure, before turning on

**VAGUE**: No clear frequency or actionable timeframe
- Examples: "Inspect regularly", "Monitor as needed", "Check periodically", "Maintain as required"
- Keywords: regularly, periodically, as needed, as required, monitor (with no interval)

**MAINTENANCE**: Recurring preventive maintenance with clear schedule
- Examples: "Replace filter every 6 months", "Clean strainer every 100 hours", "Service annually"
- Must have: Specific frequency (hours, days, months, years, events)

Respond ONLY with valid JSON in this exact format:
{
  "category": "MAINTENANCE",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this category was chosen"
}`;

/**
 * Classify a single task using OpenAI
 */
async function classifyTask(task) {
  const userPrompt = `Task Description: "${task.description}"

Metadata:
- Frequency: ${task.frequency_value ? `${task.frequency_value} ${task.frequency_type}` : 'N/A'}
- Frequency Basis: ${task.frequency_basis}
- Task Type: ${task.task_type}

Classify this task.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Use gpt-4o-mini explicitly (supports temperature)
      messages: [
        { role: 'system', content: CLASSIFICATION_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content);

    // Validate category
    const validCategories = ['INSTALLATION', 'PRE_USE_CHECK', 'VAGUE', 'MAINTENANCE'];
    if (!validCategories.includes(result.category)) {
      console.warn(`⚠️  Invalid category "${result.category}" for task ${task.id}, defaulting to VAGUE`);
      result.category = 'VAGUE';
    }

    return result;
  } catch (error) {
    console.error(`❌ Classification failed for task ${task.id}:`, error.message);
    return {
      category: 'VAGUE',
      confidence: 0,
      reasoning: 'Classification failed'
    };
  }
}

/**
 * Main classification workflow
 */
async function classifyAllTasks() {
  console.log('🔍 TASK CLASSIFICATION\n');
  console.log('='.repeat(80));
  console.log('Fetching all tasks from Pinecone...\n');

  // Fetch all tasks
  const records = await pineconeRepository.listAllTasks();
  console.log(`✅ Fetched ${records.length} tasks\n`);

  // Transform to simpler format
  const tasks = records.map(record => ({
    id: record.id,
    description: record.metadata.description,
    frequency_value: record.metadata.frequency_value ?? null,
    frequency_type: record.metadata.frequency_type ?? null,
    frequency_basis: record.metadata.frequency_basis,
    task_type: record.metadata.task_type,
    system_name: record.metadata.system_name
  }));

  console.log('='.repeat(80));
  console.log('\n🤖 Starting classification with OpenAI...\n');

  const results = {
    INSTALLATION: [],
    PRE_USE_CHECK: [],
    VAGUE: [],
    MAINTENANCE: []
  };

  let processed = 0;
  const total = tasks.length;

  for (const task of tasks) {
    processed++;
    console.log(`[${processed}/${total}] Classifying: ${task.id}`);
    console.log(`   Description: "${task.description.substring(0, 70)}..."`);

    // Classify with OpenAI
    const classification = await classifyTask(task);

    console.log(`   Category: ${classification.category} (confidence: ${(classification.confidence * 100).toFixed(0)}%)`);
    console.log(`   Reasoning: ${classification.reasoning}`);

    // Update Pinecone metadata
    try {
      await pineconeRepository.updateTaskMetadata(task.id, {
        task_category: classification.category,
        task_category_confidence: classification.confidence,
        task_category_reasoning: classification.reasoning,
        classified_at: new Date().toISOString()
      });
      console.log(`   ✅ Metadata updated in Pinecone\n`);
    } catch (error) {
      console.error(`   ❌ Failed to update metadata: ${error.message}\n`);
    }

    // Track results
    results[classification.category].push({
      id: task.id,
      description: task.description,
      system_name: task.system_name,
      confidence: classification.confidence
    });

    // Rate limiting: 1 request per second
    if (processed < total) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Print summary
  console.log('='.repeat(80));
  console.log('\n📊 CLASSIFICATION SUMMARY\n');
  console.log(`Total tasks classified: ${total}\n`);

  Object.entries(results).forEach(([category, tasks]) => {
    const percentage = ((tasks.length / total) * 100).toFixed(1);
    console.log(`${category}: ${tasks.length} tasks (${percentage}%)`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('\n📋 BREAKDOWN BY CATEGORY\n');

  Object.entries(results).forEach(([category, tasks]) => {
    if (tasks.length === 0) return;

    console.log(`\n${category} (${tasks.length} tasks):`);
    console.log('-'.repeat(80));

    tasks.forEach((task, idx) => {
      console.log(`${idx + 1}. [${task.id}] ${task.system_name}`);
      console.log(`   "${task.description.substring(0, 90)}..."`);
      console.log(`   Confidence: ${(task.confidence * 100).toFixed(0)}%\n`);
    });
  });

  console.log('='.repeat(80));
  console.log('\n✅ Classification complete!\n');
  console.log('Next steps:');
  console.log('1. Review the classification results above');
  console.log('2. Open http://localhost:3000/public/maintenance-tasks-list.html to browse by category');
  console.log('3. Use the category filter to review each type\n');
  console.log('='.repeat(80) + '\n');

  return results;
}

// Main execution
async function main() {
  try {
    await classifyAllTasks();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
