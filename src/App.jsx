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
import {
  ROLES,
  USER_STATUS,
  isDevAdmin
} from './utils/authRoles';
import { Shield, X, AlertOctagon, LogOut } from 'lucide-react';

export default function App() {
  // Theme State
  const [currentTheme, setCurrentTheme] = useState(getSavedTheme);

  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  // Auth & Profile State
  const [session, setSession] = useState(null);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [isAppLoading, setIsAppLoading] = useState(true);

  // Clubs & Teams State
  const [allClubs, setAllClubs] = useState([]);
  const [allTeams, setAllTeams] = useState([]);
  const [teamInfo, setTeamInfo] = useState(null);

  // Data State (Scoped to active teamInfo)
  const [squad, setSquad] = useState([]);
  const [matches, setMatches] = useState([]);
  const [goalEvents, setGoalEvents] = useState([]);

  // Navigation State
  const [currentView, setCurrentView] = useState('matches');
  const [activeMatchId, setActiveMatchId] = useState(null);
  const [activeTournamentName, setActiveTournamentName] = useState(null);
  const [returnToTournament, setReturnToTournament] = useState(null);

  // Add Team Modal State
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newSeasonName, setNewSeasonName] = useState('');
  const [newTeamClubId, setNewTeamClubId] = useState('');
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

  // Fetch User Profile, Clubs & Teams when session changes
  useEffect(() => {
    if (session) {
      loadUserContext();
    } else {
      setCurrentUserProfile(null);
      setAllClubs([]);
      setAllTeams([]);
      setTeamInfo(null);
      setIsAppLoading(false);
    }
  }, [session]);

  const loadUserContext = async () => {
    setIsAppLoading(true);
    try {
      const email = session.user.email;

      // 1. Fetch User Profile
      let profile = null;
      try {
        const { data: pData } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('email', email)
          .maybeSingle();

        if (pData) {
          profile = pData;
        }
      } catch (err) {
        console.warn('user_profiles table might be initializing:', err);
      }

      // Default fallback: recognize current session user as Dev Admin if no profiles found yet
      if (!profile) {
        profile = {
          id: session.user.id,
          auth_user_id: session.user.id,
          email: email,
          name: email.split('@')[0],
          role: ROLES.DEV_ADMIN,
          status: USER_STATUS.ACTIVE,
          club_id: null
        };
      }
      setCurrentUserProfile(profile);

      // If deactivated, stop further loads
      if (profile.status === USER_STATUS.DEACTIVATED) {
        setIsAppLoading(false);
        return;
      }

      // 2. Fetch Club
      let clubsList = [];
      try {
        let { data: clubsData, error } = await supabase.from('club').select('*').order('created_at', { ascending: true });
        if (error || !clubsData) {
          const retry = await supabase.from('clubs').select('*').order('created_at', { ascending: true });
          if (!retry.error && retry.data) clubsData = retry.data;
        }
        if (clubsData && clubsData.length > 0) {
          clubsList = clubsData;
        } else {
          clubsList = [{ id: 'default', name: 'Tower Hill FC', location: 'Witney' }];
        }
      } catch {
        clubsList = [{ id: 'default', name: 'Tower Hill FC', location: 'Witney' }];
      }
      setAllClubs(clubsList);

      // 3. Fetch User Assignments if Normal User
      let assignedIds = [];
      if (profile.role === ROLES.NORMAL_USER && profile.id) {
        try {
          const { data: assigns } = await supabase
            .from('user_team_assignments')
            .select('team_id')
            .eq('user_profile_id', profile.id);

          if (assigns) {
            assignedIds = assigns.map((a) => a.team_id);
          }
        } catch (e) {
          console.warn('Assignments fetch fallback:', e);
        }
      }

      // 4. Fetch Teams
      let teamsQuery = supabase.from('team').select('*').order('id', { ascending: false });

      // If normal user with specific assignments, filter by assigned teams
      if (profile.role === ROLES.NORMAL_USER && assignedIds.length > 0) {
        teamsQuery = teamsQuery.in('id', assignedIds);
      } else if (profile.role === ROLES.TEAM_ADMIN && profile.club_id) {
        teamsQuery = teamsQuery.eq('club_id', profile.club_id);
      }

      const { data: teamsData, error: teamError } = await teamsQuery;
      if (teamError) console.error('Teams query error:', teamError);

      if (teamsData && teamsData.length > 0) {
        const enrichedTeams = teamsData.map((t) => ({
          ...t,
          [FEATURE_KEYS.MATCH_DYNAMICS]: isFeatureEnabled(t, FEATURE_KEYS.MATCH_DYNAMICS),
          [FEATURE_KEYS.EFFICIENCY_RATING]: isFeatureEnabled(t, FEATURE_KEYS.EFFICIENCY_RATING)
        }));
        setAllTeams(enrichedTeams);

        // Retain current team if valid, otherwise select first accessible team
        setTeamInfo((prev) => {
          if (prev && enrichedTeams.some((t) => t.id === prev.id)) {
            return prev;
          }
          return enrichedTeams[0];
        });
      } else {
        setAllTeams([]);
        setTeamInfo(null);
      }
    } catch (error) {
      console.error('loadUserContext exception:', error);
    } finally {
      setIsAppLoading(false);
    }
  };

  // Fetch Squad & Matches when teamInfo changes (scoped to active team)
  useEffect(() => {
    if (session && teamInfo) {
      fetchSquadAndMatches();
    }
  }, [session, teamInfo]);

  const fetchSquadAndMatches = async () => {
    try {
      // Squad: fetch and filter to active team (handling both team_id and legacy null)
      const { data: squadData, error: squadError } = await supabase.from('squad').select('*');
      if (squadError) console.error('Squad fetch error:', squadError);
      if (squadData) {
        const scopedSquad = squadData.filter((p) => !p.team_id || p.team_id === teamInfo.id);
        setSquad(scopedSquad);
      }

      // Matches: fetch and filter to active team
      const { data: matchData, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .order('date', { ascending: false });

      if (matchError) console.error('Matches fetch error:', matchError);

      if (matchData) {
        const scopedMatches = matchData.filter((m) => !m.team_id || m.team_id === teamInfo.id);

        const { data: statsData } = await supabase.from('match_stats').select('*');
        const { data: eventsData } = await supabase.from('goal_events').select('*');
        setGoalEvents(eventsData || []);

        const matchesWithStats = scopedMatches.map((m) => {
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
    setNewTeamClubId(currentUserProfile?.club_id || (allClubs[0]?.id || ''));
    setShowAddTeamModal(true);
  };

  const handleCreateNewTeam = async (e) => {
    e.preventDefault();
    if (!newTeamName.trim() || !newSeasonName.trim() || !session?.user?.id) return;
    setAddTeamLoading(true);

    const targetClubId = isDevAdmin(currentUserProfile)
      ? (newTeamClubId || (allClubs[0]?.id || null))
      : (currentUserProfile?.club_id || (allClubs[0]?.id || null));

    const newTeamObj = {
      user_id: session.user.id,
      name: newTeamName.trim(),
      season: newSeasonName.trim(),
      club_id: targetClubId,
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
      alert(`Error creating team: ${err.message}`);
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
    setCurrentUserProfile(null);
    setCurrentView('matches');
  };

  // Rendering Loading View
  if (isAppLoading) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <h2 className="title-md text-gradient">Loading Team Stats Tracker...</h2>
        </div>
      </div>
    );
  }

  // Not signed in
  if (!session) {
    return <AuthView />;
  }

  // Deactivated state banner
  if (currentUserProfile?.status === USER_STATUS.DEACTIVATED) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center', maxWidth: '440px' }}>
          <AlertOctagon size={48} color="var(--color-danger)" style={{ margin: '0 auto 1rem auto' }} />
          <h2 className="title-md" style={{ color: 'var(--color-danger)' }}>Account Deactivated</h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', margin: '1rem 0 1.5rem 0' }}>
            Your coach access for <strong>{session.user.email}</strong> has been deactivated by a club administrator.
          </p>
          <button onClick={handleSignOut} className="btn btn-secondary flex-row gap-2" style={{ margin: '0 auto' }}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Initial Team Setup if no team exists yet
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
          currentUserProfile={currentUserProfile}
          teamInfo={teamInfo}
          setTeamInfo={setTeamInfo}
          allTeams={allTeams}
          setAllTeams={setAllTeams}
          allClubs={allClubs}
          setAllClubs={setAllClubs}
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
          allClubs={allClubs}
          currentUserProfile={currentUserProfile}
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
          allClubs={allClubs}
          currentUserProfile={currentUserProfile}
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
        allClubs={allClubs}
        currentUserProfile={currentUserProfile}
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
                  placeholder="e.g. Tower Hill U8s"
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

              {isDevAdmin(currentUserProfile) && allClubs.length > 1 && (
                <div className="input-group">
                  <label className="label">Club</label>
                  <select
                    className="input"
                    value={newTeamClubId}
                    onChange={(e) => setNewTeamClubId(e.target.value)}
                  >
                    {allClubs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.location ? `(${c.location})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex-row gap-2 mt-4">
                <button type="submit" disabled={addTeamLoading} className="btn btn-primary" style={{ flex: 1 }}>
                  {addTeamLoading ? 'Saving...' : 'Create Team'}
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
