/**
 * Journey Repository
 * Database operations for journeys, routes, and scenarios
 */

import supabaseRepo from './supabase.repository.js';
import { createLogger } from '../utils/logger.js';

const supabase = supabaseRepo.client;
const logger = createLogger('journey-repository');

export const journeyRepository = {

  // ========== JOURNEYS ==========

  async create({ title, start_name, start_lat, start_lon, end_name, end_lat, end_lon, earliest_departure }) {
    const { data, error } = await supabase
      .from('journeys')
      .insert({ title, start_name, start_lat, start_lon, end_name, end_lat, end_lon, earliest_departure })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create journey', { title, error: error.message });
      throw error;
    }

    logger.info('Journey created', { id: data.id, title });
    return data;
  },

  async getAll(status = null) {
    let query = supabase
      .from('journeys')
      .select('*')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to fetch journeys', { status, error: error.message });
      throw error;
    }

    return data || [];
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('journeys')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      logger.error('Failed to fetch journey', { id, error: error.message });
      throw error;
    }

    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('journeys')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update journey', { id, error: error.message });
      throw error;
    }

    logger.info('Journey updated', { id, fields: Object.keys(updates) });
    return data;
  },

  async delete(id) {
    // Only allow deleting journeys in planning state
    const { data: journey, error: fetchError } = await supabase
      .from('journeys')
      .select('status')
      .eq('id', id)
      .single();

    if (fetchError) {
      logger.error('Failed to fetch journey for delete', { id, error: fetchError.message });
      throw fetchError;
    }

    if (journey.status !== 'planning') {
      throw new Error(`Cannot delete journey in '${journey.status}' state — only 'planning' journeys can be deleted`);
    }

    const { error } = await supabase
      .from('journeys')
      .delete()
      .eq('id', id);

    if (error) {
      logger.error('Failed to delete journey', { id, error: error.message });
      throw error;
    }

    logger.info('Journey deleted', { id });
  },

  // ========== ROUTES ==========

  async createRoute(journeyId, { name, waypoints, distance_nm, estimated_duration_hrs, estimated_avg_sog, sort_order, ai_description }) {
    const { data, error } = await supabase
      .from('journey_routes')
      .insert({
        journey_id: journeyId,
        name,
        waypoints: waypoints || [],
        distance_nm,
        estimated_duration_hrs,
        estimated_avg_sog,
        sort_order: sort_order || 0,
        ai_description,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create journey route', { journeyId, name, error: error.message });
      throw error;
    }

    logger.info('Journey route created', { id: data.id, journeyId, name });
    return data;
  },

  async getRoutesByJourneyId(journeyId) {
    const { data, error } = await supabase
      .from('journey_routes')
      .select('*')
      .eq('journey_id', journeyId)
      .order('sort_order');

    if (error) {
      logger.error('Failed to fetch journey routes', { journeyId, error: error.message });
      throw error;
    }

    return data || [];
  },

  async getRouteById(id) {
    const { data, error } = await supabase
      .from('journey_routes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      logger.error('Failed to fetch journey route', { id, error: error.message });
      throw error;
    }

    return data;
  },

  async selectRoutes(journeyId, routeIds) {
    // Deselect all routes for this journey first
    const { error: deselectError } = await supabase
      .from('journey_routes')
      .update({ is_selected: false })
      .eq('journey_id', journeyId);

    if (deselectError) {
      logger.error('Failed to deselect routes', { journeyId, error: deselectError.message });
      throw deselectError;
    }

    // Select the specified routes
    if (routeIds.length > 0) {
      const { error: selectError } = await supabase
        .from('journey_routes')
        .update({ is_selected: true })
        .eq('journey_id', journeyId)
        .in('id', routeIds);

      if (selectError) {
        logger.error('Failed to select routes', { journeyId, routeIds, error: selectError.message });
        throw selectError;
      }
    }

    logger.info('Routes selected', { journeyId, selectedCount: routeIds.length });
    return this.getRoutesByJourneyId(journeyId);
  },

  async deleteRoutesByJourneyId(journeyId) {
    const { error } = await supabase
      .from('journey_routes')
      .delete()
      .eq('journey_id', journeyId);

    if (error) {
      logger.error('Failed to delete journey routes', { journeyId, error: error.message });
      throw error;
    }

    logger.info('Journey routes deleted', { journeyId });
  },

  // ========== SCENARIOS ==========

  async createScenario(journeyId, { route_id, departure_time, overall_score, waypoint_scores, scored_at, ai_summary }) {
    const { data, error } = await supabase
      .from('journey_scenarios')
      .insert({
        journey_id: journeyId,
        route_id,
        departure_time,
        overall_score: overall_score ?? null,
        waypoint_scores: waypoint_scores ?? null,
        scored_at: scored_at ?? null,
        ai_summary: ai_summary ?? null,
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create journey scenario', { journeyId, route_id, error: error.message });
      throw error;
    }

    return data;
  },

  async getScenariosByJourneyId(journeyId) {
    const { data, error } = await supabase
      .from('journey_scenarios')
      .select('*')
      .eq('journey_id', journeyId)
      .order('departure_time');

    if (error) {
      logger.error('Failed to fetch journey scenarios', { journeyId, error: error.message });
      throw error;
    }

    return data || [];
  },

  async getScenarioById(id) {
    const { data, error } = await supabase
      .from('journey_scenarios')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      logger.error('Failed to fetch journey scenario', { id, error: error.message });
      throw error;
    }

    return data;
  },

  async updateScenario(id, updates) {
    const { data, error } = await supabase
      .from('journey_scenarios')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update journey scenario', { id, error: error.message });
      throw error;
    }

    return data;
  },

  async deleteScenariosByJourneyId(journeyId) {
    const { error } = await supabase
      .from('journey_scenarios')
      .delete()
      .eq('journey_id', journeyId);

    if (error) {
      logger.error('Failed to delete journey scenarios', { journeyId, error: error.message });
      throw error;
    }

    logger.info('Journey scenarios deleted', { journeyId });
  },

  // ========== JOURNEY WITH RELATIONS ==========

  async getJourneyWithRoutes(id) {
    const journey = await this.getById(id);
    if (!journey) return null;

    const routes = await this.getRoutesByJourneyId(id);
    return { ...journey, routes };
  },

  async getJourneyFull(id) {
    const journey = await this.getById(id);
    if (!journey) return null;

    const routes = await this.getRoutesByJourneyId(id);
    const scenarios = await this.getScenariosByJourneyId(id);
    return { ...journey, routes, scenarios };
  },

  // ========== BEGIN JOURNEY (transaction-like) ==========

  async beginJourney(journeyId, { route_id, departure_time, trip_id }) {
    // Update journey: set sailing state + selected route/departure + trip link
    const { data, error } = await supabase
      .from('journeys')
      .update({
        status: 'sailing',
        selected_route_id: route_id,
        selected_departure: departure_time,
        trip_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', journeyId)
      .eq('status', 'planning')  // Only transition from planning
      .select()
      .single();

    if (error) {
      logger.error('Failed to begin journey', { journeyId, error: error.message });
      throw error;
    }

    if (!data) {
      throw new Error('Journey not found or not in planning state');
    }

    logger.info('Journey begun', { journeyId, routeId: route_id, tripId: trip_id });
    return data;
  },

  async completeJourney(journeyId) {
    const { data, error } = await supabase
      .from('journeys')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', journeyId)
      .eq('status', 'sailing')  // Only transition from sailing
      .select()
      .single();

    if (error) {
      logger.error('Failed to complete journey', { journeyId, error: error.message });
      throw error;
    }

    if (!data) {
      throw new Error('Journey not found or not in sailing state');
    }

    logger.info('Journey completed', { journeyId });
    return data;
  },
};
