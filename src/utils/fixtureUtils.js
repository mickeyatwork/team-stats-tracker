import { getDefaultMatchVariant } from './variantPreferences';

const MONTH_MAP = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11
};

const pad2 = (n) => String(n).padStart(2, '0');

const toIsoDateOnly = (year, monthIndex, day) => {
  const d = new Date(Date.UTC(year, monthIndex, day));
  if (
    isNaN(d.getTime()) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== monthIndex ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
};

/**
 * Parses common fixture date strings (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, "12 Sep 2026", etc.)
 * into a normalized "YYYY-MM-DD" string, or null if invalid.
 */
export const parseFlexibleDate = (raw) => {
  if (!raw) return null;
  const cleaned = String(raw)
    .trim()
    .replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+/i, '')
    .replace(/(\d+)(st|nd|rd|th)\b/gi, '$1')
    .trim();

  // 1. ISO YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return toIsoDateOnly(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
  }

  // 2. UK DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY
  const ukMatch = cleaned.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (ukMatch) {
    const day = parseInt(ukMatch[1], 10);
    const month = parseInt(ukMatch[2], 10) - 1;
    let year = parseInt(ukMatch[3], 10);
    if (year < 100) year += 2000;
    return toIsoDateOnly(year, month, day);
  }

  // 3. "12 Sep 2026" or "12 September 2026"
  const dmyText = cleaned.match(/^(\d{1,2})\s+([a-zA-Z]+)[,\s]+(\d{2,4})$/);
  if (dmyText) {
    const day = parseInt(dmyText[1], 10);
    const monthIdx = MONTH_MAP[dmyText[2].toLowerCase()];
    let year = parseInt(dmyText[3], 10);
    if (year < 100) year += 2000;
    if (monthIdx !== undefined) {
      return toIsoDateOnly(year, monthIdx, day);
    }
  }

  // 4. "Sep 12, 2026" or "September 12 2026"
  const mdyText = cleaned.match(/^([a-zA-Z]+)\s+(\d{1,2})[,\s]+(\d{2,4})$/);
  if (mdyText) {
    const monthIdx = MONTH_MAP[mdyText[1].toLowerCase()];
    const day = parseInt(mdyText[2], 10);
    let year = parseInt(mdyText[3], 10);
    if (year < 100) year += 2000;
    if (monthIdx !== undefined) {
      return toIsoDateOnly(year, monthIdx, day);
    }
  }

  return null;
};

const normalizeCompetition = (raw, fallback = 'League') => {
  if (!raw) return fallback;
  const lower = String(raw).trim().toLowerCase();
  if (lower.includes('cup') || lower.includes('trophy') || lower.includes('plate')) return 'Cup';
  if (lower.includes('friend')) return 'Friendly';
  if (lower.includes('league') || lower.includes('div')) return 'League';
  return fallback;
};

const normalizeVariant = (raw, fallback) => {
  if (!raw) return fallback;
  const match = String(raw).match(/\b(5v5|7v7|9v9|11v11)\b/i);
  return match ? match[1].toLowerCase() : fallback;
};

const cleanOpponentName = (raw) => {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/^(vs\.?|v\.?)\s+/i, '')
    .trim();
};

/**
 * Parses pasted CSV, TSV, pipe-separated, or plain text fixture lines.
 * Supports lines such as:
 *   "12/09/2026, Banbury United, League"
 *   "2026-09-19 | Eynsham Association | Home | Cup"
 *   "26 Sep 2026  Witney Vikings"
 */
export const parseFixturesText = (
  rawText,
  defaultCompetition = 'League',
  defaultVariant = getDefaultMatchVariant()
) => {
  if (!rawText || !rawText.trim()) {
    return { parsed: [], errors: [] };
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const parsed = [];
  const errors = [];

  lines.forEach((line, idx) => {
    // Skip header lines
    if (idx === 0 && /\bdate\b/i.test(line) && /\b(opponent|team|opposition|club)\b/i.test(line)) {
      return;
    }

    let parts = [];
    if (line.includes('\t')) {
      parts = line.split('\t').map((p) => p.trim()).filter(Boolean);
    } else if (line.includes('|')) {
      parts = line.split('|').map((p) => p.trim()).filter(Boolean);
    } else if (line.includes(',')) {
      parts = line.split(',').map((p) => p.trim()).filter(Boolean);
    } else if (line.includes(';')) {
      parts = line.split(';').map((p) => p.trim()).filter(Boolean);
    } else {
      // Free-form line: extract leading date token then remainder
      const freeMatch = line.match(
        /^((?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+)?(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+[a-zA-Z]+[,\s]+\d{2,4}|[a-zA-Z]+\s+\d{1,2}(?:st|nd|rd|th)?[,\s]+\d{2,4})\s+(.+)$/i
      );
      if (freeMatch) {
        const dateToken = `${freeMatch[1] || ''}${freeMatch[2]}`.trim();
        parts = [dateToken, freeMatch[3].trim()];
      }
    }

    if (parts.length < 2) {
      errors.push(`Line ${idx + 1}: Could not detect date and opponent in "${line}"`);
      return;
    }

    const parsedDate = parseFlexibleDate(parts[0]);
    if (!parsedDate) {
      errors.push(`Line ${idx + 1}: Unrecognized date "${parts[0]}"`);
      return;
    }

    // Remaining columns: find opponent, optional venue (Home/Away), optional competition, optional variant
    let opponent = '';
    let competition = defaultCompetition;
    let matchVariant = defaultVariant;
    let venueTag = '';

    const remaining = parts.slice(1);
    remaining.forEach((cell) => {
      const lower = cell.toLowerCase();
      if (/^(home|away|h|a)$/i.test(lower)) {
        venueTag = lower.startsWith('h') ? 'H' : 'A';
      } else if (/^(league|cup|friendly|trophy|plate)$/i.test(lower)) {
        competition = normalizeCompetition(cell, defaultCompetition);
      } else if (/^(5v5|7v7|9v9|11v11)$/i.test(lower)) {
        matchVariant = normalizeVariant(cell, defaultVariant);
      } else if (!opponent) {
        opponent = cleanOpponentName(cell);
      } else {
        // Check if extra cell mentions competition or variant
        if (/\b(cup|league|friendly)\b/i.test(lower)) {
          competition = normalizeCompetition(cell, competition);
        }
        if (/\b(5v5|7v7|9v9|11v11)\b/i.test(lower)) {
          matchVariant = normalizeVariant(cell, matchVariant);
        }
      }
    });

    if (!opponent) {
      errors.push(`Line ${idx + 1}: Missing opponent name.`);
      return;
    }

    if (venueTag && !/\((h|a)\)$/i.test(opponent)) {
      opponent = `${opponent} (${venueTag})`;
    }

    parsed.push({
      tempId: `parsed-${idx}-${Date.now()}`,
      date: parsedDate,
      opponent,
      competition,
      match_variant: matchVariant
    });
  });

  return { parsed, errors };
};

/**
 * Returns a human-friendly countdown badge for a scheduled fixture date.
 */
export const getFixtureCountdownBadge = (dateStr) => {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const diffDays = Math.round((targetUtc - todayUtc) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return { label: 'Today', variant: 'primary' };
  if (diffDays === 1) return { label: 'Tomorrow', variant: 'primary' };
  if (diffDays > 1 && diffDays <= 7) return { label: `In ${diffDays} days`, variant: 'info' };
  if (diffDays > 7 && diffDays <= 30) {
    const weeks = Math.round(diffDays / 7);
    return { label: weeks === 1 ? 'In 1 week' : `In ${weeks} weeks`, variant: 'neutral' };
  }
  if (diffDays < 0) {
    return { label: `${Math.abs(diffDays)}d ago`, variant: 'warning' };
  }
  return null;
};

const normalizeOpponentForMatch = (name) =>
  (name || '')
    .toLowerCase()
    .replace(/\((h|a)\)/gi, '')
    .replace(/\b(fc|afc|u\d+s?|united|utd|town|rovers|athletic|youth|juniors)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

const toDateKey = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
};

/**
 * Finds an existing tracked match (status !== 'scheduled') that likely corresponds
 * to the given scheduled fixture by date and/or opponent name.
 *
 * @param {Object} fixture
 * @param {Array} trackedMatches
 * @returns {{ match: Object, reason: string } | null}
 */
export const findMatchingTrackedMatch = (fixture, trackedMatches = []) => {
  if (!fixture || !Array.isArray(trackedMatches) || trackedMatches.length === 0) return null;

  const fixDate = toDateKey(fixture.date);
  const fixOppNorm = normalizeOpponentForMatch(fixture.opponent);
  const fixOppRaw = (fixture.opponent || '').replace(/\((h|a)\)/gi, '').trim().toLowerCase();

  let best = null;

  for (const m of trackedMatches) {
    if (!m || m.status === 'scheduled' || m.competition === 'Tournament') continue;

    const mDate = toDateKey(m.date);
    const mOppNorm = normalizeOpponentForMatch(m.opponent);
    const mOppRaw = (m.opponent || '').replace(/\((h|a)\)/gi, '').trim().toLowerCase();

    const sameDate = Boolean(fixDate && mDate && fixDate === mDate);
    const oppMatches = Boolean(
      (fixOppRaw && mOppRaw && (fixOppRaw === mOppRaw || fixOppRaw.includes(mOppRaw) || mOppRaw.includes(fixOppRaw))) ||
      (fixOppNorm && mOppNorm && (fixOppNorm === mOppNorm || fixOppNorm.includes(mOppNorm) || mOppNorm.includes(fixOppNorm)))
    );

    if (sameDate && oppMatches) {
      return { match: m, reason: 'Same date & opponent' };
    }
    if (sameDate && !best) {
      best = { match: m, reason: 'Same date' };
    } else if (oppMatches && fixDate && mDate) {
      const diffDays = Math.abs(new Date(fixDate).getTime() - new Date(mDate).getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays <= 3 && !best) {
        best = { match: m, reason: 'Matching opponent & close date' };
      }
    }
  }

  return best;
};

