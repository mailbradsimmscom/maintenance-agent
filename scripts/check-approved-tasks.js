import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import { systemMaintenanceRepository } from '../src/repositories/system-maintenance.repository.js';

(async () => {
  const allTasks = await pineconeRepository.listAllTasks();
  
  // Get approved tasks
  const approved = allTasks.filter(t => t.metadata?.review_status === 'approved');
  
  console.log('=== APPROVED TASKS ===');
  console.log('Total approved:', approved.length);
  console.log();
  
  // Get current hours for watermaker
  const watermakerAssetUid = approved[0]?.metadata?.asset_uid;
  let currentHours = null;
  
  if (watermakerAssetUid) {
    try {
      const state = await systemMaintenanceRepository.maintenance.getMaintenanceState(watermakerAssetUid);
      currentHours = state?.current_operating_hours || 0;
      console.log(`Watermaker current hours: ${currentHours}h`);
    } catch (error) {
      console.log('No operating hours tracked yet');
    }
  }
  
  console.log();
  approved.forEach((task, i) => {
    const m = task.metadata;
    const frequencyHours = m.frequency_hours || 0;
    const hoursUntilDue = currentHours !== null ? (frequencyHours - currentHours) : '?';
    
    console.log(`${i+1}. ${m.description}`);
    console.log(`   Frequency: ${m.frequency_value} ${m.frequency_type} (${frequencyHours}h)`);
    console.log(`   Basis: ${m.frequency_basis}`);
    console.log(`   Hours until due: ${hoursUntilDue}h`);
    console.log(`   Is Recurring: ${m.is_recurring}`);
    console.log();
  });
  
  process.exit(0);
})();
