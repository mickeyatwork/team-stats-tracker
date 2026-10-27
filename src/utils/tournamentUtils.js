/**
 * Utilities for parsing, encoding, and grouping tournament matches and stages.
 */

/**
 * Standard knockout round presets
 */
export const KNOCKOUT_ROUNDS = [
  'Final',
  'Semi-Final',
  'Quarter-Final',
  'Round of 16',
  'Round of 32',
  '3rd/4th Playoff'
];

/**
 * Parses tournament string from matches.tournament
 * Format: "Tournament Name::Stage::Round"
 * Handles legacy matches where tournament was just "Tournament Name"
 * 
 * @param {string} tournamentStr 
 * @returns {{ name: string, stage: string, round: string }}
 */
export function parseTournament(tournamentStr) {
  if (!tournamentStr || typeof tournamentStr !== 'string') {
    return { name: '', stage: 'Group Stage', round: '' };
  }

  const parts = tournamentStr.split('::').map((s) => s.trim());
  const name = parts[0] || '';
  const stage = parts[1] || 'Group Stage';
  const round = parts[2] || '';

  return { name, stage, round };
}

/**
 * Encodes tournament details into database-safe string
 * 
 * @param {string} name - Tournament name
 * @param {string} stage - "Group Stage" | "Knockout Stage"
 * @param {string} round - Optional round name e.g. "Quarter-Final"
 * @returns {string}
 */
export function encodeTournament(name, stage = 'Group Stage', round = '') {
  const cleanName = (name || '').trim();
  const cleanStage = (stage || 'Group Stage').trim();
  const cleanRound = (round || '').trim();

  if (cleanRound) {
    return `${cleanName}::${cleanStage}::${cleanRound}`;
  }
  return `${cleanName}::${cleanStage}`;
}

export function getFinishedTournaments() {
  try {
    const raw = localStorage.getItem('finished_tournaments');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function isTournamentFinished(tourneyName) {
  if (!tourneyName) return false;
  const list = getFinishedTournaments();
  return list.some((t) => t.toLowerCase() === tourneyName.toLowerCase());
}

export function setTournamentFinishedStatus(tourneyName, isFinished) {
  if (!tourneyName) return;
  try {
    const current = getFinishedTournaments().filter(
      (t) => t.toLowerCase() !== tourneyName.toLowerCase()
    );
    if (isFinished) {
      current.push(tourneyName);
    }
    localStorage.setItem('finished_tournaments', JSON.stringify(current));
  } catch (e) {
    console.error('Failed to set tournament status', e);
  }
}

export function getSavedTournaments() {
  try {
    const raw = localStorage.getItem('saved_tournaments');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTournament(tourneyName, extra = {}) {
  if (!tourneyName || !tourneyName.trim()) return;
  const name = tourneyName.trim();
  try {
    const current = getSavedTournaments();
    const existingIndex = current.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
    const tourneyObj = {
      name,
      createdAt: extra.createdAt || (existingIndex >= 0 ? current[existingIndex].createdAt : new Date().toISOString()),
      match_variant: extra.match_variant || (existingIndex >= 0 ? current[existingIndex].match_variant : '5-a-side'),
      available_players: extra.available_players !== undefined
        ? extra.available_players
        : (existingIndex >= 0 ? current[existingIndex].available_players : undefined),
      ...extra
    };
    if (existingIndex >= 0) {
      current[existingIndex] = { ...current[existingIndex], ...tourneyObj };
    } else {
      current.push(tourneyObj);
    }
    localStorage.setItem('saved_tournaments', JSON.stringify(current));
  } catch (e) {
    console.error('Failed to save tournament', e);
  }
}

export function getTournamentAvailablePlayers(tourneyName) {
  if (!tourneyName) return null;
  const saved = getSavedTournaments();
  const t = saved.find((x) => x.name.toLowerCase() === tourneyName.toLowerCase());
  return t && Array.isArray(t.available_players) ? t.available_players : null;
}

export function setTournamentAvailablePlayers(tourneyName, playerIds) {
  if (!tourneyName) return;
  saveTournament(tourneyName, { available_players: playerIds });
}

export function removeSavedTournament(tourneyName) {
  if (!tourneyName) return;
  try {
    const current = getSavedTournaments().filter(
      (t) => t.name.toLowerCase() !== tourneyName.toLowerCase()
    );
    localStorage.setItem('saved_tournaments', JSON.stringify(current));
  } catch (e) {
    console.error('Failed to remove saved tournament', e);
  }
}

/**
 * Groups all tournament matches by tournament name and computes tournament records.
 * Incorporates explicitly saved/created tournaments even before matches are added.
 * 
 * @param {Array} matches - All matches from state/db
 * @returns {Array} List of grouped tournament objects
 */
export function groupMatchesByTournament(matches = []) {
  const tournamentMap = {};

  // First, populate with any explicitly saved/created tournaments
  const saved = getSavedTournaments();
  saved.forEach((st) => {
    if (!st || !st.name) return;
    const key = st.name.toLowerCase();
    const dateStr = st.createdAt ? st.createdAt.split('T')[0] : new Date().toISOString().split('T')[0];
    tournamentMap[key] = {
      name: st.name,
      isFinished: isTournamentFinished(st.name),
      latestDate: dateStr,
      earliestDate: dateStr,
      match_variant: st.match_variant || '5-a-side',
      available_players: st.available_players,
      matches: [],
      groupMatches: [],
      knockoutMatches: [],
      summary: {
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDiff: 0
      }
    };
  });

  matches.forEach((m) => {
    if (m.competition !== 'Tournament' || !m.tournament) return;

    const { name, stage, round } = parseTournament(m.tournament);
    if (!name) return;

    const key = name.toLowerCase();

    if (!tournamentMap[key]) {
      tournamentMap[key] = {
        name,
        isFinished: isTournamentFinished(name),
        latestDate: m.date,
        earliestDate: m.date,
        match_variant: m.match_variant || '5-a-side',
        matches: [],
        groupMatches: [],
        knockoutMatches: [],
        summary: {
          played: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDiff: 0
        }
      };
      // Keep saved list updated with newly discovered tournament
      saveTournament(name, { match_variant: m.match_variant });
    }

    const t = tournamentMap[key];
    const enrichedMatch = {
      ...m,
      tournamentStage: stage,
      tournamentRound: round
    };

    // If this is the first real match in an empty saved tournament, align dates
    if (t.matches.length === 0) {
      t.latestDate = m.date;
      t.earliestDate = m.date;
      if (m.match_variant) t.match_variant = m.match_variant;
    } else {
      // Keep date range updated
      if (new Date(m.date) > new Date(t.latestDate)) {
        t.latestDate = m.date;
      }
      if (new Date(m.date) < new Date(t.earliestDate)) {
        t.earliestDate = m.date;
      }
    }

    t.matches.push(enrichedMatch);

    if (stage === 'Knockout Stage') {
      t.knockoutMatches.push(enrichedMatch);
    } else {
      t.groupMatches.push(enrichedMatch);
    }

    // Summary record
    t.summary.played++;
    t.summary.goalsFor += m.team_goals || 0;
    t.summary.goalsAgainst += m.opponent_goals || 0;

    if (!m.hide_score) {
      if ((m.team_goals || 0) > (m.opponent_goals || 0)) {
        t.summary.wins++;
      } else if ((m.team_goals || 0) === (m.opponent_goals || 0)) {
        t.summary.draws++;
      } else {
        t.summary.losses++;
      }
    }
  });

  // Calculate goal differences and sort matches within tournaments
  return Object.values(tournamentMap)
    .map((t) => {
      t.summary.goalDiff = t.summary.goalsFor - t.summary.goalsAgainst;
      // Sort matches chronologically within the tournament
      t.matches.sort((a, b) => new Date(a.date) - new Date(b.date));
      t.groupMatches.sort((a, b) => new Date(a.date) - new Date(b.date));
      t.knockoutMatches.sort((a, b) => new Date(a.date) - new Date(b.date));
      return t;
    })
    .sort((a, b) => new Date(b.latestDate) - new Date(a.latestDate));
}
