/**
 * Feature Flags Management
 * Provides scalable per-team and per-account feature toggle capability.
 * Enables granular on/off switches for analytics and modules, supporting
 * multi-team scalability and admin control.
 */

export const FEATURE_KEYS = {
  MATCH_DYNAMICS: 'enable_match_dynamics',
  EFFICIENCY_RATING: 'enable_efficiency_rating',
  ATTEMPTS: 'enable_attempts',
  DEFENSIVE_CONTRIBUTIONS: 'enable_defensive_contributions'
};

export const DEFAULT_FEATURE_STATE = {
  [FEATURE_KEYS.MATCH_DYNAMICS]: true,
  [FEATURE_KEYS.EFFICIENCY_RATING]: true,
  [FEATURE_KEYS.ATTEMPTS]: false,
  [FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS]: false
};

/**
 * Checks if a specific feature is enabled for a given team.
 * @param {Object} teamInfo - The active team object
 * @param {string} featureKey - Key from FEATURE_KEYS
 * @returns {boolean}
 */
export const isFeatureEnabled = (teamInfo, featureKey) => {
  if (!teamInfo) return DEFAULT_FEATURE_STATE[featureKey] ?? true;

  // 1. Check if defined in teamInfo.settings (JSONB or object)
  if (teamInfo.settings && typeof teamInfo.settings[featureKey] === 'boolean') {
    return teamInfo.settings[featureKey];
  }

  // 2. Check if defined directly on teamInfo object
  if (typeof teamInfo[featureKey] === 'boolean') {
    return teamInfo[featureKey];
  }

  // 3. Check persistent localStorage scoped to team ID
  if (teamInfo.id) {
    try {
      const stored = localStorage.getItem(`team_feat_${teamInfo.id}_${featureKey}`);
      if (stored !== null) {
        return stored === 'true';
      }
    } catch {
      // LocalStorage access fallback
    }
  }

  // 4. Fallback to default state
  return DEFAULT_FEATURE_STATE[featureKey] ?? true;
};

/**
 * Saves a feature flag state locally for a team.
 * @param {string|number} teamId
 * @param {string} featureKey
 * @param {boolean} isEnabled
 */
export const setFeatureFlag = (teamId, featureKey, isEnabled) => {
  if (!teamId) return;
  try {
    localStorage.setItem(`team_feat_${teamId}_${featureKey}`, String(isEnabled));
  } catch (e) {
    console.error('Failed to set feature flag in localStorage', e);
  }
};

/**
 * Returns all feature flags for a team.
 * @param {Object} teamInfo
 * @returns {Object}
 */
export const getTeamFeatures = (teamInfo) => {
  return {
    [FEATURE_KEYS.MATCH_DYNAMICS]: isFeatureEnabled(teamInfo, FEATURE_KEYS.MATCH_DYNAMICS),
    [FEATURE_KEYS.EFFICIENCY_RATING]: isFeatureEnabled(teamInfo, FEATURE_KEYS.EFFICIENCY_RATING),
    [FEATURE_KEYS.ATTEMPTS]: isFeatureEnabled(teamInfo, FEATURE_KEYS.ATTEMPTS),
    [FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS]: isFeatureEnabled(teamInfo, FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS)
  };
};
