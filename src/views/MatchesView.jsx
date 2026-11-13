import { useState, useMemo } from 'react';
import { Plus, Play, Trophy, ListOrdered, Edit2, Trash2, X, Check, ChevronRight, Eye, Calendar, Upload, Link2, RefreshCw } from 'lucide-react';
import TopNav from '../components/TopNav';
import FixtureImportModal from '../components/FixtureImportModal';
import ConfirmDialog from '../components/ConfirmDialog';
import DatePicker from '../components/DatePicker';
import { supabase } from '../supabaseClient';
import { groupMatchesByTournament, setTournamentFinishedStatus, saveTournament, removeSavedTournament } from '../utils/tournamentUtils';
import { getDefaultMatchVariant } from '../utils/variantPreferences';
import { getDefaultSquadSelection, isPlayerDefaultOff } from '../utils/playerPreferences';
import { queueOfflineMatchSnapshot, isOfflineId, markServerUnreachable } from '../utils/offlineSync';
import { getFixtureCountdownBadge, findMatchingTrackedMatch } from '../utils/fixtureUtils';
import { computeSeasonTimeframeFromMatches } from '../utils/seasonUtils';

export default function MatchesView({
  matches,
  setMatches,
  squad,
  teamInfo,
  setTeamInfo,
  allTeams,
  setAllTeams,
  allClubs = [],
  currentUserProfile,
  onSelectTeam,
  onAddNewTeam,
  setCurrentView,
  setActiveMatchId,
  session,
  onOpenTournament
}) {
  const [activeTab, setActiveTab] = useState('matches'); // 'matches' | 'fixtures' | 'tournaments'

  // Regular match creation state
  const [showNewMatchCard, setShowNewMatchCard] = useState(false);
  const [newMatchOpponent, setNewMatchOpponent] = useState('');
  const [newMatchCompType, setNewMatchCompType] = useState('League');
  const [newMatchVariant, setNewMatchVariant] = useState(getDefaultMatchVariant);
  const [newMatchDate, setNewMatchDate] = useState(new Date().toISOString().split('T')[0]);
  const [newMatchHideScore, setNewMatchHideScore] = useState(false);
  const [newMatchSquadSelection, setNewMatchSquadSelection] = useState([]);
  const [linkedFixtureId, setLinkedFixtureId] = useState(null);

  // Fixture modal & dialog state
  const [showFixtureImportModal, setShowFixtureImportModal] = useState(false);
  const [fixtureImportMode, setFixtureImportMode] = useState('bulk');
  const [editingFixture, setEditingFixture] = useState(null);
  const [syncingTimeframe, setSyncingTimeframe] = useState(false);
  const [dialogConfig, setDialogConfig] = useState(null);

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
    return groupMatchesByTournament(matches, teamInfo?.id);
  }, [matches, tournamentsVersion, teamInfo?.id]);

  // Regular (Non-tournament, non-scheduled) matches
  const regularMatches = useMemo(() => {
    return matches.filter((m) => m.competition !== 'Tournament' && m.status !== 'scheduled');
  }, [matches]);

  // Scheduled upcoming fixtures sorted chronologically
  const scheduledFixtures = useMemo(() => {
    return matches
      .filter((m) => m.status === 'scheduled')
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  }, [matches]);

  // Completed regular matches for Previous Results section
  const completedResults = useMemo(() => {
    return matches
      .filter((m) => m.status === 'finished' && m.competition !== 'Tournament')
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [matches]);

  // Squad selection default select all active players when card opens
  const handleOpenNewMatch = () => {
    setLinkedFixtureId(null);
    setNewMatchSquadSelection(getDefaultSquadSelection(squad));
    setNewMatchVariant(getDefaultMatchVariant());
    setShowNewMatchCard(true);
  };

  const handleSelectFixtureForNewMatch = (fixtureId) => {
    if (!fixtureId) {
      setLinkedFixtureId(null);
      return;
    }
    const fixture = scheduledFixtures.find((f) => String(f.id) === String(fixtureId));
    if (!fixture) return;
    setLinkedFixtureId(fixture.id);
    setNewMatchOpponent(fixture.opponent || '');
    if (fixture.date) {
      const d = new Date(fixture.date);
      if (!Number.isNaN(d.getTime())) {
        setNewMatchDate(d.toISOString().split('T')[0]);
      }
    }
    setNewMatchCompType(fixture.competition || 'League');
    setNewMatchVariant(fixture.match_variant || getDefaultMatchVariant());
    setNewMatchHideScore(Boolean(fixture.hide_score));
  };

  const handleStartTrackingFixture = (fixture) => {
    setNewMatchSquadSelection(getDefaultSquadSelection(squad));
    handleSelectFixtureForNewMatch(fixture.id);
    setActiveTab('matches');
    setShowNewMatchCard(true);
  };

  const handleSyncSeasonTimeframe = async (timeframeOverride = null) => {
    if (!teamInfo?.id) return;
    const nextTimeframe = timeframeOverride || computeSeasonTimeframeFromMatches(matches);
    if (!nextTimeframe) {
      setDialogConfig({
        isOpen: true,
        type: 'info',
        isAlert: true,
        title: 'No Dated Matches Found',
        message: 'Add or import at least one dated fixture or match before syncing the season timeframe.',
        confirmText: 'OK',
        onConfirm: () => setDialogConfig(null),
        onCancel: () => setDialogConfig(null)
      });
      return;
    }

    setSyncingTimeframe(true);
    try {
      const nextSettings = { ...teamInfo.settings, timeframe: nextTimeframe };
      try {
        localStorage.setItem(`team_timeframe_${teamInfo.id}`, nextTimeframe);
      } catch {
        // ignore storage quota errors
      }

      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (!isOffline) {
        const { error } = await supabase
          .from('team')
          .update({ settings: nextSettings })
          .eq('id', teamInfo.id);
        if (error) {
          console.warn('Could not persist synced timeframe to team.settings:', error);
        }
      }

      const updatedTeam = { ...teamInfo, settings: nextSettings, timeframe: nextTimeframe };
      if (setTeamInfo) setTeamInfo(updatedTeam);
      if (setAllTeams) {
        setAllTeams((prev) => prev.map((t) => (t.id === teamInfo.id ? { ...t, settings: nextSettings, timeframe: nextTimeframe } : t)));
      }

      if (!timeframeOverride) {
        setDialogConfig({
          isOpen: true,
          type: 'info',
          isAlert: true,
          title: 'Season Timeframe Synced',
          message: `Season timeframe updated to "${nextTimeframe}".`,
          confirmText: 'OK',
          onConfirm: () => setDialogConfig(null),
          onCancel: () => setDialogConfig(null)
        });
      }
    } finally {
      setSyncingTimeframe(false);
    }
  };

  const handleLinkExistingMatch = (fixture, trackedMatch) => {
    const fixtureDate = fixture.date ? new Date(fixture.date).toLocaleDateString('en-GB') : 'TBD';
    const trackedDate = trackedMatch.date ? new Date(trackedMatch.date).toLocaleDateString('en-GB') : 'TBD';
    setDialogConfig({
      isOpen: true,
      type: 'warning',
      isAlert: false,
      title: 'Link Fixture to Existing Match',
      message: `Link scheduled fixture vs ${fixture.opponent} (${fixtureDate}) with tracked match vs ${trackedMatch.opponent} (${trackedDate})? The scheduled placeholder will be merged into the tracked match.`,
      confirmText: 'Link & Merge',
      cancelText: 'Cancel',
      onCancel: () => setDialogConfig(null),
      onConfirm: async () => {
        setDialogConfig(null);
        setMatches((prev) => prev.filter((m) => m.id !== fixture.id));
        if (isOfflineId(fixture.id) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
          queueOfflineMatchSnapshot(fixture, { deleted: true });
        } else {
          const { error } = await supabase.from('matches').delete().eq('id', fixture.id);
          if (error) {
            markServerUnreachable(true);
            queueOfflineMatchSnapshot(fixture, { deleted: true });
          }
        }
      }
    });
  };

  const handleDeleteFixture = (fixture) => {
    setDialogConfig({
      isOpen: true,
      type: 'danger',
      isAlert: false,
      title: 'Delete Scheduled Fixture',
      message: `Remove scheduled fixture vs ${fixture.opponent}?`,
      confirmText: 'Delete Fixture',
      cancelText: 'Cancel',
      onCancel: () => setDialogConfig(null),
      onConfirm: async () => {
        setDialogConfig(null);
        setMatches((prev) => prev.filter((m) => m.id !== fixture.id));
        if (isOfflineId(fixture.id) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
          queueOfflineMatchSnapshot(fixture, { deleted: true });
          return;
        }
        const { error } = await supabase.from('matches').delete().eq('id', fixture.id);
        if (error) {
          markServerUnreachable(true);
          queueOfflineMatchSnapshot(fixture, { deleted: true });
        }
      }
    });
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
      initialStats[pid] = { goals: 0, assists: 0, saves: 0, attempts: 0, defensive_contributions: 0 };
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

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    const isLinked = Boolean(linkedFixtureId);
    const linkedOffline = isLinked && isOfflineId(linkedFixtureId);
    let data = null;
    let error = null;

    if (!isOffline && !linkedOffline) {
      try {
        if (isLinked) {
          const res = await supabase
            .from('matches')
            .update({
              date: dbMatch.date,
              opponent: dbMatch.opponent,
              competition: dbMatch.competition,
              match_variant: dbMatch.match_variant,
              hide_score: dbMatch.hide_score,
              status: 'active'
            })
            .eq('id', linkedFixtureId)
            .select();
          data = res.data;
          error = res.error;
        } else {
          const res = await supabase.from('matches').insert([dbMatch]).select();
          data = res.data;
          error = res.error;
        }
      } catch (err) {
        error = err;
      }
    }

    if (isOffline || linkedOffline || error || !data || !data[0]) {
      if (error) {
        console.warn('Server unavailable when creating match — saving offline:', error);
        markServerUnreachable(true);
      }
      const offlineMatch = {
        ...dbMatch,
        id: isLinked ? linkedFixtureId : `offline-match-${Date.now()}`,
        created_at: new Date().toISOString(),
        stats: initialStats
      };
      queueOfflineMatchSnapshot(offlineMatch);
      if (isLinked) {
        setMatches(matches.map((m) => (m.id === linkedFixtureId ? offlineMatch : m)));
      } else {
        setMatches([offlineMatch, ...matches]);
      }

      setLinkedFixtureId(null);
      setShowNewMatchCard(false);
      setNewMatchOpponent('');
      setNewMatchHideScore(false);
      setNewMatchDate(new Date().toISOString().split('T')[0]);

      setActiveMatchId(offlineMatch.id);
      setCurrentView('match_tracker');
      return;
    }

    if (data && data[0]) {
      const newDbMatch = data[0];

      const statsToInsert = newMatchSquadSelection.map((pid) => ({
        match_id: newDbMatch.id,
        player_id: pid,
        goals: 0,
        assists: 0,
        saves: 0,
        attempts: 0,
        defensive_contributions: 0
      }));

      let { error: statsErr } = await supabase.from('match_stats').insert(statsToInsert);
      if (statsErr && (statsErr.message?.includes('column') || statsErr.code === '42703')) {
        const fallbackStats = newMatchSquadSelection.map((pid) => ({
          match_id: newDbMatch.id,
          player_id: pid,
          goals: 0,
          assists: 0,
          saves: 0
        }));
        const retry = await supabase.from('match_stats').insert(fallbackStats);
        statsErr = retry.error;
      }

      const matchWithStats = { ...newDbMatch, stats: initialStats };
      if (statsErr) {
        console.warn('Error inserting match stats — queuing for sync:', statsErr);
        queueOfflineMatchSnapshot(matchWithStats);
      }
      if (isLinked) {
        setMatches(matches.map((m) => (m.id === linkedFixtureId ? matchWithStats : m)));
      } else {
        setMatches([matchWithStats, ...matches]);
      }

      setLinkedFixtureId(null);
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
    saveTournament(
      name,
      {
        match_variant: getDefaultMatchVariant(),
        available_players: newTourneySquadSelection,
        team_id: teamInfo?.id
      },
      teamInfo?.id
    );
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
    setTournamentFinishedStatus(tourney.name, false, teamInfo?.id);
    removeSavedTournament(tourney.name, teamInfo?.id);
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
    const trimmed = editingOpponentText.trim();
    const targetMatch = matches.find((m) => m.id === matchId);

    setMatches(
      matches.map((m) => (m.id === matchId ? { ...m, opponent: trimmed } : m))
    );

    setEditingOpponentMatchId(null);

    if (isOfflineId(matchId) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      if (targetMatch) queueOfflineMatchSnapshot({ ...targetMatch, opponent: trimmed });
      return;
    }

    const { error } = await supabase
      .from('matches')
      .update({ opponent: trimmed })
      .eq('id', matchId);

    if (error) {
      console.warn('Failed to update opponent name online — queued offline:', error);
      markServerUnreachable(true);
      if (targetMatch) queueOfflineMatchSnapshot({ ...targetMatch, opponent: trimmed });
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
    const targetMatch = matchToDelete;

    setMatches(matches.filter((m) => m.id !== matchId));
    setMatchToDelete(null);

    if (isOfflineId(matchId)) {
      queueOfflineMatchSnapshot(targetMatch, { deleted: true });
      return;
    }

    const { error } = await supabase.from('matches').delete().eq('id', matchId);
    if (error) {
      console.warn('Match delete error — queued for deletion when online:', error);
      markServerUnreachable(true);
      queueOfflineMatchSnapshot(targetMatch, { deleted: true });
    }
  };

  const cancelDeleteMatch = () => {
    setMatchToDelete(null);
  };


  const resumeMatch = async (matchId, e) => {
    if (e) e.stopPropagation();
    const targetMatch = matches.find((m) => m.id === matchId);
    setMatches(matches.map((m) => (m.id === matchId ? { ...m, status: 'active' } : m)));
    if (isOfflineId(matchId) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      if (targetMatch) queueOfflineMatchSnapshot({ ...targetMatch, status: 'active' });
    } else {
      const { error } = await supabase.from('matches').update({ status: 'active' }).eq('id', matchId);
      if (error && targetMatch) {
        markServerUnreachable(true);
        queueOfflineMatchSnapshot({ ...targetMatch, status: 'active' });
      }
    }
    setActiveMatchId(matchId);
    setCurrentView('match_tracker');
  };

  const viewMatchDetails = (matchId, e) => {
    if (e) e.stopPropagation();
    setActiveMatchId(matchId);
    setCurrentView('match_report');
  };

  return (
    <div className="app-container app-view-matches">
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
        {/* Segmented Top Toggle: Regular Matches vs Fixtures vs Tournaments */}
        <div className="matches-tab-bar">
          <button
            className={`btn-matches-tab ${activeTab === 'matches' ? 'active' : ''}`}
            onClick={() => setActiveTab('matches')}
          >
            <ListOrdered size={16} /> Matches ({regularMatches.length})
          </button>
          <button
            className={`btn-matches-tab ${activeTab === 'fixtures' ? 'active' : ''}`}
            onClick={() => setActiveTab('fixtures')}
          >
            <Calendar size={16} /> Fixtures ({scheduledFixtures.length})
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
                  <button
                    onClick={() => {
                      setShowNewMatchCard(false);
                      setLinkedFixtureId(null);
                    }}
                    className="btn-icon"
                  >
                    <X size={20} />
                  </button>
                </div>
                <form onSubmit={createMatch}>
                  {scheduledFixtures.length > 0 && (
                    <div
                      style={{
                        marginBottom: '1rem',
                        padding: '0.75rem',
                        backgroundColor: 'var(--color-bg-body)',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--color-border)'
                      }}
                    >
                      <label className="label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Calendar size={14} /> Load from Scheduled Fixture (Optional)
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <select
                          className="input select"
                          value={linkedFixtureId || ''}
                          onChange={(e) => handleSelectFixtureForNewMatch(e.target.value)}
                          style={{ flex: 1 }}
                        >
                          <option value="">-- Manual match setup --</option>
                          {scheduledFixtures.map((f) => {
                            const dateLabel = f.date ? new Date(f.date).toLocaleDateString('en-GB') : 'TBD';
                            return (
                              <option key={f.id} value={f.id}>
                                vs {f.opponent} ({dateLabel} · {f.competition || 'League'})
                              </option>
                            );
                          })}
                        </select>
                        {linkedFixtureId && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ width: 'auto', padding: '0.5rem 0.75rem', fontSize: '0.8rem' }}
                            onClick={() => setLinkedFixtureId(null)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      {linkedFixtureId && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)', marginTop: '0.35rem', fontWeight: 500 }}>
                          Linked to scheduled fixture — starting this match will transition it to Active.
                        </div>
                      )}
                    </div>
                  )}
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
                      <DatePicker
                        value={newMatchDate}
                        onChange={setNewMatchDate}
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

            <div className="matches-grid">
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
        ) : activeTab === 'fixtures' ? (
          /* Fixtures View Tab */
          <>
            <div className="flex-between mb-4" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h2 className="title-md" style={{ marginBottom: '0.15rem' }}>
                  Fixtures
                </h2>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  {teamInfo?.settings?.timeframe || teamInfo?.timeframe
                    ? `Season Timeframe: ${teamInfo?.settings?.timeframe || teamInfo?.timeframe}`
                    : 'No season timeframe set yet'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleSyncSeasonTimeframe()}
                  disabled={syncingTimeframe || matches.length === 0}
                  className="btn btn-secondary"
                  style={{ width: 'auto', padding: '0.5rem 0.85rem', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
                  title="Calculate season timeframe from scheduled fixtures and played matches"
                >
                  <RefreshCw size={15} /> {syncingTimeframe ? 'Syncing...' : 'Sync Timeframe'}
                </button>
                <button
                  onClick={() => {
                    setEditingFixture(null);
                    setFixtureImportMode('bulk');
                    setShowFixtureImportModal(true);
                  }}
                  className="btn btn-secondary"
                  style={{ width: 'auto', padding: '0.5rem 0.85rem', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
                >
                  <Upload size={15} /> Import Fixtures
                </button>
                <button
                  onClick={() => {
                    setEditingFixture(null);
                    setFixtureImportMode('single');
                    setShowFixtureImportModal(true);
                  }}
                  className="btn btn-primary"
                  style={{ width: 'auto', padding: '0.5rem 0.9rem', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
                >
                  <Plus size={16} /> Add Fixture
                </button>
              </div>
            </div>

            {/* Upcoming Scheduled Fixtures */}
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>
              Upcoming Fixtures ({scheduledFixtures.length})
            </h3>
            {scheduledFixtures.length === 0 ? (
              <div className="card empty-state" style={{ padding: '2rem 1.5rem', textAlign: 'center', marginBottom: '1.5rem' }}>
                <Calendar size={34} style={{ color: 'var(--color-text-light)', margin: '0 auto 0.65rem' }} />
                <h4 style={{ fontSize: '0.98rem', fontWeight: 700, marginBottom: '0.35rem' }}>No Upcoming Fixtures</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', maxWidth: '400px', margin: '0 auto 1rem' }}>
                  Import your season fixture list from CSV or text, or add fixtures one at a time.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      setFixtureImportMode('bulk');
                      setShowFixtureImportModal(true);
                    }}
                    className="btn btn-primary"
                    style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <Upload size={15} /> Import Fixtures
                  </button>
                  <button
                    onClick={() => {
                      setFixtureImportMode('single');
                      setShowFixtureImportModal(true);
                    }}
                    className="btn btn-secondary"
                    style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <Plus size={15} /> Add Single Fixture
                  </button>
                </div>
              </div>
            ) : (
              <div className="matches-grid" style={{ marginBottom: '1.75rem' }}>
                {scheduledFixtures.map((fixture) => {
                  const countdown = getFixtureCountdownBadge(fixture.date);
                  const potentialMatch = findMatchingTrackedMatch(fixture, regularMatches);
                  const countdownColors = {
                    primary: { bg: 'rgba(22, 163, 74, 0.12)', color: 'var(--color-primary)' },
                    info: { bg: 'rgba(2, 132, 199, 0.12)', color: '#0284c7' },
                    warning: { bg: 'rgba(245, 158, 11, 0.12)', color: '#d97706' },
                    neutral: { bg: 'var(--color-bg-body)', color: 'var(--color-text-muted)' }
                  };
                  const badgeStyle = countdown ? countdownColors[countdown.variant] || countdownColors.neutral : null;

                  return (
                    <div key={fixture.id} className="card match-card" style={{ padding: '1rem 1.15rem' }}>
                      <div className="flex-between" style={{ alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text-main)' }}>
                            vs {fixture.opponent}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                            {fixture.date ? new Date(fixture.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Date TBD'}
                            {' · '}
                            {fixture.competition || 'League'}
                            {fixture.match_variant ? ` · ${fixture.match_variant}` : ''}
                          </div>
                        </div>
                        {countdown && badgeStyle && (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '0.2rem 0.55rem',
                              borderRadius: '999px',
                              backgroundColor: badgeStyle.bg,
                              color: badgeStyle.color,
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {countdown.label}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                        <button
                          onClick={() => handleStartTrackingFixture(fixture)}
                          className="btn btn-primary"
                          style={{ width: 'auto', padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                        >
                          <Play size={13} /> Track Match
                        </button>
                        {potentialMatch && (
                          <button
                            onClick={() => handleLinkExistingMatch(fixture, potentialMatch.match)}
                            className="btn btn-secondary"
                            style={{ width: 'auto', padding: '0.4rem 0.75rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                            title={`Detected ${potentialMatch.reason} match with ${potentialMatch.match.opponent}`}
                          >
                            <Link2 size={13} /> Link Tracked Match
                          </button>
                        )}
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <button
                            onClick={() => {
                              setEditingFixture(fixture);
                              setFixtureImportMode('single');
                              setShowFixtureImportModal(true);
                            }}
                            className="btn-icon"
                            title="Edit scheduled fixture"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDeleteFixture(fixture)}
                            className="btn-icon"
                            style={{ color: 'var(--color-danger)' }}
                            title="Delete scheduled fixture"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Previous Fixture Results */}
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>
              Previous Results ({completedResults.length})
            </h3>
            {completedResults.length === 0 ? (
              <div className="card" style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                Completed matches will appear here automatically.
              </div>
            ) : (
              <div className="matches-grid">
                {completedResults.map((match) => (
                  <div
                    key={match.id}
                    className="card match-card"
                    onClick={(e) => viewMatchDetails(match.id, e)}
                    style={{ cursor: 'pointer', padding: '0.9rem 1.1rem' }}
                  >
                    <div className="flex-between">
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>vs {match.opponent}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                          {match.date ? new Date(match.date).toLocaleDateString('en-GB') : ''} · {match.competition || 'League'}
                        </div>
                      </div>
                      <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--color-text-main)' }}>
                        {match.hide_score ? (
                          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Score Hidden</span>
                        ) : (
                          `${match.team_goals ?? 0} - ${match.opponent_goals ?? 0}`
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
              <div className="tournaments-grid">
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
      {/* Fixture Import / Add / Edit Modal */}
      <FixtureImportModal
        isOpen={showFixtureImportModal}
        onClose={() => {
          setShowFixtureImportModal(false);
          setEditingFixture(null);
        }}
        teamInfo={teamInfo}
        session={session}
        existingMatches={matches}
        initialMode={fixtureImportMode}
        editingFixture={editingFixture}
        onFixturesImported={(inserted) => {
          setMatches((prev) => [...inserted, ...prev]);
        }}
        onFixtureUpdated={(updated) => {
          setMatches((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        }}
        onSyncTimeframe={(timeframeStr) => handleSyncSeasonTimeframe(timeframeStr)}
      />

      {/* Reusable In-App Confirm / Alert Dialog */}
      {dialogConfig && (
        <ConfirmDialog
          isOpen={dialogConfig.isOpen}
          title={dialogConfig.title}
          message={dialogConfig.message}
          type={dialogConfig.type}
          isAlert={dialogConfig.isAlert}
          confirmText={dialogConfig.confirmText}
          cancelText={dialogConfig.cancelText}
          onConfirm={dialogConfig.onConfirm}
          onCancel={dialogConfig.onCancel}
        />
      )}
    </div>
  );
}
