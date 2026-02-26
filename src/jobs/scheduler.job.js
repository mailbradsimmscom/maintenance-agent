/**
 * Scheduler Job
 * Manages cron jobs and scheduled tasks
 */

import cron from 'node-cron';
import { systemProcessorJob } from './system-processor.job.js';
import { weatherFetchService } from '../services/weather-fetch.service.js';
import { forecastEmailService } from '../services/forecast-email.service.js';
import { getConfig } from '../config/env.js';
import { createLogger, agentLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('scheduler-job');

export const schedulerJob = {
  scheduledTasks: [],

  /**
   * Setup all cron jobs
   */
  setupCronJobs() {
    logger.info('Setting up cron jobs');

    // Primary system check - runs every N minutes (configurable); can be disabled via AGENT_SYSTEM_CHECK_ENABLED=false
    if (config.agent.systemCheckEnabled) {
      const systemCheckInterval = `*/${config.agent.runIntervalMinutes} * * * *`;
      const systemCheckTask = cron.schedule(systemCheckInterval, () => {
        agentLogger.cronJobExecuted('system-check');
        systemProcessorJob.checkForNewSystems();
      });

      this.scheduledTasks.push({
        name: 'system-check',
        schedule: systemCheckInterval,
        task: systemCheckTask,
      });

      agentLogger.cronJobScheduled('system-check', systemCheckInterval);
    } else {
      logger.info('System check cron disabled (AGENT_SYSTEM_CHECK_ENABLED=false)');
    }

    // Daily real-world update check (2 AM)
    const dailyUpdateSchedule = '0 2 * * *';
    const dailyUpdateTask = cron.schedule(dailyUpdateSchedule, () => {
      agentLogger.cronJobExecuted('daily-update');
      this.performDailyUpdate();
    });

    this.scheduledTasks.push({
      name: 'daily-update',
      schedule: dailyUpdateSchedule,
      task: dailyUpdateTask,
    });

    agentLogger.cronJobScheduled('daily-update', dailyUpdateSchedule);

    // Weekly system re-check (Sundays at 3 AM)
    const weeklyRecheckSchedule = '0 3 * * 0';
    const weeklyRecheckTask = cron.schedule(weeklyRecheckSchedule, () => {
      agentLogger.cronJobExecuted('weekly-recheck');
      this.performWeeklyRecheck();
    });

    this.scheduledTasks.push({
      name: 'weekly-recheck',
      schedule: weeklyRecheckSchedule,
      task: weeklyRecheckTask,
    });

    agentLogger.cronJobScheduled('weekly-recheck', weeklyRecheckSchedule);

    // Weather fetch - daily at 4am EST/9am UTC (all sources including Stormglass)
    const weatherFetchSchedule = '0 9 * * *';
    const weatherFetchTask = cron.schedule(weatherFetchSchedule, () => {
      agentLogger.cronJobExecuted('weather-fetch');
      this.performWeatherFetch();
    });

    this.scheduledTasks.push({
      name: 'weather-fetch',
      schedule: weatherFetchSchedule,
      task: weatherFetchTask,
    });

    agentLogger.cronJobScheduled('weather-fetch', weatherFetchSchedule);

    // Forecast email check - Mon-Sat at 8am,9am,10am,11am,noon EST (13-17 UTC)
    const forecastEmailSchedule = '0 13,14,15,16,17 * * 1-6';
    const forecastEmailTask = cron.schedule(forecastEmailSchedule, () => {
      agentLogger.cronJobExecuted('forecast-email-check');
      this.performForecastEmailCheck();
    });

    this.scheduledTasks.push({
      name: 'forecast-email-check',
      schedule: forecastEmailSchedule,
      task: forecastEmailTask,
    });

    agentLogger.cronJobScheduled('forecast-email-check', forecastEmailSchedule);

    logger.info(`${this.scheduledTasks.length} cron jobs scheduled`);
  },

  /**
   * Perform daily update checks
   */
  async performDailyUpdate() {
    logger.info('Performing daily update check');

    try {
      // TODO: Check for service bulletins
      // TODO: Check for manufacturer updates
      // TODO: Update confidence scores based on learning

      logger.info('Daily update completed');
    } catch (error) {
      logger.error('Daily update failed', { error: error.message });
    }
  },

  /**
   * Perform weekly system re-check
   */
  async performWeeklyRecheck() {
    logger.info('Performing weekly system re-check');

    try {
      // Re-process systems that haven't been checked in 7+ days
      // This ensures we catch any updates or new documentation

      // TODO: Query systems with old processing dates
      // TODO: Re-process with updated knowledge

      logger.info('Weekly re-check completed');
    } catch (error) {
      logger.error('Weekly re-check failed', { error: error.message });
    }
  },

  /**
   * Fetch weather data for all active areas (Open-Meteo only)
   */
  async performWeatherFetch() {
    logger.info('Performing scheduled weather fetch for all areas');

    try {
      const results = await weatherFetchService.fetchAllAreas();
      const successful = results.filter(r => !r.error).length;
      const failed = results.filter(r => r.error).length;

      logger.info('Scheduled weather fetch completed', {
        total: results.length,
        successful,
        failed
      });
    } catch (error) {
      logger.error('Scheduled weather fetch failed', { error: error.message });
    }
  },

  /**
   * Check Gmail for new forecast emails, parse and map to areas
   */
  async performForecastEmailCheck() {
    if (!config.forecastEmail?.enabled) {
      logger.debug('Forecast email feature disabled, skipping cron');
      return;
    }

    logger.info('Performing scheduled forecast email check');

    try {
      const result = await forecastEmailService.checkAndIngest();
      logger.info('Scheduled forecast email check completed', {
        found: result.emailsFound,
        ingested: result.emailsIngested,
        parsed: result.emailsParsed,
        errors: result.errors.length,
      });
    } catch (error) {
      logger.error('Scheduled forecast email check failed', { error: error.message });
    }
  },

  /**
   * Stop all scheduled tasks
   */
  stopAll() {
    logger.info('Stopping all scheduled tasks');

    for (const task of this.scheduledTasks) {
      task.task.stop();
      logger.debug(`Stopped task: ${task.name}`);
    }

    this.scheduledTasks = [];
  },

  /**
   * Get status of all scheduled tasks
   * @returns {Array} Task statuses
   */
  getStatus() {
    return this.scheduledTasks.map(task => ({
      name: task.name,
      schedule: task.schedule,
      running: task.task.running,
    }));
  },
};

export default schedulerJob;