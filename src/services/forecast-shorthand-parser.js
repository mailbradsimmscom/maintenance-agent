/**
 * Forecast Shorthand Parser (v4)
 * Pure regex-based parser for MWXC meteorological shorthand DSL.
 * No I/O, no imports from services or repos — throws on failure, caller handles logging.
 *
 * DSL format: DIR@LO-HIgGUSTk/SEAS' DATE_TOKEN
 * Transitions: `<` operator separates segments within a day
 * Multi-swell: `&` joins swell components
 * Date tokens: Mon24, Tue25-Wed26, today, tonight
 */

// ==================== DATE PARSING ====================

const DAY_ABBREVS = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/**
 * Resolve a date token like "Fri28" or "Tue25-Wed26" into an array of YYYY-MM-DD strings.
 * @param {string} token - e.g. "Fri28", "Tue25-Wed26", "today", "tonight"
 * @param {string} primaryDate - YYYY-MM-DD of the email's primary date
 * @returns {string[]} array of date strings
 */
export function resolveDateToken(token, primaryDate) {
  if (!token || !primaryDate) return [primaryDate];

  const cleaned = token.trim().toLowerCase();

  // "today" or "tonight" → primary date
  if (cleaned === 'today' || cleaned === 'tonight') {
    return [primaryDate];
  }

  // "this morning" / "this afternoon"
  if (cleaned.startsWith('this ')) {
    return [primaryDate];
  }

  // Range: "Fri28-Sun02" or "late Fri28-Sun02"
  const rangeMatch = cleaned.match(/(?:late\s+|early\s+)?[a-z]{3}(\d{1,2})\s*-\s*[a-z]{3}(\d{1,2})/);
  if (rangeMatch) {
    const startDay = parseInt(rangeMatch[1], 10);
    const endDay = parseInt(rangeMatch[2], 10);
    return resolveDateRange(startDay, endDay, primaryDate);
  }

  // Single day: "Fri28", "late Fri28", "Fri28 night", "Fri28 morning"
  const singleMatch = cleaned.match(/(?:late\s+|early\s+)?[a-z]{3}(\d{1,2})/);
  if (singleMatch) {
    const day = parseInt(singleMatch[1], 10);
    return resolveDateRange(day, day, primaryDate);
  }

  // Fallback: return primary date
  return [primaryDate];
}

/**
 * Resolve a numeric day range into YYYY-MM-DD strings.
 * Handles month rollover. Throws on impossible dates (e.g. Feb 30).
 * @param {number} startDay - start day of month
 * @param {number} endDay - end day of month
 * @param {string} primaryDate - YYYY-MM-DD reference date
 * @returns {string[]}
 */
export function resolveDateRange(startDay, endDay, primaryDate) {
  const base = new Date(primaryDate + 'T12:00:00Z');
  const baseMonth = base.getUTCMonth();
  const baseYear = base.getUTCFullYear();

  let start = new Date(Date.UTC(baseYear, baseMonth, startDay, 12));

  // Overflow guard: setUTCDate silently overflows on short months (Feb 30 → Mar 2)
  if (start.getUTCMonth() !== baseMonth) {
    throw new Error(`Day ${startDay} does not exist in month ${baseMonth + 1} of ${baseYear}`);
  }

  // Future-bias: forecasts are forward-looking. If the resolved day is >1 day
  // before the primary date, it refers to next month (e.g. "Sat01" on Feb 25 = Mar 1)
  const diffDays = (base - start) / (1000 * 60 * 60 * 24);
  if (diffDays > 1) {
    start = new Date(Date.UTC(baseYear, baseMonth + 1, startDay, 12));
  }

  let end;
  if (endDay < startDay) {
    // Range crosses month boundary (e.g. 28-02 means 28th to 2nd of next month)
    end = new Date(Date.UTC(baseYear, baseMonth + 1, endDay, 12));
  } else {
    // Apply same future-bias to end date
    const endCandidate = new Date(Date.UTC(baseYear, baseMonth, endDay, 12));
    const endDiff = (base - endCandidate) / (1000 * 60 * 60 * 24);
    if (endDiff > 1) {
      end = new Date(Date.UTC(baseYear, baseMonth + 1, endDay, 12));
    } else {
      end = endCandidate;
    }
  }

  const dates = [];
  const cursor = new Date(start);
  // Safety: cap at 10 days to prevent infinite loop
  while (cursor <= end && dates.length < 10) {
    dates.push(cursor.toISOString().split('T')[0]);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// ==================== WIND PARSING ====================

const DIR_PATTERN = /^(?:Variable\s+(?:mostly\s+)?)?(?:Builds\s+)?(?:L&V|([NESW]{1,3}(?:-[NESW]{1,3})?))/i;
const SPEED_PATTERN = /@?(\d+)-(\d+)/;
const UP_TO_PATTERN = /up\s+to\s+(\d+)/i;
const UNDER_PATTERN = /under\s+(\d+)/i;
const GUST_PATTERN = /g(\d+)k/i;
const SEAS_PATTERN = /\/(\d+)(?:-(\d+))?'/;

/**
 * Parse a compass direction string.
 * @param {string} dirStr - e.g. "ESE", "E-SE", "Variable mostly E"
 * @returns {string|null}
 */
export function parseDirection(dirStr) {
  if (!dirStr) return null;
  const cleaned = dirStr.trim().toUpperCase();

  // L&V = light and variable
  if (cleaned === 'L&V') return 'VAR';

  // "Variable mostly E" → "E"
  const varMatch = cleaned.match(/VARIABLE\s+(?:MOSTLY\s+)?([NESW]{1,3})/i);
  if (varMatch) return varMatch[1];

  // Strip "Builds" prefix
  const stripped = cleaned.replace(/^BUILDS\s+/i, '');

  // E-SE → take first part (primary direction)
  const rangeParts = stripped.split('-');
  const primary = rangeParts[0].trim();

  // Validate it's a valid compass point
  if (/^[NESW]{1,3}$/.test(primary)) return primary;

  return null;
}

/**
 * Parse a speed string like "12-18" or "up to 15" or "under 10".
 * @param {string} speedStr - the raw speed portion
 * @returns {{ range_kt: [number, number], gust_kt: number|null }}
 */
export function parseSpeedRange(speedStr) {
  if (!speedStr) return { range_kt: [0, 0], gust_kt: null };

  const gustMatch = speedStr.match(GUST_PATTERN);
  const gust_kt = gustMatch ? parseInt(gustMatch[1], 10) : null;

  const rangeMatch = speedStr.match(SPEED_PATTERN);
  if (rangeMatch) {
    return { range_kt: [parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10)], gust_kt };
  }

  const upToMatch = speedStr.match(UP_TO_PATTERN);
  if (upToMatch) {
    return { range_kt: [0, parseInt(upToMatch[1], 10)], gust_kt };
  }

  const underMatch = speedStr.match(UNDER_PATTERN);
  if (underMatch) {
    return { range_kt: [0, parseInt(underMatch[1], 10)], gust_kt };
  }

  return { range_kt: [0, 0], gust_kt };
}

/**
 * Parse inline seas from wind segment, e.g. "/4-6'" → [4, 6]
 * @param {string} str - segment containing /DIGITS' or /DIGITS-DIGITS'
 * @returns {[number, number]|null}
 */
export function parseSeasInline(str) {
  if (!str) return null;
  const match = str.match(SEAS_PATTERN);
  if (!match) return null;
  const lo = parseInt(match[1], 10);
  const hi = match[2] ? parseInt(match[2], 10) : lo;
  return [lo, hi];
}

// ==================== SWELL PARSING ====================

const SWELL_FULL_PATTERN = /(\d+)(?:-(\d+))?'\/(\d+)(?:-(\d+))?sec([NESW]{1,3}(?:-[NESW]{1,3})?)/gi;
const SWELL_PARTIAL_PATTERN = /(\d+)(?:-(\d+))?sec([NESW]{1,3}(?:-[NESW]{1,3})?)/gi;

/**
 * Parse a swell string into an array of swell components.
 * Handles multi-swell via `&` separator.
 * @param {string} swellStr - e.g. "4-6'/8secE & 13secNNW"
 * @returns {{ dir: string, ft: [number,number]|null, period_s: [number,number] }[]}
 */
export function parseSwellEntry(swellStr) {
  if (!swellStr) return [];

  // Split on & for multi-swell
  const components = swellStr.split('&').map(s => s.trim()).filter(s => s.length > 0);
  const results = [];

  for (const comp of components) {
    // Try full pattern: HEIGHT'/PERIODsecDIR
    const fullRe = new RegExp(SWELL_FULL_PATTERN.source, 'i');
    const fullMatch = comp.match(fullRe);
    if (fullMatch) {
      const lo = parseInt(fullMatch[1], 10);
      const hi = fullMatch[2] ? parseInt(fullMatch[2], 10) : lo;
      const pLo = parseInt(fullMatch[3], 10);
      const pHi = fullMatch[4] ? parseInt(fullMatch[4], 10) : pLo;
      const dir = parseDirection(fullMatch[5]) || fullMatch[5];
      results.push({ dir, ft: [lo, hi], period_s: [pLo, pHi] });
      continue;
    }

    // Try partial: PERIODsecDIR (no height)
    const partialRe = new RegExp(SWELL_PARTIAL_PATTERN.source, 'i');
    const partialMatch = comp.match(partialRe);
    if (partialMatch) {
      const pLo = parseInt(partialMatch[1], 10);
      const pHi = partialMatch[2] ? parseInt(partialMatch[2], 10) : pLo;
      const dir = parseDirection(partialMatch[3]) || partialMatch[3];
      results.push({ dir, ft: null, period_s: [pLo, pHi] });
    }
  }

  return results;
}

// ==================== PRECIP PARSING ====================

const PRECIP_KEYWORDS = ['widespread', 'numerous', 'scattered', 'isolated', 'stray', 'mostly dry', 'dry'];

/**
 * Extract precipitation description from a precip block segment.
 * @param {string} segment - one segment of precip text
 * @returns {string|null}
 */
function extractPrecipDescription(segment) {
  if (!segment) return null;
  const lower = segment.toLowerCase();
  for (const keyword of PRECIP_KEYWORDS) {
    if (lower.includes(keyword)) {
      return segment.trim();
    }
  }
  // If no keyword found but there's text, return it as-is
  return segment.trim() || null;
}

// ==================== PREPROCESSING ====================

/**
 * Strip parenthetical notes and normalize whitespace.
 */
function preprocess(block) {
  if (!block) return '';
  let cleaned = block.replace(/\([^)]*\)/g, '');       // Strip parenthetical notes
  cleaned = cleaned.replace(/\*[^\n]*/g, '');           // Strip *Note... lines
  cleaned = cleaned.replace(/\s+/g, ' ').trim();        // Normalize whitespace
  cleaned = cleaned.replace(/\.\s*$/, '');               // Strip trailing period
  return cleaned;
}

/**
 * Split a block into segments on `;` or `...`
 * For `<` transitions, take the first part (pre-transition value)
 */
function splitSegments(block) {
  return preprocess(block)
    .split(/;|\.\.\./)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Extract date token from end of a segment.
 * Returns { body, dateToken }
 */
const DATE_PATTERN = /\b(today|tonight|this\s+(?:morning|afternoon)|(?:late|early)\s+[A-Za-z]{3}\d{1,2}|[A-Za-z]{3}\d{1,2}(?:\s+night)?(?:\s*-\s*(?:[A-Za-z]{3}\d{1,2}(?:\s+night)?|today|tonight))?(?:\s+(?:morning|afternoon|evening))?)\s*$/i;

function extractDateFromSegment(segment) {
  const match = segment.match(DATE_PATTERN);
  if (match) {
    return {
      body: segment.substring(0, match.index).trim(),
      dateToken: match[1].trim(),
    };
  }
  return { body: segment.trim(), dateToken: null };
}

// ==================== BLOCK PARSERS ====================

/**
 * Parse a WIND block into day entries.
 * @param {string} windBlock - raw WIND text
 * @param {string} primaryDate - YYYY-MM-DD
 * @returns {{ dates: string[], wind: object, seas_ft: [number,number]|null }[]}
 */
export function parseWindBlock(windBlock, primaryDate) {
  if (!windBlock) return [];

  const segments = splitSegments(windBlock);
  const entries = [];

  for (const segment of segments) {
    // Handle `<` transition — take the first part
    const transitionParts = segment.split('<');
    const primary = transitionParts[0].trim();

    const { body, dateToken } = extractDateFromSegment(primary);
    const dates = resolveDateToken(dateToken, primaryDate);

    // Parse direction
    const dirMatch = body.match(DIR_PATTERN);
    let dir = null;
    if (dirMatch) {
      if (body.match(/L&V/i)) {
        dir = 'VAR';
      } else {
        dir = parseDirection(dirMatch[1] || dirMatch[0]);
      }
    }

    // Parse speed
    const speed = parseSpeedRange(body);

    // Parse inline seas
    const seas_ft = parseSeasInline(body);

    // Build wind object
    const wind = {
      dir,
      range_kt: speed.range_kt,
      gust_kt: speed.gust_kt,
    };

    // Only add if we got something useful
    if (dir || speed.range_kt[0] > 0 || speed.range_kt[1] > 0) {
      entries.push({ dates, wind, seas_ft });
    }
  }

  return entries;
}

/**
 * Parse a SEAS/SWELL block into day entries.
 * @param {string} seasBlock - raw SEAS text
 * @param {string} primaryDate - YYYY-MM-DD
 * @returns {{ dates: string[], swell: object[] }[]}
 */
export function parseSwellBlock(seasBlock, primaryDate) {
  if (!seasBlock) return [];

  const segments = splitSegments(seasBlock);
  const entries = [];

  for (const segment of segments) {
    const { body, dateToken } = extractDateFromSegment(segment);
    const dates = resolveDateToken(dateToken, primaryDate);
    const swell = parseSwellEntry(body);

    if (swell.length > 0) {
      entries.push({ dates, swell });
    }
  }

  return entries;
}

/**
 * Parse a PRECIP block into day entries.
 * @param {string} precipBlock - raw PRECIP text
 * @param {string} primaryDate - YYYY-MM-DD
 * @returns {{ dates: string[], precipitation: string }[]}
 */
export function parsePrecipBlock(precipBlock, primaryDate) {
  if (!precipBlock) return [];

  const segments = splitSegments(precipBlock);
  const entries = [];

  for (const segment of segments) {
    const { body, dateToken } = extractDateFromSegment(segment);
    const dates = resolveDateToken(dateToken, primaryDate);
    const precipitation = extractPrecipDescription(body);

    if (precipitation) {
      entries.push({ dates, precipitation });
    }
  }

  return entries;
}

// ==================== MERGE ====================

/**
 * Merge wind, swell, and precip entries by date into unified day objects.
 * @param {object[]} windEntries - from parseWindBlock
 * @param {object[]} swellEntries - from parseSwellBlock
 * @param {object[]} precipEntries - from parsePrecipBlock
 * @param {string|null} suggestBlock - raw SUGGEST text (kept as-is)
 * @returns {{ date, wind, seas_ft, swell, precipitation, sailing_notes }[]}
 */
export function mergeByDate(windEntries, swellEntries, precipEntries, suggestBlock) {
  const dayMap = new Map();

  // Helper: get or create day entry
  const getDay = (date) => {
    if (!dayMap.has(date)) {
      dayMap.set(date, {
        date,
        wind: null,
        seas_ft: null,
        swell: [],
        precipitation: null,
        sailing_notes: suggestBlock ? parseSuggestBlock(suggestBlock) : {},
      });
    }
    return dayMap.get(date);
  };

  // Merge wind
  for (const entry of windEntries) {
    for (const date of entry.dates) {
      const day = getDay(date);
      if (!day.wind) day.wind = entry.wind;
      if (!day.seas_ft && entry.seas_ft) day.seas_ft = entry.seas_ft;
    }
  }

  // Merge swell
  for (const entry of swellEntries) {
    for (const date of entry.dates) {
      const day = getDay(date);
      if (day.swell.length === 0) day.swell = entry.swell;
    }
  }

  // Merge precip
  for (const entry of precipEntries) {
    for (const date of entry.dates) {
      const day = getDay(date);
      if (!day.precipitation) day.precipitation = entry.precipitation;
    }
  }

  // Sort by date and return
  return [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, day]) => day);
}

/**
 * Parse SUGGEST block into sailing_notes keyed by compass direction.
 * @param {string} suggestBlock - raw SUGGEST text
 * @returns {Object} e.g. { "W-NW": "advice text" }
 */
function parseSuggestBlock(suggestBlock) {
  if (!suggestBlock) return {};

  const notes = {};
  // Pattern: "W-NW bound sailing: advice text" or "N-NE: advice"
  const parts = suggestBlock.split(/(?=[NESW]{1,3}(?:-[NESW]{1,3})?\s+bound)/i);

  for (const part of parts) {
    const match = part.match(/^([NESW]{1,3}(?:-[NESW]{1,3})?)\s+bound\s+(?:sailing[:\s]*)?(.+)/is);
    if (match) {
      notes[match[1].trim()] = match[2].trim();
    }
  }

  // If no directional parsing succeeded, store the whole block as "general"
  if (Object.keys(notes).length === 0 && suggestBlock.trim()) {
    notes['general'] = suggestBlock.trim();
  }

  return notes;
}

// ==================== MAIN ENTRY POINT ====================

/**
 * Normalize a single raw section into structured day data.
 * Pure function — throws on failure, caller handles logging.
 *
 * @param {object} section - raw section from Step 1 LLM output
 * @param {string} primaryDate - YYYY-MM-DD
 * @returns {{ section_id, section_name, lat_range, lon_range, days[] }}
 */
export function normalizeSection(section, primaryDate) {
  if (!section) throw new Error('Section is null/undefined');
  if (!primaryDate) throw new Error('primaryDate is required');

  const windEntries = section.wind_block ? parseWindBlock(section.wind_block, primaryDate) : [];
  const swellEntries = section.seas_block ? parseSwellBlock(section.seas_block, primaryDate) : [];
  const precipEntries = section.precip_block ? parsePrecipBlock(section.precip_block, primaryDate) : [];
  const days = mergeByDate(windEntries, swellEntries, precipEntries, section.suggest_block);

  if (days.length === 0) {
    throw new Error(`No days parsed from section "${section.section_name}"`);
  }

  return {
    section_id: (section.section_name || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    section_name: section.section_name,
    lat_range: section.lat_range,
    lon_range: section.lon_range,
    days,
  };
}
