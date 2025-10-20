/**
 * Environment Configuration with Zod Validation
 * Maintenance Agent - Separate from main system
 */

import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env file
dotenv.config();

// Define the environment schema
const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Server configuration
  PORT: z.string().default('3001'), // Different port from main app

  // Database
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),

  // Vector Database
  PINECONE_API_KEY: z.string().min(1),
  PINECONE_ENVIRONMENT: z.string().default('us-east-1'),
  PINECONE_INDEX_NAME: z.string().default('documents'),
  PINECONE_INDEX_HOST: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default('gpt-4-turbo-preview'),

  // Admin/Security
  ADMIN_TOKEN: z.string().min(1),

  // Agent-specific configuration
  AGENT_RUN_INTERVAL_MINUTES: z.string().default('60'),
  AGENT_BATCH_SIZE: z.string().default('5'),
  AGENT_CONFIDENCE_THRESHOLD: z.string().default('0.7'),

  // Feature flags
  ENABLE_REAL_WORLD_SEARCH: z.string().default('false'),
  ENABLE_DEPENDENCY_INFERENCE: z.string().default('false'),
  ENABLE_AUTO_LEARNING: z.string().default('false'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty'),
});

// Parse and validate environment
let env;
try {
  env = envSchema.parse(process.env);
} catch (error) {
  console.error('❌ Environment validation failed:');
  console.error(error.errors);
  process.exit(1);
}

// Export validated environment
export function getEnv() {
  return env;
}

// Helper functions for common conversions
export function getConfig() {
  return {
    nodeEnv: env.NODE_ENV,
    port: parseInt(env.PORT, 10),

    // Database connections
    supabase: {
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_KEY,
    },

    pinecone: {
      apiKey: env.PINECONE_API_KEY,
      environment: env.PINECONE_ENVIRONMENT,
      indexName: env.PINECONE_INDEX_NAME,
      indexHost: env.PINECONE_INDEX_HOST,
    },

    openai: {
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
    },

    // Agent configuration
    agent: {
      runIntervalMinutes: parseInt(env.AGENT_RUN_INTERVAL_MINUTES, 10),
      batchSize: parseInt(env.AGENT_BATCH_SIZE, 10),
      confidenceThreshold: parseFloat(env.AGENT_CONFIDENCE_THRESHOLD),
    },

    // Feature flags
    features: {
      realWorldSearch: env.ENABLE_REAL_WORLD_SEARCH === 'true',
      dependencyInference: env.ENABLE_DEPENDENCY_INFERENCE === 'true',
      autoLearning: env.ENABLE_AUTO_LEARNING === 'true',
    },

    // Logging
    logging: {
      level: env.LOG_LEVEL,
      format: env.LOG_FORMAT,
    },

    // Security
    adminToken: env.ADMIN_TOKEN,
  };
}

export default env;