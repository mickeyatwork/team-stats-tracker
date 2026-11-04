import { getLocalTimelineEvents, saveLocalTimelineEvents } from './timelineUtils';

const DIRTY_MATCHES_KEY = 'tst_offline_dirty_matches_v1';
const CACHED_MATCHES_PREFIX = 'tst_offline_cache_matches_';
const CACHED_SQUAD_PREFIX = 'tst_offline_cache_squad_';
const CACHED_TEAMS_KEY = 'tst_offline_cache_teams_v1';
const CACHED_CLUBS_KEY = 'tst_offline_cache_clubs_v1';

const listeners = new Set();
let isSyncing = false;
let lastSyncSuccessAt = null;
let serverUnreachable = false;

function notifyListeners() {
  const state = getOfflineSyncState();
  listeners.forEach((cb) => {
    try {
      cb(state);
    } catch {
      // ignore listener errors
    }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    serverUnreachable = false;
    notifyListeners();
  });
  window.addEventListener('offline', () => {
    notifyListeners();
  });
}

export function isOfflineId(id) {
  return String(id || '').startsWith('offline-match-');
}

export function getDirtyMatchesMap() {
  try {
    const raw = localStorage.getItem(DIRTY_MATCHES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveDirtyMatchesMap(map) {
  try {
    localStorage.setItem(DIRTY_MATCHES_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
  notifyListeners();
}

export function getOfflineSyncState() {
  const dirtyMap = getDirtyMatchesMap();
  const pendingMatchIds = Object.keys(dirtyMap);
  const browserOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  return {
    isOnline: browserOnline && !serverUnreachable,
    browserOnline,
    serverUnreachable,
    isSyncing,
    pendingCount: pendingMatchIds.length,
    pendingMatchIds,
    lastSyncSuccessAt
  };
}

export function subscribeOfflineSync(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function markServerUnreachable(unreachable = true) {
  if (serverUnreachable !== unreachable) {
    serverUnreachable = unreachable;
    notifyListeners();
  }
}

/**
 * Record or update a match snapshot in the offline queue so it will be synced
 * when connectivity to Supabase is available.
 */
export function queueOfflineMatchSnapshot(match, options = {}) {
  if (!match || !match.id) return;
  const dirtyMap = getDirtyMatchesMap();
  const existing = dirtyMap[match.id] || {};

  const removedPlayerIds = new Set(existing.removedPlayerIds || []);
  if (Array.isArray(options.removedPlayerIds)) {
    options.removedPlayerIds.forEach((pid) => removedPlayerIds.add(pid));
  }
  if (match.stats) {
    Object.keys(match.stats).forEach((pid) => removedPlayerIds.delete(pid));
  }

  const goalEvents = options.goalEvents || getLocalTimelineEvents(match.id) || existing.goalEvents || [];
  if (options.goalEvents) {
    saveLocalTimelineEvents(match.id, options.goalEvents);
  }

  dirtyMap[match.id] = {
    match: {
      id: match.id,
      user_id: match.user_id || existing.match?.user_id || null,
      team_id: match.team_id !== undefined ? match.team_id : (existing.match?.team_id ?? null),
      date: match.date || existing.match?.date || new Date().toISOString(),
      opponent: match.opponent ?? existing.match?.opponent ?? 'Opponent',
      competition: match.competition || existing.match?.competition || 'League',
      tournament: match.tournament !== undefined ? match.tournament : (existing.match?.tournament ?? null),
      match_variant: match.match_variant || existing.match?.match_variant || null,
      team_goals: match.team_goals ?? existing.match?.team_goals ?? 0,
      opponent_goals: match.opponent_goals ?? existing.match?.opponent_goals ?? 0,
      hide_score: match.hide_score ?? existing.match?.hide_score ?? false,
      status: match.status || existing.match?.status || 'active',
      created_at: match.created_at || existing.match?.created_at || new Date().toISOString()
    },
    stats: match.stats || existing.stats || {},
    removedPlayerIds: Array.from(removedPlayerIds),
    goalEvents,
    deleted: Boolean(options.deleted),
    updatedAt: new Date().toISOString()
  };

  saveDirtyMatchesMap(dirtyMap);
}

/**
 * Cache teams, clubs, squad, and matches locally for offline access.
 */
export function saveOfflineTeamsCache(teams, clubs) {
  try {
    if (Array.isArray(teams) && teams.length > 0) {
      localStorage.setItem(CACHED_TEAMS_KEY, JSON.stringify(teams));
    }
    if (Array.isArray(clubs) && clubs.length > 0) {
      localStorage.setItem(CACHED_CLUBS_KEY, JSON.stringify(clubs));
    }
  } catch {
    // ignore storage errors
  }
}

export function getOfflineTeamsCache() {
  try {
    const teamsRaw = localStorage.getItem(CACHED_TEAMS_KEY);
    const clubsRaw = localStorage.getItem(CACHED_CLUBS_KEY);
    return {
      teams: teamsRaw ? JSON.parse(teamsRaw) : [],
      clubs: clubsRaw ? JSON.parse(clubsRaw) : []
    };
  } catch {
    return { teams: [], clubs: [] };
  }
}

export function saveOfflineTeamDataCache(teamId, { squad, matches }) {
  if (!teamId) return;
  try {
    if (Array.isArray(squad)) {
      localStorage.setItem(`${CACHED_SQUAD_PREFIX}${teamId}`, JSON.stringify(squad));
    }
    if (Array.isArray(matches)) {
      localStorage.setItem(`${CACHED_MATCHES_PREFIX}${teamId}`, JSON.stringify(matches));
    }
  } catch {
    // ignore
  }
}

export function getOfflineTeamDataCache(teamId) {
  if (!teamId) return { squad: [], matches: [] };
  try {
    const squadRaw = localStorage.getItem(`${CACHED_SQUAD_PREFIX}${teamId}`);
    const matchesRaw = localStorage.getItem(`${CACHED_MATCHES_PREFIX}${teamId}`);
    return {
      squad: squadRaw ? JSON.parse(squadRaw) : [],
      matches: matchesRaw ? JSON.parse(matchesRaw) : []
    };
  } catch {
    return { squad: [], matches: [] };
  }
}

/**
 * Merge any dirty/unsynced offline matches into a fetched matches list so local offline edits
 * are never overwritten before they finish syncing to Supabase.
 */
export function mergeOfflineDirtyMatches(fetchedMatches, teamId) {
  const dirtyMap = getDirtyMatchesMap();
  const dirtyEntries = Object.values(dirtyMap);
  if (dirtyEntries.length === 0) return fetchedMatches;

  const result = [];
  const seenIds = new Set();

  (fetchedMatches || []).forEach((m) => {
    const dirty = dirtyMap[m.id];
    if (dirty?.deleted) {
      return;
    }
    if (dirty) {
      result.push({
        ...m,
        ...dirty.match,
        stats: dirty.stats || m.stats || {}
      });
    } else {
      result.push(m);
    }
    seenIds.add(m.id);
  });

  // Prepend any offline-created matches for this team that aren't in the DB yet
  dirtyEntries.forEach((entry) => {
    if (entry.deleted) return;
    const m = entry.match;
    if (!m || seenIds.has(m.id)) return;
    if (!teamId || !m.team_id || m.team_id === teamId) {
      result.unshift({
        ...m,
        stats: entry.stats || {}
      });
      seenIds.add(m.id);
    }
  });

  return result;
}

async function upsertMatchStatWithFallback(supabase, matchId, playerId, st) {
  const payload = {
    match_id: matchId,
    player_id: playerId,
    goals: st.goals || 0,
    assists: st.assists || 0,
    saves: st.saves || 0,
    is_goalkeeper: Boolean(st.is_goalkeeper)
  };
  if (st.attempts !== undefined) payload.attempts = st.attempts || 0;
  if (st.defensive_contributions !== undefined) payload.defensive_contributions = st.defensive_contributions || 0;
  if (st.is_captain !== undefined) payload.is_captain = Boolean(st.is_captain);
  if (st.is_potm !== undefined) payload.is_potm = Boolean(st.is_potm);

  let { error } = await supabase.from('match_stats').upsert(payload, { onConflict: 'match_id,player_id' });
  if (error && (error.message?.includes('column') || error.code === '42703' || error.code === 'PGRST204')) {
    const secondaryPayload = {
      match_id: matchId,
      player_id: playerId,
      goals: st.goals || 0,
      assists: st.assists || 0,
      saves: st.saves || 0,
      is_goalkeeper: Boolean(st.is_goalkeeper),
      attempts: st.attempts || 0,
      defensive_contributions: st.defensive_contributions || 0
    };
    const retry = await supabase.from('match_stats').upsert(secondaryPayload, { onConflict: 'match_id,player_id' });
    if (retry.error && (retry.error.message?.includes('column') || retry.error.code === '42703' || retry.error.code === 'PGRST204')) {
      const fallback = await supabase.from('match_stats').upsert(
        {
          match_id: matchId,
          player_id: playerId,
          goals: st.goals || 0,
          assists: st.assists || 0,
          saves: st.saves || 0,
          is_goalkeeper: Boolean(st.is_goalkeeper)
        },
        { onConflict: 'match_id,player_id' }
      );
      if (fallback.error) throw fallback.error;
    } else if (retry.error) {
      throw retry.error;
    }
  } else if (error) {
    throw error;
  }
}

/**
 * Flush all dirty/offline matches to Supabase.
 * Calls onMatchIdRemapped(oldId, newDbMatch) when a temporary offline match ID is saved to the DB.
 */
export async function flushOfflineSyncQueue(supabase, callbacks = {}) {
  if (isSyncing) return { synced: 0, remaining: Object.keys(getDirtyMatchesMap()).length };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { synced: 0, remaining: Object.keys(getDirtyMatchesMap()).length };
  }

  const dirtyMap = getDirtyMatchesMap();
  const matchIds = Object.keys(dirtyMap);
  if (matchIds.length === 0) {
    if (serverUnreachable) {
      serverUnreachable = false;
      notifyListeners();
    }
    return { synced: 0, remaining: 0 };
  }

  isSyncing = true;
  notifyListeners();

  let syncedCount = 0;

  try {
    for (const matchId of matchIds) {
      const entry = dirtyMap[matchId];
      if (!entry || !entry.match) {
        delete dirtyMap[matchId];
        continue;
      }

      // Handle deleted match
      if (entry.deleted) {
        if (!isOfflineId(matchId)) {
          await supabase.from('goal_events').delete().eq('match_id', matchId);
          await supabase.from('match_stats').delete().eq('match_id', matchId);
          const { error: delErr } = await supabase.from('matches').delete().eq('id', matchId);
          if (delErr) throw delErr;
        }
        delete dirtyMap[matchId];
        saveDirtyMatchesMap(dirtyMap);
        syncedCount++;
        continue;
      }

      let realMatchId = matchId;
      let createdNewMatchRow = null;

      if (isOfflineId(matchId)) {
        const dbMatchPayload = {
          user_id: entry.match.user_id,
          team_id: entry.match.team_id || null,
          date: entry.match.date,
          opponent: entry.match.opponent,
          competition: entry.match.competition,
          tournament: entry.match.tournament || null,
          match_variant: entry.match.match_variant || null,
          team_goals: entry.match.team_goals || 0,
          opponent_goals: entry.match.opponent_goals || 0,
          hide_score: Boolean(entry.match.hide_score),
          status: entry.match.status || 'active'
        };

        const { data: inserted, error: insertErr } = await supabase
          .from('matches')
          .insert([dbMatchPayload])
          .select()
          .single();

        if (insertErr || !inserted) {
          throw insertErr || new Error('Failed to insert offline match');
        }

        realMatchId = inserted.id;
        createdNewMatchRow = inserted;
      } else {
        const { error: updateErr } = await supabase
          .from('matches')
          .update({
            opponent: entry.match.opponent,
            team_goals: entry.match.team_goals || 0,
            opponent_goals: entry.match.opponent_goals || 0,
            hide_score: Boolean(entry.match.hide_score),
            status: entry.match.status || 'active'
          })
          .eq('id', realMatchId);

        if (updateErr) throw updateErr;
      }

      // Sync player stats
      const statsObj = entry.stats || {};
      for (const [playerId, st] of Object.entries(statsObj)) {
        await upsertMatchStatWithFallback(supabase, realMatchId, playerId, st);
      }

      // Remove any players removed while offline
      if (Array.isArray(entry.removedPlayerIds)) {
        for (const removedPid of entry.removedPlayerIds) {
          await supabase
            .from('match_stats')
            .delete()
            .eq('match_id', realMatchId)
            .eq('player_id', removedPid);
        }
      }

      // Sync timeline goal_events
      const localEvts = getLocalTimelineEvents(matchId);
      const eventsToSync = (localEvts && localEvts.length > 0) ? localEvts : (entry.goalEvents || []);
      if (eventsToSync.length > 0) {
        // Replace match goal_events in DB to preserve exact timeline order & assignments
        await supabase.from('goal_events').delete().eq('match_id', realMatchId);
        const rowsToInsert = eventsToSync.map((e, idx) => ({
          match_id: realMatchId,
          scorer_id: e.scorer_id || 'UNASSIGNED',
          assister_id: e.assister_id || null,
          created_at: e.created_at || new Date(Date.now() + idx * 1000).toISOString()
        }));
        const { data: insertedEvents } = await supabase
          .from('goal_events')
          .insert(rowsToInsert)
          .select();

        const finalEvents = (insertedEvents && insertedEvents.length > 0)
          ? insertedEvents
          : rowsToInsert.map((r, i) => ({ ...r, id: `local-${realMatchId}-${i + 1}` }));
        saveLocalTimelineEvents(realMatchId, finalEvents);
      }

      if (createdNewMatchRow && callbacks.onMatchIdRemapped) {
        callbacks.onMatchIdRemapped(matchId, {
          ...createdNewMatchRow,
          stats: statsObj
        });
      }

      delete dirtyMap[matchId];
      saveDirtyMatchesMap(dirtyMap);
      syncedCount++;
    }

    serverUnreachable = false;
    lastSyncSuccessAt = new Date().toISOString();
    if (callbacks.onSyncComplete && syncedCount > 0) {
      callbacks.onSyncComplete(syncedCount);
    }
  } catch (err) {
    console.warn('Offline sync paused (server unreachable):', err?.message || err);
    serverUnreachable = true;
  } finally {
    isSyncing = false;
    notifyListeners();
  }

  return {
    synced: syncedCount,
    remaining: Object.keys(getDirtyMatchesMap()).length
  };
}

