#!/usr/bin/env node

/**
 * Check Pinecone for tasks marked as duplicates
 */

import { pineconeRepository } from '../src/repositories/pinecone.repository.js';

console.log('🔍 Checking Pinecone for duplicate metadata...\n');

try {
  // Fetch all tasks
  const allTasks = await pineconeRepository.listAllTasks();

  // Find tasks marked as duplicates
  const duplicates = allTasks.filter(t => t.metadata?.is_duplicate === true);

  console.log(`Total tasks: ${allTasks.length}`);
  console.log(`Tasks marked as duplicate: ${duplicates.length}\n`);

  if (duplicates.length > 0) {
    console.log('Duplicate tasks found:\n');
    duplicates.forEach((task, idx) => {
      const m = task.metadata;
      console.log(`${idx + 1}. ${task.id}`);
      console.log(`   Description: ${m.description?.substring(0, 60)}...`);
      console.log(`   Review Status: ${m.review_status}`);
      console.log(`   Duplicate Of: ${m.duplicate_of || 'N/A (both marked invalid)'}`);
      console.log(`   Deduplicated At: ${m.deduplicated_at || 'N/A'}`);
      console.log('');
    });

    // Count by review status
    const byStatus = {};
    duplicates.forEach(t => {
      const status = t.metadata.review_status || 'unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;
    });

    console.log('Breakdown by review status:');
    Object.entries(byStatus).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
  } else {
    console.log('No duplicate tasks found in Pinecone.');
  }

  process.exit(0);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
