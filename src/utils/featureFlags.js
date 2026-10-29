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
  DEFENSIVE_CONTRIBUTIONS: 'enable_defensive_contributions',
  PERFORMANCE_POINTS: 'enable_performance_points'
};

export const DEFAULT_FEATURE_STATE = {
  [FEATURE_KEYS.MATCH_DYNAMICS]: true,
  [FEATURE_KEYS.EFFICIENCY_RATING]: true,
  [FEATURE_KEYS.ATTEMPTS]: false,
  [FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS]: false,
  [FEATURE_KEYS.PERFORMANCE_POINTS]: false
};

export const DEFAULT_PERFORMANCE_WEIGHTS = {
  goal: 4.0,
  assist: 3.0,
  cleanSheet: 3.0,
  save: 1.5,
  defcon: 0.5
};

export const DEFAULT_MIN_FINISHER_ATTEMPTS = 3;

/**
 * Returns the effective performance point weights for a team.
 * Merges team custom settings over system defaults.
 */
export const getPerformanceWeights = (teamInfo) => {
  const custom = teamInfo?.settings?.performance_weights;
  if (!custom || typeof custom !== 'object') {
    if (teamInfo?.id) {
      try {
        const stored = localStorage.getItem(`team_perf_weights_${teamInfo.id}`);
        if (stored) return { ...DEFAULT_PERFORMANCE_WEIGHTS, ...JSON.parse(stored) };
      } catch {
        // fallback
      }
    }
    return { ...DEFAULT_PERFORMANCE_WEIGHTS };
  }
  return {
    goal: typeof custom.goal === 'number' ? custom.goal : DEFAULT_PERFORMANCE_WEIGHTS.goal,
    assist: typeof custom.assist === 'number' ? custom.assist : DEFAULT_PERFORMANCE_WEIGHTS.assist,
    cleanSheet: typeof custom.cleanSheet === 'number' ? custom.cleanSheet : DEFAULT_PERFORMANCE_WEIGHTS.cleanSheet,
    save: typeof custom.save === 'number' ? custom.save : DEFAULT_PERFORMANCE_WEIGHTS.save,
    defcon: typeof custom.defcon === 'number' ? custom.defcon : DEFAULT_PERFORMANCE_WEIGHTS.defcon
  };
};

/**
 * Returns minimum attempts required to qualify for Clinical Finisher.
 */
export const getMinFinisherAttempts = (teamInfo) => {
  const custom = teamInfo?.settings?.min_finisher_attempts;
  if (typeof custom === 'number' && custom >= 1) return custom;
  if (teamInfo?.id) {
    try {
      const stored = localStorage.getItem(`team_min_finisher_${teamInfo.id}`);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= 1) return parsed;
      }
    } catch {
      // fallback
    }
  }
  return DEFAULT_MIN_FINISHER_ATTEMPTS;
};

/**
 * Calculates total performance points based on weights.
 */
export const calculatePerformancePoints = ({ goals = 0, assists = 0, cleanSheets = 0, saves = 0, dc = 0 }, weights = DEFAULT_PERFORMANCE_WEIGHTS) => {
  const total = (goals * (weights.goal ?? 4.0)) +
    (assists * (weights.assist ?? 3.0)) +
    (cleanSheets * (weights.cleanSheet ?? 3.0)) +
    (saves * (weights.save ?? 1.5)) +
    (dc * (weights.defcon ?? 0.5));
  return Number(total.toFixed(1));
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
    [FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS]: isFeatureEnabled(teamInfo, FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS),
    [FEATURE_KEYS.PERFORMANCE_POINTS]: isFeatureEnabled(teamInfo, FEATURE_KEYS.PERFORMANCE_POINTS)
  };
};
