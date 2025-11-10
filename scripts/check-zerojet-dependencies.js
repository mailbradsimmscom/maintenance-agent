/**
 * Check if ZeroJet dependency tasks were uploaded to Pinecone
 */

import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('check-zerojet-deps');

async function checkDependencies() {
  console.log('\n=== CHECKING ZEROJET DEPENDENCY TASKS ===\n');

  const zerojetAssetUid = 'd2084302-7190-480e-a255-eef83a24b09b';

  try {
    // Get all tasks for ZeroJet
    const allTasks = await pineconeRepository.listAllTasks();
    const zerojetTasks = allTasks.filter(record =>
      record.metadata.asset_uid === zerojetAssetUid
    );

    console.log(`Total tasks for ZeroJet: ${zerojetTasks.length}\n`);

    // Group by source
    const bySource = {};
    zerojetTasks.forEach(task => {
      const source = task.metadata.source || 'unknown';
      bySource[source] = (bySource[source] || 0) + 1;
    });

    console.log('Tasks by source:');
    Object.entries(bySource).forEach(([source, count]) => {
      console.log(`  ${source}: ${count}`);
    });

    // Look for dependency tasks (have related_system field)
    const dependencyTasks = zerojetTasks.filter(task =>
      task.metadata.related_system
    );

    console.log(`\nDependency tasks (with related_system): ${dependencyTasks.length}\n`);

    if (dependencyTasks.length > 0) {
      console.log('✅ DEPENDENCY TASKS FOUND:\n');
      dependencyTasks.forEach((task, i) => {
        console.log(`${i + 1}. ${task.metadata.description}`);
        console.log(`   Related System: ${task.metadata.related_system}`);
        console.log(`   Impact: ${task.metadata.impact || 'N/A'}`);
        console.log(`   Reasoning: ${task.metadata.reasoning || 'N/A'}`);
        console.log(`   Source: ${task.metadata.source}`);
        console.log(`   Confidence: ${task.metadata.confidence}`);
        console.log('');
      });
    } else {
      console.log('❌ NO DEPENDENCY TASKS FOUND\n');
      console.log('This means the upload failed before dependency tasks were saved.\n');

      // Show what tasks DO exist
      if (zerojetTasks.length > 0) {
        console.log('Existing tasks (first 5):');
        zerojetTasks.slice(0, 5).forEach((task, i) => {
          console.log(`  ${i + 1}. ${task.metadata.description?.substring(0, 80)}`);
          console.log(`     Source: ${task.metadata.source}`);
        });
      }
    }

    console.log('\n=== END CHECK ===\n');

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }

  process.exit(0);
}

checkDependencies();
