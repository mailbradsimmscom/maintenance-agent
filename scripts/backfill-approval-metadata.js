/**
 * ONE-TIME BACKFILL SCRIPT
 *
 * Adds approval workflow metadata to existing tasks in Pinecone
 *
 * This script:
 * 1. Fetches all existing tasks from Pinecone MAINTENANCE_TASKS namespace
 * 2. Checks if they already have the new approval metadata fields
 * 3. If missing, adds these fields with default values:
 *    - is_recurring: null (will be populated by Step 6)
 *    - review_status: "pending" (awaiting human approval)
 *    - reviewed_at: null
 *    - reviewed_by: null
 *    - review_notes: null
 *    - last_completed_at: null
 *    - last_completed_hours: null
 *    - next_due_hours: null (will be calculated after approval)
 *    - next_due_date: null
 *    - is_completed: false
 * 4. Re-upserts to Pinecone (preserves ID and embeddings)
 *
 * Run once before using the approval workflow.
 */

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index(process.env.PINECONE_INDEX_NAME || process.env.PINECONE_INDEX);
const namespace = index.namespace('MAINTENANCE_TASKS');

// New metadata fields to add (only non-null values - Pinecone doesn't support null)
const NEW_FIELDS = {
  review_status: 'pending',        // Awaiting human approval
  is_completed: false
};

// Note: Other fields will be added later when they have actual values:
// - is_recurring: Added by Step 6 (AI classification)
// - reviewed_at, reviewed_by, review_notes: Added when approved
// - last_completed_at, last_completed_hours: Added when task completed
// - next_due_hours, next_due_date: Added after approval

async function backfillApprovalMetadata() {
  console.log('🔄 Backfill Approval Metadata to Existing Tasks\n');
  console.log('This will add 10 new fields to all tasks in Pinecone');
  console.log('Existing tasks will be set to review_status="pending"\n');

  let allVectors = [];
  let paginationToken = undefined;
  let page = 1;

  // Step 1: Get all task IDs
  console.log('📋 Step 1: Fetching all task IDs from Pinecone...\n');

  do {
    const listResponse = await namespace.listPaginated({
      prefix: 'task-',
      limit: 100,
      paginationToken
    });

    if (listResponse.vectors) {
      allVectors.push(...listResponse.vectors);
      console.log(`  Page ${page}: Found ${listResponse.vectors.length} tasks (Total: ${allVectors.length})`);
      page++;
    }

    paginationToken = listResponse.pagination?.next;
  } while (paginationToken);

  console.log(`\n✅ Found ${allVectors.length} total tasks\n`);

  if (allVectors.length === 0) {
    console.log('⚠️  No tasks found. Nothing to backfill.');
    return;
  }

  // Step 2: Fetch full records with metadata
  console.log('📦 Step 2: Fetching full task records...\n');
  const taskIds = allVectors.map(v => v.id);
  const fetchResponse = await namespace.fetch(taskIds);
  const records = Object.values(fetchResponse.records || {});

  console.log(`✅ Fetched ${records.length} task records\n`);

  // Step 3: Check and update each task
  console.log('🔄 Step 3: Checking and updating tasks...\n');

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const taskNum = i + 1;

    try {
      // Check if already has new fields
      const hasNewFields = record.metadata.hasOwnProperty('review_status');

      if (hasNewFields) {
        console.log(`[${taskNum}/${records.length}] SKIP: ${record.id.substring(0, 30)}... (already has new fields)`);
        skippedCount++;
        continue;
      }

      // Add new fields
      const updatedMetadata = {
        ...record.metadata,
        ...NEW_FIELDS
      };

      // Re-upsert with updated metadata (preserve ID and embeddings)
      await namespace.upsert([{
        id: record.id,
        values: record.values,  // IMPORTANT: Preserve embeddings
        metadata: updatedMetadata
      }]);

      console.log(`[${taskNum}/${records.length}] ✅ UPDATED: ${record.id.substring(0, 30)}...`);
      updatedCount++;

      // Small delay to avoid rate limits
      if (updatedCount % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error) {
      console.log(`[${taskNum}/${records.length}] ❌ ERROR: ${record.id} - ${error.message}`);
      errorCount++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 BACKFILL SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total tasks:       ${records.length}`);
  console.log(`✅ Updated:        ${updatedCount}`);
  console.log(`⏭️  Skipped:        ${skippedCount} (already had fields)`);
  console.log(`❌ Errors:         ${errorCount}`);
  console.log('='.repeat(60));

  if (updatedCount > 0) {
    console.log('\n✅ Backfill complete!');
    console.log('\nNext steps:');
    console.log('1. Re-run Step 6 to populate is_recurring field');
    console.log('2. Open http://localhost:3001/approvals.html to approve tasks');
    console.log('3. After approval, tasks will show in the microservice cards');
  } else {
    console.log('\n⚠️  No tasks were updated. All tasks already have the new fields.');
  }
}

// Run the backfill
backfillApprovalMetadata().catch(error => {
  console.error('\n❌ Backfill failed:', error);
  process.exit(1);
});
