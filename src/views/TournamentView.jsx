import { useState, useMemo, useEffect } from 'react';
import { Trophy, Plus, X, Eye, Play, Edit2, Trash2, CheckCircle, Users } from 'lucide-react';
import TopNav from '../components/TopNav';
import { supabase } from '../supabaseClient';
import { parseTournament, encodeTournament, KNOCKOUT_ROUNDS, isTournamentFinished, setTournamentFinishedStatus, saveTournament, getTournamentAvailablePlayers, setTournamentAvailablePlayers } from '../utils/tournamentUtils';
import { getDefaultMatchVariant } from '../utils/variantPreferences';
import { isPlayerDefaultOff } from '../utils/playerPreferences';

export default function TournamentView({
  tournamentName,
  matches,
  setMatches,
  squad,
  _teamInfo,
  session,
  setCurrentView,
  setActiveMatchId,
  setReturnToTournament
}) {
  const [showAddMatchModal, setShowAddMatchModal] = useState(false);
  const [matchToDelete, setMatchToDelete] = useState(null);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [isFinished, setIsFinished] = useState(() => isTournamentFinished(tournamentName));
  const [tournamentAvailableIds, setTournamentAvailableIds] = useState(() => {
    const saved = getTournamentAvailablePlayers(tournamentName);
    return saved && saved.length > 0 ? saved : squad.map((p) => p.id);
  });
  const [showEditSquadModal, setShowEditSquadModal] = useState(false);
  const [editTourneySquadSelection, setEditTourneySquadSelection] = useState([]);

  useEffect(() => {
    setIsFinished(isTournamentFinished(tournamentName));
    if (tournamentName) {
      saveTournament(tournamentName);
      const saved = getTournamentAvailablePlayers(tournamentName);
      if (saved && saved.length > 0) {
        setTournamentAvailableIds(saved);
      } else {
        setTournamentAvailableIds(squad.map((p) => p.id));
      }
    }
  }, [tournamentName, squad]);

  const tournamentAvailableSquad = useMemo(() => {
    const available = squad.filter((p) => tournamentAvailableIds.includes(p.id));
    return available.length > 0 ? available : squad;
  }, [squad, tournamentAvailableIds]);

  // Add Match Form State
  const [stageType, setStageType] = useState('Group Stage'); // 'Group Stage' | 'Knockout Stage'
  const [selectedKnockoutPreset, setSelectedKnockoutPreset] = useState('Quarter-Final');
  const [customRoundName, setCustomRoundName] = useState('');
  const [groupGameNumber, setGroupGameNumber] = useState('Auto'); // 'Auto' or number
  const [opponent, setOpponent] = useState('');
  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [matchVariant, setMatchVariant] = useState(getDefaultMatchVariant);
  const [selectedSquad, setSelectedSquad] = useState(() => {
    const activeTourneySquad = tournamentAvailableSquad.length > 0 ? tournamentAvailableSquad : squad;
    return activeTourneySquad.map((p) => p.id);
  });
  const [hideScore, setHideScore] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openAddMatchModal = (stage = 'Group Stage') => {
    setStageType(stage);
    setMatchVariant(getDefaultMatchVariant());
    setOpponent('');
    setCustomRoundName('');
    const activeTourneySquad = tournamentAvailableSquad.length > 0 ? tournamentAvailableSquad : squad;
    // Once selected for the tournament squad, default off flag does not apply for subsequent tournament matches
    setSelectedSquad(activeTourneySquad.map((p) => p.id));
    setShowAddMatchModal(true);
  };

  // Filter tournament matches
  const tournamentMatches = useMemo(() => {
    return matches
      .filter((m) => {
        if (m.competition !== 'Tournament' || !m.tournament) return false;
        const { name } = parseTournament(m.tournament);
        return name.toLowerCase() === (tournamentName || '').toLowerCase();
      })
      .map((m) => {
        const { stage, round } = parseTournament(m.tournament);
        return {
          ...m,
          tournamentStage: stage,
          tournamentRound: round
        };
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [matches, tournamentName]);

  const groupMatches = useMemo(() => {
    return tournamentMatches.filter((m) => m.tournamentStage !== 'Knockout Stage');
  }, [tournamentMatches]);

  const knockoutMatches = useMemo(() => {
    return tournamentMatches.filter((m) => m.tournamentStage === 'Knockout Stage');
  }, [tournamentMatches]);

  // Campaign summary stats
  const summary = useMemo(() => {
    let played = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;

    tournamentMatches.forEach((m) => {
      played++;
      goalsFor += m.team_goals || 0;
      goalsAgainst += m.opponent_goals || 0;

      if (!m.hide_score) {
        if ((m.team_goals || 0) > (m.opponent_goals || 0)) wins++;
        else if ((m.team_goals || 0) === (m.opponent_goals || 0)) draws++;
        else losses++;
      }
    });

    return {
      played,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      goalDiff: goalsFor - goalsAgainst
    };
  }, [tournamentMatches]);

  // Squad toggle
  const toggleSquadMember = (playerId) => {
    setSelectedSquad((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]
    );
  };

  const handleCreateTournamentMatch = async (e) => {
    e.preventDefault();
    if (!opponent.trim() || selectedSquad.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      // Determine round string
      let roundLabel = '';
      if (stageType === 'Group Stage') {
        const gameIndex = groupGameNumber === 'Auto' ? groupMatches.length + 1 : groupGameNumber;
        roundLabel = `Match ${gameIndex}`;
      } else {
        roundLabel = selectedKnockoutPreset === 'Custom' ? customRoundName.trim() || 'Knockout' : selectedKnockoutPreset;
      }

      const encodedTournament = encodeTournament(tournamentName, stageType, roundLabel);

      const initialStats = {};
      selectedSquad.forEach((pid) => {
        initialStats[pid] = { goals: 0, assists: 0, saves: 0 };
      });

      const dbMatch = {
        user_id: session?.user?.id,
        date: new Date(matchDate).toISOString(),
        opponent: opponent.trim(),
        competition: 'Tournament',
        tournament: encodedTournament,
        match_variant: matchVariant,
        team_goals: 0,
        opponent_goals: 0,
        hide_score: hideScore,
        status: 'active'
      };

      const { data, error } = await supabase.from('matches').insert([dbMatch]).select();
      if (error) throw error;

      if (data && data[0]) {
        const newDbMatch = data[0];

        const statsToInsert = selectedSquad.map((pid) => ({
          match_id: newDbMatch.id,
          player_id: pid,
          goals: 0,
          assists: 0,
          saves: 0
        }));

        const { error: statsErr } = await supabase.from('match_stats').insert(statsToInsert);
        if (statsErr) console.error('Error inserting tournament match stats:', statsErr);

        const matchWithStats = { ...newDbMatch, stats: initialStats };
        setMatches([matchWithStats, ...matches]);

        setShowAddMatchModal(false);
        setOpponent('');
        setCustomRoundName('');
        setMatchVariant(getDefaultMatchVariant());

        // Open newly created match in tracker directly
        setActiveMatchId(newDbMatch.id);
        if (setReturnToTournament) setReturnToTournament(tournamentName);
        setCurrentView('match_tracker');
      }
    } catch (err) {
      console.error('Failed to create tournament match:', err);
      alert(`Error creating tournament match: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openMatch = (matchId, viewType) => {
    setActiveMatchId(matchId);
    if (setReturnToTournament) setReturnToTournament(tournamentName);
    setCurrentView(viewType);
  };

  const resumeMatch = async (matchId, e) => {
    if (e) e.stopPropagation();
    setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, status: 'active' } : m)));
    await supabase.from('matches').update({ status: 'active' }).eq('id', matchId);
    openMatch(matchId, 'match_tracker');
  };

  const confirmDeleteMatch = (match, e) => {
    if (e) e.stopPropagation();
    setMatchToDelete(match);
  };

  const executeDeleteMatch = async () => {
    if (!matchToDelete) return;
    const matchId = matchToDelete.id;

    setMatches((prev) => prev.filter((m) => m.id !== matchId));
    setMatchToDelete(null);

    await supabase.from('goal_events').delete().eq('match_id', matchId);
    await supabase.from('match_stats').delete().eq('match_id', matchId);
    const { error } = await supabase.from('matches').delete().eq('id', matchId);
    if (error) {
      console.error('Match delete error:', error);
      alert(`Failed to delete match: ${error.message}`);
    }
  };

  const executeFinishTournament = async () => {
    setTournamentFinishedStatus(tournamentName, true);
    setIsFinished(true);

    const activeMatchIds = tournamentMatches.filter((m) => m.status !== 'finished').map((m) => m.id);
    if (activeMatchIds.length > 0) {
      setMatches((prev) =>
        prev.map((m) => (activeMatchIds.includes(m.id) ? { ...m, status: 'finished' } : m))
      );
      await supabase.from('matches').update({ status: 'finished' }).in('id', activeMatchIds);
    }
  };

  const handleReopenTournament = () => {
    setTournamentFinishedStatus(tournamentName, false);
    setIsFinished(false);
  };

  return (
    <div className="app-container">
      <TopNav
        title={tournamentName || 'Tournament'}
        onBack={() => {
          if (setReturnToTournament) setReturnToTournament(null);
          setCurrentView('matches');
        }}
      />

      <div className="view-container">
        {/* Tournament Hero Card */}
        <div className="card" style={{ marginBottom: '1.25rem', padding: '1.25rem' }}>
          <div className="flex-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: 'var(--radius-lg)',
                  background: isFinished ? 'var(--color-bg-body)' : 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: isFinished ? 'var(--color-text-muted)' : '#ffffff',
                  border: isFinished ? '1px solid var(--color-border)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: isFinished ? 'none' : '0 4px 10px rgba(217, 119, 6, 0.25)',
                  flexShrink: 0
                }}
              >
                <Trophy size={24} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h2 className="title-md" style={{ marginBottom: '0.2rem', fontSize: '1.25rem' }}>
                    {tournamentName}
                  </h2>
                  {isFinished && (
                    <span className="badge-ft" style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>
                      Tournament Complete
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.8rem', color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
                  <span className="badge badge-amber" style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem' }}>
                    Tournament
                  </span>
                  <span>{tournamentMatches.length} {tournamentMatches.length === 1 ? 'game' : 'games'} played</span>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditTourneySquadSelection(tournamentAvailableIds);
                      setShowEditSquadModal(true);
                    }}
                    style={{
                      background: 'var(--color-bg-body)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-main)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.15rem 0.5rem',
                      borderRadius: 'var(--radius-md)'
                    }}
                    title="Click to view or edit available players for this tournament"
                  >
                    <Users size={12} style={{ color: 'var(--color-primary)' }} />
                    {tournamentAvailableSquad.length} Available {tournamentAvailableSquad.length === 1 ? 'Player' : 'Players'}
                  </button>
                </div>
              </div>
            </div>

            {/* Campaign Actions: Finish or Re-open */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {isFinished ? (
                <button
                  onClick={handleReopenTournament}
                  className="btn btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', width: 'auto' }}
                >
                  <Edit2 size={15} /> Re-open Tournament
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      const stage = groupMatches.length >= 3 && knockoutMatches.length === 0 ? 'Knockout Stage' : 'Group Stage';
                      openAddMatchModal(stage);
                    }}
                    className="btn btn-primary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', width: 'auto' }}
                  >
                    <Plus size={16} /> Add Game
                  </button>
                  {tournamentMatches.length > 0 && (
                    <button
                      onClick={() => setShowFinishConfirm(true)}
                      className="btn btn-secondary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', width: 'auto' }}
                      title="Finish tournament"
                    >
                      <CheckCircle size={15} /> Finish Tournament
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Tournament Record Stats Strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))',
              gap: '0.5rem',
              background: 'var(--color-bg-body)',
              borderRadius: 'var(--radius-lg)',
              padding: '0.75rem 1rem',
              border: '1px solid var(--color-border)'
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Played</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{summary.played}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-primary-dark)', fontWeight: 700, textTransform: 'uppercase' }}>Won</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--color-primary-dark)' }}>{summary.wins}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Drawn</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{summary.draws}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-danger)', fontWeight: 700, textTransform: 'uppercase' }}>Lost</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--color-danger)' }}>{summary.losses}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>GF</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{summary.goalsFor}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>GA</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{summary.goalsAgainst}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>GD</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: summary.goalDiff > 0 ? 'var(--color-primary-dark)' : summary.goalDiff < 0 ? 'var(--color-danger)' : 'inherit' }}>
                {summary.goalDiff > 0 ? `+${summary.goalDiff}` : summary.goalDiff}
              </div>
            </div>
          </div>
        </div>

        {/* Group Stage Section */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="flex-between mb-3">
            <h3 className="title-md" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Group Stage
              <span className="badge badge-blue" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                {groupMatches.length}
              </span>
            </h3>
            {!isFinished && (
              <button
                onClick={() => openAddMatchModal('Group Stage')}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
              >
                + Add Group Game
              </button>
            )}
          </div>

          {groupMatches.length === 0 ? (
            <div className="card empty-state" style={{ padding: '1.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>No group stage matches added yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {groupMatches.map((m) => {
                const isWin = (m.team_goals || 0) > (m.opponent_goals || 0);
                const isLoss = (m.team_goals || 0) < (m.opponent_goals || 0);
                const scoreClass = isWin ? 'score-win' : isLoss ? 'score-loss' : 'score-draw';

                return (
                  <div
                    key={m.id}
                    className="card match-card"
                    style={{ padding: '0.9rem 1rem', cursor: isFinished ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (isFinished) {
                        openMatch(m.id, 'match_report');
                      }
                    }}
                  >
                    <div className="flex-between" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1, minWidth: '160px' }}>
                        <span className="badge badge-blue" style={{ fontSize: '0.7rem', flexShrink: 0 }}>
                          {m.tournamentRound || 'Group'}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            vs {m.opponent}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            {new Date(m.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            {m.match_variant && <span style={{ marginLeft: '0.35rem' }}>• {m.match_variant}</span>}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {!m.hide_score ? (
                          <div className="match-score" style={{ padding: '0.25rem 0.6rem', fontSize: '0.95rem' }}>
                            <span className={scoreClass}>{m.team_goals}</span>
                            <span style={{ color: 'var(--color-text-muted)', margin: '0 0.25rem' }}>-</span>
                            <span className={isLoss ? 'score-win' : isWin ? 'score-loss' : 'score-draw'}>{m.opponent_goals}</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Score Hidden</span>
                        )}

                        {!isFinished && (
                          <button
                            type="button"
                            onClick={(e) => confirmDeleteMatch(m, e)}
                            className="btn-delete-match"
                            title="Delete Match"
                            aria-label="Delete Match"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Action buttons: When finished, only show View Details */}
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.45rem',
                        marginTop: '0.75rem',
                        paddingTop: '0.65rem',
                        borderTop: '1px solid var(--color-border-light)',
                        flexWrap: 'wrap'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isFinished ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openMatch(m.id, 'match_report');
                          }}
                          className="btn btn-secondary"
                          style={{
                            flex: 1,
                            padding: '0.45rem 0.5rem',
                            fontSize: '0.78rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.3rem',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <Eye size={13} /> View Details
                        </button>
                      ) : (
                        <>
                          {m.status === 'finished' ? (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openMatch(m.id, 'match_report');
                                }}
                                className="btn btn-secondary"
                                style={{
                                  flex: 1,
                                  padding: '0.45rem 0.5rem',
                                  fontSize: '0.78rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.3rem',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                <Eye size={13} /> View Details
                              </button>
                              <button
                                type="button"
                                onClick={(e) => resumeMatch(m.id, e)}
                                className="btn btn-secondary"
                                style={{
                                  flex: 1,
                                  padding: '0.45rem 0.5rem',
                                  fontSize: '0.78rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.3rem',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                <Edit2 size={13} /> Re-open Tracker
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openMatch(m.id, 'match_tracker');
                              }}
                              className="btn btn-primary"
                              style={{
                                flex: 1,
                                width: '100%',
                                padding: '0.45rem 0.6rem',
                                fontSize: '0.8rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.3rem',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              <Play size={13} /> Open Tracker
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Knockout Stage Section */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="flex-between mb-3">
            <h3 className="title-md" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Knockout Stage
              <span className="badge badge-amber" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem' }}>
                {knockoutMatches.length}
              </span>
            </h3>
            {!isFinished && (
              <button
                onClick={() => openAddMatchModal('Knockout Stage')}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
              >
                + Add Knockout Game
              </button>
            )}
          </div>

          {knockoutMatches.length === 0 ? (
            <div className="card empty-state" style={{ padding: '1.5rem' }}>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>No knockout matches recorded yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {knockoutMatches.map((m) => {
                const isWin = (m.team_goals || 0) > (m.opponent_goals || 0);
                const isLoss = (m.team_goals || 0) < (m.opponent_goals || 0);
                const scoreClass = isWin ? 'score-win' : isLoss ? 'score-loss' : 'score-draw';

                return (
                  <div
                    key={m.id}
                    className="card match-card"
                    style={{ padding: '0.9rem 1rem', borderLeft: '4px solid #f59e0b', cursor: isFinished ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (isFinished) {
                        openMatch(m.id, 'match_report');
                      }
                    }}
                  >
                    <div className="flex-between" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1, minWidth: '160px' }}>
                        <span className="badge badge-amber" style={{ fontSize: '0.7rem', flexShrink: 0, fontWeight: 700 }}>
                          {m.tournamentRound || 'Knockout'}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            vs {m.opponent}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            {new Date(m.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            {m.match_variant && <span style={{ marginLeft: '0.35rem' }}>• {m.match_variant}</span>}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {!m.hide_score ? (
                          <div className="match-score" style={{ padding: '0.25rem 0.6rem', fontSize: '0.95rem' }}>
                            <span className={scoreClass}>{m.team_goals}</span>
                            <span style={{ color: 'var(--color-text-muted)', margin: '0 0.25rem' }}>-</span>
                            <span className={isLoss ? 'score-win' : isWin ? 'score-loss' : 'score-draw'}>{m.opponent_goals}</span>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Score Hidden</span>
                        )}

                        {!isFinished && (
                          <button
                            type="button"
                            onClick={(e) => confirmDeleteMatch(m, e)}
                            className="btn-delete-match"
                            title="Delete Match"
                            aria-label="Delete Match"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Action buttons: When finished, only show View Details */}
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.45rem',
                        marginTop: '0.75rem',
                        paddingTop: '0.65rem',
                        borderTop: '1px solid var(--color-border-light)',
                        flexWrap: 'wrap'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isFinished ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openMatch(m.id, 'match_report');
                          }}
                          className="btn btn-secondary"
                          style={{
                            flex: 1,
                            padding: '0.45rem 0.5rem',
                            fontSize: '0.78rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.3rem',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          <Eye size={13} /> View Details
                        </button>
                      ) : (
                        <>
                          {m.status === 'finished' ? (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openMatch(m.id, 'match_report');
                                }}
                                className="btn btn-secondary"
                                style={{
                                  flex: 1,
                                  padding: '0.45rem 0.5rem',
                                  fontSize: '0.78rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.3rem',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                <Eye size={13} /> View Details
                              </button>
                              <button
                                type="button"
                                onClick={(e) => resumeMatch(m.id, e)}
                                className="btn btn-secondary"
                                style={{
                                  flex: 1,
                                  padding: '0.45rem 0.5rem',
                                  fontSize: '0.78rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.3rem',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                <Edit2 size={13} /> Re-open Tracker
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openMatch(m.id, 'match_tracker');
                              }}
                              className="btn btn-primary"
                              style={{
                                flex: 1,
                                width: '100%',
                                padding: '0.45rem 0.6rem',
                                fontSize: '0.8rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.3rem',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              <Play size={13} /> Open Tracker
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal: Add Tournament Match */}
      {showAddMatchModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="flex-between mb-3">
              <h3 className="title-md" style={{ margin: 0 }}>Add Tournament Game</h3>
              <button className="btn-icon" onClick={() => setShowAddMatchModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateTournamentMatch}>
              {/* Stage Type Toggle */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <button
                  type="button"
                  className={`btn ${stageType === 'Group Stage' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, fontSize: '0.85rem' }}
                  onClick={() => setStageType('Group Stage')}
                >
                  Group Stage
                </button>
                <button
                  type="button"
                  className={`btn ${stageType === 'Knockout Stage' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, fontSize: '0.85rem' }}
                  onClick={() => setStageType('Knockout Stage')}
                >
                  Knockout Stage
                </button>
              </div>

              {/* Round Selection */}
              {stageType === 'Group Stage' ? (
                <div className="form-group mb-3">
                  <label className="label">Group Game Number / Label</label>
                  <select
                    className="input select"
                    value={groupGameNumber}
                    onChange={(e) => setGroupGameNumber(e.target.value)}
                  >
                    <option value="Auto">Auto (Match {groupMatches.length + 1})</option>
                    <option value="Match 1">Match 1</option>
                    <option value="Match 2">Match 2</option>
                    <option value="Match 3">Match 3</option>
                    <option value="Match 4">Match 4</option>
                    <option value="Match 5">Match 5</option>
                    <option value="Match 6">Match 6</option>
                  </select>
                </div>
              ) : (
                <div className="form-group mb-3">
                  <label className="label">Knockout Round</label>
                  <select
                    className="input select"
                    value={selectedKnockoutPreset}
                    onChange={(e) => setSelectedKnockoutPreset(e.target.value)}
                  >
                    {KNOCKOUT_ROUNDS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                    <option value="Custom">Custom Round Name...</option>
                  </select>

                  {selectedKnockoutPreset === 'Custom' && (
                    <input
                      type="text"
                      className="input mt-2"
                      placeholder="e.g. Plate Semi-Final, Shield Final"
                      value={customRoundName}
                      onChange={(e) => setCustomRoundName(e.target.value)}
                      required
                      autoFocus
                    />
                  )}
                </div>
              )}

              {/* Opponent & Date */}
              <div className="flex-row gap-4 mb-3">
                <div style={{ flex: 1 }}>
                  <label className="label">Opponent</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="Opponent Team"
                    value={opponent}
                    onChange={(e) => setOpponent(e.target.value)}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">Date</label>
                  <input
                    type="date"
                    className="input"
                    value={matchDate}
                    onChange={(e) => setMatchDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Format */}
              <div className="form-group mb-3">
                <label className="label">Match Format</label>
                <select
                  className="input select"
                  value={matchVariant}
                  onChange={(e) => setMatchVariant(e.target.value)}
                >
                  <option>5-a-side</option>
                  <option>6-a-side</option>
                  <option>7-a-side</option>
                  <option>8-a-side</option>
                  <option>9-a-side</option>
                  <option>11-a-side</option>
                </select>
              </div>

              {/* Squad Selection: restricted to tournament available players */}
              <div className="form-group mb-4">
                <div className="flex-between mb-2">
                  <label className="label" style={{ marginBottom: 0 }}>
                    Match Squad ({selectedSquad.length} of {tournamentAvailableSquad.length} selected)
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedSquad(
                        selectedSquad.length === tournamentAvailableSquad.length
                          ? []
                          : tournamentAvailableSquad.map((p) => p.id)
                      )
                    }
                    className="btn-icon-subtle"
                    style={{ fontSize: '0.75rem' }}
                  >
                    {selectedSquad.length === tournamentAvailableSquad.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                <div
                  style={{
                    maxHeight: '140px',
                    overflowY: 'auto',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '0.4rem',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '0.35rem'
                  }}
                >
                  {tournamentAvailableSquad.map((p) => {
                    const isSelected = selectedSquad.includes(p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => toggleSquadMember(p.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.35rem 0.5rem',
                          borderRadius: 'var(--radius-md)',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          background: isSelected ? 'var(--color-primary-light)' : 'transparent',
                          color: isSelected ? 'var(--color-primary-dark)' : 'var(--color-text-main)'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => { }} // handled by parent onClick
                          style={{ pointerEvents: 'none' }}
                        />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {p.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Hide score checkbox */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <input
                  type="checkbox"
                  id="hideScoreCheck"
                  checked={hideScore}
                  onChange={(e) => setHideScore(e.target.checked)}
                />
                <label htmlFor="hideScoreCheck" style={{ fontSize: '0.85rem', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                  Hide Score (Friendly / Youth development)
                </label>
              </div>

              {/* Submit Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddMatchModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmitting || !opponent.trim() || selectedSquad.length === 0}
                >
                  {isSubmitting ? 'Creating...' : 'Create & Track Match'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Finishing Tournament */}
      {showFinishConfirm && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <h3 className="title-md mb-2">Finish Tournament</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              Are you sure you want to finish <strong>{tournamentName}</strong>? This will complete the tournament. You can re-open it at any time.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                onClick={() => setShowFinishConfirm(false)}
                className="btn btn-secondary"
                style={{ width: 'auto' }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowFinishConfirm(false);
                  await executeFinishTournament();
                }}
                className="btn btn-primary"
                style={{ width: 'auto' }}
              >
                Finish Tournament
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Tournament Match Deletion */}
      {matchToDelete && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <h3 className="title-md mb-2">Delete Tournament Match</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Are you sure you want to delete the tournament match vs <strong>{matchToDelete.opponent}</strong>? All recorded stats for this match will be permanently removed.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={() => setMatchToDelete(null)} className="btn btn-secondary" style={{ width: 'auto' }}>
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
      {/* Modal: Edit Tournament Available Squad */}
      {showEditSquadModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <div className="flex-between mb-3">
              <h3 className="title-md" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Users size={18} style={{ color: 'var(--color-primary)' }} />
                Available Tournament Squad
              </h3>
              <button className="btn-icon" onClick={() => setShowEditSquadModal(false)}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.4 }}>
              Select which players are attending <strong>{tournamentName}</strong>. Only these players will be selectable for matches in this tournament.
            </p>

            <div className="flex-between mb-2">
              <label className="label" style={{ marginBottom: 0 }}>
                Selected ({editTourneySquadSelection.length} of {squad.length})
              </label>
              <button
                type="button"
                onClick={() =>
                  setEditTourneySquadSelection(
                    editTourneySquadSelection.length === squad.length ? [] : squad.map((p) => p.id)
                  )
                }
                className="btn-icon-subtle"
                style={{ fontSize: '0.75rem' }}
              >
                {editTourneySquadSelection.length === squad.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div
              style={{
                maxHeight: '220px',
                overflowY: 'auto',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                padding: '0.4rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '0.35rem',
                marginBottom: '1.25rem'
              }}
            >
              {squad.map((p) => {
                const isSelected = editTourneySquadSelection.includes(p.id);
                const isOff = isPlayerDefaultOff(p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      setEditTourneySquadSelection((prev) =>
                        prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                      );
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.35rem 0.5rem',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      background: isSelected ? 'var(--color-primary-light)' : 'transparent',
                      color: isSelected ? 'var(--color-primary-dark)' : 'var(--color-text-main)'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      style={{ pointerEvents: 'none' }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {p.name}
                    </span>
                    {isOff && (
                      <span style={{ fontSize: '0.65rem', opacity: 0.75, color: 'var(--color-text-muted)' }}>Off</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowEditSquadModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={editTourneySquadSelection.length === 0}
                onClick={() => {
                  setTournamentAvailablePlayers(tournamentName, editTourneySquadSelection);
                  setTournamentAvailableIds(editTourneySquadSelection);
                  setShowEditSquadModal(false);
                }}
              >
                Save Tournament Squad
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
