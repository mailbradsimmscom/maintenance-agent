import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import {
  classifyTaskType,
  generateTaskEmbedding,
  normalizeFrequencyToHours,
  areFrequenciesSimilar
} from '../src/services/task-embedding.service.js';
import { pineconeRepository } from '../src/repositories/pinecone.repository.js';

dotenv.config();

async function testSingleMatch() {
  console.log('🧪 Testing Single Anode Task Match\n');

  const tasks = JSON.parse(readFileSync('extracted_tasks_2025-10-19.json', 'utf-8'));

  // Get the 3 anode tasks
  const anodeTasks = tasks.filter(t => t.description.includes('Inspect and replace anode'));

  console.log('Found', anodeTasks.length, 'anode tasks:\n');
  anodeTasks.forEach((t, i) => {
    console.log(`${i + 1}. "${t.description}"`);
    console.log(`   Frequency: ${t.frequency_type}, ${t.frequency_value}`);
    console.log(`   Normalized: ${normalizeFrequencyToHours(t)} hours\n`);
  });

  // Generate embeddings for first two
  console.log('Generating embeddings...\n');
  const task1 = anodeTasks[0];
  const task2 = anodeTasks[1];

  task1.task_type = classifyTaskType(task1.description);
  task2.task_type = classifyTaskType(task2.description);

  const emb1 = await generateTaskEmbedding(task1.description);
  const emb2 = await generateTaskEmbedding(task2.description);

  console.log('Task 1:', task1.description);
  console.log('Task 2:', task2.description);
  console.log('');

  // Manual cosine similarity
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

  const similarity = cosineSimilarity(emb1, emb2);
  console.log('📊 Embedding Similarity:', (similarity * 100).toFixed(2) + '%');

  // Check frequency match
  const freq1 = normalizeFrequencyToHours(task1);
  const freq2 = normalizeFrequencyToHours(task2);
  const freqMatch = areFrequenciesSimilar(freq1, freq2);

  console.log('📊 Frequency Match:');
  console.log('   Task 1:', freq1, 'hours');
  console.log('   Task 2:', freq2, 'hours');
  console.log('   Similar?:', freqMatch);
  console.log('');

  // Decision logic
  console.log('Decision Logic:');
  console.log('   Similarity >= 80%?', similarity >= 0.80);
  console.log('   Frequency match?', freqMatch);
  console.log('   Should be duplicate?', similarity >= 0.80 && freqMatch);
  console.log('');

  if (similarity >= 0.80 && freqMatch) {
    console.log('✅ SHOULD BE FLAGGED AS DUPLICATE');
  } else {
    console.log('❌ WHY NOT FLAGGED:');
    if (similarity < 0.80) console.log('   - Similarity too low (<80%)');
    if (!freqMatch) console.log('   - Frequencies don\'t match');
  }
}

testSingleMatch().catch(console.error);
