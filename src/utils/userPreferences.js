import { supabase } from '../supabaseClient';

export const DEFAULT_COLUMN_ORDER = ['goals', 'attempts', 'assists', 'saves', 'dc'];

const LOCAL_PREFS_KEY = 'user_preferences_cache';
const PREFS_UPDATED_EVENT = 'user-preferences-updated';

let memoryPrefs = null;

export const normalizeColumnOrder = (order) => {
  if (!Array.isArray(order)) return null;
  const valid = order.filter((k) => DEFAULT_COLUMN_ORDER.includes(k));
  if (valid.length === 0) return null;
  const missing = DEFAULT_COLUMN_ORDER.filter((k) => !valid.includes(k));
  return [...valid, ...missing];
};

export const normalizeHiddenColumns = (hidden) => {
  if (!Array.isArray(hidden)) return [];
  return hidden.filter((k) => DEFAULT_COLUMN_ORDER.includes(k));
};

const readLocalCache = () => {
  if (memoryPrefs) return memoryPrefs;
  try {
    const raw = localStorage.getItem(LOCAL_PREFS_KEY);
    if (raw) {
      memoryPrefs = JSON.parse(raw);
      return memoryPrefs;
    }
  } catch {
    // ignore storage errors
  }
  return {};
};

const writeLocalCache = (prefs) => {
  memoryPrefs = prefs;
  try {
    localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(prefs));
    if (prefs.tracker_column_order) {
      localStorage.setItem('matchTrackerColumnOrder', JSON.stringify(prefs.tracker_column_order));
    }
    if (prefs.tracker_hidden_columns) {
      localStorage.setItem('matchTrackerHiddenColumns', JSON.stringify(prefs.tracker_hidden_columns));
    }
    if (prefs.tracker_view_mode) {
      localStorage.setItem('matchTrackerViewMode', prefs.tracker_view_mode);
    }
    if (prefs.theme) {
      localStorage.setItem('app_theme_preference', prefs.theme);
    }
    if (prefs.preferred_match_variant) {
      localStorage.setItem('preferred_match_variant', prefs.preferred_match_variant);
    }
    if (Array.isArray(prefs.default_off_players)) {
      localStorage.setItem('default_off_players', JSON.stringify(prefs.default_off_players));
    }
  } catch {
    // ignore storage errors
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PREFS_UPDATED_EVENT, { detail: prefs }));
  }
};

/**
 * Loads user preferences from the `user_preferences` table in Supabase
 * and updates the local cache.
 */
export async function fetchUserPreferences(session) {
  const userId = session?.user?.id;
  const local = readLocalCache();

  let dbPrefs = null;
  if (userId) {
    try {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('preferences')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data?.preferences && typeof data.preferences === 'object') {
        dbPrefs = data.preferences;
      }
    } catch {
      // ignore network error and keep local cache
    }
  }

  const merged = {
    ...local,
    ...dbPrefs
  };

  writeLocalCache(merged);

  // If the user has no row in user_preferences yet, seed it with any existing local preferences
  if (userId && !dbPrefs && Object.keys(merged).length > 0) {
    try {
      await supabase.from('user_preferences').upsert(
        {
          user_id: userId,
          preferences: merged,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id' }
      );
    } catch {
      // ignore initial sync error
    }
  }

  return merged;
}

/**
 * Saves partial user preferences to the local cache and persists to `public.user_preferences`.
 */
export async function saveUserPreferences(partialPrefs) {
  const current = readLocalCache();
  const next = {
    ...current,
    ...partialPrefs
  };
  writeLocalCache(next);

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) return next;

    await supabase.from('user_preferences').upsert(
      {
        user_id: userId,
        preferences: next,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );
  } catch {
    // ignore network errors; local cache is already updated
  }

  return next;
}

export function getTrackerColumnOrder(teamInfo) {
  const prefs = readLocalCache();
  const teamId = teamInfo?.id;

  if (teamId && prefs.team_column_orders?.[teamId]) {
    const norm = normalizeColumnOrder(prefs.team_column_orders[teamId]);
    if (norm) return norm;
  }

  if (prefs.tracker_column_order) {
    const norm = normalizeColumnOrder(prefs.tracker_column_order);
    if (norm) return norm;
  }

  return [...DEFAULT_COLUMN_ORDER];
}

export function getTrackerHiddenColumns(teamInfo) {
  const prefs = readLocalCache();
  const teamId = teamInfo?.id;

  if (teamId && Array.isArray(prefs.team_hidden_columns?.[teamId])) {
    return normalizeHiddenColumns(prefs.team_hidden_columns[teamId]);
  }

  if (Array.isArray(prefs.tracker_hidden_columns)) {
    return normalizeHiddenColumns(prefs.tracker_hidden_columns);
  }

  return [];
}

export function getSavedMatchRoles(matchId) {
  if (!matchId) return { captains: [], potm: [] };
  const prefs = readLocalCache();
  const roles = prefs.match_roles?.[matchId];
  return {
    captains: Array.isArray(roles?.captains) ? roles.captains : [],
    potm: Array.isArray(roles?.potm) ? roles.potm : []
  };
}

export function saveMatchRoleSelection(matchId, roleKey, playerIds) {
  if (!matchId) return;
  const prefs = readLocalCache();
  const existingMatchRoles = prefs.match_roles || {};
  const currentForMatch = existingMatchRoles[matchId] || { captains: [], potm: [] };
  const updatedMatchRoles = {
    ...existingMatchRoles,
    [matchId]: {
      ...currentForMatch,
      [roleKey]: playerIds
    }
  };
  saveUserPreferences({ match_roles: updatedMatchRoles });
}

export function subscribeToUserPreferences(callback) {
  if (typeof window === 'undefined') return () => {};
  const handler = (e) => callback(e.detail || readLocalCache());
  window.addEventListener(PREFS_UPDATED_EVENT, handler);
  return () => window.removeEventListener(PREFS_UPDATED_EVENT, handler);
}
