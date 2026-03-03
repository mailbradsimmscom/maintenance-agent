/**
 * Forecast Email Repository
 * Supabase CRUD for weather_forecast_emails and weather_expert_forecasts tables
 */

import supabaseRepo from './supabase.repository.js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const supabase = supabaseRepo.client;
const config = getConfig();
const logger = createLogger('forecast-email-repository');

export const forecastEmailRepository = {
  // ========== WEATHER_FORECAST_EMAILS ==========

  /**
   * Check if a Gmail message has already been ingested
   */
  async emailExists(gmailMessageId) {
    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .select('id, parse_status, raw_text')
      .eq('gmail_message_id', gmailMessageId)
      .maybeSingle();

    if (error) {
      logger.error('Failed to check email existence', { gmailMessageId, error: error.message });
      throw error;
    }

    return data; // null if not found, { id, parse_status, raw_text } if found
  },

  /**
   * Insert a new forecast email
   */
  async insertEmail({ gmail_message_id, sender_email, subject, received_at, raw_text, forecast_date, region_tag }) {
    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .insert({
        gmail_message_id,
        sender_email,
        subject,
        received_at,
        raw_text,
        forecast_date,
        region_tag,
        parse_status: 'ingested',
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to insert forecast email', { gmail_message_id, error: error.message });
      throw error;
    }

    logger.info('Forecast email inserted', { id: data.id, subject, gmail_message_id });
    return data;
  },

  /**
   * Update email content (re-ingest after failed attempt)
   */
  async updateEmailContent(emailId, updates) {
    const { error } = await supabase
      .from('weather_forecast_emails')
      .update(updates)
      .eq('id', emailId);

    if (error) {
      logger.error('Failed to update email content', { emailId, error: error.message });
      throw error;
    }
  },

  /**
   * Update parse status of an email
   */
  async updateParseStatus(emailId, status, parseError = null, forecastDate = null) {
    const updates = {
      parse_status: status,
      parse_error: parseError,
    };
    if (status === 'parsed') {
      updates.parsed_at = new Date().toISOString();
    }
    if (forecastDate) {
      updates.forecast_date = forecastDate;
    }

    const { error } = await supabase
      .from('weather_forecast_emails')
      .update(updates)
      .eq('id', emailId);

    if (error) {
      logger.error('Failed to update parse status', { emailId, status, error: error.message });
      throw error;
    }
  },

  /**
   * Get recent forecast emails
   */
  async getRecentEmails(limit = 20) {
    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .select('id, gmail_message_id, subject, received_at, forecast_date, parse_status, parse_error, region_tag, created_at')
      .order('received_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to get recent emails', { error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Delete oldest emails, keeping the most recent `keepCount`.
   * FK CASCADE cleans up their weather_expert_forecasts rows.
   */
  async deleteOldEmails(keepCount = 6) {
    // Get all emails ordered by received_at DESC
    const { data: allEmails, error: fetchError } = await supabase
      .from('weather_forecast_emails')
      .select('id, received_at')
      .order('received_at', { ascending: false });

    if (fetchError) {
      logger.error('Failed to fetch emails for retention', { error: fetchError.message });
      throw fetchError;
    }

    if (!allEmails || allEmails.length <= keepCount) return 0;

    const idsToDelete = allEmails.slice(keepCount).map(e => e.id);

    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .delete()
      .in('id', idsToDelete)
      .select('id');

    if (error) {
      logger.error('Failed to delete old emails', { keepCount, error: error.message });
      throw error;
    }

    const count = data?.length || 0;
    if (count > 0) {
      logger.info('Deleted old forecast emails', { count, kept: keepCount });
    }
    return count;
  },

  /**
   * Store structured forecast JSON on the email row (Step 1 checkpoint)
   */
  async storeStructuredForecast(emailId, structured, emailHash = null) {
    const updates = { structured_forecast: structured };
    if (emailHash) updates.email_hash = emailHash;

    const { error } = await supabase
      .from('weather_forecast_emails')
      .update(updates)
      .eq('id', emailId);

    if (error) {
      logger.error('Failed to store structured forecast', { emailId, error: error.message });
      throw error;
    }
  },

  /**
   * Get structured forecast JSON from the email row
   */
  async getStructuredForecast(emailId) {
    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .select('structured_forecast')
      .eq('id', emailId)
      .single();

    if (error) {
      logger.error('Failed to get structured forecast', { emailId, error: error.message });
      return null;
    }

    return data?.structured_forecast || null;
  },

  /**
   * Atomic job lock: set parse_status to 'parsing' only if eligible.
   * Returns true if lock acquired, false if another worker has it.
   */
  async acquireParseLock(emailId) {
    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .update({ parse_status: 'parsing' })
      .eq('id', emailId)
      .in('parse_status', ['queued', 'failed', 'partial'])
      .select('id');

    if (error) {
      logger.error('Failed to acquire parse lock', { emailId, error: error.message });
      return false;
    }

    return data && data.length > 0;
  },

  /**
   * Recover stale parse locks — reset emails stuck in 'parsing' for longer than maxMinutes.
   * Returns count of recovered rows.
   */
  async recoverStaleLocks(maxMinutes = 10) {
    const cutoff = new Date(Date.now() - maxMinutes * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .update({ parse_status: 'queued', parse_error: null })
      .eq('parse_status', 'parsing')
      .lt('created_at', cutoff)
      .select('id');

    if (error) {
      logger.error('Failed to recover stale locks', { error: error.message });
      return 0;
    }

    return data?.length || 0;
  },

  // ========== WEATHER_EXPERT_FORECASTS ==========

  /**
   * Insert expert forecast (one row per email per area per date)
   */
  async insertExpertForecast(forecast) {
    const { data, error } = await supabase
      .from('weather_expert_forecasts')
      .upsert(forecast, { onConflict: 'email_id,area_id,forecast_date' })
      .select()
      .single();

    if (error) {
      logger.error('Failed to insert expert forecast', { area_id: forecast.area_id, forecast_date: forecast.forecast_date, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Check if an email produced expert forecasts for any active (non-deleted) areas
   */
  async emailHasActiveForecasts(emailId) {
    const { count, error } = await supabase
      .from('weather_expert_forecasts')
      .select('id, weather_areas!inner(is_active, deleted_at)', { count: 'exact', head: true })
      .eq('email_id', emailId)
      .eq('weather_areas.is_active', true)
      .is('weather_areas.deleted_at', null);

    if (error) {
      logger.error('Failed to check email forecasts', { emailId, error: error.message });
      return false;
    }

    return count > 0;
  },

  /**
   * Update the area_change_summary on a specific forecast row
   */
  async updateChangeSummary(forecastId, summary) {
    const { error } = await supabase
      .from('weather_expert_forecasts')
      .update({ area_change_summary: summary })
      .eq('id', forecastId);

    if (error) {
      logger.error('Failed to update change summary', { forecastId, error: error.message });
      throw error;
    }
  },

  /**
   * Get all expert forecasts for an area (all versions, for comparison)
   * Returns rows from the most recent email only (latest batch)
   */
  async getExpertForecastsByArea(areaId) {
    const { data, error } = await supabase
      .from('weather_expert_forecasts')
      .select('*')
      .eq('area_id', areaId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to get expert forecasts by area', { areaId, error: error.message });
      throw error;
    }

    if (!data || data.length === 0) return [];

    // Return only rows from the most recent email_id
    const latestEmailId = data[0].email_id;
    return data.filter(r => r.email_id === latestEmailId);
  },

  /**
   * Get change summaries for all areas (for weather-areas listing page)
   * Joins email received_at for accurate "Updated X ago" display.
   * Filters out past-date bullets from change summary JSON arrays.
   */
  async getChangeSummaries() {
    const { data, error } = await supabase
      .from('weather_expert_forecasts')
      .select('area_id, area_change_summary, created_at, weather_forecast_emails!inner(received_at), weather_areas!inner(name, is_active, deleted_at)')
      .not('area_change_summary', 'is', null)
      .eq('weather_areas.is_active', true)
      .is('weather_areas.deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to get change summaries', { error: error.message });
      throw error;
    }

    if (!data || data.length === 0) return [];

    const todayStr = new Date().toISOString().split('T')[0];

    // Deduplicate: one summary per area (most recent)
    const seen = new Map();
    for (const row of data) {
      if (!seen.has(row.area_id)) {
        // Filter past dates from the summary JSON array
        const filtered = this._filterPastDates(row.area_change_summary, todayStr);
        if (!filtered) continue; // all bullets were past dates — skip area

        seen.set(row.area_id, {
          area_id: row.area_id,
          area_name: row.weather_areas?.name || 'Unknown',
          summary: filtered,
          updated_at: row.weather_forecast_emails?.received_at || row.created_at,
        });
      }
    }
    return Array.from(seen.values());
  },

  /**
   * Filter past-date bullets from a change summary.
   * Summary is a JSON array string like: [{"label":"Feb 25","text":"..."},{"label":"Mar 03","text":"..."}]
   * Returns filtered JSON string, or null if all bullets were filtered out.
   */
  _filterPastDates(summary, todayStr) {
    if (!summary) return null;
    try {
      const bullets = JSON.parse(summary);
      if (!Array.isArray(bullets)) return summary; // not the expected format, pass through

      const filtered = bullets.filter(b => {
        if (!b.label) return true; // keep bullets without a date label
        // Parse label like "Feb 25" or "Mar 03" into a date for the current year
        const parsed = this._parseBulletDate(b.label);
        if (!parsed) return true; // can't parse — keep it
        return parsed >= todayStr;
      });

      if (filtered.length === 0) return null;
      return JSON.stringify(filtered);
    } catch {
      // Old plain-text summaries — pass through unchanged
      return summary;
    }
  },

  /**
   * Parse a bullet label like "Feb 25" or "Mar 03" into YYYY-MM-DD for comparison.
   * Returns null if parsing fails.
   */
  _parseBulletDate(label) {
    const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                     Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const match = label.match(/^([A-Z][a-z]{2})\s*(\d{1,2})$/);
    if (!match) return null;
    const mon = months[match[1]];
    if (!mon) return null;
    const day = match[2].padStart(2, '0');
    const year = new Date().getFullYear();
    return `${year}-${mon}-${day}`;
  },

  /**
   * Get the latest expert forecast for an area on a specific date
   * (most recent email wins)
   */
  async getExpertForecast(areaId, date) {
    const { data, error } = await supabase
      .from('weather_expert_forecasts')
      .select('*')
      .eq('area_id', areaId)
      .eq('forecast_date', date)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error('Failed to get expert forecast', { areaId, date, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get latest expert forecasts for an area (for 10-day view)
   * Returns only the most recent version per forecast_date
   */
  async getExpertForecasts(areaId) {
    const { data, error } = await supabase
      .from('weather_expert_forecasts')
      .select('*')
      .eq('area_id', areaId)
      .order('forecast_date', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to get expert forecasts', { areaId, error: error.message });
      throw error;
    }

    // Deduplicate: keep only the latest row per forecast_date
    const latest = new Map();
    for (const row of (data || [])) {
      if (!latest.has(row.forecast_date)) {
        latest.set(row.forecast_date, row);
      }
    }
    return Array.from(latest.values());
  },

  /**
   * Get recent changes across all areas — compares the two most recent
   * versions for each (area_id, forecast_date) pair
   */
  async getRecentChanges(limit = 20) {
    // Fetch all expert forecasts from the last 10 days, ordered for comparison
    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('weather_expert_forecasts')
      .select('*, weather_areas!inner(name, is_active, deleted_at)')
      .gte('forecast_date', cutoff)
      .eq('weather_areas.is_active', true)
      .is('weather_areas.deleted_at', null)
      .order('forecast_date', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to get recent changes', { error: error.message });
      throw error;
    }

    if (!data || data.length === 0) return [];

    // Group by (area_id, forecast_date), compare latest two versions
    const groups = new Map();
    for (const row of data) {
      const key = `${row.area_id}|${row.forecast_date}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    const changes = [];
    const comparedFields = ['wind_forecast', 'swell_forecast', 'sailing_suggestion', 'precipitation', 'synopsis', 'outlook'];

    for (const [, rows] of groups) {
      if (rows.length < 2) continue; // no previous version to compare
      const current = rows[0];
      const previous = rows[1];

      const diffs = [];
      for (const field of comparedFields) {
        const oldVal = previous[field] || '';
        const newVal = current[field] || '';
        if (oldVal !== newVal && oldVal && newVal) {
          diffs.push({ field, previous: oldVal, current: newVal });
        }
      }

      if (diffs.length > 0) {
        changes.push({
          area_id: current.area_id,
          area_name: current.weather_areas?.name || 'Unknown',
          forecast_date: current.forecast_date,
          updated_at: current.created_at,
          diffs,
        });
      }
    }

    // Sort by most recently updated, limit
    changes.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    return changes.slice(0, limit);
  },
};

export default forecastEmailRepository;
