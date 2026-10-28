import { useState, useMemo } from 'react';
import { Plus, Play, Trophy, ListOrdered, Edit2, Trash2, X, Check, ChevronRight, Eye } from 'lucide-react';
import TopNav from '../components/TopNav';
import { supabase } from '../supabaseClient';
import { groupMatchesByTournament, setTournamentFinishedStatus, saveTournament, removeSavedTournament } from '../utils/tournamentUtils';
import { getDefaultMatchVariant } from '../utils/variantPreferences';
import { getDefaultSquadSelection, isPlayerDefaultOff } from '../utils/playerPreferences';

export default function MatchesView({
  matches,
  setMatches,
  squad,
  teamInfo,
  allTeams,
  allClubs = [],
  currentUserProfile,
  onSelectTeam,
  onAddNewTeam,
  setCurrentView,
  setActiveMatchId,
  session,
  onOpenTournament
}) {
  const [activeTab, setActiveTab] = useState('matches'); // 'matches' | 'tournaments'

  // Regular match creation state
  const [showNewMatchCard, setShowNewMatchCard] = useState(false);
  const [newMatchOpponent, setNewMatchOpponent] = useState('');
  const [newMatchCompType, setNewMatchCompType] = useState('League');
  const [newMatchVariant, setNewMatchVariant] = useState(getDefaultMatchVariant);
  const [newMatchDate, setNewMatchDate] = useState(new Date().toISOString().split('T')[0]);
  const [newMatchHideScore, setNewMatchHideScore] = useState(false);
  const [newMatchSquadSelection, setNewMatchSquadSelection] = useState([]);

  // New Tournament creation modal state
  const [showNewTournamentModal, setShowNewTournamentModal] = useState(false);
  const [newTourneyName, setNewTourneyName] = useState('');
  const [newTourneySquadSelection, setNewTourneySquadSelection] = useState([]);

  // Inline opposition editing state for existing matches
  const [editingOpponentMatchId, setEditingOpponentMatchId] = useState(null);
  const [editingOpponentText, setEditingOpponentText] = useState('');
  const [matchToDelete, setMatchToDelete] = useState(null);
  const [tournamentToDelete, setTournamentToDelete] = useState(null);
  const [tournamentsVersion, setTournamentsVersion] = useState(0);

  // Grouped Tournaments
  const tournaments = useMemo(() => {
    return groupMatchesByTournament(matches);
  }, [matches, tournamentsVersion]);

  // Regular (Non-tournament) matches
  const regularMatches = useMemo(() => {
    return matches.filter((m) => m.competition !== 'Tournament');
  }, [matches]);

  // Squad selection default select all active players when card opens
  const handleOpenNewMatch = () => {
    setNewMatchSquadSelection(getDefaultSquadSelection(squad));
    setNewMatchVariant(getDefaultMatchVariant());
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
      team_id: teamInfo?.id || null,
      date: new Date(newMatchDate).toISOString(),
      opponent: newMatchOpponent,
      competition: newMatchCompType,
      tournament: null,
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

  const handleOpenNewTournament = () => {
    setNewTourneyName('');
    setNewTourneySquadSelection(getDefaultSquadSelection(squad));
    setShowNewTournamentModal(true);
  };

  const handleCreateTournament = (e) => {
    e.preventDefault();
    if (!newTourneyName.trim() || newTourneySquadSelection.length === 0) return;
    const name = newTourneyName.trim();
    saveTournament(name, {
      match_variant: getDefaultMatchVariant(),
      available_players: newTourneySquadSelection
    });
    setTournamentsVersion((v) => v + 1);
    setShowNewTournamentModal(false);
    setNewTourneyName('');
    if (onOpenTournament) {
      onOpenTournament(name);
    }
  };

  const executeDeleteTournament = async () => {
    if (!tournamentToDelete) return;
    const tourney = tournamentToDelete;
    setTournamentToDelete(null);

    const matchIds = tourney.matches.map((m) => m.id);
    setMatches((prev) => prev.filter((m) => !matchIds.includes(m.id)));
    setTournamentFinishedStatus(tourney.name, false);
    removeSavedTournament(tourney.name);
    setTournamentsVersion((v) => v + 1);

    for (const mid of matchIds) {
      await supabase.from('goal_events').delete().eq('match_id', mid);
      await supabase.from('match_stats').delete().eq('match_id', mid);
      await supabase.from('matches').delete().eq('id', mid);
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

    setMatches(
      matches.map((m) => (m.id === matchId ? { ...m, opponent: editingOpponentText.trim() } : m))
    );

    setEditingOpponentMatchId(null);

    const { error } = await supabase
      .from('matches')
      .update({ opponent: editingOpponentText.trim() })
      .eq('id', matchId);

    if (error) {
      console.error('Failed to update opponent name:', error);
    }
  };

  const cancelEditOpponent = (e) => {
    if (e) e.stopPropagation();
    setEditingOpponentMatchId(null);
  };

  const confirmDeleteMatch = (match, e) => {
    if (e) e.stopPropagation();
    setMatchToDelete(match);
  };

  const executeDeleteMatch = async () => {
    if (!matchToDelete) return;
    const matchId = matchToDelete.id;

    setMatches(matches.filter((m) => m.id !== matchId));
    setMatchToDelete(null);

    const { error } = await supabase.from('matches').delete().eq('id', matchId);
    if (error) {
      console.error('Match delete error:', error);
      alert(`Failed to delete match: ${error.message}`);
    }
  };

  const cancelDeleteMatch = () => {
    setMatchToDelete(null);
  };


  const resumeMatch = async (matchId, e) => {
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
        title="Matchday View"
        showTabs={true}
        currentView="matches"
        setCurrentView={setCurrentView}
        teamInfo={teamInfo}
        allTeams={allTeams}
        allClubs={allClubs}
        currentUserProfile={currentUserProfile}
        onSelectTeam={onSelectTeam}
        onAddNewTeam={onAddNewTeam}
      />

      <div className="view-container">
        {/* Segmented Top Toggle: Regular Matches vs Tournaments */}
        <div className="matches-tab-bar">
          <button
            className={`btn-matches-tab ${activeTab === 'matches' ? 'active' : ''}`}
            onClick={() => setActiveTab('matches')}
          >
            <ListOrdered size={16} /> Regular Matches ({regularMatches.length})
          </button>
          <button
            className={`btn-matches-tab ${activeTab === 'tournaments' ? 'active' : ''}`}
            onClick={() => setActiveTab('tournaments')}
          >
            <Trophy size={16} /> Tournaments ({tournaments.length})
          </button>
        </div>

        {activeTab === 'matches' ? (
          <>
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
              <div className="card mb-4">
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
                      <label className="label">Competition</label>
                      <select
                        className="input select"
                        value={newMatchCompType}
                        onChange={(e) => setNewMatchCompType(e.target.value)}
                      >
                        <option>League</option>
                        <option>Friendly</option>
                        <option>Cup</option>
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

                  {/* Hide Score Toggle */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      marginBottom: '1.5rem',
                      padding: '0.75rem',
                      backgroundColor: 'var(--color-bg-body)',
                      borderRadius: 'var(--radius-lg)',
                      border: '1px solid var(--color-border)'
                    }}
                  >
                    <input
                      type="checkbox"
                      id="hideScoreToggle"
                      checked={newMatchHideScore}
                      onChange={(e) => setNewMatchHideScore(e.target.checked)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <label htmlFor="hideScoreToggle" style={{ fontSize: '0.875rem', cursor: 'pointer', margin: 0, fontWeight: 500 }}>
                      Hide Score (Youth / Non-competitive match)
                    </label>
                  </div>

                  {/* Squad Selection */}
                  <div className="mb-4">
                    <div className="flex-between mb-2">
                      <label className="label" style={{ marginBottom: 0 }}>
                        Select Match Squad ({newMatchSquadSelection.length} selected)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setNewMatchSquadSelection(
                            newMatchSquadSelection.length === squad.length ? [] : squad.map((p) => p.id)
                          )
                        }
                        className="btn-icon-subtle"
                        style={{ fontSize: '0.8rem' }}
                      >
                        {newMatchSquadSelection.length === squad.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>

                    <div
                      style={{
                        maxHeight: '180px',
                        overflowY: 'auto',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-lg)',
                        padding: '0.5rem',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: '0.5rem'
                      }}
                    >
                      {squad.map((player) => {
                        const isSelected = newMatchSquadSelection.includes(player.id);
                        const isOff = isPlayerDefaultOff(player.id);
                        return (
                          <div
                            key={player.id}
                            onClick={() => toggleSquadSelection(player.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              padding: '0.5rem',
                              borderRadius: 'var(--radius-md)',
                              backgroundColor: isSelected ? 'var(--color-primary-light)' : 'transparent',
                              color: isSelected ? 'var(--color-primary-dark)' : 'var(--color-text-main)',
                              cursor: 'pointer',
                              fontWeight: isSelected ? 600 : 400,
                              fontSize: '0.875rem'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              style={{ pointerEvents: 'none' }}
                            />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {player.name}
                            </span>
                            {isOff && (
                              <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Off</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!newMatchOpponent || newMatchSquadSelection.length === 0}
                  >
                    Start Tracking
                  </button>
                </form>
              </div>
            )}

            {regularMatches.length === 0 && !showNewMatchCard && (
              <div className="empty-state">
                No matches recorded yet. Click "New Match" to get started!
              </div>
            )}

            <div className="flex-col gap-3">
              {regularMatches.map((match) => {
                const date = new Date(match.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                const isFinished = match.status === 'finished';
                const isEditingThisOpponent = editingOpponentMatchId === match.id;

                const isWin = match.team_goals > match.opponent_goals;
                const isLoss = match.team_goals < match.opponent_goals;
                const resultClass = isWin ? 'score-win' : isLoss ? 'score-loss' : 'score-draw';

                return (
                  <div
                    key={match.id}
                    className="card match-card"
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span className="match-date">{date}</span>
                        {isFinished && (
                          <span className="badge-ft">Full Time</span>
                        )}
                        <span className="badge-variant">{match.match_variant || '5-a-side'}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <div className="badge badge-blue">
                          <ListOrdered size={12} />
                          {match.competition || 'Friendly'}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => confirmDeleteMatch(match, e)}
                          className="btn-delete-match"
                          title="Delete Match"
                          aria-label="Delete Match"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    <div className="flex-between mt-4">
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
                            <Edit2 size={12} />
                          </button>
                        </div>
                      )}

                      {!match.hide_score ? (
                        <div className="match-score">
                          <span className={resultClass}>{match.team_goals}</span>
                          <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                          <span className={isLoss ? 'score-win' : isWin ? 'score-loss' : 'score-draw'}>{match.opponent_goals}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>Score Hidden</span>
                      )}
                    </div>

                    {/* Action buttons: View Details & Re-open Tracker for finished matches, Open Tracker for active matches */}
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.5rem',
                        marginTop: '1rem',
                        paddingTop: '0.75rem',
                        borderTop: '1px solid var(--color-border-light)'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isFinished ? (
                        <>
                          <button
                            type="button"
                            onClick={(e) => viewMatchDetails(match.id, e)}
                            className="btn btn-secondary"
                            style={{
                              flex: 1,
                              minWidth: '100px',
                              padding: '0.5rem 0.6rem',
                              fontSize: '0.8rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.35rem',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <Eye size={14} /> View Details
                          </button>
                          <button
                            type="button"
                            onClick={(e) => resumeMatch(match.id, e)}
                            className="btn btn-secondary"
                            style={{
                              flex: 1,
                              minWidth: '110px',
                              padding: '0.5rem 0.6rem',
                              fontSize: '0.8rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.35rem',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <Edit2 size={14} /> Re-open Tracker
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMatchId(match.id);
                            setCurrentView('match_tracker');
                          }}
                          className="btn btn-primary"
                          style={{
                            flex: 1,
                            width: '100%',
                            padding: '0.5rem 0.6rem',
                            fontSize: '0.825rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.35rem',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <Play size={14} /> Open Tracker
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* Tournaments View Tab */
          <>
            <div className="flex-between mb-4">
              <h2 className="title-md" style={{ marginBottom: 0 }}>
                Tournaments
              </h2>
              <button
                onClick={handleOpenNewTournament}
                className="btn btn-primary"
                style={{ width: 'auto', padding: '0.5rem 1rem', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Plus size={16} /> New Tournament
              </button>
            </div>

            {tournaments.length === 0 ? (
              <div className="card empty-state" style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
                <Trophy size={36} style={{ color: 'var(--color-text-light)', margin: '0 auto 0.75rem' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.35rem' }}>No Tournaments Yet</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem', maxWidth: '380px', margin: '0 auto 1.25rem' }}>
                  Create a tournament to track group and knockout stage games together with dedicated tournament records.
                </p>
                <button
                  onClick={handleOpenNewTournament}
                  className="btn btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <Plus size={16} /> Create First Tournament
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {tournaments.map((t) => (
                  <div
                    key={t.name}
                    className="card match-card"
                    onClick={() => onOpenTournament && onOpenTournament(t.name)}
                    style={{ cursor: 'pointer', padding: '1.15rem 1.25rem' }}
                  >
                    <div className="flex-between" style={{ alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div
                          style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: 'var(--radius-md)',
                            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}
                        >
                          <Trophy size={20} />
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--color-text-main)' }}>
                              {t.name}
                            </span>
                            {t.isFinished && (
                              <span className="badge-ft" style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem' }}>
                                Finished
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            {new Date(t.latestDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            <span style={{ margin: '0 0.35rem' }}>•</span>
                            <span className="badge-variant" style={{ fontSize: '0.7rem', padding: '0.1rem 0.35rem' }}>{t.match_variant}</span>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setTournamentToDelete(t);
                          }}
                          className="btn-icon-subtle"
                          style={{ color: 'var(--color-danger)', padding: '0.25rem' }}
                          title="Delete tournament and matches"
                        >
                          <Trash2 size={16} />
                        </button>
                        <ChevronRight size={18} style={{ color: 'var(--color-text-light)' }} />
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'var(--color-bg-body)',
                        borderRadius: 'var(--radius-md)',
                        padding: '0.5rem 0.75rem',
                        fontSize: '0.8rem',
                        border: '1px solid var(--color-border-light)'
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>
                        {t.summary.played} {t.summary.played === 1 ? 'game' : 'games'}
                      </span>
                      <span style={{ color: 'var(--color-text-muted)' }}>
                        <strong style={{ color: 'var(--color-primary-dark)' }}>{t.summary.wins}W</strong>{' '}
                        <strong>{t.summary.draws}D</strong>{' '}
                        <strong style={{ color: 'var(--color-danger)' }}>{t.summary.losses}L</strong>
                      </span>
                      <span style={{ color: t.summary.goalDiff > 0 ? 'var(--color-primary-dark)' : t.summary.goalDiff < 0 ? 'var(--color-danger)' : 'var(--color-text-muted)', fontWeight: 700 }}>
                        GD {t.summary.goalDiff > 0 ? `+${t.summary.goalDiff}` : t.summary.goalDiff}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal: New Tournament */}
      {showNewTournamentModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <div className="flex-between mb-4">
              <h3 className="title-md" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Trophy size={18} style={{ color: '#d97706' }} />
                New Tournament Campaign
              </h3>
              <button className="btn-icon" onClick={() => setShowNewTournamentModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateTournament}>
              <div className="form-group mb-3">
                <label className="label">Tournament Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Summer Cup 2024, Autumn Trophy"
                  value={newTourneyName}
                  onChange={(e) => setNewTourneyName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {/* Tournament Available Players Section */}
              <div className="form-group mb-4">
                <div className="flex-between mb-2">
                  <label className="label" style={{ marginBottom: 0 }}>
                    Available Tournament Squad ({newTourneySquadSelection.length} selected)
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setNewTourneySquadSelection(
                        newTourneySquadSelection.length === squad.length ? [] : squad.map((p) => p.id)
                      )
                    }
                    className="btn-icon-subtle"
                    style={{ fontSize: '0.78rem' }}
                  >
                    {newTourneySquadSelection.length === squad.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                  Only selected players will be available for matches in this tournament.
                </p>
                <div
                  style={{
                    maxHeight: '160px',
                    overflowY: 'auto',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '0.4rem',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '0.35rem'
                  }}
                >
                  {squad.map((player) => {
                    const isSelected = newTourneySquadSelection.includes(player.id);
                    const isOff = isPlayerDefaultOff(player.id);
                    return (
                      <div
                        key={player.id}
                        onClick={() => {
                          setNewTourneySquadSelection((prev) =>
                            prev.includes(player.id) ? prev.filter((id) => id !== player.id) : [...prev, player.id]
                          );
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.35rem 0.5rem',
                          borderRadius: 'var(--radius-md)',
                          backgroundColor: isSelected ? 'var(--color-primary-light)' : 'transparent',
                          color: isSelected ? 'var(--color-primary-dark)' : 'var(--color-text-main)',
                          cursor: 'pointer',
                          fontWeight: isSelected ? 600 : 400,
                          fontSize: '0.8rem'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          style={{ pointerEvents: 'none' }}
                        />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {player.name}
                        </span>
                        {isOff && (
                          <span style={{ fontSize: '0.65rem', opacity: 0.75, color: 'var(--color-text-muted)' }}>Off</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowNewTournamentModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!newTourneyName.trim() || newTourneySquadSelection.length === 0}
                >
                  Open Tournament
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Tournament Deletion */}
      {tournamentToDelete && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <h3 className="title-md mb-2">Delete Tournament</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              Are you sure you want to delete <strong>{tournamentToDelete.name}</strong>{tournamentToDelete.matches.length > 0 ? ` and all of its ${tournamentToDelete.matches.length} ${tournamentToDelete.matches.length === 1 ? 'match' : 'matches'}` : ''}? All recorded stats for this tournament will be permanently removed.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                onClick={() => setTournamentToDelete(null)}
                className="btn btn-secondary"
                style={{ width: 'auto' }}
              >
                Cancel
              </button>
              <button
                onClick={executeDeleteTournament}
                className="btn"
                style={{ width: 'auto', backgroundColor: 'var(--color-danger)', color: '#fff' }}
              >
                Delete Tournament
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Match Deletion */}
      {matchToDelete && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <h3 className="title-md mb-2">Delete Match</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Are you sure you want to delete the match vs <strong>{matchToDelete.opponent}</strong>? All recorded stats for this match will be permanently removed.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={cancelDeleteMatch} className="btn btn-secondary" style={{ width: 'auto' }}>
                Cancel
              </button>
              <button
                onClick={executeDeleteMatch}
                className="btn"
                style={{ width: 'auto', backgroundColor: 'var(--color-danger)', color: '#fff' }}
              >
                Delete Match
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
