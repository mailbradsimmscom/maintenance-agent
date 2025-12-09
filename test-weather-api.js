/**
 * Simple test for Open-Meteo API
 */

const lat = 12.5;
const lon = -61.2;
// Marine API - test without models parameter first (it may not support it)
// Default model is usually ECMWF for marine API
const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction,wave_period,wind_speed_10m,wind_direction_10m,swell_wave_height,swell_wave_direction,swell_wave_period&forecast_days=3`;

console.log('Testing Open-Meteo API...');
console.log('URL:', url);
console.log('');

// Use node-fetch or built-in fetch (Node 18+)
if (typeof fetch === 'undefined') {
  console.error('Error: fetch not available. Node.js 18+ required or install node-fetch');
  process.exit(1);
}

fetch(url)
  .then(res => res.json())
  .then(data => {
    console.log('✅ Success!');
    console.log('Models:', data.models);
    console.log('Time points:', data.hourly?.time?.length || 0);
    if (data.hourly?.time?.length > 0) {
      console.log('First forecast time:', data.hourly.time[0]);
      console.log('Wave height:', data.hourly.wave_height?.[0]);
      console.log('Wind speed:', data.hourly.wind_speed_10m?.[0]);
    }
  })
  .catch(err => {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
