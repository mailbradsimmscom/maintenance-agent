/**
 * OpenAI Repository
 * LLM operations for the maintenance agent
 */

import OpenAI from 'openai';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { rateLimiters } from '../utils/rate-limiter.js';

const config = getConfig();
const logger = createLogger('openai-repository');
const rateLimiter = rateLimiters.openai;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

export const openaiRepository = {
  /**
   * Create a chat completion (generic)
   * @param {Array} messages - Array of message objects with role and content
   * @param {Object} options - Additional options (model, temperature, etc.)
   * @returns {Promise<string>} The completion text
   */
  async createChatCompletion(messages, options = {}) {
    const {
      model = config.openai.model,
      temperature = 0.3,
      max_tokens = 500,
      response_format = null
    } = options;

    try {
      const params = {
        model,
        messages,
        temperature,
        max_tokens
      };

      if (response_format) {
        params.response_format = response_format;
      }

      const response = await openai.chat.completions.create(params);
      return response.choices[0].message.content;
    } catch (error) {
      logger.error('Failed to create chat completion', { error: error.message });
      throw error;
    }
  },

  /**
   * Generate embeddings for text
   * @param {string} text - Text to embed
   * @returns {Promise<Array<number>>} Embedding vector
   */
  async createEmbedding(text) {
    // Check rate limit
    await rateLimiter.waitForSlot();

    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-large',  // Main system uses 3-large for 3072 dimensions
        input: text,
        dimensions: 3072  // Explicit dimensions for consistency
      });

      rateLimiter.recordSuccess();
      return response.data[0].embedding;
    } catch (error) {
      rateLimiter.recordFailure();
      logger.error('Failed to create embedding', { error: error.message });
      throw error;
    }
  },

  /**
   * Extract maintenance tasks from text using LLM
   * @param {string} text - Source text
   * @param {Object} context - Additional context
   * @returns {Promise<Array>} Extracted maintenance tasks
   */
  async extractMaintenanceTasks(text, context = {}) {
    const systemPrompt = `You are a marine systems maintenance expert. Extract all maintenance tasks from the provided text.

For each task, provide:
1. description: Clear description of the maintenance task
2. frequency_type: One of [hours, days, weeks, months, years, cycles, condition_based]
3. frequency_value: Numeric value for the frequency (or null for condition_based)
4. parts_required: Array of parts/consumables needed
5. estimated_duration_hours: Estimated time to complete
6. criticality: One of [critical, important, routine, optional]
7. confidence: Your confidence in this extraction (0.0-1.0)

Focus on:
- Regular maintenance schedules
- Inspection requirements
- Cleaning procedures
- Part replacement intervals
- Lubrication schedules
- Calibration requirements

Return a JSON array of tasks.`;

    const userPrompt = `System: ${context.manufacturer || 'Unknown'} ${context.model || 'Unknown'}
Asset: ${context.assetUid || 'Unknown'}

Text to analyze:
${text}`;

    try {
      const response = await openai.chat.completions.create({
        model: config.openai.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(response.choices[0].message.content);
      return result.tasks || [];
    } catch (error) {
      logger.error('Failed to extract maintenance tasks', { error: error.message });
      return [];
    }
  },

  /**
   * Search for real-world maintenance knowledge
   * @param {Object} system - System details
   * @returns {Promise<Array>} Maintenance suggestions from real-world knowledge
   */
  async searchRealWorldMaintenance(system) {
    const systemName = `${system.manufacturer_norm || ''} ${system.model_norm || ''}`.trim();

    const prompt = `Based on real-world experience and common knowledge about ${systemName} in marine environments:

1. What maintenance is typically required that might not be in the manual?
2. What are common failure points and their prevention?
3. What related/supporting systems need maintenance (e.g., sea strainers for AC units)?
4. What environmental factors affect maintenance schedules (salt water, tropical climate)?

Provide specific, actionable maintenance tasks with frequencies.

Return as JSON with structure:
{
  "tasks": [
    {
      "description": "task description",
      "frequency_type": "months",
      "frequency_value": 6,
      "reason": "why this is important",
      "source": "common_knowledge",
      "confidence": 0.8
    }
  ],
  "related_systems": ["list of related systems to check"]
}`;

    try {
      const response = await openai.chat.completions.create({
        model: config.openai.model,
        messages: [
          { role: 'system', content: 'You are a marine systems expert with decades of experience maintaining boats and yachts.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(response.choices[0].message.content);
      return result;
    } catch (error) {
      logger.error('Failed to search real-world maintenance', { error: error.message });
      return { tasks: [], related_systems: [] };
    }
  },

  /**
   * Infer system dependencies and hidden maintenance
   * @param {Object} system - System details
   * @returns {Promise<Object>} Inferred dependencies and maintenance
   */
  async inferDependencies(system) {
    const systemName = `${system.manufacturer_norm || ''} ${system.model_norm || ''}`.trim();
    const systemType = system.system_norm || 'Unknown System';

    const prompt = `For a ${systemType} system (${systemName}) on a catamaran:

1. What hidden components/dependencies are typically present?
2. What supporting infrastructure is required (pumps, strainers, electrical, plumbing)?
3. What maintenance on these dependencies is critical but often overlooked?

Example: An AC unit depends on:
- Sea water pump (needs impeller replacement)
- Sea strainer (needs regular cleaning)
- Electrical breakers (need periodic testing)
- Condensate drain (needs cleaning)

Provide specific dependencies and their maintenance requirements.

Return as JSON:
{
  "dependencies": [
    {
      "component": "component name",
      "relationship": "how it relates to main system",
      "maintenance_tasks": [
        {
          "description": "task description",
          "frequency_type": "weeks",
          "frequency_value": 2,
          "criticality": "critical"
        }
      ]
    }
  ]
}`;

    try {
      const response = await openai.chat.completions.create({
        model: config.openai.model,
        messages: [
          { role: 'system', content: 'You are a marine engineer specializing in yacht systems integration and maintenance.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(response.choices[0].message.content);
      return result;
    } catch (error) {
      logger.error('Failed to infer dependencies', { error: error.message });
      return { dependencies: [] };
    }
  },

  /**
   * Analyze and score maintenance task confidence
   * @param {Object} task - Maintenance task
   * @param {Object} context - Additional context
   * @returns {Promise<number>} Confidence score (0-1)
   */
  async scoreTaskConfidence(task, context = {}) {
    const prompt = `Score the confidence of this maintenance task (0.0-1.0):

Task: ${task.description}
Frequency: ${task.frequency_value} ${task.frequency_type}
Source: ${task.source}
System: ${context.systemName || 'Unknown'}

Consider:
1. Is the frequency reasonable for this type of task?
2. Is the task description clear and actionable?
3. Is this likely to be a real maintenance requirement?

Return a single number between 0.0 and 1.0`;

    try {
      const response = await openai.chat.completions.create({
        model: config.openai.model,
        messages: [
          { role: 'system', content: 'You are a maintenance expert. Provide only a confidence score as a number.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 10,
      });

      const score = parseFloat(response.choices[0].message.content);
      return isNaN(score) ? 0.5 : Math.min(1, Math.max(0, score));
    } catch (error) {
      logger.error('Failed to score task confidence', { error: error.message });
      return 0.5; // Default medium confidence
    }
  },
};

export default openaiRepository;