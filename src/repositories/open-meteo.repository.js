/**
 * Open-Meteo Repository
 * API calls to Open-Meteo Forecast and Marine APIs (FREE)
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('open-meteo-repository');

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
const MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine';

export const openMeteoRepository = {
  /**
   * Fetch forecast data with multiple models
   * @param {number} latitude
   * @param {number} longitude
   * @param {string[]} models - e.g. ['gfs_seamless', 'icon_global']
   * @returns {Promise<Object>} API response with model-suffixed fields
   */
  async fetchForecastData(latitude, longitude, models = ['gfs_seamless', 'icon_global']) {
    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      hourly: [
        'temperature_2m',
        'relative_humidity_2m',
        'precipitation',
        'pressure_msl',
        'cloud_cover',
        'weather_code',
        'wind_speed_10m',
        'wind_direction_10m',
        'wind_gusts_10m'
      ].join(','),
      models: models.join(','),
      forecast_days: '7',
      timezone: 'UTC'
    });

    const url = `${FORECAST_BASE}?${params}`;
    logger.info('Fetching Open-Meteo forecast', { latitude, longitude, models });

    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Open-Meteo Forecast API error', { status: response.status, error: errorText });
      throw new Error(`Open-Meteo Forecast API error: ${response.status}`);
    }

    const data = await response.json();
    logger.info('Open-Meteo forecast fetched', {
      latitude,
      longitude,
      hourlyPoints: data.hourly?.time?.length || 0
    });

    return data;
  },

  /**
   * Fetch marine data (waves, swell, SST)
   * @param {number} latitude
   * @param {number} longitude
   * @returns {Promise<Object>} API response with marine data
   */
  async fetchMarineData(latitude, longitude) {
    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      hourly: [
        'wave_height',
        'wave_direction',
        'wave_period',
        'swell_wave_height',
        'swell_wave_direction',
        'swell_wave_period',
        'wind_wave_height',
        'wind_wave_direction',
        'wind_wave_period',
        'sea_surface_temperature'
      ].join(','),
      forecast_days: '7',
      timezone: 'UTC'
    });

    const url = `${MARINE_BASE}?${params}`;
    logger.info('Fetching Open-Meteo marine', { latitude, longitude });

    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Open-Meteo Marine API error', { status: response.status, error: errorText });
      throw new Error(`Open-Meteo Marine API error: ${response.status}`);
    }

    const data = await response.json();
    logger.info('Open-Meteo marine fetched', {
      latitude,
      longitude,
      hourlyPoints: data.hourly?.time?.length || 0
    });

    return data;
  },

  /**
   * Transform multi-model forecast response to individual records
   * @param {Object} apiResponse - Raw API response
   * @param {string} areaId - Weather area UUID
   * @param {string[]} models - Models that were requested
   * @returns {Array} Array of forecast records for database
   */
  transformForecastResponse(apiResponse, areaId, models) {
    const { hourly } = apiResponse;
    if (!hourly || !hourly.time) {
      logger.warn('Invalid forecast response structure', { areaId });
      return [];
    }

    const forecasts = [];
    const now = new Date().toISOString();

    for (const modelName of models) {
      for (let i = 0; i < hourly.time.length; i++) {
        forecasts.push({
          area_id: areaId,
          forecast_time: hourly.time[i],
          fetched_at: now,
          data_source: 'open_meteo_forecast',
          model_name: modelName,
          temperature_2m: hourly[`temperature_2m_${modelName}`]?.[i] ?? hourly.temperature_2m?.[i],
          relative_humidity_2m: hourly[`relative_humidity_2m_${modelName}`]?.[i] ?? hourly.relative_humidity_2m?.[i],
          precipitation: hourly[`precipitation_${modelName}`]?.[i] ?? hourly.precipitation?.[i],
          pressure_msl: hourly[`pressure_msl_${modelName}`]?.[i] ?? hourly.pressure_msl?.[i],
          cloud_cover: hourly[`cloud_cover_${modelName}`]?.[i] ?? hourly.cloud_cover?.[i],
          weather_code: hourly[`weather_code_${modelName}`]?.[i] ?? hourly.weather_code?.[i],
          wind_speed_10m: hourly[`wind_speed_10m_${modelName}`]?.[i] ?? hourly.wind_speed_10m?.[i],
          wind_direction_10m: hourly[`wind_direction_10m_${modelName}`]?.[i] ?? hourly.wind_direction_10m?.[i],
          wind_gusts_10m: hourly[`wind_gusts_10m_${modelName}`]?.[i] ?? hourly.wind_gusts_10m?.[i],
        });
      }
    }

    logger.info('Transformed forecast response', { areaId, models, recordCount: forecasts.length });
    return forecasts;
  },

  /**
   * Transform marine response to individual records
   * @param {Object} apiResponse - Raw API response
   * @param {string} areaId - Weather area UUID
   * @returns {Array} Array of marine forecast records for database
   */
  transformMarineResponse(apiResponse, areaId) {
    const { hourly } = apiResponse;
    if (!hourly || !hourly.time) {
      logger.warn('Invalid marine response structure', { areaId });
      return [];
    }

    const forecasts = [];
    const now = new Date().toISOString();

    for (let i = 0; i < hourly.time.length; i++) {
      forecasts.push({
        area_id: areaId,
        forecast_time: hourly.time[i],
        fetched_at: now,
        data_source: 'open_meteo_marine',
        model_name: 'ecmwf_wam',
        wave_height: hourly.wave_height?.[i],
        wave_direction: hourly.wave_direction?.[i],
        wave_period: hourly.wave_period?.[i],
        swell_wave_height: hourly.swell_wave_height?.[i],
        swell_wave_direction: hourly.swell_wave_direction?.[i],
        swell_wave_period: hourly.swell_wave_period?.[i],
        wind_wave_height: hourly.wind_wave_height?.[i],
        wind_wave_direction: hourly.wind_wave_direction?.[i],
        wind_wave_period: hourly.wind_wave_period?.[i],
        sea_surface_temperature: hourly.sea_surface_temperature?.[i],
      });
    }

    logger.info('Transformed marine response', { areaId, recordCount: forecasts.length });
    return forecasts;
  }
};

export default openMeteoRepository;
