# Open-Meteo Weather Data Summary

## Test Results for Caribbean (12.5°N, 61.2°W - Bequia)

### ✅ Working Models

#### 1. GFS Seamless (`models=gfs_seamless`)
- **Status**: ✅ Works with real data
- **Available Parameters**:
  - Wind Speed 10m: 26.8 km/h
  - Wind Direction 10m: 70°
  - Wind Gusts 10m: 30.2 km/h
  - Temperature 2m: 28°C
  - Pressure MSL: 1011.9 hPa
  - Precipitation: 0 mm
  - Cloud Cover: 31%
  - Weather Code: 1 (WMO code)
- **Forecast Days**: 3 days (72 hourly points)
- **Best for**: General wind and weather forecasts

#### 2. ICON Global (`models=icon_global`)
- **Status**: ✅ Works with real data
- **Available Parameters**:
  - Wind Speed 10m: 23.6 km/h
  - Wind Direction 10m: 69°
  - Wind Gusts 10m: 29.9 km/h
  - Temperature 2m: 28°C
  - Pressure MSL: 1011.1 hPa
  - Precipitation: 0 mm
  - Cloud Cover: 52%
  - Weather Code: 1 (WMO code)
- **Forecast Days**: 3 days (72 hourly points)
- **Best for**: Alternative model comparison

#### 3. ECMWF IFS04 (`models=ecmwf_ifs04`)
- **Status**: ⚠️ Returns null values (may be timing/data availability issue)
- **Note**: Might work at different times or need different parameters

### ❌ Not Working Models

- `gfs_0p25` - Invalid model name
- `gfs_0p50` - Invalid model name
- `icon` - Invalid model name
- `icon_eu` - Not available for Caribbean (returns NaN)

### 🌊 Marine API

- **Status**: ⚠️ Needs parameter fix (remove `sea_ice_cover`)
- **Default Model**: ECMWF
- **Available Parameters** (when fixed):
  - Wave height, direction, period
  - Wind wave height, direction, period
  - Swell wave height, direction, period
  - Wind speed/direction 10m
  - Sea surface temperature
- **Best for**: Wave and swell data

## Recommended Approach

### For Complete Caribbean Marine Weather:

1. **Marine API** (ECMWF default)
   - Wave height, direction, period
   - Swell data
   - Sea surface temperature
   - Wind data

2. **Forecast API - GFS Seamless**
   - Wind speed, direction, gusts
   - Temperature
   - Pressure
   - Precipitation
   - Cloud cover

3. **Forecast API - ICON Global** (optional)
   - For model comparison
   - Alternative wind forecasts

## Data Structure Recommendation

```javascript
{
  area_id: "uuid",
  forecast_time: "2025-11-23T00:00:00Z",
  model_run_time: "2025-11-22T12:00:00Z", // When model was run
  model_name: "gfs_seamless" | "icon_global" | "ecmwf",
  
  // Wind data
  wind_speed_10m: 26.8, // km/h
  wind_direction_10m: 70, // degrees
  wind_gusts_10m: 30.2, // km/h
  
  // Wave data (from marine API)
  wave_height: 1.2, // meters
  wave_direction: 90, // degrees
  wave_period: 8.5, // seconds
  swell_wave_height: 0.8, // meters
  swell_wave_direction: 85, // degrees
  
  // Weather data
  temperature_2m: 28, // °C
  pressure_msl: 1011.9, // hPa
  precipitation: 0, // mm
  cloud_cover: 31, // %
  
  // Metadata
  sea_surface_temperature: 28.5, // °C
  created_at: "2025-11-23T00:00:00Z"
}
```

## Next Steps

1. Fix marine API test (remove `sea_ice_cover`)
2. Test marine API with correct parameters
3. Decide on model selection strategy:
   - Primary: GFS Seamless (most reliable for Caribbean)
   - Secondary: ICON Global (for comparison)
   - Marine: ECMWF via Marine API (for waves)
4. Build data fetching service
5. Create database schema for storing forecasts


