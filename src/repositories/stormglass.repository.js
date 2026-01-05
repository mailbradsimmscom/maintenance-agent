/**
 * Stormglass Repository
 * API calls to Stormglass.io (10 requests/day free tier)
 */

import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('stormglass-repository');

const API_BASE = 'https://api.stormglass.io/v2/weather/point';

// All parameters we want to fetch
const PARAMS = [
  // Wave
  'waveHeight', 'waveDirection', 'wavePeriod',
  'swellHeight', 'swellDirection', 'swellPeriod',
  'secondarySwellHeight', 'secondarySwellDirection', 'secondarySwellPeriod',
  'windWaveHeight', 'windWaveDirection', 'windWavePeriod',
  // Currents
  'currentSpeed', 'currentDirection',
  // Water
  'waterTemperature', 'seaLevel',
  // Wind
  'windSpeed', 'windDirection', 'gust',
  // Atmosphere
  'airTemperature', 'pressure', 'humidity', 'cloudCover', 'precipitation', 'visibility'
];

// Sources we import (skip duplicates like ecmwf:aifs)
const SOURCES_TO_IMPORT = ['sg', 'noaa', 'ecmwf', 'meteo', 'meto'];

// Field mappings from Stormglass to our DB columns
const FIELD_MAP = {
  waveHeight: 'wave_height',
  waveDirection: 'wave_direction',
  wavePeriod: 'wave_period',
  swellHeight: 'swell_wave_height',
  swellDirection: 'swell_wave_direction',
  swellPeriod: 'swell_wave_period',
  secondarySwellHeight: 'secondary_swell_height',
  secondarySwellDirection: 'secondary_swell_direction',
  secondarySwellPeriod: 'secondary_swell_period',
  windWaveHeight: 'wind_wave_height',
  windWaveDirection: 'wind_wave_direction',
  windWavePeriod: 'wind_wave_period',
  currentSpeed: 'current_speed',
  currentDirection: 'current_direction',
  waterTemperature: 'sea_surface_temperature',
  seaLevel: 'sea_level',
  airTemperature: 'temperature_2m',
  pressure: 'pressure_msl',
  humidity: 'relative_humidity_2m',
  cloudCover: 'cloud_cover',
  precipitation: 'precipitation',
  visibility: 'visibility',
  windSpeed: 'wind_speed_10m',
  windDirection: 'wind_direction_10m',
  gust: 'wind_gusts_10m',
};

export const stormglassRepository = {
  /**
   * Fetch weather data from Stormglass API
   * @param {number} latitude
   * @param {number} longitude
   * @returns {Promise<Object>} API response with hours array
   */
  async fetchData(latitude, longitude) {
    const config = getConfig();
    const apiKey = config.stormglass?.apiKey;

    if (!apiKey) {
      throw new Error('STORMGLASS_API_KEY not configured');
    }

    const params = PARAMS.join(',');
    const url = `${API_BASE}?lat=${latitude}&lng=${longitude}&params=${params}`;

    logger.info('Fetching from Stormglass API', { latitude, longitude, paramCount: PARAMS.length });

    const response = await fetch(url, {
      headers: {
        'Authorization': apiKey
      }
    });

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 402) {
        logger.error('Stormglass quota exceeded', { status: 402 });
        throw new Error('Stormglass daily quota exceeded (10 requests/day)');
      }

      logger.error('Stormglass API error', { status: response.status, error: errorText });
      throw new Error(`Stormglass API error: ${response.status}`);
    }

    const data = await response.json();

    // Get quota info from headers
    const quotaRemaining = response.headers.get('x-ratelimit-remaining');
    const quotaLimit = response.headers.get('x-ratelimit-limit');

    logger.info('Stormglass fetch complete', {
      latitude,
      longitude,
      hoursReceived: data.hours?.length || 0,
      quotaRemaining,
      quotaLimit
    });

    return {
      data,
      quota: {
        remaining: quotaRemaining ? parseInt(quotaRemaining, 10) : null,
        limit: quotaLimit ? parseInt(quotaLimit, 10) : null
      }
    };
  },

  /**
   * Transform Stormglass response to individual records per source
   * @param {Object} apiResponse - Raw API response with hours array
   * @param {string} areaId - Weather area UUID
   * @returns {Array} Array of forecast records for database
   */
  transformResponse(apiResponse, areaId) {
    const { hours } = apiResponse;
    if (!hours || hours.length === 0) {
      logger.warn('Invalid Stormglass response structure', { areaId });
      return [];
    }

    const forecasts = [];
    const now = new Date().toISOString();

    for (const hour of hours) {
      const forecastTime = hour.time;

      // Create one record per source
      for (const source of SOURCES_TO_IMPORT) {
        const record = {
          area_id: areaId,
          forecast_time: forecastTime,
          fetched_at: now,
          data_source: 'stormglass',
          model_name: source,
        };

        // Map each field if this source has data for it
        let hasData = false;
        for (const [sgField, dbField] of Object.entries(FIELD_MAP)) {
          const fieldData = hour[sgField];
          if (fieldData && fieldData[source] !== undefined) {
            record[dbField] = fieldData[source];
            hasData = true;
          }
        }

        // Only add record if it has at least some data
        if (hasData) {
          forecasts.push(record);
        }
      }
    }

    logger.info('Transformed Stormglass response', {
      areaId,
      hours: hours.length,
      sources: SOURCES_TO_IMPORT.length,
      recordCount: forecasts.length
    });

    return forecasts;
  }
};

export default stormglassRepository;
