import { useState, useEffect } from 'react';
import { Target, Award, Shield, Link2, X, Check, ChevronDown } from 'lucide-react';
import TopNav from '../components/TopNav';
import { supabase } from '../supabaseClient';

export default function MatchReportView({
  activeMatch,
  squad,
  teamInfo,
  setCurrentView,
  setActiveMatchId
}) {
  const [goalEvents, setGoalEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  // linkingGoal: { scorerId, goalIndex } — which goal slot is being actively assigned
  const [linkingGoal, setLinkingGoal] = useState(null);

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

  // Build a map: scorerId -> array of goal event objects (one per goal)
  // Goals that have no event yet are represented as null entries
  const buildGoalSlots = () => {
    const slots = {};
    playersInMatch.filter(p => p.goals > 0).forEach(p => {
      // Find all events for this scorer in this match
      const events = goalEvents.filter(e => e.scorer_id === p.id);
      // Fill up to p.goals slots — pad with null if no event logged yet
      slots[p.id] = Array.from({ length: p.goals }, (_, i) => events[i] || null);
    });
    return slots;
  };
  const goalSlots = buildGoalSlots();

  const scorers = playersInMatch.filter(p => p.goals > 0);
  const totalLinked = goalEvents.filter(e => e.match_id === activeMatch.id).length;
  const totalGoalCount = playersInMatch.reduce((s, p) => s + p.goals, 0);
  const allLinked = totalLinked >= totalGoalCount && totalGoalCount > 0;

  const assignAssist = async (scorerId, goalIndex, assisterId) => {
    const events = goalEvents.filter(e => e.scorer_id === scorerId);
    const existing = events[goalIndex];

    if (existing) {
      // Update existing event
      const updated = { ...existing, assister_id: assisterId };
      setGoalEvents(prev => prev.map(e => e.id === existing.id ? updated : e));
      await supabase
        .from('goal_events')
        .update({ assister_id: assisterId })
        .eq('id', existing.id);
    } else {
      // Insert new event (no stat changes — purely linking)
      const { data } = await supabase
        .from('goal_events')
        .insert([{ match_id: activeMatch.id, scorer_id: scorerId, assister_id: assisterId }])
        .select()
        .single();
      if (data) setGoalEvents(prev => [...prev, data]);
    }
    setLinkingGoal(null);
  };

  const clearAssist = async (scorerId, goalIndex) => {
    const events = goalEvents.filter(e => e.scorer_id === scorerId);
    const existing = events[goalIndex];
    if (!existing) return;
    setGoalEvents(prev => prev.filter(e => e.id !== existing.id));
    await supabase.from('goal_events').delete().eq('id', existing.id);
  };

  const getPlayerName = (id) => {
    if (!id) return null;
    const p = squad.find(s => s.id === id);
    return p ? p.name : 'Unknown';
  };

  return (
    <div className="app-container">
      <TopNav
        title="Match Report"
        onBack={() => {
          setActiveMatchId(null);
          setCurrentView('matches');
        }}
      />

      <div className="view-container">
        {/* Score header */}
        <div className="card" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <div className="badge badge-blue" style={{ display: 'inline-flex', marginBottom: '1rem' }}>
            {activeMatch.competition === 'Tournament'
              ? activeMatch.tournament
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

        {/* Goal / Assist Linking Section */}
        {scorers.length > 0 && (
          <div className="card mt-4">
            <div className="flex-between mb-2">
              <h3 className="title-md" style={{ marginBottom: 0 }}>
                <Link2 size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.4rem', color: 'var(--color-primary)' }} />
                Goal &amp; Assist Links
              </h3>
              {!loadingEvents && (
                <span style={{ fontSize: '0.75rem', color: allLinked ? 'var(--color-primary-dark)' : 'var(--color-text-muted)' }}>
                  {totalLinked}/{totalGoalCount} linked
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
              Retroactively link each goal to an assister. This won't change any totals — it just records who combined on each goal.
            </p>

            {loadingEvents ? (
              <div className="empty-state">Loading...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {scorers.map(scorer => (
                  <div key={scorer.id}>
                    <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-text-main)', marginBottom: '0.5rem' }}>
                      {scorer.name}
                      <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '0.4rem' }}>
                        ({scorer.goals} {scorer.goals === 1 ? 'goal' : 'goals'})
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {goalSlots[scorer.id].map((event, goalIndex) => {
                        const isLinking = linkingGoal?.scorerId === scorer.id && linkingGoal?.goalIndex === goalIndex;
                        const assistName = event?.assister_id ? getPlayerName(event.assister_id) : null;

                        return (
                          <div key={goalIndex}>
                            <div
                              style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                padding: '0.6rem 0.75rem',
                                borderRadius: 'var(--radius-lg)',
                                border: '1px solid',
                                borderColor: event ? 'var(--color-primary)' : 'var(--color-border)',
                                background: event ? 'var(--color-primary-light)' : 'var(--color-bg-body)',
                              }}
                            >
                              <Target size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                              <span style={{ fontSize: '0.85rem', flex: 1 }}>
                                Goal {goalIndex + 1}
                              </span>
                              {assistName ? (
                                <>
                                  <span style={{ fontSize: '0.8rem', color: 'var(--color-primary-dark)', fontWeight: 600 }}>
                                    Assist: {assistName}
                                  </span>
                                  <button
                                    onClick={() => setLinkingGoal({ scorerId: scorer.id, goalIndex })}
                                    className="btn-icon-subtle"
                                    title="Change assister"
                                  >
                                    <ChevronDown size={14} />
                                  </button>
                                  <button
                                    onClick={() => clearAssist(scorer.id, goalIndex)}
                                    className="btn-icon-subtle"
                                    title="Remove link"
                                  >
                                    <X size={14} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => setLinkingGoal({ scorerId: scorer.id, goalIndex })}
                                  className="btn btn-secondary"
                                  style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                                >
                                  + Link Assist
                                </button>
                              )}
                            </div>

                            {/* Inline assister picker */}
                            {isLinking && (
                              <div style={{
                                marginTop: '0.4rem',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-lg)',
                                overflow: 'hidden',
                                background: 'var(--color-bg-card)'
                              }}>
                                <div
                                  onClick={() => { assignAssist(scorer.id, goalIndex, null); }}
                                  style={{
                                    padding: '0.6rem 1rem', cursor: 'pointer', fontWeight: 600,
                                    fontSize: '0.85rem', color: 'var(--color-text-muted)',
                                    borderBottom: '1px solid var(--color-border-light)'
                                  }}
                                >
                                  <X size={12} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
                                  Unassisted
                                </div>
                                {playersInMatch
                                  .filter(p => p.id !== scorer.id)
                                  .map(p => (
                                    <div
                                      key={p.id}
                                      onClick={() => assignAssist(scorer.id, goalIndex, p.id)}
                                      style={{
                                        padding: '0.6rem 1rem', cursor: 'pointer',
                                        fontSize: '0.875rem', fontWeight: 600,
                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                        borderBottom: '1px solid var(--color-border-light)',
                                        background: event?.assister_id === p.id ? 'var(--color-primary-light)' : 'transparent',
                                        color: event?.assister_id === p.id ? 'var(--color-primary-dark)' : 'var(--color-text-main)'
                                      }}
                                    >
                                      {event?.assister_id === p.id && <Check size={12} />}
                                      {p.name}
                                    </div>
                                  ))
                                }
                                <div
                                  onClick={() => setLinkingGoal(null)}
                                  style={{
                                    padding: '0.5rem 1rem', cursor: 'pointer',
                                    fontSize: '0.8rem', textAlign: 'center',
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
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
