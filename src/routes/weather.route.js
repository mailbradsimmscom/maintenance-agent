/**
 * Weather Routes
 * API endpoints for weather areas and forecasts
 */

import express from 'express';
import { weatherAreaService } from '../services/weather-area.service.js';
import { weatherFetchService } from '../services/weather-fetch.service.js';
import { weatherForecastService } from '../services/weather-forecast.service.js';
import { weatherCreditsService } from '../services/weather-credits.service.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('weather-routes');

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
    const { name, latitude, longitude, description } = req.body;

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
      description
    });

    res.status(201).json({ success: true, data: area });
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
 * Body: { sources: ['openmeteo', 'meteoblue'] } - optional, defaults to both
 */
router.post('/areas/:id/fetch', async (req, res) => {
  try {
    const sources = req.body?.sources || ['openmeteo', 'meteoblue'];
    logger.info('Manual fetch triggered', { areaId: req.params.id, sources });
    const result = await weatherFetchService.fetchForArea(req.params.id, { sources });
    res.json({ success: true, data: result });
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

export default router;
