import { readFileSync, writeFileSync } from 'fs';
import dotenv from 'dotenv';
import {
  classifyTaskType,
  generateTaskEmbedding,
  normalizeFrequencyToHours,
  areFrequenciesSimilar
} from '../src/services/task-embedding.service.js';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';

dotenv.config();

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Check task against Pinecone (using real queries)
 */
async function checkAgainstPinecone(task, embedding, threshold = 0.80) {
  try {
    // Build filter - ONLY filter by asset_uid (objective)
    // Do NOT filter by task_type (AI-assigned, subjective, inconsistent)
    const filter = {};
    if (task.asset_uid) {
      filter.asset_uid = { $eq: task.asset_uid };
    }

    // DEBUG: Log query filters
    console.log(`    🔍 Querying with filter:`, JSON.stringify(filter));

    // Query Pinecone
    const results = await pineconeRepository.queryTasks(embedding, filter, 5);

    // DEBUG: Log what Pinecone returned
    if (results.length > 0) {
      console.log(`    📊 Pinecone returned ${results.length} results, top score: ${(results[0].score * 100).toFixed(1)}%`);
    } else {
      console.log(`    ⚠️  Pinecone returned NO results`);
    }

    // Filter by threshold
    const matches = results.filter(r => r.score >= threshold);

    if (matches.length === 0) {
      return { action: 'insert', matches: [] };
    }

    const bestMatch = matches[0];

    // Check frequency match
    const taskFreqHours = normalizeFrequencyToHours(task);
    const matchFreqHours = bestMatch.metadata.frequency_hours;
    const frequenciesMatch = areFrequenciesSimilar(taskFreqHours, matchFreqHours);

    // DEBUG: Log frequency comparison
    console.log(`    📊 Frequency: task=${taskFreqHours}hrs, match=${matchFreqHours}hrs, similar=${frequenciesMatch}`);

    // Compound logic: similarity + frequency (NO task type - AI-assigned, unreliable)
    const compoundMatch = bestMatch.score >= threshold && frequenciesMatch;

    if (compoundMatch) {
      return {
        action: 'duplicate',
        bestMatch: {
          id: bestMatch.id,
          score: bestMatch.score,
          metadata: bestMatch.metadata
        },
        matches: matches.map(m => ({
          id: m.id,
          score: m.score,
          metadata: m.metadata
        }))
      };
    }

    return { action: 'insert', matches };

  } catch (error) {
    console.error('Error checking Pinecone:', error.message);
    throw error;
  }
}

/**
 * Multi-pass deduplication test
 */
async function runMultiPassTest() {
  console.log('🧪 MULTI-PASS DEDUPLICATION TEST\n');
  console.log('='.repeat(80));
  console.log('Testing iterative deduplication with full audit trail');
  console.log('Threshold: 80% + frequency match + type match\n');

  // Load tasks
  const tasksJson = readFileSync('extracted_tasks_2025-10-19.json', 'utf-8');
  const tasks = JSON.parse(tasksJson);

  console.log(`Loaded ${tasks.length} tasks from JSON\n`);

  // Audit log
  const auditLog = {
    testStarted: new Date().toISOString(),
    threshold: 0.80,
    totalTasks: tasks.length,
    passes: []
  };

  // Task tracking
  const taskRegistry = tasks.map((task, idx) => ({
    index: idx,
    task,
    status: 'pending', // pending | inserted | duplicate
    pineconeId: null,
    embedding: null,
    duplicateOf: null,
    similarity: null,
    passProcessed: null
  }));

  // ============================================================
  // PASS 1: Initial insertion with deduplication
  // ============================================================
  console.log('='.repeat(80));
  console.log('PASS 1: Initial Deduplication\n');

  const pass1Log = {
    passNumber: 1,
    tasksProcessed: 0,
    inserted: 0,
    duplicates: 0,
    decisions: []
  };

  for (let i = 0; i < tasks.length; i++) {
    const entry = taskRegistry[i];
    const task = entry.task;

    try {
      const elapsed = ((Date.now() - Date.parse(auditLog.testStarted)) / 1000).toFixed(0);
      console.log(`[${i + 1}/${tasks.length}] [${elapsed}s] Processing: ${task.description.substring(0, 60)}...`);

      // Classify and embed
      task.task_type = classifyTaskType(task.description);
      const embedding = await generateTaskEmbedding(task.description);
      entry.embedding = embedding;

      // Check against Pinecone
      const dupCheck = await checkAgainstPinecone(task, embedding, 0.80);

      const decision = {
        taskIndex: i,
        description: task.description,
        system: task.system_name,
        frequency: `${task.frequency_value} ${task.frequency_type}`,
        taskType: task.task_type,
        action: dupCheck.action
      };

      if (dupCheck.action === 'insert') {
        // Insert to Pinecone
        const pineconeId = `task-${i}-${Date.now()}`;
        const freqHours = normalizeFrequencyToHours(task);
        const metadata = {
          task_id: pineconeId,
          description: task.description.substring(0, 500),
          asset_uid: task.asset_uid,
          system_name: task.system_name,
          frequency_hours: freqHours !== null ? freqHours : -1, // Use -1 for unknown
          frequency_type: task.frequency_type || 'unknown',
          frequency_value: task.frequency_value !== null ? task.frequency_value : -1,
          task_type: task.task_type,
          source_index: i
        };

        await pineconeRepository.upsertTask(pineconeId, embedding, metadata);

        // Small delay to allow Pinecone to index (eventually consistent)
        await new Promise(resolve => setTimeout(resolve, 2000));

        entry.status = 'inserted';
        entry.pineconeId = pineconeId;
        entry.passProcessed = 1;

        decision.pineconeId = pineconeId;
        decision.result = 'inserted';

        pass1Log.inserted++;
        console.log(`  ✅ Inserted to Pinecone (ID: ${pineconeId})`);

      } else if (dupCheck.action === 'duplicate') {
        entry.status = 'duplicate';
        entry.duplicateOf = dupCheck.bestMatch.id;
        entry.similarity = dupCheck.bestMatch.score;
        entry.passProcessed = 1;

        decision.duplicateOf = dupCheck.bestMatch.id;
        decision.similarity = dupCheck.bestMatch.score;
        decision.matchDescription = dupCheck.bestMatch.metadata.description;
        decision.result = 'duplicate';

        pass1Log.duplicates++;
        console.log(`  🔄 Duplicate of ${dupCheck.bestMatch.id} (${(dupCheck.bestMatch.score * 100).toFixed(1)}%)`);
      }

      pass1Log.decisions.push(decision);
      pass1Log.tasksProcessed++;

    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
    }
  }

  auditLog.passes.push(pass1Log);

  console.log('\n' + '='.repeat(80));
  console.log('PASS 1 RESULTS:\n');
  console.log(`Tasks processed: ${pass1Log.tasksProcessed}`);
  console.log(`✅ Inserted:     ${pass1Log.inserted}`);
  console.log(`🔄 Duplicates:   ${pass1Log.duplicates}`);

  // ============================================================
  // PASS 2: Re-check duplicates (convergence test)
  // ============================================================
  console.log('\n' + '='.repeat(80));
  console.log('PASS 2: Re-checking Duplicates for Convergence\n');

  const pass2Log = {
    passNumber: 2,
    tasksProcessed: 0,
    inserted: 0,
    duplicates: 0,
    statusChanged: 0,
    decisions: []
  };

  const duplicatesFromPass1 = taskRegistry.filter(e => e.status === 'duplicate');
  console.log(`Re-checking ${duplicatesFromPass1.length} tasks flagged as duplicates...\n`);

  for (const entry of duplicatesFromPass1) {
    const task = entry.task;
    const embedding = entry.embedding;

    try {
      console.log(`[${entry.index}] Re-checking: ${task.description.substring(0, 60)}...`);

      // Re-check against updated Pinecone
      const dupCheck = await checkAgainstPinecone(task, embedding, 0.80);

      const decision = {
        taskIndex: entry.index,
        description: task.description,
        previousStatus: entry.status,
        action: dupCheck.action
      };

      if (dupCheck.action === 'insert') {
        // Now unique! Insert to Pinecone
        const pineconeId = `task-${entry.index}-pass2-${Date.now()}`;
        const freqHours = normalizeFrequencyToHours(task);
        const metadata = {
          task_id: pineconeId,
          description: task.description.substring(0, 500),
          asset_uid: task.asset_uid,
          system_name: task.system_name,
          frequency_hours: freqHours !== null ? freqHours : -1,
          frequency_type: task.frequency_type || 'unknown',
          frequency_value: task.frequency_value !== null ? task.frequency_value : -1,
          task_type: task.task_type,
          source_index: entry.index
        };

        await pineconeRepository.upsertTask(pineconeId, embedding, metadata);

        entry.status = 'inserted';
        entry.pineconeId = pineconeId;
        entry.passProcessed = 2;

        decision.pineconeId = pineconeId;
        decision.result = 'inserted';

        pass2Log.inserted++;
        pass2Log.statusChanged++;
        console.log(`  ✅ NOW UNIQUE - Inserted (ID: ${pineconeId})`);

      } else {
        // Still a duplicate
        const oldDuplicateOf = entry.duplicateOf;
        entry.duplicateOf = dupCheck.bestMatch.id;
        entry.similarity = dupCheck.bestMatch.score;

        decision.duplicateOf = dupCheck.bestMatch.id;
        decision.similarity = dupCheck.bestMatch.score;
        decision.result = 'still_duplicate';

        if (oldDuplicateOf !== dupCheck.bestMatch.id) {
          pass2Log.statusChanged++;
          console.log(`  🔄 Now matches different task: ${dupCheck.bestMatch.id}`);
        } else {
          console.log(`  🔄 Still duplicate of ${dupCheck.bestMatch.id}`);
        }

        pass2Log.duplicates++;
      }

      pass2Log.decisions.push(decision);
      pass2Log.tasksProcessed++;

    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
    }
  }

  auditLog.passes.push(pass2Log);

  console.log('\n' + '='.repeat(80));
  console.log('PASS 2 RESULTS:\n');
  console.log(`Tasks re-checked:   ${pass2Log.tasksProcessed}`);
  console.log(`✅ Now unique:      ${pass2Log.inserted}`);
  console.log(`🔄 Still duplicates: ${pass2Log.duplicates}`);
  console.log(`📊 Status changed:   ${pass2Log.statusChanged}`);

  // ============================================================
  // FINAL SUMMARY
  // ============================================================
  console.log('\n' + '='.repeat(80));
  console.log('🎯 FINAL SUMMARY\n');

  const finalInserted = taskRegistry.filter(e => e.status === 'inserted').length;
  const finalDuplicates = taskRegistry.filter(e => e.status === 'duplicate').length;

  console.log(`Total tasks:        ${tasks.length}`);
  console.log(`✅ Unique tasks:    ${finalInserted}`);
  console.log(`🔄 Duplicates:      ${finalDuplicates}`);
  console.log(`📊 Reduction:       ${((finalDuplicates / tasks.length) * 100).toFixed(1)}%`);

  auditLog.finalStats = {
    uniqueTasks: finalInserted,
    duplicates: finalDuplicates,
    reductionPercent: ((finalDuplicates / tasks.length) * 100).toFixed(1)
  };

  auditLog.testCompleted = new Date().toISOString();

  // ============================================================
  // CONVERGENCE ANALYSIS
  // ============================================================
  console.log('\n' + '='.repeat(80));
  console.log('📈 CONVERGENCE ANALYSIS\n');

  console.log('Pass 1:');
  console.log(`  Inserted: ${pass1Log.inserted}`);
  console.log(`  Duplicates: ${pass1Log.duplicates}`);

  console.log('\nPass 2:');
  console.log(`  New inserts: ${pass2Log.inserted}`);
  console.log(`  Still duplicates: ${pass2Log.duplicates}`);
  console.log(`  Status changes: ${pass2Log.statusChanged}`);

  if (pass2Log.statusChanged === 0) {
    console.log('\n✅ CONVERGED: No status changes in Pass 2');
  } else {
    console.log(`\n⚠️  NOT CONVERGED: ${pass2Log.statusChanged} tasks changed status`);
    console.log('   Consider running Pass 3');
  }

  // ============================================================
  // SAVE AUDIT LOG
  // ============================================================
  const logFilename = `test-results-${Date.now()}.json`;
  writeFileSync(logFilename, JSON.stringify(auditLog, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log(`\n📄 Full audit log saved: ${logFilename}\n`);

  // ============================================================
  // DUPLICATE GROUPS
  // ============================================================
  console.log('='.repeat(80));
  console.log('🔍 DUPLICATE GROUPS\n');

  const duplicateGroups = {};
  taskRegistry
    .filter(e => e.status === 'duplicate')
    .forEach(e => {
      if (!duplicateGroups[e.duplicateOf]) {
        duplicateGroups[e.duplicateOf] = [];
      }
      duplicateGroups[e.duplicateOf].push(e);
    });

  Object.entries(duplicateGroups).forEach(([primaryId, dupes]) => {
    const primary = taskRegistry.find(e => e.pineconeId === primaryId);
    if (primary) {
      console.log(`\nGroup: ${primary.task.description.substring(0, 60)}...`);
      console.log(`  Primary ID: ${primaryId}`);
      console.log(`  Duplicates (${dupes.length}):`);
      dupes.forEach(d => {
        console.log(`    - [${d.index}] ${d.task.description.substring(0, 60)}... (${(d.similarity * 100).toFixed(1)}%)`);
      });
    }
  });

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ Multi-pass test complete!\n');
}

// Run the test
runMultiPassTest().catch(console.error);
