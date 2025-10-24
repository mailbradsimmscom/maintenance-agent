/**
 * System Maintenance Routes
 * API endpoints for operating hours tracking
 */

import express from 'express';
import systemMaintenanceService from '../../services/system-maintenance.service.js';
import { createLogger } from '../../utils/logger.js';

const router = express.Router();
const logger = createLogger('system-maintenance-route');

/**
 * GET /admin/api/system-maintenance
 * Get all systems with usage-based maintenance tracking
 */
router.get('/', async (req, res, next) => {
  try {
    logger.info('Fetching all systems with maintenance tracking');

    // Get all systems with maintenance state (directly from repo)
    const { default: systemMaintenanceRepo } = await import('../../repositories/system-maintenance.repository.js');
    const systems = await systemMaintenanceRepo.maintenance.getAllMaintenanceStates(100);

    // Enrich with system info from Supabase
    const { createClient } = await import('@supabase/supabase-js');
    const { getConfig } = await import('../../config/env.js');
    const config = getConfig();
    const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

    const enrichedSystems = await Promise.all(
      systems.map(async (sys) => {
        try {
          const { data } = await supabase
            .from('systems')
            .select('subsystem_norm, description')
            .eq('asset_uid', sys.asset_uid)
            .single();

          return {
            ...sys,
            subsystem_norm: data?.subsystem_norm,
            description: data?.description,
          };
        } catch (error) {
          return sys; // Return without enrichment if lookup fails
        }
      })
    );

    return res.json({
      success: true,
      data: enrichedSystems,
    });

  } catch (error) {
    logger.error('Error fetching systems', { error: error.message });
    return next(error);
  }
});

/**
 * POST /admin/api/system-maintenance/:assetUid/hours
 * Update operating hours for a system
 */
router.post('/:assetUid/hours', async (req, res, next) => {
  
  const { assetUid } = req.params;
  const { hours, notes, meterReplaced, submittedBy, installationDate } = req.body;

  try {
    logger.info('Updating operating hours', { assetUid, hours });

    // Validation
    if (typeof hours !== 'number' || hours < 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_HOURS',
          message: 'Hours must be a positive number',
        },
      });
    }

    const result = await systemMaintenanceService.updateOperatingHours({
      assetUid,
      hours,
      submittedBy: submittedBy || 'user',
      notes: notes || null,
      meterReplaced: meterReplaced || false,
      installationDate: installationDate ? new Date(installationDate) : null,
    });

    logger.info('Operating hours updated', { assetUid, hours });

    return res.json({
      success: true,
      data: result,
    });

  } catch (error) {
    logger.error('Error updating hours', { assetUid, error: error.message });
    return next(error);
  }
});

/**
 * GET /admin/api/system-maintenance/:assetUid
 * Get maintenance state for a system
 */
router.get('/:assetUid', async (req, res, next) => {
  
  const { assetUid } = req.params;

  try {
    logger.info('Fetching maintenance state', { assetUid });

    const state = await systemMaintenanceService.getMaintenanceState(assetUid);

    if (!state) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `No maintenance state found for system ${assetUid}`,
        },
      });
    }

    return res.json({
      success: true,
      data: state,
    });

  } catch (error) {
    logger.error('Error fetching maintenance state', { assetUid, error: error.message });
    return next(error);
  }
});

/**
 * GET /admin/api/system-maintenance/:assetUid/hours/history
 * Get hours history for a system
 */
router.get('/:assetUid/hours/history', async (req, res, next) => {
  
  const { assetUid } = req.params;
  const { limit } = req.query;

  try {
    logger.info('Fetching hours history', { assetUid, limit });

    const history = await systemMaintenanceService.getHoursHistory(
      assetUid,
      limit ? parseInt(limit) : 50
    );

    return res.json({
      success: true,
      data: {
        history,
        count: history.length,
      },
    });

  } catch (error) {
    logger.error('Error fetching hours history', { assetUid, error: error.message });
    return next(error);
  }
});

/**
 * GET /admin/api/system-maintenance/:assetUid/hours/statistics
 * Get hours statistics for a system
 */
router.get('/:assetUid/hours/statistics', async (req, res, next) => {
  
  const { assetUid } = req.params;

  try {
    logger.info('Fetching hours statistics', { assetUid });

    const stats = await systemMaintenanceService.getHoursStatistics(assetUid);

    return res.json({
      success: true,
      data: stats,
    });

  } catch (error) {
    logger.error('Error fetching hours statistics', { assetUid, error: error.message });
    return next(error);
  }
});

/**
 * POST /admin/api/system-maintenance/:assetUid/hours/validate
 * Validate hours update before submission
 */
router.post('/:assetUid/hours/validate', async (req, res, next) => {
  
  const { assetUid } = req.params;
  const { hours } = req.body;

  try {
    logger.info('Validating hours update', { assetUid, hours });

    if (typeof hours !== 'number' || hours < 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_HOURS',
          message: 'Hours must be a positive number',
        },
      });
    }

    const validation = await systemMaintenanceService.validateHoursUpdate(assetUid, hours);

    return res.json({
      success: true,
      data: validation,
    });

  } catch (error) {
    logger.error('Error validating hours', { assetUid, error: error.message });
    return next(error);
  }
});

/**
 * GET /admin/api/system-maintenance/stale-hours
 * Get systems with stale hours (not updated recently)
 */
router.get('/stale-hours', async (req, res, next) => {
  

  try {
    logger.info('Fetching stale hours systems');

    const staleSystems = await systemMaintenanceService.getStaleHoursSystems();

    return res.json({
      success: true,
      data: {
        systems: staleSystems,
        count: staleSystems.length,
      },
    });

  } catch (error) {
    logger.error('Error fetching stale hours', { error: error.message });
    return next(error);
  }
});

/**
 * GET /admin/api/system-maintenance/summary
 * Get aggregated maintenance summary (per-system health)
 * [v2.1] Moved from Phase 9 to Phase 6
 */
router.get('/summary', async (req, res, next) => {
  

  try {
    logger.info('Fetching system maintenance summary');

    // Get all systems with maintenance tracking
    const staleSystems = await systemMaintenanceService.getStaleHoursSystems();

    // This is a placeholder - full implementation would aggregate from multiple systems
    // For now, return basic structure
    return res.json({
      success: true,
      data: {
        staleSystems: staleSystems.length,
        systems: staleSystems.map(system => ({
          asset_uid: system.asset_uid,
          current_hours: system.current_operating_hours,
          days_since_update: system.daysSinceUpdate,
          is_stale: true,
        })),
      },
    });

  } catch (error) {
    logger.error('Error fetching maintenance summary', { error: error.message });
    return next(error);
  }
});

export default router;
