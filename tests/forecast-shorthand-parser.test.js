/**
 * Unit tests for forecast-shorthand-parser.js
 * Run with: node --test tests/forecast-shorthand-parser.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDateToken,
  resolveDateRange,
  parseDirection,
  parseSpeedRange,
  parseSeasInline,
  parseSwellEntry,
  parseWindBlock,
  parseSwellBlock,
  parsePrecipBlock,
  mergeByDate,
  normalizeSection,
} from '../src/services/forecast-shorthand-parser.js';

// ==================== resolveDateRange ====================

describe('resolveDateRange', () => {
  it('same-month range', () => {
    const result = resolveDateRange(25, 27, '2026-02-25');
    assert.deepEqual(result, ['2026-02-25', '2026-02-26', '2026-02-27']);
  });

  it('month rollover (Feb → Mar)', () => {
    const result = resolveDateRange(28, 2, '2026-02-25');
    assert.deepEqual(result, ['2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('Jan to Feb rollover', () => {
    const result = resolveDateRange(31, 2, '2026-01-28');
    assert.deepEqual(result, ['2026-01-31', '2026-02-01', '2026-02-02']);
  });

  it('Feb 30 throws overflow error', () => {
    assert.throws(
      () => resolveDateRange(30, 1, '2026-02-25'),
      /does not exist in month/,
    );
  });

  it('single day (start === end)', () => {
    const result = resolveDateRange(25, 25, '2026-02-25');
    assert.deepEqual(result, ['2026-02-25']);
  });
});

// ==================== resolveDateToken ====================

describe('resolveDateToken', () => {
  it('"today" returns primary date', () => {
    assert.deepEqual(resolveDateToken('today', '2026-02-25'), ['2026-02-25']);
  });

  it('"tonight" returns primary date', () => {
    assert.deepEqual(resolveDateToken('tonight', '2026-02-25'), ['2026-02-25']);
  });

  it('single day token "Fri28"', () => {
    assert.deepEqual(resolveDateToken('Fri28', '2026-02-25'), ['2026-02-28']);
  });

  it('range token "Tue25-Wed26"', () => {
    assert.deepEqual(resolveDateToken('Tue25-Wed26', '2026-02-25'), ['2026-02-25', '2026-02-26']);
  });

  it('"late Fri28" returns single date', () => {
    assert.deepEqual(resolveDateToken('late Fri28', '2026-02-25'), ['2026-02-28']);
  });

  it('null token returns primary date', () => {
    assert.deepEqual(resolveDateToken(null, '2026-02-25'), ['2026-02-25']);
  });
});

// ==================== parseDirection ====================

describe('parseDirection', () => {
  it('simple direction', () => {
    assert.equal(parseDirection('ESE'), 'ESE');
  });

  it('L&V → VAR', () => {
    assert.equal(parseDirection('L&V'), 'VAR');
  });

  it('Variable mostly E → E', () => {
    assert.equal(parseDirection('Variable mostly E'), 'E');
  });

  it('E-SE range → E (primary)', () => {
    assert.equal(parseDirection('E-SE'), 'E');
  });

  it('null input', () => {
    assert.equal(parseDirection(null), null);
  });
});

// ==================== parseSpeedRange ====================

describe('parseSpeedRange', () => {
  it('standard range @12-18', () => {
    const result = parseSpeedRange('@12-18');
    assert.deepEqual(result.range_kt, [12, 18]);
    assert.equal(result.gust_kt, null);
  });

  it('range with gust 15-20g28k', () => {
    const result = parseSpeedRange('15-20g28k');
    assert.deepEqual(result.range_kt, [15, 20]);
    assert.equal(result.gust_kt, 28);
  });

  it('up to pattern', () => {
    const result = parseSpeedRange('up to 15');
    assert.deepEqual(result.range_kt, [0, 15]);
  });

  it('under pattern', () => {
    const result = parseSpeedRange('under 10');
    assert.deepEqual(result.range_kt, [0, 10]);
  });
});

// ==================== parseSeasInline ====================

describe('parseSeasInline', () => {
  it('range /4-6\'', () => {
    assert.deepEqual(parseSeasInline("/4-6'"), [4, 6]);
  });

  it('single /5\'', () => {
    assert.deepEqual(parseSeasInline("/5'"), [5, 5]);
  });

  it('no seas', () => {
    assert.equal(parseSeasInline('ESE@12-18'), null);
  });
});

// ==================== parseSwellEntry ====================

describe('parseSwellEntry', () => {
  it('single swell with height and period', () => {
    const result = parseSwellEntry("4-6'/8secE");
    assert.equal(result.length, 1);
    assert.equal(result[0].dir, 'E');
    assert.deepEqual(result[0].ft, [4, 6]);
    assert.deepEqual(result[0].period_s, [8, 8]);
  });

  it('multi-swell with &', () => {
    const result = parseSwellEntry("4-6'/8secE & 13secNNW");
    assert.equal(result.length, 2);
    assert.equal(result[0].dir, 'E');
    assert.deepEqual(result[0].ft, [4, 6]);
    assert.equal(result[1].dir, 'NNW');
    assert.equal(result[1].ft, null); // no height for secondary
    assert.deepEqual(result[1].period_s, [13, 13]);
  });

  it('period range', () => {
    const result = parseSwellEntry("3-5'/7-10secENE");
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].period_s, [7, 10]);
  });

  it('empty string returns empty array', () => {
    assert.deepEqual(parseSwellEntry(''), []);
  });
});

// ==================== parseWindBlock ====================

describe('parseWindBlock', () => {
  it('parses real MWXC wind block', () => {
    const block = "ESE@12-18g22k/4-6' Tue25; E-SE@15-20g28k/5-7' Wed26";
    const result = parseWindBlock(block, '2026-02-25');
    assert.equal(result.length, 2);
    assert.equal(result[0].wind.dir, 'ESE');
    assert.deepEqual(result[0].wind.range_kt, [12, 18]);
    assert.equal(result[0].wind.gust_kt, 22);
    assert.deepEqual(result[0].seas_ft, [4, 6]);
    assert.deepEqual(result[0].dates, ['2026-02-25']);
  });

  it('handles L&V', () => {
    const block = "L&V/2-3' today";
    const result = parseWindBlock(block, '2026-02-25');
    assert.equal(result.length, 1);
    assert.equal(result[0].wind.dir, 'VAR');
  });

  it('handles < transition (takes first part)', () => {
    const block = "ESE@12-18/4-6' < E@15-20/5-7' Tue25";
    const result = parseWindBlock(block, '2026-02-25');
    assert.equal(result.length, 1);
    assert.equal(result[0].wind.dir, 'ESE');
  });
});

// ==================== parsePrecipBlock ====================

describe('parsePrecipBlock', () => {
  it('parses precip keywords', () => {
    const block = "Isolated shwrs Tue25; Scattered shwrs Wed26";
    const result = parsePrecipBlock(block, '2026-02-25');
    assert.equal(result.length, 2);
    assert.ok(result[0].precipitation.includes('Isolated'));
    assert.ok(result[1].precipitation.includes('Scattered'));
  });

  it('dry conditions', () => {
    const block = "Mostly dry Tue25";
    const result = parsePrecipBlock(block, '2026-02-25');
    assert.equal(result.length, 1);
    assert.ok(result[0].precipitation.includes('Mostly dry'));
  });
});

// ==================== normalizeSection (integration) ====================

describe('normalizeSection', () => {
  it('parses a complete section with all blocks', () => {
    const section = {
      section_name: 'Antigua-StMartin',
      lat_range: [16.5, 18.5],
      lon_range: [-63.5, -61.0],
      wind_block: "ESE@12-18g22k/4-6' Tue25; E-SE@15-20g28k/5-7' Wed26",
      seas_block: "4-6'/8secE Tue25; 5-7'/8-10secE Wed26",
      precip_block: "Isolated shwrs Tue25; Scattered shwrs Wed26",
      suggest_block: "W-NW bound sailing: moderate conditions expected",
    };

    const result = normalizeSection(section, '2026-02-25');
    assert.equal(result.section_id, 'antigua-stmartin');
    assert.equal(result.section_name, 'Antigua-StMartin');
    assert.ok(result.days.length >= 2);

    // Swell should be an array
    const day1 = result.days[0];
    assert.ok(Array.isArray(day1.swell), 'swell should be an array');
  });

  it('throws on null section', () => {
    assert.throws(() => normalizeSection(null, '2026-02-25'), /null/);
  });

  it('throws on missing primaryDate', () => {
    assert.throws(
      () => normalizeSection({ section_name: 'test', wind_block: 'E@10-15 today' }, null),
      /primaryDate/,
    );
  });
});
