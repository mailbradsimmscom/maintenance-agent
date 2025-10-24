import { systemMaintenanceRepository } from '../src/repositories/system-maintenance.repository.js';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';

(async () => {
  // Get watermaker asset_uid from approved tasks
  const allTasks = await pineconeRepository.listAllTasks();
  const watermakerTask = allTasks.find(t => 
    t.metadata?.review_status === 'approved' && 
    t.metadata?.system_name?.toLowerCase().includes('watermaker')
  );
  
  if (!watermakerTask) {
    console.log('No watermaker tasks found');
    process.exit(1);
  }
  
  const assetUid = watermakerTask.metadata.asset_uid;
  console.log('Watermaker asset_uid:', assetUid);
  console.log('System name:', watermakerTask.metadata.system_name);
  console.log();
  console.log('Setting initial operating hours to 0...');
  
  await systemMaintenanceRepository.upsertMaintenanceState(assetUid, 0);
  
  console.log('✅ Operating hours initialized to 0h');
  console.log();
  console.log('Now usage-based tasks will appear in to-do list!');
  console.log('Refresh http://localhost:3001/todos.html to see all 4 approved tasks.');
  
  process.exit(0);
})();
