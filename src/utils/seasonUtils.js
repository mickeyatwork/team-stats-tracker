/**
 * Utility functions for formatting and auto-computing season metadata (season, league, timeframe).
 */

/**
 * Computes a human-readable season timeframe (e.g. "September 2026 – December 2026")
 * automatically from an array of matches with date fields.
 *
 * @param {Array} matches - Array of match objects with a `date` property.
 * @returns {string} Formatted timeframe string or empty string if no valid dates.
 */
export const computeSeasonTimeframeFromMatches = (matches = []) => {
  if (!Array.isArray(matches) || matches.length === 0) return '';

  const validDates = matches
    .map((m) => m?.date)
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  if (validDates.length === 0) return '';

  const firstDate = validDates[0];
  const lastDate = validDates[validDates.length - 1];

  const formatMonthYear = (d) =>
    d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const firstFormatted = formatMonthYear(firstDate);
  const lastFormatted = formatMonthYear(lastDate);

  if (firstFormatted === lastFormatted) {
    return firstFormatted;
  }
  return `${firstFormatted} – ${lastFormatted}`;
};

/**
 * Formats a clean display title combining season name and league (e.g. "2026/27 • Autumn League").
 *
 * @param {Object} teamOrSeason - Team or season object with `season` and optional `league`.
 * @returns {string}
 */
export const formatSeasonLabel = (teamOrSeason) => {
  if (!teamOrSeason) return '';
  const season = (teamOrSeason.season || '').trim();
  const league = (teamOrSeason.league || teamOrSeason.settings?.league || '').trim();

  if (season && league) {
    return `${season} • ${league}`;
  }
  return season || league || 'Active Season';
};

/**
 * Resolves the effective timeframe for a team/season, falling back to match dates if unassigned.
 *
 * @param {Object} teamOrSeason - Team or season object with optional `timeframe`.
 * @param {Array} matchesForSeason - Array of matches for this specific season.
 * @returns {string}
 */
export const getEffectiveTimeframe = (teamOrSeason, matchesForSeason = []) => {
  if (!teamOrSeason) return '';
  const manual = (teamOrSeason.timeframe || teamOrSeason.settings?.timeframe || '').trim();
  if (manual) return manual;
  return computeSeasonTimeframeFromMatches(matchesForSeason);
};

