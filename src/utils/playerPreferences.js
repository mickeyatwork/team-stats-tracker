/**
 * Utility functions for managing player preferences such as default selection state.
 */

const STORAGE_KEY = 'default_off_players';

/**
 * Returns an array of player IDs that are marked as default off.
 * @returns {string[]}
 */
export function getDefaultOffPlayerIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Checks if a player is marked as default off.
 * @param {string} playerId
 * @returns {boolean}
 */
export function isPlayerDefaultOff(playerId) {
  if (!playerId) return false;
  const list = getDefaultOffPlayerIds();
  return list.some((id) => String(id) === String(playerId));
}

/**
 * Sets whether a player is defaulted to off.
 * @param {string} playerId
 * @param {boolean} isDefaultOff
 */
export function setPlayerDefaultOff(playerId, isDefaultOff) {
  if (!playerId) return;
  try {
    const current = getDefaultOffPlayerIds().filter((id) => String(id) !== String(playerId));
    if (isDefaultOff) {
      current.push(String(playerId));
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (e) {
    console.error('Failed to save default off players', e);
  }
}

/**
 * Toggles a player's default off status.
 * @param {string} playerId
 * @returns {boolean} the new isDefaultOff status
 */
export function togglePlayerDefaultOff(playerId) {
  const current = isPlayerDefaultOff(playerId);
  const next = !current;
  setPlayerDefaultOff(playerId, next);
  return next;
}

/**
 * Returns player IDs from the provided squad who are NOT defaulted to off.
 * @param {Array} squad - Array of player objects with .id
 * @returns {string[]}
 */
export function getDefaultSquadSelection(squad = []) {
  const offIds = new Set(getDefaultOffPlayerIds().map(String));
  return squad.filter((p) => !offIds.has(String(p.id))).map((p) => p.id);
}
