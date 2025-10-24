/**
 * System Maintenance Service
 * Business logic for operating hours tracking and validation
 */

import systemMaintenanceRepo from '../repositories/system-maintenance.repository.js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('system-maintenance-service');

export const systemMaintenanceService = {
  /**
   * Update operating hours for a system with validation
   * @param {Object} params - Update parameters
   * @param {string} params.assetUid - System asset UID
   * @param {number} params.hours - New operating hours
   * @param {string} params.submittedBy - Who submitted (default: 'user')
   * @param {string} params.notes - Optional notes
   * @param {boolean} params.meterReplaced - If meter was replaced
   * @param {Date} params.installationDate - Installation date (optional, auto-set if null)
   * @returns {Promise<Object>} Update result with validation status
   */
  async updateOperatingHours({ assetUid, hours, submittedBy = 'user', notes = null, meterReplaced = false, installationDate = null }) {
    try {
      logger.info('Updating operating hours', { assetUid, hours, meterReplaced });

      // Validate hours is a positive number
      if (typeof hours !== 'number' || hours < 0) {
        throw new Error('Hours must be a positive number');
      }

      // Get latest history entry for validation
      const latestEntry = await systemMaintenanceRepo.history.getLatestEntry(assetUid);

      // Validate hours haven't decreased (unless meter replaced)
      if (latestEntry && hours < latestEntry.hours && !meterReplaced) {
        throw new Error(`Hours cannot decrease. Last recorded: ${latestEntry.hours}. Set meterReplaced=true if meter was replaced.`);
      }

      // Require notes when meter replaced
      if (meterReplaced && !notes) {
        throw new Error('Notes are required when meter is replaced');
      }

      // Record in history first (audit trail)
      const historyEntry = await systemMaintenanceRepo.history.recordHoursEntry({
        assetUid,
        hours,
        submittedBy,
        notes,
        meterReplaced,
      });

      // Get current maintenance state
      const currentState = await systemMaintenanceRepo.maintenance.getMaintenanceState(assetUid);

      // Update or create maintenance state
      let maintenanceState;
      if (currentState) {
        // Update existing
        maintenanceState = await systemMaintenanceRepo.maintenance.updateOperatingHours(assetUid, hours);
      } else {
        // Create new (first hours update)
        maintenanceState = await systemMaintenanceRepo.maintenance.upsertMaintenanceState(
          assetUid,
          hours,
          installationDate || new Date() // Auto-set installation date if not provided
        );
      }

      logger.info('Operating hours updated successfully', {
        assetUid,
        hours,
        previousHours: latestEntry?.hours || 0,
        historyEntryId: historyEntry.id,
      });

      return {
        success: true,
        maintenanceState,
        historyEntry,
        previousHours: latestEntry?.hours || 0,
        hoursIncrement: hours - (latestEntry?.hours || 0),
      };
    } catch (error) {
      logger.error('Failed to update operating hours', {
        assetUid,
        hours,
        error: error.message,
      });
      throw error;
    }
  },

  /**
   * Get current maintenance state for a system
   * @param {string} assetUid - System asset UID
   * @returns {Promise<Object|null>} Maintenance state with staleness info
   */
  async getMaintenanceState(assetUid) {
    try {
      const state = await systemMaintenanceRepo.maintenance.getMaintenanceState(assetUid);

      if (!state) {
        return null;
      }

      // Calculate staleness
      const now = new Date();
      const lastUpdate = new Date(state.last_hours_update);
      const daysSinceUpdate = Math.floor((now - lastUpdate) / (1000 * 60 * 60 * 24));

      // Check if stale
      const isStale = daysSinceUpdate > config.tracking.hoursStalenessWarningDays;

      return {
        ...state,
        daysSinceUpdate,
        isStale,
        staleDays: config.tracking.hoursStalenessWarningDays,
      };
    } catch (error) {
      logger.error('Failed to get maintenance state', { assetUid, error: error.message });
      throw error;
    }
  },

  /**
   * Get systems with stale hours (not updated recently)
   * @returns {Promise<Array>} Systems needing hours update
   */
  async getStaleHoursSystems() {
    try {
      const staleDays = config.tracking.hoursStalenessWarningDays;
      const staleSystems = await systemMaintenanceRepo.maintenance.getStaleHours(staleDays);

      logger.info('Found stale systems', { count: staleSystems.length, staleDays });

      return staleSystems.map(system => ({
        ...system,
        daysSinceUpdate: Math.floor(
          (new Date() - new Date(system.last_hours_update)) / (1000 * 60 * 60 * 24)
        ),
      }));
    } catch (error) {
      logger.error('Failed to get stale hours systems', { error: error.message });
      throw error;
    }
  },

  /**
   * Get hours history for a system
   * @param {string} assetUid - System asset UID
   * @param {number} limit - Number of entries to fetch
   * @returns {Promise<Array>} Hours history with calculated increments
   */
  async getHoursHistory(assetUid, limit = 50) {
    try {
      const history = await systemMaintenanceRepo.history.getHistory(assetUid, limit);

      // Calculate increments between entries
      const historyWithIncrements = history.map((entry, index) => {
        const previousEntry = history[index + 1];
        const increment = previousEntry ? entry.hours - previousEntry.hours : null;

        return {
          ...entry,
          hoursIncrement: increment,
        };
      });

      return historyWithIncrements;
    } catch (error) {
      logger.error('Failed to get hours history', { assetUid, error: error.message });
      throw error;
    }
  },

  /**
   * Get hours statistics for a system
   * @param {string} assetUid - System asset UID
   * @returns {Promise<Object>} Hours statistics
   */
  async getHoursStatistics(assetUid) {
    try {
      const [state, history, replacements] = await Promise.all([
        systemMaintenanceRepo.maintenance.getMaintenanceState(assetUid),
        systemMaintenanceRepo.history.getHistory(assetUid, 100),
        systemMaintenanceRepo.history.getMeterReplacements(assetUid),
      ]);

      if (!state || history.length === 0) {
        return {
          currentHours: 0,
          totalEntries: 0,
          meterReplacements: 0,
          averageIncrement: 0,
          lastUpdate: null,
        };
      }

      // Calculate average increment (excluding meter replacements)
      const normalEntries = history.filter((entry, index) => {
        const previousEntry = history[index + 1];
        return previousEntry && !entry.meter_replaced && entry.hours > previousEntry.hours;
      });

      const totalIncrement = normalEntries.reduce((sum, entry, index) => {
        const previousEntry = history[index + 1];
        return sum + (entry.hours - previousEntry.hours);
      }, 0);

      const averageIncrement = normalEntries.length > 0
        ? Math.round(totalIncrement / normalEntries.length)
        : 0;

      return {
        currentHours: state.current_operating_hours,
        installationDate: state.installation_date,
        totalEntries: history.length,
        meterReplacements: replacements.length,
        averageIncrement,
        lastUpdate: state.last_hours_update,
        daysSinceUpdate: Math.floor(
          (new Date() - new Date(state.last_hours_update)) / (1000 * 60 * 60 * 24)
        ),
      };
    } catch (error) {
      logger.error('Failed to get hours statistics', { assetUid, error: error.message });
      throw error;
    }
  },

  /**
   * Validate hours update before submission
   * @param {string} assetUid - System asset UID
   * @param {number} hours - Proposed new hours
   * @returns {Promise<Object>} Validation result
   */
  async validateHoursUpdate(assetUid, hours) {
    try {
      const latestEntry = await systemMaintenanceRepo.history.getLatestEntry(assetUid);

      const validation = {
        valid: true,
        warnings: [],
        errors: [],
        lastRecorded: latestEntry?.hours || 0,
        increment: hours - (latestEntry?.hours || 0),
      };

      // Check if hours decreased
      if (latestEntry && hours < latestEntry.hours) {
        validation.valid = false;
        validation.errors.push({
          code: 'HOURS_DECREASED',
          message: `Hours cannot decrease from ${latestEntry.hours} to ${hours}. Set meterReplaced=true if meter was replaced.`,
        });
      }

      // Check for unusually large increment
      if (latestEntry) {
        const increment = hours - latestEntry.hours;
        const daysSinceLastUpdate = Math.floor(
          (new Date() - new Date(latestEntry.submitted_at)) / (1000 * 60 * 60 * 24)
        );

        // Warn if increment is more than 24 hours per day
        const expectedMaxIncrement = daysSinceLastUpdate * 24;
        if (increment > expectedMaxIncrement) {
          validation.warnings.push({
            code: 'LARGE_INCREMENT',
            message: `Increment of ${increment} hours seems high for ${daysSinceLastUpdate} days (max expected: ${expectedMaxIncrement} hours)`,
          });
        }
      }

      return validation;
    } catch (error) {
      logger.error('Failed to validate hours update', { assetUid, hours, error: error.message });
      throw error;
    }
  },
};

export default systemMaintenanceService;
