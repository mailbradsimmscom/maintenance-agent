-- Migration: Add Stormglass columns to weather_forecasts
-- Date: 2026-01-04
-- Description: Extends weather_forecasts table to support Stormglass API data

-- Secondary swell (NOAA provides this)
ALTER TABLE weather_forecasts ADD COLUMN IF NOT EXISTS secondary_swell_height FLOAT;
ALTER TABLE weather_forecasts ADD COLUMN IF NOT EXISTS secondary_swell_direction FLOAT;
ALTER TABLE weather_forecasts ADD COLUMN IF NOT EXISTS secondary_swell_period FLOAT;

-- Current speed/direction (Stormglass uses this vs u/v components)
ALTER TABLE weather_forecasts ADD COLUMN IF NOT EXISTS current_speed FLOAT;
ALTER TABLE weather_forecasts ADD COLUMN IF NOT EXISTS current_direction FLOAT;

-- Sea level / tides
ALTER TABLE weather_forecasts ADD COLUMN IF NOT EXISTS sea_level FLOAT;

-- Visibility (km)
ALTER TABLE weather_forecasts ADD COLUMN IF NOT EXISTS visibility FLOAT;

-- Normalized field names (aliases for consistency across sources)
-- air_temperature maps to temperature_2m
-- water_temperature maps to sea_surface_temperature
-- gust maps to wind_gusts_10m
-- These are already covered by existing columns, no new columns needed

-- Add comment explaining data_source values
COMMENT ON COLUMN weather_forecasts.data_source IS 'Source API: open_meteo_forecast, open_meteo_marine, meteoblue, stormglass';
COMMENT ON COLUMN weather_forecasts.model_name IS 'Model/source within API. For stormglass: noaa, ecmwf, meteo, meto, sg, etc.';

-- Index for stormglass queries
CREATE INDEX IF NOT EXISTS idx_weather_forecasts_stormglass
ON weather_forecasts (area_id, forecast_time, data_source)
WHERE data_source = 'stormglass';
