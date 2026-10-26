import { useState, useEffect, useRef } from 'react';
import { Target, Award, Shield, X, Check, ChevronDown, Clock, ArrowUp, ArrowDown, Trash2, Plus, Sparkles, HelpCircle, RotateCcw, Edit2 } from 'lucide-react';
import TopNav from '../components/TopNav';
import { supabase } from '../supabaseClient';
import { computeTimelineWithScores, reorderTimelineEvents, generateMissingTimelineEvents } from '../utils/timelineUtils';
import { parseTournament } from '../utils/tournamentUtils';

export default function MatchReportView({
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
  const [goalEvents, setGoalEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [autoPopulating, setAutoPopulating] = useState(false);
  const reorderSaveTimerRef = useRef(null);
  
  // Linking / Editing assist
  const [linkingAssistEventId, setLinkingAssistEventId] = useState(null);

  // Assigning unassigned goal
  const [assigningGoalEvent, setAssigningGoalEvent] = useState(null);
  const [selectedScorerId, setSelectedScorerId] = useState('');

  // Add goal modal
  const [addGoalModalOpen, setAddGoalModalOpen] = useState(false);
  const [newGoalType, setNewGoalType] = useState('TEAM'); // 'TEAM' | 'OPPONENT'
  const [newGoalScorerId, setNewGoalScorerId] = useState('UNASSIGNED');
  const [newGoalAssisterId, setNewGoalAssisterId] = useState('');

  const handleReopenTracker = async () => {
    setMatches((prev) => prev.map((m) => (m.id === activeMatch.id ? { ...m, status: 'active' } : m)));
    await supabase.from('matches').update({ status: 'active' }).eq('id', activeMatch.id);
    setCurrentView('match_tracker');
  };

  useEffect(() => {
    if (!activeMatch) return;
    const fetchGoalEvents = async () => {
      setLoadingEvents(true);
      const { data } = await supabase
        .from('goal_events')
        .select('*')
        .eq('match_id', activeMatch.id)
        .order('created_at', { ascending: true });
      setGoalEvents(data || []);
      setLoadingEvents(false);
    };
    fetchGoalEvents();
  }, [activeMatch?.id]);

  if (!activeMatch) return null;

  const playersInMatch = activeMatch.stats
    ? Object.keys(activeMatch.stats)
        .map((pid) => {
          const pInfo = squad.find((s) => s.id === pid);
          return {
            id: pid,
            name: pInfo ? pInfo.name : 'Unknown Player',
            position: pInfo ? pInfo.position : '',
            goals: activeMatch.stats[pid]?.goals || 0,
            assists: activeMatch.stats[pid]?.assists || 0,
            saves: activeMatch.stats[pid]?.saves || 0,
            is_goalkeeper: activeMatch.stats[pid]?.is_goalkeeper || false
          };
        })
        .sort((a, b) => {
          const gaA = a.goals + a.assists;
          const gaB = b.goals + b.assists;
          if (gaA !== gaB) return gaB - gaA;
          return a.name.localeCompare(b.name);
        })
    : [];

  const totalGoals = playersInMatch.reduce((sum, p) => sum + p.goals, 0);
  const totalAssists = playersInMatch.reduce((sum, p) => sum + p.assists, 0);
  const totalSaves = playersInMatch.reduce((sum, p) => sum + p.saves, 0);

  const isWin = activeMatch.team_goals > activeMatch.opponent_goals;
  const isLoss = activeMatch.team_goals < activeMatch.opponent_goals;
  const resultClass = isWin ? 'score-win' : isLoss ? 'score-loss' : 'score-draw';

  const expectedTotalGoals = (activeMatch.team_goals || 0) + (activeMatch.opponent_goals || 0);
  const hasMissingGoals = goalEvents.length < expectedTotalGoals;

  const timelineItems = computeTimelineWithScores(goalEvents, activeMatch.opponent, squad);

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

  // Reorder timeline events
  const handleMoveGoal = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
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

  // Auto-populate missing timeline events
  const handleAutoPopulateTimeline = async () => {
    setAutoPopulating(true);
    try {
      const missingEvents = generateMissingTimelineEvents(activeMatch, playersInMatch, goalEvents);
      if (missingEvents.length === 0) {
        setAutoPopulating(false);
        return;
      }
      const { data, error } = await supabase
        .from('goal_events')
        .insert(missingEvents)
        .select();

      if (error) {
        console.error('Error auto-populating timeline:', error);
      } else if (data) {
        const combined = [...goalEvents, ...data].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        setGoalEvents(combined);
        if (setAllGoalEvents) {
          setAllGoalEvents((prev) => {
            const others = prev.filter((e) => e.match_id !== activeMatch.id);
            return [...others, ...combined];
          });
        }
      }
    } catch (err) {
      console.error('Failed to auto-populate timeline:', err);
    } finally {
      setAutoPopulating(false);
    }
  };

  // Reset timeline order so Team goals appear first and Opponent goals at end
  const handleResetTimelineOrder = async () => {
    if (!window.confirm('Reset the goal timeline so all Team goals appear first and Opponent goals appear at the end? You can then move them into your desired order.')) {
      return;
    }
    const teamGoalsList = goalEvents.filter((e) => e.scorer_id !== 'OPPONENT');
    const oppGoalsList = goalEvents.filter((e) => e.scorer_id === 'OPPONENT');
    const reordered = [...teamGoalsList, ...oppGoalsList];

    const validTimes = goalEvents
      .map((e) => (e.created_at ? new Date(e.created_at).getTime() : 0))
      .filter((t) => !isNaN(t) && t > 0);

    let startTimestamp = validTimes.length > 0 ? Math.min(...validTimes) : null;
    if (!startTimestamp) {
      if (activeMatch.date) {
        const d = new Date(activeMatch.date);
        d.setUTCHours(12, 0, 0, 0);
        startTimestamp = d.getTime();
      } else {
        startTimestamp = Date.now();
      }
    }

    const stamped = reordered.map((item, idx) => ({
      ...item,
      created_at: new Date(startTimestamp + idx * 10000).toISOString()
    }));

    setGoalEvents(stamped);
    if (setAllGoalEvents) {
      setAllGoalEvents((prev) => {
        const others = prev.filter((e) => e.match_id !== activeMatch.id);
        return [...others, ...stamped];
      });
    }

    for (let i = 0; i < stamped.length; i++) {
      await supabase
        .from('goal_events')
        .update({ created_at: stamped[i].created_at })
        .eq('id', stamped[i].id);
    }
  };

  // Assign or change assist
  const handleAssignAssist = async (eventId, newAssisterId) => {
    const evt = goalEvents.find((e) => e.id === eventId);
    if (!evt) return;
    const oldAssisterId = evt.assister_id;
    if (oldAssisterId === newAssisterId) {
      setLinkingAssistEventId(null);
      return;
    }

    const updated = { ...evt, assister_id: newAssisterId || null };
    setGoalEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
    if (setAllGoalEvents) {
      setAllGoalEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
    }

    await supabase
      .from('goal_events')
      .update({ assister_id: newAssisterId || null })
      .eq('id', eventId);

    if (matches && setMatches) {
      setMatches((prev) =>
        prev.map((m) => {
          if (m.id !== activeMatch.id) return m;
          const newStats = { ...m.stats };
          if (oldAssisterId && newStats[oldAssisterId]) {
            newStats[oldAssisterId] = {
              ...newStats[oldAssisterId],
              assists: Math.max(0, (newStats[oldAssisterId].assists || 0) - 1)
            };
          }
          if (newAssisterId) {
            const current = newStats[newAssisterId] || { goals: 0, assists: 0, saves: 0, is_goalkeeper: false };
            newStats[newAssisterId] = {
              ...current,
              assists: (current.assists || 0) + 1
            };
          }
          return { ...m, stats: newStats };
        })
      );

      if (oldAssisterId) {
        const m = matches.find((x) => x.id === activeMatch.id);
        const oldSt = m?.stats[oldAssisterId];
        if (oldSt) {
          await supabase.from('match_stats').upsert(
            {
              match_id: activeMatch.id,
              player_id: oldAssisterId,
              goals: oldSt.goals || 0,
              assists: Math.max(0, (oldSt.assists || 0) - 1),
              saves: oldSt.saves || 0,
              is_goalkeeper: oldSt.is_goalkeeper || false
            },
            { onConflict: 'match_id,player_id' }
          );
        }
      }
      if (newAssisterId) {
        const m = matches.find((x) => x.id === activeMatch.id);
        const newSt = m?.stats[newAssisterId] || { goals: 0, assists: 0, saves: 0, is_goalkeeper: false };
        await supabase.from('match_stats').upsert(
          {
            match_id: activeMatch.id,
            player_id: newAssisterId,
            goals: newSt.goals || 0,
            assists: (newSt.assists || 0) + 1,
            saves: newSt.saves || 0,
            is_goalkeeper: newSt.is_goalkeeper || false
          },
          { onConflict: 'match_id,player_id' }
        );
      }
    }

    setLinkingAssistEventId(null);
  };

  // Assign unassigned goal
  const handleAssignScorer = async (assisterId) => {
    if (!assigningGoalEvent || !selectedScorerId) return;
    const eventId = assigningGoalEvent.id;
    const scorerId = selectedScorerId;

    const updated = {
      ...assigningGoalEvent,
      scorer_id: scorerId,
      assister_id: assisterId || null
    };

    setGoalEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
    if (setAllGoalEvents) {
      setAllGoalEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
    }

    await supabase
      .from('goal_events')
      .update({ scorer_id: scorerId, assister_id: assisterId || null })
      .eq('id', eventId);

    if (matches && setMatches) {
      const m = matches.find((x) => x.id === activeMatch.id);
      if (m) {
        const newStats = { ...m.stats };
        const sStats = newStats[scorerId] || { goals: 0, assists: 0, saves: 0, is_goalkeeper: false };
        newStats[scorerId] = { ...sStats, goals: (sStats.goals || 0) + 1 };
        await supabase.from('match_stats').upsert(
          {
            match_id: activeMatch.id,
            player_id: scorerId,
            goals: (sStats.goals || 0) + 1,
            assists: sStats.assists || 0,
            saves: sStats.saves || 0,
            is_goalkeeper: sStats.is_goalkeeper || false
          },
          { onConflict: 'match_id,player_id' }
        );

        if (assisterId) {
          const aStats = newStats[assisterId] || { goals: 0, assists: 0, saves: 0, is_goalkeeper: false };
          newStats[assisterId] = { ...aStats, assists: (aStats.assists || 0) + 1 };
          await supabase.from('match_stats').upsert(
            {
              match_id: activeMatch.id,
              player_id: assisterId,
              goals: aStats.goals || 0,
              assists: (aStats.assists || 0) + 1,
              saves: aStats.saves || 0,
              is_goalkeeper: aStats.is_goalkeeper || false
            },
            { onConflict: 'match_id,player_id' }
          );
        }

        setMatches((prev) => prev.map((item) => (item.id === activeMatch.id ? { ...item, stats: newStats } : item)));
      }
    }

    setAssigningGoalEvent(null);
    setSelectedScorerId('');
  };

  // Delete goal event
  const handleDeleteGoal = async (eventId) => {
    const evt = goalEvents.find((e) => e.id === eventId);
    if (!evt) return;

    if (!window.confirm('Delete this goal from the timeline? This will also decrement the match score and player stats.')) {
      return;
    }

    setGoalEvents((prev) => prev.filter((e) => e.id !== eventId));
    if (setAllGoalEvents) {
      setAllGoalEvents((prev) => prev.filter((e) => e.id !== eventId));
    }

    await supabase.from('goal_events').delete().eq('id', eventId);

    const isOpponent = evt.scorer_id === 'OPPONENT';
    const isUnassigned = evt.scorer_id === 'UNASSIGNED' || !evt.scorer_id;

    if (matches && setMatches) {
      const m = matches.find((x) => x.id === activeMatch.id);
      if (m) {
        if (isOpponent) {
          const newOppGoals = Math.max(0, (m.opponent_goals || 0) - 1);
          setMatches((prev) => prev.map((match) => (match.id === activeMatch.id ? { ...match, opponent_goals: newOppGoals } : match)));
          await supabase.from('matches').update({ opponent_goals: newOppGoals }).eq('id', activeMatch.id);
        } else {
          const newTeamGoals = Math.max(0, (m.team_goals || 0) - 1);
          const newStats = { ...m.stats };

          if (!isUnassigned && newStats[evt.scorer_id]) {
            const sStats = newStats[evt.scorer_id];
            const updatedGoals = Math.max(0, (sStats.goals || 0) - 1);
            newStats[evt.scorer_id] = { ...sStats, goals: updatedGoals };
            await supabase.from('match_stats').upsert(
              {
                match_id: activeMatch.id,
                player_id: evt.scorer_id,
                goals: updatedGoals,
                assists: sStats.assists || 0,
                saves: sStats.saves || 0,
                is_goalkeeper: sStats.is_goalkeeper || false
              },
              { onConflict: 'match_id,player_id' }
            );
          }

          if (evt.assister_id && newStats[evt.assister_id]) {
            const aStats = newStats[evt.assister_id];
            const updatedAssists = Math.max(0, (aStats.assists || 0) - 1);
            newStats[evt.assister_id] = { ...aStats, assists: updatedAssists };
            await supabase.from('match_stats').upsert(
              {
                match_id: activeMatch.id,
                player_id: evt.assister_id,
                goals: aStats.goals || 0,
                assists: updatedAssists,
                saves: aStats.saves || 0,
                is_goalkeeper: aStats.is_goalkeeper || false
              },
              { onConflict: 'match_id,player_id' }
            );
          }

          setMatches((prev) => prev.map((match) => (match.id === activeMatch.id ? { ...match, stats: newStats, team_goals: newTeamGoals } : match)));
          await supabase.from('matches').update({ team_goals: newTeamGoals }).eq('id', activeMatch.id);
        }
      }
    }
  };

  // Add new goal
  const handleAddGoal = async () => {
    const isOpponent = newGoalType === 'OPPONENT';
    const validTimes = goalEvents
      .map((e) => (e.created_at ? new Date(e.created_at).getTime() : 0))
      .filter((t) => !isNaN(t) && t > 0);

    let baseTime = validTimes.length > 0 ? Math.max(...validTimes) + 10000 : null;
    if (!baseTime) {
      if (activeMatch.date) {
        const d = new Date(activeMatch.date);
        if (!isNaN(d.getTime())) {
          d.setUTCHours(12, 0, 0, 0);
          baseTime = d.getTime();
        } else {
          baseTime = Date.now();
        }
      } else {
        baseTime = Date.now();
      }
    }
    const nextTime = new Date(baseTime).toISOString();

    const payload = {
      match_id: activeMatch.id,
      scorer_id: isOpponent ? 'OPPONENT' : (newGoalScorerId || 'UNASSIGNED'),
      assister_id: !isOpponent && newGoalAssisterId ? newGoalAssisterId : null,
      created_at: nextTime
    };

    const { data: newEvt, error } = await supabase.from('goal_events').insert([payload]).select().single();
    if (error || !newEvt) {
      console.error('Error adding goal event:', error);
      return;
    }

    setGoalEvents((prev) => [...prev, newEvt]);
    if (setAllGoalEvents) setAllGoalEvents((prev) => [...prev, newEvt]);

    if (matches && setMatches) {
      const m = matches.find((x) => x.id === activeMatch.id);
      if (m) {
        if (isOpponent) {
          const newOppGoals = (m.opponent_goals || 0) + 1;
          setMatches((prev) => prev.map((match) => (match.id === activeMatch.id ? { ...match, opponent_goals: newOppGoals } : match)));
          await supabase.from('matches').update({ opponent_goals: newOppGoals }).eq('id', activeMatch.id);
        } else {
          const newTeamGoals = (m.team_goals || 0) + 1;
          const newStats = { ...m.stats };

          if (newGoalScorerId && newGoalScorerId !== 'UNASSIGNED') {
            const sStats = newStats[newGoalScorerId] || { goals: 0, assists: 0, saves: 0, is_goalkeeper: false };
            newStats[newGoalScorerId] = { ...sStats, goals: (sStats.goals || 0) + 1 };
            await supabase.from('match_stats').upsert(
              {
                match_id: activeMatch.id,
                player_id: newGoalScorerId,
                goals: (sStats.goals || 0) + 1,
                assists: sStats.assists || 0,
                saves: sStats.saves || 0,
                is_goalkeeper: sStats.is_goalkeeper || false
              },
              { onConflict: 'match_id,player_id' }
            );
          }

          if (newGoalAssisterId) {
            const aStats = newStats[newGoalAssisterId] || { goals: 0, assists: 0, saves: 0, is_goalkeeper: false };
            newStats[newGoalAssisterId] = { ...aStats, assists: (aStats.assists || 0) + 1 };
            await supabase.from('match_stats').upsert(
              {
                match_id: activeMatch.id,
                player_id: newGoalAssisterId,
                goals: aStats.goals || 0,
                assists: (aStats.assists || 0) + 1,
                saves: aStats.saves || 0,
                is_goalkeeper: aStats.is_goalkeeper || false
              },
              { onConflict: 'match_id,player_id' }
            );
          }

          setMatches((prev) => prev.map((match) => (match.id === activeMatch.id ? { ...match, stats: newStats, team_goals: newTeamGoals } : match)));
          await supabase.from('matches').update({ team_goals: newTeamGoals }).eq('id', activeMatch.id);
        }
      }
    }

    setAddGoalModalOpen(false);
    setNewGoalScorerId('UNASSIGNED');
    setNewGoalAssisterId('');
  };

  return (
    <div className="app-container">
      <TopNav
        title="Match Report"
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
        {/* Score header */}
        <div className="card" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <div className="badge badge-blue" style={{ display: 'inline-flex', marginBottom: '1rem' }}>
            {activeMatch.competition === 'Tournament'
              ? (() => {
                  const { name, round } = parseTournament(activeMatch.tournament);
                  return round ? `${name} (${round})` : name;
                })()
              : activeMatch.competition || 'Friendly'}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2rem' }}>
            <div style={{ flex: 1, textAlign: 'right', fontWeight: 600, fontSize: '1.25rem' }}>
              {teamInfo.name}
            </div>
            {!activeMatch.hide_score ? (
              <div className="match-score" style={{ background: 'var(--color-bg-body)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-lg)' }}>
                <span className={resultClass}>{activeMatch.team_goals}</span>
                <span style={{ color: 'var(--color-text-muted)', margin: '0 0.5rem' }}>-</span>
                <span className={isLoss ? 'score-win' : isWin ? 'score-loss' : 'score-draw'}>{activeMatch.opponent_goals}</span>
              </div>
            ) : (
              <div style={{ padding: '0.5rem 1rem', color: 'var(--color-text-muted)' }}>Score Hidden</div>
            )}
            <div style={{ flex: 1, textAlign: 'left', fontWeight: 600, fontSize: '1.25rem' }}>
              {activeMatch.opponent}
            </div>
          </div>

          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '1rem' }}>
            {new Date(activeMatch.date).toLocaleDateString('en-GB', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
            <button
              onClick={handleReopenTracker}
              className="btn btn-secondary"
              style={{
                width: 'auto',
                padding: '0.45rem 1rem',
                fontSize: '0.825rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              <Edit2 size={14} /> Re-open Match Tracker
            </button>
          </div>
        </div>

        {/* Retrospective Timeline Prompt Banner */}
        {hasMissingGoals && (
          <div className="timeline-prompt-card">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem' }}>
              <Sparkles size={20} style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: '2px' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text-main)', marginBottom: '0.25rem' }}>
                  Goal Order &amp; Timeline Not Configured
                </div>
                <p>
                  This match has <strong>{activeMatch.team_goals}</strong> team goal(s) and <strong>{activeMatch.opponent_goals}</strong> opponent goal(s) recorded in the match score, but only <strong>{goalEvents.length}</strong> goal event(s) in the chronological timeline.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
              <button
                className="btn btn-primary"
                onClick={handleAutoPopulateTimeline}
                disabled={autoPopulating}
                style={{ fontSize: '0.85rem', padding: '0.5rem 1rem', gap: '0.4rem', display: 'inline-flex', alignItems: 'center' }}
              >
                <Sparkles size={16} />
                {autoPopulating ? 'Auto-populating...' : 'Auto-populate Timeline from Match Stats'}
              </button>
            </div>
          </div>
        )}

        {/* Goal Order & Match Timeline Section */}
        <div className="card timeline-card" style={{ marginBottom: '1.5rem' }}>
          <div className="timeline-header">
            <div className="timeline-header-title">
              <Clock size={18} style={{ color: 'var(--color-primary)' }} />
              <span>Goal Order &amp; Match Timeline</span>
              <span className="timeline-count-badge">
                {timelineItems.length} {timelineItems.length === 1 ? 'goal' : 'goals'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {timelineItems.length > 1 && (
                <button
                  onClick={handleResetTimelineOrder}
                  className="btn btn-secondary"
                  title="Reset order so Team goals appear first and Opponent goals at end"
                  style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                >
                  <RotateCcw size={13} /> Reset Order
                </button>
              )}
              <button
                onClick={() => {
                  setNewGoalType('TEAM');
                  setNewGoalScorerId(playersInMatch.length > 0 ? playersInMatch[0].id : 'UNASSIGNED');
                  setNewGoalAssisterId('');
                  setAddGoalModalOpen(true);
                }}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <Plus size={15} /> Add Goal
              </button>
            </div>
          </div>

          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem', marginTop: '-0.25rem' }}>
            Use the <strong>▲</strong> and <strong>▼</strong> arrows to set the exact chronological order of how the goals were scored. You can also assign assists or link unassigned goals.
          </p>

          {loadingEvents ? (
            <div className="empty-state" style={{ padding: '1.5rem 0' }}>Loading match timeline...</div>
          ) : timelineItems.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem 0' }}>
              <p style={{ margin: 0 }}>No goals recorded in the timeline yet.</p>
              {expectedTotalGoals > 0 && (
                <button
                  className="btn btn-primary mt-3"
                  onClick={handleAutoPopulateTimeline}
                  disabled={autoPopulating}
                  style={{ fontSize: '0.85rem' }}
                >
                  <Sparkles size={15} style={{ marginRight: '0.35rem' }} /> Auto-populate from Match Stats
                </button>
              )}
            </div>
          ) : (
            <div className="timeline-list">
              {timelineItems.map((item, index) => {
                const isFirst = index === 0;
                const isLast = index === timelineItems.length - 1;
                const isLinkingAssist = linkingAssistEventId === item.id;

                return (
                  <div key={item.id} style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="timeline-item">
                      <select
                        className="timeline-order-select"
                        value={item.orderNumber}
                        onChange={(e) => handleMoveGoal(index, parseInt(e.target.value, 10) - 1)}
                        title="Change goal order position"
                      >
                        {timelineItems.map((_, i) => (
                          <option key={i + 1} value={i + 1}>#{i + 1}</option>
                        ))}
                      </select>
                      <div className="timeline-score">{item.scoreFormatted}</div>

                      <div className="timeline-content">
                        {item.isOpponent ? (
                          <>
                            <div className="timeline-title opponent">
                              <Shield size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.3rem' }} />
                              {activeMatch.opponent} Goal
                            </div>
                            <div className="timeline-subtitle">Opponent scored</div>
                          </>
                        ) : item.isUnassigned ? (
                          <>
                            <div className="timeline-title unassigned" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <HelpCircle size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
                              <span>Team Goal (Unassigned)</span>
                              <button
                                onClick={() => {
                                  setAssigningGoalEvent(item);
                                  setSelectedScorerId(playersInMatch.length > 0 ? playersInMatch[0].id : '');
                                }}
                                className="btn btn-secondary"
                                style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem', height: 'auto' }}
                              >
                                Assign Scorer
                              </button>
                            </div>
                            <div className="timeline-subtitle">Assign a player who scored this goal</div>
                          </>
                        ) : (
                          <>
                            <div className="timeline-title">
                              <Target size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.3rem', color: 'var(--color-primary)' }} />
                              {item.scorerName}
                            </div>
                            <div className="timeline-subtitle" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              {item.assisterName ? (
                                <>
                                  <span style={{ color: 'var(--color-primary-dark)', fontWeight: 600 }}>
                                    Assist: {item.assisterName}
                                  </span>
                                  <button
                                    onClick={() => setLinkingAssistEventId(isLinkingAssist ? null : item.id)}
                                    className="btn-icon-subtle"
                                    title="Change assist"
                                    style={{ padding: '0.1rem 0.3rem' }}
                                  >
                                    <ChevronDown size={13} />
                                  </button>
                                  <button
                                    onClick={() => handleAssignAssist(item.id, null)}
                                    className="btn-icon-subtle"
                                    title="Remove assist"
                                    style={{ padding: '0.1rem 0.3rem' }}
                                  >
                                    <X size={13} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => setLinkingAssistEventId(isLinkingAssist ? null : item.id)}
                                  className="btn btn-secondary"
                                  style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem', height: 'auto' }}
                                >
                                  + Link Assist
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      <div className="timeline-actions">
                        <button
                          className="btn-timeline-arrow"
                          onClick={() => handleMoveGoal(index, index - 1)}
                          disabled={isFirst}
                          title="Move earlier"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          className="btn-timeline-arrow"
                          onClick={() => handleMoveGoal(index, index + 1)}
                          disabled={isLast}
                          title="Move later"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          className="btn-timeline-del"
                          onClick={() => handleDeleteGoal(item.id)}
                          title="Delete goal"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Inline assister selector dropdown */}
                    {isLinkingAssist && (
                      <div
                        style={{
                          margin: '0.25rem 0 0.5rem 2.5rem',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-lg)',
                          overflow: 'hidden',
                          background: 'var(--color-bg-card)',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
                        }}
                      >
                        <div
                          onClick={() => handleAssignAssist(item.id, null)}
                          style={{
                            padding: '0.55rem 0.85rem',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: '0.8rem',
                            color: 'var(--color-text-muted)',
                            borderBottom: '1px solid var(--color-border-light)'
                          }}
                        >
                          <X size={12} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
                          Unassisted / Clear Assist
                        </div>
                        {playersInMatch
                          .filter((p) => p.id !== item.scorer_id)
                          .map((p) => (
                            <div
                              key={p.id}
                              onClick={() => handleAssignAssist(item.id, p.id)}
                              style={{
                                padding: '0.55rem 0.85rem',
                                cursor: 'pointer',
                                fontSize: '0.825rem',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                borderBottom: '1px solid var(--color-border-light)',
                                background: item.assister_id === p.id ? 'var(--color-primary-light)' : 'transparent',
                                color: item.assister_id === p.id ? 'var(--color-primary-dark)' : 'var(--color-text-main)'
                              }}
                            >
                              {item.assister_id === p.id && <Check size={12} />}
                              {p.name}
                            </div>
                          ))}
                        <div
                          onClick={() => setLinkingAssistEventId(null)}
                          style={{
                            padding: '0.4rem 0.85rem',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            textAlign: 'center',
                            color: 'var(--color-text-muted)'
                          }}
                        >
                          Cancel
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Player stats table */}
        <div className="card">
          <h3 className="title-md" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
            Player Performances
          </h3>
          {playersInMatch.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    {!teamInfo.hide_positions && <th>Pos</th>}
                    <th style={{ textAlign: 'center' }}><Target size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> G</th>
                    <th style={{ textAlign: 'center' }}><Award size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> A</th>
                    <th style={{ textAlign: 'center' }}>G+A</th>
                    <th style={{ textAlign: 'center' }}><Shield size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> S</th>
                  </tr>
                </thead>
                <tbody>
                  {playersInMatch.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>
                        {p.name}
                        {p.is_goalkeeper && (
                          <span style={{
                            marginLeft: '0.4rem',
                            fontSize: '0.6rem',
                            padding: '0.1rem 0.25rem',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: '#b45309',
                            color: '#ffffff',
                            verticalAlign: 'middle'
                          }}>
                            GK
                          </span>
                        )}
                      </td>
                      {!teamInfo.hide_positions && <td><span className="badge-pos">{p.position}</span></td>}
                      <td style={{ textAlign: 'center', fontWeight: p.goals > 0 ? 600 : 400 }}>{p.goals}</td>
                      <td style={{ textAlign: 'center', fontWeight: p.assists > 0 ? 600 : 400 }}>{p.assists}</td>
                      <td style={{ textAlign: 'center', fontWeight: p.goals + p.assists > 0 ? 700 : 400, color: p.goals + p.assists > 0 ? 'var(--color-primary-dark)' : 'inherit' }}>
                        {p.goals + p.assists}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: p.saves > 0 ? 600 : 400 }}>{p.saves}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--color-bg-body)', fontWeight: 700 }}>
                    <td colSpan={teamInfo.hide_positions ? 1 : 2} style={{ textAlign: 'right', paddingRight: '1rem' }}>Totals</td>
                    <td style={{ textAlign: 'center' }}>{totalGoals}</td>
                    <td style={{ textAlign: 'center' }}>{totalAssists}</td>
                    <td style={{ textAlign: 'center' }}>{totalGoals + totalAssists}</td>
                    <td style={{ textAlign: 'center' }}>{totalSaves}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="empty-state">No players recorded for this match.</div>
          )}
        </div>
      </div>

      {/* Modal: Assign Scorer for Unassigned Team Goal */}
      {assigningGoalEvent && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <div className="flex-between mb-4">
              <h3 className="title-md" style={{ margin: 0 }}>Assign Scorer to Goal</h3>
              <button
                className="btn-icon"
                onClick={() => {
                  setAssigningGoalEvent(null);
                  setSelectedScorerId('');
                }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
              Select who scored this team goal and optionally select who provided the assist:
            </p>

            <div className="form-group mb-4">
              <label className="form-label" style={{ fontWeight: 600 }}>Goalscorer</label>
              <select
                className="form-control"
                value={selectedScorerId}
                onChange={(e) => setSelectedScorerId(e.target.value)}
              >
                <option value="" disabled>-- Select Goalscorer --</option>
                {playersInMatch.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {selectedScorerId && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label className="form-label" style={{ fontWeight: 600 }}>Assist (Optional)</label>
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
                  <button
                    className="modal-option-btn"
                    onClick={() => handleAssignScorer(null)}
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                  >
                    <span>No Assist (Unassisted)</span>
                  </button>
                  {playersInMatch
                    .filter((p) => p.id !== selectedScorerId)
                    .map((p) => (
                      <button
                        key={p.id}
                        className="modal-option-btn"
                        onClick={() => handleAssignScorer(p.id)}
                      >
                        <span>{p.name}</span>
                        <Award size={14} style={{ color: 'var(--color-secondary)' }} />
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Add Goal Manually */}
      {addGoalModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <div className="flex-between mb-3">
              <h3 className="title-md" style={{ margin: 0 }}>Add Goal to Timeline</h3>
              <button className="btn-icon" onClick={() => setAddGoalModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <button
                type="button"
                className={`btn ${newGoalType === 'TEAM' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => setNewGoalType('TEAM')}
              >
                {teamInfo.name} Goal
              </button>
              <button
                type="button"
                className={`btn ${newGoalType === 'OPPONENT' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => setNewGoalType('OPPONENT')}
              >
                {activeMatch.opponent} Goal
              </button>
            </div>

            {newGoalType === 'TEAM' ? (
              <>
                <div className="form-group mb-3">
                  <label className="form-label">Goalscorer</label>
                  <select
                    className="form-control"
                    value={newGoalScorerId}
                    onChange={(e) => {
                      setNewGoalScorerId(e.target.value);
                      if (newGoalAssisterId === e.target.value) setNewGoalAssisterId('');
                    }}
                  >
                    <option value="UNASSIGNED">Unassigned Team Goal</option>
                    {playersInMatch.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {newGoalScorerId !== 'UNASSIGNED' && (
                  <div className="form-group mb-4">
                    <label className="form-label">Assist (Optional)</label>
                    <select
                      className="form-control"
                      value={newGoalAssisterId}
                      onChange={(e) => setNewGoalAssisterId(e.target.value)}
                    >
                      <option value="">No Assist (Unassisted)</option>
                      {playersInMatch
                        .filter((p) => p.id !== newGoalScorerId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                  </div>
                )}
              </>
            ) : (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
                This will add an opposition goal for <strong>{activeMatch.opponent}</strong> at the end of the timeline and increment the opponent score.
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setAddGoalModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAddGoal}
              >
                Add Goal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
