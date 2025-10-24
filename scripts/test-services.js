/**
 * Service Tests (Phase 3)
 * Tests business logic through service layer
 */

import systemMaintenanceService from '../src/services/system-maintenance.service.js';
import taskCompletionsService from '../src/services/task-completions.service.js';
import boatosTasksService from '../src/services/boatos-tasks.service.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('test-services');

// Test asset UID (must match setup-test-system.js)
const TEST_ASSET_UID = '00000000-0000-0000-0000-000000000999';

async function runTests() {
  console.log('\n🧪 Testing Phase 3: Services\n');

  let testsPassed = 0;
  let testsFailed = 0;

  // ===========================================
  // Test 1: Update Operating Hours (with validation)
  // ===========================================
  try {
    console.log('📝 Test 1: Update Operating Hours (Service Layer)...');

    const result = await systemMaintenanceService.updateOperatingHours({
      assetUid: TEST_ASSET_UID,
      hours: 200,
      submittedBy: 'test-service',
      notes: 'Service layer test',
      meterReplaced: false,
    });

    console.log('   ✅ Hours updated:', {
      current_hours: result.maintenanceState.current_operating_hours,
      previous_hours: result.previousHours,
      increment: result.hoursIncrement,
    });

    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed:', error.message);
    testsFailed++;
  }

  // ===========================================
  // Test 2: Validate Hours Update (should fail on decrease)
  // ===========================================
  try {
    console.log('📝 Test 2: Validate Hours Update (Should Detect Decrease)...');

    const validation = await systemMaintenanceService.validateHoursUpdate(
      TEST_ASSET_UID,
      50  // Lower than current 200
    );

    if (!validation.valid && validation.errors.length > 0) {
      console.log('   ✅ Validation correctly detected decrease:', validation.errors[0].message);
      testsPassed++;
    } else {
      console.error('   ❌ Validation should have failed but passed');
      testsFailed++;
    }
  } catch (error) {
    console.error('   ❌ Failed:', error.message);
    testsFailed++;
  }

  // ===========================================
  // Test 3: Get Maintenance State (with staleness)
  // ===========================================
  try {
    console.log('📝 Test 3: Get Maintenance State (with staleness calculation)...');

    const state = await systemMaintenanceService.getMaintenanceState(TEST_ASSET_UID);

    if (state) {
      console.log('   ✅ Retrieved state:', {
        current_hours: state.current_operating_hours,
        days_since_update: state.daysSinceUpdate,
        is_stale: state.isStale,
      });
      testsPassed++;
    } else {
      console.error('   ❌ No state found (expected after Test 1)');
      testsFailed++;
    }
  } catch (error) {
    console.error('   ❌ Failed:', error.message);
    testsFailed++;
  }

  // ===========================================
  // Test 4: Get Hours Statistics
  // ===========================================
  try {
    console.log('📝 Test 4: Get Hours Statistics...');

    const stats = await systemMaintenanceService.getHoursStatistics(TEST_ASSET_UID);

    console.log('   ✅ Retrieved statistics:', {
      current_hours: stats.currentHours,
      total_entries: stats.totalEntries,
      average_increment: stats.averageIncrement,
    });

    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed:', error.message);
    testsFailed++;
  }

  // ===========================================
  // Test 5: Create BoatOS Task (Service Layer)
  // ===========================================
  try {
    console.log('📝 Test 5: Create BoatOS Task (Service Layer)...');

    const task = await boatosTasksService.createHoursUpdateTask(TEST_ASSET_UID);

    console.log('   ✅ Created BoatOS task:', {
      id: task.id,
      next_due: task.next_due,
      frequency_days: task.frequency_days,
    });

    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed:', error.message);
    testsFailed++;
  }

  // ===========================================
  // Test 6: Calculate Due Status
  // ===========================================
  try {
    console.log('📝 Test 6: Calculate Task Due Status...');

    // Mock task metadata
    const mockTask = {
      metadata: {
        is_recurring: true,
        frequency_basis: 'usage',
        frequency_value: 50,
        next_due_hours: 250,
      },
    };

    const dueStatus = taskCompletionsService.calculateDueStatus(mockTask, 200);

    console.log('   ✅ Calculated due status:', {
      is_due: dueStatus.isDue,
      status: dueStatus.status,
      hours_until_due: dueStatus.hoursUntilDue,
    });

    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed:', error.message);
    testsFailed++;
  }

  // ===========================================
  // Test 7: Get BoatOS Task Statistics
  // ===========================================
  try {
    console.log('📝 Test 7: Get BoatOS Task Statistics...');

    const stats = await boatosTasksService.getTaskStatistics();

    console.log('   ✅ Retrieved statistics:', {
      total_due: stats.totalDue,
      recently_dismissed: stats.recentlyDismissed,
    });

    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed:', error.message);
    testsFailed++;
  }

  // ===========================================
  // Summary
  // ===========================================
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Service Tests Complete`);
  console.log(`   ✅ Passed: ${testsPassed}`);
  console.log(`   ❌ Failed: ${testsFailed}`);
  console.log(`   📈 Success Rate: ${Math.round((testsPassed / (testsPassed + testsFailed)) * 100)}%`);
  console.log('='.repeat(50) + '\n');

  return { testsPassed, testsFailed };
}

// Run tests
runTests()
  .then(({ testsPassed, testsFailed }) => {
    process.exit(testsFailed > 0 ? 1 : 0);
  })
  .catch(error => {
    console.error('❌ Test suite failed:', error);
    process.exit(1);
  });
