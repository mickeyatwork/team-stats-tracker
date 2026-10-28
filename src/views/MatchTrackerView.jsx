import { useState, useRef, useCallback, useEffect } from 'react';
import { Plus, Target, Award, Shield, CheckCircle, EyeOff, Edit2, Check, X, Users, Clock, ChevronUp, ChevronDown, Trash2, UserPlus, Crosshair, ShieldCheck } from 'lucide-react';
import TopNav from '../components/TopNav';
import { supabase } from '../supabaseClient';
import { computeTimelineWithScores, reorderTimelineEvents } from '../utils/timelineUtils';
import { parseTournament, getTournamentAvailablePlayers } from '../utils/tournamentUtils';
import { FEATURE_KEYS, isFeatureEnabled } from '../utils/featureFlags';

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
  const [playerToRemove, setPlayerToRemove] = useState(null); // { id, name }
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('matchTrackerViewMode') || 'table';
  });
  const [showGkDialog, setShowGkDialog] = useState(false);
  const [showDCDialog, setShowDCDialog] = useState(false);
  const [justTappedDCId, setJustTappedDCId] = useState(null);

  const showAttempts = isFeatureEnabled(teamInfo, FEATURE_KEYS.ATTEMPTS);
  const showDC = isFeatureEnabled(teamInfo, FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS);

  // Timeline State
  const [goalEvents, setGoalEvents] = useState([]);
  const [_attemptEvents, setAttemptEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [showTimeline, setShowTimeline] = useState(true);
  const [assigningGoalEvent, setAssigningGoalEvent] = useState(null);
  const [assignStep, setAssignStep] = useState('scorer'); // 'scorer' | 'assister'
  const [selectedScorerId, setSelectedScorerId] = useState(null);
  const reorderSaveTimerRef = useRef(null);

  const handleSetViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('matchTrackerViewMode', mode);
  };

  // Fetch goal events for active match
  const fetchGoalEvents = async () => {
    setLoadingEvents(true);
    const { data, error } = await supabase
      .from('goal_events')
      .select('*')
      .eq('match_id', activeMatch.id)
      .order('created_at', { ascending: true });
    if (!error && data) {
      setGoalEvents(data);
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
    await supabase.from('matches').update({ team_goals: teamGoals, opponent_goals: oppGoals }).eq('id', matchId);
  }, 1000);

  const updateMatchScore = async (matchId, team, delta) => {
    const m = matches.find((x) => x.id === matchId);
    if (!m) return;
    const newVal = Math.max(0, m[team] + delta);
    setMatches(matches.map((match) => (match.id === matchId ? { ...match, [team]: newVal } : match)));
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
      const { data, error } = await supabase.from('goal_events').insert([newEvent]).select().single();
      if (!error && data) {
        setGoalEvents((prev) => [...prev, data]);
        if (setAllGoalEvents) setAllGoalEvents((prev) => [...prev, data]);
      }
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

  // Autosave Player Stats (Goals, Assists, Saves, Attempts, DC, GK status)
  const savePlayerStatToDb = useDebounceCallback(async (matchId, playerId, goals, assists, saves, is_goalkeeper, attempts, defensive_contributions) => {
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

    let { error } = await supabase.from('match_stats').upsert(payload, { onConflict: 'match_id,player_id' });
    if (error && (error.message?.includes('column') || error.code === '42703')) {
      const fallback = await supabase.from('match_stats').upsert(
        { match_id: matchId, player_id: playerId, goals, assists, saves, is_goalkeeper },
        { onConflict: 'match_id,player_id' }
      );
      if (fallback.error) console.error('Error saving player stat (fallback):', fallback.error);
    } else if (error) {
      console.error('Error saving player stat:', error);
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
    savePlayerStatToDb(matchId, playerId, g, a, s, isGk, att, dc);
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
    savePlayerStatToDb(matchId, playerId, g, a, s, newVal, att, dc);
  };

  const handleAddGoalClick = (playerId) => {
    setAssistModalScorer(playerId);
  };

  const handleAttemptClick = (playerId) => {
    setAttemptModalPlayer(playerId);
  };

  const handleAttemptResult = async (result) => {
    const playerId = attemptModalPlayer;
    if (!playerId) return;

    if (result === 'scored') {
      setAttemptModalPlayer(null);
      setAssistModalScorer(playerId);
    } else {
      updateMatchStat(activeMatch.id, playerId, 'attempts', 1);
      setAttemptModalPlayer(null);

      // Persist to attempt_events table
      try {
        const { data, error } = await supabase.from('attempt_events').insert([{
          match_id: activeMatch.id,
          player_id: playerId,
          result: result,
          created_at: new Date().toISOString()
        }]).select().single();
        if (!error && data) {
          setAttemptEvents((prev) => [...prev, data]);
        }
      } catch (err) {
        console.warn('Could not insert attempt_event:', err);
      }
    }
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
    setAssistModalScorer(null);

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
    const { data: newEvt } = await supabase.from('goal_events').insert([{
      match_id: activeMatch.id,
      scorer_id: scorerId,
      assister_id: assisterId,
      created_at: new Date().toISOString()
    }]).select().single();

    if (newEvt) {
      setGoalEvents((prev) => [...prev, newEvt]);
      if (setAllGoalEvents) setAllGoalEvents((prev) => [...prev, newEvt]);
    }

    // Also log to attempt_events as scored if attempts tracking is enabled
    if (showAttempts) {
      try {
        const { data: attemptEvt } = await supabase.from('attempt_events').insert([{
          match_id: activeMatch.id,
          player_id: scorerId,
          result: 'scored',
          created_at: new Date().toISOString()
        }]).select().single();
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
      setGoalEvents((prev) => prev.filter((e) => e.id !== eventToDelete.id));
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

    setGoalEvents((prev) => prev.filter((e) => e.id !== eventId));
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

    setGoalEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, scorer_id: scorerId, assister_id: assisterId } : e)));
    if (setAllGoalEvents) {
      setAllGoalEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, scorer_id: scorerId, assister_id: assisterId } : e)));
    }

    setAssigningGoalEvent(null);
    setSelectedScorerId(null);
    setAssignStep('scorer');
  };


  const finishMatch = async (matchId) => {
    setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, status: 'finished' } : m)));
    await supabase.from('matches').update({ status: 'finished' }).eq('id', matchId);

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
    setMatches((prev) => prev.map((m) => (m.id === activeMatch.id ? { ...m, opponent: newName } : m)));
    setEditingOpponent(false);
    await supabase.from('matches').update({ opponent: newName }).eq('id', activeMatch.id);
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
      
      setMatches((prev) => prev.map(m => m.id === activeMatch.id ? { ...m, stats: newStats } : m));
      
      // Upsert default stats to database with column fallback
      let { error: amendErr } = await supabase.from('match_stats').upsert(
        { match_id: activeMatch.id, player_id: playerId, goals: 0, assists: 0, saves: 0, attempts: 0, defensive_contributions: 0, is_goalkeeper: false },
        { onConflict: 'match_id,player_id' }
      );
      if (amendErr && (amendErr.message?.includes('column') || amendErr.code === '42703')) {
        await supabase.from('match_stats').upsert(
          { match_id: activeMatch.id, player_id: playerId, goals: 0, assists: 0, saves: 0, is_goalkeeper: false },
          { onConflict: 'match_id,player_id' }
        );
      }
    }
  };

  const confirmRemovePlayer = async () => {
    if (!playerToRemove) return;
    const newStats = { ...activeMatch.stats };
    delete newStats[playerToRemove.id];
    setMatches((prev) => prev.map(m => m.id === activeMatch.id ? { ...m, stats: newStats } : m));
    await supabase.from('match_stats').delete().eq('match_id', activeMatch.id).eq('player_id', playerToRemove.id);
    setPlayerToRemove(null);
  };

  if (!activeMatch) return null;

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
            is_goalkeeper: activeMatch.stats[pid]?.is_goalkeeper || false
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const goalkeepers = playersInMatch.filter((p) => p.is_goalkeeper);
  const totalGoals = playersInMatch.reduce((sum, p) => sum + p.goals, 0);
  const totalAssists = playersInMatch.reduce((sum, p) => sum + p.assists, 0);
  const totalSaves = playersInMatch.reduce((sum, p) => sum + p.saves, 0);
  const totalAttempts = playersInMatch.reduce((sum, p) => sum + p.attempts, 0);
  const totalDC = playersInMatch.reduce((sum, p) => sum + p.defensive_contributions, 0);
  const activeColsCount = 3 + (showAttempts ? 1 : 0) + (showDC ? 1 : 0);

  const timeline = computeTimelineWithScores(goalEvents, activeMatch.opponent, squad);

  return (
    <div className="app-container">
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
                      <span className={`timeline-score ${goal.teamScoreAfter > goal.oppScoreAfter ? 'team-lead' : goal.oppScoreAfter > goal.teamScoreAfter ? 'opp-lead' : ''}`}>
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

          {showDC && (
            <button
              type="button"
              onClick={() => setShowDCDialog(true)}
              className="btn-action-tracker btn-action-dc"
              title="Quickly record defensive contributions"
            >
              <span className="btn-action-title">Record Defensive Contributions</span>
              {totalDC > 0 && <span className="btn-action-badge dc">{totalDC}</span>}
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
              {playersInMatch.map((player) => (
                <div key={player.id} className="stat-card-row">
                  <div className="stat-card-top">
                    <div className="stat-card-player">
                      <span className="stat-card-name">{player.name}</span>
                      {player.is_goalkeeper && (
                        <span className="badge-gk-mini" title="Goalkeeper">GK</span>
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
                    {/* Goals Column */}
                    <div className="stat-col-cell">
                      <div className="stat-control-label goals">
                        <Target size={11} /> Goals
                      </div>
                      <div className="stat-card-control">
                        <button
                          onClick={() => processGoalDecrement(player.id)}
                          className="btn-stat"
                          aria-label={`Decrease goals for ${player.name}`}
                        >
                          -
                        </button>
                        <span className="stat-value">{player.goals}</span>
                        <button
                          onClick={() => handleAddGoalClick(player.id)}
                          className="btn-stat-plus goals"
                          aria-label={`Add goal for ${player.name}`}
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Attempts Column */}
                    {showAttempts && (
                      <div className="stat-col-cell">
                        <div className="stat-control-label attempts">
                          <Crosshair size={11} /> Att
                        </div>
                        <div className="stat-card-control">
                          <button
                            onClick={() => handleAttemptDecrement(player.id)}
                            className="btn-stat"
                            aria-label={`Decrease attempts for ${player.name}`}
                          >
                            -
                          </button>
                          <span className="stat-value">{player.attempts}</span>
                          <button
                            onClick={() => handleAttemptClick(player.id)}
                            className="btn-stat-plus attempts"
                            aria-label={`Add attempt for ${player.name}`}
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Assists Column */}
                    <div className="stat-col-cell">
                      <div className="stat-control-label assists">
                        <Award size={11} /> Asts
                      </div>
                      <div className="stat-card-control">
                        <button
                          onClick={() => updateMatchStat(activeMatch.id, player.id, 'assists', -1)}
                          className="btn-stat"
                          aria-label={`Decrease assists for ${player.name}`}
                        >
                          -
                        </button>
                        <span className="stat-value">{player.assists}</span>
                        <button
                          onClick={() => updateMatchStat(activeMatch.id, player.id, 'assists', 1)}
                          className="btn-stat-plus assists"
                          aria-label={`Add assist for ${player.name}`}
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Saves Column */}
                    <div className="stat-col-cell">
                      <div className="stat-control-label saves">
                        <Shield size={11} /> Saves
                      </div>
                      <div className="stat-card-control">
                        <button
                          onClick={() => updateMatchStat(activeMatch.id, player.id, 'saves', -1)}
                          className="btn-stat"
                          aria-label={`Decrease saves for ${player.name}`}
                        >
                          -
                        </button>
                        <span className="stat-value">{player.saves}</span>
                        <button
                          onClick={() => updateMatchStat(activeMatch.id, player.id, 'saves', 1)}
                          className="btn-stat-plus saves"
                          aria-label={`Add save for ${player.name}`}
                        >
                          <Plus size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Defensive Contributions Column */}
                    {showDC && (
                      <div className="stat-col-cell">
                        <div className="stat-control-label dc">
                          <ShieldCheck size={11} /> DC
                        </div>
                        <div className="stat-card-control">
                          <button
                            onClick={() => updateMatchStat(activeMatch.id, player.id, 'defensive_contributions', -1)}
                            className="btn-stat"
                            aria-label={`Decrease DC for ${player.name}`}
                          >
                            -
                          </button>
                          <span className="stat-value">{player.defensive_contributions}</span>
                          <button
                            onClick={() => updateMatchStat(activeMatch.id, player.id, 'defensive_contributions', 1)}
                            className="btn-stat-plus dc"
                            aria-label={`Add DC for ${player.name}`}
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                      </div>
                    )}
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
                    <div className="stat-card-total-box goals">
                      <span className="stat-card-total-num goals">{totalGoals}</span>
                      <span className="stat-card-total-title">Goals</span>
                    </div>
                    {showAttempts && (
                      <div className="stat-card-total-box attempts">
                        <span className="stat-card-total-num attempts">{totalAttempts}</span>
                        <span className="stat-card-total-title">Att</span>
                      </div>
                    )}
                    <div className="stat-card-total-box assists">
                      <span className="stat-card-total-num assists">{totalAssists}</span>
                      <span className="stat-card-total-title">Assists</span>
                    </div>
                    <div className="stat-card-total-box saves">
                      <span className="stat-card-total-num saves">{totalSaves}</span>
                      <span className="stat-card-total-title">Saves</span>
                    </div>
                    {showDC && (
                      <div className="stat-card-total-box dc">
                        <span className="stat-card-total-num dc">{totalDC}</span>
                        <span className="stat-card-total-title">DC</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* =======================================
               Table Mode (Compact Single-Row View with Sticky Player Column)
               ======================================= */
            <div className="stats-table-wrapper">
              <div className="stats-header">
                <div className="stat-player-col">
                  <span>Player</span>
                </div>

                <div className="stat-cols-3">
                  <div className="stat-col-header goals" title="Goals Scored">
                    <Target size={13} /> Goals
                  </div>
                  {showAttempts && (
                    <div className="stat-col-header attempts" title="Attempts at Goal">
                      <Crosshair size={13} /> Att
                    </div>
                  )}
                  <div className="stat-col-header assists" title="Assists">
                    <Award size={13} /> Asts
                  </div>
                  <div className="stat-col-header saves" title="Goalkeeper Saves">
                    <Shield size={13} /> Saves
                  </div>
                  {showDC && (
                    <div className="stat-col-header dc" title="Defensive Contributions">
                      <ShieldCheck size={13} /> DC
                    </div>
                  )}
                </div>
              </div>

              {playersInMatch.map((player) => (
                <div key={player.id} className="stat-row">
                  <div className="stat-player-col">
                    <div className="stat-player-info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span className="stat-player-name">{player.name}</span>
                        {player.is_goalkeeper && (
                          <span className="badge-gk-mini" title="Goalkeeper">GK</span>
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
                    {/* Goals Counter */}
                    <div className="stat-control-group">
                      <button
                        onClick={() => processGoalDecrement(player.id)}
                        className="btn-stat"
                        aria-label={`Decrease goals for ${player.name}`}
                      >
                        -
                      </button>
                      <span className="stat-value">{player.goals}</span>
                      <button
                        onClick={() => handleAddGoalClick(player.id)}
                        className="btn-stat-plus goals"
                        aria-label={`Add goal for ${player.name}`}
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    {/* Attempts Counter */}
                    {showAttempts && (
                      <div className="stat-control-group">
                        <button
                          onClick={() => handleAttemptDecrement(player.id)}
                          className="btn-stat"
                          aria-label={`Decrease attempts for ${player.name}`}
                        >
                          -
                        </button>
                        <span className="stat-value">{player.attempts}</span>
                        <button
                          onClick={() => handleAttemptClick(player.id)}
                          className="btn-stat-plus attempts"
                          aria-label={`Add attempt for ${player.name}`}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    )}

                    {/* Assists Counter */}
                    <div className="stat-control-group">
                      <button
                        onClick={() => updateMatchStat(activeMatch.id, player.id, 'assists', -1)}
                        className="btn-stat"
                        aria-label={`Decrease assists for ${player.name}`}
                      >
                        -
                      </button>
                      <span className="stat-value">{player.assists}</span>
                      <button
                        onClick={() => updateMatchStat(activeMatch.id, player.id, 'assists', 1)}
                        className="btn-stat-plus assists"
                        aria-label={`Add assist for ${player.name}`}
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    {/* Saves Counter (Goalkeeper) */}
                    <div className="stat-control-group">
                      <button
                        onClick={() => updateMatchStat(activeMatch.id, player.id, 'saves', -1)}
                        className="btn-stat"
                        aria-label={`Decrease saves for ${player.name}`}
                      >
                        -
                      </button>
                      <span className="stat-value">{player.saves}</span>
                      <button
                        onClick={() => updateMatchStat(activeMatch.id, player.id, 'saves', 1)}
                        className="btn-stat-plus saves"
                        aria-label={`Add save for ${player.name}`}
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    {/* Defensive Contributions Counter */}
                    {showDC && (
                      <div className="stat-control-group">
                        <button
                          onClick={() => updateMatchStat(activeMatch.id, player.id, 'defensive_contributions', -1)}
                          className="btn-stat"
                          aria-label={`Decrease DC for ${player.name}`}
                        >
                          -
                        </button>
                        <span className="stat-value">{player.defensive_contributions}</span>
                        <button
                          onClick={() => updateMatchStat(activeMatch.id, player.id, 'defensive_contributions', 1)}
                          className="btn-stat-plus dc"
                          aria-label={`Add DC for ${player.name}`}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    )}
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
                    <div className="stat-total-cell goals">{totalGoals}</div>
                    {showAttempts && <div className="stat-total-cell attempts">{totalAttempts}</div>}
                    <div className="stat-total-cell assists">{totalAssists}</div>
                    <div className="stat-total-cell saves">{totalSaves}</div>
                    {showDC && <div className="stat-total-cell dc">{totalDC}</div>}
                  </div>
                </div>
              )}
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
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
          }}>
            <div className="card" style={{ width: '100%', maxWidth: '400px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
              <div className="flex-between mb-4">
                <h3 className="title-md" style={{ marginBottom: 0 }}>
                  Who assisted {playersInMatch.find(p => p.id === assistModalScorer)?.name}?
                </h3>
                <button onClick={() => setAssistModalScorer(null)} className="btn-icon">
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
                  {playersInMatch.filter(p => p.id !== assistModalScorer).map((player) => (
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
          <div className="modal-overlay" onClick={() => setShowGkDialog(false)}>
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

        {/* Quick Record Defensive Contributions Modal */}
        {showDCDialog && (
          <div className="modal-overlay" onClick={() => setShowDCDialog(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
              <div className="flex-between mb-3">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    width: '2.25rem',
                    height: '2.25rem',
                    borderRadius: 'var(--radius-lg)',
                    backgroundColor: 'rgba(8, 145, 178, 0.15)',
                    color: '#0891b2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h3 className="title-md" style={{ marginBottom: 0 }}>Record Defensive Contribution</h3>
                    <span style={{ fontSize: '0.75rem', color: '#0891b2', fontWeight: 700 }}>
                      Match Total: {totalDC}
                    </span>
                  </div>
                </div>
                <button onClick={() => setShowDCDialog(false)} className="btn-icon">
                  <X size={20} />
                </button>
              </div>

              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Tap any player to instantly record a defensive contribution (tackle, interception, block, or clearance).
              </p>

              <div style={{ maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingRight: '0.2rem' }}>
                {playersInMatch.map((player) => {
                  const isJustTapped = justTappedDCId === player.id;
                  return (
                    <div
                      key={player.id}
                      className={`dc-player-tap-card ${isJustTapped ? 'just-tapped' : ''}`}
                    >
                      <div
                        className="dc-player-tap-main"
                        onClick={() => {
                          updateMatchStat(activeMatch.id, player.id, 'defensive_contributions', 1);
                          setJustTappedDCId(player.id);
                          setTimeout(() => setJustTappedDCId((curr) => (curr === player.id ? null : curr)), 350);
                        }}
                      >
                        <div
                          className="avatar"
                          style={{
                            backgroundColor: isJustTapped ? '#0891b2' : 'var(--color-border-light)',
                            color: isJustTapped ? '#ffffff' : 'var(--color-text-main)',
                            fontWeight: 700,
                            fontSize: '0.9rem',
                            transition: 'all 0.2s'
                          }}
                        >
                          {player.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text-main)' }}>
                            {player.name}
                          </div>
                          {!teamInfo.hide_positions && player.position && (
                            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                              {player.position}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="dc-player-tap-actions">
                        <button
                          type="button"
                          onClick={() => updateMatchStat(activeMatch.id, player.id, 'defensive_contributions', -1)}
                          disabled={player.defensive_contributions === 0}
                          className="btn-dc-tap-minus"
                          title={`Decrease DC for ${player.name}`}
                          aria-label={`Decrease DC for ${player.name}`}
                          style={{ opacity: player.defensive_contributions === 0 ? 0.35 : 1 }}
                        >
                          -
                        </button>

                        <div className="dc-counter-badge" title="Total Defensive Contributions">
                          <ShieldCheck size={13} />
                          <span>{player.defensive_contributions}</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            updateMatchStat(activeMatch.id, player.id, 'defensive_contributions', 1);
                            setJustTappedDCId(player.id);
                            setTimeout(() => setJustTappedDCId((curr) => (curr === player.id ? null : curr)), 350);
                          }}
                          className="btn-dc-tap-plus"
                          title={`Add Defensive Contribution for ${player.name}`}
                        >
                          <Plus size={14} /> +1
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button onClick={() => setShowDCDialog(false)} className="btn btn-primary mt-4" style={{ width: '100%' }}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
