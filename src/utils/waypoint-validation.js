/**
 * Waypoint Validation Utility
 * Validates AI-generated route waypoints for sailing routes
 *
 * Checks:
 * - All waypoints within valid sailing bounds (Caribbean through US East Coast)
 * - Distance between consecutive waypoints within 1-50nm range
 * - Basic coordinate sanity (valid lat/lon)
 */

import { createLogger } from './logger.js';

const logger = createLogger('waypoint-validation');

// Sailing bounds: Caribbean through North Carolina
const BOUNDS = {
  minLat: 10,   // Southern Caribbean (Trinidad/Tobago area)
  maxLat: 36,   // North Carolina coast
  minLon: -90,  // Western Gulf / Caribbean
  maxLon: -58,  // Eastern Caribbean (Barbados area)
};

// Distance constraints between consecutive waypoints (nautical miles)
const MIN_WAYPOINT_DISTANCE_NM = 1;
const MAX_WAYPOINT_DISTANCE_NM = 300;

/**
 * Calculate distance between two coordinates in nautical miles (Haversine)
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in nautical miles
 */
export function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate bearing from point A to point B in degrees (0-360)
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Bearing in degrees
 */
export function bearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  const brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

/**
 * Validate a single waypoint
 * @param {Object} wp - { lat, lon, name? }
 * @param {number} index - Waypoint index for error messages
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSingleWaypoint(wp, index) {
  const errors = [];

  if (wp.lat === undefined || wp.lat === null || typeof wp.lat !== 'number') {
    errors.push(`Waypoint ${index}: lat is required and must be a number`);
    return { valid: false, errors };
  }
  if (wp.lon === undefined || wp.lon === null || typeof wp.lon !== 'number') {
    errors.push(`Waypoint ${index}: lon is required and must be a number`);
    return { valid: false, errors };
  }

  if (wp.lat < BOUNDS.minLat || wp.lat > BOUNDS.maxLat) {
    errors.push(`Waypoint ${index} (${wp.name || ''}): lat ${wp.lat} is outside bounds [${BOUNDS.minLat}, ${BOUNDS.maxLat}]`);
  }
  if (wp.lon < BOUNDS.minLon || wp.lon > BOUNDS.maxLon) {
    errors.push(`Waypoint ${index} (${wp.name || ''}): lon ${wp.lon} is outside bounds [${BOUNDS.minLon}, ${BOUNDS.maxLon}]`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an array of waypoints for a route
 * @param {Array<{lat: number, lon: number, name?: string}>} waypoints
 * @returns {{ valid: boolean, errors: string[], totalDistanceNm: number, legs: Array<{from: number, to: number, distanceNm: number}> }}
 */
export function validateWaypoints(waypoints) {
  const errors = [];
  const legs = [];
  let totalDistanceNm = 0;

  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return { valid: false, errors: ['Route must have at least 2 waypoints'], totalDistanceNm: 0, legs: [] };
  }

  // Validate each waypoint individually
  for (let i = 0; i < waypoints.length; i++) {
    const result = validateSingleWaypoint(waypoints[i], i);
    errors.push(...result.errors);
  }

  // Validate distances between consecutive waypoints
  for (let i = 0; i < waypoints.length - 1; i++) {
    const wp1 = waypoints[i];
    const wp2 = waypoints[i + 1];

    // Skip distance check if coordinates are invalid
    if (typeof wp1.lat !== 'number' || typeof wp1.lon !== 'number' ||
        typeof wp2.lat !== 'number' || typeof wp2.lon !== 'number') {
      continue;
    }

    const distNm = haversineNm(wp1.lat, wp1.lon, wp2.lat, wp2.lon);
    legs.push({ from: i, to: i + 1, distanceNm: Math.round(distNm * 10) / 10 });
    totalDistanceNm += distNm;

    if (distNm < MIN_WAYPOINT_DISTANCE_NM) {
      errors.push(`Leg ${i}→${i + 1}: distance ${distNm.toFixed(1)}nm is below minimum ${MIN_WAYPOINT_DISTANCE_NM}nm`);
    }
    if (distNm > MAX_WAYPOINT_DISTANCE_NM) {
      errors.push(`Leg ${i}→${i + 1}: distance ${distNm.toFixed(1)}nm exceeds maximum ${MAX_WAYPOINT_DISTANCE_NM}nm`);
    }
  }

  totalDistanceNm = Math.round(totalDistanceNm * 10) / 10;

  if (errors.length > 0) {
    logger.warn('Waypoint validation failed', { errorCount: errors.length, errors });
  }

  return { valid: errors.length === 0, errors, totalDistanceNm, legs };
}

/**
 * Check if waypoints are in water using Open-Meteo Elevation API
 * Points at sea level (elevation <= 5m) are considered water
 * Skips first and last waypoints (departure/arrival may be near shore)
 * @param {Array<{lat: number, lon: number, name?: string}>} waypoints
 * @returns {Promise<{valid: boolean, landPoints: Array<{index: number, name: string, elevation: number}>}>}
 */
export async function checkWaypointsInWater(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return { valid: true, landPoints: [] };
  }

  // Check intermediate waypoints only (skip first/last — harbors are near shore)
  const toCheck = waypoints.slice(1, -1);
  if (toCheck.length === 0) {
    return { valid: true, landPoints: [] };
  }

  const lats = toCheck.map(wp => wp.lat).join(',');
  const lons = toCheck.map(wp => wp.lon).join(',');

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`);
    if (!res.ok) {
      logger.warn('Elevation API failed, skipping water check', { status: res.status });
      return { valid: true, landPoints: [] };
    }

    const data = await res.json();
    const elevations = data.elevation || [];
    const landPoints = [];

    for (let i = 0; i < toCheck.length; i++) {
      const elev = elevations[i];
      if (elev !== undefined && elev > 5) {
        landPoints.push({
          index: i + 1, // +1 because we skipped first waypoint
          name: toCheck[i].name || `WP ${i + 1}`,
          lat: toCheck[i].lat,
          lon: toCheck[i].lon,
          elevation: elev,
        });
      }
    }

    if (landPoints.length > 0) {
      logger.warn('Waypoints on land detected', {
        count: landPoints.length,
        points: landPoints.map(p => `${p.name} (${p.lat},${p.lon}) elev=${p.elevation}m`),
      });
    }

    return { valid: landPoints.length === 0, landPoints };
  } catch (err) {
    logger.warn('Elevation API error, skipping water check', { error: err.message });
    return { valid: true, landPoints: [] };
  }
}

/**
 * Calculate total route distance from waypoints
 * @param {Array<{lat: number, lon: number}>} waypoints
 * @returns {number} Total distance in nautical miles
 */
export function calculateRouteDistance(waypoints) {
  let total = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    total += haversineNm(waypoints[i].lat, waypoints[i].lon, waypoints[i + 1].lat, waypoints[i + 1].lon);
  }
  return Math.round(total * 10) / 10;
}

/**
 * Estimate duration for a route at a given average SOG
 * @param {number} distanceNm - Distance in nautical miles
 * @param {number} avgSog - Average speed over ground in knots (default 6.5)
 * @returns {number} Duration in hours
 */
export function estimateDuration(distanceNm, avgSog = 6.5) {
  return Math.round((distanceNm / avgSog) * 10) / 10;
}
