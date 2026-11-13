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

function getTournamentStorageKey(baseKey, teamId) {
  return teamId ? `${baseKey}_${teamId}` : baseKey;
}

export function getFinishedTournaments(teamId = null) {
  try {
    const scopedKey = getTournamentStorageKey('finished_tournaments', teamId);
    const raw = localStorage.getItem(scopedKey);
    if (raw) return JSON.parse(raw);
    
    // Fallback to legacy un-scoped list if scoped key is empty
    const legacyRaw = localStorage.getItem('finished_tournaments');
    return legacyRaw ? JSON.parse(legacyRaw) : [];
  } catch {
    return [];
  }
}

export function isTournamentFinished(tourneyName, teamId = null) {
  if (!tourneyName) return false;
  const list = getFinishedTournaments(teamId);
  return list.some((t) => t.toLowerCase() === tourneyName.toLowerCase());
}

export function setTournamentFinishedStatus(tourneyName, isFinished, teamId = null) {
  if (!tourneyName) return;
  try {
    const scopedKey = getTournamentStorageKey('finished_tournaments', teamId);
    const current = getFinishedTournaments(teamId).filter(
      (t) => t.toLowerCase() !== tourneyName.toLowerCase()
    );
    if (isFinished) {
      current.push(tourneyName);
    }
    localStorage.setItem(scopedKey, JSON.stringify(current));
  } catch (e) {
    console.error('Failed to set tournament status', e);
  }
}

export function getSavedTournaments(teamId = null) {
  try {
    if (teamId) {
      const scopedRaw = localStorage.getItem(`saved_tournaments_${teamId}`);
      if (scopedRaw) return JSON.parse(scopedRaw);
    }
    const raw = localStorage.getItem('saved_tournaments');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    if (teamId) {
      return parsed.filter((t) => !t.team_id || t.team_id === teamId);
    }
    return parsed;
  } catch {
    return [];
  }
}

export function saveTournament(tourneyName, extra = {}, teamId = null) {
  if (!tourneyName || !tourneyName.trim()) return;
  const name = tourneyName.trim();
  const effectiveTeamId = teamId || extra.team_id || null;

  try {
    const scopedKey = effectiveTeamId ? `saved_tournaments_${effectiveTeamId}` : 'saved_tournaments';
    const current = getSavedTournaments(effectiveTeamId);
    const existingIndex = current.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
    const tourneyObj = {
      name,
      team_id: effectiveTeamId,
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
    localStorage.setItem(scopedKey, JSON.stringify(current));
  } catch (e) {
    console.error('Failed to save tournament', e);
  }
}

export function getTournamentAvailablePlayers(tourneyName, teamId = null) {
  if (!tourneyName) return null;
  const saved = getSavedTournaments(teamId);
  const t = saved.find((x) => x.name.toLowerCase() === tourneyName.toLowerCase());
  return t && Array.isArray(t.available_players) ? t.available_players : null;
}

export function setTournamentAvailablePlayers(tourneyName, playerIds, teamId = null) {
  if (!tourneyName) return;
  saveTournament(tourneyName, { available_players: playerIds }, teamId);
}

export function removeSavedTournament(tourneyName, teamId = null) {
  if (!tourneyName) return;
  try {
    const scopedKey = teamId ? `saved_tournaments_${teamId}` : 'saved_tournaments';
    const current = getSavedTournaments(teamId).filter(
      (t) => t.name.toLowerCase() !== tourneyName.toLowerCase()
    );
    localStorage.setItem(scopedKey, JSON.stringify(current));

    // Also clean up legacy global storage if present
    if (teamId) {
      const globalRaw = localStorage.getItem('saved_tournaments');
      if (globalRaw) {
        const globalParsed = JSON.parse(globalRaw);
        const filtered = globalParsed.filter((t) => t.name.toLowerCase() !== tourneyName.toLowerCase() || (t.team_id && t.team_id !== teamId));
        localStorage.setItem('saved_tournaments', JSON.stringify(filtered));
      }
    }
  } catch (e) {
    console.error('Failed to remove saved tournament', e);
  }
}

/**
 * Groups all tournament matches by tournament name and computes tournament records.
 * Incorporates explicitly saved/created tournaments scoped to the active season/team.
 * 
 * @param {Array} matches - All matches from state/db (scoped to active season)
 * @param {string|null} teamId - Active team/season ID
 * @returns {Array} List of grouped tournament objects
 */
export function groupMatchesByTournament(matches = [], teamId = null) {
  const tournamentMap = {};

  // First, populate only with tournaments explicitly saved for this season
  const saved = getSavedTournaments(teamId);
  saved.forEach((st) => {
    if (!st || !st.name) return;
    
    // If it's a legacy saved tournament without a team_id, only include it
    // if matches in the current season actually reference this tournament
    if (teamId && !st.team_id) {
      const hasSeasonMatches = matches.some((m) => {
        if (m.competition !== 'Tournament' || !m.tournament) return false;
        const { name } = parseTournament(m.tournament);
        return name.toLowerCase() === st.name.toLowerCase();
      });
      if (!hasSeasonMatches) return;
    }

    const key = st.name.toLowerCase();
    const dateStr = st.createdAt ? st.createdAt.split('T')[0] : new Date().toISOString().split('T')[0];
    tournamentMap[key] = {
      name: st.name,
      team_id: teamId || st.team_id || null,
      isFinished: isTournamentFinished(st.name, teamId),
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
    if (teamId && m.team_id && m.team_id !== teamId) return;

    const { name, stage, round } = parseTournament(m.tournament);
    if (!name) return;

    const key = name.toLowerCase();

    if (!tournamentMap[key]) {
      tournamentMap[key] = {
        name,
        team_id: m.team_id || teamId,
        isFinished: isTournamentFinished(name, teamId),
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
      // Keep saved list updated with newly discovered tournament for this season
      saveTournament(name, { match_variant: m.match_variant }, teamId || m.team_id);
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
