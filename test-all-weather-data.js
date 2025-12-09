/**
 * Comprehensive test to show ALL available weather data from Open-Meteo
 * Tests all models and all available parameters
 */

const lat = 12.5;  // Bequia, Caribbean
const lon = -61.2;

console.log('🌊 Open-Meteo Comprehensive Data Test');
console.log('=====================================');
console.log(`📍 Location: ${lat}, ${lon} (Bequia, Caribbean)`);
console.log('');

// All available hourly parameters for marine weather
const marineParams = [
  'wave_height',
  'wave_direction',
  'wave_period',
  'wind_wave_height',
  'wind_wave_direction',
  'wind_wave_period',
  'wind_wave_peak_period',
  'swell_wave_height',
  'swell_wave_direction',
  'swell_wave_period',
  'swell_wave_peak_period',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'sea_surface_temperature'
  // Note: sea_ice_cover not available for Caribbean locations
];

// All available hourly parameters for regular forecast
const forecastParams = [
  'temperature_2m',
  'relative_humidity_2m',
  'dewpoint_2m',
  'apparent_temperature',
  'precipitation',
  'rain',
  'showers',
  'snowfall',
  'snow_depth',
  'weather_code',
  'pressure_msl',
  'surface_pressure',
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'visibility',
  'evapotranspiration',
  'et0_fao_evapotranspiration',
  'vapour_pressure_deficit',
  'wind_speed_10m',
  'wind_speed_80m',
  'wind_speed_120m',
  'wind_speed_180m',
  'wind_direction_10m',
  'wind_direction_80m',
  'wind_direction_120m',
  'wind_direction_180m',
  'wind_gusts_10m',
  'temperature_80m',
  'temperature_120m',
  'temperature_180m',
  'soil_temperature_0cm',
  'soil_temperature_6cm',
  'soil_temperature_18cm',
  'soil_temperature_54cm',
  'soil_moisture_0_1cm',
  'soil_moisture_1_3cm',
  'soil_moisture_3_9cm',
  'soil_moisture_9_27cm',
  'soil_moisture_27_81cm',
  'is_day',
  'sunshine_duration',
  'uv_index',
  'uv_index_max',
  'is_day'
];

// Models to test
const models = [
  { name: 'ECMWF IFS04', param: 'ecmwf_ifs04' },
  { name: 'GFS Seamless', param: 'gfs_seamless' },
  { name: 'GFS 0.25°', param: 'gfs_0p25' },
  { name: 'GFS 0.50°', param: 'gfs_0p50' },
  { name: 'ICON', param: 'icon' },
  { name: 'ICON EU', param: 'icon_eu' },
  { name: 'ICON Global', param: 'icon_global' }
];

async function testMarineAPI() {
  console.log('1️⃣ MARINE API (Wave & Marine Data)');
  console.log('-----------------------------------');
  
  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=${marineParams.join(',')}&forecast_days=3`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      console.log('   ❌ Error:', data.reason);
      return;
    }
    
    console.log('   ✅ Success!');
    console.log(`   Model: ${data.models || 'ECMWF (default)'}`);
    console.log(`   Time points: ${data.hourly?.time?.length || 0}`);
    console.log('');
    console.log('   📊 Available Parameters:');
    
    if (data.hourly_units) {
      Object.keys(data.hourly_units).forEach(param => {
        const value = data.hourly[param]?.[0];
        const unit = data.hourly_units[param];
        console.log(`      ${param}: ${value !== undefined ? value : 'N/A'} ${unit}`);
      });
    }
    
    console.log('');
    console.log('   📈 Sample Data (first hour):');
    if (data.hourly?.time?.length > 0) {
      const idx = 0;
      console.log(`      Time: ${data.hourly.time[idx]}`);
      console.log(`      Wave Height: ${data.hourly.wave_height?.[idx]}m`);
      console.log(`      Wave Direction: ${data.hourly.wave_direction?.[idx]}°`);
      console.log(`      Wind Speed: ${data.hourly.wind_speed_10m?.[idx]} m/s`);
      console.log(`      Wind Direction: ${data.hourly.wind_direction_10m?.[idx]}°`);
      console.log(`      Swell Height: ${data.hourly.swell_wave_height?.[idx]}m`);
      console.log(`      Sea Surface Temp: ${data.hourly.sea_surface_temperature?.[idx]}°C`);
    }
    console.log('');
    
  } catch (error) {
    console.log('   ❌ Error:', error.message);
    console.log('');
  }
}

async function testForecastAPI(model) {
  console.log(`2️⃣ FORECAST API - ${model.name}`);
  console.log('-----------------------------------');
  
  // Use key marine-relevant params for forecast API
  const params = [
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
    'temperature_2m',
    'pressure_msl',
    'precipitation',
    'cloud_cover',
    'weather_code'
  ];
  
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${params.join(',')}&models=${model.param}&forecast_days=3`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      console.log(`   ❌ Error: ${data.reason}`);
      console.log('');
      return false;
    }
    
    console.log('   ✅ Success!');
    console.log(`   Models: ${data.models?.join(', ') || 'N/A'}`);
    console.log(`   Time points: ${data.hourly?.time?.length || 0}`);
    console.log('');
    console.log('   📊 Available Parameters:');
    
    if (data.hourly_units) {
      Object.keys(data.hourly_units).forEach(param => {
        const value = data.hourly[param]?.[0];
        const unit = data.hourly_units[param];
        console.log(`      ${param}: ${value !== undefined ? value : 'N/A'} ${unit}`);
      });
    }
    
    console.log('');
    console.log('   📈 Sample Data (first hour):');
    if (data.hourly?.time?.length > 0) {
      const idx = 0;
      console.log(`      Time: ${data.hourly.time[idx]}`);
      console.log(`      Wind Speed: ${data.hourly.wind_speed_10m?.[idx]} m/s`);
      console.log(`      Wind Direction: ${data.hourly.wind_direction_10m?.[idx]}°`);
      console.log(`      Wind Gusts: ${data.hourly.wind_gusts_10m?.[idx]} m/s`);
      console.log(`      Temperature: ${data.hourly.temperature_2m?.[idx]}°C`);
      console.log(`      Pressure: ${data.hourly.pressure_msl?.[idx]} hPa`);
      console.log(`      Precipitation: ${data.hourly.precipitation?.[idx]} mm`);
    }
    console.log('');
    
    return true;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    console.log('');
    return false;
  }
}

async function main() {
  // Test Marine API
  await testMarineAPI();
  
  // Test each forecast model
  console.log('3️⃣ FORECAST API - Testing All Models');
  console.log('=====================================');
  console.log('');
  
  for (const model of models) {
    await testForecastAPI(model);
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('');
  console.log('✅ Test Complete!');
  console.log('');
  console.log('💡 Summary:');
  console.log('   - Marine API: Wave, swell, wind data (defaults to ECMWF)');
  console.log('   - Forecast API: Wind, temperature, pressure (multiple models available)');
  console.log('   - For complete Caribbean marine weather: Use Marine API + Forecast API');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
