import { useState, useRef, useCallback, useEffect } from 'react';
import { Plus, Target, Award, Shield, CheckCircle, EyeOff, Edit2, Check, X, Users, Clock, ChevronUp, ChevronDown, Trash2, UserPlus, Crosshair, ShieldCheck, ArrowUpDown, RotateCcw, GripVertical, Star, Pin, Sun } from 'lucide-react';
import TopNav from '../components/TopNav';
import PitchShotMap from '../components/PitchShotMap';
import { supabase } from '../supabaseClient';
import {
  computeTimelineWithScores,
  reorderTimelineEvents,
  resolveMatchTimelineEvents,
  getLocalTimelineEvents,
  saveLocalTimelineEvents
} from '../utils/timelineUtils';
import { parseTournament, getTournamentAvailablePlayers } from '../utils/tournamentUtils';
import { FEATURE_KEYS, isFeatureEnabled, getDCHistoryMatches } from '../utils/featureFlags';
import {
  DEFAULT_COLUMN_ORDER,
  getTrackerColumnOrder,
  getTrackerHiddenColumns,
  getSavedMatchRoles,
  saveMatchRoleSelection,
  saveUserPreferences,
  subscribeToUserPreferences,
  getDCPinnedPlayers,
  saveDCPinnedPlayers,
  getDCSortMode
} from '../utils/userPreferences';
import {
  queueOfflineMatchSnapshot,
  isOfflineId,
  markServerUnreachable
} from '../utils/offlineSync';

function useDebounceCallback(callback, delay) {
  const timeoutRef = useRef(null);
  return useCallback((...args) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]);
}

export default function MatchTrackerView({
  activeMatch,
  matches,
  setMatches,
  squad,
  teamInfo,
  setCurrentView,
  setActiveMatchId,
  allGoalEvents,
  setAllGoalEvents,
  returnToTournament,
  setReturnToTournament,
  setActiveTournamentName
}) {
  const [editingOpponent, setEditingOpponent] = useState(false);
  const [opponentInput, setOpponentInput] = useState(activeMatch?.opponent || '');
  const [showAmendSquad, setShowAmendSquad] = useState(false);
  const [assistModalScorer, setAssistModalScorer] = useState(null);
  const [attemptModalPlayer, setAttemptModalPlayer] = useState(null);
  const [shotModal, setShotModal] = useState(null); // { step: 'pitch'|'player'|'outcome', location: {x,y}|null, playerId: string|null, fromPlayerRow: boolean }
  const [pendingGoalLocation, setPendingGoalLocation] = useState(null);
  const [playerToRemove, setPlayerToRemove] = useState(null); // { id, name }
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('matchTrackerViewMode') || 'table';
  });
  const [showGkDialog, setShowGkDialog] = useState(false);
  const [showCaptainDialog, setShowCaptainDialog] = useState(false);
  const [showPotmDialog, setShowPotmDialog] = useState(false);
  const [showDCDialog, setShowDCDialog] = useState(false);
  const [showOnPitchDialog, setShowOnPitchDialog] = useState(false);
  const [mainTrackerOnPitchOnly, setMainTrackerOnPitchOnly] = useState(true);
  const [showAllShotPlayers, setShowAllShotPlayers] = useState(false);
  const [showAllAssistPlayers, setShowAllAssistPlayers] = useState(false);
  const [keepScreenAwake, setKeepScreenAwake] = useState(false);
  const wakeLockRef = useRef(null);
  const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [onPitchPlayerIds, setOnPitchPlayerIds] = useState(() => {
    if (!activeMatch?.id) return null;
    try {
      const saved = localStorage.getItem(`match_on_pitch_${activeMatch.id}`);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [showUnifiedTracker, setShowUnifiedTracker] = useState(false);
  const [unifiedShotDraft, setUnifiedShotDraft] = useState(null);
  const [activeUnifiedGkId, setActiveUnifiedGkId] = useState(null);
  const [justTappedSaveId, setJustTappedSaveId] = useState(null);
  const [justTappedDCId, setJustTappedDCId] = useState(null);
  const [dcSortMode, setDcSortMode] = useState(() => getDCSortMode());
  const [dcPinnedIds, setDcPinnedIds] = useState(() => getDCPinnedPlayers(teamInfo));
  const [dcOrderSnapshot, setDcOrderSnapshot] = useState([]);
  const [dcPinEditMode, setDcPinEditMode] = useState(false);
  const [columnOrder, setColumnOrder] = useState(() => getTrackerColumnOrder(teamInfo));
  const [hiddenColumns, setHiddenColumns] = useState(() => getTrackerHiddenColumns(teamInfo));
  const [showColumnOrderModal, setShowColumnOrderModal] = useState(false);
  const [draggedColKey, setDraggedColKey] = useState(null);
  const [dragOverColKey, setDragOverColKey] = useState(null);

  const showAttempts = isFeatureEnabled(teamInfo, FEATURE_KEYS.ATTEMPTS);
  const showShotPitchMap = showAttempts && isFeatureEnabled(teamInfo, FEATURE_KEYS.SHOT_PITCH_MAP);
  const showDC = isFeatureEnabled(teamInfo, FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS);
  const showPotm = isFeatureEnabled(teamInfo, FEATURE_KEYS.PLAYER_OF_THE_MATCH);
  const showCaptain = isFeatureEnabled(teamInfo, FEATURE_KEYS.CAPTAIN);

  useEffect(() => {
    setColumnOrder(getTrackerColumnOrder(teamInfo));
    setHiddenColumns(getTrackerHiddenColumns(teamInfo));
    setDcPinnedIds(getDCPinnedPlayers(teamInfo));
    setDcSortMode(getDCSortMode());
    return subscribeToUserPreferences(() => {
      setColumnOrder(getTrackerColumnOrder(teamInfo));
      setHiddenColumns(getTrackerHiddenColumns(teamInfo));
      setDcPinnedIds(getDCPinnedPlayers(teamInfo));
      setDcSortMode(getDCSortMode());
    });
  }, [teamInfo?.id]);

  const updateColumnOrder = (newOrder) => {
    setColumnOrder(newOrder);
    saveUserPreferences({
      tracker_column_order: newOrder
    });
  };

  const updateHiddenColumns = (newHidden) => {
    setHiddenColumns(newHidden);
    saveUserPreferences({
      tracker_hidden_columns: newHidden
    });
  };

  // Timeline State
  const [goalEvents, setGoalEvents] = useState(() => {
    if (!activeMatch?.id) return [];
    const fromProps = Array.isArray(allGoalEvents)
      ? allGoalEvents.filter((e) => String(e.match_id) === String(activeMatch.id))
      : [];
    if (fromProps.length > 0) return fromProps;
    return getLocalTimelineEvents(activeMatch.id);
  });
  const [_attemptEvents, setAttemptEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [showTimeline, setShowTimeline] = useState(true);
  const [assigningGoalEvent, setAssigningGoalEvent] = useState(null);
  const [assignStep, setAssignStep] = useState('scorer'); // 'scorer' | 'assister'
  const [selectedScorerId, setSelectedScorerId] = useState(null);
  const reorderSaveTimerRef = useRef(null);
  const shotStageRef = useRef(null);
  const latestStateRef = useRef({ match: activeMatch, goalEvents });

  useEffect(() => {
    latestStateRef.current = { match: activeMatch, goalEvents };
    if (activeMatch && (isOfflineId(activeMatch.id) || (typeof navigator !== 'undefined' && !navigator.onLine))) {
      queueOfflineMatchSnapshot(activeMatch, { goalEvents });
    }
  }, [activeMatch, goalEvents]);

  const queueLatestOffline = (overrideMatch = null, overrideOptions = {}) => {
    const targetMatch = overrideMatch || latestStateRef.current.match;
    if (!targetMatch) return;
    queueOfflineMatchSnapshot(targetMatch, {
      goalEvents: overrideOptions.goalEvents || latestStateRef.current.goalEvents,
      ...overrideOptions
    });
  };

  const handleSetViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('matchTrackerViewMode', mode);
    saveUserPreferences({ tracker_view_mode: mode });
  };

  // Fetch goal events for active match (with fallback to match stats if missing)
  const fetchGoalEvents = async () => {
    setLoadingEvents(true);
    const resolved = await resolveMatchTimelineEvents(supabase, activeMatch, [], allGoalEvents || []);
    setGoalEvents(resolved);
    if (setAllGoalEvents && activeMatch?.id) {
      setAllGoalEvents((prev) => {
        const others = (prev || []).filter((e) => String(e.match_id) !== String(activeMatch.id));
        return [...others, ...resolved];
      });
    }
    setLoadingEvents(false);
  };

  // Fetch attempt events for active match
  const fetchAttemptEvents = async () => {
    try {
      const { data, error } = await supabase
        .from('attempt_events')
        .select('*')
        .eq('match_id', activeMatch.id)
        .order('created_at', { ascending: true });
      if (!error && data) {
        setAttemptEvents(data);
      }
    } catch {
      // attempt_events table may not exist yet
    }
  };

  useEffect(() => {
    if (activeMatch?.id) {
      fetchGoalEvents();
      if (showAttempts) {
        fetchAttemptEvents();
      }
    }
  }, [activeMatch?.id, showAttempts]);

  // Autosave Match Score
  const saveMatchScoreToDb = useDebounceCallback(async (matchId, teamGoals, oppGoals) => {
    if (isOfflineId(matchId) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      queueLatestOffline();
      return;
    }
    try {
      const { error } = await supabase.from('matches').update({ team_goals: teamGoals, opponent_goals: oppGoals }).eq('id', matchId);
      if (error) {
        markServerUnreachable(true);
        queueLatestOffline();
      }
    } catch {
      markServerUnreachable(true);
      queueLatestOffline();
    }
  }, 1000);

  const updateMatchScore = async (matchId, team, delta) => {
    const m = matches.find((x) => x.id === matchId);
    if (!m) return;
    const newVal = Math.max(0, m[team] + delta);
    const updatedMatch = { ...m, [team]: newVal };
    setMatches(matches.map((match) => (match.id === matchId ? updatedMatch : match)));
    const tGoals = team === 'team_goals' ? newVal : m.team_goals;
    const oGoals = team === 'opponent_goals' ? newVal : m.opponent_goals;
    saveMatchScoreToDb(matchId, tGoals, oGoals);

    if (delta > 0) {
      // Adding a goal directly on the scoreboard
      const isTeam = team === 'team_goals';
      const newEvent = {
        match_id: matchId,
        scorer_id: isTeam ? 'UNASSIGNED' : 'OPPONENT',
        assister_id: null,
        created_at: new Date().toISOString()
      };
      let savedEvt = { ...newEvent, id: `local-${matchId}-${Date.now()}` };
      if (!isOfflineId(matchId) && (typeof navigator === 'undefined' || navigator.onLine)) {
        try {
          const { data, error } = await supabase.from('goal_events').insert([newEvent]).select().single();
          if (!error && data) {
            savedEvt = data;
          } else if (error) {
            markServerUnreachable(true);
            queueLatestOffline(updatedMatch);
          }
        } catch {
          markServerUnreachable(true);
          queueLatestOffline(updatedMatch);
        }
      } else {
        queueLatestOffline(updatedMatch);
      }
      setGoalEvents((prev) => {
        const next = [...prev, savedEvt];
        saveLocalTimelineEvents(matchId, next);
        return next;
      });
      if (setAllGoalEvents) setAllGoalEvents((prev) => [...(prev || []), savedEvt]);
    } else if (delta < 0) {
      // Decrementing from the scoreboard: remove latest goal of this team
      const isTeam = team === 'team_goals';
      const matchingEvents = goalEvents.filter((e) => isTeam ? e.scorer_id !== 'OPPONENT' : e.scorer_id === 'OPPONENT');
      const latest = matchingEvents[matchingEvents.length - 1];
      if (latest) {
        await deleteGoalEvent(latest.id, false);
      }
    }
  };

  // Autosave Player Stats (Goals, Assists, Saves, Attempts, DC, GK, Captain, POTM status)
  const savePlayerStatToDb = useDebounceCallback(async (matchId, playerId, goals, assists, saves, is_goalkeeper, attempts, defensive_contributions, is_captain, is_potm) => {
    if (isOfflineId(matchId) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      queueLatestOffline();
      return;
    }

    const payload = {
      match_id: matchId,
      player_id: playerId,
      goals,
      assists,
      saves,
      is_goalkeeper
    };
    if (attempts !== undefined) payload.attempts = attempts;
    if (defensive_contributions !== undefined) payload.defensive_contributions = defensive_contributions;
    if (is_captain !== undefined) payload.is_captain = is_captain;
    if (is_potm !== undefined) payload.is_potm = is_potm;

    try {
      let { error } = await supabase.from('match_stats').upsert(payload, { onConflict: 'match_id,player_id' });
      if (error && (error.message?.includes('column') || error.code === '42703' || error.code === 'PGRST204')) {
        const secondaryPayload = {
          match_id: matchId,
          player_id: playerId,
          goals,
          assists,
          saves,
          is_goalkeeper
        };
        if (attempts !== undefined) secondaryPayload.attempts = attempts;
        if (defensive_contributions !== undefined) secondaryPayload.defensive_contributions = defensive_contributions;
        const retry = await supabase.from('match_stats').upsert(secondaryPayload, { onConflict: 'match_id,player_id' });
        if (retry.error && (retry.error.message?.includes('column') || retry.error.code === '42703' || retry.error.code === 'PGRST204')) {
          const fallback = await supabase.from('match_stats').upsert(
            { match_id: matchId, player_id: playerId, goals, assists, saves, is_goalkeeper },
            { onConflict: 'match_id,player_id' }
          );
          if (fallback.error) {
            console.warn('Error saving player stat (fallback) — queued offline:', fallback.error);
            markServerUnreachable(true);
            queueLatestOffline();
          }
        } else if (retry.error) {
          console.warn('Error saving player stat (retry) — queued offline:', retry.error);
          markServerUnreachable(true);
          queueLatestOffline();
        }
      } else if (error) {
        console.warn('Error saving player stat — queued offline:', error);
        markServerUnreachable(true);
        queueLatestOffline();
      }
    } catch {
      markServerUnreachable(true);
      queueLatestOffline();
    }
  }, 1000);

  const updateMatchStat = (matchId, playerId, stat, delta) => {
    const m = matches.find((x) => x.id === matchId);
    if (!m) return;
    const currentStat = m.stats[playerId]?.[stat] || 0;
    const newVal = Math.max(0, currentStat + delta);

    setMatches(
      matches.map((match) => {
        if (match.id !== matchId) return match;
        return {
          ...match,
          stats: {
            ...match.stats,
            [playerId]: {
              ...match.stats[playerId],
              [stat]: newVal
            }
          }
        };
      })
    );

    const g = stat === 'goals' ? newVal : m.stats[playerId]?.goals || 0;
    const a = stat === 'assists' ? newVal : m.stats[playerId]?.assists || 0;
    const s = stat === 'saves' ? newVal : m.stats[playerId]?.saves || 0;
    const att = stat === 'attempts' ? newVal : m.stats[playerId]?.attempts || 0;
    const dc = stat === 'defensive_contributions' ? newVal : m.stats[playerId]?.defensive_contributions || 0;
    const isGk = stat === 'is_goalkeeper' ? newVal : m.stats[playerId]?.is_goalkeeper || false;
    const isCap = m.stats[playerId]?.is_captain || false;
    const isPotm = m.stats[playerId]?.is_potm || false;
    savePlayerStatToDb(matchId, playerId, g, a, s, isGk, att, dc, isCap, isPotm);
  };

  const toggleGoalkeeper = (matchId, playerId) => {
    const m = matches.find((x) => x.id === matchId);
    if (!m) return;
    const currentIsGk = m.stats[playerId]?.is_goalkeeper || false;
    const newVal = !currentIsGk;

    setMatches(
      matches.map((match) => {
        if (match.id !== matchId) return match;
        return {
          ...match,
          stats: {
            ...match.stats,
            [playerId]: {
              ...match.stats[playerId],
              is_goalkeeper: newVal
            }
          }
        };
      })
    );

    const g = m.stats[playerId]?.goals || 0;
    const a = m.stats[playerId]?.assists || 0;
    const s = m.stats[playerId]?.saves || 0;
    const att = m.stats[playerId]?.attempts || 0;
    const dc = m.stats[playerId]?.defensive_contributions || 0;
    const isCap = m.stats[playerId]?.is_captain || false;
    const isPotm = m.stats[playerId]?.is_potm || false;
    savePlayerStatToDb(matchId, playerId, g, a, s, newVal, att, dc, isCap, isPotm);
  };

  const toggleCaptain = (matchId, playerId) => {
    const m = matches.find((x) => x.id === matchId);
    if (!m) return;
    const savedRoles = getSavedMatchRoles(matchId);
    const currentIsCaptain = m.stats[playerId]?.is_captain ?? savedRoles.captains.includes(playerId);
    const newVal = !currentIsCaptain;

    const updatedStats = { ...m.stats };
    updatedStats[playerId] = {
      ...updatedStats[playerId],
      is_captain: newVal
    };

    setMatches(
      matches.map((match) => {
        if (match.id !== matchId) return match;
        return {
          ...match,
          stats: updatedStats
        };
      })
    );

    const nextCaptains = Object.keys(updatedStats).filter(
      (pid) => updatedStats[pid]?.is_captain ?? (pid !== playerId && savedRoles.captains.includes(pid))
    );
    saveMatchRoleSelection(matchId, 'captains', nextCaptains);

    const g = m.stats[playerId]?.goals || 0;
    const a = m.stats[playerId]?.assists || 0;
    const s = m.stats[playerId]?.saves || 0;
    const isGk = m.stats[playerId]?.is_goalkeeper || false;
    const att = m.stats[playerId]?.attempts || 0;
    const dc = m.stats[playerId]?.defensive_contributions || 0;
    const isPotm = m.stats[playerId]?.is_potm ?? savedRoles.potm.includes(playerId);
    savePlayerStatToDb(matchId, playerId, g, a, s, isGk, att, dc, newVal, isPotm);
  };

  const togglePotm = (matchId, playerId) => {
    const m = matches.find((x) => x.id === matchId);
    if (!m) return;
    const savedRoles = getSavedMatchRoles(matchId);
    const currentIsPotm = m.stats[playerId]?.is_potm ?? savedRoles.potm.includes(playerId);
    const newVal = !currentIsPotm;

    const updatedStats = { ...m.stats };
    updatedStats[playerId] = {
      ...updatedStats[playerId],
      is_potm: newVal
    };

    setMatches(
      matches.map((match) => {
        if (match.id !== matchId) return match;
        return {
          ...match,
          stats: updatedStats
        };
      })
    );

    const nextPotm = Object.keys(updatedStats).filter(
      (pid) => updatedStats[pid]?.is_potm ?? (pid !== playerId && savedRoles.potm.includes(pid))
    );
    saveMatchRoleSelection(matchId, 'potm', nextPotm);

    const g = m.stats[playerId]?.goals || 0;
    const a = m.stats[playerId]?.assists || 0;
    const s = m.stats[playerId]?.saves || 0;
    const isGk = m.stats[playerId]?.is_goalkeeper || false;
    const att = m.stats[playerId]?.attempts || 0;
    const dc = m.stats[playerId]?.defensive_contributions || 0;
    const isCap = m.stats[playerId]?.is_captain ?? savedRoles.captains.includes(playerId);
    savePlayerStatToDb(matchId, playerId, g, a, s, isGk, att, dc, isCap, newVal);
  };

  const handleAddGoalClick = (playerId) => {
    setShowAllAssistPlayers(false);
    setAssistModalScorer(playerId);
  };

  const handleAttemptClick = (playerId) => {
    setShowAllShotPlayers(false);
    if (showShotPitchMap) {
      setShotModal({ step: 'pitch', location: null, playerId, fromPlayerRow: true });
    } else {
      setAttemptModalPlayer(playerId);
    }
  };

  const openShotDialog = () => {
    setShowAllShotPlayers(false);
    setShotModal({ step: 'pitch', location: null, playerId: null, fromPlayerRow: false });
  };

  const recordAttemptOutcome = async (playerId, result, location = null) => {
    if (!playerId) return;

    if (result === 'scored') {
      setPendingGoalLocation(location);
      setAttemptModalPlayer(null);
      setShotModal(null);
      setShowAllAssistPlayers(false);
      setAssistModalScorer(playerId);
    } else {
      updateMatchStat(activeMatch.id, playerId, 'attempts', 1);
      setAttemptModalPlayer(null);
      setShotModal(null);

      // Persist to attempt_events table
      try {
        const payload = {
          match_id: activeMatch.id,
          player_id: playerId,
          result: result,
          created_at: new Date().toISOString()
        };
        if (location) {
          payload.pitch_x = location.x;
          payload.pitch_y = location.y;
        }
        const { data, error } = await supabase.from('attempt_events').insert([payload]).select().single();
        if (!error && data) {
          setAttemptEvents((prev) => [...prev, data]);
        }
      } catch (err) {
        console.warn('Could not insert attempt_event:', err);
      }
    }
  };

  const handleAttemptResult = async (result) => {
    await recordAttemptOutcome(attemptModalPlayer, result, null);
  };

  const handleShotModalOutcome = async (result) => {
    if (!shotModal?.playerId) return;
    await recordAttemptOutcome(shotModal.playerId, result, shotModal.location);
  };

  const handleAttemptDecrement = async (playerId) => {
    const m = matches.find((x) => x.id === activeMatch.id);
    if (!m || (m.stats[playerId]?.attempts || 0) === 0) return;

    updateMatchStat(activeMatch.id, playerId, 'attempts', -1);

    try {
      const { data } = await supabase
        .from('attempt_events')
        .select('id')
        .eq('match_id', activeMatch.id)
        .eq('player_id', playerId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        await supabase.from('attempt_events').delete().eq('id', data[0].id);
        setAttemptEvents((prev) => {
          const idx = [...prev].reverse().findIndex((e) => e.id === data[0].id);
          if (idx === -1) return prev;
          const actualIdx = prev.length - 1 - idx;
          return prev.filter((_, i) => i !== actualIdx);
        });
      }
    } catch (err) {
      console.warn('Could not delete from attempt_events:', err);
    }
  };

  const processGoalWithAssist = async (assisterId) => {
    const scorerId = assistModalScorer;
    const shotLoc = pendingGoalLocation;
    setAssistModalScorer(null);
    setPendingGoalLocation(null);

    // Get current state to ensure we have the latest values for DB
    const m = matches.find((x) => x.id === activeMatch.id);
    if (!m) return;
    
    const scorerStats = m.stats[scorerId] || { goals: 0, assists: 0, saves: 0, attempts: 0, defensive_contributions: 0 };
    const assisterStats = assisterId ? (m.stats[assisterId] || { goals: 0, assists: 0, saves: 0, attempts: 0, defensive_contributions: 0 }) : null;

    const newScorerGoals = scorerStats.goals + 1;
    const newScorerAttempts = showAttempts ? (scorerStats.attempts || 0) + 1 : (scorerStats.attempts || 0);
    const newAssisterAssists = assisterStats ? assisterStats.assists + 1 : 0;
    const newTeamGoals = m.team_goals + 1;

    // Update state functionally so both updates apply
    setMatches((prev) => prev.map(match => {
      if (match.id !== activeMatch.id) return match;
      const newStats = { ...match.stats };
      newStats[scorerId] = { ...scorerStats, goals: newScorerGoals, attempts: newScorerAttempts };
      if (assisterId) {
        newStats[assisterId] = { ...assisterStats, assists: newAssisterAssists };
      }
      return { ...match, stats: newStats, team_goals: newTeamGoals };
    }));

    // Save match score
    saveMatchScoreToDb(activeMatch.id, newTeamGoals, m.opponent_goals);

    // Save directly to DB to avoid debounce cancellation
    // Helper to safely upsert
    const upsertSafe = async (pid, st) => {
      if (isOfflineId(activeMatch.id) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        queueLatestOffline();
        return;
      }
      const payload = {
        match_id: activeMatch.id,
        player_id: pid,
        goals: st.goals,
        assists: st.assists,
        saves: st.saves || 0,
        is_goalkeeper: st.is_goalkeeper || false
      };
      if (st.attempts !== undefined) payload.attempts = st.attempts;
      if (st.defensive_contributions !== undefined) payload.defensive_contributions = st.defensive_contributions;

      try {
        let { error } = await supabase.from('match_stats').upsert(payload, { onConflict: 'match_id,player_id' });
        if (error && (error.message?.includes('column') || error.code === '42703')) {
          const retry = await supabase.from('match_stats').upsert(
            { match_id: activeMatch.id, player_id: pid, goals: st.goals, assists: st.assists, saves: st.saves || 0, is_goalkeeper: st.is_goalkeeper || false },
            { onConflict: 'match_id,player_id' }
          );
          if (retry.error) {
            markServerUnreachable(true);
            queueLatestOffline();
          }
        } else if (error) {
          markServerUnreachable(true);
          queueLatestOffline();
        }
      } catch {
        markServerUnreachable(true);
        queueLatestOffline();
      }
    };

    await upsertSafe(scorerId, {
      goals: newScorerGoals,
      assists: scorerStats.assists,
      saves: scorerStats.saves,
      is_goalkeeper: scorerStats.is_goalkeeper,
      attempts: newScorerAttempts,
      defensive_contributions: scorerStats.defensive_contributions || 0
    });
    if (assisterId) {
      await upsertSafe(assisterId, {
        goals: assisterStats.goals,
        assists: newAssisterAssists,
        saves: assisterStats.saves,
        is_goalkeeper: assisterStats.is_goalkeeper,
        attempts: assisterStats.attempts || 0,
        defensive_contributions: assisterStats.defensive_contributions || 0
      });
    }

    // Log the goal event in the database
    const evtPayload = {
      match_id: activeMatch.id,
      scorer_id: scorerId,
      assister_id: assisterId,
      created_at: new Date().toISOString()
    };
    let resolvedEvt = { ...evtPayload, id: `local-${activeMatch.id}-${Date.now()}` };
    if (!isOfflineId(activeMatch.id) && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        const { data: newEvt, error: evtError } = await supabase.from('goal_events').insert([evtPayload]).select().single();
        if (!evtError && newEvt) {
          resolvedEvt = newEvt;
        }
      } catch {
        markServerUnreachable(true);
      }
    }

    setGoalEvents((prev) => {
      const next = [...prev, resolvedEvt];
      saveLocalTimelineEvents(activeMatch.id, next);
      return next;
    });
    if (setAllGoalEvents) setAllGoalEvents((prev) => [...(prev || []), resolvedEvt]);

    // Also log to attempt_events as scored if attempts tracking is enabled
    if (showAttempts) {
      try {
        const attemptPayload = {
          match_id: activeMatch.id,
          player_id: scorerId,
          result: 'scored',
          created_at: new Date().toISOString()
        };
        if (shotLoc) {
          attemptPayload.pitch_x = shotLoc.x;
          attemptPayload.pitch_y = shotLoc.y;
        }
        const { data: attemptEvt } = await supabase.from('attempt_events').insert([attemptPayload]).select().single();
        if (attemptEvt) {
          setAttemptEvents((prev) => [...prev, attemptEvt]);
        }
      } catch (err) {
        console.warn('Could not insert scored attempt_event:', err);
      }
    }
  };

  const processGoalDecrement = async (playerId) => {
    const m = matches.find((x) => x.id === activeMatch.id);
    if (!m || (m.stats[playerId]?.goals || 0) === 0) return;
    
    let eventToDelete = null;

    // Fetch latest event to delete
    const { data } = await supabase
      .from('goal_events')
      .select('id, assister_id')
      .eq('match_id', activeMatch.id)
      .eq('scorer_id', playerId)
      .order('created_at', { ascending: false })
      .limit(1);
      
    if (data && data.length > 0) {
      eventToDelete = data[0];
    } else {
      eventToDelete = [...goalEvents].reverse().find((e) => String(e.scorer_id) === String(playerId)) || null;
    }

    const newTeamGoals = Math.max(0, m.team_goals - 1);

    // Update state functionally
    setMatches((prev) => prev.map(match => {
      if (match.id !== activeMatch.id) return match;
      const newStats = { ...match.stats };
      
      const pStats = newStats[playerId];
      const newAttempts = showAttempts ? Math.max(0, (pStats.attempts || 0) - 1) : (pStats.attempts || 0);
      newStats[playerId] = { ...pStats, goals: Math.max(0, pStats.goals - 1), attempts: newAttempts };
      
      if (eventToDelete && eventToDelete.assister_id) {
        const aStats = newStats[eventToDelete.assister_id];
        if (aStats) {
          newStats[eventToDelete.assister_id] = { ...aStats, assists: Math.max(0, aStats.assists - 1) };
        }
      }
      
      return { ...match, stats: newStats, team_goals: newTeamGoals };
    }));

    // Save DB
    saveMatchScoreToDb(activeMatch.id, newTeamGoals, m.opponent_goals);
    
    const upsertSafe = async (pid, st) => {
      const payload = {
        match_id: activeMatch.id,
        player_id: pid,
        goals: st.goals,
        assists: st.assists,
        saves: st.saves || 0,
        is_goalkeeper: st.is_goalkeeper || false
      };
      if (st.attempts !== undefined) payload.attempts = st.attempts;
      if (st.defensive_contributions !== undefined) payload.defensive_contributions = st.defensive_contributions;

      let { error } = await supabase.from('match_stats').upsert(payload, { onConflict: 'match_id,player_id' });
      if (error && (error.message?.includes('column') || error.code === '42703')) {
        await supabase.from('match_stats').upsert(
          { match_id: activeMatch.id, player_id: pid, goals: st.goals, assists: st.assists, saves: st.saves || 0, is_goalkeeper: st.is_goalkeeper || false },
          { onConflict: 'match_id,player_id' }
        );
      }
    };

    const decAttempts = showAttempts ? Math.max(0, (m.stats[playerId]?.attempts || 0) - 1) : (m.stats[playerId]?.attempts || 0);
    await upsertSafe(playerId, {
      goals: Math.max(0, m.stats[playerId].goals - 1),
      assists: m.stats[playerId].assists,
      saves: m.stats[playerId].saves,
      is_goalkeeper: m.stats[playerId].is_goalkeeper,
      attempts: decAttempts,
      defensive_contributions: m.stats[playerId]?.defensive_contributions || 0
    });

    if (eventToDelete) {
      await supabase.from('goal_events').delete().eq('id', eventToDelete.id);
      setGoalEvents((prev) => {
        const next = prev.filter((e) => e.id !== eventToDelete.id);
        saveLocalTimelineEvents(activeMatch.id, next);
        return next;
      });
      if (setAllGoalEvents) setAllGoalEvents((prev) => prev.filter((e) => e.id !== eventToDelete.id));

      if (showAttempts) {
        try {
          const { data: attData } = await supabase
            .from('attempt_events')
            .select('id')
            .eq('match_id', activeMatch.id)
            .eq('player_id', playerId)
            .eq('result', 'scored')
            .order('created_at', { ascending: false })
            .limit(1);
          if (attData && attData.length > 0) {
            await supabase.from('attempt_events').delete().eq('id', attData[0].id);
            setAttemptEvents((prev) => prev.filter((e) => e.id !== attData[0].id));
          }
        } catch (err) {
          console.warn('Could not delete scored attempt event:', err);
        }
      }
      
      if (eventToDelete.assister_id && m.stats[eventToDelete.assister_id]) {
        const aStats = m.stats[eventToDelete.assister_id];
        await upsertSafe(eventToDelete.assister_id, {
          goals: aStats.goals,
          assists: Math.max(0, aStats.assists - 1),
          saves: aStats.saves,
          is_goalkeeper: aStats.is_goalkeeper,
          attempts: aStats.attempts || 0,
          defensive_contributions: aStats.defensive_contributions || 0
        });
      }
    }
  };

  const saveReorderedEventsToDb = (eventsToSave) => {
    if (reorderSaveTimerRef.current) {
      clearTimeout(reorderSaveTimerRef.current);
    }
    reorderSaveTimerRef.current = setTimeout(async () => {
      for (let i = 0; i < eventsToSave.length; i++) {
        await supabase
          .from('goal_events')
          .update({ created_at: eventsToSave[i].created_at })
          .eq('id', eventsToSave[i].id);
      }
    }, 350);
  };

  const handleMoveGoal = (fromIndex, toIndex) => {
    if (activeMatch?.status === 'finished' || fromIndex === toIndex) return;
    setGoalEvents((prev) => {
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const reordered = reorderTimelineEvents(prev, fromIndex, toIndex, activeMatch.date);
      saveLocalTimelineEvents(activeMatch.id, reordered);
      if (setAllGoalEvents) {
        setAllGoalEvents((allPrev) => {
          const others = allPrev.filter((e) => e.match_id !== activeMatch.id);
          return [...others, ...reordered];
        });
      }
      saveReorderedEventsToDb(reordered);
      return reordered;
    });
  };

  const deleteGoalEvent = async (eventId, shouldUpdateScore = true) => {
    const eventToDelete = goalEvents.find((e) => e.id === eventId);
    if (!eventToDelete) return;

    setGoalEvents((prev) => {
      const next = prev.filter((e) => e.id !== eventId);
      saveLocalTimelineEvents(activeMatch.id, next);
      return next;
    });
    if (setAllGoalEvents) setAllGoalEvents((prev) => prev.filter((e) => e.id !== eventId));

    await supabase.from('goal_events').delete().eq('id', eventId);

    if (shouldUpdateScore) {
      const m = matches.find((x) => x.id === activeMatch.id);
      if (!m) return;

      const isOpponent = eventToDelete.scorer_id === 'OPPONENT';
      const isUnassigned = eventToDelete.scorer_id === 'UNASSIGNED' || !eventToDelete.scorer_id;

      if (isOpponent) {
        const newOppGoals = Math.max(0, m.opponent_goals - 1);
        setMatches((prev) => prev.map((match) => (match.id === activeMatch.id ? { ...match, opponent_goals: newOppGoals } : match)));
        saveMatchScoreToDb(activeMatch.id, m.team_goals, newOppGoals);
      } else {
        const newTeamGoals = Math.max(0, m.team_goals - 1);
        const newStats = { ...m.stats };

        if (!isUnassigned && newStats[eventToDelete.scorer_id]) {
          const sStats = newStats[eventToDelete.scorer_id];
          const newAtt = showAttempts ? Math.max(0, (sStats.attempts || 0) - 1) : (sStats.attempts || 0);
          newStats[eventToDelete.scorer_id] = { ...sStats, goals: Math.max(0, sStats.goals - 1), attempts: newAtt };
          
          const payload = {
            match_id: activeMatch.id,
            player_id: eventToDelete.scorer_id,
            goals: newStats[eventToDelete.scorer_id].goals,
            assists: sStats.assists,
            saves: sStats.saves || 0,
            is_goalkeeper: sStats.is_goalkeeper || false,
            attempts: newAtt,
            defensive_contributions: sStats.defensive_contributions || 0
          };
          let { error } = await supabase.from('match_stats').upsert(payload, { onConflict: 'match_id,player_id' });
          if (error && (error.message?.includes('column') || error.code === '42703')) {
            await supabase.from('match_stats').upsert(
              { match_id: activeMatch.id, player_id: eventToDelete.scorer_id, goals: newStats[eventToDelete.scorer_id].goals, assists: sStats.assists, saves: sStats.saves || 0, is_goalkeeper: sStats.is_goalkeeper || false },
              { onConflict: 'match_id,player_id' }
            );
          }
        }

        if (eventToDelete.assister_id && newStats[eventToDelete.assister_id]) {
          const aStats = newStats[eventToDelete.assister_id];
          newStats[eventToDelete.assister_id] = { ...aStats, assists: Math.max(0, aStats.assists - 1) };
          const payload = {
            match_id: activeMatch.id,
            player_id: eventToDelete.assister_id,
            goals: aStats.goals,
            assists: newStats[eventToDelete.assister_id].assists,
            saves: aStats.saves || 0,
            is_goalkeeper: aStats.is_goalkeeper || false,
            attempts: aStats.attempts || 0,
            defensive_contributions: aStats.defensive_contributions || 0
          };
          let { error } = await supabase.from('match_stats').upsert(payload, { onConflict: 'match_id,player_id' });
          if (error && (error.message?.includes('column') || error.code === '42703')) {
            await supabase.from('match_stats').upsert(
              { match_id: activeMatch.id, player_id: eventToDelete.assister_id, goals: aStats.goals, assists: newStats[eventToDelete.assister_id].assists, saves: aStats.saves || 0, is_goalkeeper: aStats.is_goalkeeper || false },
              { onConflict: 'match_id,player_id' }
            );
          }
        }

        setMatches((prev) => prev.map((match) => (match.id === activeMatch.id ? { ...match, stats: newStats, team_goals: newTeamGoals } : match)));
        saveMatchScoreToDb(activeMatch.id, newTeamGoals, m.opponent_goals);

        if (showAttempts) {
          try {
            const { data: attData } = await supabase
              .from('attempt_events')
              .select('id')
              .eq('match_id', activeMatch.id)
              .eq('player_id', eventToDelete.scorer_id)
              .eq('result', 'scored')
              .order('created_at', { ascending: false })
              .limit(1);
            if (attData && attData.length > 0) {
              await supabase.from('attempt_events').delete().eq('id', attData[0].id);
              setAttemptEvents((prev) => prev.filter((e) => e.id !== attData[0].id));
            }
          } catch (err) {
            console.warn('Could not delete scored attempt event:', err);
          }
        }
      }
    }
  };

  const handleAssignUnassignedGoal = async (assisterId) => {
    if (!assigningGoalEvent || !selectedScorerId) return;
    const eventId = assigningGoalEvent.id;
    const scorerId = selectedScorerId;

    const m = matches.find((x) => x.id === activeMatch.id);
    if (!m) return;

    const scorerStats = m.stats[scorerId] || { goals: 0, assists: 0, saves: 0, attempts: 0, defensive_contributions: 0 };
    const assisterStats = assisterId ? (m.stats[assisterId] || { goals: 0, assists: 0, saves: 0, attempts: 0, defensive_contributions: 0 }) : null;

    const newScorerGoals = scorerStats.goals + 1;
    const newScorerAttempts = showAttempts ? (scorerStats.attempts || 0) + 1 : (scorerStats.attempts || 0);
    const newAssisterAssists = assisterStats ? assisterStats.assists + 1 : 0;

    const newStats = { ...m.stats };
    newStats[scorerId] = { ...scorerStats, goals: newScorerGoals, attempts: newScorerAttempts };
    if (assisterId) {
      newStats[assisterId] = { ...assisterStats, assists: newAssisterAssists };
    }

    setMatches((prev) => prev.map((match) => (match.id === activeMatch.id ? { ...match, stats: newStats } : match)));

    // Upsert player stats with column fallback
    const upsertAssign = async (pid, st) => {
      const payload = {
        match_id: activeMatch.id,
        player_id: pid,
        goals: st.goals,
        assists: st.assists,
        saves: st.saves || 0,
        is_goalkeeper: st.is_goalkeeper || false,
        attempts: st.attempts || 0,
        defensive_contributions: st.defensive_contributions || 0
      };
      let { error } = await supabase.from('match_stats').upsert(payload, { onConflict: 'match_id,player_id' });
      if (error && (error.message?.includes('column') || error.code === '42703')) {
        await supabase.from('match_stats').upsert(
          { match_id: activeMatch.id, player_id: pid, goals: st.goals, assists: st.assists, saves: st.saves || 0, is_goalkeeper: st.is_goalkeeper || false },
          { onConflict: 'match_id,player_id' }
        );
      }
    };

    await upsertAssign(scorerId, {
      goals: newScorerGoals,
      assists: scorerStats.assists,
      saves: scorerStats.saves,
      is_goalkeeper: scorerStats.is_goalkeeper,
      attempts: newScorerAttempts,
      defensive_contributions: scorerStats.defensive_contributions || 0
    });
    if (assisterId) {
      await upsertAssign(assisterId, {
        goals: assisterStats.goals,
        assists: newAssisterAssists,
        saves: assisterStats.saves,
        is_goalkeeper: assisterStats.is_goalkeeper,
        attempts: assisterStats.attempts || 0,
        defensive_contributions: assisterStats.defensive_contributions || 0
      });
    }

    // Update goal_event row
    await supabase
      .from('goal_events')
      .update({ scorer_id: scorerId, assister_id: assisterId })
      .eq('id', eventId);

    setGoalEvents((prev) => {
      const next = prev.map((e) => (e.id === eventId ? { ...e, scorer_id: scorerId, assister_id: assisterId } : e));
      saveLocalTimelineEvents(activeMatch.id, next);
      return next;
    });
    if (setAllGoalEvents) {
      setAllGoalEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, scorer_id: scorerId, assister_id: assisterId } : e)));
    }

    setAssigningGoalEvent(null);
    setSelectedScorerId(null);
    setAssignStep('scorer');
  };


  const finishMatch = async (matchId) => {
    const finishedMatch = { ...activeMatch, status: 'finished' };
    setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, status: 'finished' } : m)));
    if (isOfflineId(matchId) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      queueLatestOffline(finishedMatch);
    } else {
      try {
        const { error } = await supabase.from('matches').update({ status: 'finished' }).eq('id', matchId);
        if (error) {
          markServerUnreachable(true);
          queueLatestOffline(finishedMatch);
        }
      } catch {
        markServerUnreachable(true);
        queueLatestOffline(finishedMatch);
      }
    }

    const targetTourney = returnToTournament || (activeMatch?.competition === 'Tournament' && activeMatch?.tournament ? parseTournament(activeMatch.tournament).name : null);

    if (targetTourney) {
      if (setActiveTournamentName) setActiveTournamentName(targetTourney);
      if (setReturnToTournament) setReturnToTournament(targetTourney);
      setCurrentView('tournament');
    } else {
      setCurrentView('matches');
    }
    setActiveMatchId(null);
  };

  const saveEditedOpponent = async () => {
    if (!opponentInput.trim()) return;
    const newName = opponentInput.trim();
    const updatedMatch = { ...activeMatch, opponent: newName };
    setMatches((prev) => prev.map((m) => (m.id === activeMatch.id ? { ...m, opponent: newName } : m)));
    setEditingOpponent(false);
    if (isOfflineId(activeMatch.id) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      queueLatestOffline(updatedMatch);
    } else {
      const { error } = await supabase.from('matches').update({ opponent: newName }).eq('id', activeMatch.id);
      if (error) {
        markServerUnreachable(true);
        queueLatestOffline(updatedMatch);
      }
    }
  };

  const togglePlayerInMatch = async (playerId) => {
    const isCurrentlyInMatch = activeMatch.stats && activeMatch.stats[playerId];
    
    if (isCurrentlyInMatch) {
      // Show custom modal instead of window.confirm
      const pInfo = squad.find((s) => s.id === playerId);
      setPlayerToRemove({ id: playerId, name: pInfo ? pInfo.name : 'this player' });
    } else {
      // Add player
      const initialPlayerStats = { goals: 0, assists: 0, saves: 0, attempts: 0, defensive_contributions: 0 };
      const newStats = { ...activeMatch.stats, [playerId]: initialPlayerStats };
      const updatedMatch = { ...activeMatch, stats: newStats };
      
      setMatches((prev) => prev.map(m => m.id === activeMatch.id ? { ...m, stats: newStats } : m));
      
      if (isOfflineId(activeMatch.id) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        queueLatestOffline(updatedMatch);
        return;
      }

      // Upsert default stats to database with column fallback
      let { error: amendErr } = await supabase.from('match_stats').upsert(
        { match_id: activeMatch.id, player_id: playerId, goals: 0, assists: 0, saves: 0, attempts: 0, defensive_contributions: 0, is_goalkeeper: false },
        { onConflict: 'match_id,player_id' }
      );
      if (amendErr && (amendErr.message?.includes('column') || amendErr.code === '42703')) {
        const retry = await supabase.from('match_stats').upsert(
          { match_id: activeMatch.id, player_id: playerId, goals: 0, assists: 0, saves: 0, is_goalkeeper: false },
          { onConflict: 'match_id,player_id' }
        );
        amendErr = retry.error;
      }
      if (amendErr) {
        markServerUnreachable(true);
        queueLatestOffline(updatedMatch);
      }
    }
  };

  const confirmRemovePlayer = async () => {
    if (!playerToRemove) return;
    const removedPid = playerToRemove.id;
    const newStats = { ...activeMatch.stats };
    delete newStats[removedPid];
    const updatedMatch = { ...activeMatch, stats: newStats };
    setMatches((prev) => prev.map(m => m.id === activeMatch.id ? { ...m, stats: newStats } : m));
    setPlayerToRemove(null);

    if (isOfflineId(activeMatch.id) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      queueLatestOffline(updatedMatch, { removedPlayerIds: [removedPid] });
      return;
    }

    const { error } = await supabase.from('match_stats').delete().eq('match_id', activeMatch.id).eq('player_id', removedPid);
    if (error) {
      markServerUnreachable(true);
      queueLatestOffline(updatedMatch, { removedPlayerIds: [removedPid] });
    }
  };

  if (!activeMatch) return null;

  const savedRoles = getSavedMatchRoles(activeMatch.id);

  const playersInMatch = activeMatch.stats
    ? Object.keys(activeMatch.stats)
        .map((pid) => {
          const pInfo = squad.find((s) => s.id === pid);
          return {
            id: pid,
            name: pInfo ? pInfo.name : 'Unknown Player',
            position: pInfo ? pInfo.position : 'FW',
            goals: activeMatch.stats[pid]?.goals || 0,
            assists: activeMatch.stats[pid]?.assists || 0,
            saves: activeMatch.stats[pid]?.saves || 0,
            attempts: activeMatch.stats[pid]?.attempts || 0,
            defensive_contributions: activeMatch.stats[pid]?.defensive_contributions || 0,
            is_goalkeeper: activeMatch.stats[pid]?.is_goalkeeper || false,
            is_captain: activeMatch.stats[pid]?.is_captain ?? savedRoles.captains.includes(pid),
            is_potm: activeMatch.stats[pid]?.is_potm ?? savedRoles.potm.includes(pid)
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const goalkeepers = playersInMatch.filter((p) => p.is_goalkeeper);
  const captains = playersInMatch.filter((p) => p.is_captain);
  const potmPlayers = playersInMatch.filter((p) => p.is_potm);
  const totalGoals = playersInMatch.reduce((sum, p) => sum + p.goals, 0);
  const totalAssists = playersInMatch.reduce((sum, p) => sum + p.assists, 0);
  const totalSaves = playersInMatch.reduce((sum, p) => sum + p.saves, 0);
  const totalAttempts = playersInMatch.reduce((sum, p) => sum + p.attempts, 0);
  const totalDC = playersInMatch.reduce((sum, p) => sum + p.defensive_contributions, 0);

  // ---------- DC Quick Record ordering ----------
  // Average DCs per appearance over the team's last N previous matches in which DCs were tracked.
  const getHistoricalDCAverages = () => {
    const limit = getDCHistoryMatches(teamInfo);
    const activeDate = activeMatch.date || '';
    const history = (matches || [])
      .filter((m) => {
        if (!m || m.id === activeMatch.id || !m.stats) return false;
        if (activeDate && m.date && m.date > activeDate) return false;
        const statRows = Object.values(m.stats);
        // Skip matches where DCs were not being tracked (no DCs recorded at all)
        return statRows.some((s) => (s?.defensive_contributions || 0) > 0);
      })
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, limit);

    const agg = {};
    history.forEach((m) => {
      Object.entries(m.stats).forEach(([pid, s]) => {
        if (!agg[pid]) agg[pid] = { dc: 0, apps: 0 };
        agg[pid].dc += s?.defensive_contributions || 0;
        agg[pid].apps += 1;
      });
    });
    const averages = {};
    Object.entries(agg).forEach(([pid, { dc, apps }]) => {
      averages[pid] = apps > 0 ? dc / apps : 0;
    });
    return averages;
  };

  const POSITION_RANK = { GK: 0, DEF: 1, MID: 2, FW: 3 };

  const computeDCOrder = (mode, pinnedIds) => {
    const pinnedSet = new Set(pinnedIds.map(String));
    const byName = (a, b) => a.name.localeCompare(b.name);
    let comparator = byName;

    if (mode === 'position') {
      comparator = (a, b) =>
        (POSITION_RANK[a.position] ?? 9) - (POSITION_RANK[b.position] ?? 9) || byName(a, b);
    } else if (mode === 'smart') {
      const averages = getHistoricalDCAverages();
      const score = (p) => p.defensive_contributions * 2 + (averages[p.id] || 0);
      comparator = (a, b) => score(b) - score(a) || byName(a, b);
    }

    const pinned = playersInMatch.filter((p) => pinnedSet.has(String(p.id))).sort(byName);
    const rest = playersInMatch.filter((p) => !pinnedSet.has(String(p.id))).sort(comparator);
    return [...pinned, ...rest].map((p) => p.id);
  };

  // Order is computed once on open using the user's saved default and frozen while
  // the dialog is open, so tiles never jump under the user's finger after a tap.
  const openDCDialog = () => {
    const defaultMode = getDCSortMode();
    setDcSortMode(defaultMode);
    setDcOrderSnapshot(computeDCOrder(defaultMode, dcPinnedIds));
    setDcPinEditMode(false);
    setShowDCDialog(true);
  };

  const openUnifiedTracker = () => {
    const defaultMode = getDCSortMode();
    setDcSortMode(defaultMode);
    setDcOrderSnapshot(computeDCOrder(defaultMode, dcPinnedIds));
    setDcPinEditMode(false);
    setUnifiedShotDraft(null);
    setActiveUnifiedGkId(goalkeepers[0]?.id || null);
    setShowUnifiedTracker(true);
  };

  const recordUnifiedSave = (gkId) => {
    if (!gkId) return;
    updateMatchStat(activeMatch.id, gkId, 'saves', 1);
    setJustTappedSaveId(gkId);
    setTimeout(() => setJustTappedSaveId((curr) => (curr === gkId ? null : curr)), 350);
  };

  const handleUnifiedShotOutcome = async (result) => {
    if (!unifiedShotDraft?.playerId) return;
    const { playerId, location } = unifiedShotDraft;
    setUnifiedShotDraft(null);
    await recordAttemptOutcome(playerId, result, location);
  };

  const closeDCDialog = () => {
    setShowDCDialog(false);
    setDcPinEditMode(false);
  };

  const changeDCSortMode = (mode) => {
    setDcSortMode(mode);
    setDcOrderSnapshot(computeDCOrder(mode, dcPinnedIds));
  };

  const toggleDCPin = (playerId) => {
    const id = String(playerId);
    const next = dcPinnedIds.includes(id) ? dcPinnedIds.filter((p) => p !== id) : [...dcPinnedIds, id];
    setDcPinnedIds(next);
    saveDCPinnedPlayers(teamInfo, next);
    setDcOrderSnapshot(computeDCOrder(dcSortMode, next));
  };

  const recordDC = (playerId) => {
    updateMatchStat(activeMatch.id, playerId, 'defensive_contributions', 1);
    setJustTappedDCId(playerId);
    setTimeout(() => setJustTappedDCId((curr) => (curr === playerId ? null : curr)), 350);
  };

  const dcOrderedPlayers = (() => {
    const byId = new Map(playersInMatch.map((p) => [p.id, p]));
    const ordered = dcOrderSnapshot.map((id) => byId.get(id)).filter(Boolean);
    // Players added to the squad while the dialog is open go to the end
    const seen = new Set(dcOrderSnapshot);
    playersInMatch.forEach((p) => {
      if (!seen.has(p.id)) ordered.push(p);
    });
    return ordered;
  })();
  useEffect(() => {
    if (!showUnifiedTracker) return;
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, [showUnifiedTracker]);

  useEffect(() => {
    if (!keepScreenAwake || !wakeLockSupported) {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const requestWakeLock = async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        wakeLockRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
        });
      } catch {
        // Wake lock request rejected (e.g. low battery or background tab)
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        requestWakeLock();
      }
    };

    requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [keepScreenAwake, wakeLockSupported]);

  useEffect(() => {
    if (!activeMatch?.id) {
      setOnPitchPlayerIds(null);
      return;
    }
    try {
      const saved = localStorage.getItem(`match_on_pitch_${activeMatch.id}`);
      setOnPitchPlayerIds(saved ? JSON.parse(saved) : null);
    } catch {
      setOnPitchPlayerIds(null);
    }
  }, [activeMatch?.id]);

  const dcPinnedSet = new Set(dcPinnedIds);
  const onPitchSet = Array.isArray(onPitchPlayerIds) ? new Set(onPitchPlayerIds.map(String)) : null;
  const onPitchPlayers = onPitchSet
    ? playersInMatch.filter((p) => onPitchSet.has(String(p.id)))
    : playersInMatch;
  const mainTrackerPlayers = onPitchSet && mainTrackerOnPitchOnly ? onPitchPlayers : playersInMatch;
  const shotSelectablePlayers = onPitchSet && !showAllShotPlayers ? onPitchPlayers : playersInMatch;
  const assistSelectablePlayers = (
    onPitchSet && !showAllAssistPlayers ? onPitchPlayers : playersInMatch
  ).filter((p) => p.id !== assistModalScorer);
  const dcVisiblePlayers = onPitchSet
    ? dcOrderedPlayers.filter((p) => onPitchSet.has(String(p.id)))
    : dcOrderedPlayers;
  const dcPinnedPlayers = dcVisiblePlayers.filter((p) => dcPinnedSet.has(String(p.id)));
  const dcOtherPlayers = dcVisiblePlayers.filter((p) => !dcPinnedSet.has(String(p.id)));

  const persistOnPitchIds = (nextIds) => {
    setOnPitchPlayerIds(nextIds);
    if (!activeMatch?.id) return;
    try {
      if (nextIds === null) {
        localStorage.removeItem(`match_on_pitch_${activeMatch.id}`);
      } else {
        localStorage.setItem(`match_on_pitch_${activeMatch.id}`, JSON.stringify(nextIds));
      }
    } catch {
      // fallback
    }
  };

  const toggleOnPitchPlayer = (playerId) => {
    const id = String(playerId);
    const current = Array.isArray(onPitchPlayerIds)
      ? onPitchPlayerIds.map(String)
      : playersInMatch.map((p) => String(p.id));
    const next = current.includes(id)
      ? current.filter((pid) => pid !== id)
      : [...current, id];
    persistOnPitchIds(next);
  };

  const renderDCTile = (player) => {
    const isJustTapped = justTappedDCId === player.id;
    const isPinned = dcPinnedSet.has(String(player.id));
    return (
      <div
        key={player.id}
        role="button"
        tabIndex={0}
        className={`dc-tap-tile ${isJustTapped ? 'just-tapped' : ''} ${dcPinEditMode ? 'pin-edit' : ''} ${dcPinEditMode && isPinned ? 'pinned' : ''}`}
        onClick={() => (dcPinEditMode ? toggleDCPin(player.id) : recordDC(player.id))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (dcPinEditMode) toggleDCPin(player.id);
            else recordDC(player.id);
          }
        }}
        title={dcPinEditMode ? (isPinned ? `Unpin ${player.name}` : `Pin ${player.name}`) : `Add DC for ${player.name}`}
        aria-label={dcPinEditMode ? (isPinned ? `Unpin ${player.name}` : `Pin ${player.name}`) : `Add DC for ${player.name}`}
      >
        <div className="dc-tap-tile-name">{player.name}</div>
        <div className="dc-tap-tile-footer">
          <span className="dc-tap-tile-pos">
            {!teamInfo.hide_positions && player.position ? player.position : ''}
          </span>
          {dcPinEditMode ? (
            <span className="dc-tap-tile-pin">
              <Pin size={14} fill={isPinned ? 'currentColor' : 'none'} />
            </span>
          ) : (
            <div className="dc-tap-tile-controls">
              <span className="dc-tile-count" title="Defensive Contributions this match">
                {player.defensive_contributions}
              </span>
              {player.defensive_contributions > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateMatchStat(activeMatch.id, player.id, 'defensive_contributions', -1);
                  }}
                  className="btn-dc-tile-minus"
                  title={`Decrease DC for ${player.name}`}
                  aria-label={`Decrease DC for ${player.name}`}
                >
                  −
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const columnDefs = {
    goals: {
      key: 'goals',
      shortLabel: 'Goals',
      fullLabel: 'Goals',
      cardTotalLabel: 'Goals',
      headerTitle: 'Goals Scored',
      icon: Target,
      total: totalGoals,
      enabled: true,
      getValue: (p) => p.goals,
      onDecrement: (p) => processGoalDecrement(p.id),
      onIncrement: (p) => handleAddGoalClick(p.id),
      decAria: (p) => `Decrease goals for ${p.name}`,
      incAria: (p) => `Add goal for ${p.name}`
    },
    attempts: {
      key: 'attempts',
      shortLabel: 'Att',
      fullLabel: 'Attempts (Att)',
      cardTotalLabel: 'Att',
      headerTitle: 'Attempts at Goal',
      icon: Crosshair,
      total: totalAttempts,
      enabled: showAttempts,
      getValue: (p) => p.attempts,
      onDecrement: (p) => handleAttemptDecrement(p.id),
      onIncrement: (p) => handleAttemptClick(p.id),
      decAria: (p) => `Decrease attempts for ${p.name}`,
      incAria: (p) => `Add attempt for ${p.name}`
    },
    assists: {
      key: 'assists',
      shortLabel: 'Asts',
      fullLabel: 'Assists (Asts)',
      cardTotalLabel: 'Assists',
      headerTitle: 'Assists',
      icon: Award,
      total: totalAssists,
      enabled: true,
      getValue: (p) => p.assists,
      onDecrement: (p) => updateMatchStat(activeMatch.id, p.id, 'assists', -1),
      onIncrement: (p) => updateMatchStat(activeMatch.id, p.id, 'assists', 1),
      decAria: (p) => `Decrease assists for ${p.name}`,
      incAria: (p) => `Add assist for ${p.name}`
    },
    saves: {
      key: 'saves',
      shortLabel: 'Saves',
      fullLabel: 'Saves',
      cardTotalLabel: 'Saves',
      headerTitle: 'Goalkeeper Saves',
      icon: Shield,
      total: totalSaves,
      enabled: true,
      getValue: (p) => p.saves,
      onDecrement: (p) => updateMatchStat(activeMatch.id, p.id, 'saves', -1),
      onIncrement: (p) => updateMatchStat(activeMatch.id, p.id, 'saves', 1),
      decAria: (p) => `Decrease saves for ${p.name}`,
      incAria: (p) => `Add save for ${p.name}`
    },
    dc: {
      key: 'dc',
      shortLabel: 'DC',
      fullLabel: 'Defensive Contributions (DC)',
      cardTotalLabel: 'DC',
      headerTitle: 'Defensive Contributions',
      icon: ShieldCheck,
      total: totalDC,
      enabled: showDC,
      getValue: (p) => p.defensive_contributions,
      onDecrement: (p) => updateMatchStat(activeMatch.id, p.id, 'defensive_contributions', -1),
      onIncrement: (p) => updateMatchStat(activeMatch.id, p.id, 'defensive_contributions', 1),
      decAria: (p) => `Decrease DC for ${p.name}`,
      incAria: (p) => `Add DC for ${p.name}`
    }
  };

  const availableColumns = columnOrder
    .filter((key) => columnDefs[key]?.enabled)
    .map((key) => columnDefs[key]);

  const activeColumns = availableColumns.filter((col) => !hiddenColumns.includes(col.key));
  const activeColsCount = Math.max(1, activeColumns.length);

  const toggleColumnVisibility = (colKey) => {
    const isCurrentlyHidden = hiddenColumns.includes(colKey);
    if (!isCurrentlyHidden && activeColumns.length <= 1) {
      return; // Keep at least one column visible
    }
    const nextHidden = isCurrentlyHidden
      ? hiddenColumns.filter((k) => k !== colKey)
      : [...hiddenColumns, colKey];
    updateHiddenColumns(nextHidden);
  };

  const applyActiveColumnReorder = (newActiveKeys) => {
    const activeSet = new Set(newActiveKeys);
    let idx = 0;
    const nextOrder = columnOrder.map((k) => (activeSet.has(k) ? newActiveKeys[idx++] : k));
    updateColumnOrder(nextOrder);
  };

  const moveActiveColumn = (colKey, direction) => {
    const currentKeys = availableColumns.map((c) => c.key);
    const index = currentKeys.indexOf(colKey);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= currentKeys.length) return;
    const nextKeys = [...currentKeys];
    [nextKeys[index], nextKeys[targetIndex]] = [nextKeys[targetIndex], nextKeys[index]];
    applyActiveColumnReorder(nextKeys);
  };

  const handleColumnDrop = (fromKey, toKey) => {
    setDraggedColKey(null);
    setDragOverColKey(null);
    if (!fromKey || !toKey || fromKey === toKey) return;
    const currentKeys = availableColumns.map((c) => c.key);
    const fromIdx = currentKeys.indexOf(fromKey);
    const toIdx = currentKeys.indexOf(toKey);
    if (fromIdx === -1 || toIdx === -1) return;
    const nextKeys = [...currentKeys];
    const [moved] = nextKeys.splice(fromIdx, 1);
    nextKeys.splice(toIdx, 0, moved);
    applyActiveColumnReorder(nextKeys);
  };

  const isCustomColumnOrder =
    availableColumns.some((col, idx) => {
      const defaultActive = DEFAULT_COLUMN_ORDER.filter((k) => columnDefs[k]?.enabled);
      return col.key !== defaultActive[idx];
    }) || availableColumns.some((col) => hiddenColumns.includes(col.key));

  const timeline = computeTimelineWithScores(goalEvents, activeMatch.opponent, squad);

  return (
    <div className="app-container app-view-tracker">
      <TopNav
        title={
          activeMatch.competition === 'Tournament'
            ? (() => {
                const { name, round } = parseTournament(activeMatch.tournament);
                return round ? `${name} (${round})` : name;
              })()
            : `${activeMatch.competition || 'Friendly'} Match`
        }
        onBack={() => {
          setActiveMatchId(null);
          const targetTourney = returnToTournament || (activeMatch?.competition === 'Tournament' && activeMatch?.tournament ? parseTournament(activeMatch.tournament).name : null);
          if (targetTourney) {
            if (setActiveTournamentName) setActiveTournamentName(targetTourney);
            if (setReturnToTournament) setReturnToTournament(targetTourney);
            setCurrentView('tournament');
          } else {
            setCurrentView('matches');
          }
        }}
      />

      <div className="view-container">
        {/* Scoreboard — hidden if hide_score is true */}
        {activeMatch.hide_score ? (
          <div className="card text-muted-center">
            <EyeOff size={16} />
            <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Score hidden for this match</span>
          </div>
        ) : (
          <div className="scoreboard">
            <div className="scoreboard-badge">{activeMatch.match_variant || '5-a-side'}</div>

            {/* Home Team */}
            <div className="team-col">
              <span className="team-name home">{teamInfo.name}</span>
              <div className="score-controls">
                <button onClick={() => updateMatchScore(activeMatch.id, 'team_goals', -1)} className="btn-score-minus">
                  -
                </button>
                <span className="score-value">{activeMatch.team_goals || 0}</span>
                <button onClick={() => updateMatchScore(activeMatch.id, 'team_goals', 1)} className="btn-score-plus">
                  <Plus size={20} />
                </button>
              </div>
            </div>

            <div className="vs-divider">VS</div>

            {/* Away Team with edit functionality */}
            <div className="team-col">
              {editingOpponent ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.25rem' }}>
                  <input
                    type="text"
                    className="input"
                    value={opponentInput}
                    onChange={(e) => setOpponentInput(e.target.value)}
                    style={{ padding: '0.35rem 0.5rem', fontSize: '1rem', textAlign: 'center', maxWidth: '140px' }}
                    autoFocus
                  />
                  <button onClick={saveEditedOpponent} className="btn-icon" style={{ color: 'var(--color-primary)' }}>
                    <Check size={16} />
                  </button>
                  <button onClick={() => setEditingOpponent(false)} className="btn-icon">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                  <span className="team-name away">{activeMatch.opponent}</span>
                  <button
                    onClick={() => {
                      setOpponentInput(activeMatch.opponent);
                      setEditingOpponent(true);
                    }}
                    className="btn-icon-subtle"
                    title="Edit Opposition Name"
                  >
                    <Edit2 size={12} />
                  </button>
                </div>
              )}

              <div className="score-controls">
                <button
                  onClick={() => updateMatchScore(activeMatch.id, 'opponent_goals', -1)}
                  className="btn-score-minus"
                >
                  -
                </button>
                <span className="score-value">{activeMatch.opponent_goals || 0}</span>
                <button
                  onClick={() => updateMatchScore(activeMatch.id, 'opponent_goals', 1)}
                  className="btn-score-plus away"
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Goal Order Timeline Card */}
        <div className="timeline-card">
          <div className="timeline-header">
            <div className="timeline-header-title">
              <Clock size={16} style={{ color: 'var(--color-primary)' }} />
              <span>Match Timeline</span>
            </div>
            {timeline.length > 0 && (
              <button
                onClick={() => setShowTimeline(!showTimeline)}
                className="btn-icon-subtle"
                style={{ fontSize: '0.75rem', gap: '0.25rem' }}
                title={showTimeline ? 'Hide Timeline' : 'Show Timeline'}
              >
                {showTimeline ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            )}
          </div>

          {showTimeline && (
            <div>
              {timeline.length === 0 ? (
                <div style={{ padding: '0.85rem 1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                  No goals recorded yet. Tap <strong>+</strong> on a player or score to log a goal in the timeline.
                </div>
              ) : (
                <div className="timeline-list">
                  {timeline.map((goal, idx) => (
                    <div key={goal.id || idx} className="timeline-item">
                      {activeMatch?.status !== 'finished' ? (
                        <select
                          className="timeline-order-select"
                          value={goal.orderNumber}
                          onChange={(e) => handleMoveGoal(idx, parseInt(e.target.value, 10) - 1)}
                          title="Change goal order position"
                        >
                          {timeline.map((_, i) => (
                            <option key={i + 1} value={i + 1}>#{i + 1}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="timeline-order">#{goal.orderNumber}</span>
                      )}
                      <span className="timeline-score">
                        {goal.scoreFormatted}
                      </span>

                      <div className="timeline-content">
                        <div className={`timeline-title ${goal.isOpponent ? 'opponent' : goal.isUnassigned ? 'unassigned' : ''}`}>
                          {goal.isOpponent ? (
                            <>
                              <span style={{ color: 'var(--color-danger)' }}>🔴</span>
                              <span>{goal.scorerName}</span>
                            </>
                          ) : goal.isUnassigned ? (
                            <>
                              <span>⚽</span>
                              <span>{goal.scorerName}</span>
                              <button
                                onClick={() => {
                                  setAssigningGoalEvent(goal);
                                  setSelectedScorerId(null);
                                  setAssignStep('scorer');
                                }}
                                className="btn btn-secondary"
                                style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem', marginLeft: '0.25rem' }}
                              >
                                <UserPlus size={11} /> Assign Scorer
                              </button>
                            </>
                          ) : (
                            <>
                              <span>⚽</span>
                              <span>{goal.scorerName}</span>
                            </>
                          )}
                        </div>

                        {!goal.isOpponent && !goal.isUnassigned && (
                          <div className="timeline-subtitle">
                            {goal.assisterName ? (
                              <span>Assist: <strong>{goal.assisterName}</strong></span>
                            ) : (
                              <span style={{ fontStyle: 'italic', opacity: 0.8 }}>Solo goal (unassisted)</span>
                            )}
                          </div>
                        )}
                      </div>

                      {activeMatch?.status !== 'finished' && (
                        <div className="timeline-actions">
                          <button
                            onClick={() => handleMoveGoal(idx, idx - 1)}
                            disabled={idx === 0}
                            className="btn-timeline-arrow"
                            title="Move goal earlier in timeline"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            onClick={() => handleMoveGoal(idx, idx + 1)}
                            disabled={idx === timeline.length - 1}
                            className="btn-timeline-arrow"
                            title="Move goal later in timeline"
                          >
                            <ChevronDown size={14} />
                          </button>
                          <button
                            onClick={() => deleteGoalEvent(goal.id, true)}
                            className="btn-timeline-del"
                            title="Delete this goal"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Roles & Quick Action Section */}
        <div className="tracker-actions-bar">
          <button
            type="button"
            onClick={() => setShowGkDialog(true)}
            className="btn-action-tracker btn-action-gk"
            title="Manage Match Goalkeepers"
          >
            <span className="btn-action-title">Goalkeepers</span>
            <span className="btn-action-badge gk">
              {goalkeepers.length > 0
                ? goalkeepers.map((g) => g.name).join(', ')
                : 'None assigned'}
            </span>
          </button>

          {showCaptain && (
            <button
              type="button"
              onClick={() => setShowCaptainDialog(true)}
              className="btn-action-tracker btn-action-captain"
              title="Select Match Captain"
            >
              <span className="btn-action-title">Captain</span>
              <span className="btn-action-badge captain">
                {captains.length > 0
                  ? captains.map((c) => c.name).join(', ')
                  : 'None assigned'}
              </span>
            </button>
          )}

          {showPotm && (
            <button
              type="button"
              onClick={() => setShowPotmDialog(true)}
              className="btn-action-tracker btn-action-potm"
              title="Select Player of the Match"
            >
              <span className="btn-action-title">Player of the Match</span>
              <span className="btn-action-badge potm">
                {potmPlayers.length > 0
                  ? potmPlayers.map((p) => p.name).join(', ')
                  : 'None selected'}
              </span>
            </button>
          )}

          {(showDC || showShotPitchMap) && (
            <div className="tracker-actions-divider" role="separator">
              <span>Live Tracking</span>
            </div>
          )}

          {(showDC || showShotPitchMap) && (
              <button
                  type="button"
                  onClick={openUnifiedTracker}
                  className="btn-action-tracker btn-action-unified"
                  title="Combined Saves, Defensive Contributions, and Shot Pitch tracker"
              >
                <span className="btn-action-title">Matchday Console</span>
              </button>
          )}

          {showDC && (
            <button
              type="button"
              onClick={openDCDialog}
              className="btn-action-tracker btn-action-dc"
              title="Quickly record defensive contributions"
            >
              <span className="btn-action-title">Record Defensive Contributions</span>
              {totalDC > 0 && <span className="btn-action-badge dc">{totalDC}</span>}
            </button>
          )}

          {showShotPitchMap && (
            <button
              type="button"
              onClick={openShotDialog}
              className="btn-action-tracker btn-action-shot"
              title="Mark shot location on pitch and record attempt"
            >
              <span className="btn-action-title">Record Shot</span>
              {totalAttempts > 0 && <span className="btn-action-badge shot">{totalAttempts}</span>}
            </button>
          )}
        </div>

        {/* Matchday Squad Header */}
        <div className="flex-between mb-3 mt-4" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 700, color: 'var(--color-text-main)', fontSize: '0.95rem' }}>
              Matchday Squad
            </span>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              backgroundColor: 'var(--color-border-light)',
              color: 'var(--color-text-muted)',
              padding: '0.15rem 0.5rem',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--color-border)'
            }}>
              {playersInMatch.length}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {/* On Pitch vs All Filter Toggle */}
            {onPitchSet && (
              <div className="view-mode-toggle" title="Filter squad list by players currently on the pitch">
                <button
                  type="button"
                  onClick={() => setMainTrackerOnPitchOnly(true)}
                  className={`btn-mode-toggle ${mainTrackerOnPitchOnly ? 'active' : ''}`}
                >
                  On Pitch ({onPitchPlayers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setMainTrackerOnPitchOnly(false)}
                  className={`btn-mode-toggle ${!mainTrackerOnPitchOnly ? 'active' : ''}`}
                >
                  All ({playersInMatch.length})
                </button>
              </div>
            )}

            {/* View Mode Toggle */}
            <div className="view-mode-toggle">
              <button
                type="button"
                onClick={() => handleSetViewMode('cards')}
                className={`btn-mode-toggle ${viewMode === 'cards' ? 'active' : ''}`}
                title="Card View (Thumb-friendly for live matches)"
              >
                Cards
              </button>
              <button
                type="button"
                onClick={() => handleSetViewMode('table')}
                className={`btn-mode-toggle ${viewMode === 'table' ? 'active' : ''}`}
                title="Compact Table View"
              >
                Table
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowColumnOrderModal(true)}
              className={`btn btn-secondary ${isCustomColumnOrder ? 'btn-col-order-active' : ''}`}
              style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
              title="Reorder stat columns"
            >
              <ArrowUpDown size={13} /> Columns
            </button>

            <button
              type="button"
              onClick={() => setKeepScreenAwake((v) => !v)}
              disabled={!wakeLockSupported}
              className={`btn btn-secondary ${keepScreenAwake ? 'btn-wake-lock-active' : ''}`}
              style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
              title={
                wakeLockSupported
                  ? (keepScreenAwake ? 'Screen kept awake — tap to allow sleep' : 'Keep device screen awake during match')
                  : 'Keep screen awake is not supported in this browser'
              }
              aria-pressed={keepScreenAwake}
            >
              <Sun size={13} /> {keepScreenAwake ? 'Screen On' : 'Keep Awake'}
            </button>

            <button
              type="button"
              onClick={() => setShowOnPitchDialog(true)}
              className={`btn btn-secondary ${onPitchSet ? 'btn-col-order-active' : ''}`}
              style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
              title="Select players currently on the pitch"
            >
              On Pitch{onPitchSet ? ` (${onPitchPlayers.length}/${playersInMatch.length})` : ''}
            </button>

            <button 
              onClick={() => setShowAmendSquad(true)} 
              className="btn btn-secondary"
              style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
            >
              <Users size={14} /> Amend Squad
            </button>
          </div>
        </div>

        {/* Player Stats List */}
        <div className="stats-list">
          {viewMode === 'cards' ? (
            /* =======================================
               Card Mode (Thumb-Friendly, No Horizontal Overflow)
               ======================================= */
            <div>
              {onPitchSet && mainTrackerOnPitchOnly && mainTrackerPlayers.length === 0 && playersInMatch.length > 0 && (
                <div className="empty-state" style={{ marginBottom: '0.75rem' }}>
                  No players marked as on the pitch.{' '}
                  <button type="button" className="dc-on-pitch-btn active" onClick={() => setShowOnPitchDialog(true)}>
                    Select On Pitch
                  </button>{' '}
                  or switch to <strong>All</strong>.
                </div>
              )}
              {mainTrackerPlayers.map((player) => (
                <div key={player.id} className="stat-card-row">
                  <div className="stat-card-top">
                    <div className="stat-card-player">
                      <span className="stat-card-name">{player.name}</span>
                      {player.is_goalkeeper && (
                        <span className="badge-gk-mini" title="Goalkeeper">GK</span>
                      )}
                      {showCaptain && player.is_captain && (
                        <span className="badge-captain-mini" title="Captain">C</span>
                      )}
                      {showPotm && player.is_potm && (
                        <span className="badge-potm-mini" title="Player of the Match">★ POTM</span>
                      )}
                    </div>
                    {!teamInfo.hide_positions && player.position && (
                      <span className="badge-pos">{player.position}</span>
                    )}
                  </div>

                  <div
                    className="stat-card-grid"
                    style={{ gridTemplateColumns: `repeat(${activeColsCount}, minmax(0, 1fr))` }}
                  >
                    {activeColumns.map((col) => {
                      const ColIcon = col.icon;
                      return (
                        <div key={col.key} className="stat-col-cell">
                          <div className={`stat-control-label ${col.key}`}>
                            <ColIcon size={11} /> {col.shortLabel}
                          </div>
                          <div className="stat-card-control">
                            <button
                              onClick={() => col.onDecrement(player)}
                              className="btn-stat"
                              aria-label={col.decAria(player)}
                            >
                              -
                            </button>
                            <span className="stat-value">{col.getValue(player)}</span>
                            <button
                              onClick={() => col.onIncrement(player)}
                              className={`btn-stat-plus ${col.key}`}
                              aria-label={col.incAria(player)}
                            >
                              <Plus size={15} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Cards Totals Summary */}
              {playersInMatch.length > 0 && (
                <div className="stat-cards-totals">
                  <div className="stat-cards-totals-label">Match Totals</div>
                  <div
                    className="stat-cards-totals-grid"
                    style={{ gridTemplateColumns: `repeat(${activeColsCount}, minmax(0, 1fr))` }}
                  >
                    {activeColumns.map((col) => (
                      <div key={col.key} className={`stat-card-total-box ${col.key}`}>
                        <span className={`stat-card-total-num ${col.key}`}>{col.total}</span>
                        <span className="stat-card-total-title">{col.cardTotalLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* =======================================
               Table Mode (Compact Single-Row View with Sticky Player Column)
               ======================================= */
            <div className="stats-table-wrapper">
              <div className="stats-table-grid">
              <div className="stats-header">
                <div className="stat-player-col">
                  <span>Player</span>
                </div>

                <div className="stat-cols-3">
                  {activeColumns.map((col) => {
                    const ColIcon = col.icon;
                    const isDragged = draggedColKey === col.key;
                    const isDragOver = dragOverColKey === col.key && draggedColKey !== col.key;
                    return (
                      <div
                        key={col.key}
                        className={`stat-col-header ${col.key} draggable-col-header ${isDragged ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
                        title={`${col.headerTitle} (Drag to reorder or tap to configure columns)`}
                        draggable
                        onDragStart={() => setDraggedColKey(col.key)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (dragOverColKey !== col.key) setDragOverColKey(col.key);
                        }}
                        onDragLeave={() => {
                          if (dragOverColKey === col.key) setDragOverColKey(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleColumnDrop(draggedColKey, col.key);
                        }}
                        onDragEnd={() => {
                          setDraggedColKey(null);
                          setDragOverColKey(null);
                        }}
                        onClick={() => setShowColumnOrderModal(true)}
                      >
                        <ColIcon size={13} /> {col.shortLabel}
                      </div>
                    );
                  })}
                </div>
              </div>

              {onPitchSet && mainTrackerOnPitchOnly && mainTrackerPlayers.length === 0 && playersInMatch.length > 0 && (
                <div className="empty-state" style={{ margin: '0.75rem' }}>
                  No players marked as on the pitch.{' '}
                  <button type="button" className="dc-on-pitch-btn active" onClick={() => setShowOnPitchDialog(true)}>
                    Select On Pitch
                  </button>{' '}
                  or switch to <strong>All</strong>.
                </div>
              )}
              {mainTrackerPlayers.map((player) => (
                <div key={player.id} className="stat-row">
                  <div className="stat-player-col">
                    <div className="stat-player-info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span className="stat-player-name">{player.name}</span>
                        {player.is_goalkeeper && (
                          <span className="badge-gk-mini" title="Goalkeeper">GK</span>
                        )}
                        {showCaptain && player.is_captain && (
                          <span className="badge-captain-mini" title="Captain">C</span>
                        )}
                        {showPotm && player.is_potm && (
                          <span className="badge-potm-mini" title="Player of the Match">★</span>
                        )}
                      </div>
                      {!teamInfo.hide_positions && player.position && (
                        <div style={{ marginTop: '0.1rem' }}>
                          <span className="stat-player-pos">{player.position}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="stat-cols-3">
                    {activeColumns.map((col) => (
                      <div key={col.key} className="stat-control-group">
                        <button
                          onClick={() => col.onDecrement(player)}
                          className="btn-stat"
                          aria-label={col.decAria(player)}
                        >
                          -
                        </button>
                        <span className="stat-value">{col.getValue(player)}</span>
                        <button
                          onClick={() => col.onIncrement(player)}
                          className={`btn-stat-plus ${col.key}`}
                          aria-label={col.incAria(player)}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Table Totals Footer */}
              {playersInMatch.length > 0 && (
                <div className="stat-totals-footer">
                  <div className="stat-player-col">
                    <span className="stat-totals-label">Totals</span>
                  </div>
                  <div className="stat-cols-3">
                    {activeColumns.map((col) => (
                      <div key={col.key} className={`stat-total-cell ${col.key}`}>
                        {col.total}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>
            </div>
          )}

          {playersInMatch.length === 0 && <div className="empty-state">No players selected in this match.</div>}
        </div>

        {/* Finish Match Button */}
        <div style={{ marginTop: '1.5rem' }}>
          <button onClick={() => finishMatch(activeMatch.id)} className="btn btn-primary">
            <CheckCircle size={18} /> Finish Match
          </button>
        </div>

        {/* Amend Squad Modal */}
        {showAmendSquad && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
          }}>
            <div className="card" style={{ width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
              <div className="flex-between mb-4">
                <h3 className="title-md" style={{ marginBottom: 0 }}>Amend Squad</h3>
                <button onClick={() => setShowAmendSquad(false)} className="btn-icon">
                  <X size={20} />
                </button>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                Add or remove players from this match. Removing a player will delete their stats for this match.
              </p>

              {(() => {
                const tourneyName = activeMatch?.competition === 'Tournament' && activeMatch?.tournament
                  ? parseTournament(activeMatch.tournament).name
                  : null;
                const tourneyAvailableIds = tourneyName ? getTournamentAvailablePlayers(tourneyName) : null;
                const amendableSquad = tourneyAvailableIds && tourneyAvailableIds.length > 0
                  ? squad.filter((p) => tourneyAvailableIds.includes(p.id) || (activeMatch?.stats && activeMatch.stats[p.id] !== undefined))
                  : squad;

                return (
                  <>
                    {tourneyName && tourneyAvailableIds && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--color-primary-dark)', marginBottom: '0.75rem', fontWeight: 600 }}>
                        Restricted to available tournament squad ({tourneyName})
                      </p>
                    )}
                    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                      {amendableSquad.map((player) => {
                        const selected = activeMatch.stats && activeMatch.stats[player.id] !== undefined;
                        return (
                    <div
                      key={player.id}
                      onClick={() => togglePlayerInMatch(player.id)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '0.75rem 1rem', cursor: 'pointer',
                        background: selected ? 'var(--color-primary-light)' : 'var(--color-bg-card)',
                        borderBottom: '1px solid var(--color-border-light)',
                        transition: 'background 0.15s'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div
                          className="avatar"
                          style={{
                            background: selected ? 'var(--color-primary)' : 'var(--color-border-light)',
                            color: selected ? 'white' : 'var(--color-text-muted)',
                            width: '2rem', height: '2rem', fontSize: '0.875rem'
                          }}
                        >
                          {player.name.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600, fontSize: '0.875rem', color: selected ? 'var(--color-primary-dark)' : 'var(--color-text-main)' }}>
                          {player.name}
                        </span>
                      </div>
                      {!teamInfo.hide_positions && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{player.position}</span>
                      )}
                    </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
            <button onClick={() => setShowAmendSquad(false)} className="btn btn-primary mt-4">
                Done
              </button>
            </div>
          </div>
        )}

        {/* Remove Player from Match Confirmation Modal */}
        {playerToRemove && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
          }}>
            <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
              <div className="flex-between mb-4">
                <h3 className="title-md" style={{ marginBottom: 0, color: 'var(--color-danger)' }}>Remove Player?</h3>
                <button onClick={() => setPlayerToRemove(null)} className="btn-icon">
                  <X size={20} />
                </button>
              </div>
              <p style={{ fontSize: '0.9rem', color: 'var(--color-text-main)', marginBottom: '1.5rem' }}>
                Remove <strong>{playerToRemove.name}</strong> from this match? Their stats for this match will be permanently deleted.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  onClick={confirmRemovePlayer}
                  className="btn btn-primary"
                  style={{ flex: 1, background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                >
                  Yes, Remove
                </button>
                <button onClick={() => setPlayerToRemove(null)} className="btn btn-secondary" style={{ flex: 1 }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Shot Pitch Map Modal */}
        {shotModal && (
          <div className="modal-overlay is-pitch-overlay" onClick={() => setShotModal(null)}>
            <div className="modal-content shot-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="flex-between mb-3">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    width: '2rem',
                    height: '2rem',
                    borderRadius: 'var(--radius-lg)',
                    backgroundColor: 'rgba(234, 88, 12, 0.15)',
                    color: '#ea580c',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Crosshair size={18} />
                  </div>
                  <div>
                    <h3 className="title-md" style={{ marginBottom: 0 }}>Record Shot</h3>
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                      {shotModal.playerId
                        ? playersInMatch.find((p) => p.id === shotModal.playerId)?.name
                        : 'Mark pitch, pick player, choose outcome'}
                    </span>
                  </div>
                </div>
                <button onClick={() => setShotModal(null)} className="btn-icon" aria-label="Close">
                  <X size={20} />
                </button>
              </div>

              {/* Stepper */}
              <div className="shot-stepper">
                <span className={shotModal.step === 'pitch' ? 'active' : 'done'}>1. Pitch</span>
                {!shotModal.fromPlayerRow && (
                  <span className={shotModal.step === 'player' ? 'active' : shotModal.step === 'outcome' ? 'done' : ''}>
                    2. Player
                  </span>
                )}
                <span className={shotModal.step === 'outcome' ? 'active' : ''}>
                  {shotModal.fromPlayerRow ? '2. Outcome' : '3. Outcome'}
                </span>
              </div>

              {shotModal.step === 'pitch' && (
                <div>
                  <PitchShotMap
                    value={shotModal.location}
                    allowFullScroll
                    onChange={(loc) =>
                      setShotModal((prev) =>
                        prev
                          ? {
                              ...prev,
                              location: loc,
                              step: prev.fromPlayerRow ? 'outcome' : 'player'
                            }
                          : prev
                      )
                    }
                    existingShots={_attemptEvents}
                  />
                  <div style={{ marginTop: '0.9rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ width: '100%' }}
                      onClick={() =>
                        setShotModal((prev) =>
                          prev
                            ? {
                                ...prev,
                                location: null,
                                step: prev.fromPlayerRow ? 'outcome' : 'player'
                              }
                            : prev
                        )
                      }
                    >
                      Skip Location
                    </button>
                  </div>
                </div>
              )}

              {shotModal.step === 'player' && (
                <div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
                    Who took the shot?
                  </p>
                  <div className="shot-player-grid">
                    {shotSelectablePlayers.map((player) => (
                      <button
                        key={player.id}
                        type="button"
                        className={`shot-player-tile ${shotModal.playerId === player.id ? 'selected' : ''}`}
                        onClick={() =>
                          setShotModal((prev) =>
                            prev ? { ...prev, playerId: player.id, step: 'outcome' } : prev
                          )
                        }
                      >
                        <div className="avatar" style={{ width: '1.85rem', height: '1.85rem', fontSize: '0.8rem', flexShrink: 0 }}>
                          {player.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="shot-player-name">{player.name}</span>
                      </button>
                    ))}
                  </div>
                  {onPitchSet && (
                    <button
                      type="button"
                      className="shot-show-all-btn"
                      onClick={() => setShowAllShotPlayers((v) => !v)}
                    >
                      {showAllShotPlayers
                        ? `Show on-pitch only (${onPitchPlayers.length})`
                        : `Show all squad (${playersInMatch.length})`}
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: '0.65rem', marginTop: '0.9rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ width: '100%' }}
                      onClick={() =>
                        setShotModal((prev) => (prev ? { ...prev, step: 'pitch' } : prev))
                      }
                    >
                      Back to Pitch
                    </button>
                  </div>
                </div>
              )}

              {shotModal.step === 'outcome' && (
                <div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.85rem' }}>
                    What was the outcome of this shot?
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <div onClick={() => handleShotModalOutcome('scored')} className="attempt-choice-card scored">
                      <div className="attempt-choice-icon scored">⚽</div>
                      <div className="attempt-choice-text">
                        <span className="attempt-choice-title scored">Scored (Goal)</span>
                        <span className="attempt-choice-desc">Logs goal, adds attempt, and assigns assist</span>
                      </div>
                    </div>
                    <div onClick={() => handleShotModalOutcome('saved')} className="attempt-choice-card saved">
                      <div className="attempt-choice-icon saved">🧤</div>
                      <div className="attempt-choice-text">
                        <span className="attempt-choice-title saved">Saved</span>
                        <span className="attempt-choice-desc">Shot on target saved by opposition goalkeeper</span>
                      </div>
                    </div>
                    <div onClick={() => handleShotModalOutcome('missed')} className="attempt-choice-card missed">
                      <div className="attempt-choice-icon missed">❌</div>
                      <div className="attempt-choice-text">
                        <span className="attempt-choice-title missed">Missed (Off Target)</span>
                        <span className="attempt-choice-desc">Shot wide or over the crossbar</span>
                      </div>
                    </div>
                    <div onClick={() => handleShotModalOutcome('blocked')} className="attempt-choice-card blocked">
                      <div className="attempt-choice-icon blocked">🛡️</div>
                      <div className="attempt-choice-text">
                        <span className="attempt-choice-title blocked">Blocked</span>
                        <span className="attempt-choice-desc">Shot blocked by an outfield defender</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary mt-3"
                    style={{ width: '100%' }}
                    onClick={() =>
                      setShotModal((prev) =>
                        prev
                          ? { ...prev, step: prev.fromPlayerRow ? 'pitch' : 'player' }
                          : prev
                      )
                    }
                  >
                    {shotModal.fromPlayerRow ? 'Back to Pitch' : 'Back to Player'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Attempt Result Modal */}
        {attemptModalPlayer && (
          <div className="modal-overlay" onClick={() => setAttemptModalPlayer(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
              <div className="flex-between mb-3">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    width: '2rem',
                    height: '2rem',
                    borderRadius: 'var(--radius-lg)',
                    backgroundColor: 'rgba(234, 88, 12, 0.15)',
                    color: '#ea580c',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Crosshair size={18} />
                  </div>
                  <div>
                    <h3 className="title-md" style={{ marginBottom: 0 }}>Attempt on Goal</h3>
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                      {playersInMatch.find(p => p.id === attemptModalPlayer)?.name}
                    </span>
                  </div>
                </div>
                <button onClick={() => setAttemptModalPlayer(null)} className="btn-icon">
                  <X size={20} />
                </button>
              </div>

              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                What was the outcome of this attempt on goal?
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {/* Scored */}
                <div
                  onClick={() => handleAttemptResult('scored')}
                  className="attempt-choice-card scored"
                >
                  <div className="attempt-choice-icon scored">
                    ⚽
                  </div>
                  <div className="attempt-choice-text">
                    <span className="attempt-choice-title scored">Scored (Goal)</span>
                    <span className="attempt-choice-desc">Logs goal, adds attempt, and assigns assist</span>
                  </div>
                </div>

                {/* Saved */}
                <div
                  onClick={() => handleAttemptResult('saved')}
                  className="attempt-choice-card saved"
                >
                  <div className="attempt-choice-icon saved">
                    🧤
                  </div>
                  <div className="attempt-choice-text">
                    <span className="attempt-choice-title saved">Saved</span>
                    <span className="attempt-choice-desc">Shot on target saved by opposition goalkeeper</span>
                  </div>
                </div>

                {/* Missed / Off Target */}
                <div
                  onClick={() => handleAttemptResult('missed')}
                  className="attempt-choice-card missed"
                >
                  <div className="attempt-choice-icon missed">
                    ❌
                  </div>
                  <div className="attempt-choice-text">
                    <span className="attempt-choice-title missed">Missed (Off Target)</span>
                    <span className="attempt-choice-desc">Shot wide or over the crossbar</span>
                  </div>
                </div>

                {/* Blocked */}
                <div
                  onClick={() => handleAttemptResult('blocked')}
                  className="attempt-choice-card blocked"
                >
                  <div className="attempt-choice-icon blocked">
                    🛡️
                  </div>
                  <div className="attempt-choice-text">
                    <span className="attempt-choice-title blocked">Blocked</span>
                    <span className="attempt-choice-desc">Shot blocked by an outfield defender</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Who Assisted Modal */}
        {assistModalScorer && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
          }}>
            <div className="card" style={{ width: '100%', maxWidth: '400px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
              <div className="flex-between mb-4">
                <h3 className="title-md" style={{ marginBottom: 0 }}>
                  Who assisted {playersInMatch.find(p => p.id === assistModalScorer)?.name}?
                </h3>
                <button onClick={() => { setAssistModalScorer(null); setPendingGoalLocation(null); }} className="btn-icon">
                  <X size={20} />
                </button>
              </div>
              
              <div style={{ overflowY: 'auto', flex: 1, paddingBottom: '1rem' }}>
                <div 
                  onClick={() => processGoalWithAssist(null)}
                  style={{
                    padding: '1rem', textAlign: 'center', fontWeight: 600, 
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', 
                    cursor: 'pointer', marginBottom: '1rem', background: 'var(--color-bg-body)'
                  }}
                >
                  Unassisted (Solo Goal)
                </div>
                
                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>Select Assister:</div>
                  {assistSelectablePlayers.map((player) => (
                    <div
                      key={player.id}
                      onClick={() => processGoalWithAssist(player.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.75rem 1rem', cursor: 'pointer',
                        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                        background: 'var(--color-bg-card)', transition: 'background 0.15s'
                      }}
                    >
                      <div className="avatar" style={{ width: '2rem', height: '2rem', fontSize: '0.875rem' }}>
                        {player.name.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text-main)' }}>
                        {player.name}
                      </span>
                    </div>
                  ))}
                  {onPitchSet && (
                    <button
                      type="button"
                      className="shot-show-all-btn"
                      onClick={() => setShowAllAssistPlayers((v) => !v)}
                    >
                      {showAllAssistPlayers
                        ? 'Show on-pitch only'
                        : `Show all squad (${playersInMatch.length - 1})`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Assign Unassigned Goal Modal */}
        {assigningGoalEvent && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
          }}>
            <div className="card" style={{ width: '100%', maxWidth: '420px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
              <div className="flex-between mb-3">
                <h3 className="title-md" style={{ marginBottom: 0 }}>
                  {assignStep === 'scorer'
                    ? `Assign Scorer for Goal #${assigningGoalEvent.orderNumber}`
                    : `Who assisted ${playersInMatch.find(p => p.id === selectedScorerId)?.name}?`
                  }
                </h3>
                <button
                  onClick={() => {
                    setAssigningGoalEvent(null);
                    setSelectedScorerId(null);
                    setAssignStep('scorer');
                  }}
                  className="btn-icon"
                >
                  <X size={20} />
                </button>
              </div>

              <div style={{ overflowY: 'auto', flex: 1 }}>
                {assignStep === 'scorer' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
                      Select which player scored Goal #{assigningGoalEvent.orderNumber}:
                    </div>
                    {playersInMatch.map((player) => (
                      <div
                        key={player.id}
                        onClick={() => {
                          setSelectedScorerId(player.id);
                          setAssignStep('assister');
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.75rem',
                          padding: '0.75rem 1rem', cursor: 'pointer',
                          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                          background: 'var(--color-bg-card)', transition: 'background 0.15s'
                        }}
                      >
                        <div className="avatar" style={{ width: '2rem', height: '2rem', fontSize: '0.875rem' }}>
                          {player.name.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text-main)' }}>
                          {player.name}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <div
                      onClick={() => handleAssignUnassignedGoal(null)}
                      style={{
                        padding: '1rem', textAlign: 'center', fontWeight: 600,
                        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                        cursor: 'pointer', marginBottom: '1rem', background: 'var(--color-bg-body)'
                      }}
                    >
                      Unassisted (Solo Goal)
                    </div>

                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                        Select Assister:
                      </div>
                      {playersInMatch.filter((p) => p.id !== selectedScorerId).map((player) => (
                        <div
                          key={player.id}
                          onClick={() => handleAssignUnassignedGoal(player.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            padding: '0.75rem 1rem', cursor: 'pointer',
                            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)',
                            background: 'var(--color-bg-card)', transition: 'background 0.15s'
                          }}
                        >
                          <div className="avatar" style={{ width: '2rem', height: '2rem', fontSize: '0.875rem' }}>
                            {player.name.charAt(0).toUpperCase()}
                          </div>
                          <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text-main)' }}>
                            {player.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Assign Goalkeeper Modal */}
        {showGkDialog && (
          <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setShowGkDialog(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
              <div className="flex-between mb-3">
                <h3 className="title-md" style={{ marginBottom: 0 }}>Goalkeepers</h3>
                <button onClick={() => setShowGkDialog(false)} className="btn-icon">
                  <X size={20} />
                </button>
              </div>

              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Select which player(s) played in goal for this match. Multiple goalkeepers can be selected if players rotated.
              </p>

              <div style={{ maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingRight: '0.2rem' }}>
                {playersInMatch.map((player) => {
                  const isGk = !!player.is_goalkeeper;
                  return (
                    <div
                      key={player.id}
                      onClick={() => toggleGoalkeeper(activeMatch.id, player.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.7rem 0.85rem',
                        cursor: 'pointer',
                        background: isGk ? 'rgba(180, 83, 9, 0.12)' : 'var(--color-bg-card)',
                        border: `1.5px solid ${isGk ? '#b45309' : 'var(--color-border-light)'}`,
                        borderRadius: 'var(--radius-xl)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                        <div
                          className="avatar"
                          style={{
                            background: isGk ? '#b45309' : 'var(--color-border-light)',
                            color: isGk ? '#ffffff' : 'var(--color-text-muted)',
                            width: '2.2rem',
                            height: '2.2rem',
                            fontWeight: 700,
                            fontSize: '0.85rem'
                          }}
                        >
                          {player.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: isGk ? '#b45309' : 'var(--color-text-main)' }}>
                            {player.name}
                          </div>
                          {!teamInfo.hide_positions && player.position && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                              {player.position}
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        {isGk ? (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: '#ffffff',
                            backgroundColor: '#b45309',
                            padding: '0.25rem 0.6rem',
                            borderRadius: 'var(--radius-full)'
                          }}>
                            <Check size={13} /> GK
                          </span>
                        ) : (
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: 'var(--color-text-light)',
                            padding: '0.25rem 0.6rem',
                            borderRadius: 'var(--radius-full)',
                            border: '1px solid var(--color-border)'
                          }}>
                            Assign
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <button onClick={() => setShowGkDialog(false)} className="btn btn-primary mt-4" style={{ width: '100%' }}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* Assign Captain Modal */}
        {showCaptain && showCaptainDialog && (
          <div className="modal-overlay" onClick={() => setShowCaptainDialog(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
              <div className="flex-between mb-3">
                <h3 className="title-md" style={{ marginBottom: 0 }}>Match Captain</h3>
                <button onClick={() => setShowCaptainDialog(false)} className="btn-icon">
                  <X size={20} />
                </button>
              </div>

              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Select the captain for this match. Selected player(s) will display the captain&apos;s armband (C) icon on the tracker.
              </p>

              <div style={{ maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingRight: '0.2rem' }}>
                {playersInMatch.map((player) => {
                  const isCap = !!player.is_captain;
                  return (
                    <div
                      key={player.id}
                      onClick={() => toggleCaptain(activeMatch.id, player.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.7rem 0.85rem',
                        cursor: 'pointer',
                        background: isCap ? 'rgba(15, 23, 42, 0.08)' : 'var(--color-bg-card)',
                        border: `1.5px solid ${isCap ? '#0f172a' : 'var(--color-border-light)'}`,
                        borderRadius: 'var(--radius-xl)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                        <div
                          className="avatar"
                          style={{
                            background: isCap ? '#0f172a' : 'var(--color-border-light)',
                            color: isCap ? '#ffffff' : 'var(--color-text-muted)',
                            width: '2.2rem',
                            height: '2.2rem',
                            fontWeight: 700,
                            fontSize: '0.85rem'
                          }}
                        >
                          {isCap ? 'C' : player.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text-main)' }}>
                            {player.name}
                          </div>
                          {!teamInfo.hide_positions && player.position && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                              {player.position}
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        {isCap ? (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: '#ffffff',
                            backgroundColor: '#0f172a',
                            padding: '0.25rem 0.6rem',
                            borderRadius: 'var(--radius-full)'
                          }}>
                            <Check size={13} /> Captain
                          </span>
                        ) : (
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: 'var(--color-text-light)',
                            padding: '0.25rem 0.6rem',
                            borderRadius: 'var(--radius-full)',
                            border: '1px solid var(--color-border)'
                          }}>
                            Assign
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <button onClick={() => setShowCaptainDialog(false)} className="btn btn-primary mt-4" style={{ width: '100%' }}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* Select Player of the Match Modal */}
        {showPotm && showPotmDialog && (
          <div className="modal-overlay" onClick={() => setShowPotmDialog(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
              <div className="flex-between mb-3">
                <h3 className="title-md" style={{ marginBottom: 0 }}>Player of the Match</h3>
                <button onClick={() => setShowPotmDialog(false)} className="btn-icon">
                  <X size={20} />
                </button>
              </div>

              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Select the standout Player of the Match.
              </p>

              <div style={{ maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingRight: '0.2rem' }}>
                {playersInMatch.map((player) => {
                  const isPotm = !!player.is_potm;
                  return (
                    <div
                      key={player.id}
                      onClick={() => togglePotm(activeMatch.id, player.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.7rem 0.85rem',
                        cursor: 'pointer',
                        background: isPotm ? 'rgba(217, 119, 6, 0.12)' : 'var(--color-bg-card)',
                        border: `1.5px solid ${isPotm ? '#d97706' : 'var(--color-border-light)'}`,
                        borderRadius: 'var(--radius-xl)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                        <div
                          className="avatar"
                          style={{
                            background: isPotm ? '#d97706' : 'var(--color-border-light)',
                            color: isPotm ? '#ffffff' : 'var(--color-text-muted)',
                            width: '2.2rem',
                            height: '2.2rem',
                            fontWeight: 700,
                            fontSize: '0.85rem'
                          }}
                        >
                          {isPotm ? <Star size={14} fill="currentColor" /> : player.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: isPotm ? '#b45309' : 'var(--color-text-main)' }}>
                            {player.name}
                          </div>
                          {!teamInfo.hide_positions && player.position && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                              {player.position}
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        {isPotm ? (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: '#ffffff',
                            backgroundColor: '#d97706',
                            padding: '0.25rem 0.6rem',
                            borderRadius: 'var(--radius-full)'
                          }}>
                            <Check size={13} /> POTM
                          </span>
                        ) : (
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: 'var(--color-text-light)',
                            padding: '0.25rem 0.6rem',
                            borderRadius: 'var(--radius-full)',
                            border: '1px solid var(--color-border)'
                          }}>
                            Select
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <button onClick={() => setShowPotmDialog(false)} className="btn btn-primary mt-4" style={{ width: '100%' }}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* Quick Record Defensive Contributions Modal */}
        {showDCDialog && (
            <div className="modal-overlay" onClick={closeDCDialog}>
              <div className="modal-content dc-quick-modal" onClick={(e) => e.stopPropagation()}>
                <div className="flex-between mb-2">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                    <div style={{
                      width: '2rem',
                      height: '2rem',
                      borderRadius: 'var(--radius-lg)',
                      backgroundColor: 'rgba(8, 145, 178, 0.15)',
                      color: '#0891b2',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <ShieldCheck size={18} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h3 className="title-md" style={{ marginBottom: 0 }} title="Tap a player to record a tackle, interception, block, or clearance">
                        Record DC
                      </h3>
                      <span style={{ fontSize: '0.75rem', color: '#0891b2', fontWeight: 700 }}>
                        Match Total: {totalDC}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <button
                      type="button"
                      onClick={() => setShowOnPitchDialog(true)}
                      className={`dc-on-pitch-btn ${onPitchSet ? 'active' : ''}`}
                      title="Choose which players are currently on the pitch"
                    >
                      On Pitch{onPitchSet ? ` (${dcVisiblePlayers.length})` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDcPinEditMode((v) => !v)}
                      className={`btn-icon dc-pin-mode-btn ${dcPinEditMode ? 'active' : ''}`}
                      title={dcPinEditMode ? 'Finish editing pinned players' : 'Edit pinned players'}
                      aria-pressed={dcPinEditMode}
                    >
                      <Pin size={18} />
                    </button>
                    <button onClick={closeDCDialog} className="btn-icon" aria-label="Close">
                      <X size={20} />
                    </button>
                  </div>
                </div>

                <div className="dc-sort-toggle" role="group" aria-label="Player order">
                  {[
                    { id: 'smart', label: 'Smart' },
                    { id: 'alpha', label: 'A–Z' },
                    { id: 'position', label: 'Position' }
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={dcSortMode === opt.id ? 'active' : ''}
                      onClick={() => changeDCSortMode(opt.id)}
                      aria-pressed={dcSortMode === opt.id}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {dcPinEditMode && (
                  <div className="dc-pin-hint">
                    Tap players to pin/unpin them to the top. Tap the pin icon again when done.
                  </div>
                )}

                <div className="dc-tap-scroll">
                  {dcVisiblePlayers.length === 0 ? (
                    <div className="dc-pin-hint" style={{ textAlign: 'center', padding: '1rem' }}>
                      No players marked as on the pitch.{' '}
                      <button
                        type="button"
                        className="dc-on-pitch-btn active"
                        onClick={() => setShowOnPitchDialog(true)}
                      >
                        Select On-Pitch Players
                      </button>
                    </div>
                  ) : (
                    <>
                      {dcPinnedPlayers.length > 0 && (
                        <>
                          <div className="dc-section-label"><Pin size={11} /> Pinned</div>
                          <div className="dc-tap-grid">{dcPinnedPlayers.map(renderDCTile)}</div>
                          {dcOtherPlayers.length > 0 && <div className="dc-section-label">Squad</div>}
                        </>
                      )}
                      <div className="dc-tap-grid">{dcOtherPlayers.map(renderDCTile)}</div>
                    </>
                  )}
                </div>

                <button onClick={closeDCDialog} className="btn btn-primary mt-3" style={{ width: '100%' }}>
                  Done
                </button>
              </div>
            </div>
        )}

        {/* Unified Matchday Console Modal (Saves + DC + Shot Pitch Map) */}
        {showUnifiedTracker && (() => {
          const activeGk = goalkeepers.find((g) => g.id === activeUnifiedGkId) || goalkeepers[0] || null;
          const isSaveJustTapped = activeGk && justTappedSaveId === activeGk.id;

          return (
            <div className="modal-overlay is-pitch-overlay" onClick={() => setShowUnifiedTracker(false)}>
              <div
                className="modal-content unified-tracker-modal"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Sticky Header */}
                <div className="unified-tracker-header">
                  <div>
                    <h3 className="title-md" style={{ marginBottom: 0 }}>Matchday Console</h3>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                      {activeMatch.opponent ? `vs ${activeMatch.opponent}` : 'Live match tracking'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <button
                      type="button"
                      onClick={() => setKeepScreenAwake((v) => !v)}
                      disabled={!wakeLockSupported}
                      className={`unified-wake-btn ${keepScreenAwake ? 'active' : ''}`}
                      title={
                        wakeLockSupported
                          ? (keepScreenAwake ? 'Screen kept awake — tap to allow sleep' : 'Keep device screen awake')
                          : 'Keep screen awake is not supported in this browser'
                      }
                      aria-pressed={keepScreenAwake}
                    >
                      <Sun size={13} />
                      <span>{keepScreenAwake ? 'Screen On' : 'Keep Awake'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowUnifiedTracker(false)}
                      className="btn-icon"
                      aria-label="Close"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>

                {/* Scrollable Body */}
                <div className="unified-tracker-body">
                  {/* 0. On Pitch Lineup Section */}
                  <section className="unified-section">
                    <div className="unified-section-header">
                      <div className="unified-section-title">
                        <Users size={16} style={{ color: '#0891b2' }} />
                        <span>On Pitch</span>
                        <span className="unified-section-badge dc">
                          {onPitchSet ? `${onPitchPlayers.length}/${playersInMatch.length}` : `All (${playersInMatch.length})`}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="unified-gk-change-btn"
                        onClick={() => setShowOnPitchDialog(true)}
                      >
                        Edit Lineup
                      </button>
                    </div>
                    {onPitchSet ? (
                      onPitchPlayers.length > 0 ? (
                        <div className="unified-onpitch-pills">
                          {onPitchPlayers.map((p) => (
                            <span key={p.id} className="unified-onpitch-pill">{p.name}</span>
                          ))}
                        </div>
                      ) : (
                        <div className="unified-gk-empty">No players marked on pitch. Tap Edit Lineup to select.</div>
                      )
                    ) : (
                      <div className="unified-gk-empty">
                        Showing all {playersInMatch.length} squad players. Tap Edit Lineup to filter to those on the pitch.
                      </div>
                    )}
                  </section>

                  {/* 1. Goalkeeper Save Bar */}
                  <section className="unified-section unified-save-bar">
                    <div className="unified-section-header">
                      <div className="unified-section-title">
                        <Shield size={16} style={{ color: '#b45309' }} />
                        <span>Goalkeeper Saves</span>
                      </div>
                      <button
                        type="button"
                        className="unified-gk-change-btn"
                        onClick={() => setShowGkDialog(true)}
                      >
                        {goalkeepers.length > 0 ? 'Change GK' : 'Set Goalkeeper'}
                      </button>
                    </div>

                    {goalkeepers.length === 0 ? (
                      <div className="unified-gk-empty">
                        <span>Assign a goalkeeper to record saves in 1 tap.</span>
                      </div>
                    ) : (
                      <>
                        {goalkeepers.length > 1 && (
                          <div className="unified-gk-pills" role="group" aria-label="Active goalkeeper">
                            {goalkeepers.map((gk) => (
                              <button
                                key={gk.id}
                                type="button"
                                className={activeGk?.id === gk.id ? 'active' : ''}
                                onClick={() => setActiveUnifiedGkId(gk.id)}
                              >
                                {gk.name} ({gk.saves})
                              </button>
                            ))}
                          </div>
                        )}

                        {activeGk && (
                          <div className="unified-save-controls">
                            <div className="unified-gk-info">
                              <span className="unified-gk-name">{activeGk.name}</span>
                              <span className="unified-gk-count">{activeGk.saves} saves</span>
                            </div>
                            <div className="unified-save-actions">
                              <button
                                type="button"
                                className={`unified-save-plus ${isSaveJustTapped ? 'just-tapped' : ''}`}
                                onClick={() => recordUnifiedSave(activeGk.id)}
                              >
                                +1 Save
                              </button>
                              {activeGk.saves > 0 && (
                                <button
                                  type="button"
                                  className="unified-save-minus"
                                  onClick={() => updateMatchStat(activeMatch.id, activeGk.id, 'saves', -1)}
                                  aria-label={`Decrease saves for ${activeGk.name}`}
                                  title="Undo save"
                                >
                                  −
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </section>

                  {/* 2. Defensive Contributions Section */}
                  {showDC && (
                    <section className="unified-section">
                      <div className="unified-section-header">
                        <div className="unified-section-title">
                          <ShieldCheck size={16} style={{ color: '#0891b2' }} />
                          <span>Defensive Contributions</span>
                          <span className="unified-section-badge dc">{totalDC}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDcPinEditMode((v) => !v)}
                          className={`btn-icon dc-pin-mode-btn ${dcPinEditMode ? 'active' : ''}`}
                          title={dcPinEditMode ? 'Finish editing pinned players' : 'Edit pinned players'}
                          aria-pressed={dcPinEditMode}
                        >
                          <Pin size={16} />
                        </button>
                      </div>

                      <div className="dc-sort-toggle" role="group" aria-label="Player order">
                        {[
                          { id: 'smart', label: 'Smart' },
                          { id: 'alpha', label: 'A–Z' },
                          { id: 'position', label: 'Position' }
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            className={dcSortMode === opt.id ? 'active' : ''}
                            onClick={() => changeDCSortMode(opt.id)}
                            aria-pressed={dcSortMode === opt.id}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {dcPinEditMode && (
                        <div className="dc-pin-hint">
                          Tap players to pin/unpin them to the top. Tap the pin icon again when done.
                        </div>
                      )}

                      {dcVisiblePlayers.length === 0 ? (
                        <div className="dc-pin-hint" style={{ textAlign: 'center', padding: '1rem' }}>
                          No players marked as on the pitch.{' '}
                          <button
                            type="button"
                            className="dc-on-pitch-btn active"
                            onClick={() => setShowOnPitchDialog(true)}
                          >
                            Select On-Pitch Players
                          </button>
                        </div>
                      ) : (
                        <>
                          {dcPinnedPlayers.length > 0 && (
                            <>
                              <div className="dc-section-label"><Pin size={11} /> Pinned</div>
                              <div className="dc-tap-grid">{dcPinnedPlayers.map(renderDCTile)}</div>
                              {dcOtherPlayers.length > 0 && <div className="dc-section-label">Squad</div>}
                            </>
                          )}
                          <div className="dc-tap-grid">{dcOtherPlayers.map(renderDCTile)}</div>
                        </>
                      )}
                    </section>
                  )}

                  {/* 3. Shot Pitch Map Section */}
                  {showShotPitchMap && (
                    <section className="unified-section unified-shot-section">
                      <div className="unified-section-header">
                        <div className="unified-section-title">
                          <Crosshair size={16} style={{ color: '#ea580c' }} />
                          <span>Shot Tracker</span>
                          <span className="unified-section-badge shot">{totalAttempts}</span>
                        </div>
                        {unifiedShotDraft && (
                          <button
                            type="button"
                            className="unified-gk-change-btn"
                            onClick={() => setUnifiedShotDraft(null)}
                          >
                            Reset to Pitch
                          </button>
                        )}
                      </div>

                      <div
                        ref={shotStageRef}
                        style={unifiedShotDraft?.minHeight ? { minHeight: `${unifiedShotDraft.minHeight}px` } : undefined}
                      >
                        {!unifiedShotDraft && (
                          <PitchShotMap
                            value={null}
                            defaultScope="full"
                            allowFullScroll
                            existingShots={_attemptEvents}
                            onChange={(loc) => {
                              const measuredHeight = shotStageRef.current?.offsetHeight || null;
                              setShowAllShotPlayers(false);
                              setUnifiedShotDraft({
                                step: 'player',
                                location: loc,
                                playerId: null,
                                minHeight: measuredHeight
                              });
                            }}
                          />
                        )}

                        {unifiedShotDraft?.step === 'player' && (
                          <div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.65rem' }}>
                              Shot marked ({unifiedShotDraft.location.x}%, {unifiedShotDraft.location.y}%) — select player:
                            </p>
                            <div className="shot-player-grid">
                              {shotSelectablePlayers.map((player) => (
                                <button
                                  key={player.id}
                                  type="button"
                                  className="shot-player-tile"
                                  onClick={() =>
                                    setUnifiedShotDraft((prev) =>
                                      prev ? { ...prev, playerId: player.id, step: 'outcome' } : prev
                                    )
                                  }
                                >
                                  <div className="avatar" style={{ width: '1.8rem', height: '1.8rem', fontSize: '0.78rem', flexShrink: 0 }}>
                                    {player.name.charAt(0).toUpperCase()}
                                  </div>
                                  <span className="shot-player-name">{player.name}</span>
                                </button>
                              ))}
                            </div>
                            {onPitchSet && (
                              <button
                                type="button"
                                className="shot-show-all-btn"
                                onClick={() => setShowAllShotPlayers((v) => !v)}
                              >
                                {showAllShotPlayers
                                  ? `Show on-pitch only (${onPitchPlayers.length})`
                                  : `Show all squad (${playersInMatch.length})`}
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-secondary mt-3"
                              style={{ width: '100%' }}
                              onClick={() => setUnifiedShotDraft(null)}
                            >
                              Back to Pitch
                            </button>
                          </div>
                        )}

                        {unifiedShotDraft?.step === 'outcome' && (
                          <div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.7rem' }}>
                              Outcome for{' '}
                              <strong>{playersInMatch.find((p) => p.id === unifiedShotDraft.playerId)?.name}</strong>:
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                              <div onClick={() => handleUnifiedShotOutcome('scored')} className="attempt-choice-card scored">
                                <div className="attempt-choice-icon scored">⚽</div>
                                <div className="attempt-choice-text">
                                  <span className="attempt-choice-title scored">Scored (Goal)</span>
                                  <span className="attempt-choice-desc">Logs goal, adds attempt, and assigns assist</span>
                                </div>
                              </div>
                              <div onClick={() => handleUnifiedShotOutcome('saved')} className="attempt-choice-card saved">
                                <div className="attempt-choice-icon saved">🧤</div>
                                <div className="attempt-choice-text">
                                  <span className="attempt-choice-title saved">Saved</span>
                                  <span className="attempt-choice-desc">Shot on target saved by opposition goalkeeper</span>
                                </div>
                              </div>
                              <div onClick={() => handleUnifiedShotOutcome('missed')} className="attempt-choice-card missed">
                                <div className="attempt-choice-icon missed">❌</div>
                                <div className="attempt-choice-text">
                                  <span className="attempt-choice-title missed">Missed (Off Target)</span>
                                  <span className="attempt-choice-desc">Shot wide or over the crossbar</span>
                                </div>
                              </div>
                              <div onClick={() => handleUnifiedShotOutcome('blocked')} className="attempt-choice-card blocked">
                                <div className="attempt-choice-icon blocked">🛡️</div>
                                <div className="attempt-choice-text">
                                  <span className="attempt-choice-title blocked">Blocked</span>
                                  <span className="attempt-choice-desc">Shot blocked by an outfield defender</span>
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-secondary mt-3"
                              style={{ width: '100%' }}
                              onClick={() =>
                                setUnifiedShotDraft((prev) =>
                                  prev ? { ...prev, step: 'player' } : prev
                                )
                              }
                            >
                              Back to Player
                            </button>
                          </div>
                        )}
                      </div>
                    </section>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* On-Pitch Players Selection Modal (for DC tracking) */}
        {showOnPitchDialog && (
          <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setShowOnPitchDialog(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
              <div className="flex-between mb-2">
                <div>
                  <h3 className="title-md" style={{ marginBottom: 0 }}>Players on the Pitch</h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                    Only selected players appear in Defensive Contributions
                  </span>
                </div>
                <button onClick={() => setShowOnPitchDialog(false)} className="btn-icon" aria-label="Close">
                  <X size={20} />
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  {onPitchSet ? `${dcVisiblePlayers.length} of ${playersInMatch.length} on pitch` : `All ${playersInMatch.length} players shown`}
                </span>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    type="button"
                    className="unified-gk-change-btn"
                    onClick={() => persistOnPitchIds([])}
                  >
                    Clear All
                  </button>
                  <button
                    type="button"
                    className="unified-gk-change-btn"
                    onClick={() => persistOnPitchIds(null)}
                  >
                    Show All
                  </button>
                </div>
              </div>

              <div style={{ maxHeight: '52vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingRight: '0.2rem' }}>
                {playersInMatch.map((player) => {
                  const isOnPitch = !onPitchSet || onPitchSet.has(String(player.id));
                  return (
                    <div
                      key={player.id}
                      onClick={() => toggleOnPitchPlayer(player.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.65rem 0.85rem',
                        cursor: 'pointer',
                        background: isOnPitch ? 'rgba(8, 145, 178, 0.1)' : 'var(--color-bg-card)',
                        border: `1.5px solid ${isOnPitch ? '#0891b2' : 'var(--color-border-light)'}`,
                        borderRadius: 'var(--radius-xl)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                        <div
                          className="avatar"
                          style={{
                            background: isOnPitch ? '#0891b2' : 'var(--color-border-light)',
                            color: isOnPitch ? '#ffffff' : 'var(--color-text-muted)',
                            width: '1.9rem',
                            height: '1.9rem',
                            fontSize: '0.82rem',
                            flexShrink: 0
                          }}
                        >
                          {player.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: isOnPitch ? '#0891b2' : 'var(--color-text-main)' }}>
                            {player.name}
                          </div>
                          {!teamInfo.hide_positions && player.position && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                              {player.position}
                            </div>
                          )}
                        </div>
                      </div>
                      <span style={{
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        color: isOnPitch ? '#ffffff' : 'var(--color-text-light)',
                        backgroundColor: isOnPitch ? '#0891b2' : 'transparent',
                        padding: '0.22rem 0.6rem',
                        borderRadius: 'var(--radius-full)',
                        border: isOnPitch ? 'none' : '1px solid var(--color-border)'
                      }}>
                        {isOnPitch ? 'On Pitch' : 'Sub / Off'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <button onClick={() => setShowOnPitchDialog(false)} className="btn btn-primary mt-3" style={{ width: '100%' }}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* Column Order Preferences Modal */}
        {showColumnOrderModal && (
          <div className="modal-overlay" onClick={() => setShowColumnOrderModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
              <div className="flex-between mb-3">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    width: '2.25rem',
                    height: '2.25rem',
                    borderRadius: 'var(--radius-lg)',
                    backgroundColor: 'var(--color-primary-light)',
                    color: 'var(--color-primary-dark)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <ArrowUpDown size={18} />
                  </div>
                  <div>
                    <h3 className="title-md" style={{ marginBottom: 0 }}>Column Order</h3>
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                      Saved automatically to your preferences
                    </span>
                  </div>
                </div>
                <button onClick={() => setShowColumnOrderModal(false)} className="btn-icon">
                  <X size={20} />
                </button>
              </div>

              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.9rem' }}>
                Reorder or uncheck stat columns to customize your tracker in both Cards and Table views.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {availableColumns.map((col, idx) => {
                  const ColIcon = col.icon;
                  const isFirst = idx === 0;
                  const isLast = idx === availableColumns.length - 1;
                  const isDragged = draggedColKey === col.key;
                  const isDragOver = dragOverColKey === col.key && draggedColKey !== col.key;
                  const isVisible = !hiddenColumns.includes(col.key);
                  const isOnlyVisible = isVisible && activeColumns.length <= 1;

                  return (
                    <div
                      key={col.key}
                      className={`col-order-item ${isDragged ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
                      style={{ opacity: isVisible ? 1 : 0.55 }}
                      draggable
                      onDragStart={() => setDraggedColKey(col.key)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragOverColKey !== col.key) setDragOverColKey(col.key);
                      }}
                      onDragLeave={() => {
                        if (dragOverColKey === col.key) setDragOverColKey(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleColumnDrop(draggedColKey, col.key);
                      }}
                      onDragEnd={() => {
                        setDraggedColKey(null);
                        setDragOverColKey(null);
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0, flex: 1 }}>
                        <GripVertical size={15} style={{ color: 'var(--color-text-light)', cursor: 'grab', flexShrink: 0 }} />
                        <input
                          type="checkbox"
                          checked={isVisible}
                          disabled={isOnlyVisible}
                          onChange={() => toggleColumnVisibility(col.key)}
                          title={isOnlyVisible ? 'At least one column must remain visible' : `Show/hide ${col.shortLabel}`}
                          style={{ accentColor: 'var(--color-primary)', cursor: isOnlyVisible ? 'not-allowed' : 'pointer', margin: 0, flexShrink: 0 }}
                        />
                        <span className="col-order-rank">{idx + 1}</span>
                        <span
                          className={`stat-control-label ${col.key}`}
                          style={{ marginBottom: 0, fontSize: '0.82rem', cursor: isOnlyVisible ? 'default' : 'pointer' }}
                          onClick={() => !isOnlyVisible && toggleColumnVisibility(col.key)}
                        >
                          <ColIcon size={14} /> {col.fullLabel}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => moveActiveColumn(col.key, -1)}
                          disabled={isFirst}
                          className="btn-col-move"
                          title={`Move ${col.shortLabel} earlier`}
                          aria-label={`Move ${col.shortLabel} earlier`}
                        >
                          <ChevronUp size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveActiveColumn(col.key, 1)}
                          disabled={isLast}
                          className="btn-col-move"
                          title={`Move ${col.shortLabel} later`}
                          aria-label={`Move ${col.shortLabel} later`}
                        >
                          <ChevronDown size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.1rem' }}>
                {isCustomColumnOrder && (
                  <button
                    type="button"
                    onClick={() => {
                      updateColumnOrder([...DEFAULT_COLUMN_ORDER]);
                      updateHiddenColumns([]);
                    }}
                    className="btn btn-secondary"
                    style={{ width: 'auto', padding: '0.6rem 0.9rem', fontSize: '0.82rem' }}
                    title="Reset to default columns and order"
                  >
                    <RotateCcw size={14} /> Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowColumnOrderModal(false)}
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
