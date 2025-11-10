/**
 * Analyze Step 5 training data to recommend better thresholds
 */

import db from '../src/repositories/supabase.repository.js';

async function analyzeThresholds() {
  console.log('\n=== ANALYZING DEDUPLICATION THRESHOLDS ===\n');

  try {
    // Get all reviewed pairs (not pending)
    const { data: reviews, error } = await db.client
      .from('deduplication_reviews')
      .select('review_status, similarity_score, task1_description, task2_description')
      .not('review_status', 'eq', 'pending')
      .order('similarity_score', { ascending: false });

    if (error) {
      console.error('Error:', error);
      return;
    }

    if (!reviews || reviews.length === 0) {
      console.log('No reviewed data found.');
      return;
    }

    console.log(`Analyzing ${reviews.length} reviewed pairs...\n`);

    // Group by decision
    const byDecision = {
      delete_both: [],
      delete_task1: [],
      delete_task2: [],
      keep_both: []
    };

    reviews.forEach(r => {
      if (byDecision[r.review_status]) {
        byDecision[r.review_status].push(r.similarity_score);
      }
    });

    // Calculate stats for each decision
    console.log('SIMILARITY SCORE STATISTICS BY DECISION:\n');

    Object.entries(byDecision).forEach(([decision, scores]) => {
      if (scores.length === 0) return;

      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const min = Math.min(...scores);
      const max = Math.max(...scores);

      console.log(`${decision}:`);
      console.log(`  Count: ${scores.length}`);
      console.log(`  Avg similarity: ${(avg * 100).toFixed(1)}%`);
      console.log(`  Range: ${(min * 100).toFixed(1)}% - ${(max * 100).toFixed(1)}%`);
      console.log('');
    });

    // Combine all "delete" decisions
    const allDeletes = [
      ...byDecision.delete_both,
      ...byDecision.delete_task1,
      ...byDecision.delete_task2
    ];

    const allKeeps = byDecision.keep_both;

    console.log('\n=== AGGREGATED ANALYSIS ===\n');

    if (allDeletes.length > 0) {
      const avgDelete = allDeletes.reduce((a, b) => a + b, 0) / allDeletes.length;
      const minDelete = Math.min(...allDeletes);
      const maxDelete = Math.max(...allDeletes);

      console.log(`DELETE decisions (${allDeletes.length} pairs):`);
      console.log(`  Avg similarity: ${(avgDelete * 100).toFixed(1)}%`);
      console.log(`  Range: ${(minDelete * 100).toFixed(1)}% - ${(maxDelete * 100).toFixed(1)}%`);
    }

    if (allKeeps.length > 0) {
      const avgKeep = allKeeps.reduce((a, b) => a + b, 0) / allKeeps.length;
      const minKeep = Math.min(...allKeeps);
      const maxKeep = Math.max(...allKeeps);

      console.log(`\nKEEP_BOTH decisions (${allKeeps.length} pairs):`);
      console.log(`  Avg similarity: ${(avgKeep * 100).toFixed(1)}%`);
      console.log(`  Range: ${(minKeep * 100).toFixed(1)}% - ${(maxKeep * 100).toFixed(1)}%`);
    }

    // Find decision boundary
    console.log('\n=== THRESHOLD RECOMMENDATIONS ===\n');

    console.log('Current thresholds:');
    console.log('  Step 4 (auto-hide): ≥85%');
    console.log('  Step 5 (manual review): 65-85%');
    console.log('');

    if (allDeletes.length > 0 && allKeeps.length > 0) {
      const avgDelete = allDeletes.reduce((a, b) => a + b, 0) / allDeletes.length;
      const avgKeep = allKeeps.reduce((a, b) => a + b, 0) / allKeeps.length;
      const maxKeep = Math.max(...allKeeps);

      // Calculate percentage of deletes vs keeps at different thresholds
      const testThresholds = [0.70, 0.75, 0.80, 0.85];

      console.log('What if we changed Step 4 auto-hide threshold?\n');

      testThresholds.forEach(threshold => {
        const deletesAbove = allDeletes.filter(s => s >= threshold).length;
        const keepsAbove = allKeeps.filter(s => s >= threshold).length;
        const totalAbove = deletesAbove + keepsAbove;

        if (totalAbove === 0) return;

        const deleteRate = (deletesAbove / totalAbove * 100).toFixed(1);

        console.log(`At ${(threshold * 100)}% threshold:`);
        console.log(`  ${deletesAbove} deletes + ${keepsAbove} keeps = ${totalAbove} total`);
        console.log(`  ${deleteRate}% would be correctly auto-hidden`);

        if (keepsAbove > 0) {
          console.log(`  ⚠️  ${keepsAbove} false positive(s) - would hide pairs user wanted to keep`);
        }
        console.log('');
      });

      // Recommendation
      console.log('\n📊 RECOMMENDATION:\n');

      if (avgDelete > 0.80 && maxKeep < 0.80) {
        console.log(`✅ Consider lowering Step 4 threshold to 80%`);
        console.log(`   Rationale: Average DELETE decision is ${(avgDelete * 100).toFixed(1)}%`);
        console.log(`   and highest KEEP_BOTH is ${(maxKeep * 100).toFixed(1)}%`);
        console.log(`   This would reduce manual review load with low false positive risk.`);
      } else if (maxKeep >= 0.80) {
        console.log(`⚠️  Keep current 85% threshold`);
        console.log(`   Rationale: Some KEEP_BOTH decisions are at ${(maxKeep * 100).toFixed(1)}%`);
        console.log(`   Lowering threshold risks false positives.`);
      } else {
        console.log(`📈 Need more data (only ${reviews.length} samples)`);
        console.log(`   Collect 50-100 reviews before adjusting thresholds.`);
      }

    } else {
      console.log('⚠️  Not enough data in both categories to make recommendation.');
      console.log('Need examples of both DELETE and KEEP_BOTH decisions.');
    }

    // Show distribution
    console.log('\n=== SIMILARITY SCORE DISTRIBUTION ===\n');

    const allScores = reviews.map(r => r.similarity_score).sort((a, b) => b - a);
    const bins = [0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.0];

    console.log('Score Range | Count | Decisions');
    console.log('------------|-------|----------');

    for (let i = 0; i < bins.length - 1; i++) {
      const min = bins[i];
      const max = bins[i + 1];
      const inRange = reviews.filter(r => r.similarity_score >= min && r.similarity_score < max);

      if (inRange.length === 0) continue;

      const decisions = {};
      inRange.forEach(r => {
        decisions[r.review_status] = (decisions[r.review_status] || 0) + 1;
      });

      const decisionsStr = Object.entries(decisions)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');

      console.log(`${(min * 100).toFixed(0)}-${(max * 100).toFixed(0)}%     | ${inRange.length.toString().padStart(5)} | ${decisionsStr}`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }

  console.log('\n=== END ===\n');
  process.exit(0);
}

analyzeThresholds();
