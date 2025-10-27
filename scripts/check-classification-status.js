/**
 * Check classification status for all systems
 */

import { pineconeRepository } from '../src/repositories/pinecone.repository.js';
import { createLogger } from '../src/utils/logger.js';

const logger = createLogger('check-classification');

async function checkClassificationStatus() {
  try {
    const allTasks = await pineconeRepository.listAllTasks();

    // Group by system and check for category field
    const systemStats = {};

    allTasks.forEach(task => {
      const systemName = task.metadata?.system_name || 'UNKNOWN';
      if (!systemStats[systemName]) {
        systemStats[systemName] = {
          total: 0,
          classified: 0,
          hasCategory: 0,
          categories: {}
        };
      }

      systemStats[systemName].total++;

      // Check if task has category field (from Step 6 classification)
      if (task.metadata?.category) {
        systemStats[systemName].hasCategory++;
        const cat = task.metadata.category;
        systemStats[systemName].categories[cat] = (systemStats[systemName].categories[cat] || 0) + 1;
      }

      // Check if task has task_category field (from Step 6 classification)
      if (task.metadata?.task_category) {
        systemStats[systemName].classified++;
      }
    });

    console.log('\n=== CLASSIFICATION STATUS BY SYSTEM ===\n');

    console.log('Systems WITH Step 6 classification (task_category field):');
    Object.entries(systemStats)
      .filter(([_, stats]) => stats.classified > 0)
      .sort((a, b) => b[1].total - a[1].total)
      .forEach(([system, stats]) => {
        console.log(`  📊 ${system}:`);
        console.log(`     Total tasks: ${stats.total}`);
        console.log(`     Classified: ${stats.classified} (${Math.round(stats.classified/stats.total * 100)}%)`);
        if (Object.keys(stats.categories).length > 0) {
          console.log(`     Categories:`);
          Object.entries(stats.categories).forEach(([cat, count]) => {
            console.log(`       - ${cat}: ${count}`);
          });
        }
      });

    console.log('\nSystems WITHOUT Step 6 classification:');
    Object.entries(systemStats)
      .filter(([_, stats]) => stats.classified === 0)
      .sort((a, b) => b[1].total - a[1].total)
      .forEach(([system, stats]) => {
        console.log(`  ❌ ${system}: ${stats.total} tasks (0% classified)`);
      });

    // Summary
    const totalSystems = Object.keys(systemStats).length;
    const classifiedSystems = Object.values(systemStats).filter(s => s.classified > 0).length;
    const totalTasks = allTasks.length;
    const classifiedTasks = Object.values(systemStats).reduce((sum, s) => sum + s.classified, 0);

    console.log('\n=== SUMMARY ===');
    console.log(`Total systems: ${totalSystems}`);
    console.log(`Systems with classification: ${classifiedSystems}/${totalSystems} (${Math.round(classifiedSystems/totalSystems * 100)}%)`);
    console.log(`Total tasks: ${totalTasks}`);
    console.log(`Tasks classified: ${classifiedTasks}/${totalTasks} (${Math.round(classifiedTasks/totalTasks * 100)}%)`);

    // Check for discovery
    const discoveredTasks = allTasks.filter(t => t.metadata?.source === 'real_world');
    console.log(`\n=== DISCOVERY STATUS ===`);
    console.log(`Tasks from manuals: ${totalTasks - discoveredTasks.length}`);
    console.log(`Tasks discovered (Step 6 with discovery ON): ${discoveredTasks.length}`);

    if (discoveredTasks.length === 0) {
      console.log('⚠️  NO DISCOVERED TASKS - Step 6 discovery is OFF or hasn\'t been run');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
  process.exit(0);
}

checkClassificationStatus();