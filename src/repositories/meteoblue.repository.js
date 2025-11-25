/**
 * Meteoblue Repository
 * API calls to Meteoblue Sea-3h package (CREDITS-BASED)
 */

import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('meteoblue-repository');

const METEOBLUE_BASE = 'https://my.meteoblue.com/packages/sea-3h';

export const meteoblueRepository = {
  /**
   * Fetch marine data from Meteoblue Sea-3h package
   * @param {number} latitude
   * @param {number} longitude
   * @returns {Promise<Object>} API response with premium marine data
   */
  async fetchSeaData(latitude, longitude) {
    const config = getConfig();
    const apiKey = config.meteoblue?.apiKey;

    if (!apiKey) {
      throw new Error('METEOBLUE_API_KEY not configured');
    }

    const params = new URLSearchParams({
      apikey: apiKey,
      lat: latitude.toString(),
      lon: longitude.toString(),
      asl: '9',
      format: 'json',
      forecast_days: '7'
    });

    const url = `${METEOBLUE_BASE}?${params}`;
    logger.info('Fetching Meteoblue sea data', { latitude, longitude });

    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Meteoblue API error', { status: response.status, error: errorText });
      throw new Error(`Meteoblue API error: ${response.status}`);
    }

    const data = await response.json();
    logger.info('Meteoblue sea data fetched', {
      latitude,
      longitude,
      dataPoints: data.data_3h?.time?.length || 0
    });

    return data;
  },

  /**
   * Transform Meteoblue response to database records
   * @param {Object} apiResponse - Raw API response
   * @param {string} areaId - Weather area UUID
   * @returns {Array} Array of forecast records for database
   */
  transformResponse(apiResponse, areaId) {
    const { data_3h } = apiResponse;
    if (!data_3h || !data_3h.time) {
      logger.warn('Invalid Meteoblue response structure', { areaId });
      return [];
    }

    const forecasts = [];
    const now = new Date().toISOString();

    for (let i = 0; i < data_3h.time.length; i++) {
      // Parse the Meteoblue time format (YYYY-MM-DD HH:MM)
      const timeStr = data_3h.time[i];
      const forecastTime = new Date(timeStr.replace(' ', 'T') + ':00Z').toISOString();

      forecasts.push({
        area_id: areaId,
        forecast_time: forecastTime,
        fetched_at: now,
        data_source: 'meteoblue',
        model_name: 'meteoblue_nems',

        // Meteoblue exclusive fields (note: API uses camelCase without underscores)
        douglas_sea_state: data_3h.douglas_seastate?.[i],
        salinity: data_3h.salinity?.[i],
        current_velocity_u: data_3h.currentvelocity_u?.[i],
        current_velocity_v: data_3h.currentvelocity_v?.[i],
        wave_steepness: data_3h.wavesteepness?.[i],
        significant_wave_height: data_3h.significantwaveheight?.[i],

        // Wave fields
        wave_height: data_3h.surfwave_height?.[i],
        wave_direction: data_3h.mean_wavedirection?.[i],
        wave_period: data_3h.mean_waveperiod?.[i],

        // Swell fields
        swell_wave_height: data_3h.swell_significantheight?.[i],
        swell_wave_direction: data_3h.swell_meandirection?.[i],
        swell_wave_period: data_3h.swell_meanperiod?.[i],
        swell_wave_peak_period: data_3h.swell_peakwaveperiod?.[i],

        // Wind wave fields
        wind_wave_height: data_3h.windwave_height?.[i],
        wind_wave_direction: data_3h.windwave_direction?.[i],
        wind_wave_period: data_3h.windwave_meanperiod?.[i],
        wind_wave_peak_period: data_3h.windwave_peakwaveperiod?.[i],

        // Sea temperature
        sea_surface_temperature: data_3h.seasurfacetemperature?.[i],
      });
    }

    logger.info('Transformed Meteoblue response', { areaId, recordCount: forecasts.length });
    return forecasts;
  }
};

export default meteoblueRepository;
