import { pineconeRepository } from '../src/repositories/pinecone.repository.js';

(async () => {
  const allTasks = await pineconeRepository.listAllTasks();
  
  // Filter watermaker tasks
  const watermakerTasks = allTasks.filter(t => {
    const name = t.metadata?.system_name?.toLowerCase() || '';
    return name.includes('water') || name.includes('maker');
  });
  
  console.log('=== WATERMAKER TASKS ===');
  console.log('Total watermaker tasks:', watermakerTasks.length);
  
  const withRecurring = watermakerTasks.filter(t => {
    return t.metadata?.is_recurring != null;
  });
  const recurring = watermakerTasks.filter(t => t.metadata?.is_recurring === true);
  const oneTime = watermakerTasks.filter(t => t.metadata?.is_recurring === false);
  
  console.log('With is_recurring data:', withRecurring.length);
  console.log('  - Recurring (true):', recurring.length);
  console.log('  - One-time (false):', oneTime.length);
  console.log('Without is_recurring data:', watermakerTasks.length - withRecurring.length);
  
  // Show all unique system names
  const systems = [...new Set(allTasks.map(t => t.metadata?.system_name))].filter(Boolean).sort();
  console.log('\n=== ALL SYSTEMS IN PINECONE (Total: ' + systems.length + ') ===');
  systems.forEach(s => console.log('-', s));
  
  process.exit(0);
})();
