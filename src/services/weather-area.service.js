/**
 * Weather Area Service
 * Business logic for managing weather areas (CRUD)
 */

import { weatherRepository } from '../repositories/weather.repository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('weather-area-service');

export const weatherAreaService = {
  /**
   * Create a new weather area
   * @param {Object} areaData - { name, latitude, longitude, description? }
   * @returns {Promise<Object>} Created area
   */
  async createArea(areaData) {
    const { name, latitude, longitude, description, sailing_direction } = areaData;

    // Validate coordinates
    if (latitude < -90 || latitude > 90) {
      throw new Error('Latitude must be between -90 and 90');
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error('Longitude must be between -180 and 180');
    }
    if (!name || name.trim().length === 0) {
      throw new Error('Name is required');
    }

    const validDirections = [null, undefined, 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    if (sailing_direction && !validDirections.includes(sailing_direction)) {
      throw new Error('Sailing direction must be one of: N, NE, E, SE, S, SW, W, NW');
    }

    logger.info('Creating weather area', { name, latitude, longitude });
    return weatherRepository.createArea({ name, latitude, longitude, description, sailing_direction });
  },

  /**
   * Get all active weather areas
   * @returns {Promise<Array>} List of areas
   */
  async getAllAreas() {
    return weatherRepository.getAllAreas();
  },

  /**
   * Get weather area by ID
   * @param {string} id - UUID
   * @returns {Promise<Object|null>} Area details or null
   */
  async getAreaById(id) {
    return weatherRepository.getAreaById(id);
  },

  /**
   * Update weather area
   * @param {string} id - UUID
   * @param {Object} updates - Partial area data
   * @returns {Promise<Object>} Updated area
   */
  async updateArea(id, updates) {
    // Validate coordinates if provided
    if (updates.latitude !== undefined && (updates.latitude < -90 || updates.latitude > 90)) {
      throw new Error('Latitude must be between -90 and 90');
    }
    if (updates.longitude !== undefined && (updates.longitude < -180 || updates.longitude > 180)) {
      throw new Error('Longitude must be between -180 and 180');
    }

    logger.info('Updating weather area', { id, updates: Object.keys(updates) });
    return weatherRepository.updateArea(id, updates);
  },

  /**
   * Soft delete weather area
   * @param {string} id - UUID
   * @returns {Promise<void>}
   */
  async deleteArea(id) {
    logger.info('Deleting weather area', { id });
    return weatherRepository.deleteArea(id);
  },

  /**
   * Get all areas with their last fetch timestamp
   * @returns {Promise<Array>} Areas with last_fetch field
   */
  async getAreasWithLastFetch() {
    const areas = await weatherRepository.getAllAreas();

    const areasWithFetch = await Promise.all(
      areas.map(async (area) => {
        const lastFetch = await weatherRepository.getLastFetchTime(area.id);
        return { ...area, last_fetch: lastFetch };
      })
    );

    return areasWithFetch;
  }
};

export default weatherAreaService;
