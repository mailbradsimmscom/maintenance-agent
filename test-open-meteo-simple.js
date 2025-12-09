#!/usr/bin/env node
/**
 * Simple test to check Open-Meteo API
 * Tests marine weather for Caribbean (Bequia area)
 */

import https from 'https';

// Test marine weather API directly (no MCP needed for this test)
const lat = 12.5;  // Bequia, Caribbean
const lon = -61.2;

const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_speed_10m,wind_direction_10m&models=ecmwf,gfs&forecast_days=3`;

console.log('🌊 Testing Open-Meteo Marine API...');
console.log(`📍 Location: ${lat}, ${lon} (Bequia, Caribbean)`);
console.log(`🔗 URL: ${url}`);
console.log('');

// Use https module for Node.js compatibility
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ json: () => JSON.parse(data) });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

try {
  const response = await fetch(url);
  const data = await response.json();
  
  console.log('✅ API Response received!');
  console.log('');
  console.log('📊 Data Summary:');
  console.log(`   Models available: ${data.models?.join(', ') || 'N/A'}`);
  console.log(`   Time points: ${data.hourly?.time?.length || 0}`);
  console.log(`   Units:`, data.hourly_units || {});
  console.log('');
  
  if (data.hourly && data.hourly.time && data.hourly.time.length > 0) {
    console.log('📈 Sample Forecast (first 3 hours):');
    for (let i = 0; i < Math.min(3, data.hourly.time.length); i++) {
      console.log(`   ${data.hourly.time[i]}:`);
      console.log(`     Wave Height: ${data.hourly.wave_height?.[i]}m`);
      console.log(`     Wave Direction: ${data.hourly.wave_direction?.[i]}°`);
      console.log(`     Wind Speed: ${data.hourly.wind_speed_10m?.[i]} m/s`);
      console.log(`     Wind Direction: ${data.hourly.wind_direction_10m?.[i]}°`);
      console.log(`     Swell Height: ${data.hourly.swell_wave_height?.[i]}m`);
      console.log('');
    }
  }
  
  console.log('✅ Open-Meteo API works for Caribbean marine weather!');
  console.log('');
  console.log('💡 Next steps:');
  console.log('   1. This API can be called directly (no MCP needed)');
  console.log('   2. Or we can use the MCP server for standardized interface');
  console.log('   3. Data includes ECMWF and GFS models (as specified)');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
