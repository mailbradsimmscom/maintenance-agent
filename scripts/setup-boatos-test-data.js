/**
 * Setup BoatOS Test Data
 * Creates proper test entries in boatos_tasks table for the 2 test systems
 *
 * Usage: node scripts/setup-boatos-test-data.js
 */

import boatosTasksService from '../src/services/boatos-tasks.service.js';
import systemMaintenanceRepo from '../src/repositories/system-maintenance.repository.js';
import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../src/config/env.js';

const config = getConfig();

// Initialize Supabase client
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey
);

// Test systems with usage-based tasks
const TEST_SYSTEMS = [
  {
    name: 'Schenker Zen 150 watermaker 48V',
    asset_uid: 'd0cbc03e-ad33-47c8-84b7-92b41d319727',
    initial_hours: 0, // Start at 0 hours for testing
  },
  {
    name: '57 hp diesel engine (PORT)',
    asset_uid: '6747bcaf-5c31-e12f-8947-37fce290ab47',
    initial_hours: 100, // Start at 100 hours for testing
  }
];

async function setupTestData() {
  console.log('🔧 SETUP BOATOS TEST DATA\n');
  console.log('='.repeat(80));
  console.log('\n');

  // Step 1: Clean up existing test data
  console.log('📥 Step 1: Cleaning up existing test data...\n');

  try {
    const { error } = await supabase
      .from('boatos_tasks')
      .delete()
      .in('asset_uid', TEST_SYSTEMS.map(s => s.asset_uid));

    if (error) {
      console.log(`⚠️  No existing data to clean: ${error.message}`);
    } else {
      console.log('✅ Existing test data deleted\n');
    }
  } catch (error) {
    console.log(`⚠️  Error during cleanup: ${error.message}\n`);
  }

  // Step 2: Initialize system maintenance state (current hours)
  console.log('='.repeat(80));
  console.log('\n📊 Step 2: Initializing system maintenance state...\n');

  for (const system of TEST_SYSTEMS) {
    try {
      console.log(`${system.name}`);
      console.log(`  UID: ${system.asset_uid}`);
      console.log(`  Initial hours: ${system.initial_hours}h`);

      await systemMaintenanceRepo.maintenance.upsertMaintenanceState(
        system.asset_uid,
        system.initial_hours
      );

      console.log('  ✅ Maintenance state initialized\n');
    } catch (error) {
      console.error(`  ❌ Failed: ${error.message}\n`);
    }
  }

  // Step 3: Create BoatOS tasks
  console.log('='.repeat(80));
  console.log('\n🔔 Step 3: Creating BoatOS hours update tasks...\n');

  for (const system of TEST_SYSTEMS) {
    try {
      console.log(`${system.name}`);
      console.log(`  UID: ${system.asset_uid}`);

      const task = await boatosTasksService.createHoursUpdateTask(system.asset_uid);

      console.log(`  ✅ BoatOS task created`);
      console.log(`     Task ID: ${task.id}`);
      console.log(`     Next due: ${task.next_due}`);
      console.log(`     Frequency: Every ${task.frequency_days} days`);
      console.log(`     Status: ${task.is_active ? 'Active' : 'Inactive'}\n`);
    } catch (error) {
      console.error(`  ❌ Failed: ${error.message}\n`);
    }
  }

  // Step 4: Verify
  console.log('='.repeat(80));
  console.log('\n✅ VERIFICATION\n');

  const { data, error } = await supabase
    .from('boatos_tasks')
    .select('*')
    .in('asset_uid', TEST_SYSTEMS.map(s => s.asset_uid))
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`❌ Verification failed: ${error.message}`);
  } else {
    console.log(`Total BoatOS tasks created: ${data.length}`);
    console.log('');

    data.forEach((task, i) => {
      const system = TEST_SYSTEMS.find(s => s.asset_uid === task.asset_uid);
      console.log(`[${i + 1}] ${system.name}`);
      console.log(`    ID: ${task.id}`);
      console.log(`    Active: ${task.is_active}`);
      console.log(`    Next due: ${task.next_due}`);
      console.log('');
    });
  }

  console.log('='.repeat(80));
  console.log('\n🎉 SETUP COMPLETE!\n');
  console.log('You can now test the UX at:');
  console.log('  - http://localhost:3001/todos.html (to-do list)');
  console.log('  - http://localhost:3001/hours-update.html (update hours)');
  console.log('');
  console.log('='.repeat(80) + '\n');

  process.exit(0);
}

// Run
setupTestData().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
