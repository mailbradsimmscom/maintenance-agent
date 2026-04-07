/**
 * Journey Service
 * Business logic for journey planning and management
 *
 * Phase 1: CRUD + Phase 2: AI Route Generation + Phase 3: Scenario Scoring
 */

import OpenAI from 'openai';
import { journeyRepository } from '../repositories/journey.repository.js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { validateWaypoints, checkWaypointsInWater, calculateRouteDistance, estimateDuration, bearing } from '../utils/waypoint-validation.js';
import { scoreWaypoint, calculateOverallScore, getWeatherAtTime } from '../utils/scoring.js';

const logger = createLogger('journey-service');

const VALID_STATUSES = ['planning', 'sailing', 'completed'];
const MAX_SELECTED_ROUTES = 3;
const MAX_ROUTES_TO_GENERATE = 5;
const DEFAULT_AVG_SOG = 6.5; // knots — typical for this catamaran
const DEPARTURE_WINDOW_COUNT = 6;
const DEPARTURE_WINDOW_INTERVAL_HRS = 12;

// Open-Meteo API endpoints (free, unlimited)
const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
const MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine';

const ROUTE_GENERATION_SYSTEM_PROMPT = `You are an expert Caribbean and US East Coast sailing route planner for a cruising catamaran.

You generate sailing route options as JSON. Each route is an array of waypoints (lat/lon coordinates) that are ALL IN WATER — never on land.

CRITICAL GEOGRAPHIC KNOWLEDGE:
- The Lesser Antilles chain runs roughly N-S from the Virgins to Trinidad, with islands spaced 20-40nm apart
- Island chain (north to south): BVI, St Martin, St Barths, Saba, St Kitts/Nevis, Antigua/Barbuda, Montserrat, Guadeloupe, Dominica, Martinique, St Lucia, St Vincent, Grenadines, Grenada, Trinidad
- The lee (western) side of each island provides shelter from trade winds and is the normal sailing route between islands
- Passages between islands: Guadeloupe Passage, Dominica Channel, Martinique Channel, St Lucia Channel, St Vincent Passage
- Leeward Islands (Antigua north): more spread out, trades can be beam reach going north
- Windward Islands (Guadeloupe south): closer together, can be a beat going south

CARIBBEAN ROUTING RULES:
- Island-hopping along the lee sides is the standard comfortable route
- Direct offshore routes are shorter but more exposed
- When going NORTH, the trades are typically on the beam or forward quarter — harder sailing
- When going SOUTH, trades are typically aft — easier, faster sailing
- Give island coasts 1-2nm clearance for waypoints (don't place waypoints right on the shore)
- Place waypoints at the midpoint of each passage between islands
- Route waypoints through the open water WEST of the island chain (lee side) unless going offshore

US EAST COAST:
- Gulf Stream flows north at 2-4kt — critical for routing
- Northbound: stay IN the Gulf Stream for a boost
- Southbound: stay WEST of the Gulf Stream to avoid opposing current
- Cape Hatteras is a major waypoint / weather gate
- Bahamas: use established channels (Providence Channel, NW Channel, etc.)

MAJOR PASSAGE CORRIDORS (use these when the route spans these regions):
- Caribbean to US East Coast:
  1. Old Bahamas Channel: west along Hispaniola north coast → Windward Passage or Crooked Island Passage → Old Bahamas Channel (between Cuba and Great Bahama Bank) → Straits of Florida → US coast
  2. Southern Bahamas / Exuma Sound: Turks & Caicos → Mayaguana → Crooked/Acklins → Exuma Sound → Providence Channel → US coast
  3. Atlantic offshore (Thorny Path): east into Atlantic to clear trades → north → ride Gulf Stream northwest to US coast
- Bahamas to US: Providence Channel → Gulf Stream crossing → Florida coast or direct to destination
- Caribbean inter-island: lee-side island hopping vs. direct offshore crossing

Respond with JSON only. Generate the most realistic number of route options (1-5):
{
  "routes": [
    {
      "name": "Route name",
      "description": "Brief description of this route option and its trade-offs",
      "estimated_avg_sog": 6.5,
      "waypoints": [
        {"lat": 18.45, "lon": -64.62, "name": "Departure point"},
        {"lat": 18.50, "lon": -64.30, "name": "Waypoint name"}
      ]
    }
  ]
}`;

export const journeyService = {

  /**
   * Create a new journey
   * @param {Object} data - { title, start_name, start_lat, start_lon, end_name, end_lat, end_lon, earliest_departure? }
   * @returns {Promise<Object>} Created journey
   */
  async createJourney(data) {
    const { title, start_name, start_lat, start_lon, end_name, end_lat, end_lon, earliest_departure } = data;

    // Validation
    if (!title || title.trim().length === 0) {
      throw new Error('Title is required');
    }
    if (start_lat === undefined || start_lat === null) {
      throw new Error('Start latitude is required');
    }
    if (start_lon === undefined || start_lon === null) {
      throw new Error('Start longitude is required');
    }
    if (end_lat === undefined || end_lat === null) {
      throw new Error('End latitude is required');
    }
    if (end_lon === undefined || end_lon === null) {
      throw new Error('End longitude is required');
    }
    if (start_lat < -90 || start_lat > 90) {
      throw new Error('Start latitude must be between -90 and 90');
    }
    if (start_lon < -180 || start_lon > 180) {
      throw new Error('Start longitude must be between -180 and 180');
    }
    if (end_lat < -90 || end_lat > 90) {
      throw new Error('End latitude must be between -90 and 90');
    }
    if (end_lon < -180 || end_lon > 180) {
      throw new Error('End longitude must be between -180 and 180');
    }

    logger.info('Creating journey', { title, start_name, end_name });
    const journey = await journeyRepository.create({
      title: title.trim(),
      start_name: start_name?.trim() || null,
      start_lat,
      start_lon,
      end_name: end_name?.trim() || null,
      end_lat,
      end_lon,
      earliest_departure: earliest_departure || null,
    });

    // Auto-generate routes after creation
    try {
      await this.generateRoutes(journey.id);
    } catch (err) {
      logger.error('Auto route generation failed (journey still created)', { journeyId: journey.id, error: err.message });
      // Don't fail the create — journey exists, routes can be regenerated
    }

    // Return journey with generated routes
    return journeyRepository.getJourneyFull(journey.id);
  },

  /**
   * List journeys, optionally filtered by status
   * @param {string|null} status - planning/sailing/completed or null for all
   * @returns {Promise<Array>} List of journeys
   */
  async listJourneys(status = null) {
    if (status && !VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    return journeyRepository.getAll(status);
  },

  /**
   * Get journey by ID with routes and scenarios
   * @param {string} id - Journey UUID
   * @returns {Promise<Object|null>} Journey with routes and scenarios
   */
  async getJourney(id) {
    return journeyRepository.getJourneyFull(id);
  },

  /**
   * Update journey (planning state only for most fields)
   * @param {string} id - Journey UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated journey
   */
  async updateJourney(id, updates) {
    const journey = await journeyRepository.getById(id);
    if (!journey) {
      throw new Error('Journey not found');
    }

    // Only allow editing most fields in planning state
    if (journey.status !== 'planning') {
      const allowedInSailing = ['title'];
      const disallowed = Object.keys(updates).filter(k => !allowedInSailing.includes(k));
      if (disallowed.length > 0) {
        throw new Error(`Cannot update ${disallowed.join(', ')} while journey is in '${journey.status}' state`);
      }
    }

    // Validate coordinates if provided
    if (updates.start_lat !== undefined && (updates.start_lat < -90 || updates.start_lat > 90)) {
      throw new Error('Start latitude must be between -90 and 90');
    }
    if (updates.start_lon !== undefined && (updates.start_lon < -180 || updates.start_lon > 180)) {
      throw new Error('Start longitude must be between -180 and 180');
    }
    if (updates.end_lat !== undefined && (updates.end_lat < -90 || updates.end_lat > 90)) {
      throw new Error('End latitude must be between -90 and 90');
    }
    if (updates.end_lon !== undefined && (updates.end_lon < -180 || updates.end_lon > 180)) {
      throw new Error('End longitude must be between -180 and 180');
    }

    logger.info('Updating journey', { id, fields: Object.keys(updates) });
    return journeyRepository.update(id, updates);
  },

  /**
   * Delete journey (planning state only)
   * @param {string} id - Journey UUID
   */
  async deleteJourney(id) {
    logger.info('Deleting journey', { id });
    return journeyRepository.delete(id);
  },

  // ========== AI ROUTE GENERATION ==========

  /**
   * Generate sailing routes for a journey using AI
   * Deletes any existing routes first, then generates new ones
   * @param {string} journeyId - Journey UUID
   * @returns {Promise<Array>} Generated routes
   */
  async generateRoutes(journeyId) {
    const journey = await journeyRepository.getById(journeyId);
    if (!journey) {
      throw new Error('Journey not found');
    }
    if (journey.status !== 'planning') {
      throw new Error('Can only generate routes for journeys in planning state');
    }

    logger.info('Generating AI routes', {
      journeyId,
      from: journey.start_name || `${journey.start_lat},${journey.start_lon}`,
      to: journey.end_name || `${journey.end_lat},${journey.end_lon}`,
    });

    // Clear existing routes (and their scenarios via CASCADE)
    await journeyRepository.deleteRoutesByJourneyId(journeyId);

    // Call AI to generate routes
    const config = getConfig();
    const openai = new OpenAI({ apiKey: config.openai.apiKey, timeout: 60000 });

    const prompt = this._buildRoutePrompt(journey);

    const response = await openai.chat.completions.create({
      model: 'gpt-5.4',
      messages: [
        { role: 'system', content: ROUTE_GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('AI returned empty response for route generation');
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      logger.error('Failed to parse AI route response', { content: content.substring(0, 500) });
      throw new Error('AI returned invalid JSON for route generation');
    }

    if (!parsed.routes || !Array.isArray(parsed.routes) || parsed.routes.length === 0) {
      throw new Error('AI returned no routes');
    }

    // Validate and save each route
    const savedRoutes = [];
    for (let i = 0; i < Math.min(parsed.routes.length, MAX_ROUTES_TO_GENERATE); i++) {
      const aiRoute = parsed.routes[i];

      // Prepend start and append end if AI didn't include them
      const waypoints = this._ensureStartEndWaypoints(aiRoute.waypoints, journey);

      // Validate waypoints (bounds + distance)
      const validation = validateWaypoints(waypoints);
      if (!validation.valid) {
        logger.warn('Route failed validation, skipping', {
          routeName: aiRoute.name,
          errors: validation.errors,
        });
        continue;
      }

      // Check waypoints are in water (elevation check via Open-Meteo)
      const waterCheck = await checkWaypointsInWater(waypoints);
      if (!waterCheck.valid) {
        logger.warn('Route has waypoints on land, skipping', {
          routeName: aiRoute.name,
          landPoints: waterCheck.landPoints,
        });
        continue;
      }

      const distanceNm = validation.totalDistanceNm;
      const avgSog = aiRoute.estimated_avg_sog || DEFAULT_AVG_SOG;
      const durationHrs = estimateDuration(distanceNm, avgSog);

      const saved = await journeyRepository.createRoute(journeyId, {
        name: aiRoute.name,
        waypoints,
        distance_nm: distanceNm,
        estimated_duration_hrs: durationHrs,
        estimated_avg_sog: avgSog,
        sort_order: i + 1,
        ai_description: aiRoute.description || null,
      });

      savedRoutes.push(saved);
    }

    if (savedRoutes.length === 0) {
      throw new Error('All AI-generated routes failed validation');
    }

    logger.info('Routes generated', { journeyId, count: savedRoutes.length });
    return savedRoutes;
  },

  /**
   * Build the user prompt for route generation
   * @private
   */
  _buildRoutePrompt(journey) {
    const startName = journey.start_name || 'Start';
    const endName = journey.end_name || 'Destination';
    const straightLineNm = calculateRouteDistance([
      { lat: journey.start_lat, lon: journey.start_lon },
      { lat: journey.end_lat, lon: journey.end_lon },
    ]);

    return `Generate sailing routes from ${startName} (${journey.start_lat}, ${journey.start_lon}) to ${endName} (${journey.end_lat}, ${journey.end_lon}).

Straight-line distance: approximately ${straightLineNm}nm.

Requirements:
- Generate as many distinct viable route options as possible, up to 5
- For short passages (<40nm), 1-2 routes is acceptable
- For medium passages (40-200nm), generate 2-3 routes
- For long passages (200nm+), generate 3-5 routes — there are almost always multiple corridor options
- Consider ALL of: direct/offshore, island-hopping lee-side, alternative passages, and any major corridor options listed in your knowledge
- Every waypoint MUST be in water — give coastlines at least 1nm clearance
- Waypoint spacing: 10-80nm between consecutive waypoints (closer in island chains, wider in open ocean)
- Include the departure and arrival coordinates as the first and last waypoints
- Estimated average SOG: ${DEFAULT_AVG_SOG} knots (sailing catamaran)
- Route distance should be realistic — don't loop or backtrack unnecessarily
- For passages over 200nm between the Caribbean and the US East Coast, you MUST include ALL THREE of these corridors:
  (a) Old Bahamas Channel via Windward Passage / Crooked Island Passage
  (b) Southern Bahamas / Exuma Sound / Providence Channel
  (c) Atlantic offshore — sail EAST from departure to ~60-62W longitude to clear the trade wind belt, then turn NORTH into the westerlies, and ride the Gulf Stream northwest to the US coast. This route goes far east first (counterintuitive but standard offshore passage strategy)`;
  },

  /**
   * Ensure the start and end coordinates are included as waypoints
   * @private
   */
  _ensureStartEndWaypoints(waypoints, journey) {
    if (!Array.isArray(waypoints) || waypoints.length === 0) {
      return [
        { lat: journey.start_lat, lon: journey.start_lon, name: journey.start_name || 'Start' },
        { lat: journey.end_lat, lon: journey.end_lon, name: journey.end_name || 'Destination' },
      ];
    }

    const result = [...waypoints];
    const first = result[0];
    const last = result[result.length - 1];

    // Check if start is already included (within ~0.5nm)
    const startDist = Math.sqrt((first.lat - journey.start_lat) ** 2 + (first.lon - journey.start_lon) ** 2);
    if (startDist > 0.01) { // ~0.6nm
      result.unshift({ lat: journey.start_lat, lon: journey.start_lon, name: journey.start_name || 'Start' });
    }

    // Check if end is already included
    const endDist = Math.sqrt((last.lat - journey.end_lat) ** 2 + (last.lon - journey.end_lon) ** 2);
    if (endDist > 0.01) {
      result.push({ lat: journey.end_lat, lon: journey.end_lon, name: journey.end_name || 'Destination' });
    }

    return result;
  },

  // ========== ROUTES ==========

  /**
   * Add a route to a journey (planning state only)
   * @param {string} journeyId - Journey UUID
   * @param {Object} routeData - Route details
   * @returns {Promise<Object>} Created route
   */
  async addRoute(journeyId, routeData) {
    const journey = await journeyRepository.getById(journeyId);
    if (!journey) {
      throw new Error('Journey not found');
    }
    if (journey.status !== 'planning') {
      throw new Error('Can only add routes to journeys in planning state');
    }

    const { name, waypoints, distance_nm, estimated_duration_hrs, estimated_avg_sog, sort_order, ai_description } = routeData;

    if (!name || name.trim().length === 0) {
      throw new Error('Route name is required');
    }

    // Validate waypoints if provided
    if (waypoints && Array.isArray(waypoints)) {
      for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i];
        if (wp.lat === undefined || wp.lon === undefined) {
          throw new Error(`Waypoint ${i} must have lat and lon`);
        }
        if (wp.lat < -90 || wp.lat > 90) {
          throw new Error(`Waypoint ${i} latitude must be between -90 and 90`);
        }
        if (wp.lon < -180 || wp.lon > 180) {
          throw new Error(`Waypoint ${i} longitude must be between -180 and 180`);
        }
      }
    }

    return journeyRepository.createRoute(journeyId, {
      name: name.trim(),
      waypoints: waypoints || [],
      distance_nm,
      estimated_duration_hrs,
      estimated_avg_sog,
      sort_order,
      ai_description,
    });
  },

  /**
   * Select routes for comparison (max 3)
   * @param {string} journeyId - Journey UUID
   * @param {Array<string>} routeIds - Route UUIDs to select
   * @returns {Promise<Array>} Updated routes
   */
  async selectRoutes(journeyId, routeIds) {
    if (!Array.isArray(routeIds)) {
      throw new Error('routeIds must be an array');
    }
    if (routeIds.length > MAX_SELECTED_ROUTES) {
      throw new Error(`Cannot select more than ${MAX_SELECTED_ROUTES} routes`);
    }

    const journey = await journeyRepository.getById(journeyId);
    if (!journey) {
      throw new Error('Journey not found');
    }
    if (journey.status !== 'planning') {
      throw new Error('Can only select routes for journeys in planning state');
    }

    // Verify all route IDs belong to this journey
    const routes = await journeyRepository.getRoutesByJourneyId(journeyId);
    const validIds = new Set(routes.map(r => r.id));
    const invalid = routeIds.filter(id => !validIds.has(id));
    if (invalid.length > 0) {
      throw new Error(`Route IDs not found in this journey: ${invalid.join(', ')}`);
    }

    return journeyRepository.selectRoutes(journeyId, routeIds);
  },

  // ========== BEGIN / COMPLETE ==========

  /**
   * Begin a journey — transition from planning to sailing
   * @param {string} journeyId - Journey UUID
   * @param {Object} data - { route_id, departure_time, trip_id }
   * @returns {Promise<Object>} Updated journey
   */
  async beginJourney(journeyId, { route_id, departure_time, trip_id }) {
    if (!route_id) throw new Error('route_id is required');
    if (!departure_time) throw new Error('departure_time is required');
    if (!trip_id) throw new Error('trip_id is required');

    // Verify route belongs to journey and is selected
    const route = await journeyRepository.getRouteById(route_id);
    if (!route || route.journey_id !== journeyId) {
      throw new Error('Route not found in this journey');
    }

    logger.info('Beginning journey', { journeyId, routeId: route_id, tripId: trip_id });
    return journeyRepository.beginJourney(journeyId, { route_id, departure_time, trip_id });
  },

  /**
   * Complete a journey — transition from sailing to completed
   * @param {string} journeyId - Journey UUID
   * @returns {Promise<Object>} Updated journey
   */
  async completeJourney(journeyId) {
    logger.info('Completing journey', { journeyId });
    return journeyRepository.completeJourney(journeyId);
  },

  /**
   * Get detailed scenario with route info
   * @param {string} scenarioId - Scenario UUID
   * @returns {Promise<Object|null>} Scenario with waypoint scores
   */
  async getScenarioDetail(scenarioId) {
    const scenario = await journeyRepository.getScenarioById(scenarioId);
    if (!scenario) return null;

    const route = await journeyRepository.getRouteById(scenario.route_id);
    return { ...scenario, route_name: route?.name || null, route_distance_nm: route?.distance_nm || null };
  },

  // ========== SCENARIO SCORING (Phase 3) ==========

  /**
   * Score all scenarios for a journey (selected routes × departure windows)
   * @param {string} journeyId - Journey UUID
   * @param {string} earliestDeparture - ISO datetime for first departure window
   * @returns {Promise<Object>} Scored scenarios with AI summary
   */
  async scoreScenarios(journeyId, earliestDeparture) {
    const journey = await journeyRepository.getJourneyFull(journeyId);
    if (!journey) throw new Error('Journey not found');
    if (journey.status !== 'planning') throw new Error('Can only score journeys in planning state');

    const selectedRoutes = (journey.routes || []).filter(r => r.is_selected);
    if (selectedRoutes.length === 0) throw new Error('No routes selected — select up to 3 routes before scoring');

    if (!earliestDeparture) throw new Error('Earliest departure time is required');

    const departureWindows = this._generateDepartureWindows(earliestDeparture);

    logger.info('Scoring scenarios', {
      journeyId,
      routeCount: selectedRoutes.length,
      windowCount: departureWindows.length,
      totalScenarios: selectedRoutes.length * departureWindows.length,
    });

    // Collect all unique waypoint coordinates across all selected routes
    const uniquePoints = this._deduplicateWaypoints(selectedRoutes);

    // Fetch weather for all unique points (one fetch covers all 6 windows — 7-day forecast)
    const weatherCache = await this._fetchWeatherForPoints(uniquePoints);

    // Delete existing scenarios for this journey (re-scoring replaces old)
    await journeyRepository.deleteScenariosByJourneyId(journeyId);

    // Score each route × departure window combination
    const scenarios = [];
    for (const route of selectedRoutes) {
      for (const departureTime of departureWindows) {
        const waypointScores = this._scoreRouteAtDeparture(route, departureTime, weatherCache);
        const overallScore = calculateOverallScore(waypointScores);

        const scenario = await journeyRepository.createScenario(journeyId, {
          route_id: route.id,
          departure_time: departureTime.toISOString(),
          overall_score: overallScore,
          waypoint_scores: waypointScores,
          scored_at: new Date().toISOString(),
        });

        scenarios.push({ ...scenario, route_name: route.name });
      }
    }

    // Generate AI summary
    let aiSummary = null;
    try {
      aiSummary = await this._generateScoringSummary(journey, selectedRoutes, scenarios, departureWindows);
    } catch (err) {
      logger.error('AI summary generation failed', { journeyId, error: err.message });
    }

    // Update the best scenario with the AI summary
    if (aiSummary && scenarios.length > 0) {
      const best = scenarios.reduce((a, b) => a.overall_score > b.overall_score ? a : b);
      await journeyRepository.updateScenario(best.id, { ai_summary: aiSummary });
      best.ai_summary = aiSummary;
    }

    // Update journey earliest_departure if changed
    if (journey.earliest_departure !== earliestDeparture) {
      await journeyRepository.update(journeyId, { earliest_departure: earliestDeparture });
    }

    logger.info('Scoring complete', { journeyId, scenarioCount: scenarios.length });
    return { scenarios, aiSummary };
  },

  /**
   * Generate 6 departure windows at 12-hour intervals from earliest departure
   * @private
   */
  _generateDepartureWindows(earliestDeparture) {
    const start = new Date(earliestDeparture);
    const windows = [];
    for (let i = 0; i < DEPARTURE_WINDOW_COUNT; i++) {
      const windowTime = new Date(start.getTime() + i * DEPARTURE_WINDOW_INTERVAL_HRS * 60 * 60 * 1000);
      windows.push(windowTime);
    }
    return windows;
  },

  /**
   * Collect unique waypoint lat/lon across all selected routes
   * Deduplicates by rounding to 0.01° (~1km)
   * @private
   * @returns {Map<string, {lat: number, lon: number}>} key → coords
   */
  _deduplicateWaypoints(routes) {
    const unique = new Map();
    for (const route of routes) {
      for (const wp of route.waypoints || []) {
        const key = `${(Math.round(wp.lat * 100) / 100).toFixed(2)},${(Math.round(wp.lon * 100) / 100).toFixed(2)}`;
        if (!unique.has(key)) {
          unique.set(key, { lat: Math.round(wp.lat * 100) / 100, lon: Math.round(wp.lon * 100) / 100 });
        }
      }
    }
    return unique;
  },

  /**
   * Fetch Open-Meteo forecast + marine data for all unique waypoint locations
   * Returns a cache keyed by rounded lat,lon
   * @private
   * @returns {Promise<Map<string, {forecast: Object, marine: Object}>>}
   */
  async _fetchWeatherForPoints(uniquePoints) {
    const cache = new Map();
    const entries = Array.from(uniquePoints.entries());

    logger.info('Fetching weather for waypoints', { uniquePointCount: entries.length });

    // Fetch in parallel with concurrency limit of 4
    const CONCURRENCY = 4;
    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async ([key, { lat, lon }]) => {
        try {
          const [forecast, marine] = await Promise.all([
            this._fetchForecast(lat, lon),
            this._fetchMarine(lat, lon),
          ]);
          return { key, forecast, marine };
        } catch (err) {
          logger.warn('Weather fetch failed for point', { key, error: err.message });
          return { key, forecast: null, marine: null };
        }
      }));

      for (const { key, forecast, marine } of results) {
        cache.set(key, { forecast, marine });
      }
    }

    logger.info('Weather fetch complete', { cachedPoints: cache.size });
    return cache;
  },

  /**
   * Fetch Open-Meteo forecast for a single point (no multi-model, single default)
   * @private
   */
  async _fetchForecast(lat, lon) {
    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
      forecast_days: '7',
      timezone: 'UTC',
    });

    const res = await fetch(`${FORECAST_BASE}?${params}`);
    if (!res.ok) {
      throw new Error(`Forecast API ${res.status}`);
    }
    return res.json();
  },

  /**
   * Fetch Open-Meteo marine data for a single point
   * Includes ocean currents if available
   * @private
   */
  async _fetchMarine(lat, lon) {
    const params = new URLSearchParams({
      latitude: lat.toString(),
      longitude: lon.toString(),
      hourly: [
        'wave_height',
        'wave_period',
        'swell_wave_height',
        'swell_wave_direction',
        'wind_wave_height',
        'ocean_current_velocity',
        'ocean_current_direction',
      ].join(','),
      forecast_days: '7',
      timezone: 'UTC',
    });

    const res = await fetch(`${MARINE_BASE}?${params}`);
    if (!res.ok) {
      throw new Error(`Marine API ${res.status}`);
    }
    return res.json();
  },

  /**
   * Score a single route at a specific departure time
   * Calculates ETA at each waypoint and scores conditions there
   * @private
   * @returns {Array} Waypoint score objects
   */
  _scoreRouteAtDeparture(route, departureTime, weatherCache) {
    const waypoints = route.waypoints || [];
    if (waypoints.length < 2) return [];

    const avgSog = route.estimated_avg_sog || DEFAULT_AVG_SOG;
    const waypointScores = [];

    let cumulativeHours = 0;

    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const estimatedArrival = new Date(departureTime.getTime() + cumulativeHours * 60 * 60 * 1000);

      // Sailing bearing: direction from this waypoint to the next
      let sailingBearing = null;
      if (i < waypoints.length - 1) {
        sailingBearing = bearing(wp.lat, wp.lon, waypoints[i + 1].lat, waypoints[i + 1].lon);
      } else if (i > 0) {
        // Last waypoint: use bearing from previous to this
        sailingBearing = bearing(waypoints[i - 1].lat, waypoints[i - 1].lon, wp.lat, wp.lon);
      }

      // Look up weather from cache
      const cacheKey = `${(Math.round(wp.lat * 100) / 100).toFixed(2)},${(Math.round(wp.lon * 100) / 100).toFixed(2)}`;
      const weatherData = weatherCache.get(cacheKey);

      let wpScore;
      if (weatherData && (weatherData.forecast || weatherData.marine)) {
        const weather = getWeatherAtTime(weatherData.forecast, weatherData.marine, estimatedArrival);
        wpScore = scoreWaypoint({
          windSpeedKmh: weather.windSpeedKmh,
          waveHeight: weather.waveHeight,
          swellHeight: weather.swellHeight,
          windWaveHeight: weather.windWaveHeight,
          wavePeriod: weather.wavePeriod,
          swellDirection: weather.swellDirection,
          currentSpeed: weather.currentSpeed,
          currentDirection: weather.currentDirection,
          sailingBearing,
        });
      } else {
        // No weather data — use neutral scores
        wpScore = scoreWaypoint({ sailingBearing });
      }

      waypointScores.push({
        waypoint_index: i,
        lat: wp.lat,
        lon: wp.lon,
        name: wp.name || `WP ${i}`,
        estimated_arrival: estimatedArrival.toISOString(),
        ...wpScore,
      });

      // Calculate time to next waypoint
      if (i < waypoints.length - 1) {
        const nextWp = waypoints[i + 1];
        const R = 3440.065;
        const dLat = (nextWp.lat - wp.lat) * Math.PI / 180;
        const dLon = (nextWp.lon - wp.lon) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(wp.lat * Math.PI / 180) * Math.cos(nextWp.lat * Math.PI / 180) *
          Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distNm = R * c;
        cumulativeHours += distNm / avgSog;
      }
    }

    return waypointScores;
  },

  /**
   * Generate AI summary of scoring results
   * @private
   */
  async _generateScoringSummary(journey, routes, scenarios, departureWindows) {
    const config = getConfig();
    const openai = new OpenAI({ apiKey: config.openai.apiKey, timeout: 30000 });

    // Build scenario summary for AI
    const scenarioLines = scenarios.map(s => {
      const route = routes.find(r => r.id === s.route_id);
      const dt = new Date(s.departure_time);
      const dayStr = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

      // Summarize worst waypoint
      const wpScores = s.waypoint_scores || [];
      const worst = wpScores.length > 0 ? wpScores.reduce((a, b) => a.score < b.score ? a : b) : null;

      return `- ${route?.name || 'Route'} departing ${dayStr} ${timeStr}: Score ${s.overall_score}/100` +
        (worst ? ` (worst leg: ${worst.name} at ${worst.score}, wind ${worst.wind_kts}kt, waves ${worst.effective_wave_m}m)` : '');
    }).join('\n');

    const best = scenarios.reduce((a, b) => a.overall_score > b.overall_score ? a : b);
    const bestRoute = routes.find(r => r.id === best.route_id);

    const prompt = `You are a sailing weather advisor for a cruising catamaran. Summarize these journey scoring results in 2-3 sentences. Be specific about conditions — mention wind speeds, wave heights, and timing. Recommend the best option and explain why.

Journey: ${journey.title} (${journey.start_name || 'Start'} to ${journey.end_name || 'End'})

Scenarios scored:
${scenarioLines}

Best: ${bestRoute?.name} departing ${new Date(best.departure_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${new Date(best.departure_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} — Score ${best.overall_score}/100`;

    const response = await openai.chat.completions.create({
      model: config.openai.summaryModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
    });

    return response.choices[0]?.message?.content || null;
  },

  // ========== SAILING STATE (Phase 5) ==========

  /**
   * Get forward weather for remaining route waypoints
   * Uses current boat position + SOG to calculate ETAs and score conditions ahead
   *
   * @param {string} journeyId - Journey UUID
   * @param {number} lat - Current boat latitude
   * @param {number} lon - Current boat longitude
   * @param {number} sog - Current speed over ground in knots
   * @returns {Promise<Object>} Forward weather with scored waypoints
   */
  async getWeatherAhead(journeyId, lat, lon, sog) {
    const journey = await journeyRepository.getJourneyFull(journeyId);
    if (!journey) throw new Error('Journey not found');
    if (journey.status !== 'sailing') throw new Error('Journey is not in sailing state');
    if (!journey.selected_route_id) throw new Error('No route selected for this journey');

    const route = (journey.routes || []).find(r => r.id === journey.selected_route_id);
    if (!route) throw new Error('Selected route not found');

    const waypoints = route.waypoints || [];
    if (waypoints.length < 2) throw new Error('Route has insufficient waypoints');

    const effectiveSog = sog > 0.5 ? sog : DEFAULT_AVG_SOG;

    // Find which waypoints are ahead of the current position
    const nearestIdx = this._findNearestWaypointIndex(waypoints, lat, lon);
    // Waypoints from nearest onward are "ahead"
    const aheadWaypoints = waypoints.slice(nearestIdx);
    const passedWaypoints = waypoints.slice(0, nearestIdx);

    if (aheadWaypoints.length === 0) {
      return {
        journey_id: journeyId,
        route_name: route.name,
        current_position: { lat, lon, sog: effectiveSog },
        status: 'near_destination',
        passed_count: passedWaypoints.length,
        ahead: [],
      };
    }

    // Collect unique waypoint coords for weather fetch
    const uniquePoints = this._deduplicateWaypoints([{ waypoints: aheadWaypoints }]);
    const weatherCache = await this._fetchWeatherForPoints(uniquePoints);

    // Calculate ETAs and score each waypoint ahead
    const now = new Date();
    let cumulativeHours = 0;

    // Distance from current position to first ahead waypoint
    const firstAhead = aheadWaypoints[0];
    const distToFirst = this._haversineNm(lat, lon, firstAhead.lat, firstAhead.lon);
    cumulativeHours = distToFirst / effectiveSog;

    const aheadScored = [];
    for (let i = 0; i < aheadWaypoints.length; i++) {
      const wp = aheadWaypoints[i];
      const eta = new Date(now.getTime() + cumulativeHours * 60 * 60 * 1000);

      // Sailing bearing to next waypoint
      let sailingBearing = null;
      if (i < aheadWaypoints.length - 1) {
        sailingBearing = bearing(wp.lat, wp.lon, aheadWaypoints[i + 1].lat, aheadWaypoints[i + 1].lon);
      } else if (i > 0) {
        sailingBearing = bearing(aheadWaypoints[i - 1].lat, aheadWaypoints[i - 1].lon, wp.lat, wp.lon);
      }

      // Weather lookup
      const cacheKey = `${(Math.round(wp.lat * 100) / 100).toFixed(2)},${(Math.round(wp.lon * 100) / 100).toFixed(2)}`;
      const weatherData = weatherCache.get(cacheKey);

      let wpScore;
      if (weatherData && (weatherData.forecast || weatherData.marine)) {
        const weather = getWeatherAtTime(weatherData.forecast, weatherData.marine, eta);
        wpScore = scoreWaypoint({
          windSpeedKmh: weather.windSpeedKmh,
          waveHeight: weather.waveHeight,
          swellHeight: weather.swellHeight,
          windWaveHeight: weather.windWaveHeight,
          wavePeriod: weather.wavePeriod,
          swellDirection: weather.swellDirection,
          currentSpeed: weather.currentSpeed,
          currentDirection: weather.currentDirection,
          sailingBearing,
        });
      } else {
        wpScore = scoreWaypoint({ sailingBearing });
      }

      // Distance from current position to this waypoint (cumulative along route)
      const distFromBoat = distToFirst + (i > 0 ? this._routeDistanceSlice(aheadWaypoints, 0, i) : 0);

      aheadScored.push({
        waypoint_index: nearestIdx + i,
        lat: wp.lat,
        lon: wp.lon,
        name: wp.name || `WP ${nearestIdx + i}`,
        distance_nm: Math.round(distFromBoat * 10) / 10,
        hours_away: Math.round(cumulativeHours * 10) / 10,
        eta: eta.toISOString(),
        ...wpScore,
      });

      // Time to next waypoint
      if (i < aheadWaypoints.length - 1) {
        const nextWp = aheadWaypoints[i + 1];
        const legDist = this._haversineNm(wp.lat, wp.lon, nextWp.lat, nextWp.lon);
        cumulativeHours += legDist / effectiveSog;
      }
    }

    const lastWp = aheadScored[aheadScored.length - 1];

    logger.info('Forward weather calculated', {
      journeyId,
      aheadCount: aheadScored.length,
      passedCount: passedWaypoints.length,
      etaDestination: lastWp?.eta,
    });

    return {
      journey_id: journeyId,
      route_name: route.name,
      route_distance_nm: route.distance_nm,
      current_position: { lat, lon, sog: effectiveSog },
      departed: journey.selected_departure,
      passed_count: passedWaypoints.length,
      ahead: aheadScored,
    };
  },

  /**
   * Find the index of the nearest waypoint to current position
   * @private
   */
  _findNearestWaypointIndex(waypoints, lat, lon) {
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < waypoints.length; i++) {
      const d = this._haversineNm(lat, lon, waypoints[i].lat, waypoints[i].lon);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    // If nearest is not the last waypoint, check if boat is past it
    // (closer to next waypoint than to nearest along the route direction)
    if (bestIdx < waypoints.length - 1) {
      const nextDist = this._haversineNm(lat, lon, waypoints[bestIdx + 1].lat, waypoints[bestIdx + 1].lon);
      const legDist = this._haversineNm(waypoints[bestIdx].lat, waypoints[bestIdx].lon, waypoints[bestIdx + 1].lat, waypoints[bestIdx + 1].lon);
      // If boat is more than halfway to next waypoint, consider current waypoint passed
      if (nextDist < legDist * 0.5) {
        bestIdx++;
      }
    }

    return bestIdx;
  },

  /**
   * Haversine distance in nautical miles
   * @private
   */
  _haversineNm(lat1, lon1, lat2, lon2) {
    const R = 3440.065;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  /**
   * Calculate route distance for a slice of waypoints
   * @private
   */
  _routeDistanceSlice(waypoints, startIdx, endIdx) {
    let total = 0;
    for (let i = startIdx; i < endIdx; i++) {
      total += this._haversineNm(waypoints[i].lat, waypoints[i].lon, waypoints[i + 1].lat, waypoints[i + 1].lon);
    }
    return total;
  },
};
