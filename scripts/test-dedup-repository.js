#!/usr/bin/env node

/**
 * Test Deduplication Review Repository
 * Verifies database connectivity and basic CRUD operations
 */

import dotenv from 'dotenv';
import deduplicationReviewRepository from '../src/repositories/deduplication-review.repository.js';

dotenv.config();

console.log('🧪 Testing Deduplication Review Repository\n');
console.log('='.repeat(80));

async function testRepository() {
  try {
    // Test 1: Create Analysis Run
    console.log('\n1️⃣ Creating test analysis run...');
    const analysisId = await deduplicationReviewRepository.createAnalysisRun({
      analysis_date: new Date().toISOString(),
      total_tasks: 100,
      duplicate_pairs_found: 5,
      duplicate_groups_found: 4,
      thresholds: {
        semantic: { min: 0.65, highConfidence: 0.75 },
        frequency: { tight: 0.10, medium: 0.15, loose: 0.20 }
      },
      filters: { systemFilter: 'watermaker', assetUidFilter: null }
    });
    console.log(`✅ Created analysis: ${analysisId}`);

    // Test 2: Save Duplicate Pairs
    console.log('\n2️⃣ Saving test duplicate pairs...');
    const testPairs = [
      {
        taskA: {
          id: 'task-test-001',
          description: 'Clean watermaker filters',
          system_name: 'Watermaker',
          asset_uid: 'test-asset-123',
          frequency_hours: 500,
          frequency_basis: 'usage',
          task_type: 'maintenance'
        },
        taskB: {
          id: 'task-test-002',
          description: 'Clean watermaker filter elements',
          system_name: 'Watermaker',
          asset_uid: 'test-asset-123',
          frequency_hours: 500,
          frequency_basis: 'usage',
          task_type: 'maintenance'
        },
        similarity_score: 0.92,
        reason: 'semantic_and_frequency_match',
        warning: null
      },
      {
        taskA: {
          id: 'task-test-003',
          description: 'Inspect hull anodes',
          system_name: 'Hull',
          asset_uid: 'test-asset-123',
          frequency_hours: 2000,
          frequency_basis: 'usage',
          task_type: 'inspection'
        },
        taskB: {
          id: 'task-test-004',
          description: 'Check hull zincs',
          system_name: 'Hull',
          asset_uid: 'test-asset-123',
          frequency_hours: 2000,
          frequency_basis: 'usage',
          task_type: 'inspection'
        },
        similarity_score: 0.78,
        reason: 'semantic_and_frequency_match',
        warning: null
      }
    ];

    const savedCount = await deduplicationReviewRepository.bulkSavePairs(
      analysisId,
      testPairs
    );
    console.log(`✅ Saved ${savedCount} duplicate pairs`);

    // Test 3: Get Pending Reviews
    console.log('\n3️⃣ Fetching pending reviews...');
    const pendingReviews = await deduplicationReviewRepository.getPendingReviews(10, 0);
    console.log(`✅ Found ${pendingReviews.length} pending reviews`);
    if (pendingReviews.length > 0) {
      const first = pendingReviews[0];
      console.log(`   First review: "${first.task1_description}" vs "${first.task2_description}"`);
      console.log(`   Similarity: ${(first.similarity_score * 100).toFixed(1)}%`);
    }

    // Test 4: Get Review Stats
    console.log('\n4️⃣ Getting review statistics...');
    const stats = await deduplicationReviewRepository.getReviewStats();
    console.log(`✅ Stats:`, stats);

    // Test 5: Update Review Status
    if (pendingReviews.length > 0) {
      console.log('\n5️⃣ Updating review status...');
      const reviewId = pendingReviews[0].id;
      const updated = await deduplicationReviewRepository.updateReviewStatus(
        reviewId,
        'keep_both',
        'These are different tasks',
        'test-user'
      );
      console.log(`✅ Updated review ${reviewId} to status: ${updated.review_status}`);
    }

    // Test 6: Get Recent Analyses
    console.log('\n6️⃣ Fetching recent analyses...');
    const recentAnalyses = await deduplicationReviewRepository.getRecentAnalyses(5);
    console.log(`✅ Found ${recentAnalyses.length} recent analyses`);
    recentAnalyses.forEach((analysis, idx) => {
      console.log(`   ${idx + 1}. ${analysis.analysis_date} - ${analysis.duplicate_pairs_found} pairs found`);
    });

    // Test 7: Cleanup - Delete Test Analysis
    console.log('\n7️⃣ Cleaning up test data...');
    await deduplicationReviewRepository.deleteAnalysis(analysisId);
    console.log(`✅ Deleted test analysis ${analysisId}`);

    console.log('\n' + '='.repeat(80));
    console.log('\n✅ All tests passed!\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testRepository();
