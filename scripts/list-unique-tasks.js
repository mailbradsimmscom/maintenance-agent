import { pineconeRepository } from '../src/repositories/pinecone.repository.js';

const duplicateIds = [
  'task-1760989879656-3',
  'task-1760989879798-4',
  'task-1760989880238-7',
  'task-1760989880531-9',
  'task-1760989880665-10',
  'task-1760989881315-15',
  'task-1760989883971-35',
  'task-1760989886050-50'
];

const records = await pineconeRepository.listAllTasks();

const uniqueTasks = records
  .filter(r => !duplicateIds.includes(r.id))
  .map(r => ({
    id: r.id,
    description: r.metadata.description,
    frequency_basis: r.metadata.frequency_basis,
    frequency_type: r.metadata.frequency_type || null,
    frequency_value: r.metadata.frequency_value || null,
    system_name: r.metadata.system_name,
    task_type: r.metadata.task_type
  }));

console.log('60 UNIQUE TASKS REMAINING AFTER DEDUPLICATION:\n');
console.log('='.repeat(100) + '\n');

uniqueTasks.forEach((task, idx) => {
  console.log(`${idx + 1}. [${task.id}]`);
  console.log(`   Description: ${task.description}`);
  console.log(`   System: ${task.system_name}`);
  console.log(`   Frequency: ${task.frequency_value || 'N/A'} ${task.frequency_type || ''} (Basis: ${task.frequency_basis})`);
  console.log(`   Type: ${task.task_type}`);
  console.log('');
});

console.log('='.repeat(100));
console.log(`\nTotal unique tasks: ${uniqueTasks.length}\n`);

process.exit(0);
