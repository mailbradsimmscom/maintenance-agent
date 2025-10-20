import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const auditLog = JSON.parse(readFileSync('test-results-1760984020550.json', 'utf-8'));
const tasks = JSON.parse(readFileSync('extracted_tasks_2025-10-19.json', 'utf-8'));

console.log('🔍 DIAGNOSTIC: Analyzing Why We Found So Few Duplicates\n');
console.log('='.repeat(80));

// Check Pass 1 decisions
const pass1 = auditLog.passes[0];

console.log(`\nPass 1 processed ${pass1.tasksProcessed} tasks`);
console.log(`Found ${pass1.duplicates} duplicates\n`);

// Analyze the inserted tasks - look for similar descriptions
const insertedTasks = pass1.decisions.filter(d => d.result === 'inserted');

console.log('Looking for potential missed duplicates among inserted tasks...\n');
console.log('='.repeat(80));

// Manual pattern matching
const patterns = {
  'oil': [],
  'check': [],
  'replace': [],
  'inspect': [],
  'clean': [],
  'filter': [],
  'engine': [],
  'gear': []
};

insertedTasks.forEach(task => {
  const desc = task.description.toLowerCase();
  Object.keys(patterns).forEach(pattern => {
    if (desc.includes(pattern)) {
      patterns[pattern].push({
        index: task.taskIndex,
        description: task.description,
        system: task.system,
        frequency: task.frequency,
        taskType: task.taskType
      });
    }
  });
});

// Show groups with multiple tasks
Object.entries(patterns).forEach(([pattern, matches]) => {
  if (matches.length > 1) {
    console.log(`\n📋 Pattern: "${pattern}" (${matches.length} tasks)`);
    console.log('-'.repeat(80));
    matches.forEach(m => {
      console.log(`[${m.index}] [${m.system}] ${m.description}`);
      console.log(`     Frequency: ${m.frequency}, Type: ${m.taskType}`);
    });
  }
});

console.log('\n' + '='.repeat(80));
console.log('\n💡 HYPOTHESIS: Compound logic too strict?\n');
console.log('Compound logic requires:');
console.log('  1. Similarity ≥80%');
console.log('  2. Frequency match (within 10%)');
console.log('  3. Task type match');
console.log('\nIf task types differ, even high similarity won\'t flag as duplicate.\n');

// Check task type distribution
const typeDistribution = {};
insertedTasks.forEach(task => {
  const type = task.taskType || 'unknown';
  if (!typeDistribution[type]) {
    typeDistribution[type] = 0;
  }
  typeDistribution[type]++;
});

console.log('Task Type Distribution:');
Object.entries(typeDistribution).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
  console.log(`  ${type}: ${count}`);
});

console.log('\n' + '='.repeat(80));
