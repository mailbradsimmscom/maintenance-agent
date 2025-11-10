/**
 * Check how much training data we have from Step 5 reviews
 */

import db from '../src/repositories/supabase.repository.js';

async function checkTrainingData() {
  console.log('\n=== CHECKING STEP 5 TRAINING DATA ===\n');

  try {
    // Total reviews
    const { count: totalCount, error: totalError } = await db.client
      .from('deduplication_reviews')
      .select('*', { count: 'exact', head: true });

    if (totalError) {
      console.error('Error counting total reviews:', totalError);
      return;
    }

    console.log(`Total review records: ${totalCount}\n`);

    // Breakdown by status
    const { data: byStatus, error: statusError } = await db.client
      .from('deduplication_reviews')
      .select('review_status');

    if (statusError) {
      console.error('Error fetching review statuses:', statusError);
      return;
    }

    const statusCounts = {};
    byStatus.forEach(r => {
      const status = r.review_status || 'null';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    console.log('Breakdown by decision:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    // Count reviewed (not pending)
    const reviewed = byStatus.filter(r => r.review_status !== 'pending').length;
    console.log(`\nReviewed (training data): ${reviewed}`);
    console.log(`Still pending: ${statusCounts.pending || 0}\n`);

    // Get some sample decisions
    const { data: samples, error: samplesError } = await db.client
      .from('deduplication_reviews')
      .select('review_status, similarity_score, task1_description, task2_description, reviewed_at')
      .not('review_status', 'eq', 'pending')
      .order('reviewed_at', { ascending: false })
      .limit(5);

    if (!samplesError && samples && samples.length > 0) {
      console.log('Recent review samples:');
      samples.forEach((s, i) => {
        console.log(`\n${i + 1}. Decision: ${s.review_status}`);
        console.log(`   Similarity: ${(s.similarity_score * 100).toFixed(1)}%`);
        console.log(`   Task 1: ${s.task1_description?.substring(0, 60)}...`);
        console.log(`   Task 2: ${s.task2_description?.substring(0, 60)}...`);
        console.log(`   Reviewed: ${s.reviewed_at ? new Date(s.reviewed_at).toLocaleString() : 'N/A'}`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('\n=== END ===\n');
  process.exit(0);
}

checkTrainingData();
