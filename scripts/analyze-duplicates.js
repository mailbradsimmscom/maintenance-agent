import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { analyzeDuplicates, deduplicateTasks } from '../src/services/task-deduplication.service.js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function analyzeTaskDuplicates() {
  console.log('📊 Analyzing Task Duplicates\n');
  console.log('='.repeat(60));

  // Fetch all pending tasks
  const { data: tasks, error } = await supabase
    .from('maintenance_tasks_queue')
    .select('*')
    .eq('status', 'pending')
    .order('system_name', { ascending: true });

  if (error) {
    console.error('❌ Error fetching tasks:', error.message);
    return;
  }

  console.log(`\n📋 Loaded ${tasks.length} pending tasks\n`);

  // Test different similarity thresholds
  const thresholds = [0.6, 0.7, 0.75, 0.8, 0.9];

  console.log('🔍 Testing Different Similarity Thresholds:\n');

  for (const threshold of thresholds) {
    const analysis = analyzeDuplicates(tasks, {
      textSimilarityThreshold: threshold,
      requireSameFrequency: true,
      requireSameSystem: true
    });

    console.log(`Threshold: ${(threshold * 100).toFixed(0)}%`);
    console.log(`  Duplicate groups: ${analysis.duplicateGroups}`);
    console.log(`  Duplicate tasks: ${analysis.duplicateTasks}`);
    console.log(`  Unique tasks: ${analysis.totalTasks - analysis.duplicateTasks}`);
    console.log(`  Reduction: ${((analysis.duplicateTasks / analysis.totalTasks) * 100).toFixed(1)}%`);
    console.log('');
  }

  // Use recommended threshold (75%)
  console.log('='.repeat(60));
  console.log('\n📊 Detailed Analysis (75% threshold):\n');

  const analysis = analyzeDuplicates(tasks, {
    textSimilarityThreshold: 0.75,
    requireSameFrequency: true,
    requireSameSystem: true
  });

  console.log(`Total tasks: ${analysis.totalTasks}`);
  console.log(`Duplicate groups: ${analysis.duplicateGroups}`);
  console.log(`Tasks that are duplicates: ${analysis.duplicateTasks}`);
  console.log(`Unique tasks after dedup: ${analysis.totalTasks - analysis.duplicateTasks}\n`);

  // Show duplicate groups
  if (analysis.groups.length > 0) {
    console.log('='.repeat(60));
    console.log('\n🔄 Duplicate Groups Found:\n');

    analysis.groups.forEach((group, idx) => {
      console.log(`\nGroup ${idx + 1} (${group.count} tasks):`);
      console.log('-'.repeat(60));
      group.tasks.forEach((task, taskIdx) => {
        console.log(`  ${taskIdx + 1}. [${task.system}] ${task.description}`);
        console.log(`     Frequency: ${task.frequency}`);
      });
    });
  } else {
    console.log('\n✅ No duplicates found at this threshold!\n');
  }

  // Run actual deduplication
  console.log('\n' + '='.repeat(60));
  console.log('\n🔧 Running Deduplication (75% threshold):\n');

  const result = deduplicateTasks(tasks, {
    textSimilarityThreshold: 0.75,
    requireSameFrequency: true,
    requireSameSystem: true
  });

  console.log(`Original tasks: ${result.stats.original}`);
  console.log(`Unique tasks: ${result.stats.unique}`);
  console.log(`Duplicates removed: ${result.stats.duplicates}`);
  console.log(`Reduction: ${result.stats.reductionPercent}%\n`);

  console.log('By System:');
  for (const [systemId, count] of Object.entries(result.stats.bySystem)) {
    const systemName = tasks.find(t => t.asset_uid === systemId)?.system_name || 'Unknown';
    console.log(`  ${systemName}: ${count} duplicates removed`);
  }

  // Show sample merged task with alternative sources
  const mergedTasks = result.uniqueTasks.filter(
    t => t.source_details?.alternativeSources && t.source_details.alternativeSources.length > 0
  );

  if (mergedTasks.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('\n📝 Sample Merged Task:\n');
    const sample = mergedTasks[0];
    console.log(`Description: ${sample.description}`);
    console.log(`System: ${sample.system_name}`);
    console.log(`Frequency: ${sample.frequency_value} ${sample.frequency_type}`);
    console.log(`Confidence: ${sample.confidence}`);
    console.log(`Parts: ${sample.parts_required?.join(', ') || 'None'}`);
    console.log(`\nPrimary Source:`);
    console.log(`  Doc ID: ${sample.source_details.doc_id?.substring(0, 16)}...`);
    console.log(`  Relevance: ${sample.source_details.relevance_score}`);
    console.log(`\nAlternative Sources (${sample.source_details.alternativeSources.length}):`);
    sample.source_details.alternativeSources.forEach((alt, idx) => {
      console.log(`  ${idx + 1}. Doc: ${alt.doc_id?.substring(0, 16)}... | Score: ${alt.relevance_score}`);
    });
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Analysis complete!\n');
}

// Run the analysis
analyzeTaskDuplicates().catch(console.error);
