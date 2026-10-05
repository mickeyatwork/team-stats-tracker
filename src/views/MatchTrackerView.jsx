import { useState, useRef, useCallback } from 'react';
import { Plus, Target, Award, Shield, CheckCircle, EyeOff, Edit2, Check, X, Users } from 'lucide-react';
import TopNav from '../components/TopNav';
import { supabase } from '../supabaseClient';

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
  setActiveMatchId
}) {
  const [editingOpponent, setEditingOpponent] = useState(false);
  const [opponentInput, setOpponentInput] = useState(activeMatch?.opponent || '');
  const [showAmendSquad, setShowAmendSquad] = useState(false);
  const [assistModalScorer, setAssistModalScorer] = useState(null);
  const [playerToRemove, setPlayerToRemove] = useState(null); // { id, name }


  // Autosave Match Score
  const saveMatchScoreToDb = useDebounceCallback(async (matchId, teamGoals, oppGoals) => {
    await supabase.from('matches').update({ team_goals: teamGoals, opponent_goals: oppGoals }).eq('id', matchId);
  }, 1000);

  const updateMatchScore = (matchId, team, delta) => {
    const m = matches.find((x) => x.id === matchId);
    if (!m) return;
    const newVal = Math.max(0, m[team] + delta);
    setMatches(matches.map((match) => (match.id === matchId ? { ...match, [team]: newVal } : match)));
    const tGoals = team === 'team_goals' ? newVal : m.team_goals;
    const oGoals = team === 'opponent_goals' ? newVal : m.opponent_goals;
    saveMatchScoreToDb(matchId, tGoals, oGoals);
  };

  // Autosave Player Stats (Goals, Assists, Saves, GK status)
  const savePlayerStatToDb = useDebounceCallback(async (matchId, playerId, goals, assists, saves, is_goalkeeper) => {
    const { error } = await supabase.from('match_stats').upsert(
      { match_id: matchId, player_id: playerId, goals, assists, saves, is_goalkeeper },
      { onConflict: 'match_id,player_id' }
    );
    if (error) console.error('Error saving player stat:', error);
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
    const isGk = stat === 'is_goalkeeper' ? newVal : m.stats[playerId]?.is_goalkeeper || false;
    savePlayerStatToDb(matchId, playerId, g, a, s, isGk);
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
    savePlayerStatToDb(matchId, playerId, g, a, s, newVal);
  };

  const handleAddGoalClick = (playerId) => {
    setAssistModalScorer(playerId);
  };

  const processGoalWithAssist = async (assisterId) => {
    const scorerId = assistModalScorer;
    setAssistModalScorer(null);

    // Get current state to ensure we have the latest values for DB
    const m = matches.find((x) => x.id === activeMatch.id);
    if (!m) return;
    
    const scorerStats = m.stats[scorerId] || { goals: 0, assists: 0, saves: 0 };
    const assisterStats = assisterId ? (m.stats[assisterId] || { goals: 0, assists: 0, saves: 0 }) : null;

    const newScorerGoals = scorerStats.goals + 1;
    const newAssisterAssists = assisterStats ? assisterStats.assists + 1 : 0;
    const newTeamGoals = m.team_goals + 1;

    // Update state functionally so both updates apply
    setMatches((prev) => prev.map(match => {
      if (match.id !== activeMatch.id) return match;
      const newStats = { ...match.stats };
      newStats[scorerId] = { ...scorerStats, goals: newScorerGoals };
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
      await supabase.from('match_stats').upsert(
        { match_id: activeMatch.id, player_id: pid, goals: st.goals, assists: st.assists, saves: st.saves || 0, is_goalkeeper: st.is_goalkeeper || false },
        { onConflict: 'match_id,player_id' }
      );
    };

    await upsertSafe(scorerId, { goals: newScorerGoals, assists: scorerStats.assists, saves: scorerStats.saves, is_goalkeeper: scorerStats.is_goalkeeper });
    if (assisterId) {
      await upsertSafe(assisterId, { goals: assisterStats.goals, assists: newAssisterAssists, saves: assisterStats.saves, is_goalkeeper: assisterStats.is_goalkeeper });
    }

    // Log the goal event in the database
    await supabase.from('goal_events').insert([{
      match_id: activeMatch.id,
      scorer_id: scorerId,
      assister_id: assisterId
    }]);
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
      newStats[playerId] = { ...pStats, goals: Math.max(0, pStats.goals - 1) };
      
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
      await supabase.from('match_stats').upsert(
        { match_id: activeMatch.id, player_id: pid, goals: st.goals, assists: st.assists, saves: st.saves || 0, is_goalkeeper: st.is_goalkeeper || false },
        { onConflict: 'match_id,player_id' }
      );
    };

    await upsertSafe(playerId, { goals: Math.max(0, m.stats[playerId].goals - 1), assists: m.stats[playerId].assists, saves: m.stats[playerId].saves, is_goalkeeper: m.stats[playerId].is_goalkeeper });

    if (eventToDelete) {
      await supabase.from('goal_events').delete().eq('id', eventToDelete.id);
      
      if (eventToDelete.assister_id && m.stats[eventToDelete.assister_id]) {
        const aStats = m.stats[eventToDelete.assister_id];
        await upsertSafe(eventToDelete.assister_id, { goals: aStats.goals, assists: Math.max(0, aStats.assists - 1), saves: aStats.saves, is_goalkeeper: aStats.is_goalkeeper });
      }
    }
  };


  const finishMatch = async (matchId) => {
    setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, status: 'finished' } : m)));
    await supabase.from('matches').update({ status: 'finished' }).eq('id', matchId);
    setCurrentView('matches');
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
      const initialPlayerStats = { goals: 0, assists: 0, saves: 0 };
      const newStats = { ...activeMatch.stats, [playerId]: initialPlayerStats };
      
      setMatches((prev) => prev.map(m => m.id === activeMatch.id ? { ...m, stats: newStats } : m));
      
      // Upsert default stats to database
      await supabase.from('match_stats').upsert(
        { match_id: activeMatch.id, player_id: playerId, goals: 0, assists: 0, saves: 0, is_goalkeeper: false },
        { onConflict: 'match_id,player_id' }
      );
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
            is_goalkeeper: activeMatch.stats[pid]?.is_goalkeeper || false
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const totalGoals = playersInMatch.reduce((sum, p) => sum + p.goals, 0);
  const totalAssists = playersInMatch.reduce((sum, p) => sum + p.assists, 0);
  const totalSaves = playersInMatch.reduce((sum, p) => sum + p.saves, 0);

  return (
    <div className="app-container">
      <TopNav
        title={
          activeMatch.competition === 'Tournament'
            ? activeMatch.tournament
            : `${activeMatch.competition || 'Friendly'} Match`
        }
        onBack={() => {
          setActiveMatchId(null);
          setCurrentView('matches');
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
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem', textAlign: 'center' }}
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

        {/* Player Stats List */}
        <div className="stats-list mt-6">
          <div className="flex-between mb-2">
            <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>Matchday Squad</span>
            <button 
              onClick={() => setShowAmendSquad(true)} 
              className="btn btn-secondary"
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            >
              <Users size={14} /> Amend Squad
            </button>
          </div>
          <div className="stats-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
              <span style={{ width: '32px', textAlign: 'center', fontSize: '0.65rem', color: 'var(--color-text-light)' }} title="Played in goal">GK?</span>
              <span>Player</span>
            </div>

            <div className="stat-cols-3">
              <div className="stat-col-header goals" title="Goals Scored">
                <Target size={14} /> Goals
              </div>
              <div className="stat-col-header assists" title="Assists">
                <Award size={14} /> Asts
              </div>
              <div className="stat-col-header saves" title="Goalkeeper Saves">
                <Shield size={14} /> Saves
              </div>
            </div>
          </div>

          <div style={{ 
            backgroundColor: 'var(--color-bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border-light)',
            overflow: 'hidden'
          }}>
            {playersInMatch.map((player) => (
              <div key={player.id} className="stat-row">
                <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: '0.75rem' }}>
                  <button
                    onClick={() => toggleGoalkeeper(activeMatch.id, player.id)}
                    title="Toggle Goalkeeper Status"
                    style={{
                      fontSize: '0.7rem',
                      padding: '0.2rem 0',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid',
                      cursor: 'pointer',
                      fontWeight: player.is_goalkeeper ? 700 : 600,
                      backgroundColor: player.is_goalkeeper ? '#b45309' : 'transparent',
                      color: player.is_goalkeeper ? '#ffffff' : 'var(--color-text-muted)',
                      borderColor: player.is_goalkeeper ? '#b45309' : 'var(--color-border)',
                      transition: 'all 0.15s',
                      width: '32px',
                      textAlign: 'center',
                      flexShrink: 0
                    }}
                  >
                    GK
                  </button>
                  
                  <div className="stat-player-info" style={{ flex: 1, margin: 0 }}>
                    <span className="stat-player-name">{player.name}</span>
                    {!teamInfo.hide_positions && (
                      <div style={{ marginTop: '0.15rem' }}>
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
                    >
                      -
                    </button>
                    <span className="stat-value">{player.goals}</span>
                    <button
                      onClick={() => handleAddGoalClick(player.id)}
                      className="btn-stat-plus goals"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  {/* Assists Counter */}
                  <div className="stat-control-group">
                    <button
                      onClick={() => updateMatchStat(activeMatch.id, player.id, 'assists', -1)}
                      className="btn-stat"
                    >
                      -
                    </button>
                    <span className="stat-value">{player.assists}</span>
                    <button
                      onClick={() => updateMatchStat(activeMatch.id, player.id, 'assists', 1)}
                      className="btn-stat-plus assists"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  {/* Saves Counter (Goalkeeper) */}
                  <div className="stat-control-group">
                    <button
                      onClick={() => updateMatchStat(activeMatch.id, player.id, 'saves', -1)}
                      className="btn-stat"
                    >
                      -
                    </button>
                    <span className="stat-value">{player.saves}</span>
                    <button
                      onClick={() => updateMatchStat(activeMatch.id, player.id, 'saves', 1)}
                      className="btn-stat-plus saves"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Totals Footer */}
            {playersInMatch.length > 0 && (
              <div className="stat-totals-footer">
                <span className="stat-totals-label">Totals</span>
                <div className="stat-cols-3">
                  <div className="stat-total-cell goals">{totalGoals}</div>
                  <div className="stat-total-cell assists">{totalAssists}</div>
                  <div className="stat-total-cell saves">{totalSaves}</div>
                </div>
              </div>
            )}

            {playersInMatch.length === 0 && <div className="empty-state">No players selected in this match.</div>}
          </div>
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
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Add or remove players from this match. Removing a player will delete their stats for this match.
              </p>
              
              <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                {squad.map((player) => {
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
      </div>
    </div>
  );
}
