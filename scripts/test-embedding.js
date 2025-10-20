/**
 * Test embedding dimensions
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testEmbedding() {
  console.log('\nTesting embedding dimensions...\n');

  const text = 'maintenance service inspection';

  // Test both models
  const models = [
    'text-embedding-ada-002',
    'text-embedding-3-small'
  ];

  for (const model of models) {
    try {
      const response = await openai.embeddings.create({
        model,
        input: text,
        ...(model === 'text-embedding-3-small' && { dimensions: 3072 })
      });

      console.log(`Model: ${model}`);
      console.log(`Dimensions: ${response.data[0].embedding.length}`);
      console.log('---');
    } catch (error) {
      console.error(`Failed with ${model}: ${error.message}`);
    }
  }
}

testEmbedding();