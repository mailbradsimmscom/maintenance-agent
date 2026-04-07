/**
 * Scoring Utility — Server-side sailing condition scorer
 *
 * Canonical server-side implementation of the scoring algorithm.
 * Must produce identical results to the frontend scoreTimeBlock()
 * in src/public/weather-area-view.html (lines 581-701).
 *
 * 4 components, 100 points total:
 *   Wind:        35 pts — linear: ≤15kt=35, 15-25kt→0, ≥25kt=0
 *   Wave+Period: 35 pts — effective wave ≤1.5m=35, 1.5-2.5m→0, ≥2.5m=0
 *   Sea Dir:     15 pts — swell direction vs sailing bearing
 *   Current:     15 pts — current direction vs sailing bearing
 *
 * Overall journey score: 0.6 × weightedAvg + 0.4 × worstWaypointScore
 */

import { createLogger } from './logger.js';

const logger = createLogger('scoring');

// km/h to knots conversion factor
const KMH_TO_KNOTS = 0.539957;

/**
 * Score a single waypoint's weather conditions for sailing
 *
 * @param {Object} params
 * @param {number|null} params.windSpeedKmh - Wind speed in km/h (Open-Meteo native unit)
 * @param {number|null} params.waveHeight - Combined wave height in meters
 * @param {number|null} params.swellHeight - Swell wave height in meters
 * @param {number|null} params.windWaveHeight - Wind wave height in meters
 * @param {number|null} params.wavePeriod - Wave period in seconds
 * @param {number|null} params.swellDirection - Swell wave direction in degrees (direction waves come FROM)
 * @param {number|null} params.currentSpeed - Ocean current speed in m/s (or null)
 * @param {number|null} params.currentDirection - Ocean current direction in degrees (or null)
 * @param {number|null} params.sailingBearing - Bearing from this waypoint to next in degrees (0-360)
 * @returns {Object} Score breakdown
 */
export function scoreWaypoint({
  windSpeedKmh,
  waveHeight,
  swellHeight,
  windWaveHeight,
  wavePeriod,
  swellDirection,
  currentSpeed,
  currentDirection,
  sailingBearing,
}) {
  // Convert wind to knots
  const windKts = windSpeedKmh != null ? windSpeedKmh * KMH_TO_KNOTS : null;

  // Calculate combined wave height from swell + wind waves (same as frontend calcWave)
  let calcWave = null;
  if (swellHeight != null && windWaveHeight != null) {
    calcWave = Math.sqrt(swellHeight * swellHeight + windWaveHeight * windWaveHeight);
  }

  // Current direction relative to sailing direction
  let currentRelation = 'None';
  if (sailingBearing != null && currentDirection != null) {
    let currentAngle = Math.abs(sailingBearing - currentDirection);
    if (currentAngle > 180) currentAngle = 360 - currentAngle;
    if (currentAngle <= 60) currentRelation = 'Following';
    else if (currentAngle >= 120) currentRelation = 'Opposing';
    else currentRelation = 'None';
  }

  // Sea direction relative to sailing direction
  // Swell direction is where waves come FROM; travel direction is +180
  let seaRelation = 'neutral';
  if (sailingBearing != null && swellDirection != null) {
    const swellTravelDir = (swellDirection + 180) % 360;
    let seaAngle = Math.abs(sailingBearing - swellTravelDir);
    if (seaAngle > 180) seaAngle = 360 - seaAngle;
    if (seaAngle <= 30) seaRelation = 'Reaching';
    else if (seaAngle <= 60) seaRelation = 'Broad Reach';
    else if (seaAngle <= 120) seaRelation = 'Beam';
    else if (seaAngle <= 150) seaRelation = 'Close Hauled';
    else seaRelation = 'Opposing';
  }

  // === Wind (35 pts) — linear: ≤15kt=35, 15-25kt linear→0, ≥25kt=0 ===
  let windScore = 35;
  if (windKts != null) {
    if (windKts <= 15) windScore = 35;
    else if (windKts >= 25) windScore = 0;
    else windScore = 35 * (1 - (windKts - 15) / 10);
  }

  // === Wave+Period (35 pts) — effective wave adjusts height by period ===
  // Neutral period = 7s. Short period = steeper (worse), long period = gentler (better).
  let waveScore = 35;
  const waveToUse = calcWave != null ? calcWave : waveHeight;
  let effectiveWave = waveToUse;
  if (waveToUse != null && wavePeriod != null && wavePeriod > 0) {
    effectiveWave = waveToUse * Math.sqrt(7 / wavePeriod);
  }
  if (effectiveWave != null) {
    if (effectiveWave <= 1.5) waveScore = 35;
    else if (effectiveWave >= 2.5) waveScore = 0;
    else waveScore = 35 * (1 - (effectiveWave - 1.5) / 1.0);
  }

  // === Sea direction (15 pts) ===
  let seaDirScore = 10; // neutral default
  if (seaRelation === 'Reaching') seaDirScore = 15;
  else if (seaRelation === 'Broad Reach') seaDirScore = 13;
  else if (seaRelation === 'Beam') seaDirScore = 10;
  else if (seaRelation === 'Close Hauled') seaDirScore = 7;
  else if (seaRelation === 'Opposing') seaDirScore = 5;

  // === Current (15 pts) ===
  let currentScore = 8; // neutral default
  if (currentRelation === 'Following') currentScore = 15;
  else if (currentRelation === 'None') currentScore = 8;
  else if (currentRelation === 'Opposing') currentScore = 0;

  const score = windScore + waveScore + seaDirScore + currentScore;

  return {
    score: Math.round(score * 10) / 10,
    windScore: Math.round(windScore * 10) / 10,
    waveScore: Math.round(waveScore * 10) / 10,
    seaDirScore,
    currentScore,
    wind_kts: windKts != null ? Math.round(windKts * 10) / 10 : null,
    wave_m: waveHeight != null ? Math.round(waveHeight * 100) / 100 : null,
    effective_wave_m: effectiveWave != null ? Math.round(effectiveWave * 100) / 100 : null,
    period_s: wavePeriod != null ? Math.round(wavePeriod * 10) / 10 : null,
    seaRelation,
    currentRelation,
    currentSpeed: currentSpeed != null ? Math.round(currentSpeed * 1.94384 * 100) / 100 : null, // m/s to knots
  };
}

/**
 * Calculate overall journey score from waypoint scores
 * Formula: 0.6 × weightedAvg + 0.4 × worstWaypointScore
 *
 * @param {Array<{score: number}>} waypointScores - Array of scored waypoints
 * @returns {number} Overall score 0-100
 */
export function calculateOverallScore(waypointScores) {
  if (!waypointScores || waypointScores.length === 0) return 0;

  const scores = waypointScores.map(ws => ws.score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const worst = Math.min(...scores);

  const overall = 0.6 * avg + 0.4 * worst;
  return Math.round(overall * 10) / 10;
}

/**
 * Look up weather values at a specific time from Open-Meteo hourly arrays
 * Finds the closest hourly slot to the target time
 *
 * @param {Object} forecastData - Raw Open-Meteo forecast API response
 * @param {Object} marineData - Raw Open-Meteo marine API response
 * @param {Date|string} targetTime - The time to look up
 * @returns {Object} Weather values at that time
 */
export function getWeatherAtTime(forecastData, marineData, targetTime) {
  const target = new Date(targetTime);

  // Find closest hourly index in forecast data
  const forecastIdx = findClosestTimeIndex(forecastData?.hourly?.time, target);
  const marineIdx = findClosestTimeIndex(marineData?.hourly?.time, target);

  const fh = forecastData?.hourly || {};
  const mh = marineData?.hourly || {};

  return {
    windSpeedKmh: forecastIdx >= 0 ? (fh.wind_speed_10m?.[forecastIdx] ?? null) : null,
    windDirection: forecastIdx >= 0 ? (fh.wind_direction_10m?.[forecastIdx] ?? null) : null,
    windGusts: forecastIdx >= 0 ? (fh.wind_gusts_10m?.[forecastIdx] ?? null) : null,
    waveHeight: marineIdx >= 0 ? (mh.wave_height?.[marineIdx] ?? null) : null,
    swellHeight: marineIdx >= 0 ? (mh.swell_wave_height?.[marineIdx] ?? null) : null,
    windWaveHeight: marineIdx >= 0 ? (mh.wind_wave_height?.[marineIdx] ?? null) : null,
    wavePeriod: marineIdx >= 0 ? (mh.wave_period?.[marineIdx] ?? null) : null,
    swellDirection: marineIdx >= 0 ? (mh.swell_wave_direction?.[marineIdx] ?? null) : null,
    currentSpeed: marineIdx >= 0 ? (mh.ocean_current_velocity?.[marineIdx] ?? null) : null,
    currentDirection: marineIdx >= 0 ? (mh.ocean_current_direction?.[marineIdx] ?? null) : null,
  };
}

/**
 * Find the index of the closest time entry in an hourly time array
 * @param {string[]} timeArray - ISO time strings from Open-Meteo
 * @param {Date} target - Target time
 * @returns {number} Index, or -1 if not found
 */
function findClosestTimeIndex(timeArray, target) {
  if (!timeArray || timeArray.length === 0) return -1;

  const targetMs = target.getTime();
  let bestIdx = 0;
  let bestDiff = Math.abs(new Date(timeArray[0]).getTime() - targetMs);

  for (let i = 1; i < timeArray.length; i++) {
    const diff = Math.abs(new Date(timeArray[i]).getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    } else {
      // Times are sorted — once diff starts increasing, we've passed the closest
      break;
    }
  }

  return bestIdx;
}
