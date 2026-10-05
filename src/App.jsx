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

export default function App() {
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
        setAllTeams(teamsData);
        // Default to first team if not already set or invalid
        if (!teamInfo || !teamsData.some((t) => t.id === teamInfo.id)) {
          setTeamInfo(teamsData[0]);
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

  if (currentView === 'settings') {
    return (
      <SettingsView
        session={session}
        teamInfo={teamInfo}
        setTeamInfo={setTeamInfo}
        allTeams={allTeams}
        setAllTeams={setAllTeams}
        onSelectTeam={handleSelectTeam}
        setCurrentView={setCurrentView}
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
        setCurrentView={setCurrentView}
        goalEvents={goalEvents}
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
      />
    );
  }

  if (currentView === 'match_report' && activeMatch) {
    return (
      <MatchReportView
        activeMatch={activeMatch}
        squad={squad}
        teamInfo={teamInfo}
        setCurrentView={setCurrentView}
        setActiveMatchId={setActiveMatchId}
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
      setCurrentView={setCurrentView}
      setActiveMatchId={setActiveMatchId}
      session={session}
    />
  );
}
