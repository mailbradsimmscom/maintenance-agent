/**
 * Weather Forecast Service
 * Business logic for querying and comparing forecast data
 */

import { weatherRepository } from '../repositories/weather.repository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('weather-forecast-service');

export const weatherForecastService = {
  /**
   * Get forecasts for an area
   * @param {string} areaId - UUID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Forecast records
   */
  async getForecastsForArea(areaId, options = {}) {
    return weatherRepository.getForecastsByArea(areaId, options);
  },

  /**
   * Get the latest forecast for an area
   * @param {string} areaId - UUID
   * @param {Object} options - { dataSource?, modelName? }
   * @returns {Promise<Object|null>} Latest forecast or null
   */
  async getLatestForecast(areaId, options = {}) {
    return weatherRepository.getLatestForecast(areaId, options);
  },

  /**
   * Get model comparison for an area
   * Compares GFS, ICON, and other models side by side
   * @param {string} areaId - UUID
   * @returns {Promise<Array>} Comparison data grouped by time
   */
  async getModelComparison(areaId) {
    // Get last 48 hours of forecasts
    const forecasts = await weatherRepository.getForecastsByArea(areaId, { hours: 48 });

    // Group forecasts by forecast_time
    const byTime = {};
    for (const f of forecasts) {
      const time = f.forecast_time;
      if (!byTime[time]) {
        byTime[time] = {};
      }

      // Use data_source + model_name as key
      const key = f.data_source === 'open_meteo_forecast' ? f.model_name : f.data_source;
      byTime[time][key] = f;
    }

    // Calculate spread and agreement for each time
    const comparison = Object.entries(byTime).map(([time, models]) => {
      // Get wind speeds from different models
      const gfs = models.gfs_seamless?.wind_speed_10m;
      const icon = models.icon_global?.wind_speed_10m;

      // Calculate spread (difference between highest and lowest)
      const windValues = [gfs, icon].filter(v => v != null);
      const windSpread = windValues.length > 1
        ? Math.max(...windValues) - Math.min(...windValues)
        : 0;

      // Models agree if spread is less than 3 km/h
      const modelsAgree = windSpread < 3;

      return {
        forecast_time: time,
        gfs_seamless: models.gfs_seamless || null,
        icon_global: models.icon_global || null,
        open_meteo_marine: models.open_meteo_marine || null,
        meteoblue: models.meteoblue || null,
        wind_spread: Math.round(windSpread * 10) / 10,
        models_agree: modelsAgree
      };
    });

    // Sort by forecast time
    comparison.sort((a, b) => new Date(a.forecast_time) - new Date(b.forecast_time));

    logger.info('Generated model comparison', { areaId, timePoints: comparison.length });
    return comparison;
  },

  /**
   * Get current conditions (most recent forecast data)
   * @param {string} areaId - UUID
   * @returns {Promise<Object>} Combined current conditions from all sources
   */
  async getCurrentConditions(areaId) {
    const forecasts = await weatherRepository.getForecastsByArea(areaId, { hours: 6 });

    if (forecasts.length === 0) {
      return null;
    }

    // Find the closest forecast time to now
    const now = new Date();
    const closest = forecasts.reduce((prev, curr) => {
      const prevDiff = Math.abs(new Date(prev.forecast_time) - now);
      const currDiff = Math.abs(new Date(curr.forecast_time) - now);
      return currDiff < prevDiff ? curr : prev;
    });

    // Get all forecasts at this time
    const atTime = forecasts.filter(f => f.forecast_time === closest.forecast_time);

    // Merge data from different sources
    const conditions = {
      forecast_time: closest.forecast_time,
      // From Open-Meteo Forecast (use GFS as primary)
      temperature_2m: null,
      wind_speed_10m: null,
      wind_direction_10m: null,
      wind_gusts_10m: null,
      pressure_msl: null,
      cloud_cover: null,
      weather_code: null,
      // From Open-Meteo Marine
      wave_height: null,
      wave_direction: null,
      wave_period: null,
      sea_surface_temperature: null,
      // From Meteoblue
      douglas_sea_state: null,
      salinity: null
    };

    for (const f of atTime) {
      if (f.data_source === 'open_meteo_forecast' && f.model_name === 'gfs_seamless') {
        conditions.temperature_2m = f.temperature_2m;
        conditions.wind_speed_10m = f.wind_speed_10m;
        conditions.wind_direction_10m = f.wind_direction_10m;
        conditions.wind_gusts_10m = f.wind_gusts_10m;
        conditions.pressure_msl = f.pressure_msl;
        conditions.cloud_cover = f.cloud_cover;
        conditions.weather_code = f.weather_code;
      }
      if (f.data_source === 'open_meteo_marine') {
        conditions.wave_height = f.wave_height;
        conditions.wave_direction = f.wave_direction;
        conditions.wave_period = f.wave_period;
        conditions.sea_surface_temperature = f.sea_surface_temperature;
      }
      if (f.data_source === 'meteoblue') {
        conditions.douglas_sea_state = f.douglas_sea_state;
        conditions.salinity = f.salinity;
      }
    }

    return conditions;
  },

  /**
   * Get 7-day forecast summary
   * @param {string} areaId - UUID
   * @returns {Promise<Array>} Daily summary data
   */
  async get7DayForecast(areaId) {
    const forecasts = await weatherRepository.getForecastsByArea(areaId, { hours: 168 });

    // Group by day (using GFS model)
    const gfsForecasts = forecasts.filter(
      f => f.data_source === 'open_meteo_forecast' && f.model_name === 'gfs_seamless'
    );

    const byDay = {};
    for (const f of gfsForecasts) {
      const day = f.forecast_time.split('T')[0];
      if (!byDay[day]) {
        byDay[day] = [];
      }
      byDay[day].push(f);
    }

    // Calculate daily summary
    const dailySummary = Object.entries(byDay).map(([day, dayForecasts]) => {
      const temps = dayForecasts.map(f => f.temperature_2m).filter(t => t != null);
      const winds = dayForecasts.map(f => f.wind_speed_10m).filter(w => w != null);
      const codes = dayForecasts.map(f => f.weather_code).filter(c => c != null);

      return {
        date: day,
        temp_high: temps.length ? Math.max(...temps) : null,
        temp_low: temps.length ? Math.min(...temps) : null,
        wind_avg: winds.length ? Math.round(winds.reduce((a, b) => a + b, 0) / winds.length) : null,
        wind_max: winds.length ? Math.max(...winds) : null,
        weather_code: codes.length ? codes[Math.floor(codes.length / 2)] : null // midday code
      };
    });

    // Sort by date and return first 7 days
    dailySummary.sort((a, b) => a.date.localeCompare(b.date));
    return dailySummary.slice(0, 7);
  }
};

export default weatherForecastService;
