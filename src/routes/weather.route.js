/**
 * Weather Routes
 * API endpoints for weather areas and forecasts
 */

import express from 'express';
import OpenAI from 'openai';
import { weatherAreaService } from '../services/weather-area.service.js';
import { weatherFetchService } from '../services/weather-fetch.service.js';
import { weatherForecastService } from '../services/weather-forecast.service.js';
import { weatherCreditsService } from '../services/weather-credits.service.js';
import { forecastEmailService } from '../services/forecast-email.service.js';
import { forecastEmailRepository } from '../repositories/forecast-email.repository.js';
import { forecastEmailParserService } from '../services/forecast-email-parser.service.js';
import { getEnv } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('weather-routes');
const env = getEnv();

// ========== AREAS ==========

/**
 * GET /api/weather/areas
 * List all active weather areas with last fetch time
 */
router.get('/areas', async (req, res) => {
  try {
    const areas = await weatherAreaService.getAreasWithLastFetch();
    res.json({ success: true, data: areas });
  } catch (error) {
    logger.error('Failed to get areas', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/weather/areas/:id
 * Get a single weather area by ID
 */
router.get('/areas/:id', async (req, res) => {
  try {
    const area = await weatherAreaService.getAreaById(req.params.id);
    if (!area) {
      return res.status(404).json({ success: false, error: 'Area not found' });
    }
    res.json({ success: true, data: area });
  } catch (error) {
    logger.error('Failed to get area', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/weather/areas
 * Create a new weather area
 */
router.post('/areas', async (req, res) => {
  try {
    const { name, latitude, longitude, description, sailing_direction } = req.body;

    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Name, latitude, and longitude are required'
      });
    }

    const area = await weatherAreaService.createArea({
      name,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      description,
      sailing_direction: sailing_direction || null
    });

    // Auto-fetch Open-Meteo data for new area (don't await - let it run in background)
    logger.info('Auto-fetching Open-Meteo data for new area', { areaId: area.id, name });
    weatherFetchService.fetchForArea(area.id, { sources: ['openmeteo'] })
      .then(result => {
        const forecastOk = result.openMeteoForecast?.success;
        const marineOk = result.openMeteoMarine?.success;
        if (forecastOk && marineOk) {
          logger.info('Auto-fetch completed successfully', { areaId: area.id });
        } else {
          logger.warn('Auto-fetch partially failed', {
            areaId: area.id,
            forecast: result.openMeteoForecast,
            marine: result.openMeteoMarine
          });
        }
      })
      .catch(err => {
        logger.error('Auto-fetch failed', { areaId: area.id, error: err.message });
      });

    // Auto-parse expert forecasts from latest email for new area (background)
    forecastEmailParserService.parseForNewArea(area)
      .then(result => {
        if (result.forecastsWritten > 0) {
          logger.info('Expert forecasts generated for new area', { areaId: area.id, name, forecastsWritten: result.forecastsWritten });
        } else {
          logger.info('No expert forecasts available for new area', { areaId: area.id, name });
        }
      })
      .catch(err => {
        logger.error('Expert forecast parse failed for new area', { areaId: area.id, error: err.message });
      });

    res.status(201).json({ success: true, data: area, message: 'Area created. Weather data is being fetched...' });
  } catch (error) {
    logger.error('Failed to create area', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/weather/areas/:id
 * Update a weather area
 */
router.put('/areas/:id', async (req, res) => {
  try {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.latitude !== undefined) updates.latitude = parseFloat(req.body.latitude);
    if (req.body.longitude !== undefined) updates.longitude = parseFloat(req.body.longitude);
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.sailing_direction !== undefined) updates.sailing_direction = req.body.sailing_direction;

    const area = await weatherAreaService.updateArea(req.params.id, updates);
    res.json({ success: true, data: area });
  } catch (error) {
    logger.error('Failed to update area', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/weather/areas/:id
 * Soft delete a weather area
 */
router.delete('/areas/:id', async (req, res) => {
  try {
    await weatherAreaService.deleteArea(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete area', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== FORECASTS ==========

/**
 * GET /api/weather/areas/:id/forecast
 * Get forecast data for an area
 */
router.get('/areas/:id/forecast', async (req, res) => {
  try {
    const forecasts = await weatherForecastService.getForecastsForArea(req.params.id);
    res.json({ success: true, data: forecasts });
  } catch (error) {
    logger.error('Failed to get forecasts', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/weather/areas/:id/comparison
 * Get model comparison for an area
 */
router.get('/areas/:id/comparison', async (req, res) => {
  try {
    const comparison = await weatherForecastService.getModelComparison(req.params.id);
    res.json({ success: true, data: comparison });
  } catch (error) {
    logger.error('Failed to get comparison', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/weather/areas/:id/current
 * Get current conditions for an area
 */
router.get('/areas/:id/current', async (req, res) => {
  try {
    const conditions = await weatherForecastService.getCurrentConditions(req.params.id);
    if (!conditions) {
      return res.status(404).json({ success: false, error: 'No forecast data available' });
    }
    res.json({ success: true, data: conditions });
  } catch (error) {
    logger.error('Failed to get current conditions', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/weather/areas/:id/7day
 * Get 7-day forecast summary for an area
 */
router.get('/areas/:id/7day', async (req, res) => {
  try {
    const forecast = await weatherForecastService.get7DayForecast(req.params.id);
    res.json({ success: true, data: forecast });
  } catch (error) {
    logger.error('Failed to get 7-day forecast', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/weather/areas/:id/fetch
 * Trigger manual fetch for an area
 * Body: { sources: ['openmeteo', 'meteoblue', 'stormglass'] } - optional, defaults to all
 */
router.post('/areas/:id/fetch', async (req, res) => {
  try {
    const sources = req.body?.sources || ['openmeteo', 'meteoblue', 'stormglass'];
    logger.info('Manual fetch triggered', { areaId: req.params.id, sources });
    const result = await weatherFetchService.fetchForArea(req.params.id, { sources });

    // Check for partial failures
    const failures = [];
    const successes = [];

    if (result.openMeteoForecast?.success === false && !result.openMeteoForecast?.skipped) {
      failures.push(`Forecast: ${result.openMeteoForecast.error}`);
    } else if (result.openMeteoForecast?.success) {
      successes.push(`Forecast: ${result.openMeteoForecast.count} records`);
    }

    if (result.openMeteoMarine?.success === false && !result.openMeteoMarine?.skipped) {
      failures.push(`Marine: ${result.openMeteoMarine.error}`);
    } else if (result.openMeteoMarine?.success) {
      successes.push(`Marine: ${result.openMeteoMarine.count} records`);
    }

    if (result.meteoblue?.success === false && !result.meteoblue?.skipped) {
      failures.push(`Meteoblue: ${result.meteoblue.error}`);
    } else if (result.meteoblue?.success) {
      successes.push(`Meteoblue: ${result.meteoblue.count} records`);
    }

    if (result.stormglass?.success === false && !result.stormglass?.skipped) {
      failures.push(`Stormglass: ${result.stormglass.error}`);
    } else if (result.stormglass?.success) {
      successes.push(`Stormglass: ${result.stormglass.count} records (${result.stormglass.quotaRemaining} calls left today)`);
    }

    const hasFailures = failures.length > 0;
    const hasSuccesses = successes.length > 0;

    res.json({
      success: !hasFailures || hasSuccesses, // true if at least some succeeded
      partialFailure: hasFailures && hasSuccesses,
      data: result,
      message: hasFailures
        ? `Partial failure: ${failures.join('; ')}`
        : `Success: ${successes.join(', ')}`,
      failures: hasFailures ? failures : undefined
    });
  } catch (error) {
    logger.error('Failed to trigger fetch', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== CREDITS ==========

/**
 * GET /api/weather/credits
 * Get Meteoblue credit status
 */
router.get('/credits', async (req, res) => {
  try {
    const credits = await weatherCreditsService.getStatus('meteoblue');
    res.json({ success: true, data: credits });
  } catch (error) {
    logger.error('Failed to get credits', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== EXPERT FORECASTS ==========

/**
 * GET /api/weather/areas/:id/expert-forecast?date=YYYY-MM-DD
 * Get expert forecast for a specific area and date
 */
router.get('/areas/:id/expert-forecast', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const forecast = await forecastEmailRepository.getExpertForecast(req.params.id, date);
    res.json({ success: true, data: forecast });
  } catch (error) {
    logger.error('Failed to get expert forecast', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/weather/areas/:id/expert-forecasts
 * Get all expert forecasts for an area (10-day view)
 */
router.get('/areas/:id/expert-forecasts', async (req, res) => {
  try {
    const forecasts = await forecastEmailRepository.getExpertForecasts(req.params.id);
    res.json({ success: true, data: forecasts });
  } catch (error) {
    logger.error('Failed to get expert forecasts', { id: req.params.id, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/weather/forecast-email/check
 * Manual trigger: check Gmail for new forecast emails
 */
router.post('/forecast-email/check', async (req, res) => {
  try {
    const result = await forecastEmailService.checkAndIngest();
    if (result.disabled) {
      return res.json({ success: false, error: 'Forecast email feature disabled' });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Failed to check forecast emails', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/weather/forecast-email/status
 * Get forecast email ingestion status
 */
router.get('/forecast-email/status', async (req, res) => {
  try {
    const status = await forecastEmailService.getStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('Failed to get forecast email status', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/weather/data-status
 * Combined status: last weather API fetch + last expert email processed
 */
router.get('/data-status', async (req, res) => {
  try {
    // Last weather fetch: most recent last_fetch across all active areas
    const areas = await weatherAreaService.getAllAreas();
    const lastFetches = areas.map(a => a.last_fetch).filter(Boolean).sort().reverse();
    const lastWeatherFetch = lastFetches[0] || null;

    // Last expert email: most recent parsed email that produced forecasts for active areas
    const recentEmails = await forecastEmailRepository.getRecentEmails(20);
    let lastParsed = null;
    for (const email of recentEmails) {
      if (email.parse_status !== 'parsed') continue;
      const hasForecasts = await forecastEmailRepository.emailHasActiveForecasts(email.id);
      if (hasForecasts) {
        lastParsed = email;
        break;
      }
    }

    res.json({
      success: true,
      data: {
        weatherApi: {
          lastFetch: lastWeatherFetch,
        },
        expertEmail: lastParsed ? {
          subject: lastParsed.subject,
          receivedAt: lastParsed.received_at,
          forecastDate: lastParsed.forecast_date,
          parsedAt: lastParsed.created_at,
        } : null,
      }
    });
  } catch (error) {
    logger.error('Failed to get data status', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/weather/expert-forecast-changes
 * Get per-area change summaries (generated at parse time)
 */
router.get('/expert-forecast-changes', async (req, res) => {
  try {
    const summaries = await forecastEmailRepository.getChangeSummaries();
    res.json({ success: true, data: summaries });
  } catch (error) {
    logger.error('Failed to get expert forecast changes', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== AI SAILING SUMMARY ==========

/**
 * POST /api/weather/ai-sailing-summary
 * Generate AI-powered sailing conditions summary
 */
router.post('/ai-sailing-summary', async (req, res) => {
  try {
    const { scores, area, preferences } = req.body;

    if (!scores || scores.length === 0) {
      return res.status(400).json({ success: false, error: 'No scores provided' });
    }

    // Build prompt with scoring data
    const bestWindows = [...scores].sort((a, b) => b.score - a.score).slice(0, 5);
    const worstWindows = [...scores].sort((a, b) => a.score - b.score).slice(0, 5);

    const summaryData = scores.map(s =>
      `${s.dayName} ${s.dayNum} ${s.timeLabel}: Wind ${s.wind?.toFixed(0) || '--'}kn, Wave ${s.waveCalc?.toFixed(1) || s.waveConsensus?.toFixed(1) || '--'}m, Period ${s.period?.toFixed(0) || '--'}s, Current: ${s.currentRelation}, Score: ${s.score}/100`
    ).join('\n');

    const prompt = `You are a sailing weather advisor for a catamaran. Analyze this 10-day forecast data and provide a concise sailing recommendation.

LOCATION: ${area?.name || 'Caribbean'} (${area?.lat?.toFixed(2) || '16.2'}°N, ${area?.lng?.toFixed(2) || '-61.5'}°W)

SAILOR PREFERENCES:
- Preferred wind: under ${preferences?.preferWind || 20} knots
- Maximum tolerable wind: ${preferences?.maxWind || 25} knots
- Preferred wave height: under ${preferences?.preferWave || 1.3}m
- Maximum tolerable waves: ${preferences?.maxWave || 1.5}m
- Minimum comfortable wave period: ${preferences?.minPeriod || 6}s
- Current: prefer following or crossing, avoid opposing (creates steep waves)

FORECAST DATA (50 time blocks over 10 days):
${summaryData}

BEST WINDOWS (highest scores):
${bestWindows.map(w => `- ${w.dayName} ${w.dayNum} ${w.timeLabel}: Score ${w.score}`).join('\n')}

WORST WINDOWS (lowest scores):
${worstWindows.map(w => `- ${w.dayName} ${w.dayNum} ${w.timeLabel}: Score ${w.score}`).join('\n')}

Provide:
1. A 2-3 sentence summary of the best sailing windows in the next 10 days
2. Any specific cautions or things to avoid
3. Keep it conversational and practical for a sailor planning their week`;

    const outlookPrompt = `Based on typical ${new Date().toLocaleString('en-US', { month: 'long' })} weather patterns for ${area?.name || 'Guadeloupe'} in the Caribbean (${area?.lat?.toFixed(2) || '16.2'}°N, ${area?.lng?.toFixed(2) || '-61.5'}°W):

Provide a brief 2-3 sentence general outlook for days 11-17 (the week after the forecast period). Consider:
- Typical trade wind patterns for this time of year
- Seasonal swell patterns from the Atlantic
- Any common weather phenomena (cold front passages, etc.)

Note: This is a general seasonal outlook, not a forecast. Be appropriately uncertain.`;

    // Initialize OpenAI
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const model = 'gpt-4.1-mini'; // Lightweight model for summaries

    // Get both summary and outlook in parallel
    const [summaryResponse, outlookResponse] = await Promise.all([
      openai.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.7
      }),
      openai.chat.completions.create({
        model,
        messages: [{ role: 'user', content: outlookPrompt }],
        max_tokens: 150,
        temperature: 0.7
      })
    ]);

    const summary = summaryResponse.choices[0]?.message?.content || 'Unable to generate summary';
    const outlook = outlookResponse.choices[0]?.message?.content || 'Unable to generate outlook';

    logger.info('AI sailing summary generated', {
      area: area?.name,
      scoreCount: scores.length,
      bestScore: bestWindows[0]?.score,
      worstScore: worstWindows[0]?.score
    });

    res.json({
      success: true,
      data: {
        summary,
        outlook,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to generate AI sailing summary', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
