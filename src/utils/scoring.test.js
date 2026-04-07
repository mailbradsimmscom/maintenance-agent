/**
 * Golden Scoring Tests
 * Fixture-based tests verifying scoring.js produces expected results.
 *
 * Parity target: src/public/weather-area-view.html scoreTimeBlock() (lines 581-701)
 *
 * These fixtures serve as the parity contract between the server-side scoring.js
 * and the frontend scoreTimeBlock(). The expected values are hand-calculated from
 * the shared algorithm spec. If the frontend scoring changes, these fixtures must
 * be updated to match, and vice versa.
 *
 * To verify frontend parity manually: paste a fixture's inputs into the browser
 * console and compare scoreTimeBlock() output against the expected values here.
 *
 * Run: node --test src/utils/scoring.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreWaypoint, calculateOverallScore, getWeatherAtTime } from './scoring.js';

// ========== GOLDEN FIXTURES ==========
// Each fixture has known inputs and hand-calculated expected scores.
// Wind: 35pts — ≤15kt=35, 15-25kt linear→0, ≥25kt=0
// Wave+Period: 35pts — effectiveWave ≤1.5m=35, 1.5-2.5m linear→0, ≥2.5m=0
// Sea Dir: 15pts — Reaching=15, Broad Reach=13, Beam=10, Close Hauled=7, Opposing=5
// Current: 15pts — Following=15, None=8, Opposing=0

const fixtures = [
  {
    name: 'Perfect conditions — light wind, small waves, following current',
    input: {
      windSpeedKmh: 20,       // 10.8kt → ≤15 → 35
      waveHeight: 0.8,
      swellHeight: 0.5,
      windWaveHeight: 0.6,    // calcWave = sqrt(0.25+0.36) = 0.781
      wavePeriod: 9,          // effectiveWave = 0.781 * sqrt(7/9) = 0.688 → ≤1.5 → 35
      swellDirection: 180,
      currentSpeed: null,
      currentDirection: null,
      sailingBearing: 0,      // swell travel = (180+180)%360 = 0, angle = |0-0| = 0 → Reaching → 15
    },
    expected: {
      windScore: 35,
      waveScore: 35,
      seaDirScore: 15,
      currentScore: 8,        // null current → None → 8
      score: 93,
    },
  },
  {
    name: 'Moderate wind at 20kt',
    input: {
      windSpeedKmh: 37.04,    // 20kt → linear: 35*(1-(20-15)/10) = 35*0.5 = 17.5
      waveHeight: 1.5,
      swellHeight: null,
      windWaveHeight: null,
      wavePeriod: 7,          // effectiveWave = 1.5 * sqrt(7/7) = 1.5 → boundary → 35
      swellDirection: null,
      currentSpeed: null,
      currentDirection: null,
      sailingBearing: null,
    },
    expected: {
      windScore: 17.5,
      waveScore: 35,
      seaDirScore: 10,        // null swell dir → neutral → 10
      currentScore: 8,        // null → None → 8
      score: 70.5,
    },
  },
  {
    name: 'Strong wind 25kt+ — wind score = 0',
    input: {
      windSpeedKmh: 50,       // 27kt → ≥25 → 0
      waveHeight: 2.5,
      swellHeight: null,
      windWaveHeight: null,
      wavePeriod: 7,          // effectiveWave = 2.5 * 1.0 = 2.5 → boundary → 0
      swellDirection: 90,
      currentSpeed: 0.5,
      currentDirection: 180,
      sailingBearing: 0,      // swell travel = 270, angle = |0-270| → 90 → Beam → 10
                               // current angle = |0-180| = 180 → ≥120 → Opposing → 0
    },
    expected: {
      windScore: 0,
      waveScore: 0,
      seaDirScore: 10,
      currentScore: 0,
      score: 10,
    },
  },
  {
    name: 'Beam seas, opposing current',
    input: {
      windSpeedKmh: 27.78,    // 15kt → boundary → 35
      waveHeight: null,
      swellHeight: 1.0,
      windWaveHeight: 0.8,    // calcWave = sqrt(1+0.64) = 1.281
      wavePeriod: 6,          // effectiveWave = 1.281 * sqrt(7/6) = 1.281 * 1.0801 = 1.384 → ≤1.5 → 35
      swellDirection: 0,
      currentSpeed: 0.3,
      currentDirection: 180,
      sailingBearing: 0,      // swell travel = 180, angle = |0-180| = 180 → Opposing → 5
                               // current angle = |0-180| = 180 → Opposing → 0
    },
    expected: {
      windScore: 35,
      waveScore: 35,
      seaDirScore: 5,
      currentScore: 0,
      score: 75,
    },
  },
  {
    name: 'Mid-range everything — linear interpolation test',
    input: {
      windSpeedKmh: 37.04,    // 20kt → 35*(1-5/10) = 17.5
      waveHeight: null,
      swellHeight: 1.2,
      windWaveHeight: 1.0,    // calcWave = sqrt(1.44+1) = sqrt(2.44) = 1.562
      wavePeriod: 7,          // effectiveWave = 1.562 * 1.0 = 1.562 → 35*(1-(1.562-1.5)/1) = 35*0.938 = 32.83
      swellDirection: 45,
      currentSpeed: 0.4,
      currentDirection: 350,
      sailingBearing: 0,      // swell travel = 225, angle = |0-225| → 135 → Close Hauled → 7
                               // current angle = |0-350| = 10 → ≤60 → Following → 15
    },
    expected: {
      windScore: 17.5,
      waveScore: 32.8,        // 35*(1-0.062/1) = 32.83 → rounds to 32.8
      seaDirScore: 7,
      currentScore: 15,
      score: 72.3,
    },
  },
  {
    name: 'All null weather — neutral defaults',
    input: {
      windSpeedKmh: null,
      waveHeight: null,
      swellHeight: null,
      windWaveHeight: null,
      wavePeriod: null,
      swellDirection: null,
      currentSpeed: null,
      currentDirection: null,
      sailingBearing: null,
    },
    expected: {
      windScore: 35,
      waveScore: 35,
      seaDirScore: 10,
      currentScore: 8,
      score: 88,
    },
  },
  {
    name: 'Following seas — best sea direction score',
    input: {
      windSpeedKmh: 25,       // 13.5kt → ≤15 → 35
      waveHeight: 1.0,
      swellHeight: null,
      windWaveHeight: null,
      wavePeriod: 10,         // effectiveWave = 1.0 * sqrt(7/10) = 0.837 → ≤1.5 → 35
      swellDirection: 180,
      currentSpeed: 0.5,
      currentDirection: 0,
      sailingBearing: 0,      // swell travel = 0, angle = 0 → Reaching → 15
                               // current angle = 0 → Following → 15
    },
    expected: {
      windScore: 35,
      waveScore: 35,
      seaDirScore: 15,
      currentScore: 15,
      score: 100,
    },
  },
  {
    name: 'Close hauled seas',
    input: {
      windSpeedKmh: 30,       // 16.2kt → 35*(1-(16.2-15)/10) = 35*0.88 = 30.8
      waveHeight: 2.0,
      swellHeight: null,
      windWaveHeight: null,
      wavePeriod: 7,          // effectiveWave = 2.0 → 35*(1-(2.0-1.5)/1) = 35*0.5 = 17.5
      swellDirection: 315,
      currentSpeed: null,
      currentDirection: null,
      sailingBearing: 0,      // swell travel = (315+180)%360 = 135, angle = |0-135| = 135 → Close Hauled → 7
    },
    expected: {
      windScore: 30.8,
      waveScore: 17.5,
      seaDirScore: 7,
      currentScore: 8,
      score: 63.3,
    },
  },
];

// ========== TESTS ==========

describe('scoreWaypoint — golden fixtures', () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const result = scoreWaypoint(fixture.input);

      assert.equal(result.windScore, fixture.expected.windScore,
        `windScore: got ${result.windScore}, expected ${fixture.expected.windScore}`);
      assert.equal(result.waveScore, fixture.expected.waveScore,
        `waveScore: got ${result.waveScore}, expected ${fixture.expected.waveScore}`);
      assert.equal(result.seaDirScore, fixture.expected.seaDirScore,
        `seaDirScore: got ${result.seaDirScore}, expected ${fixture.expected.seaDirScore}`);
      assert.equal(result.currentScore, fixture.expected.currentScore,
        `currentScore: got ${result.currentScore}, expected ${fixture.expected.currentScore}`);
      assert.equal(result.score, fixture.expected.score,
        `total score: got ${result.score}, expected ${fixture.expected.score}`);
    });
  }
});

describe('calculateOverallScore', () => {
  it('weighted average with worst penalty', () => {
    const scores = [{ score: 80 }, { score: 60 }, { score: 70 }];
    // avg = 70, worst = 60 → 0.6*70 + 0.4*60 = 42+24 = 66
    assert.equal(calculateOverallScore(scores), 66);
  });

  it('single waypoint — avg equals worst', () => {
    const scores = [{ score: 85 }];
    // avg = 85, worst = 85 → 0.6*85 + 0.4*85 = 85
    assert.equal(calculateOverallScore(scores), 85);
  });

  it('empty array returns 0', () => {
    assert.equal(calculateOverallScore([]), 0);
  });
});

describe('getWeatherAtTime', () => {
  it('finds closest hourly slot', () => {
    const forecast = {
      hourly: {
        time: ['2026-04-07T10:00:00Z', '2026-04-07T11:00:00Z', '2026-04-07T12:00:00Z'],
        wind_speed_10m: [20, 25, 30],
        wind_direction_10m: [90, 100, 110],
        wind_gusts_10m: [30, 35, 40],
      }
    };
    const marine = {
      hourly: {
        time: ['2026-04-07T10:00:00Z', '2026-04-07T11:00:00Z', '2026-04-07T12:00:00Z'],
        wave_height: [1.0, 1.5, 2.0],
        wave_period: [7, 8, 9],
        swell_wave_height: [0.5, 0.8, 1.0],
        swell_wave_direction: [180, 190, 200],
        wind_wave_height: [0.6, 0.7, 0.8],
      }
    };

    // Target 11:20 should map to index 1 (closest to 11:00)
    const result = getWeatherAtTime(forecast, marine, '2026-04-07T11:20:00Z');
    assert.equal(result.windSpeedKmh, 25);
    assert.equal(result.waveHeight, 1.5);
    assert.equal(result.wavePeriod, 8);
    assert.equal(result.swellHeight, 0.8);
  });
});
