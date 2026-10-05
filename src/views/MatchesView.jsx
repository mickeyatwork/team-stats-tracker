import { useState } from 'react';
import { Plus, Play, Trophy, ListOrdered, EyeOff, Edit2, Trash2, X, Check, Eye } from 'lucide-react';
import TopNav from '../components/TopNav';
import { supabase } from '../supabaseClient';

export default function MatchesView({
  matches,
  setMatches,
  squad,
  teamInfo,
  allTeams,
  onSelectTeam,
  onAddNewTeam,
  setCurrentView,
  setActiveMatchId,
  session
}) {
  const [showNewMatchCard, setShowNewMatchCard] = useState(false);
  const [newMatchOpponent, setNewMatchOpponent] = useState('');
  const [newMatchCompType, setNewMatchCompType] = useState('Friendly');
  const [newMatchVariant, setNewMatchVariant] = useState('5-a-side');
  const [newMatchTournamentName, setNewMatchTournamentName] = useState('');
  const [newMatchDate, setNewMatchDate] = useState(new Date().toISOString().split('T')[0]);
  const [newMatchHideScore, setNewMatchHideScore] = useState(false);
  const [newMatchSquadSelection, setNewMatchSquadSelection] = useState([]);

  // Inline opposition editing state for existing matches
  const [editingOpponentMatchId, setEditingOpponentMatchId] = useState(null);
  const [editingOpponentText, setEditingOpponentText] = useState('');
  const [matchToDelete, setMatchToDelete] = useState(null);

  // Squad selection default select all when card opens
  const handleOpenNewMatch = () => {
    setNewMatchSquadSelection(squad.map((p) => p.id));
    setShowNewMatchCard(true);
  };

  const toggleSquadSelection = (playerId) => {
    setNewMatchSquadSelection((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]
    );
  };

  const createMatch = async (e) => {
    e.preventDefault();
    if (!newMatchOpponent || newMatchSquadSelection.length === 0) return;

    const initialStats = {};
    newMatchSquadSelection.forEach((pid) => {
      initialStats[pid] = { goals: 0, assists: 0, saves: 0 };
    });

    const dbMatch = {
      user_id: session.user.id,
      date: new Date(newMatchDate).toISOString(),
      opponent: newMatchOpponent,
      competition: newMatchCompType,
      tournament: newMatchCompType === 'Tournament' ? newMatchTournamentName : null,
      match_variant: newMatchVariant,
      team_goals: 0,
      opponent_goals: 0,
      hide_score: newMatchHideScore,
      status: 'active'
    };

    const { data, error } = await supabase.from('matches').insert([dbMatch]).select();

    if (error) {
      console.error('Match insert error:', error);
      alert(`Failed to save match: ${error.message}`);
      return;
    }

    if (data && data[0]) {
      const newDbMatch = data[0];

      const statsToInsert = newMatchSquadSelection.map((pid) => ({
        match_id: newDbMatch.id,
        player_id: pid,
        goals: 0,
        assists: 0,
        saves: 0
      }));

      const { error: statsErr } = await supabase.from('match_stats').insert(statsToInsert);
      if (statsErr) {
        console.error('Error inserting match stats:', statsErr);
      }

      const matchWithStats = { ...newDbMatch, stats: initialStats };
      setMatches([matchWithStats, ...matches]);

      setShowNewMatchCard(false);
      setNewMatchOpponent('');
      setNewMatchHideScore(false);
      setNewMatchDate(new Date().toISOString().split('T')[0]);

      setActiveMatchId(newDbMatch.id);
      setCurrentView('match_tracker');
    }
  };

  const startEditOpponent = (match, e) => {
    if (e) e.stopPropagation();
    setEditingOpponentMatchId(match.id);
    setEditingOpponentText(match.opponent);
  };

  const saveEditedOpponent = async (matchId, e) => {
    if (e) e.stopPropagation();
    if (!editingOpponentText.trim()) return;

    const updatedOpponent = editingOpponentText.trim();
    setMatches(matches.map((m) => (m.id === matchId ? { ...m, opponent: updatedOpponent } : m)));
    setEditingOpponentMatchId(null);

    await supabase.from('matches').update({ opponent: updatedOpponent }).eq('id', matchId);
  };

  const cancelEditOpponent = (e) => {
    if (e) e.stopPropagation();
    setEditingOpponentMatchId(null);
    setEditingOpponentText('');
  };

  const deleteMatch = async (matchId) => {
    setMatches(matches.filter((m) => m.id !== matchId));
    setMatchToDelete(null);
    await supabase.from('match_stats').delete().eq('match_id', matchId);
    await supabase.from('matches').delete().eq('id', matchId);
  };

  const reopenMatch = async (matchId, e) => {
    if (e) e.stopPropagation();
    setMatches(matches.map((m) => (m.id === matchId ? { ...m, status: 'active' } : m)));
    await supabase.from('matches').update({ status: 'active' }).eq('id', matchId);
    setActiveMatchId(matchId);
    setCurrentView('match_tracker');
  };

  const viewMatchDetails = (matchId, e) => {
    if (e) e.stopPropagation();
    setActiveMatchId(matchId);
    setCurrentView('match_report');
  };

  return (
    <div className="app-container">
      <TopNav
        title={teamInfo.name}
        rightIcon={
          <span className="badge badge-primary">{teamInfo.season}</span>
        }
        showTabs={true}
        currentView="matches"
        setCurrentView={setCurrentView}
        teamInfo={teamInfo}
        allTeams={allTeams}
        onSelectTeam={onSelectTeam}
        onAddNewTeam={onAddNewTeam}
      />

      <div className="view-container">
        <div className="flex-between mb-4">
          <h2 className="title-md" style={{ marginBottom: 0 }}>
            Matches
          </h2>
          {!showNewMatchCard && (
            <button
              onClick={handleOpenNewMatch}
              className="btn btn-primary"
              style={{ width: 'auto', padding: '0.5rem 1rem', borderRadius: 'var(--radius-lg)' }}
            >
              <Plus size={16} /> New Match
            </button>
          )}
        </div>

        {showNewMatchCard && (
          <div className="card">
            <div className="flex-between mb-4">
              <h3 className="title-md" style={{ marginBottom: 0 }}>
                Create Match
              </h3>
              <button onClick={() => setShowNewMatchCard(false)} className="btn-icon">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={createMatch}>
              <div className="flex-row gap-4 mb-4">
                <div style={{ flex: 1 }}>
                  <label className="label">Opponent</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Opponent Team"
                    value={newMatchOpponent}
                    onChange={(e) => setNewMatchOpponent(e.target.value)}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">Date</label>
                  <input
                    type="date"
                    className="input"
                    value={newMatchDate}
                    onChange={(e) => setNewMatchDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="flex-row gap-4 mb-4">
                <div style={{ flex: 1 }}>
                  <label className="label">Type</label>
                  <select
                    className="input select"
                    value={newMatchCompType}
                    onChange={(e) => setNewMatchCompType(e.target.value)}
                  >
                    <option>Friendly</option>
                    <option>League</option>
                    <option>Cup</option>
                    <option>Tournament</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">Format</label>
                  <select
                    className="input select"
                    value={newMatchVariant}
                    onChange={(e) => setNewMatchVariant(e.target.value)}
                  >
                    <option>5-a-side</option>
                    <option>7-a-side</option>
                    <option>9-a-side</option>
                    <option>11-a-side</option>
                  </select>
                </div>
              </div>

              {newMatchCompType === 'Tournament' && (
                <div className="input-group">
                  <label className="label">Tournament Name</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Summer Cup 2024"
                    value={newMatchTournamentName}
                    onChange={(e) => setNewMatchTournamentName(e.target.value)}
                    required
                  />
                </div>
              )}

              {/* Hide Score Toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justify: 'space-between',
                  padding: '0.75rem 1rem',
                  background: 'var(--color-border-light)',
                  borderRadius: 'var(--radius-lg)',
                  marginBottom: '1rem'
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Hide Score</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Useful for younger age groups
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setNewMatchHideScore((v) => !v)}
                  style={{
                    width: '3rem',
                    height: '1.75rem',
                    borderRadius: '999px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                    background: newMatchHideScore ? 'var(--color-primary)' : 'var(--color-border)',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '0.2rem',
                      left: newMatchHideScore ? 'calc(100% - 1.35rem)' : '0.2rem',
                      width: '1.35rem',
                      height: '1.35rem',
                      background: 'white',
                      borderRadius: '50%',
                      transition: 'left 0.2s',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                  />
                </button>
              </div>

              {/* Matchday Squad Selection */}
              <div className="input-group">
                <label className="label">Matchday Squad ({newMatchSquadSelection.length} selected)</label>
                <div style={{ 
                  border: '1px solid var(--color-border)', 
                  borderRadius: 'var(--radius-lg)', 
                  overflowY: 'auto',
                  maxHeight: '300px'
                }}>
                  {squad.map((player) => {
                    const selected = newMatchSquadSelection.includes(player.id);
                    return (
                      <div
                        key={player.id}
                        onClick={() => toggleSquadSelection(player.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justify: 'space-between',
                          padding: '0.75rem 1rem',
                          cursor: 'pointer',
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
                              width: '2rem',
                              height: '2rem',
                              fontSize: '0.875rem'
                            }}
                          >
                            {player.name.charAt(0).toUpperCase()}
                          </div>
                          <span
                            style={{
                              fontWeight: 600,
                              fontSize: '0.875rem',
                              color: selected ? 'var(--color-primary-dark)' : 'var(--color-text-main)'
                            }}
                          >
                            {player.name}
                          </span>
                        </div>
                        {!teamInfo.hide_positions && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{player.position}</span>
                        )}
                      </div>
                    );
                  })}
                  {squad.length === 0 && <div className="empty-state">Add players to your squad first.</div>}
                </div>
              </div>

              <button type="submit" className="btn btn-primary" disabled={newMatchSquadSelection.length === 0}>
                <Play size={18} /> Start Match Tracker
              </button>
              {newMatchSquadSelection.length === 0 && (
                <p style={{ fontSize: '0.75rem', color: 'var(--color-danger)', marginTop: '0.5rem', textAlign: 'center' }}>
                  Select at least one player.
                </p>
              )}
            </form>
          </div>
        )}

        {matches.map((match) => {
          const date = new Date(match.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          const isFinished = match.status === 'finished';
          const isEditingThisOpponent = editingOpponentMatchId === match.id;

          return (
            <div
              key={match.id}
              className="card"
              style={{ cursor: isFinished ? 'default' : 'pointer' }}
              onClick={
                !isFinished && !isEditingThisOpponent
                  ? () => {
                      setActiveMatchId(match.id);
                      setCurrentView('match_tracker');
                    }
                  : undefined
              }
            >
              <div className="match-item-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="match-date">{date}</span>
                  {isFinished && (
                    <span className="badge-ft">Full Time</span>
                  )}
                </div>
                <div className="badge badge-blue">
                  {match.competition === 'Tournament' ? <Trophy size={12} /> : <ListOrdered size={12} />}
                  {match.competition === 'Tournament' ? match.tournament : match.competition || 'Friendly'}
                </div>
              </div>

              <div className="flex-between mt-4">
                {/* Editable Opposition Name */}
                {isEditingThisOpponent ? (
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span style={{ fontWeight: 600 }}>vs</span>
                    <input
                      type="text"
                      className="input"
                      value={editingOpponentText}
                      onChange={(e) => setEditingOpponentText(e.target.value)}
                      style={{ padding: '0.35rem 0.5rem', fontSize: '0.95rem', flex: 1 }}
                      autoFocus
                    />
                    <button
                      onClick={(e) => saveEditedOpponent(match.id, e)}
                      className="btn-icon"
                      style={{ color: 'var(--color-primary)' }}
                      title="Save Opposition Name"
                    >
                      <Check size={18} />
                    </button>
                    <button
                      onClick={cancelEditOpponent}
                      className="btn-icon"
                      style={{ color: 'var(--color-danger)' }}
                      title="Cancel"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div className="item-title" style={{ fontSize: '1.125rem' }}>
                      vs {match.opponent}
                    </div>
                    <button
                      onClick={(e) => startEditOpponent(match, e)}
                      className="btn-icon-subtle"
                      title="Edit Opposition Name"
                    >
                      <Edit2 size={14} />
                    </button>
                  </div>
                )}

                {!isEditingThisOpponent && (
                  match.hide_score ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      <EyeOff size={14} /> Score hidden
                    </div>
                  ) : (
                    <div className="match-score">
                      <span className={match.team_goals > match.opponent_goals ? 'score-win' : match.team_goals < match.opponent_goals ? 'score-loss' : 'score-draw'}>
                        {match.team_goals}
                      </span>
                      <span style={{ color: 'var(--color-border)', fontSize: '1rem', fontWeight: 400 }}>-</span>
                      <span className={match.opponent_goals > match.team_goals ? 'score-win' : match.opponent_goals < match.team_goals ? 'score-loss' : 'score-draw'}>
                        {match.opponent_goals}
                      </span>
                    </div>
                  )
                )}
              </div>

              {/* Actions for matches */}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border-light)' }}>
                {isFinished ? (
                  <>
                    <button
                      onClick={(e) => viewMatchDetails(match.id, e)}
                      className="btn btn-secondary"
                      style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem', color: 'var(--color-primary)' }}
                    >
                      <Eye size={14} /> View Details
                    </button>
                    <button
                      onClick={(e) => reopenMatch(match.id, e)}
                      className="btn btn-secondary"
                      style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem' }}
                    >
                      <Edit2 size={14} /> Re-open Tracker
                    </button>
                  </>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMatchId(match.id);
                      setCurrentView('match_tracker');
                    }}
                    className="btn btn-primary"
                    style={{ flex: 2, padding: '0.5rem', fontSize: '0.8rem' }}
                  >
                    <Play size={14} /> Open Tracker
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMatchToDelete(match.id);
                  }}
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem', color: 'var(--color-danger)' }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          );
        })}
        {matches.length === 0 && !showNewMatchCard && (
          <div className="empty-state card">No matches recorded yet. Create one above to start tracking!</div>
        )}

        {/* Delete Confirmation Modal */}
        {matchToDelete && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
          }}>
            <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
              <div className="flex-between mb-4">
                <h3 className="title-md" style={{ marginBottom: 0, color: 'var(--color-danger)' }}>Delete Match?</h3>
                <button onClick={() => setMatchToDelete(null)} className="btn-icon">
                  <X size={20} />
                </button>
              </div>
              <p style={{ fontSize: '0.9rem', color: 'var(--color-text-main)', marginBottom: '1.5rem' }}>
                Are you sure you want to delete this match? This action cannot be undone and all associated stats will be permanently lost.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={() => deleteMatch(matchToDelete)} className="btn btn-primary" style={{ flex: 1, background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}>
                  Yes, Delete
                </button>
                <button onClick={() => setMatchToDelete(null)} className="btn btn-secondary" style={{ flex: 1 }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
