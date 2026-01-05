/**
 * Weather Fetch Service
 * Orchestrates fetching forecast data from all APIs
 */

import { weatherRepository } from '../repositories/weather.repository.js';
import { openMeteoRepository } from '../repositories/open-meteo.repository.js';
import { meteoblueRepository } from '../repositories/meteoblue.repository.js';
import { stormglassRepository } from '../repositories/stormglass.repository.js';
import { weatherCreditsService } from './weather-credits.service.js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('weather-fetch-service');

const MODELS = ['gfs_seamless', 'icon_global'];

export const weatherFetchService = {
  /**
   * Fetch forecasts for a single area from all sources
   * @param {string} areaId - UUID
   * @param {Object} options - Optional filtering
   * @param {Array<string>} options.sources - Sources to fetch: 'openmeteo', 'meteoblue', or both
   * @returns {Promise<Object>} Fetch results from each source
   */
  async fetchForArea(areaId, options = {}) {
    const { sources = ['openmeteo', 'meteoblue', 'stormglass'] } = options;
    const fetchOpenMeteo = sources.includes('openmeteo');
    const fetchMeteoblue = sources.includes('meteoblue');
    const fetchStormglass = sources.includes('stormglass');
    const area = await weatherRepository.getAreaById(areaId);
    if (!area) {
      throw new Error(`Area not found: ${areaId}`);
    }

    const results = {
      openMeteoForecast: null,
      openMeteoMarine: null,
      meteoblue: null,
      stormglass: null
    };
    const startTime = Date.now();

    // 1. Open-Meteo Forecast (free)
    if (fetchOpenMeteo) {
      try {
        const forecastData = await openMeteoRepository.fetchForecastData(
          area.latitude,
          area.longitude,
          MODELS
        );
        const forecasts = openMeteoRepository.transformForecastResponse(forecastData, areaId, MODELS);
        const stored = await weatherRepository.storeForecasts(forecasts);
        results.openMeteoForecast = { success: true, count: stored.count };

        await this.logFetch(areaId, 'open_meteo_forecast', 'success', forecasts.length, stored.count);
      } catch (error) {
        logger.error('Open-Meteo Forecast fetch failed', { areaId, error: error.message });
        results.openMeteoForecast = { success: false, error: error.message };
        await this.logFetch(areaId, 'open_meteo_forecast', 'failed', 0, 0, error.message);
      }

      // Small delay between API calls (be polite)
      await this.delay(300);

      // 2. Open-Meteo Marine (free)
      try {
        const marineData = await openMeteoRepository.fetchMarineData(area.latitude, area.longitude);
        const forecasts = openMeteoRepository.transformMarineResponse(marineData, areaId);
        const stored = await weatherRepository.storeForecasts(forecasts);
        results.openMeteoMarine = { success: true, count: stored.count };

        await this.logFetch(areaId, 'open_meteo_marine', 'success', forecasts.length, stored.count);
      } catch (error) {
        logger.error('Open-Meteo Marine fetch failed', { areaId, error: error.message });
        results.openMeteoMarine = { success: false, error: error.message };
        await this.logFetch(areaId, 'open_meteo_marine', 'failed', 0, 0, error.message);
      }
    }

    // 3. Meteoblue (if enabled, requested, and credits available)
    if (!fetchMeteoblue) {
      results.meteoblue = { success: false, error: 'Not requested', skipped: true };
    } else {
      const config = getConfig();
      if (config.meteoblue.enabled) {
        const canFetch = await weatherCreditsService.canFetch('meteoblue');

        if (canFetch) {
          await this.delay(300);

          try {
            const seaData = await meteoblueRepository.fetchSeaData(area.latitude, area.longitude);
            const forecasts = meteoblueRepository.transformResponse(seaData, areaId);
            const stored = await weatherRepository.storeForecasts(forecasts);

            await weatherCreditsService.recordUsage('meteoblue', 1);
            const credits = await weatherCreditsService.getStatus('meteoblue');

            results.meteoblue = {
              success: true,
              count: stored.count,
              creditsRemaining: credits?.credits_remaining
            };

            await this.logFetch(
              areaId, 'meteoblue', 'success',
              forecasts.length, stored.count, null, 1, credits?.credits_remaining
            );
          } catch (error) {
            logger.error('Meteoblue fetch failed', { areaId, error: error.message });
            results.meteoblue = { success: false, error: error.message };
            await this.logFetch(areaId, 'meteoblue', 'failed', 0, 0, error.message);
          }
        } else {
          logger.info('Skipping Meteoblue fetch - no credits remaining', { areaId });
          results.meteoblue = { success: false, error: 'No credits remaining', skipped: true };
          await this.logFetch(areaId, 'meteoblue', 'skipped', 0, 0, 'No credits remaining');
        }
      } else {
        logger.debug('Meteoblue disabled', { areaId });
        results.meteoblue = { success: false, error: 'Meteoblue disabled', skipped: true };
      }
    }

    // 4. Stormglass (if requested and API key configured)
    if (!fetchStormglass) {
      results.stormglass = { success: false, error: 'Not requested', skipped: true };
    } else {
      const config = getConfig();
      if (config.stormglass?.apiKey) {
        await this.delay(300);

        try {
          const { data, quota } = await stormglassRepository.fetchData(area.latitude, area.longitude);
          const forecasts = stormglassRepository.transformResponse(data, areaId);
          const stored = await weatherRepository.storeForecasts(forecasts);

          results.stormglass = {
            success: true,
            count: stored.count,
            quotaRemaining: quota.remaining
          };

          await this.logFetch(areaId, 'stormglass', 'success', forecasts.length, stored.count);
          logger.info('Stormglass fetch complete', {
            areaId,
            records: stored.count,
            quotaRemaining: quota.remaining
          });
        } catch (error) {
          logger.error('Stormglass fetch failed', { areaId, error: error.message });
          results.stormglass = { success: false, error: error.message };
          await this.logFetch(areaId, 'stormglass', 'failed', 0, 0, error.message);
        }
      } else {
        logger.debug('Stormglass not configured (no API key)', { areaId });
        results.stormglass = { success: false, error: 'Stormglass not configured', skipped: true };
      }
    }

    const duration = Date.now() - startTime;
    logger.info('Fetch complete for area', { areaId, name: area.name, duration, results });

    return results;
  },

  /**
   * Fetch forecasts for all active areas
   * @returns {Promise<Array>} Results for each area
   */
  async fetchAllAreas() {
    const areas = await weatherRepository.getAllAreas();
    logger.info('Starting fetch for all areas', { count: areas.length });

    const results = [];

    for (const area of areas) {
      try {
        const result = await this.fetchForArea(area.id);
        results.push({ areaId: area.id, name: area.name, ...result });
      } catch (error) {
        logger.error('Failed to fetch for area', { areaId: area.id, error: error.message });
        results.push({ areaId: area.id, name: area.name, error: error.message });
      }

      // Delay between areas
      await this.delay(500);
    }

    logger.info('Fetch complete for all areas', {
      total: areas.length,
      successful: results.filter(r => !r.error).length
    });

    return results;
  },

  /**
   * Log a fetch operation
   */
  async logFetch(areaId, dataSource, status, fetched, stored, error = null, credits = 0, creditsRemaining = null) {
    try {
      await weatherRepository.logFetch({
        area_id: areaId,
        data_source: dataSource,
        status,
        records_fetched: fetched,
        records_stored: stored,
        error_message: error,
        credits_used: credits,
        credits_remaining: creditsRemaining
      });
    } catch (logError) {
      logger.error('Failed to log fetch operation', { error: logError.message });
    }
  },

  /**
   * Utility delay function
   * @param {number} ms - Milliseconds to delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

export default weatherFetchService;
