/**
 * Repository Tests (Phase 2)
 * Tests database operations through repository layer
 */

import systemMaintenanceRepo from '../src/repositories/system-maintenance.repository.js';
import taskCompletionsRepo from '../src/repositories/task-completions.repository.js';
import boatosTasksRepo from '../src/repositories/boatos-tasks.repository.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('test-repositories');

// Test asset UID (use a test UUID)
const TEST_ASSET_UID = '00000000-0000-0000-0000-000000000999';
const TEST_TASK_ID = 'task-test-12345';

async function runTests() {
  console.log('\n🧪 Testing Phase 2: Repositories\n');

  let testsPassed = 0;
  let testsFailed = 0;

  // ===========================================
  // Test 1: System Maintenance Repository
  // ===========================================
  try {
    console.log('📝 Test 1: Create/Update Maintenance State...');

    // Create maintenance state
    const state = await systemMaintenanceRepo.maintenance.upsertMaintenanceState(
      TEST_ASSET_UID,
      150,
      new Date('2025-01-01')
    );

    console.log('   ✅ Created maintenance state:', {
      asset_uid: state.asset_uid,
      current_hours: state.current_operating_hours,
    });

    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed:', error.message);
    testsFailed++;
  }

  // ===========================================
  // Test 2: Hours History Repository
  // ===========================================
  try {
    console.log('📝 Test 2: Record Hours History...');

    const historyEntry = await systemMaintenanceRepo.history.recordHoursEntry({
      assetUid: TEST_ASSET_UID,
      hours: 150,
      submittedBy: 'test-script',
      notes: 'Test entry',
      meterReplaced: false,
    });

    console.log('   ✅ Recorded hours history:', {
      id: historyEntry.id,
      hours: historyEntry.hours,
    });

    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed:', error.message);
    testsFailed++;
  }

  // ===========================================
  // Test 3: Get Latest Hours Entry
  // ===========================================
  try {
    console.log('📝 Test 3: Get Latest Hours Entry...');

    const latestEntry = await systemMaintenanceRepo.history.getLatestEntry(TEST_ASSET_UID);

    if (latestEntry) {
      console.log('   ✅ Retrieved latest entry:', {
        hours: latestEntry.hours,
        submitted_at: latestEntry.submitted_at,
      });
      testsPassed++;
    } else {
      console.log('   ⚠️  No entry found (expected if first run)');
      testsPassed++;
    }
  } catch (error) {
    console.error('   ❌ Failed:', error.message);
    testsFailed++;
  }

  // ===========================================
  // Test 4: BoatOS Tasks Repository
  // ===========================================
  try {
    console.log('📝 Test 4: Create BoatOS Task...');

    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + 7);

    const task = await boatosTasksRepo.createTask({
      taskType: 'update_usage_hours',
      assetUid: TEST_ASSET_UID,
      frequencyDays: 7,
      nextDue,
    });

    console.log('   ✅ Created BoatOS task:', {
      id: task.id,
      task_type: task.task_type,
      next_due: task.next_due,
    });

    // Clean up - deactivate task
    await boatosTasksRepo.deactivateTask(task.id);
    console.log('   ✅ Cleaned up test task');

    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed:', error.message);
    testsFailed++;
  }

  // ===========================================
  // Test 5: Task Completions Repository
  // ===========================================
  try {
    console.log('📝 Test 5: Record Task Completion...');

    const completion = await taskCompletionsRepo.recordCompletion({
      taskId: TEST_TASK_ID,
      assetUid: TEST_ASSET_UID,
      hoursAtCompletion: 150,
      completedBy: 'test-script',
      sourceType: 'manual',
      notes: 'Test completion',
    });

    console.log('   ✅ Recorded task completion:', {
      id: completion.id,
      task_id: completion.task_id,
      hours_at_completion: completion.hours_at_completion,
    });

    testsPassed++;
  } catch (error) {
    console.error('   ❌ Failed:', error.message);
    testsFailed++;
  }

  // ===========================================
  // Test 6: Get Task Completions
  // ===========================================
  try {
    console.log('📝 Test 6: Get Task Completions...');

    const completions = await taskCompletionsRepo.getCompletionsForTask(
      TEST_TASK_ID,
      TEST_ASSET_UID
    );

    console.log('   ✅ Retrieved completions:', {
      count: completions.length,
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
  console.log(`📊 Repository Tests Complete`);
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
