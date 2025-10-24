import { systemMaintenanceRepository } from '../src/repositories/system-maintenance.repository.js';

const WATERMAKER_ASSET_UID = '5de71e93-91d0-7e77-7f2c-deeaea6f2c73'; // Replace with actual UID

(async () => {
  console.log('Setting initial operating hours for watermaker...');
  
  await systemMaintenanceRepository.maintenance.updateOperatingHours(
    WATERMAKER_ASSET_UID,
    0, // Starting at 0 hours
    'Initial setup'
  );
  
  console.log('✅ Operating hours set to 0h');
  console.log('Now usage-based tasks will show in to-do list when due!');
  
  process.exit(0);
})();
