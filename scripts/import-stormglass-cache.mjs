#!/usr/bin/env node
/**
 * Import Stormglass cached data into weather_forecasts table
 *
 * Usage:
 *   node scripts/import-stormglass-cache.mjs
 *   node scripts/import-stormglass-cache.mjs --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const CACHE_FILE = path.join(__dirname, '../data/stormglass-cache.json');
const AREA_ID = '015f97cc-b465-4133-aa3a-4156a9ec933c'; // Mid to A

// Stormglass field mappings to our DB columns
const FIELD_MAP = {
  waveHeight: 'wave_height',
  waveDirection: 'wave_direction',
  wavePeriod: 'wave_period',
  swellHeight: 'swell_wave_height',
  swellDirection: 'swell_wave_direction',
  swellPeriod: 'swell_wave_period',
  secondarySwellHeight: 'secondary_swell_height',
  secondarySwellDirection: 'secondary_swell_direction',
  secondarySwellPeriod: 'secondary_swell_period',
  windWaveHeight: 'wind_wave_height',
  windWaveDirection: 'wind_wave_direction',
  windWavePeriod: 'wind_wave_period',
  currentSpeed: 'current_speed',
  currentDirection: 'current_direction',
  waterTemperature: 'sea_surface_temperature',
  seaLevel: 'sea_level',
  airTemperature: 'temperature_2m',
  pressure: 'pressure_msl',
  humidity: 'relative_humidity_2m',
  cloudCover: 'cloud_cover',
  precipitation: 'precipitation',
  visibility: 'visibility',
  windSpeed: 'wind_speed_10m',
  windDirection: 'wind_direction_10m',
  gust: 'wind_gusts_10m',
};

// Sources we want to import (skip duplicates like ecmwf:aifs)
const SOURCES_TO_IMPORT = ['sg', 'noaa', 'ecmwf', 'meteo', 'meto'];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('📥 Stormglass Cache Importer');
  console.log('=' .repeat(60));

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - no data will be written\n');
  }

  // Load cache
  if (!fs.existsSync(CACHE_FILE)) {
    console.error('❌ Cache file not found:', CACHE_FILE);
    console.error('   Run test-stormglass.mjs first to fetch data');
    process.exit(1);
  }

  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  console.log(`📅 Cache from: ${cache.fetched_at}`);
  console.log(`📍 Location: ${cache.location.name}`);
  console.log(`📊 Hours in cache: ${cache.response.hours.length}\n`);

  // Connect to Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY required in .env');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Transform to DB records
  const records = [];
  const fetchedAt = cache.fetched_at;

  for (const hour of cache.response.hours) {
    const forecastTime = hour.time;

    // For each source, create a separate record
    for (const source of SOURCES_TO_IMPORT) {
      const record = {
        area_id: AREA_ID,
        forecast_time: forecastTime,
        fetched_at: fetchedAt,
        data_source: 'stormglass',
        model_name: source,
      };

      // Map each field if this source has data for it
      let hasData = false;
      for (const [sgField, dbField] of Object.entries(FIELD_MAP)) {
        const fieldData = hour[sgField];
        if (fieldData && fieldData[source] !== undefined) {
          record[dbField] = fieldData[source];
          hasData = true;
        }
      }

      // Only add record if it has at least some data
      if (hasData) {
        records.push(record);
      }
    }
  }

  console.log(`📝 Records to insert: ${records.length}`);
  console.log(`   (${cache.response.hours.length} hours × ${SOURCES_TO_IMPORT.length} sources, minus empty)\n`);

  // Show sample record
  console.log('📋 Sample record:');
  console.log(JSON.stringify(records[0], null, 2));
  console.log();

  if (dryRun) {
    console.log('🔍 Dry run complete. Use without --dry-run to insert.');
    return;
  }

  // Insert in batches
  const BATCH_SIZE = 100;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from('weather_forecasts')
      .upsert(batch, {
        onConflict: 'area_id,forecast_time,data_source,model_name',
        ignoreDuplicates: false
      });

    if (error) {
      console.error(`❌ Batch ${Math.floor(i/BATCH_SIZE) + 1} failed:`, error.message);
      errors++;
    } else {
      inserted += batch.length;
      process.stdout.write(`\r✅ Inserted: ${inserted}/${records.length}`);
    }
  }

  console.log('\n');
  console.log('=' .repeat(60));
  console.log(`✅ Import complete: ${inserted} records inserted, ${errors} batch errors`);
}

main().catch(console.error);
