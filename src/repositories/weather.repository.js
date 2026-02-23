/**
 * Weather Repository
 * Database operations for weather areas, forecasts, and credits
 */

import supabaseRepo from './supabase.repository.js';
import { createLogger } from '../utils/logger.js';

const supabase = supabaseRepo.client;
const logger = createLogger('weather-repository');

export const weatherRepository = {
  // ========== AREAS ==========
  async createArea({ name, latitude, longitude, description, sailing_direction }) {
    const { data, error } = await supabase
      .from('weather_areas')
      .insert({ name, latitude, longitude, description, sailing_direction })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create weather area', { name, error: error.message });
      throw error;
    }

    logger.info('Weather area created', { id: data.id, name });
    return data;
  },

  async getAllAreas() {
    const { data, error } = await supabase
      .from('weather_areas')
      .select('*')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('name');

    if (error) {
      logger.error('Failed to fetch weather areas', { error: error.message });
      throw error;
    }

    return data || [];
  },

  async getAreaById(id) {
    const { data, error } = await supabase
      .from('weather_areas')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      logger.error('Failed to fetch weather area', { id, error: error.message });
      throw error;
    }

    return data;
  },

  async updateArea(id, updates) {
    const { data, error } = await supabase
      .from('weather_areas')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update weather area', { id, error: error.message });
      throw error;
    }

    logger.info('Weather area updated', { id });
    return data;
  },

  async deleteArea(id) {
    const { error } = await supabase
      .from('weather_areas')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id);

    if (error) {
      logger.error('Failed to delete weather area', { id, error: error.message });
      throw error;
    }

    logger.info('Weather area deleted', { id });
  },

  // ========== FORECASTS ==========
  async storeForecasts(forecasts) {
    if (!forecasts.length) return { count: 0 };

    const { data, error } = await supabase
      .from('weather_forecasts')
      .upsert(forecasts, {
        onConflict: 'area_id,forecast_time,data_source,model_name',
        ignoreDuplicates: false
      })
      .select();

    if (error) {
      logger.error('Failed to store forecasts', { count: forecasts.length, error: error.message });
      throw error;
    }

    return { count: data?.length || 0 };
  },

  async getLatestForecast(areaId, { dataSource, modelName } = {}) {
    let query = supabase
      .from('weather_forecasts')
      .select('*')
      .eq('area_id', areaId)
      .order('forecast_time', { ascending: false })
      .limit(1);

    if (dataSource) query = query.eq('data_source', dataSource);
    if (modelName) query = query.eq('model_name', modelName);

    const { data, error } = await query.single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to get latest forecast', { areaId, error: error.message });
      throw error;
    }

    return data;
  },

  async getForecastsByArea(areaId, { hours = 240 } = {}) { // 10 days default
    // Get forecasts from now onwards (into the future), limited to 'hours' worth
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

    // Supabase has a 1000 row max limit, so we paginate
    const PAGE_SIZE = 1000;
    let allData = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await supabase
        .from('weather_forecasts')
        .select('*')
        .eq('area_id', areaId)
        .gte('forecast_time', todayStart)
        .lte('forecast_time', until)
        .order('forecast_time', { ascending: true })
        .range(from, to);

      if (error) {
        logger.error('Failed to get forecasts by area', { areaId, error: error.message });
        throw error;
      }

      allData = allData.concat(data || []);
      hasMore = data?.length === PAGE_SIZE;
      page++;

      // Safety limit: max 5 pages (5000 records)
      if (page >= 5) break;
    }

    return allData;
  },

  async getLastFetchTime(areaId) {
    const { data, error } = await supabase
      .from('weather_fetch_logs')
      .select('created_at')
      .eq('area_id', areaId)
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to get last fetch time', { areaId, error: error.message });
      throw error;
    }

    return data?.created_at;
  },

  // ========== FETCH LOGS ==========
  async logFetch(logData) {
    const { data, error } = await supabase
      .from('weather_fetch_logs')
      .insert(logData)
      .select()
      .single();

    if (error) {
      logger.error('Failed to log fetch', { error: error.message });
      throw error;
    }

    return data;
  },

  // ========== CREDITS ==========
  async getCredits(apiName) {
    const { data, error } = await supabase
      .from('weather_api_credits')
      .select('*')
      .eq('api_name', apiName)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to get credits', { apiName, error: error.message });
      throw error;
    }

    return data;
  },

  async updateCredits(apiName, creditsUsed) {
    const current = await this.getCredits(apiName);
    if (!current) {
      logger.warn('No credit record found', { apiName });
      return;
    }

    const { error } = await supabase
      .from('weather_api_credits')
      .update({
        credits_used: (current.credits_used || 0) + creditsUsed,
        credits_remaining: (current.credits_remaining || 0) - creditsUsed,
        last_request_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('api_name', apiName);

    if (error) {
      logger.error('Failed to update credits', { apiName, error: error.message });
      throw error;
    }

    logger.info('Credits updated', { apiName, creditsUsed });
  }
};

export default weatherRepository;
