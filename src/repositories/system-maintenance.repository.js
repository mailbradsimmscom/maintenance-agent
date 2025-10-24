/**
 * System Maintenance Repository
 * Database operations for system_maintenance and system_hours_history tables
 */

import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('system-maintenance-repository');

// Initialize Supabase client
const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey
);

export const systemMaintenanceRepository = {
  /**
   * Get current maintenance state for a system
   * @param {string} assetUid - The system's asset UID
   * @returns {Promise<Object|null>} System maintenance record or null if not found
   */
  async getMaintenanceState(assetUid) {
    const { data, error } = await supabase
      .from('system_maintenance')
      .select('*')
      .eq('asset_uid', assetUid)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to fetch maintenance state', { assetUid, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get all systems with maintenance tracking
   * @param {number} limit - Number of systems to fetch
   * @returns {Promise<Array>} System maintenance records
   */
  async getAllMaintenanceStates(limit = 100) {
    const { data, error } = await supabase
      .from('system_maintenance')
      .select('*')
      .order('last_hours_update', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch all maintenance states', { error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Create or update system maintenance state
   * @param {string} assetUid - The system's asset UID
   * @param {number} currentHours - Current operating hours
   * @param {Date} installationDate - Installation date (optional)
   * @returns {Promise<Object>} Updated maintenance record
   */
  async upsertMaintenanceState(assetUid, currentHours, installationDate = null) {
    const updateData = {
      asset_uid: assetUid,
      current_operating_hours: currentHours,
      last_hours_update: new Date().toISOString(),
    };

    // Only set installation_date if provided
    if (installationDate) {
      updateData.installation_date = installationDate;
    }

    const { data, error } = await supabase
      .from('system_maintenance')
      .upsert(updateData)
      .select()
      .single();

    if (error) {
      logger.error('Failed to upsert maintenance state', { assetUid, currentHours, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Update current operating hours
   * @param {string} assetUid - The system's asset UID
   * @param {number} hours - New operating hours
   * @returns {Promise<Object>} Updated maintenance record
   */
  async updateOperatingHours(assetUid, hours) {
    const { data, error } = await supabase
      .from('system_maintenance')
      .update({
        current_operating_hours: hours,
        last_hours_update: new Date().toISOString(),
      })
      .eq('asset_uid', assetUid)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update operating hours', { assetUid, hours, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get systems with stale hours (not updated recently)
   * @param {number} staleDays - Number of days to consider stale
   * @returns {Promise<Array>} Systems with stale hours
   */
  async getStaleHours(staleDays = 30) {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - staleDays);

    const { data, error } = await supabase
      .from('system_maintenance')
      .select('*')
      .lt('last_hours_update', staleDate.toISOString());

    if (error) {
      logger.error('Failed to fetch stale hours', { staleDays, error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Delete maintenance state for a system
   * @param {string} assetUid - The system's asset UID
   * @returns {Promise<void>}
   */
  async deleteMaintenanceState(assetUid) {
    const { error } = await supabase
      .from('system_maintenance')
      .delete()
      .eq('asset_uid', assetUid);

    if (error) {
      logger.error('Failed to delete maintenance state', { assetUid, error: error.message });
      throw error;
    }
  },
};

export const hoursHistoryRepository = {
  /**
   * Record a new hours entry in history
   * @param {Object} entry - Hours entry data
   * @param {string} entry.assetUid - System asset UID
   * @param {number} entry.hours - Operating hours
   * @param {string} entry.submittedBy - Who submitted (default: 'user')
   * @param {string} entry.notes - Optional notes
   * @param {boolean} entry.meterReplaced - If meter was replaced
   * @returns {Promise<Object>} Created history entry
   */
  async recordHoursEntry({ assetUid, hours, submittedBy = 'user', notes = null, meterReplaced = false }) {
    const { data, error } = await supabase
      .from('system_hours_history')
      .insert({
        asset_uid: assetUid,
        hours,
        submitted_by: submittedBy,
        notes,
        meter_replaced: meterReplaced,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to record hours entry', { assetUid, hours, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get latest hours entry for a system
   * @param {string} assetUid - The system's asset UID
   * @returns {Promise<Object|null>} Latest hours entry or null
   */
  async getLatestEntry(assetUid) {
    const { data, error } = await supabase
      .from('system_hours_history')
      .select('*')
      .eq('asset_uid', assetUid)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to fetch latest hours entry', { assetUid, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get hours history for a system
   * @param {string} assetUid - The system's asset UID
   * @param {number} limit - Number of entries to fetch
   * @returns {Promise<Array>} Hours history entries
   */
  async getHistory(assetUid, limit = 50) {
    const { data, error } = await supabase
      .from('system_hours_history')
      .select('*')
      .eq('asset_uid', assetUid)
      .order('submitted_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch hours history', { assetUid, error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Get all history entries within a date range
   * @param {string} assetUid - The system's asset UID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Hours history entries in range
   */
  async getHistoryInRange(assetUid, startDate, endDate) {
    const { data, error } = await supabase
      .from('system_hours_history')
      .select('*')
      .eq('asset_uid', assetUid)
      .gte('submitted_at', startDate.toISOString())
      .lte('submitted_at', endDate.toISOString())
      .order('submitted_at', { ascending: true });

    if (error) {
      logger.error('Failed to fetch hours history in range', { assetUid, startDate, endDate, error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Get entries where meter was replaced
   * @param {string} assetUid - The system's asset UID
   * @returns {Promise<Array>} Meter replacement entries
   */
  async getMeterReplacements(assetUid) {
    const { data, error } = await supabase
      .from('system_hours_history')
      .select('*')
      .eq('asset_uid', assetUid)
      .eq('meter_replaced', true)
      .order('submitted_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch meter replacements', { assetUid, error: error.message });
      throw error;
    }

    return data || [];
  },
};

// Export default object with both repositories
export default {
  maintenance: systemMaintenanceRepository,
  history: hoursHistoryRepository,
};
