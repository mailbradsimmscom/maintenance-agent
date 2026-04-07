/**
 * Journey Routes
 * API endpoints for journey planning and management
 *
 * Mounted at /api/journey
 */

import express from 'express';
import { z } from 'zod';
import { journeyService } from '../services/journey.service.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('journey-routes');

// ========== ZOD SCHEMAS ==========

const createJourneySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  start_name: z.string().nullable().optional(),
  start_lat: z.number().min(-90).max(90),
  start_lon: z.number().min(-180).max(180),
  end_lat: z.number().min(-90).max(90),
  end_lon: z.number().min(-180).max(180),
  end_name: z.string().nullable().optional(),
  earliest_departure: z.string().datetime().nullable().optional(),
});

const updateJourneySchema = z.object({
  title: z.string().min(1).optional(),
  start_name: z.string().nullable().optional(),
  start_lat: z.number().min(-90).max(90).optional(),
  start_lon: z.number().min(-180).max(180).optional(),
  end_name: z.string().nullable().optional(),
  end_lat: z.number().min(-90).max(90).optional(),
  end_lon: z.number().min(-180).max(180).optional(),
  earliest_departure: z.string().datetime().nullable().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field is required' });

const selectRoutesSchema = z.object({
  routeIds: z.array(z.string().uuid()).min(0).max(3),
});

const scoreSchema = z.object({
  earliest_departure: z.string().min(1, 'earliest_departure is required'),
});

const beginSchema = z.object({
  route_id: z.string().uuid('route_id must be a valid UUID'),
  departure_time: z.string().min(1, 'departure_time is required'),
  trip_id: z.string().uuid('trip_id must be a valid UUID'),
});

const listQuerySchema = z.object({
  status: z.enum(['planning', 'sailing', 'completed']).optional(),
});

const addRouteSchema = z.object({
  name: z.string().min(1, 'Route name is required'),
  waypoints: z.array(z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    name: z.string().optional(),
  })).optional(),
  distance_nm: z.number().positive().optional(),
  estimated_duration_hrs: z.number().positive().optional(),
  estimated_avg_sog: z.number().positive().optional(),
  sort_order: z.number().int().optional(),
  ai_description: z.string().nullable().optional(),
});

const aheadQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  sog: z.coerce.number().min(0).default(0),
});

/** Validate body/query with Zod, return parsed data or send 400 */
function validate(schema, data, res) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map(i => i.message).join('; ');
    res.status(400).json({ success: false, error: msg, requestId: res.locals.requestId });
    return null;
  }
  return result.data;
}

/** Send JSON response with requestId */
function sendJson(res, statusCode, body) {
  res.status(statusCode).json({ ...body, requestId: res.locals.requestId });
}

function ok(res, data, statusCode = 200) { sendJson(res, statusCode, { success: true, data }); }
function fail(res, statusCode, error) { sendJson(res, statusCode, { success: false, error }); }

// ========== JOURNEY CRUD ==========

/**
 * POST /api/journey
 * Create a new journey
 */
router.post('/', async (req, res) => {
  const body = validate(createJourneySchema, req.body, res);
  if (!body) return;

  try {
    const journey = await journeyService.createJourney(body);
    ok(res, journey, 201);
  } catch (error) {
    logger.error('Failed to create journey', { error: error.message });
    fail(res, 500, error.message);
  }
});

/**
 * GET /api/journey
 * List journeys, optionally filtered by status
 * Query: ?status=planning|sailing|completed
 */
router.get('/', async (req, res) => {
  const query = validate(listQuerySchema, req.query, res);
  if (!query) return;

  try {
    const journeys = await journeyService.listJourneys(query.status || null);
    ok(res, journeys);
  } catch (error) {
    logger.error('Failed to list journeys', { error: error.message });
    fail(res, 500, error.message);
  }
});

/**
 * GET /api/journey/:id
 * Get journey with routes and scenarios
 */
router.get('/:id', async (req, res) => {
  try {
    const journey = await journeyService.getJourney(req.params.id);
    if (!journey) {
      return fail(res, 404, 'Journey not found');
    }
    ok(res, journey);
  } catch (error) {
    logger.error('Failed to get journey', { id: req.params.id, error: error.message });
    fail(res, 500, error.message);
  }
});

/**
 * PUT /api/journey/:id
 * Update journey
 */
router.put('/:id', async (req, res) => {
  const body = validate(updateJourneySchema, req.body, res);
  if (!body) return;

  try {
    const journey = await journeyService.updateJourney(req.params.id, body);
    ok(res, journey);
  } catch (error) {
    logger.error('Failed to update journey', { id: req.params.id, error: error.message });
    const status = error.message.includes('not found') ? 404
      : error.message.includes('Cannot update') ? 400
      : 500;
    fail(res, status, error.message);
  }
});

/**
 * DELETE /api/journey/:id
 * Delete journey (planning state only)
 */
router.delete('/:id', async (req, res) => {
  try {
    await journeyService.deleteJourney(req.params.id);
    ok(res, { deleted: true });
  } catch (error) {
    logger.error('Failed to delete journey', { id: req.params.id, error: error.message });
    const status = error.message.includes('Cannot delete') ? 400
      : error.message.includes('not found') ? 404
      : 500;
    fail(res, status, error.message);
  }
});

// ========== ROUTES ==========

/**
 * POST /api/journey/:id/routes
 * Add a route to a journey
 */
router.post('/:id/routes', async (req, res) => {
  const body = validate(addRouteSchema, req.body, res);
  if (!body) return;

  try {
    const route = await journeyService.addRoute(req.params.id, body);
    ok(res, route, 201);
  } catch (error) {
    logger.error('Failed to add route', { journeyId: req.params.id, error: error.message });
    const status = error.message.includes('not found') ? 404
      : error.message.includes('only') ? 400
      : 500;
    fail(res, status, error.message);
  }
});

/**
 * POST /api/journey/:id/routes/generate
 * Re-generate routes with AI (clears existing routes)
 */
router.post('/:id/routes/generate', async (req, res) => {
  try {
    const routes = await journeyService.generateRoutes(req.params.id);
    ok(res, routes);
  } catch (error) {
    logger.error('Failed to generate routes', { journeyId: req.params.id, error: error.message });
    const status = error.message.includes('not found') ? 404
      : error.message.includes('only') || error.message.includes('failed validation') ? 400
      : 500;
    fail(res, status, error.message);
  }
});

/**
 * PUT /api/journey/:id/routes/select
 * Select routes for comparison (max 3)
 * Body: { routeIds: ["uuid", "uuid"] }
 */
router.put('/:id/routes/select', async (req, res) => {
  const body = validate(selectRoutesSchema, req.body, res);
  if (!body) return;

  try {
    const routes = await journeyService.selectRoutes(req.params.id, body.routeIds);
    ok(res, routes);
  } catch (error) {
    logger.error('Failed to select routes', { journeyId: req.params.id, error: error.message });
    const status = error.message.includes('not found') ? 404
      : error.message.includes('must be') || error.message.includes('Cannot') || error.message.includes('only') ? 400
      : 500;
    fail(res, status, error.message);
  }
});

// ========== SCENARIOS ==========

/**
 * POST /api/journey/:id/score
 * Score all scenarios (selected routes × departure windows)
 * Body: { earliest_departure: "2026-04-07T10:00:00Z" }
 */
router.post('/:id/score', async (req, res) => {
  const body = validate(scoreSchema, req.body, res);
  if (!body) return;

  try {
    const result = await journeyService.scoreScenarios(req.params.id, body.earliest_departure);
    ok(res, result);
  } catch (error) {
    logger.error('Failed to score scenarios', { journeyId: req.params.id, error: error.message });
    const status = error.message.includes('not found') ? 404
      : error.message.includes('No routes selected') || error.message.includes('required') || error.message.includes('only') ? 400
      : 500;
    fail(res, status, error.message);
  }
});

/**
 * GET /api/journey/:id/scenarios
 * Get all scenarios for a journey
 */
router.get('/:id/scenarios', async (req, res) => {
  try {
    const journey = await journeyService.getJourney(req.params.id);
    if (!journey) {
      return fail(res, 404, 'Journey not found');
    }
    ok(res, journey.scenarios);
  } catch (error) {
    logger.error('Failed to get scenarios', { journeyId: req.params.id, error: error.message });
    fail(res, 500, error.message);
  }
});

/**
 * GET /api/journey/:id/scenarios/:scenarioId
 * Get detailed waypoint-by-waypoint breakdown for a scenario
 */
router.get('/:id/scenarios/:scenarioId', async (req, res) => {
  try {
    const scenario = await journeyService.getScenarioDetail(req.params.scenarioId);
    if (!scenario) {
      return fail(res, 404, 'Scenario not found');
    }
    ok(res, scenario);
  } catch (error) {
    logger.error('Failed to get scenario detail', { scenarioId: req.params.scenarioId, error: error.message });
    fail(res, 500, error.message);
  }
});

// ========== SAILING STATE ==========

/**
 * GET /api/journey/:id/ahead
 * Forward weather for remaining route
 * Query: ?lat=X&lon=Y&sog=Z
 */
router.get('/:id/ahead', async (req, res) => {
  const query = validate(aheadQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await journeyService.getWeatherAhead(
      req.params.id,
      query.lat,
      query.lon,
      query.sog,
    );
    ok(res, result);
  } catch (error) {
    logger.error('Failed to get weather ahead', { journeyId: req.params.id, error: error.message });
    const status = error.message.includes('not found') ? 404
      : error.message.includes('not in sailing') ? 400
      : 500;
    fail(res, status, error.message);
  }
});

// ========== STATE TRANSITIONS ==========

/**
 * POST /api/journey/:id/begin
 * Transition journey from planning to sailing
 * Body: { route_id, departure_time, trip_id }
 */
router.post('/:id/begin', async (req, res) => {
  const body = validate(beginSchema, req.body, res);
  if (!body) return;

  try {
    const journey = await journeyService.beginJourney(req.params.id, body);
    ok(res, journey);
  } catch (error) {
    logger.error('Failed to begin journey', { journeyId: req.params.id, error: error.message });
    const status = error.message.includes('not found') || error.message.includes('not in planning') ? 400
      : error.message.includes('required') ? 400
      : 500;
    fail(res, status, error.message);
  }
});

/**
 * POST /api/journey/:id/complete
 * Transition journey from sailing to completed
 */
router.post('/:id/complete', async (req, res) => {
  try {
    const journey = await journeyService.completeJourney(req.params.id);
    ok(res, journey);
  } catch (error) {
    logger.error('Failed to complete journey', { journeyId: req.params.id, error: error.message });
    const status = error.message.includes('not found') || error.message.includes('not in sailing') ? 400 : 500;
    fail(res, status, error.message);
  }
});

export default router;
