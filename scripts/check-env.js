/**
 * Environment Validation Script
 * Tests that all environment variables are properly configured
 * Usage: node scripts/check-env.js
 */

import { getConfig } from '../src/config/env.js';

try {
  const config = getConfig();

  console.log('✅ All environment variables validated successfully\n');

  console.log('📋 Configuration Summary:');
  console.log('  Environment:', config.nodeEnv);
  console.log('  Port:', config.port);
  console.log('  Log Level:', config.logging.level);
  console.log('\n🤖 Agent Configuration:');
  console.log('  Run Interval:', config.agent.runIntervalMinutes, 'minutes');
  console.log('  Batch Size:', config.agent.batchSize);
  console.log('  Confidence Threshold:', config.agent.confidenceThreshold);
  console.log('\n⏱️  Operational Tracking:');
  console.log('  Hours Update Prompt Interval:', config.tracking.hoursUpdatePromptIntervalDays, 'days');
  console.log('  Hours Staleness Warning:', config.tracking.hoursStalenessWarningDays, 'days');
  console.log('  Task Due Soon Warning:', config.tracking.taskDueSoonWarningDays, 'days');
  console.log('  Task Overdue Warning:', config.tracking.taskOverdueWarningDays, 'days');
  console.log('\n✔️  Approval Workflow:');
  console.log('  Auto-Approve Confidence:', config.approval.autoApproveConfidence);
  console.log('  Review Required Confidence:', config.approval.reviewRequiredConfidence);
  console.log('  Approval Batch Size:', config.approval.batchSize);
  console.log('\n🔌 API Rate Limits:');
  console.log('  OpenAI Max Concurrent Calls:', config.rateLimits.openaiMaxConcurrentCalls);
  console.log('  OpenAI Rate Limit (RPM):', config.rateLimits.openaiRateLimitRpm);
  console.log('\n🎨 UI Configuration:');
  console.log('  Default Page Size:', config.ui.defaultPageSize);
  console.log('  Max Page Size:', config.ui.maxPageSize);
  console.log('  New Task Badge Days:', config.ui.newTaskBadgeDays);
  console.log('\n⚠️  Error Handling:');
  console.log('  Max Retry Attempts:', config.errorHandling.maxRetryAttempts);
  console.log('  Retry Delay:', config.errorHandling.retryDelayMs, 'ms');
  console.log('  API Timeout:', config.errorHandling.apiTimeoutMs, 'ms');

  process.exit(0);
} catch (error) {
  console.error('❌ Environment validation failed:');
  console.error(error.message);
  if (error.errors) {
    console.error('\nValidation errors:');
    error.errors.forEach(err => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
  }
  process.exit(1);
}
