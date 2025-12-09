/**
 * Test both ECMWF and GFS models from Open-Meteo
 */

const lat = 12.5;
const lon = -61.2;

console.log('🌊 Testing Open-Meteo for ECMWF and GFS models...');
console.log(`📍 Location: ${lat}, ${lon} (Bequia, Caribbean)`);
console.log('');

// Test 1: Marine API (defaults to ECMWF)
console.log('1️⃣ Marine API (defaults to ECMWF):');
const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wind_speed_10m&forecast_days=1`;

fetch(marineUrl)
  .then(res => res.json())
  .then(data => {
    console.log('   ✅ Success');
    console.log('   Model:', data.models || 'ECMWF (default)');
    console.log('   Time points:', data.hourly?.time?.length || 0);
    if (data.hourly?.time?.length > 0) {
      console.log('   Sample - Wave:', data.hourly.wave_height?.[0], 'm');
      console.log('   Sample - Wind:', data.hourly.wind_speed_10m?.[0], 'm/s');
    }
    console.log('');
    
    // Test 2: Regular Forecast API with GFS
    console.log('2️⃣ Regular Forecast API with GFS:');
    const gfsUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m&models=gfs_seamless&forecast_days=1`;
    
    return fetch(gfsUrl);
  })
  .then(res => res.json())
  .then(data => {
    console.log('   ✅ Success');
    console.log('   Models:', data.models || []);
    console.log('   Time points:', data.hourly?.time?.length || 0);
    if (data.hourly?.time?.length > 0) {
      console.log('   Sample - Wind Speed:', data.hourly.wind_speed_10m?.[0], 'm/s');
      console.log('   Sample - Wind Direction:', data.hourly.wind_direction_10m?.[0], '°');
    }
    console.log('');
    
    // Test 3: Regular Forecast API with ECMWF
    console.log('3️⃣ Regular Forecast API with ECMWF:');
    const ecmwfUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m&models=ecmwf_ifs04&forecast_days=1`;
    
    return fetch(ecmwfUrl);
  })
  .then(res => res.json())
  .then(data => {
    console.log('   ✅ Success');
    console.log('   Models:', data.models || []);
    console.log('   Time points:', data.hourly?.time?.length || 0);
    if (data.hourly?.time?.length > 0) {
      console.log('   Sample - Wind Speed:', data.hourly.wind_speed_10m?.[0], 'm/s');
      console.log('   Sample - Wind Direction:', data.hourly.wind_direction_10m?.[0], '°');
    }
    console.log('');
    console.log('💡 Summary:');
    console.log('   - Marine API: ECMWF (default, includes waves)');
    console.log('   - Forecast API: Can specify GFS or ECMWF (wind data)');
    console.log('   - For complete data: Use both APIs or check if marine API supports model selection');
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });


