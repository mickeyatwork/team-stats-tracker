import { useState, useRef, useCallback } from 'react';
import { Plus, Target, Award, Shield, CheckCircle, EyeOff, Edit2, Check, X } from 'lucide-react';
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

  // Autosave Player Stats (Goals, Assists, Saves)
  const savePlayerStatToDb = useDebounceCallback(async (matchId, playerId, goals, assists, saves) => {
    // Attempt upserting with saves column, fallback if saves column is pending database migration
    const { error } = await supabase.from('match_stats').upsert(
      { match_id: matchId, player_id: playerId, goals, assists, saves },
      { onConflict: 'match_id,player_id' }
    );
    if (error && error.message.includes('saves')) {
      await supabase.from('match_stats').upsert(
        { match_id: matchId, player_id: playerId, goals, assists },
        { onConflict: 'match_id,player_id' }
      );
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
    savePlayerStatToDb(matchId, playerId, g, a, s);
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
            saves: activeMatch.stats[pid]?.saves || 0
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
          <div className="stats-header">
            <span>Matchday Squad</span>
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

          <div style={{ backgroundColor: 'var(--color-bg-card)' }}>
            {playersInMatch.map((player) => (
              <div key={player.id} className="stat-row">
                <div className="stat-player-info">
                  <span className="stat-player-name">{player.name}</span>
                  <span className="stat-player-pos">{player.position}</span>
                </div>

                <div className="stat-cols-3">
                  {/* Goals Counter */}
                  <div className="stat-control-group">
                    <button
                      onClick={() => updateMatchStat(activeMatch.id, player.id, 'goals', -1)}
                      className="btn-stat"
                    >
                      -
                    </button>
                    <span className="stat-value">{player.goals}</span>
                    <button
                      onClick={() => updateMatchStat(activeMatch.id, player.id, 'goals', 1)}
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
      </div>
    </div>
  );
}
