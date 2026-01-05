#!/usr/bin/env node
/**
 * Stormglass API Test Script
 * Pulls ALL available marine and weather parameters for a given location
 * Caches responses to avoid wasting free tier quota (10 requests/day)
 *
 * Usage:
 *   STORMGLASS_API_KEY=your_key node scripts/test-stormglass.mjs
 *
 * Options:
 *   --force    Force fresh API call (ignore cache)
 *   --cache    Show cached data only (no API call)
 *
 * Get your free API key at: https://stormglass.io/register
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '../data/stormglass-cache.json');
const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

const LAT = 16.7730;
const LNG = -61.7322;
const LOCATION_NAME = 'Mid to A - Guadeloupe';

// All available parameters
const ALL_PARAMS = [
  // Marine / Wave
  'waveHeight',
  'waveDirection',
  'wavePeriod',
  'swellHeight',
  'swellDirection',
  'swellPeriod',
  'secondarySwellHeight',
  'secondarySwellDirection',
  'secondarySwellPeriod',
  'windWaveHeight',
  'windWaveDirection',
  'windWavePeriod',

  // Currents
  'currentSpeed',
  'currentDirection',

  // Water
  'waterTemperature',
  'seaLevel',

  // Atmospheric
  'airTemperature',
  'pressure',
  'humidity',
  'cloudCover',
  'precipitation',
  'visibility',
  'gust',
  'windSpeed',
  'windDirection',
];

// Available data sources from Stormglass
const SOURCES = {
  'sg': 'Stormglass AI blend',
  'noaa': 'NOAA GFS',
  'meteo': 'Météo France',
  'meto': 'UK Met Office',
  'dwd': 'German DWD (ICON)',
  'yr': 'Norwegian Met',
  'smhi': 'Swedish Met',
  'fcoo': 'Danish Defence',
  'fmi': 'Finnish Met',
};

function ensureDataDir() {
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      return cached;
    }
  } catch (e) {
    console.warn('Warning: Could not load cache:', e.message);
  }
  return null;
}

function saveCache(data, quotaInfo) {
  ensureDataDir();
  const cacheData = {
    fetched_at: new Date().toISOString(),
    location: { lat: LAT, lng: LNG, name: LOCATION_NAME },
    quota: quotaInfo,
    response: data,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
  console.log(`\n💾 Cached to: ${CACHE_FILE}`);
  return cacheData;
}

function isCacheValid(cached) {
  if (!cached || !cached.fetched_at) return false;
  const age = Date.now() - new Date(cached.fetched_at).getTime();
  return age < CACHE_MAX_AGE_MS;
}

async function fetchStormglass() {
  const apiKey = process.env.STORMGLASS_API_KEY;

  if (!apiKey) {
    console.error('\n❌ STORMGLASS_API_KEY not set!');
    console.error('\nTo get a free API key:');
    console.error('  1. Go to https://stormglass.io/register');
    console.error('  2. Create an account');
    console.error('  3. Copy your API key from the dashboard');
    console.error('\nThen run:');
    console.error('  STORMGLASS_API_KEY=your_key_here node scripts/test-stormglass.mjs\n');
    process.exit(1);
  }

  const params = ALL_PARAMS.join(',');
  const url = `https://api.stormglass.io/v2/weather/point?lat=${LAT}&lng=${LNG}&params=${params}`;

  console.log(`\n🌊 Fetching from Stormglass API...`);
  console.log(`📍 Location: ${LOCATION_NAME}`);
  console.log(`🌐 Coordinates: ${LAT}, ${LNG}`);
  console.log(`📊 Requesting ${ALL_PARAMS.length} parameters...\n`);

  const response = await fetch(url, {
    headers: {
      'Authorization': apiKey
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ API Error: ${response.status}`);
    console.error(errorText);

    if (response.status === 402) {
      console.error('\n💡 You may have exceeded your free tier quota (10 requests/day).');
    }
    process.exit(1);
  }

  const data = await response.json();

  // Get quota info from headers
  const quotaInfo = {
    remaining: response.headers.get('x-ratelimit-remaining'),
    limit: response.headers.get('x-ratelimit-limit'),
  };

  if (quotaInfo.remaining && quotaInfo.limit) {
    console.log(`📈 API Quota: ${quotaInfo.remaining}/${quotaInfo.limit} requests remaining today\n`);
  }

  return { data, quotaInfo };
}

function analyzeData(cached) {
  const data = cached.response;

  console.log(`\n📅 Data fetched at: ${cached.fetched_at}`);
  if (cached.quota?.remaining) {
    console.log(`📈 Quota at fetch time: ${cached.quota.remaining}/${cached.quota.limit} remaining`);
  }

  if (!data.hours || data.hours.length === 0) {
    console.error('❌ No hourly data in cache');
    return;
  }

  console.log(`✅ ${data.hours.length} hourly forecasts in cache\n`);

  // Get current hour (or closest)
  const now = new Date();
  const currentHour = data.hours.find(h => {
    const hourTime = new Date(h.time);
    return hourTime >= now;
  }) || data.hours[0];

  console.log(`📅 Current/Next Hour: ${currentHour.time}\n`);
  console.log('='.repeat(80));

  // Group parameters by category
  const categories = {
    'WAVE DATA': ['waveHeight', 'waveDirection', 'wavePeriod'],
    'SWELL': ['swellHeight', 'swellDirection', 'swellPeriod'],
    'SECONDARY SWELL': ['secondarySwellHeight', 'secondarySwellDirection', 'secondarySwellPeriod'],
    'WIND WAVES': ['windWaveHeight', 'windWaveDirection', 'windWavePeriod'],
    'CURRENTS': ['currentSpeed', 'currentDirection'],
    'WATER': ['waterTemperature', 'seaLevel'],
    'WIND': ['windSpeed', 'windDirection', 'gust'],
    'ATMOSPHERE': ['airTemperature', 'pressure', 'humidity', 'cloudCover', 'precipitation', 'visibility'],
  };

  for (const [category, params] of Object.entries(categories)) {
    console.log(`\n📊 ${category}`);
    console.log('-'.repeat(80));

    for (const param of params) {
      const paramData = currentHour[param];

      if (!paramData) {
        console.log(`  ${param}: (no data)`);
        continue;
      }

      // paramData is an object { source: value, source2: value2, ... }
      if (typeof paramData === 'object' && !Array.isArray(paramData)) {
        const entries = Object.entries(paramData);
        console.log(`  ${param}:`);
        entries.forEach(([source, value]) => {
          console.log(`    ${source}: ${formatValue(param, value)}`);
        });

        // Show spread if multiple sources
        if (entries.length > 1) {
          const nums = entries.map(([, v]) => v).filter(v => typeof v === 'number');
          if (nums.length > 1) {
            const min = Math.min(...nums);
            const max = Math.max(...nums);
            const spread = max - min;
            console.log(`    → Spread: ${formatValue(param, spread)} (min: ${formatValue(param, min)}, max: ${formatValue(param, max)})`);
          }
        }
      } else {
        console.log(`  ${param}: ${formatValue(param, paramData)}`);
      }
    }
  }

  // Summary comparison table for key wave metrics
  console.log('\n');
  console.log('='.repeat(80));
  console.log('📋 SOURCE COMPARISON - Wave Height (significant)');
  console.log('='.repeat(80));

  const waveData = currentHour.waveHeight;
  if (waveData && typeof waveData === 'object') {
    console.log('\n  Source          | Wave Height (m) | Description');
    console.log('  ----------------|-----------------|---------------------------');
    Object.entries(waveData).forEach(([source, value]) => {
      const sourcePadded = source.padEnd(15);
      const valuePadded = (value?.toFixed(2) || 'N/A').padEnd(15);
      const desc = SOURCES[source] || source;
      console.log(`  ${sourcePadded} | ${valuePadded} | ${desc}`);
    });
  }

  // Show Wednesday forecast for comparison with Meteoblue/Open-Meteo
  console.log('\n');
  console.log('='.repeat(80));
  console.log('📅 WEDNESDAY JAN 8 FORECAST (for comparison with Meteoblue/Open-Meteo)');
  console.log('='.repeat(80));

  const wednesday = data.hours.filter(h => {
    const d = new Date(h.time);
    return d.toISOString().startsWith('2026-01-08');
  });

  if (wednesday.length > 0) {
    console.log('\n  Time (UTC) | SG Wave | NOAA    | ECMWF   | Meteo   | Swell   | Wind Wave');
    console.log('  -----------|---------|---------|---------|---------|---------|----------');

    // Show every 3 hours
    wednesday.filter((_, i) => i % 3 === 0).forEach(hour => {
      const time = new Date(hour.time).toISOString().slice(11, 16);
      const sgWave = hour.waveHeight?.sg;
      const noaaWave = hour.waveHeight?.noaa;
      const ecmwfWave = hour.waveHeight?.ecmwf;
      const meteoWave = hour.waveHeight?.meteo;
      const swell = hour.swellHeight?.sg;
      const windWave = hour.windWaveHeight?.sg;

      console.log(`  ${time}      | ${fmt(sgWave)} | ${fmt(noaaWave)} | ${fmt(ecmwfWave)} | ${fmt(meteoWave)} | ${fmt(swell)} | ${fmt(windWave)}`);
    });

    console.log('\n  Compare with your data:');
    console.log('  - Open-Meteo Marine: ~0.98m');
    console.log('  - Meteoblue surfwave_height: ~2.25m');
    console.log('  - Meteoblue significant_wave_height: ~1.67m');
  } else {
    console.log('\n  (No Wednesday data in cache - may need fresh fetch)');
  }
}

function fmt(val) {
  return (val?.toFixed(2) || 'N/A').padEnd(7);
}

function formatValue(param, value) {
  if (value === null || value === undefined) return 'N/A';

  const units = {
    waveHeight: 'm',
    swellHeight: 'm',
    secondarySwellHeight: 'm',
    windWaveHeight: 'm',
    waveDirection: '°',
    swellDirection: '°',
    secondarySwellDirection: '°',
    windWaveDirection: '°',
    wavePeriod: 's',
    swellPeriod: 's',
    secondarySwellPeriod: 's',
    windWavePeriod: 's',
    currentSpeed: 'm/s',
    currentDirection: '°',
    waterTemperature: '°C',
    seaLevel: 'm',
    windSpeed: 'm/s',
    windDirection: '°',
    gust: 'm/s',
    airTemperature: '°C',
    pressure: 'hPa',
    humidity: '%',
    cloudCover: '%',
    precipitation: 'mm/h',
    visibility: 'km',
  };

  const unit = units[param] || '';

  if (typeof value === 'number') {
    return `${value.toFixed(2)}${unit}`;
  }
  return `${value}${unit}`;
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const forceRefresh = args.includes('--force');
  const cacheOnly = args.includes('--cache');

  console.log(`\n🌊 Stormglass API Test`);
  console.log(`📍 Location: ${LOCATION_NAME}`);
  console.log(`🌐 Coordinates: ${LAT}, ${LNG}`);

  // Check cache
  const cached = loadCache();

  if (cacheOnly) {
    if (!cached) {
      console.error('\n❌ No cache found. Run without --cache first.');
      process.exit(1);
    }
    console.log('\n📂 Using cached data (--cache flag)');
    analyzeData(cached);
    console.log('\n✅ Done!\n');
    return;
  }

  if (cached && isCacheValid(cached) && !forceRefresh) {
    const age = Math.round((Date.now() - new Date(cached.fetched_at).getTime()) / 60000);
    console.log(`\n📂 Using cached data (${age} minutes old)`);
    console.log('   Use --force to fetch fresh data');
    analyzeData(cached);
    console.log('\n✅ Done!\n');
    return;
  }

  if (cached && !forceRefresh) {
    const age = Math.round((Date.now() - new Date(cached.fetched_at).getTime()) / 60000);
    console.log(`\n⚠️  Cache is ${age} minutes old (max: 60 min)`);
  }

  // Fetch fresh data
  console.log('\n🌐 Fetching fresh data from Stormglass...');
  console.log('   (This uses 1 of your 10 daily free requests)\n');

  const { data, quotaInfo } = await fetchStormglass();
  const newCache = saveCache(data, quotaInfo);

  analyzeData(newCache);

  console.log('\n✅ Done!\n');
}

main().catch(console.error);
