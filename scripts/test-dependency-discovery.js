/**
 * Test Script: Dependency Discovery
 *
 * Tests the LLM prompt for discovering cross-system maintenance dependencies
 *
 * Usage:
 *   node scripts/test-dependency-discovery.js "Air Conditioner"
 *   node scripts/test-dependency-discovery.js --asset-uid <uuid>
 */

import OpenAI from 'openai';
import { getConfig } from '../src/config/env.js';
import { createLogger } from '../src/utils/logger.js';
import supabaseRepository from '../src/repositories/supabase.repository.js';

const config = getConfig();
const logger = createLogger('test-dependency-discovery');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

/**
 * Test dependency discovery for a system
 */
async function testDependencyDiscovery(systemInfo) {
  const { systemName, manufacturer, model, assetUid } = systemInfo;

  console.log('\n' + '='.repeat(80));
  console.log('🧪 TESTING DEPENDENCY DISCOVERY');
  console.log('='.repeat(80));
  console.log(`System: ${systemName}`);
  console.log(`Manufacturer: ${manufacturer || 'Unknown'}`);
  console.log(`Model: ${model || 'Unknown'}`);
  if (assetUid) console.log(`Asset UID: ${assetUid}`);
  console.log('='.repeat(80) + '\n');

  // The prompt to test
  const systemPrompt = `You are a marine systems maintenance expert with deep knowledge of yacht systems integration.

Your specialty: Understanding how systems depend on each other and what maintenance prevents cascading failures.`;

  const userPrompt = `System: ${systemName}
Manufacturer: ${manufacturer || 'Unknown'}
Model: ${model || 'Unknown'}

Your task: Identify maintenance on OTHER systems that directly affects this system's reliability.

Think about the complete system chain:
- What upstream systems feed this one? (power, water, fuel, air, data)
- What supporting infrastructure does it need? (pumps, filters, strainers, valves)
- What environmental factors require maintenance? (seawater exposure, engine heat, vibration)
- What shared resources could fail? (electrical panels, plumbing, cooling loops)

Focus on HIGH-IMPACT dependencies:
- Maintenance that if skipped, causes THIS system to fail
- Tasks often overlooked because they're on a "different" system
- Cross-system checks that prevent expensive repairs

EXAMPLES to guide your thinking:

Air Conditioner depends on:
- "Clean seawater strainer for AC cooling loop" (strainer blockage → AC overheating)
- "Inspect raw water pump impeller serving AC" (weak flow → poor cooling)
- "Verify shore power voltage at AC breaker" (low voltage → compressor failure)
- "Clear condensate drain line" (blockage → water damage to AC controls)

Water Maker depends on:
- "Service high-pressure pump seals" (leak → system shutdown)
- "Clean pre-filter cartridges" (clogging → membrane damage)
- "Test raw water intake strainer" (blockage → pump cavitation)
- "Monitor DC voltage at water maker panel" (voltage drop → unreliable operation)

Diesel Engine depends on:
- "Service fuel polishing system filters" (dirty fuel → injector damage)
- "Inspect raw water intake through-hull" (marine growth → overheating)
- "Check engine room ventilation fans" (poor airflow → high temps)
- "Test seawater strainer for engine cooling" (blockage → catastrophic overheat)

Now identify 3-7 dependency maintenance tasks for: ${systemName}

Return ONLY valid JSON:
{
  "dependency_tasks": [
    {
      "description": "Clear, specific task description including what system it's on",
      "related_system": "Name of the system this task is performed on",
      "impact": "What happens to ${systemName} if this maintenance is skipped",
      "frequency_value": 14,
      "frequency_type": "days",
      "frequency_basis": "calendar",
      "task_type": "inspection",
      "criticality": "high",
      "confidence": 0.85,
      "reasoning": "Why this dependency is critical"
    }
  ],
  "system_chain": "Brief description of how this system integrates with others"
}`;

  console.log('📤 PROMPT BEING SENT TO LLM:');
  console.log('-'.repeat(80));
  console.log(userPrompt);
  console.log('-'.repeat(80) + '\n');

  try {
    console.log('⏳ Calling OpenAI API...\n');

    const startTime = Date.now();
    const response = await openai.chat.completions.create({
      model: config.openai.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4, // Lower = more consistent, higher = more creative
      response_format: { type: 'json_object' },
    });
    const duration = Date.now() - startTime;

    const result = JSON.parse(response.choices[0].message.content);

    console.log('✅ LLM RESPONSE RECEIVED');
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`💰 Tokens: ${response.usage.total_tokens} (prompt: ${response.usage.prompt_tokens}, completion: ${response.usage.completion_tokens})`);
    console.log('\n' + '='.repeat(80));
    console.log('📋 DISCOVERED DEPENDENCY TASKS');
    console.log('='.repeat(80) + '\n');

    if (result.system_chain) {
      console.log('🔗 System Integration Chain:');
      console.log(`   ${result.system_chain}\n`);
    }

    if (result.dependency_tasks && result.dependency_tasks.length > 0) {
      result.dependency_tasks.forEach((task, index) => {
        console.log(`${index + 1}. ${task.description}`);
        console.log(`   Related System: ${task.related_system}`);
        console.log(`   Impact: ${task.impact || 'N/A'}`);
        console.log(`   Frequency: Every ${task.frequency_value} ${task.frequency_type} (${task.frequency_basis})`);
        console.log(`   Type: ${task.task_type} | Criticality: ${task.criticality} | Confidence: ${task.confidence}`);
        console.log(`   Reasoning: ${task.reasoning}`);
        console.log('');
      });

      console.log('='.repeat(80));
      console.log(`✅ Found ${result.dependency_tasks.length} dependency tasks`);
      console.log('='.repeat(80) + '\n');

      // Show raw JSON
      console.log('📄 RAW JSON RESPONSE:');
      console.log('-'.repeat(80));
      console.log(JSON.stringify(result, null, 2));
      console.log('-'.repeat(80) + '\n');

    } else {
      console.log('⚠️  No dependency tasks found\n');
    }

    return result;

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  let systemInfo = {};

  // Check if --asset-uid flag provided
  const assetUidIndex = args.indexOf('--asset-uid');
  if (assetUidIndex !== -1 && args[assetUidIndex + 1]) {
    const assetUid = args[assetUidIndex + 1];

    console.log(`\n🔍 Looking up system with asset_uid: ${assetUid}\n`);

    const db = supabaseRepository.getDb();
    const { data: system, error } = await db.client
      .from('systems')
      .select('asset_uid, description, manufacturer_norm, model_norm, system_norm')
      .eq('asset_uid', assetUid)
      .single();

    if (error || !system) {
      console.error('❌ System not found:', error?.message || 'No system with that asset_uid');
      process.exit(1);
    }

    systemInfo = {
      assetUid: system.asset_uid,
      systemName: system.description || system.system_norm || 'Unknown System',
      manufacturer: system.manufacturer_norm,
      model: system.model_norm,
    };

  } else if (args.length > 0) {
    // Use command line argument as system name
    systemInfo = {
      systemName: args.join(' '),
      manufacturer: 'Unknown',
      model: 'Unknown',
    };
  } else {
    // Default test case
    console.log('ℹ️  No system specified, using default test case\n');
    systemInfo = {
      systemName: 'Dometic Marine Air Conditioner 16000 BTU',
      manufacturer: 'Dometic',
      model: '16000 BTU',
    };
  }

  await testDependencyDiscovery(systemInfo);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
