# Weather Areas Feature - Detailed Design Document

**Project:** Maintenance Agent - Weather Areas System
**Date:** 2025-11-25
**Status:** 🚧 Design Phase (Updated)
**Author:** Design Session

---

## Table of Contents

1. [Overview](#overview)
2. [API Strategy](#api-strategy)
3. [Requirements](#requirements)
4. [Database Schema](#database-schema)
5. [Architecture](#architecture)
6. [Service Layer Design](#service-layer-design)
7. [Repository Layer Design](#repository-layer-design)
8. [Job/Cron Design](#jobcron-design)
9. [API Integration](#api-integration)
10. [Error Handling & Recovery](#error-handling--recovery)
11. [Rate Limiting & Credit Management](#rate-limiting--credit-management)
12. [Data Flow](#data-flow)
13. [**UI Design**](#ui-design) ← NEW
14. [Migration Strategy](#migration-strategy)
15. [Testing Strategy](#testing-strategy)
16. [Implementation Phases](#implementation-phases)

---

## Overview

### Purpose
Build a weather areas system that:
- Defines geographic areas (lat/lon) for weather monitoring
- Fetches weather forecasts from **multiple APIs** (Open-Meteo + Meteoblue)
- Supports **multiple weather models** for comparison and confidence
- Stores forecast data in database for historical tracking
- Provides weather data for maintenance decision-making
- Runs autonomously via cron jobs

### Context
- **Primary APIs**: Open-Meteo (free, multi-model) + Meteoblue (premium marine)
- **Location**: Caribbean focus (13.1553°N, 61.2274°W tested)
- **Integration**: Maintenance Agent microservice
- **Philosophy**: More data is better for weather - use multiple sources

### Key Decisions
1. **Hybrid API Strategy**: Open-Meteo (free) + Meteoblue (premium marine)
2. **Multi-Model Support**: GFS, ICON, ECMWF from Open-Meteo for comparison
3. **Premium Marine Data**: Meteoblue for Douglas scale, salinity, currents
4. **Forecast Window**: 7 days
5. **Update Frequency**: Every 4 hours (6x daily)
6. **Credit Management**: Track Meteoblue usage, configurable fetch frequency

---

## API Strategy

### Why Two APIs?

| Aspect | Open-Meteo | Meteoblue |
|--------|------------|-----------|
| **Cost** | Free | Credits (limited) |
| **Rate Limits** | None (be polite) | Credit-based |
| **Models** | Raw multi-model (GFS, ICON, ECMWF) | Blended/optimized NEMS |
| **Resolution** | Hourly | 3-hourly |
| **Strength** | Model comparison, basic weather | Premium marine data |

### Data Source Responsibilities

**Open-Meteo Forecast API** (FREE - unlimited)
- Temperature, humidity, precipitation
- Wind speed, direction, gusts
- Pressure, cloud cover, weather code
- Multiple models: GFS Seamless, ICON Global, ECMWF

**Open-Meteo Marine API** (FREE - unlimited)
- Wave height, direction, period
- Swell height, direction, period
- Wind wave height, direction, period
- Sea surface temperature
- Multiple models: ECMWF WAM, GFS Wave, DWD GWAM

**Meteoblue Sea-3h API** (CREDITS - use sparingly)
- Douglas Sea State (1-9 scale) - easy interpretation
- Salinity (g/kg) - equipment corrosion
- Current velocity (U/V components) - navigation
- Wave steepness - danger assessment
- Peak periods (more precise than mean)
- Blended/optimized forecast (NEMS model)

### Model Comparison Strategy

Open-Meteo returns separate data per model, enabling comparison:
```
wind_speed_10m_gfs_seamless: [26.8, 27.1, ...]
wind_speed_10m_icon_global: [25.2, 26.0, ...]
wind_speed_10m_ecmwf_ifs04: [27.5, 28.0, ...]
```

This allows:
- Uncertainty assessment (model spread)
- Confidence scoring (model agreement)
- Historical accuracy tracking per model

---

## Requirements

### Functional Requirements

#### FR1: Weather Area Management
- **FR1.1**: Create weather areas with name, latitude, longitude
- **FR1.2**: Update weather area coordinates
- **FR1.3**: Delete weather areas (soft delete)
- **FR1.4**: List all active weather areas
- **FR1.5**: Get weather area by ID

#### FR2: Forecast Data Fetching
- **FR2.1**: Fetch from Open-Meteo Forecast API (wind, temp, pressure, precip)
- **FR2.2**: Fetch from Open-Meteo Marine API (waves, swell, SST)
- **FR2.3**: Fetch from Meteoblue Sea-3h API (Douglas scale, salinity, currents)
- **FR2.4**: Support multiple weather models from Open-Meteo (GFS, ICON, ECMWF)
- **FR2.5**: Store forecast data with source and model attribution
- **FR2.6**: Handle API failures gracefully per source

#### FR3: Data Storage
- **FR3.1**: Store hourly data (Open-Meteo) and 3-hourly data (Meteoblue)
- **FR3.2**: Track data source (open_meteo_forecast, open_meteo_marine, meteoblue)
- **FR3.3**: Track model name for Open-Meteo multi-model data
- **FR3.4**: Store forecast time (when data is valid)
- **FR3.5**: Preserve historical data (no overwrites)
- **FR3.6**: Support querying by area, time range, source, model

#### FR4: Scheduled Updates
- **FR4.1**: Run Open-Meteo updates every 6 hours (free)
- **FR4.2**: Run Meteoblue updates configurable (credit management)
- **FR4.3**: Process all active weather areas
- **FR4.4**: Handle failures with retry logic
- **FR4.5**: Log all update operations with credit tracking

#### FR5: Data Retrieval
- **FR5.1**: Get latest forecast for an area (all sources)
- **FR5.2**: Get forecast history for an area
- **FR5.3**: Compare models (GFS vs ICON vs ECMWF)
- **FR5.4**: Get forecast for specific time
- **FR5.5**: Get combined view merging all sources

#### FR6: Credit Management (Meteoblue)
- **FR6.1**: Track credit usage per fetch
- **FR6.2**: Configurable fetch frequency for Meteoblue
- **FR6.3**: Alert when credits run low
- **FR6.4**: Skip Meteoblue fetch when credits exhausted

### Non-Functional Requirements

#### NFR1: Performance
- **NFR1.1**: API calls complete within 5 seconds
- **NFR1.2**: Database queries complete within 1 second
- **NFR1.3**: Batch processing handles 10+ areas efficiently

#### NFR2: Reliability
- **NFR2.1**: 99% uptime for scheduled jobs
- **NFR2.2**: Graceful degradation on API failures (continue with other sources)
- **NFR2.3**: Retry failed requests up to 3 times

#### NFR3: Rate Limiting
- **NFR3.1**: Open-Meteo: Be polite (500ms between requests)
- **NFR3.2**: Meteoblue: Track credits, configurable frequency
- **NFR3.3**: Circuit breaker after 5 consecutive failures per source

#### NFR4: Data Quality
- **NFR4.1**: Validate all API responses before storage
- **NFR4.2**: Allow nulls (some params may be unavailable)
- **NFR4.3**: Track data quality metrics per source

---

## Database Schema

### Table: `weather_areas`

Stores geographic areas for weather monitoring.

```sql
CREATE TABLE weather_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    latitude DECIMAL(10, 7) NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
    longitude DECIMAL(11, 7) NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT unique_active_name UNIQUE (name) WHERE deleted_at IS NULL AND is_active = true
);

CREATE INDEX idx_weather_areas_active ON weather_areas(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_weather_areas_location ON weather_areas(latitude, longitude);
```

### Table: `weather_forecasts`

Stores forecast data from all sources. Supports both hourly (Open-Meteo) and 3-hourly (Meteoblue) data.

```sql
CREATE TABLE weather_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    area_id UUID NOT NULL REFERENCES weather_areas(id) ON DELETE CASCADE,

    -- Time & Source
    forecast_time TIMESTAMP WITH TIME ZONE NOT NULL,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    data_source VARCHAR(50) NOT NULL, -- 'open_meteo_forecast', 'open_meteo_marine', 'meteoblue'
    model_name VARCHAR(50), -- 'gfs_seamless', 'icon_global', 'ecmwf', 'meteoblue_nems', etc.

    -- Wind data (Open-Meteo Forecast)
    wind_speed_10m DECIMAL(6, 2), -- km/h
    wind_direction_10m INTEGER CHECK (wind_direction_10m >= 0 AND wind_direction_10m <= 360),
    wind_gusts_10m DECIMAL(6, 2), -- km/h

    -- Basic Weather (Open-Meteo Forecast)
    temperature_2m DECIMAL(5, 2), -- °C
    relative_humidity_2m INTEGER CHECK (relative_humidity_2m >= 0 AND relative_humidity_2m <= 100),
    pressure_msl DECIMAL(7, 2), -- hPa
    precipitation DECIMAL(6, 2), -- mm
    cloud_cover INTEGER CHECK (cloud_cover >= 0 AND cloud_cover <= 100),
    weather_code INTEGER, -- WMO code

    -- Wave data (Open-Meteo Marine + Meteoblue)
    wave_height DECIMAL(6, 2), -- meters
    wave_direction INTEGER CHECK (wave_direction >= 0 AND wave_direction <= 360),
    wave_period DECIMAL(5, 2), -- seconds (mean)

    -- Swell data (Open-Meteo Marine + Meteoblue)
    swell_wave_height DECIMAL(6, 2), -- meters
    swell_wave_direction INTEGER CHECK (swell_wave_direction >= 0 AND swell_wave_direction <= 360),
    swell_wave_period DECIMAL(5, 2), -- seconds (mean)
    swell_wave_peak_period DECIMAL(5, 2), -- seconds (Meteoblue only)

    -- Wind Wave data (Open-Meteo Marine + Meteoblue)
    wind_wave_height DECIMAL(6, 2), -- meters
    wind_wave_direction INTEGER CHECK (wind_wave_direction >= 0 AND wind_wave_direction <= 360),
    wind_wave_period DECIMAL(5, 2), -- seconds (mean)
    wind_wave_peak_period DECIMAL(5, 2), -- seconds (Meteoblue only)

    -- Sea data (Both sources)
    sea_surface_temperature DECIMAL(5, 2), -- °C

    -- Meteoblue-exclusive fields
    douglas_sea_state INTEGER CHECK (douglas_sea_state >= 0 AND douglas_sea_state <= 9),
    salinity DECIMAL(5, 2), -- g/kg
    current_velocity_u DECIMAL(6, 3), -- m/s (eastward)
    current_velocity_v DECIMAL(6, 3), -- m/s (northward)
    wave_steepness DECIMAL(6, 4),
    significant_wave_height DECIMAL(6, 2), -- meters (combined)
    surface_wave_height DECIMAL(6, 2), -- meters

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_area_time_source_model
        UNIQUE (area_id, forecast_time, data_source, model_name)
);

-- Indexes for common queries
CREATE INDEX idx_forecasts_area ON weather_forecasts(area_id);
CREATE INDEX idx_forecasts_time ON weather_forecasts(forecast_time);
CREATE INDEX idx_forecasts_source ON weather_forecasts(data_source);
CREATE INDEX idx_forecasts_model ON weather_forecasts(model_name);
CREATE INDEX idx_forecasts_area_time ON weather_forecasts(area_id, forecast_time DESC);
CREATE INDEX idx_forecasts_area_source ON weather_forecasts(area_id, data_source);
```

**Key Design Decisions:**
- **data_source**: Tracks which API the data came from
- **model_name**: For Open-Meteo multi-model data (null for Meteoblue single model)
- **Meteoblue fields**: Only populated when data_source = 'meteoblue'
- **Unique constraint**: Prevents duplicates per area + time + source + model

### Table: `weather_fetch_logs`

Tracks API fetch operations with credit tracking for Meteoblue.

```sql
CREATE TABLE weather_fetch_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    area_id UUID REFERENCES weather_areas(id) ON DELETE SET NULL,

    -- Fetch details
    data_source VARCHAR(50) NOT NULL, -- 'open_meteo_forecast', 'open_meteo_marine', 'meteoblue'
    model_name VARCHAR(50),
    status VARCHAR(20) NOT NULL, -- 'success', 'failed', 'partial', 'skipped'

    -- Results
    records_fetched INTEGER DEFAULT 0,
    records_stored INTEGER DEFAULT 0,

    -- Credit tracking (Meteoblue only)
    credits_used DECIMAL(10, 4) DEFAULT 0,
    credits_remaining DECIMAL(10, 4),

    -- Error handling
    error_message TEXT,
    error_code VARCHAR(50),
    retry_count INTEGER DEFAULT 0,

    -- Performance
    fetch_duration_ms INTEGER,
    api_response_time_ms INTEGER,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_fetch_logs_area ON weather_fetch_logs(area_id);
CREATE INDEX idx_fetch_logs_source ON weather_fetch_logs(data_source);
CREATE INDEX idx_fetch_logs_status ON weather_fetch_logs(status);
CREATE INDEX idx_fetch_logs_created ON weather_fetch_logs(created_at DESC);
```

### Table: `weather_api_credits`

Tracks Meteoblue credit usage and limits.

```sql
CREATE TABLE weather_api_credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_name VARCHAR(50) NOT NULL UNIQUE, -- 'meteoblue'

    -- Credit tracking
    credits_total DECIMAL(12, 4),
    credits_used DECIMAL(12, 4) DEFAULT 0,
    credits_remaining DECIMAL(12, 4),

    -- Rate limiting
    requests_today INTEGER DEFAULT 0,
    requests_this_hour INTEGER DEFAULT 0,
    last_request_at TIMESTAMP WITH TIME ZONE,

    -- Alerts
    low_credit_threshold DECIMAL(12, 4) DEFAULT 100,
    last_alert_sent_at TIMESTAMP WITH TIME ZONE,

    -- Timestamps
    credits_reset_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initialize Meteoblue tracking
INSERT INTO weather_api_credits (api_name, credits_total, credits_remaining)
VALUES ('meteoblue', 1000, 1000); -- Adjust based on your plan
```

---

## Architecture

### Layer Structure

```
┌─────────────────────────────────────────────────────┐
│  Jobs (Orchestration)                               │
│  - weather-update.job.js (triggers all fetches)     │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  Services (Business Logic)                          │
│  - weather-area.service.js     (area CRUD)          │
│  - weather-fetch.service.js    (orchestrates APIs)  │
│  - weather-forecast.service.js (query/compare)      │
│  - weather-credits.service.js  (Meteoblue credits)  │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  Repositories (I/O)                                 │
│  - weather.repository.js       (database)           │
│  - open-meteo.repository.js    (Open-Meteo APIs)    │
│  - meteoblue.repository.js     (Meteoblue API)      │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────┐
│  External APIs                                      │
│  ┌─────────────────────┐  ┌─────────────────────┐   │
│  │ Open-Meteo (FREE)   │  │ Meteoblue (CREDITS) │   │
│  │ - Forecast API      │  │ - Sea-3h Package    │   │
│  │ - Marine API        │  │                     │   │
│  │ - Multi-model       │  │ - Blended model     │   │
│  └─────────────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Component Responsibilities

#### Jobs Layer
- **weather-update.job.js**: Orchestrates fetches for all active areas from all sources

#### Services Layer
- **weather-area.service.js**: CRUD operations for weather areas
- **weather-fetch.service.js**: Orchestrates API fetching from all sources
- **weather-forecast.service.js**: Query, compare, and merge forecast data
- **weather-credits.service.js**: Manage Meteoblue credit tracking and alerts

#### Repositories Layer
- **weather.repository.js**: Database operations for all weather tables
- **open-meteo.repository.js**: API calls to Open-Meteo (Forecast + Marine)
- **meteoblue.repository.js**: API calls to Meteoblue Sea-3h

---

## Service Layer Design

### File: `src/services/weather-area.service.js`

**Purpose**: Manage weather areas (CRUD operations)

**Methods:**
```javascript
export const weatherAreaService = {
  /**
   * Create a new weather area
   * @param {Object} areaData - { name, latitude, longitude, description? }
   * @returns {Promise<Object>} Created area
   */
  async createArea(areaData) {
    // Validate coordinates
    // Check for duplicate names
    // Insert into database
    // Return created area
  },

  /**
   * Get all active weather areas
   * @returns {Promise<Array>} List of areas
   */
  async getAllAreas() {
    // Query active areas
    // Return list
  },

  /**
   * Get weather area by ID
   * @param {string} areaId - UUID
   * @returns {Promise<Object>} Area details
   */
  async getAreaById(areaId) {
    // Query by ID
    // Return area or null
  },

  /**
   * Update weather area
   * @param {string} areaId - UUID
   * @param {Object} updates - Partial area data
   * @returns {Promise<Object>} Updated area
   */
  async updateArea(areaId, updates) {
    // Validate updates
    // Update database
    // Return updated area
  },

  /**
   * Soft delete weather area
   * @param {string} areaId - UUID
   * @returns {Promise<void>}
   */
  async deleteArea(areaId) {
    // Set deleted_at timestamp
    // Mark as inactive
  }
};
```

**Error Handling:**
- Validate coordinates in range
- Check for duplicate active names
- Handle database errors

**Logging:**
- Log all CRUD operations
- Include area ID in logs

### File: `src/services/weather-fetch.service.js`

**Purpose**: Orchestrate fetching forecast data from APIs

**Methods:**
```javascript
export const weatherFetchService = {
  /**
   * Fetch forecasts for a single area
   * @param {string} areaId - UUID
   * @returns {Promise<Object>} Fetch result
   */
  async fetchForecastsForArea(areaId) {
    // Get area details
    // Fetch marine data (ECMWF)
    // Fetch forecast data (GFS Seamless)
    // Fetch forecast data (ICON Global) - optional
    // Store all data
    // Log fetch operation
    // Return summary
  },

  /**
   * Fetch forecasts for all active areas
   * @returns {Promise<Object>} Summary of all fetches
   */
  async fetchAllAreas() {
    // Get all active areas
    // Process each area (with error handling)
    // Return summary
  },

  /**
   * Fetch marine weather data
   * @param {Object} area - { latitude, longitude }
   * @returns {Promise<Array>} Marine forecast data
   */
  async fetchMarineData(area) {
    // Call Open-Meteo Marine API
    // Transform response
    // Return array of hourly data
  },

  /**
   * Fetch forecast data for a specific model
   * @param {Object} area - { latitude, longitude }
   * @param {string} modelName - 'gfs_seamless' | 'icon_global'
   * @returns {Promise<Array>} Forecast data
   */
  async fetchForecastData(area, modelName) {
    // Call Open-Meteo Forecast API
    // Transform response
    // Return array of hourly data
  }
};
```

**Error Handling:**
- Retry failed API calls (3 attempts)
- Log all failures
- Continue processing other areas on failure
- Return partial results if some models fail

**Rate Limiting:**
- Delay between API calls (500ms)
- Circuit breaker for repeated failures

### File: `src/services/weather-forecast.service.js`

**Purpose**: Business logic for forecast data

**Methods:**
```javascript
export const weatherForecastService = {
  /**
   * Get latest forecast for an area
   * @param {string} areaId - UUID
   * @param {string} modelName - Optional model filter
   * @returns {Promise<Object>} Latest forecast
   */
  async getLatestForecast(areaId, modelName = null) {
    // Query latest forecast_time
    // Filter by model if specified
    // Return forecast data
  },

  /**
   * Get forecast history for an area
   * @param {string} areaId - UUID
   * @param {Date} startTime - Start of range
   * @param {Date} endTime - End of range
   * @param {string} modelName - Optional model filter
   * @returns {Promise<Array>} Historical forecasts
   */
  async getForecastHistory(areaId, startTime, endTime, modelName = null) {
    // Query forecasts in time range
    // Filter by model if specified
    // Return array of forecasts
  },

  /**
   * Compare models for an area
   * @param {string} areaId - UUID
   * @param {Date} forecastTime - Specific time to compare
   * @returns {Promise<Object>} Comparison data
   */
  async compareModels(areaId, forecastTime) {
    // Get forecasts from all models for same time
    // Calculate differences
    // Return comparison object
  },

  /**
   * Store forecast data
   * @param {string} areaId - UUID
   * @param {Array} forecasts - Array of forecast objects
   * @returns {Promise<Object>} Storage result
   */
  async storeForecasts(areaId, forecasts) {
    // Validate forecast data
    // Batch insert into database
    // Handle duplicates (unique constraint)
    // Return count of stored records
  }
};
```

**Data Validation:**
- Validate all numeric ranges
- Check required fields
- Reject null/invalid data

---

## Repository Layer Design

### File: `src/repositories/weather.repository.js`

**Purpose**: Database operations for all weather tables

**Methods:**
```javascript
export const weatherRepository = {
  // ========== Weather Areas ==========
  async createArea(areaData) { /* Insert into weather_areas */ },
  async getAllAreas() { /* Select active areas */ },
  async getAreaById(areaId) { /* Select by ID */ },
  async updateArea(areaId, updates) { /* Update weather_areas */ },
  async deleteArea(areaId) { /* Soft delete */ },

  // ========== Weather Forecasts ==========
  async storeForecasts(forecasts) {
    // Batch insert with ON CONFLICT DO NOTHING
    // Handles duplicates via unique constraint
  },

  async getLatestForecast(areaId, { dataSource, modelName } = {}) {
    // Select latest forecast_time
    // Filter by source and/or model if specified
  },

  async getForecastHistory(areaId, startTime, endTime, { dataSource, modelName } = {}) {
    // Select forecasts in time range
    // Filter by source and/or model
  },

  async getModelComparison(areaId, forecastTime) {
    // Select all sources/models for same area + time
    // Enables model spread analysis
  },

  async getCombinedForecast(areaId, forecastTime) {
    // Join data from all sources for a complete picture
    // Merges Open-Meteo + Meteoblue data
  },

  // ========== Fetch Logs ==========
  async logFetch(fetchData) { /* Insert into weather_fetch_logs */ },
  async getFetchHistory(areaId, { dataSource, limit } = {}) { /* Recent logs */ },

  // ========== Credit Tracking ==========
  async getCredits(apiName) { /* Get current credit status */ },
  async updateCredits(apiName, creditsUsed) { /* Deduct credits */ },
  async resetDailyCounters() { /* Reset daily request counts */ }
};
```

### File: `src/repositories/open-meteo.repository.js`

**Purpose**: API calls to Open-Meteo (Forecast + Marine APIs)

**Methods:**
```javascript
export const openMeteoRepository = {
  /**
   * Fetch forecast data with multiple models
   * @returns Data with model-suffixed fields (e.g., wind_speed_10m_gfs_seamless)
   */
  async fetchForecastData(latitude, longitude, models = ['gfs_seamless', 'icon_global']) {
    // URL: https://api.open-meteo.com/v1/forecast
    // Params: hourly (wind, temp, pressure, precip, etc.)
    // Models: gfs_seamless, icon_global, ecmwf_ifs04
    // Returns separate data per model
  },

  /**
   * Fetch marine data with multiple models
   * @returns Wave, swell, wind-wave, SST data
   */
  async fetchMarineData(latitude, longitude, models = ['best_match']) {
    // URL: https://marine-api.open-meteo.com/v1/marine
    // Params: wave_height, swell, wind_wave, sea_surface_temperature
    // Models: ecmwf_wam, gfs_wave, dwd_gwam
  }
};
```

**Hourly Parameters - Forecast API:**
```
temperature_2m, relative_humidity_2m, precipitation,
pressure_msl, cloud_cover, weather_code,
wind_speed_10m, wind_direction_10m, wind_gusts_10m
```

**Hourly Parameters - Marine API:**
```
wave_height, wave_direction, wave_period,
swell_wave_height, swell_wave_direction, swell_wave_period,
wind_wave_height, wind_wave_direction, wind_wave_period,
sea_surface_temperature
```

### File: `src/repositories/meteoblue.repository.js` (NEW)

**Purpose**: API calls to Meteoblue Sea-3h package

**Methods:**
```javascript
export const meteoblueRepository = {
  /**
   * Fetch marine data from Meteoblue
   * @param {string} apiKey - Meteoblue API key
   * @returns Premium marine data (Douglas scale, salinity, currents)
   */
  async fetchSeaData(latitude, longitude, apiKey) {
    // URL: https://my.meteoblue.com/packages/sea-3h
    // Params: lat, lon, asl, format=json, forecast_days=7
    // Returns 3-hourly data with premium fields
  }
};
```

**Response Fields (Meteoblue Sea-3h):**
```javascript
{
  // Wave data
  significant_wave_height,  // Combined wave height
  surface_wave_height,      // Surface waves
  wave_steepness,           // Danger indicator

  // Swell data
  swell_height,
  swell_mean_direction,
  swell_mean_period,
  swell_peak_period,        // More precise than mean

  // Wind wave data
  windwave_height,
  windwave_direction,
  windwave_mean_period,
  windwave_peak_period,

  // Ocean data
  sea_surface_temperature,
  salinity,                 // g/kg - equipment corrosion
  current_velocity_u,       // Eastward m/s
  current_velocity_v,       // Northward m/s

  // Conditions
  douglas_sea_state         // 0-9 scale
}
```

**API Key Management:**
- Read from environment: `METEOBLUE_API_KEY`
- Never log or expose the key
- Track credits per request

---

## Job/Cron Design

### File: `src/jobs/weather-update.job.js`

**Purpose**: Scheduled job to fetch weather forecasts

**Structure:**
```javascript
import { weatherFetchService } from '../services/weather-fetch.service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('weather-update-job');

export const weatherUpdateJob = {
  /**
   * Run weather update for all active areas
   */
  async run() {
    logger.info('Starting weather update job');
    
    try {
      const result = await weatherFetchService.fetchAllAreas();
      
      logger.info('Weather update job completed', {
        areasProcessed: result.areasProcessed,
        areasSucceeded: result.areasSucceeded,
        areasFailed: result.areasFailed
      });
      
      return result;
    } catch (error) {
      logger.error('Weather update job failed', { error: error.message });
      throw error;
    }
  }
};
```

**Integration with Scheduler:**
- Add to `scheduler.job.js` ✅ IMPLEMENTED
- Run every 4 hours: `0 */4 * * *` (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC)
- Only fetches Open-Meteo (free API); Meteoblue requires manual trigger

### File: `src/jobs/scheduler.job.js` (Update)

**Add weather update job:** ✅ IMPLEMENTED
```javascript
// In setupCronJobs()
const weatherFetchSchedule = '0 */4 * * *'; // Every 4 hours
const weatherFetchTask = cron.schedule(weatherFetchSchedule, () => {
  agentLogger.cronJobExecuted('weather-fetch');
  this.performWeatherFetch();
});

this.scheduledTasks.push({
  name: 'weather-fetch',
  schedule: weatherFetchSchedule,
  task: weatherFetchTask,
});

// performWeatherFetch method added to schedulerJob:
async performWeatherFetch() {
  const results = await weatherFetchService.fetchAllAreas();
  // Logs success/failure counts
}
```

**UI Enhancement:** ✅ IMPLEMENTED
- Weather details page now shows "Last Downloaded" timestamp
- `fetched_at` field added to `/current` API response

---

## API Integration

### Open-Meteo Forecast API (FREE)

**Endpoint:** `https://api.open-meteo.com/v1/forecast`

**Example Request:**
```
https://api.open-meteo.com/v1/forecast
  ?latitude=13.1553
  &longitude=-61.2274
  &hourly=temperature_2m,relative_humidity_2m,precipitation,pressure_msl,
          cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code
  &models=gfs_seamless,icon_global,ecmwf_ifs04
  &forecast_days=7
```

**Multi-Model Response:**
```json
{
  "hourly": {
    "time": ["2025-11-25T00:00", "2025-11-25T01:00", ...],
    "wind_speed_10m_gfs_seamless": [26.8, 27.1, ...],
    "wind_speed_10m_icon_global": [25.2, 26.0, ...],
    "wind_speed_10m_ecmwf_ifs04": [27.5, 28.0, ...],
    "temperature_2m_gfs_seamless": [28.0, 27.8, ...],
    ...
  }
}
```

### Open-Meteo Marine API (FREE)

**Endpoint:** `https://marine-api.open-meteo.com/v1/marine`

**Example Request:**
```
https://marine-api.open-meteo.com/v1/marine
  ?latitude=13.1553
  &longitude=-61.2274
  &hourly=wave_height,wave_direction,wave_period,
          swell_wave_height,swell_wave_direction,swell_wave_period,
          wind_wave_height,wind_wave_direction,wind_wave_period,
          sea_surface_temperature
  &forecast_days=7
```

**Note:** Do NOT include `sea_ice_cover` (not available for Caribbean)

### Meteoblue Sea-3h API (CREDITS)

**Endpoint:** `https://my.meteoblue.com/packages/sea-3h`

**Example Request:**
```
https://my.meteoblue.com/packages/sea-3h
  ?apikey=YOUR_API_KEY
  &lat=13.1553
  &lon=-61.2274
  &asl=9
  &format=json
  &forecast_days=7
```

**Response Structure (3-hourly, 57 intervals for 7 days):**
```json
{
  "metadata": { "modelrun_utc": "2025-11-25 12:00", ... },
  "data_3h": {
    "time": ["2025-11-25 00:00", "2025-11-25 03:00", ...],
    "significant_wave_height": [1.8, 1.9, ...],
    "swell_height": [1.2, 1.3, ...],
    "swell_mean_direction": [85, 87, ...],
    "swell_mean_period": [8.5, 8.6, ...],
    "swell_peak_period": [10.2, 10.3, ...],
    "windwave_height": [0.8, 0.9, ...],
    "douglas_sea_state": [4, 4, ...],
    "sea_surface_temperature": [28.1, 28.0, ...],
    "salinity": [35.5, 35.6, ...],
    "current_velocity_u": [0.1, 0.12, ...],
    "current_velocity_v": [-0.05, -0.04, ...]
  }
}
```

### Data Transformation

**Open-Meteo Multi-Model Transform:**
```javascript
function transformOpenMeteoForecast(apiResponse, areaId, models) {
  const { hourly } = apiResponse;
  const forecasts = [];

  for (const modelName of models) {
    for (let i = 0; i < hourly.time.length; i++) {
      forecasts.push({
        area_id: areaId,
        forecast_time: hourly.time[i],
        data_source: 'open_meteo_forecast',
        model_name: modelName,
        wind_speed_10m: hourly[`wind_speed_10m_${modelName}`]?.[i],
        wind_direction_10m: hourly[`wind_direction_10m_${modelName}`]?.[i],
        temperature_2m: hourly[`temperature_2m_${modelName}`]?.[i],
        // ... other fields with model suffix
      });
    }
  }
  return forecasts;
}
```

**Meteoblue Transform:**
```javascript
function transformMeteoblueResponse(apiResponse, areaId) {
  const { data_3h, metadata } = apiResponse;
  const forecasts = [];

  for (let i = 0; i < data_3h.time.length; i++) {
    forecasts.push({
      area_id: areaId,
      forecast_time: data_3h.time[i],
      data_source: 'meteoblue',
      model_name: 'meteoblue_nems',

      // Meteoblue-exclusive fields
      douglas_sea_state: data_3h.douglas_sea_state?.[i],
      salinity: data_3h.salinity?.[i],
      current_velocity_u: data_3h.current_velocity_u?.[i],
      current_velocity_v: data_3h.current_velocity_v?.[i],
      wave_steepness: data_3h.wave_steepness?.[i],
      significant_wave_height: data_3h.significant_wave_height?.[i],

      // Shared fields
      swell_wave_height: data_3h.swell_height?.[i],
      swell_wave_direction: data_3h.swell_mean_direction?.[i],
      swell_wave_period: data_3h.swell_mean_period?.[i],
      swell_wave_peak_period: data_3h.swell_peak_period?.[i],
      sea_surface_temperature: data_3h.sea_surface_temperature?.[i],
    });
  }
  return forecasts;
}
```

---

## Error Handling & Recovery

### Error Types

1. **API Errors**
   - HTTP 4xx (client error)
   - HTTP 5xx (server error)
   - Network timeout
   - Invalid JSON response

2. **Data Errors**
   - Missing required fields
   - Invalid data types
   - Out-of-range values

3. **Database Errors**
   - Connection failures
   - Constraint violations
   - Transaction failures

### Retry Strategy

**Exponential Backoff:**
- 1st retry: 5 seconds
- 2nd retry: 15 seconds
- 3rd retry: 30 seconds
- Max 3 retries per request

**Implementation:**
```javascript
async function fetchWithRetry(fetchFn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchFn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

### Circuit Breaker

**Pattern:**
- Track consecutive failures per API endpoint
- After 5 failures, stop calling for 5 minutes
- Reset on first success

**Implementation:**
```javascript
const circuitBreakers = {
  marine: { failures: 0, lastFailure: null, open: false },
  forecast: { failures: 0, lastFailure: null, open: false }
};

function checkCircuitBreaker(type) {
  const breaker = circuitBreakers[type];
  
  if (breaker.open) {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    if (breaker.lastFailure < fiveMinutesAgo) {
      breaker.open = false;
      breaker.failures = 0;
    } else {
      throw new Error(`Circuit breaker open for ${type} API`);
    }
  }
}

function recordFailure(type) {
  const breaker = circuitBreakers[type];
  breaker.failures++;
  breaker.lastFailure = Date.now();
  
  if (breaker.failures >= 5) {
    breaker.open = true;
  }
}

function recordSuccess(type) {
  const breaker = circuitBreakers[type];
  breaker.failures = 0;
  breaker.open = false;
}
```

### Partial Failure Handling

**Strategy:**
- If marine API fails, still fetch forecast data
- If one model fails, still fetch other models
- Log all failures but continue processing
- Return partial results

---

## Rate Limiting & Credit Management

### Open-Meteo (FREE - Be Polite)

**No documented rate limit**, but be conservative:
- **500ms delay** between requests
- **Batch processing** with delays between areas
- **Circuit breaker** after 5 consecutive failures

### Meteoblue (CREDITS - Track Usage)

**Credit-based system:**
- Each API call consumes credits
- Track usage in `weather_api_credits` table
- Configurable fetch frequency via environment
- Alert when credits run low

**Environment Variables:**
```bash
METEOBLUE_API_KEY=your_api_key
METEOBLUE_ENABLED=true
METEOBLUE_FETCH_INTERVAL_HOURS=12  # Less frequent than Open-Meteo
METEOBLUE_LOW_CREDIT_THRESHOLD=100
```

### Credit Management Service

```javascript
// src/services/weather-credits.service.js
export const weatherCreditsService = {
  async canFetch(apiName) {
    const credits = await weatherRepository.getCredits(apiName);
    return credits.credits_remaining > 0;
  },

  async recordUsage(apiName, creditsUsed) {
    await weatherRepository.updateCredits(apiName, creditsUsed);

    // Check for low credit alert
    const credits = await weatherRepository.getCredits(apiName);
    if (credits.credits_remaining < credits.low_credit_threshold) {
      logger.warn('Low credits alert', {
        api: apiName,
        remaining: credits.credits_remaining
      });
      // TODO: Send alert notification
    }
  },

  async getStatus(apiName) {
    return weatherRepository.getCredits(apiName);
  }
};
```

### Fetch Strategy

```javascript
// In weather-fetch.service.js
async fetchAllSources(area) {
  const results = { openMeteo: null, meteoblue: null };

  // Always fetch Open-Meteo (free)
  results.openMeteo = await this.fetchOpenMeteo(area);

  // Only fetch Meteoblue if enabled and credits available
  const meteoblueEnabled = getConfig().METEOBLUE_ENABLED;
  const hasCredits = await weatherCreditsService.canFetch('meteoblue');

  if (meteoblueEnabled && hasCredits) {
    results.meteoblue = await this.fetchMeteoblue(area);
    await weatherCreditsService.recordUsage('meteoblue', 1);
  } else if (!hasCredits) {
    logger.info('Skipping Meteoblue fetch - no credits remaining');
  }

  return results;
}
```

### Request Delays

| Source | Between Areas | Between Requests |
|--------|---------------|------------------|
| Open-Meteo | 500ms | 200ms |
| Meteoblue | 1000ms | N/A (one request per area) |

---

## Data Flow

### Forecast Update Flow (Hybrid)

```
1. Cron job triggers (every 6 hours)
   ↓
2. Get all active weather areas
   ↓
3. For each area:
   │
   ├─► Open-Meteo Forecast API (always)
   │   - Fetch multi-model data (GFS, ICON, ECMWF)
   │   - Transform to separate records per model
   │   - Store with data_source='open_meteo_forecast'
   │
   ├─► Open-Meteo Marine API (always)
   │   - Fetch wave, swell, SST data
   │   - Transform response
   │   - Store with data_source='open_meteo_marine'
   │
   └─► Meteoblue Sea-3h API (if credits available)
       - Check credits remaining
       - If OK: fetch premium marine data
       - Transform 3-hourly data
       - Store with data_source='meteoblue'
       - Deduct credit
   ↓
4. Log all fetch operations (success/fail/skipped)
   ↓
5. Return summary with credit status
```

### Data Retrieval Flow

```
1. Request: Get forecast for area
   ↓
2. Options:
   a. Single source: Filter by data_source
   b. Single model: Filter by model_name
   c. Combined view: Merge all sources
   d. Model comparison: All models for same time
   ↓
3. Query database with filters
   ↓
4. Return forecast data
```

### Combined View Query

```sql
-- Get all data for a specific time, merged across sources
SELECT
  f.forecast_time,
  -- Open-Meteo Forecast data
  MAX(CASE WHEN data_source = 'open_meteo_forecast' AND model_name = 'gfs_seamless'
      THEN wind_speed_10m END) as wind_speed_gfs,
  MAX(CASE WHEN data_source = 'open_meteo_forecast' AND model_name = 'icon_global'
      THEN wind_speed_10m END) as wind_speed_icon,
  -- Open-Meteo Marine data
  MAX(CASE WHEN data_source = 'open_meteo_marine'
      THEN wave_height END) as wave_height,
  -- Meteoblue exclusive data
  MAX(CASE WHEN data_source = 'meteoblue'
      THEN douglas_sea_state END) as douglas_sea_state,
  MAX(CASE WHEN data_source = 'meteoblue'
      THEN salinity END) as salinity
FROM weather_forecasts f
WHERE area_id = $1 AND forecast_time = $2
GROUP BY f.forecast_time;
```

### Error Flow (Per Source)

```
1. API call fails for one source
   ↓
2. Retry (up to 3 times with exponential backoff)
   ↓
3. If still fails:
   a. Log error to weather_fetch_logs
   b. Update circuit breaker for that source
   c. CONTINUE with other sources (don't fail entire job)
   ↓
4. Return partial results (some sources may have data)
```

---

## UI Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Main App (192.168.20.106:3000)                             │
│  src/public/admin/                                          │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ weather-areas   │  │ weather-area    │  │ weather-area │ │
│  │ .html           │→ │ -add.html       │  │ -view.html   │ │
│  │ (List)          │  │ (Add/Edit)      │  │ (Detail)     │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
│           │                    │                   │         │
│           └────────────────────┼───────────────────┘         │
│                                ↓                             │
│                    CORS Requests to:                         │
└─────────────────────────────────────────────────────────────┘
                                 ↓
┌─────────────────────────────────────────────────────────────┐
│  Maintenance Agent (localhost:3001)                         │
│  /api/weather/*                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Points:**
- UI lives in main app (port 3000) under `/admin/`
- Uses CORS to communicate with maintenance-agent (port 3001)
- Follows existing admin page patterns
- Vanilla JS (no framework) - consistent with existing codebase

### External Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| Leaflet.js | 1.9.4 | Map picker for coordinates |
| Leaflet CSS | 1.9.4 | Map styling |

**CDN Links:**
```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

---

### Screen 1: Location List

**File:** `src/public/admin/weather-areas.html`

**URL:** `/admin/weather-areas.html`

**Purpose:** View all saved weather locations, add new ones, navigate to detail view

**Wireframe:**
```
┌─────────────────────────────────────────────────────────────┐
│  Weather Areas                           [+ Add New Location]│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Name              │ Coordinates      │ Last Fetch │     ││
│  ├───────────────────┼──────────────────┼────────────┼─────┤│
│  │ Bequia Anchorage  │ 13.15°N, 61.23°W │ 2 hrs ago  │[View]││
│  │                   │                  │            │[Del] ││
│  ├───────────────────┼──────────────────┼────────────┼─────┤│
│  │ Mustique          │ 12.88°N, 61.18°W │ 2 hrs ago  │[View]││
│  │                   │                  │            │[Del] ││
│  ├───────────────────┼──────────────────┼────────────┼─────┤│
│  │ Tobago Cays       │ 12.63°N, 61.35°W │ 2 hrs ago  │[View]││
│  │                   │                  │            │[Del] ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  Showing 3 locations                                         │
└─────────────────────────────────────────────────────────────┘
```

**Data Requirements:**
- List of weather areas from database
- Last fetch timestamp per area
- Area ID for navigation

**Actions:**
| Action | Behavior |
|--------|----------|
| `+ Add New Location` | Navigate to `weather-area-add.html` |
| `View` | Navigate to `weather-area-view.html?id={areaId}` |
| `Delete` | Confirm dialog → DELETE API call → Refresh list |

**API Calls:**
- `GET /api/weather/areas` - Load list
- `DELETE /api/weather/areas/{id}` - Delete area

---

### Screen 2: Add/Edit Location

**File:** `src/public/admin/weather-area-add.html`

**URL:** `/admin/weather-area-add.html` or `/admin/weather-area-add.html?id={areaId}` (edit mode)

**Purpose:** Create new location or edit existing one using map picker

**Wireframe:**
```
┌─────────────────────────────────────────────────────────────┐
│  Add Weather Location                        [Cancel] [Save]│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Name: [________________________]                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                                                          ││
│  │                    🗺️ MAP                                ││
│  │                                                          ││
│  │              Click to place marker                       ││
│  │                                                          ││
│  │                     📍                                   ││
│  │                                                          ││
│  │                                                          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  Latitude:  [13.1553    ]  Longitude: [-61.2274   ]         │
│  (Click map or enter manually)                               │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ [Save Location]              [Cancel]                    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

**Map Behavior:**
- Default view: Caribbean region (centered ~13°N, 61°W, zoom 8)
- Click anywhere to place/move marker
- Marker position updates lat/lon fields
- Lat/lon fields update marker position
- Draggable marker for fine adjustment

**Form Fields:**
| Field | Type | Validation |
|-------|------|------------|
| Name | text | Required, max 255 chars |
| Latitude | number | Required, -90 to 90 |
| Longitude | number | Required, -180 to 180 |

**Actions:**
| Action | Behavior |
|--------|----------|
| Click map | Place/move marker, update lat/lon fields |
| Edit lat/lon | Move marker to new position |
| Save | POST/PUT API call → Navigate to list |
| Cancel | Navigate back to list (confirm if unsaved changes) |

**API Calls:**
- `POST /api/weather/areas` - Create new area
- `PUT /api/weather/areas/{id}` - Update existing area (edit mode)
- `GET /api/weather/areas/{id}` - Load existing data (edit mode)

---

### Screen 3: Location Detail & Forecast View

**File:** `src/public/admin/weather-area-view.html`

**URL:** `/admin/weather-area-view.html?id={areaId}`

**Purpose:** View weather data, compare models, manually trigger updates

**Wireframe:**
```
┌─────────────────────────────────────────────────────────────┐
│  ← Back    Bequia Anchorage                  [Update Now 🔄]│
│            13.1553°N, 61.2274°W                              │
│            Last updated: 2 hours ago                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─── Current Conditions ───────────────────────────────────┐│
│  │ 🌡️ 28°C  |  💨 15 km/h ENE  |  🌊 1.2m  |  Douglas: 3   ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─── Model Comparison (Wind Speed) ────────────────────────┐│
│  │                                                          ││
│  │  Time     │ GFS      │ ICON     │ ECMWF    │ Spread     ││
│  │  ─────────┼──────────┼──────────┼──────────┼─────────── ││
│  │  Now      │ 15 km/h  │ 14 km/h  │ 16 km/h  │ ±1 km/h ✓  ││
│  │  +6h      │ 18 km/h  │ 16 km/h  │ 20 km/h  │ ±2 km/h ✓  ││
│  │  +12h     │ 22 km/h  │ 18 km/h  │ 25 km/h  │ ±4 km/h ⚠️ ││
│  │  +24h     │ 28 km/h  │ 20 km/h  │ 32 km/h  │ ±6 km/h ⚠️ ││
│  │                                                          ││
│  │  ✓ = Models agree (spread < 3)                          ││
│  │  ⚠️ = Models disagree (spread ≥ 3)                       ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─── Marine Data ──────────────────────────────────────────┐│
│  │                                                          ││
│  │  Wave Height    │ 1.2m                                   ││
│  │  Wave Direction │ 85° (E)                                ││
│  │  Wave Period    │ 8.5s                                   ││
│  │  Swell Height   │ 0.8m                                   ││
│  │  Swell Direction│ 70° (ENE)                              ││
│  │  SST            │ 28.1°C                                 ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─── Meteoblue Premium Data ───────────────────────────────┐│
│  │                                                          ││
│  │  Douglas Sea State │ 3 (Slight)                         ││
│  │  Salinity          │ 35.5 g/kg                          ││
│  │  Current (U)       │ 0.1 m/s (East)                     ││
│  │  Current (V)       │ -0.05 m/s (South)                  ││
│  │                                                          ││
│  │  ℹ️ Premium data from Meteoblue (credits: 847 remaining) ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─── 7-Day Forecast ───────────────────────────────────────┐│
│  │  Mon   Tue   Wed   Thu   Fri   Sat   Sun                ││
│  │  ☀️    ⛅    🌧️    ⛅    ☀️    ☀️    ⛅                 ││
│  │  28°   27°   26°   27°   28°   29°   28°                ││
│  │  15kn  18kn  22kn  20kn  16kn  14kn  15kn               ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

**Sections:**
1. **Header** - Location name, coordinates, last update, Update button
2. **Current Conditions** - Quick summary of key metrics
3. **Model Comparison** - Side-by-side GFS vs ICON vs ECMWF with spread indicator
4. **Marine Data** - Wave, swell, SST from Open-Meteo Marine
5. **Meteoblue Premium** - Douglas scale, salinity, currents (if available)
6. **7-Day Forecast** - Simple timeline view

**Actions:**
| Action | Behavior |
|--------|----------|
| `← Back` | Navigate to list |
| `Update Now` | Trigger fresh fetch from all APIs → Refresh display |

**API Calls:**
- `GET /api/weather/areas/{id}` - Load area details
- `GET /api/weather/areas/{id}/forecast` - Load forecast data (all sources)
- `POST /api/weather/areas/{id}/fetch` - Trigger manual update

**Model Spread Calculation:**
```javascript
const spread = Math.max(gfs, icon, ecmwf) - Math.min(gfs, icon, ecmwf);
const agreement = spread < 3 ? '✓' : '⚠️';
```

---

### API Endpoints (Maintenance Agent)

The UI requires these endpoints in the maintenance-agent:

**Weather Areas CRUD:**
```
GET    /api/weather/areas              → List all areas
GET    /api/weather/areas/:id          → Get single area
POST   /api/weather/areas              → Create area
PUT    /api/weather/areas/:id          → Update area
DELETE /api/weather/areas/:id          → Delete area (soft)
```

**Weather Forecast Data:**
```
GET    /api/weather/areas/:id/forecast → Get forecast data for area
       Query params:
         - source: 'open_meteo_forecast' | 'open_meteo_marine' | 'meteoblue' | 'all'
         - model: 'gfs_seamless' | 'icon_global' | 'ecmwf' | 'all'
         - hours: number (default 168 for 7 days)

POST   /api/weather/areas/:id/fetch    → Trigger manual fetch
       Response: { success, fetched: { openMeteo: true, meteoblue: true } }
```

**Credits:**
```
GET    /api/weather/credits            → Get Meteoblue credit status
       Response: { credits_remaining, credits_used, last_fetch }
```

---

### Douglas Sea State Reference

For UI display, map Douglas scale numbers to descriptions:

| Scale | Description | Wave Height |
|-------|-------------|-------------|
| 0 | Calm (glassy) | 0 m |
| 1 | Calm (rippled) | 0-0.1 m |
| 2 | Smooth | 0.1-0.5 m |
| 3 | Slight | 0.5-1.25 m |
| 4 | Moderate | 1.25-2.5 m |
| 5 | Rough | 2.5-4 m |
| 6 | Very rough | 4-6 m |
| 7 | High | 6-9 m |
| 8 | Very high | 9-14 m |
| 9 | Phenomenal | 14+ m |

---

### UI File Structure

```
src/public/admin/
├── weather-areas.html          # Screen 1: List
├── weather-area-add.html       # Screen 2: Add/Edit with map
├── weather-area-view.html      # Screen 3: Detail view
└── js/
    └── weather/
        ├── areas-list.js       # List page logic
        ├── area-form.js        # Add/edit form + map logic
        ├── area-view.js        # Detail view logic
        └── weather-api.js      # Shared API client
```

---

## Migration Strategy

### Migration File: `migrations/001_create_weather_tables.sql`

**Steps:**
1. Create `weather_areas` table
2. Create `weather_forecasts` table
3. Create `weather_fetch_logs` table
4. Create indexes
5. Add comments

**Rollback:**
```sql
DROP TABLE IF EXISTS weather_fetch_logs;
DROP TABLE IF EXISTS weather_forecasts;
DROP TABLE IF EXISTS weather_areas;
```

### Migration Process

1. **Development:**
   - Test migration on dev database
   - Verify schema
   - Test CRUD operations

2. **Staging:**
   - Run migration on staging
   - Test with real API calls
   - Verify data quality

3. **Production:**
   - Run migration during low-traffic window
   - Monitor for errors
   - Verify indexes created

---

## Testing Strategy

### Unit Tests

**Service Tests:**
- Mock repository layer
- Test business logic
- Test error handling
- Test data validation

**Repository Tests:**
- Mock database client
- Test SQL queries
- Test error handling

### Integration Tests

**API Integration:**
- Test real API calls (with rate limiting)
- Test response transformation
- Test error handling
- Test retry logic

**Database Integration:**
- Test with test database
- Test CRUD operations
- Test constraints
- Test indexes

### End-to-End Tests

**Full Flow:**
- Create weather area
- Trigger forecast update job
- Verify data stored
- Query forecast data
- Compare models

### Test Data

**Sample Weather Area:**
```javascript
{
  name: "Bequia, Caribbean",
  latitude: 12.5,
  longitude: -61.2,
  description: "Test area for Caribbean weather"
}
```

**Sample Forecast Data:**
```javascript
{
  area_id: "uuid",
  forecast_time: "2025-11-23T00:00:00Z",
  model_run_time: "2025-11-22T12:00:00Z",
  model_name: "gfs_seamless",
  wind_speed_10m: 26.8,
  wind_direction_10m: 70,
  temperature_2m: 28.0,
  // ... other fields
}
```

---

## Implementation Phases - Detailed Build Guide

> **IMPORTANT**: This section contains everything needed to build the feature.
> If context is compacted, read this section to continue exactly where you left off.

---

### ✅ BUILD COMPLETE (2025-11-25) - Updated with Enhancements

All phases implemented. Key files created:

**Backend (maintenance-agent/src/):**
- `repositories/weather.repository.js` - Database operations
- `repositories/open-meteo.repository.js` - Open-Meteo API
- `repositories/meteoblue.repository.js` - Meteoblue API (field mapping fixed for API response)
- `services/weather-area.service.js` - Area CRUD
- `services/weather-fetch.service.js` - API orchestration with source filtering (openmeteo/meteoblue)
- `services/weather-forecast.service.js` - Query & comparison
- `services/weather-credits.service.js` - Credit tracking
- `routes/weather.route.js` - All endpoints at `/api/weather/*`, fetch accepts `sources` body param
- `config/env.js` - Added METEOBLUE_API_KEY, METEOBLUE_ENABLED

**Frontend (maintenance-agent/public/):**
- `weather-areas.html` - List page
- `weather-area-add.html` - Add/Edit with Leaflet map
- `weather-area-view.html` - Detail view with 3 data tables + sailing conditions

**Note:** JavaScript is embedded inline in HTML files (no separate JS files).

**Access URL:** `http://localhost:3001/weather-areas.html`

---

### UI Enhancements (2025-11-25)

**weather-area-view.html features:**

1. **Separate Update Buttons:**
   - "Update Open-Meteo (Free)" - Fetches forecast + marine from Open-Meteo only
   - "Update Meteoblue (Credits)" - Fetches from Meteoblue only (costs 1 credit)
   - Both trigger page reload on completion

2. **Wind Speed in Knots:**
   - All wind displays converted to knots (km/h × 0.539957)
   - Current Conditions shows "16 kn" instead of "30 km/h"

3. **Three Detail Tables (3-hour intervals, 56 columns):**
   - **7-Day Forecast Detail** - Wind (kn), gusts, direction, temp, pressure, precip, cloud cover
   - **7-Day Marine Detail** - Wave/swell/wind wave heights, directions, periods, sea temp
   - **Premium Marine Data (Meteoblue)** - Douglas sea state, salinity, currents, wave steepness
   - Each table shows "Updated: [timestamp] EST"

4. **Sailing Conditions Section:**
   - Located in Marine Data card
   - Analyzes all 168 hourly data points
   - **Ideal (< 1.1m waves)** - Green badges
   - **Ok (1.1-1.4m waves)** - Yellow badges
   - Each badge shows: Day, Time, Wind (kn), Wind Dir (°), Wave Height (m)
   - Example: `Mon 25 09:00 · 16 kn 79° · 0.9m`

5. **Removed:** Model Comparison section (not useful for sailing decisions)

---

### Meteoblue API Field Mapping

The Meteoblue Sea-3h API uses different field names than expected. Correct mapping:

| API Response Field | Database Column |
|-------------------|-----------------|
| `douglas_seastate` | `douglas_sea_state` |
| `seasurfacetemperature` | `sea_surface_temperature` |
| `currentvelocity_u` | `current_velocity_u` |
| `currentvelocity_v` | `current_velocity_v` |
| `significantwaveheight` | `significant_wave_height` |
| `wavesteepness` | `wave_steepness` |
| `swell_significantheight` | `swell_wave_height` |
| `swell_meandirection` | `swell_wave_direction` |
| `swell_meanperiod` | `swell_wave_period` |
| `swell_peakwaveperiod` | `swell_wave_peak_period` |
| `windwave_height` | `wind_wave_height` |
| `windwave_direction` | `wind_wave_direction` |
| `windwave_meanperiod` | `wind_wave_period` |
| `windwave_peakwaveperiod` | `wind_wave_peak_period` |
| `surfwave_height` | `wave_height` |
| `mean_wavedirection` | `wave_direction` |
| `mean_waveperiod` | `wave_period` |

---

### Environment Configuration

**maintenance-agent/.env** requires:
```
METEOBLUE_API_KEY=your_api_key_here
METEOBLUE_ENABLED=true
```

**Note:** These must be in the maintenance-agent `.env` file, not the main app's `.env`.

---

### Build Order Overview

```
Phase 1: Database (Supabase) ✅ COMPLETE
    └── Run SQL migration
Phase 2: Backend - Repositories (maintenance-agent) ✅ COMPLETE
    ├── weather.repository.js
    ├── open-meteo.repository.js
    └── meteoblue.repository.js
Phase 3: Backend - Services (maintenance-agent) ✅ COMPLETE
    ├── weather-area.service.js
    ├── weather-fetch.service.js
    ├── weather-forecast.service.js
    └── weather-credits.service.js
Phase 4: Backend - Routes (maintenance-agent) ✅ COMPLETE
    └── weather.route.js (registered at /api/weather in index.js)
Phase 5: Frontend - HTML Pages (maintenance-agent/public/) ✅ COMPLETE
    ├── weather-areas.html
    ├── weather-area-add.html
    └── weather-area-view.html
Phase 6: Frontend - JavaScript ✅ COMPLETE (inline in HTML)
```

---

### Phase 1: Database Migration

**Status:** [x] Complete

**File:** Run directly in Supabase SQL Editor

```sql
-- =============================================
-- WEATHER AREAS FEATURE - DATABASE MIGRATION
-- Run this in Supabase SQL Editor
-- =============================================

-- Table 1: weather_areas
CREATE TABLE IF NOT EXISTS weather_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    latitude DECIMAL(10, 7) NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
    longitude DECIMAL(11, 7) NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_weather_areas_active ON weather_areas(is_active) WHERE deleted_at IS NULL;

-- Table 2: weather_forecasts
CREATE TABLE IF NOT EXISTS weather_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    area_id UUID NOT NULL REFERENCES weather_areas(id) ON DELETE CASCADE,
    forecast_time TIMESTAMP WITH TIME ZONE NOT NULL,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    data_source VARCHAR(50) NOT NULL,
    model_name VARCHAR(50),

    -- Wind (Open-Meteo Forecast)
    wind_speed_10m DECIMAL(6, 2),
    wind_direction_10m INTEGER,
    wind_gusts_10m DECIMAL(6, 2),

    -- Weather (Open-Meteo Forecast)
    temperature_2m DECIMAL(5, 2),
    relative_humidity_2m INTEGER,
    pressure_msl DECIMAL(7, 2),
    precipitation DECIMAL(6, 2),
    cloud_cover INTEGER,
    weather_code INTEGER,

    -- Waves (Open-Meteo Marine + Meteoblue)
    wave_height DECIMAL(6, 2),
    wave_direction INTEGER,
    wave_period DECIMAL(5, 2),
    swell_wave_height DECIMAL(6, 2),
    swell_wave_direction INTEGER,
    swell_wave_period DECIMAL(5, 2),
    swell_wave_peak_period DECIMAL(5, 2),
    wind_wave_height DECIMAL(6, 2),
    wind_wave_direction INTEGER,
    wind_wave_period DECIMAL(5, 2),
    wind_wave_peak_period DECIMAL(5, 2),
    sea_surface_temperature DECIMAL(5, 2),

    -- Meteoblue exclusive
    douglas_sea_state INTEGER,
    salinity DECIMAL(5, 2),
    current_velocity_u DECIMAL(6, 3),
    current_velocity_v DECIMAL(6, 3),
    wave_steepness DECIMAL(6, 4),
    significant_wave_height DECIMAL(6, 2),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_area_time_source_model UNIQUE (area_id, forecast_time, data_source, model_name)
);

CREATE INDEX IF NOT EXISTS idx_forecasts_area ON weather_forecasts(area_id);
CREATE INDEX IF NOT EXISTS idx_forecasts_time ON weather_forecasts(forecast_time);
CREATE INDEX IF NOT EXISTS idx_forecasts_source ON weather_forecasts(data_source);
CREATE INDEX IF NOT EXISTS idx_forecasts_area_time ON weather_forecasts(area_id, forecast_time DESC);

-- Table 3: weather_fetch_logs
CREATE TABLE IF NOT EXISTS weather_fetch_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    area_id UUID REFERENCES weather_areas(id) ON DELETE SET NULL,
    data_source VARCHAR(50) NOT NULL,
    model_name VARCHAR(50),
    status VARCHAR(20) NOT NULL,
    records_fetched INTEGER DEFAULT 0,
    records_stored INTEGER DEFAULT 0,
    credits_used DECIMAL(10, 4) DEFAULT 0,
    credits_remaining DECIMAL(10, 4),
    error_message TEXT,
    fetch_duration_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fetch_logs_area ON weather_fetch_logs(area_id);
CREATE INDEX IF NOT EXISTS idx_fetch_logs_created ON weather_fetch_logs(created_at DESC);

-- Table 4: weather_api_credits
CREATE TABLE IF NOT EXISTS weather_api_credits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_name VARCHAR(50) NOT NULL UNIQUE,
    credits_total DECIMAL(12, 4),
    credits_used DECIMAL(12, 4) DEFAULT 0,
    credits_remaining DECIMAL(12, 4),
    low_credit_threshold DECIMAL(12, 4) DEFAULT 100,
    last_request_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initialize Meteoblue credits (adjust total based on your plan)
INSERT INTO weather_api_credits (api_name, credits_total, credits_remaining)
VALUES ('meteoblue', 1000, 1000)
ON CONFLICT (api_name) DO NOTHING;
```

**Verify Migration:**
```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'weather%';
-- Should return: weather_areas, weather_forecasts, weather_fetch_logs, weather_api_credits
```

---

### Phase 2: Backend - Repositories

**Location:** `maintenance-agent/src/repositories/`

#### File 2.1: `weather.repository.js`

**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

**Path:** `maintenance-agent/src/repositories/weather.repository.js`

**Template:**
```javascript
import { supabase } from './supabase.repository.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'weather-repository' });

export const weatherRepository = {
  // ========== AREAS ==========
  async createArea({ name, latitude, longitude, description }) {
    const { data, error } = await supabase
      .from('weather_areas')
      .insert({ name, latitude, longitude, description })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getAllAreas() {
    const { data, error } = await supabase
      .from('weather_areas')
      .select('*')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return data;
  },

  async getAreaById(id) {
    const { data, error } = await supabase
      .from('weather_areas')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async updateArea(id, updates) {
    const { data, error } = await supabase
      .from('weather_areas')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteArea(id) {
    const { error } = await supabase
      .from('weather_areas')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id);
    if (error) throw error;
  },

  // ========== FORECASTS ==========
  async storeForecasts(forecasts) {
    if (!forecasts.length) return { count: 0 };
    const { data, error } = await supabase
      .from('weather_forecasts')
      .upsert(forecasts, { onConflict: 'area_id,forecast_time,data_source,model_name' })
      .select();
    if (error) throw error;
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
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async getForecastsByArea(areaId, { hours = 168 } = {}) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('weather_forecasts')
      .select('*')
      .eq('area_id', areaId)
      .gte('forecast_time', since)
      .order('forecast_time', { ascending: true });
    if (error) throw error;
    return data;
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
    if (error && error.code !== 'PGRST116') throw error;
    return data?.created_at;
  },

  // ========== FETCH LOGS ==========
  async logFetch(logData) {
    const { data, error } = await supabase
      .from('weather_fetch_logs')
      .insert(logData)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ========== CREDITS ==========
  async getCredits(apiName) {
    const { data, error } = await supabase
      .from('weather_api_credits')
      .select('*')
      .eq('api_name', apiName)
      .single();
    if (error) throw error;
    return data;
  },

  async updateCredits(apiName, creditsUsed) {
    const { data, error } = await supabase.rpc('decrement_credits', {
      p_api_name: apiName,
      p_credits: creditsUsed
    });
    // If RPC doesn't exist, use direct update:
    if (error) {
      const current = await this.getCredits(apiName);
      await supabase
        .from('weather_api_credits')
        .update({
          credits_used: current.credits_used + creditsUsed,
          credits_remaining: current.credits_remaining - creditsUsed,
          last_request_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('api_name', apiName);
    }
  }
};
```

#### File 2.2: `open-meteo.repository.js`

**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

**Path:** `maintenance-agent/src/repositories/open-meteo.repository.js`

**Template:**
```javascript
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'open-meteo-repository' });

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
const MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine';

export const openMeteoRepository = {
  async fetchForecastData(latitude, longitude, models = ['gfs_seamless', 'icon_global']) {
    const params = new URLSearchParams({
      latitude,
      longitude,
      hourly: 'temperature_2m,relative_humidity_2m,precipitation,pressure_msl,cloud_cover,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
      models: models.join(','),
      forecast_days: '7',
      timezone: 'UTC'
    });

    const url = `${FORECAST_BASE}?${params}`;
    log.info('Fetching Open-Meteo forecast', { latitude, longitude, models });

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo Forecast API error: ${response.status}`);
    }
    return response.json();
  },

  async fetchMarineData(latitude, longitude) {
    const params = new URLSearchParams({
      latitude,
      longitude,
      hourly: 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,sea_surface_temperature',
      forecast_days: '7',
      timezone: 'UTC'
    });

    const url = `${MARINE_BASE}?${params}`;
    log.info('Fetching Open-Meteo marine', { latitude, longitude });

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo Marine API error: ${response.status}`);
    }
    return response.json();
  },

  // Transform multi-model response to individual records
  transformForecastResponse(apiResponse, areaId, models) {
    const { hourly } = apiResponse;
    const forecasts = [];
    const now = new Date().toISOString();

    for (const modelName of models) {
      for (let i = 0; i < hourly.time.length; i++) {
        forecasts.push({
          area_id: areaId,
          forecast_time: hourly.time[i],
          fetched_at: now,
          data_source: 'open_meteo_forecast',
          model_name: modelName,
          temperature_2m: hourly[`temperature_2m_${modelName}`]?.[i] ?? hourly.temperature_2m?.[i],
          relative_humidity_2m: hourly[`relative_humidity_2m_${modelName}`]?.[i] ?? hourly.relative_humidity_2m?.[i],
          precipitation: hourly[`precipitation_${modelName}`]?.[i] ?? hourly.precipitation?.[i],
          pressure_msl: hourly[`pressure_msl_${modelName}`]?.[i] ?? hourly.pressure_msl?.[i],
          cloud_cover: hourly[`cloud_cover_${modelName}`]?.[i] ?? hourly.cloud_cover?.[i],
          weather_code: hourly[`weather_code_${modelName}`]?.[i] ?? hourly.weather_code?.[i],
          wind_speed_10m: hourly[`wind_speed_10m_${modelName}`]?.[i] ?? hourly.wind_speed_10m?.[i],
          wind_direction_10m: hourly[`wind_direction_10m_${modelName}`]?.[i] ?? hourly.wind_direction_10m?.[i],
          wind_gusts_10m: hourly[`wind_gusts_10m_${modelName}`]?.[i] ?? hourly.wind_gusts_10m?.[i],
        });
      }
    }
    return forecasts;
  },

  transformMarineResponse(apiResponse, areaId) {
    const { hourly } = apiResponse;
    const forecasts = [];
    const now = new Date().toISOString();

    for (let i = 0; i < hourly.time.length; i++) {
      forecasts.push({
        area_id: areaId,
        forecast_time: hourly.time[i],
        fetched_at: now,
        data_source: 'open_meteo_marine',
        model_name: 'ecmwf_wam',
        wave_height: hourly.wave_height?.[i],
        wave_direction: hourly.wave_direction?.[i],
        wave_period: hourly.wave_period?.[i],
        swell_wave_height: hourly.swell_wave_height?.[i],
        swell_wave_direction: hourly.swell_wave_direction?.[i],
        swell_wave_period: hourly.swell_wave_period?.[i],
        wind_wave_height: hourly.wind_wave_height?.[i],
        wind_wave_direction: hourly.wind_wave_direction?.[i],
        wind_wave_period: hourly.wind_wave_period?.[i],
        sea_surface_temperature: hourly.sea_surface_temperature?.[i],
      });
    }
    return forecasts;
  }
};
```

#### File 2.3: `meteoblue.repository.js`

**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

**Path:** `maintenance-agent/src/repositories/meteoblue.repository.js`

**Template:**
```javascript
import { getConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'meteoblue-repository' });

const METEOBLUE_BASE = 'https://my.meteoblue.com/packages/sea-3h';

export const meteoblueRepository = {
  async fetchSeaData(latitude, longitude) {
    const config = getConfig();
    const apiKey = config.METEOBLUE_API_KEY;

    if (!apiKey) {
      throw new Error('METEOBLUE_API_KEY not configured');
    }

    const params = new URLSearchParams({
      apikey: apiKey,
      lat: latitude,
      lon: longitude,
      asl: '9',
      format: 'json',
      forecast_days: '7'
    });

    const url = `${METEOBLUE_BASE}?${params}`;
    log.info('Fetching Meteoblue sea data', { latitude, longitude });

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Meteoblue API error: ${response.status}`);
    }
    return response.json();
  },

  transformResponse(apiResponse, areaId) {
    const { data_3h } = apiResponse;
    if (!data_3h || !data_3h.time) {
      throw new Error('Invalid Meteoblue response structure');
    }

    const forecasts = [];
    const now = new Date().toISOString();

    for (let i = 0; i < data_3h.time.length; i++) {
      forecasts.push({
        area_id: areaId,
        forecast_time: new Date(data_3h.time[i]).toISOString(),
        fetched_at: now,
        data_source: 'meteoblue',
        model_name: 'meteoblue_nems',
        // Meteoblue exclusive
        douglas_sea_state: data_3h.douglas_sea_state?.[i],
        salinity: data_3h.salinity?.[i],
        current_velocity_u: data_3h.current_velocity_u?.[i],
        current_velocity_v: data_3h.current_velocity_v?.[i],
        wave_steepness: data_3h.wave_steepness?.[i],
        significant_wave_height: data_3h.significant_wave_height?.[i],
        // Shared fields
        swell_wave_height: data_3h.swell_height?.[i],
        swell_wave_direction: data_3h.swell_mean_direction?.[i],
        swell_wave_period: data_3h.swell_mean_period?.[i],
        swell_wave_peak_period: data_3h.swell_peak_period?.[i],
        wind_wave_height: data_3h.windwave_height?.[i],
        wind_wave_direction: data_3h.windwave_direction?.[i],
        wind_wave_period: data_3h.windwave_mean_period?.[i],
        wind_wave_peak_period: data_3h.windwave_peak_period?.[i],
        sea_surface_temperature: data_3h.sea_surface_temperature?.[i],
      });
    }
    return forecasts;
  }
};
```

---

### Phase 3: Backend - Services

**Location:** `maintenance-agent/src/services/`

#### File 3.1: `weather-area.service.js`

**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

**Path:** `maintenance-agent/src/services/weather-area.service.js`

**Template:**
```javascript
import { weatherRepository } from '../repositories/weather.repository.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'weather-area-service' });

export const weatherAreaService = {
  async createArea(areaData) {
    log.info('Creating weather area', { name: areaData.name });
    return weatherRepository.createArea(areaData);
  },

  async getAllAreas() {
    return weatherRepository.getAllAreas();
  },

  async getAreaById(id) {
    return weatherRepository.getAreaById(id);
  },

  async updateArea(id, updates) {
    log.info('Updating weather area', { id });
    return weatherRepository.updateArea(id, updates);
  },

  async deleteArea(id) {
    log.info('Deleting weather area', { id });
    return weatherRepository.deleteArea(id);
  },

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
```

#### File 3.2: `weather-fetch.service.js`

**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

**Path:** `maintenance-agent/src/services/weather-fetch.service.js`

**Template:**
```javascript
import { weatherRepository } from '../repositories/weather.repository.js';
import { openMeteoRepository } from '../repositories/open-meteo.repository.js';
import { meteoblueRepository } from '../repositories/meteoblue.repository.js';
import { weatherCreditsService } from './weather-credits.service.js';
import { getConfig } from '../config/env.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'weather-fetch-service' });

const MODELS = ['gfs_seamless', 'icon_global'];

export const weatherFetchService = {
  async fetchForArea(areaId) {
    const area = await weatherRepository.getAreaById(areaId);
    if (!area) throw new Error(`Area not found: ${areaId}`);

    const results = { openMeteoForecast: null, openMeteoMarine: null, meteoblue: null };
    const startTime = Date.now();

    // 1. Open-Meteo Forecast (always)
    try {
      const forecastData = await openMeteoRepository.fetchForecastData(
        area.latitude, area.longitude, MODELS
      );
      const forecasts = openMeteoRepository.transformForecastResponse(forecastData, areaId, MODELS);
      const stored = await weatherRepository.storeForecasts(forecasts);
      results.openMeteoForecast = { success: true, count: stored.count };
      await this.logFetch(areaId, 'open_meteo_forecast', 'success', forecasts.length, stored.count);
    } catch (error) {
      log.error('Open-Meteo Forecast fetch failed', { areaId, error: error.message });
      results.openMeteoForecast = { success: false, error: error.message };
      await this.logFetch(areaId, 'open_meteo_forecast', 'failed', 0, 0, error.message);
    }

    // 2. Open-Meteo Marine (always)
    try {
      const marineData = await openMeteoRepository.fetchMarineData(area.latitude, area.longitude);
      const forecasts = openMeteoRepository.transformMarineResponse(marineData, areaId);
      const stored = await weatherRepository.storeForecasts(forecasts);
      results.openMeteoMarine = { success: true, count: stored.count };
      await this.logFetch(areaId, 'open_meteo_marine', 'success', forecasts.length, stored.count);
    } catch (error) {
      log.error('Open-Meteo Marine fetch failed', { areaId, error: error.message });
      results.openMeteoMarine = { success: false, error: error.message };
      await this.logFetch(areaId, 'open_meteo_marine', 'failed', 0, 0, error.message);
    }

    // 3. Meteoblue (if enabled and credits available)
    const config = getConfig();
    if (config.METEOBLUE_ENABLED) {
      const canFetch = await weatherCreditsService.canFetch('meteoblue');
      if (canFetch) {
        try {
          const seaData = await meteoblueRepository.fetchSeaData(area.latitude, area.longitude);
          const forecasts = meteoblueRepository.transformResponse(seaData, areaId);
          const stored = await weatherRepository.storeForecasts(forecasts);
          await weatherCreditsService.recordUsage('meteoblue', 1);
          const credits = await weatherCreditsService.getStatus('meteoblue');
          results.meteoblue = { success: true, count: stored.count, creditsRemaining: credits.credits_remaining };
          await this.logFetch(areaId, 'meteoblue', 'success', forecasts.length, stored.count, null, 1, credits.credits_remaining);
        } catch (error) {
          log.error('Meteoblue fetch failed', { areaId, error: error.message });
          results.meteoblue = { success: false, error: error.message };
          await this.logFetch(areaId, 'meteoblue', 'failed', 0, 0, error.message);
        }
      } else {
        results.meteoblue = { success: false, error: 'No credits remaining' };
        await this.logFetch(areaId, 'meteoblue', 'skipped', 0, 0, 'No credits remaining');
      }
    }

    log.info('Fetch complete for area', { areaId, duration: Date.now() - startTime, results });
    return results;
  },

  async fetchAllAreas() {
    const areas = await weatherRepository.getAllAreas();
    const results = [];
    for (const area of areas) {
      const result = await this.fetchForArea(area.id);
      results.push({ areaId: area.id, name: area.name, ...result });
      // Delay between areas
      await new Promise(r => setTimeout(r, 500));
    }
    return results;
  },

  async logFetch(areaId, dataSource, status, fetched, stored, error = null, credits = 0, creditsRemaining = null) {
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
  }
};
```

#### File 3.3: `weather-forecast.service.js`

**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

**Path:** `maintenance-agent/src/services/weather-forecast.service.js`

**Template:**
```javascript
import { weatherRepository } from '../repositories/weather.repository.js';

export const weatherForecastService = {
  async getForecastsForArea(areaId, options = {}) {
    return weatherRepository.getForecastsByArea(areaId, options);
  },

  async getLatestForecast(areaId, options = {}) {
    return weatherRepository.getLatestForecast(areaId, options);
  },

  async getModelComparison(areaId) {
    const forecasts = await weatherRepository.getForecastsByArea(areaId, { hours: 48 });

    // Group by forecast_time
    const byTime = {};
    for (const f of forecasts) {
      const time = f.forecast_time;
      if (!byTime[time]) byTime[time] = {};
      const key = f.data_source === 'open_meteo_forecast' ? f.model_name : f.data_source;
      byTime[time][key] = f;
    }

    // Calculate spread for each time
    const comparison = Object.entries(byTime).map(([time, models]) => {
      const gfs = models.gfs_seamless?.wind_speed_10m;
      const icon = models.icon_global?.wind_speed_10m;
      const values = [gfs, icon].filter(v => v != null);
      const spread = values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;

      return {
        forecast_time: time,
        gfs_seamless: models.gfs_seamless,
        icon_global: models.icon_global,
        open_meteo_marine: models.open_meteo_marine,
        meteoblue: models.meteoblue,
        wind_spread: spread,
        models_agree: spread < 3
      };
    });

    return comparison.sort((a, b) => new Date(a.forecast_time) - new Date(b.forecast_time));
  }
};
```

#### File 3.4: `weather-credits.service.js`

**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

**Path:** `maintenance-agent/src/services/weather-credits.service.js`

**Template:**
```javascript
import { weatherRepository } from '../repositories/weather.repository.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'weather-credits-service' });

export const weatherCreditsService = {
  async canFetch(apiName) {
    const credits = await weatherRepository.getCredits(apiName);
    return credits && credits.credits_remaining > 0;
  },

  async recordUsage(apiName, creditsUsed) {
    await weatherRepository.updateCredits(apiName, creditsUsed);
    const credits = await weatherRepository.getCredits(apiName);

    if (credits.credits_remaining < credits.low_credit_threshold) {
      log.warn('Low credits alert', { api: apiName, remaining: credits.credits_remaining });
    }
  },

  async getStatus(apiName) {
    return weatherRepository.getCredits(apiName);
  }
};
```

---

### Phase 4: Backend - Routes

**Location:** `maintenance-agent/src/routes/`

#### File 4.1: `weather.route.js`

**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

**Path:** `maintenance-agent/src/routes/weather.route.js`

**Template:**
```javascript
import express from 'express';
import { weatherAreaService } from '../services/weather-area.service.js';
import { weatherFetchService } from '../services/weather-fetch.service.js';
import { weatherForecastService } from '../services/weather-forecast.service.js';
import { weatherCreditsService } from '../services/weather-credits.service.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const log = logger.child({ module: 'weather-routes' });

// ========== AREAS ==========
router.get('/areas', async (req, res) => {
  try {
    const areas = await weatherAreaService.getAreasWithLastFetch();
    res.json({ success: true, data: areas });
  } catch (error) {
    log.error('Failed to get areas', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/areas/:id', async (req, res) => {
  try {
    const area = await weatherAreaService.getAreaById(req.params.id);
    if (!area) return res.status(404).json({ success: false, error: 'Area not found' });
    res.json({ success: true, data: area });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/areas', async (req, res) => {
  try {
    const { name, latitude, longitude, description } = req.body;
    const area = await weatherAreaService.createArea({ name, latitude, longitude, description });
    res.status(201).json({ success: true, data: area });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/areas/:id', async (req, res) => {
  try {
    const area = await weatherAreaService.updateArea(req.params.id, req.body);
    res.json({ success: true, data: area });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/areas/:id', async (req, res) => {
  try {
    await weatherAreaService.deleteArea(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== FORECASTS ==========
router.get('/areas/:id/forecast', async (req, res) => {
  try {
    const forecasts = await weatherForecastService.getForecastsForArea(req.params.id);
    res.json({ success: true, data: forecasts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/areas/:id/comparison', async (req, res) => {
  try {
    const comparison = await weatherForecastService.getModelComparison(req.params.id);
    res.json({ success: true, data: comparison });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/areas/:id/fetch', async (req, res) => {
  try {
    const result = await weatherFetchService.fetchForArea(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== CREDITS ==========
router.get('/credits', async (req, res) => {
  try {
    const credits = await weatherCreditsService.getStatus('meteoblue');
    res.json({ success: true, data: credits });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
```

**Register in app.js:**
```javascript
import weatherRoutes from './routes/weather.route.js';
// ...
app.use('/api/weather', weatherRoutes);
```

---

### Phase 5: Frontend - HTML Pages

**Location:** Main app `src/public/admin/`

> **Note:** These go in the MAIN APP (port 3000), not maintenance-agent

#### File 5.1: `weather-areas.html` (List)

**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

**Path:** `REIMAGINEDAPPV2/src/public/admin/weather-areas.html`

#### File 5.2: `weather-area-add.html` (Add/Edit with Map)

**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

**Path:** `REIMAGINEDAPPV2/src/public/admin/weather-area-add.html`

#### File 5.3: `weather-area-view.html` (Detail View)

**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

**Path:** `REIMAGINEDAPPV2/src/public/admin/weather-area-view.html`

---

### Phase 6: Frontend - JavaScript

**Location:** Main app `src/public/admin/js/weather/`

#### File 6.1: `weather-api.js` (Shared API Client)

**Status:** [ ] Not Started  [ ] In Progress  [ ] Complete

**Path:** `REIMAGINEDAPPV2/src/public/admin/js/weather/weather-api.js`

**Template:**
```javascript
const MAINTENANCE_API = 'http://localhost:3001/api/weather';

export const weatherApi = {
  async getAreas() {
    const res = await fetch(`${MAINTENANCE_API}/areas`);
    return res.json();
  },

  async getArea(id) {
    const res = await fetch(`${MAINTENANCE_API}/areas/${id}`);
    return res.json();
  },

  async createArea(data) {
    const res = await fetch(`${MAINTENANCE_API}/areas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },

  async updateArea(id, data) {
    const res = await fetch(`${MAINTENANCE_API}/areas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },

  async deleteArea(id) {
    const res = await fetch(`${MAINTENANCE_API}/areas/${id}`, { method: 'DELETE' });
    return res.json();
  },

  async getForecast(id) {
    const res = await fetch(`${MAINTENANCE_API}/areas/${id}/forecast`);
    return res.json();
  },

  async getComparison(id) {
    const res = await fetch(`${MAINTENANCE_API}/areas/${id}/comparison`);
    return res.json();
  },

  async triggerFetch(id) {
    const res = await fetch(`${MAINTENANCE_API}/areas/${id}/fetch`, { method: 'POST' });
    return res.json();
  },

  async getCredits() {
    const res = await fetch(`${MAINTENANCE_API}/credits`);
    return res.json();
  }
};
```

---

### Environment Variables

**Add to `maintenance-agent/.env`:**
```bash
# Weather APIs
METEOBLUE_API_KEY=your_key_here
METEOBLUE_ENABLED=true

# Optional overrides
OPEN_METEO_FORECAST_MODELS=gfs_seamless,icon_global
WEATHER_FETCH_INTERVAL_HOURS=6
```

**Add to `maintenance-agent/src/config/env.js` schema:**
```javascript
METEOBLUE_API_KEY: z.string().optional(),
METEOBLUE_ENABLED: z.coerce.boolean().default(false),
```

---

### Testing Checklist

After each phase, verify:

**Phase 1 (Database):**
- [ ] Tables created in Supabase
- [ ] Can insert test area via SQL

**Phase 2 (Repositories):**
- [ ] `node -e "import('./src/repositories/weather.repository.js')"` - no errors
- [ ] Can call Open-Meteo APIs directly

**Phase 3 (Services):**
- [ ] `node -e "import('./src/services/weather-fetch.service.js')"` - no errors

**Phase 4 (Routes):**
- [ ] `curl http://localhost:3001/api/weather/areas` returns `{"success":true,"data":[]}`
- [ ] Can create area via POST
- [ ] Can trigger fetch via POST

**Phase 5-6 (Frontend):**
- [ ] List page loads and shows areas
- [ ] Add page shows map, can save location
- [ ] View page shows forecast data

---

## Open Questions & Decisions Needed

### Resolved Questions

| Question | Decision |
|----------|----------|
| Single API vs Multiple? | **Multiple** - Open-Meteo (free) + Meteoblue (premium) |
| Which models? | **All available** - GFS, ICON, ECMWF from Open-Meteo |
| Forecast window? | **7 days** (both APIs support this) |
| Update frequency? | **6 hours** for Open-Meteo, configurable for Meteoblue |
| Allow null values? | **Yes** - some params may be unavailable |

### Open Questions

#### Q1: Meteoblue Fetch Frequency
**Question:** How often should we fetch Meteoblue data given limited credits?

**Options:**
- Every 6 hours (same as Open-Meteo) - ~120 requests/month per area
- Every 12 hours - ~60 requests/month per area
- Every 24 hours - ~30 requests/month per area
- On-demand only

**Recommendation:** Start with 12 hours (configurable via env var)

#### Q2: Historical Data Retention
**Question:** How long should we keep historical forecast data?

**Recommendation:** Keep all data indefinitely. Can add archival later if needed.

#### Q3: Credit Alerting
**Question:** How should we alert when Meteoblue credits run low?

**Options:**
- Log warning only
- Email notification
- Slack webhook
- Dashboard indicator

**Recommendation:** Start with logging, add notifications later

#### Q4: Model Spread Calculation
**Question:** Should we calculate model spread (uncertainty) automatically?

**Recommendation:** Yes, add a `model_spread` computed field for wind/temp showing max difference between models

#### Q5: UI Requirements
**Question:** What UI is needed for managing weather areas and viewing forecasts?

**To discuss:** See next section

---

## Success Criteria

### Functional
- [ ] Weather areas can be created/updated/deleted
- [ ] Open-Meteo forecasts fetched every 6 hours
- [ ] Meteoblue forecasts fetched on configurable schedule
- [ ] Multi-model data stored with proper attribution
- [ ] Data queryable by area/time/source/model
- [ ] Combined view merges all sources
- [ ] Credit tracking for Meteoblue
- [ ] Errors handled gracefully per source

### Non-Functional
- [ ] API calls complete within 5 seconds
- [ ] Database queries complete within 1 second
- [ ] 99% success rate for scheduled jobs
- [ ] Rate limiting prevents API abuse
- [ ] Circuit breaker prevents cascading failures
- [ ] Partial results returned when one source fails

### Quality
- [ ] All code follows architecture patterns (routes→services→repositories)
- [ ] No console.log (use logger)
- [ ] Environment via Zod (including METEOBLUE_API_KEY)
- [ ] Files under 250 lines
- [ ] Comprehensive error handling
- [ ] Tests passing

---

## Environment Variables

**Add to `maintenance-agent/.env`:**
```bash
METEOBLUE_API_KEY=your_api_key_here
METEOBLUE_ENABLED=true
```

**For Render:** Add same variables in Render dashboard.

---

## Post-Build Notes

### Deployment Ready
- CORS configured for localhost + Render URLs in `index.js`
- Frontend auto-detects local vs production API URL
- Route registered at `/api/weather/*`

### Access URLs
- **Local:** `http://localhost:3001/weather-areas.html`
- **Production:** `https://boatos-maintenance.onrender.com/weather-areas.html`

### API Endpoints
```
GET    /api/weather/areas              - List all areas
GET    /api/weather/areas/:id          - Get single area
POST   /api/weather/areas              - Create area
PUT    /api/weather/areas/:id          - Update area
DELETE /api/weather/areas/:id          - Delete area
GET    /api/weather/areas/:id/forecast - Get forecasts
GET    /api/weather/areas/:id/comparison - Model comparison
GET    /api/weather/areas/:id/current  - Current conditions
GET    /api/weather/areas/:id/7day     - 7-day summary
POST   /api/weather/areas/:id/fetch    - Trigger manual fetch
GET    /api/weather/credits            - Meteoblue credit status
```

---

## User Changes Needed

*Document any UI/functionality changes here after testing:*

1.
2.
3.

---

**End of Design Document**

*Last Updated: 2025-11-25*
*Version: 3.0 - Build Complete*



