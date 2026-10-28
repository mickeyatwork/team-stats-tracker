import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import AuthView from './views/AuthView';
import TeamSetupView from './views/TeamSetupView';
import MatchesView from './views/MatchesView';
import MatchTrackerView from './views/MatchTrackerView';
import SquadView from './views/SquadView';
import StatsView from './views/StatsView';
import SettingsView from './views/SettingsView';
import MatchReportView from './views/MatchReportView';
import TournamentView from './views/TournamentView';
import { FEATURE_KEYS, isFeatureEnabled } from './utils/featureFlags';
import { getSavedTheme, applyTheme } from './utils/themePreferences';
import { Shield, X } from 'lucide-react';

export default function App() {
  // Theme State
  const [currentTheme, setCurrentTheme] = useState(getSavedTheme);

  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  // Auth State
  const [session, setSession] = useState(null);
  const [isAppLoading, setIsAppLoading] = useState(true);

  // Teams & App Data State
  const [teamInfo, setTeamInfo] = useState(null);
  const [allTeams, setAllTeams] = useState([]);
  const [squad, setSquad] = useState([]);
  const [matches, setMatches] = useState([]);
  const [goalEvents, setGoalEvents] = useState([]);

  // Navigation State
  const [currentView, setCurrentView] = useState('matches');
  const [activeMatchId, setActiveMatchId] = useState(null);
  const [activeTournamentName, setActiveTournamentName] = useState(null);
  const [returnToTournament, setReturnToTournament] = useState(null);

  // Add Profile Modal State
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newSeasonName, setNewSeasonName] = useState('');
  const [addTeamLoading, setAddTeamLoading] = useState(false);

  const activeMatch = matches.find((m) => m.id === activeMatchId);

  // Auth Subscription
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch App Data when session or active team changes
  useEffect(() => {
    if (session) {
      fetchUserTeams();
    } else {
      setIsAppLoading(false);
    }
  }, [session]);

  const fetchUserTeams = async () => {
    setIsAppLoading(true);
    try {
      const { data: teamsData, error: teamError } = await supabase
        .from('team')
        .select('*')
        .eq('user_id', session.user.id)
        .order('id', { ascending: false });

      if (teamError) console.error('Teams fetch error:', teamError);

      if (teamsData && teamsData.length > 0) {
        const enrichedTeams = teamsData.map((t) => ({
          ...t,
          [FEATURE_KEYS.MATCH_DYNAMICS]: isFeatureEnabled(t, FEATURE_KEYS.MATCH_DYNAMICS),
          [FEATURE_KEYS.EFFICIENCY_RATING]: isFeatureEnabled(t, FEATURE_KEYS.EFFICIENCY_RATING)
        }));
        setAllTeams(enrichedTeams);
        // Default to first team if not already set or invalid
        if (!teamInfo || !enrichedTeams.some((t) => t.id === teamInfo.id)) {
          setTeamInfo(enrichedTeams[0]);
        }
      } else {
        setAllTeams([]);
        setTeamInfo(null);
      }
    } catch (error) {
      console.error('fetchUserTeams exception:', error);
    } finally {
      setIsAppLoading(false);
    }
  };

  // Fetch Squad & Matches when teamInfo changes
  useEffect(() => {
    if (session && teamInfo) {
      fetchSquadAndMatches();
    }
  }, [session, teamInfo]);

  const fetchSquadAndMatches = async () => {
    try {
      // Squad
      const { data: squadData, error: squadError } = await supabase.from('squad').select('*');
      if (squadError) console.error('Squad fetch error:', squadError);
      if (squadData) setSquad(squadData);

      // Matches
      const { data: matchData, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .order('date', { ascending: false });

      if (matchError) console.error('Matches fetch error:', matchError);

      if (matchData) {
        const { data: statsData } = await supabase.from('match_stats').select('*');
        const { data: eventsData } = await supabase.from('goal_events').select('*');
        setGoalEvents(eventsData || []);
        const matchesWithStats = matchData.map((m) => {
          const matchStatsArray = statsData?.filter((s) => s.match_id === m.id) || [];
          const statsMap = {};
          matchStatsArray.forEach((s) => {
            statsMap[s.player_id] = {
              goals: s.goals || 0,
              assists: s.assists || 0,
              saves: s.saves || 0,
              is_goalkeeper: s.is_goalkeeper || false
            };
          });
          return { ...m, stats: statsMap };
        });
        setMatches(matchesWithStats);
      }
    } catch (error) {
      console.error('fetchSquadAndMatches exception:', error);
    }
  };

  const handleSelectTeam = (team) => {
    setTeamInfo(team);
  };

  const handleAddNewTeam = () => {
    setShowAddTeamModal(true);
  };

  const handleCreateNewTeam = async (e) => {
    e.preventDefault();
    if (!newTeamName.trim() || !newSeasonName.trim() || !session?.user?.id) return;
    setAddTeamLoading(true);

    const newTeamObj = {
      user_id: session.user.id,
      name: newTeamName.trim(),
      season: newSeasonName.trim(),
      hide_positions: false
    };

    try {
      const { data, error } = await supabase.from('team').insert([newTeamObj]).select().single();

      if (error) {
        alert(`Error adding team: ${error.message}`);
        setAddTeamLoading(false);
        return;
      }

      if (data) {
        const enrichedTeam = {
          ...data,
          [FEATURE_KEYS.MATCH_DYNAMICS]: isFeatureEnabled(data, FEATURE_KEYS.MATCH_DYNAMICS),
          [FEATURE_KEYS.EFFICIENCY_RATING]: isFeatureEnabled(data, FEATURE_KEYS.EFFICIENCY_RATING)
        };
        setAllTeams([enrichedTeam, ...allTeams]);
        setTeamInfo(enrichedTeam);
        setShowAddTeamModal(false);
        setNewTeamName('');
        setNewSeasonName('');
      }
    } catch (err) {
      alert(`Error creating profile: ${err.message}`);
    } finally {
      setAddTeamLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setTeamInfo(null);
    setAllTeams([]);
    setSquad([]);
    setMatches([]);
    setCurrentView('matches');
  };

  // Rendering Views
  if (isAppLoading) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <h2 className="title-md text-gradient">Loading Team Stats Tracker...</h2>
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthView />;
  }

  if (!teamInfo) {
    return (
      <TeamSetupView
        userId={session.user.id}
        onTeamCreated={(newTeam) => {
          setAllTeams([newTeam, ...allTeams]);
          setTeamInfo(newTeam);
        }}
      />
    );
  }

  const renderCurrentView = () => {
    if (currentView === 'settings') {
      return (
        <SettingsView
          session={session}
          teamInfo={teamInfo}
          setTeamInfo={setTeamInfo}
          allTeams={allTeams}
          setAllTeams={setAllTeams}
          onSelectTeam={handleSelectTeam}
          onAddNewTeam={handleAddNewTeam}
          setCurrentView={setCurrentView}
          currentTheme={currentTheme}
          setCurrentTheme={setCurrentTheme}
        />
      );
    }

    if (currentView === 'squad') {
      return (
        <SquadView
          squad={squad}
          setSquad={setSquad}
          session={session}
          teamInfo={teamInfo}
          allTeams={allTeams}
          onSelectTeam={handleSelectTeam}
          onAddNewTeam={handleAddNewTeam}
          setCurrentView={setCurrentView}
        />
      );
    }

    if (currentView === 'stats') {
      return (
        <StatsView
          matches={matches}
          squad={squad}
          teamInfo={teamInfo}
          allTeams={allTeams}
          onSelectTeam={handleSelectTeam}
          onAddNewTeam={handleAddNewTeam}
          setCurrentView={setCurrentView}
          goalEvents={goalEvents}
        />
      );
    }

    if (currentView === 'tournament' && (activeTournamentName || returnToTournament)) {
      const currentTourneyName = activeTournamentName || returnToTournament;
      return (
        <TournamentView
          tournamentName={currentTourneyName}
          matches={matches}
          setMatches={setMatches}
          squad={squad}
          teamInfo={teamInfo}
          session={session}
          setCurrentView={setCurrentView}
          setActiveMatchId={setActiveMatchId}
          setReturnToTournament={setReturnToTournament}
          setActiveTournamentName={setActiveTournamentName}
        />
      );
    }

    if (currentView === 'match_tracker' && activeMatch) {
      return (
        <MatchTrackerView
          activeMatch={activeMatch}
          matches={matches}
          setMatches={setMatches}
          squad={squad}
          teamInfo={teamInfo}
          setCurrentView={setCurrentView}
          setActiveMatchId={setActiveMatchId}
          allGoalEvents={goalEvents}
          setAllGoalEvents={setGoalEvents}
          returnToTournament={returnToTournament}
          setReturnToTournament={setReturnToTournament}
          setActiveTournamentName={setActiveTournamentName}
        />
      );
    }

    if (currentView === 'match_report' && activeMatch) {
      return (
        <MatchReportView
          activeMatch={activeMatch}
          matches={matches}
          setMatches={setMatches}
          squad={squad}
          teamInfo={teamInfo}
          setCurrentView={setCurrentView}
          setActiveMatchId={setActiveMatchId}
          allGoalEvents={goalEvents}
          setAllGoalEvents={setGoalEvents}
          returnToTournament={returnToTournament}
          setReturnToTournament={setReturnToTournament}
          setActiveTournamentName={setActiveTournamentName}
        />
      );
    }

    return (
      <MatchesView
        matches={matches}
        setMatches={setMatches}
        squad={squad}
        teamInfo={teamInfo}
        allTeams={allTeams}
        onSelectTeam={handleSelectTeam}
        onAddNewTeam={handleAddNewTeam}
        setCurrentView={setCurrentView}
        setActiveMatchId={setActiveMatchId}
        session={session}
        onOpenTournament={(name) => {
          setActiveTournamentName(name);
          setCurrentView('tournament');
        }}
      />
    );
  };

  return (
    <>
      {renderCurrentView()}

      {showAddTeamModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <div className="flex-between mb-4">
              <h3 className="title-md" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Shield size={18} style={{ color: 'var(--color-primary)' }} />
                Add New Team / Season
              </h3>
              <button className="btn-icon" onClick={() => setShowAddTeamModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateNewTeam}>
              <div className="input-group">
                <label className="label">Team Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. AFC Richmond U11s"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  required
                />
              </div>
              <div className="input-group">
                <label className="label">Season</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. 2025/26"
                  value={newSeasonName}
                  onChange={(e) => setNewSeasonName(e.target.value)}
                  required
                />
              </div>
              <div className="flex-row gap-2 mt-4">
                <button type="submit" disabled={addTeamLoading} className="btn btn-primary" style={{ flex: 1 }}>
                  {addTeamLoading ? 'Saving...' : 'Create Profile'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddTeamModal(false)}
                  className="btn btn-secondary"
                  style={{ width: 'auto' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
