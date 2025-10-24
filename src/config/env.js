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

  // Operational Tracking (NEW - Phase 1)
  HOURS_UPDATE_PROMPT_INTERVAL_DAYS: z.string().default('7'),
  HOURS_STALENESS_WARNING_DAYS: z.string().default('30'),
  TASK_DUE_SOON_WARNING_DAYS: z.string().default('7'),
  TASK_OVERDUE_WARNING_DAYS: z.string().default('3'),

  // Approval Workflow (NEW - Phase 1)
  APPROVAL_AUTO_APPROVE_CONFIDENCE: z.string().default('0.95'),
  APPROVAL_REVIEW_REQUIRED_CONFIDENCE: z.string().default('0.70'),
  APPROVAL_BATCH_SIZE: z.string().default('50'),

  // Agent Processing (NEW - Phase 1)
  OPENAI_MAX_CONCURRENT_CALLS: z.string().default('3'),
  OPENAI_RATE_LIMIT_RPM: z.string().default('60'),

  // UI Defaults (NEW - Phase 1)
  UI_DEFAULT_PAGE_SIZE: z.string().default('20'),
  UI_MAX_PAGE_SIZE: z.string().default('100'),
  UI_NEW_TASK_BADGE_DAYS: z.string().default('7'),

  // Error Handling (NEW - Phase 1)
  MAX_RETRY_ATTEMPTS: z.string().default('3'),
  RETRY_DELAY_MS: z.string().default('1000'),
  API_TIMEOUT_MS: z.string().default('30000'),

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

    // Operational Tracking (NEW - Phase 1)
    tracking: {
      hoursUpdatePromptIntervalDays: parseInt(env.HOURS_UPDATE_PROMPT_INTERVAL_DAYS, 10),
      hoursStalenessWarningDays: parseInt(env.HOURS_STALENESS_WARNING_DAYS, 10),
      taskDueSoonWarningDays: parseInt(env.TASK_DUE_SOON_WARNING_DAYS, 10),
      taskOverdueWarningDays: parseInt(env.TASK_OVERDUE_WARNING_DAYS, 10),
    },

    // Approval Workflow (NEW - Phase 1)
    approval: {
      autoApproveConfidence: parseFloat(env.APPROVAL_AUTO_APPROVE_CONFIDENCE),
      reviewRequiredConfidence: parseFloat(env.APPROVAL_REVIEW_REQUIRED_CONFIDENCE),
      batchSize: parseInt(env.APPROVAL_BATCH_SIZE, 10),
    },

    // API Rate Limiting (NEW - Phase 1)
    rateLimits: {
      openaiMaxConcurrentCalls: parseInt(env.OPENAI_MAX_CONCURRENT_CALLS, 10),
      openaiRateLimitRpm: parseInt(env.OPENAI_RATE_LIMIT_RPM, 10),
    },

    // UI Configuration (NEW - Phase 1)
    ui: {
      defaultPageSize: parseInt(env.UI_DEFAULT_PAGE_SIZE, 10),
      maxPageSize: parseInt(env.UI_MAX_PAGE_SIZE, 10),
      newTaskBadgeDays: parseInt(env.UI_NEW_TASK_BADGE_DAYS, 10),
    },

    // Error Handling (NEW - Phase 1)
    errorHandling: {
      maxRetryAttempts: parseInt(env.MAX_RETRY_ATTEMPTS, 10),
      retryDelayMs: parseInt(env.RETRY_DELAY_MS, 10),
      apiTimeoutMs: parseInt(env.API_TIMEOUT_MS, 10),
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