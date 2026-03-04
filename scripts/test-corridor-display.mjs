#!/usr/bin/env node
/**
 * Test script: Corridor display data for weather-areas.html
 *
 * Extracts and displays:
 * 1. GENERAL COMMENTARY from latest structured email
 * 2. SUGGEST text per corridor (only corridors we care about)
 * 3. Trend comparison between two most recent emails' corridor_data
 *
 * Usage: node maintenance-agent/scripts/test-corridor-display.mjs
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ========== EXTRACTORS ==========

function extractGeneralCommentary(structuredText) {
  if (!structuredText) return null;
  const match = structuredText.match(
    /SECTION:\s*GENERAL COMMENTARY[^\n]*\n([\s\S]*?)(?=CORRIDOR:|$)/i
  );
  return match ? match[1].trim() : null;
}

function extractSuggest(structuredText, corridorName) {
  if (!structuredText || !corridorName) return null;
  const escaped = corridorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `CORRIDOR:\\s*${escaped}\\s*\\n[\\s\\S]*?SUGGEST:\\s*\\n?([\\s\\S]*?)(?=DATE:|CORRIDOR:|COMBINED SAILING|$)`,
    'i'
  );
  const match = structuredText.match(pattern);
  return match ? match[1].trim() : null;
}

// ========== TREND COMPARISON ==========

function compareCorridor(todayData, yesterdayData, corridorName) {
  const today = todayData?.[corridorName]?.dates;
  const yesterday = yesterdayData?.[corridorName]?.dates;

  if (!today || !yesterday) return null;

  // Find overlapping dates
  const todayByDate = {};
  for (const d of today) todayByDate[d.date] = d;

  const yesterdayByDate = {};
  for (const d of yesterday) yesterdayByDate[d.date] = d;

  const overlapping = Object.keys(todayByDate).filter(d => yesterdayByDate[d]);
  if (overlapping.length === 0) return null;

  const trends = [];

  // Compare wind across overlapping dates
  const windChanges = overlapping.map(d => {
    const tHigh = todayByDate[d].wind?.range_kt?.[1];
    const yHigh = yesterdayByDate[d].wind?.range_kt?.[1];
    if (tHigh != null && yHigh != null) return tHigh - yHigh;
    return 0;
  });
  const avgWindChange = windChanges.reduce((a, b) => a + b, 0) / windChanges.length;

  if (Math.abs(avgWindChange) >= 2) {
    const dir = avgWindChange > 0 ? 'increasing' : 'decreasing';
    trends.push(`Wind ${dir} by ~${Math.abs(Math.round(avgWindChange))}kt vs yesterday's forecast`);
  } else {
    trends.push('Wind forecast largely unchanged');
  }

  // Compare seas
  const seasChanges = overlapping.map(d => {
    const t = todayByDate[d].seas_ft;
    const y = yesterdayByDate[d].seas_ft;
    if (t != null && y != null) return t - y;
    return 0;
  });
  const avgSeasChange = seasChanges.reduce((a, b) => a + b, 0) / seasChanges.length;

  if (Math.abs(avgSeasChange) >= 1) {
    const dir = avgSeasChange > 0 ? 'building' : 'dropping';
    trends.push(`Seas ${dir} by ~${Math.abs(Math.round(avgSeasChange))}ft`);
  } else {
    trends.push('Seas forecast steady');
  }

  // Compare swell
  const swellChanges = overlapping.map(d => {
    const t = todayByDate[d].swell?.[0]?.ft;
    const y = yesterdayByDate[d].swell?.[0]?.ft;
    if (t != null && y != null) return t - y;
    return 0;
  });
  const avgSwellChange = swellChanges.reduce((a, b) => a + b, 0) / swellChanges.length;

  if (Math.abs(avgSwellChange) >= 1) {
    const dir = avgSwellChange > 0 ? 'building' : 'easing';
    trends.push(`Swell ${dir} by ~${Math.abs(Math.round(avgSwellChange))}ft`);
  } else {
    trends.push('Swell forecast unchanged');
  }

  // Check for gust changes
  const gustChanges = overlapping.map(d => {
    const t = todayByDate[d].wind?.gust_kt;
    const y = yesterdayByDate[d].wind?.gust_kt;
    if (t != null && y != null) return t - y;
    return 0;
  });
  const avgGustChange = gustChanges.reduce((a, b) => a + b, 0) / gustChanges.length;

  if (Math.abs(avgGustChange) >= 3) {
    const dir = avgGustChange > 0 ? 'higher' : 'lower';
    trends.push(`Gusts trending ${dir} (~${Math.abs(Math.round(avgGustChange))}kt)`);
  }

  return {
    overlappingDates: overlapping.length,
    trends,
  };
}

// ========== MAIN ==========

async function main() {
  // Get two most recent emails with corridor_data
  const { data: emails, error } = await supabase
    .from('weather_forecast_emails')
    .select('id, subject, received_at, structured_forecast, corridor_data, corridors_included')
    .not('corridor_data', 'is', null)
    .not('corridors_included', 'is', null)
    .order('received_at', { ascending: false })
    .limit(2);

  if (error) {
    console.error('DB error:', error.message);
    process.exit(1);
  }

  if (emails.length === 0) {
    console.log('No emails with corridor_data found.');
    process.exit(0);
  }

  const latest = emails[0];
  const previous = emails[1] || null;
  const corridors = latest.corridors_included;

  console.log('='.repeat(70));
  console.log(`Latest email: ${latest.subject} (${latest.received_at.substring(0, 10)})`);
  if (previous) {
    console.log(`Previous email: ${previous.subject} (${previous.received_at.substring(0, 10)})`);
  }
  console.log(`Corridors we care about: ${corridors.join(', ')}`);
  console.log('='.repeat(70));

  // 1. GENERAL COMMENTARY
  console.log('\n--- GENERAL COMMENTARY ---\n');
  const commentary = extractGeneralCommentary(latest.structured_forecast);
  if (commentary) {
    console.log(commentary);
  } else {
    console.log('(not found)');
  }

  // 2. SUGGEST per corridor + 3. Trend
  for (const corridor of corridors) {
    console.log(`\n--- CORRIDOR: ${corridor} ---\n`);

    const suggest = extractSuggest(latest.structured_forecast, corridor);
    if (suggest) {
      console.log('SUGGEST:');
      console.log(suggest);
    } else {
      console.log('SUGGEST: (not found)');
    }

    if (previous) {
      console.log('\nTREND vs yesterday:');
      const trend = compareCorridor(latest.corridor_data, previous.corridor_data, corridor);
      if (trend) {
        trend.trends.forEach(t => console.log(`  • ${t}`));
        console.log(`  (compared ${trend.overlappingDates} overlapping dates)`);
      } else {
        console.log('  (no comparison data available)');
      }
    } else {
      console.log('\nTREND: (no previous email to compare)');
    }
  }

  console.log('\n' + '='.repeat(70));
}

main();
