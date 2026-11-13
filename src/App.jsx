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
import { getTeamFeatures } from './utils/featureFlags';
import { getSavedTheme, applyTheme } from './utils/themePreferences';
import { fetchUserPreferences, getSavedMatchRoles } from './utils/userPreferences';
import { generateMissingTimelineEvents, getLocalTimelineEvents } from './utils/timelineUtils';
import {
  saveOfflineTeamsCache,
  getOfflineTeamsCache,
  saveOfflineTeamDataCache,
  getOfflineTeamDataCache,
  mergeOfflineDirtyMatches,
  flushOfflineSyncQueue,
  markServerUnreachable
} from './utils/offlineSync';
import {
  ROLES,
  USER_STATUS,
  isDevAdmin
} from './utils/authRoles';
import { Shield, X, AlertOctagon, LogOut } from 'lucide-react';
import ConfirmDialog from './components/ConfirmDialog';

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

  // All-Seasons Data State (for "All Time (All Seasons)" analytics view)
  const [allSeasonsSquad, setAllSeasonsSquad] = useState([]);
  const [allSeasonsMatches, setAllSeasonsMatches] = useState([]);
  const [allSeasonsGoalEvents, setAllSeasonsGoalEvents] = useState([]);

  // Navigation State
  const [currentView, setCurrentView] = useState('matches');
  const [activeMatchId, setActiveMatchId] = useState(null);
  const [activeTournamentName, setActiveTournamentName] = useState(null);
  const [returnToTournament, setReturnToTournament] = useState(null);

  // Add Team Modal State
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newSeasonName, setNewSeasonName] = useState('');
  const [newLeagueName, setNewLeagueName] = useState('');
  const [newTimeframe, setNewTimeframe] = useState('');
  const [newTeamClubId, setNewTeamClubId] = useState('');
  const [carryOverSquad, setCarryOverSquad] = useState(true);
  const [addTeamLoading, setAddTeamLoading] = useState(false);

  // In-app Warning & Confirmation Dialog State
  const [dialogConfig, setDialogConfig] = useState(null);

  const showWarningDialog = (title, message) => {
    setDialogConfig({
      isOpen: true,
      type: 'warning',
      isAlert: true,
      title,
      message,
      confirmText: 'Understood',
      onConfirm: () => setDialogConfig(null)
    });
  };

  const activeMatch = matches.find((m) => m.id === activeMatchId);

  // Keep offline cache updated whenever active team's squad or matches change
  useEffect(() => {
    if (teamInfo?.id && (squad.length > 0 || matches.length > 0)) {
      saveOfflineTeamDataCache(teamInfo.id, { squad, matches });
    }
  }, [teamInfo?.id, squad, matches]);

  // Automatically flush offline queue when connectivity returns or periodically if items are pending
  useEffect(() => {
    if (!session) return;

    const runSync = () => {
      flushOfflineSyncQueue(supabase, {
        onMatchIdRemapped: (oldOfflineId, createdDbMatch) => {
          setMatches((prev) =>
            prev.map((m) => (m.id === oldOfflineId ? { ...createdDbMatch, stats: m.stats || createdDbMatch.stats } : m))
          );
          setActiveMatchId((prevId) => (prevId === oldOfflineId ? createdDbMatch.id : prevId));
        }
      });
    };

    runSync();
    window.addEventListener('online', runSync);
    const interval = setInterval(runSync, 20000);
    return () => {
      window.removeEventListener('online', runSync);
      clearInterval(interval);
    };
  }, [session]);

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

      // 0. Load User Preferences from user_preferences table / metadata
      const loadedPrefs = await fetchUserPreferences(session);
      if (loadedPrefs?.theme) {
        setCurrentTheme(loadedPrefs.theme);
      }

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
        const getSeasonSortScore = (seasonStr) => {
          if (!seasonStr) return 0;
          const nums = String(seasonStr).match(/\d+/g);
          if (!nums || nums.length === 0) return 0;
          const first = parseInt(nums[0], 10);
          const firstYear = first < 100 ? 2000 + first : first;
          let secondYear = firstYear;
          if (nums.length > 1) {
            const second = parseInt(nums[1], 10);
            secondYear = second < 100 ? Math.floor(firstYear / 100) * 100 + second : second;
          }
          return firstYear * 10000 + secondYear;
        };

        const enrichedTeams = teamsData
          .map((t) => {
            const settings = t.settings || {};
            const league = (t.league || settings.league || localStorage.getItem(`team_league_${t.id}`) || '').trim();
            const timeframe = (t.timeframe || settings.timeframe || localStorage.getItem(`team_timeframe_${t.id}`) || '').trim();
            const badge_url = (t.badge_url || settings.badge_url || localStorage.getItem(`team_badge_${t.id}`) || '').trim();
            return {
              ...t,
              league,
              timeframe,
              badge_url,
              ...getTeamFeatures(t)
            };
          })
          .sort((a, b) => {
            const seasonDiff = getSeasonSortScore(b.season) - getSeasonSortScore(a.season);
            if (seasonDiff !== 0) return seasonDiff;
            if (b.created_at && a.created_at) {
              const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              if (timeDiff !== 0) return timeDiff;
            }
            return String(b.id || '').localeCompare(String(a.id || ''), undefined, { numeric: true });
          });

        setAllTeams(enrichedTeams);
        saveOfflineTeamsCache(enrichedTeams, clubsList);
        markServerUnreachable(false);

        // Retain current team if valid, otherwise select most recent season's team
        setTeamInfo((prev) => {
          if (prev && enrichedTeams.some((t) => t.id === prev.id)) {
            return prev;
          }
          return enrichedTeams[0];
        });
      } else {
        const cached = getOfflineTeamsCache();
        if (cached.teams && cached.teams.length > 0 && teamError) {
          markServerUnreachable(true);
          setAllTeams(cached.teams);
          if (cached.clubs?.length > 0) setAllClubs(cached.clubs);
          setTeamInfo((prev) => prev || cached.teams[0]);
        } else {
          setAllTeams([]);
          setTeamInfo(null);
        }
      }
    } catch (error) {
      console.error('loadUserContext exception:', error);
      const cached = getOfflineTeamsCache();
      if (cached.teams && cached.teams.length > 0) {
        markServerUnreachable(true);
        setAllTeams(cached.teams);
        if (cached.clubs?.length > 0) setAllClubs(cached.clubs);
        setTeamInfo((prev) => prev || cached.teams[0]);
      }
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
      // Flush any pending offline changes first if online
      await flushOfflineSyncQueue(supabase);

      // Identify earliest/legacy team ID so legacy records with null team_id only belong to the original season
      const accessibleTeamIds = new Set((allTeams || []).map((t) => t.id));
      if (teamInfo?.id) accessibleTeamIds.add(teamInfo.id);
      const legacyTeamId = allTeams && allTeams.length > 0
        ? allTeams[allTeams.length - 1].id
        : teamInfo?.id;

      // Squad: fetch and filter to active team
      const { data: squadData, error: squadError } = await supabase.from('squad').select('*');
      if (squadError) {
        console.error('Squad fetch error:', squadError);
        markServerUnreachable(true);
      }
      if (squadData) {
        const allAccessibleSquad = squadData.filter(
          (p) => (p.team_id && accessibleTeamIds.has(p.team_id)) || (!p.team_id && accessibleTeamIds.has(legacyTeamId))
        );
        setAllSeasonsSquad(allAccessibleSquad);

        const scopedSquad = squadData.filter(
          (p) => p.team_id === teamInfo.id || (!p.team_id && teamInfo.id === legacyTeamId)
        );
        setSquad(scopedSquad);
      } else {
        const cached = getOfflineTeamDataCache(teamInfo.id);
        if (cached.squad?.length > 0) {
          setSquad(cached.squad);
          setAllSeasonsSquad(cached.squad);
        }
      }

      // Matches: fetch and filter to active team
      const { data: matchData, error: matchError } = await supabase
        .from('matches')
        .select('*')
        .order('date', { ascending: false });

      if (matchError) {
        console.error('Matches fetch error:', matchError);
        markServerUnreachable(true);
      }

      if (matchData) {
        markServerUnreachable(false);
        const { data: statsData } = await supabase.from('match_stats').select('*');
        const { data: eventsData } = await supabase.from('goal_events').select('*');

        const enrichMatchesList = (rawMatches) =>
          rawMatches.map((m) => {
            const matchStatsArray = statsData?.filter((s) => s.match_id === m.id) || [];
            const savedRoles = getSavedMatchRoles(m.id);
            const statsMap = {};
            matchStatsArray.forEach((s) => {
              statsMap[s.player_id] = {
                goals: s.goals || 0,
                assists: s.assists || 0,
                saves: s.saves || 0,
                attempts: s.attempts || 0,
                defensive_contributions: s.defensive_contributions || 0,
                is_goalkeeper: s.is_goalkeeper || false,
                is_captain: s.is_captain ?? savedRoles.captains.includes(s.player_id),
                is_potm: s.is_potm ?? savedRoles.potm.includes(s.player_id)
              };
            });
            return { ...m, stats: statsMap };
          });

        const rawEvents = eventsData || [];
        const resolveEventsForMatches = (enrichedMatchesList) => {
          const resolved = [];
          enrichedMatchesList.forEach((m) => {
            const dbMatchEvts = rawEvents.filter((e) => String(e.match_id) === String(m.id));
            const localEvts = getLocalTimelineEvents(m.id);
            const baseEvts = dbMatchEvts.length > 0 ? dbMatchEvts : localEvts;
            const missing = generateMissingTimelineEvents(m, [], baseEvts).map((evt, idx) => ({
              ...evt,
              id: `synthetic-${m.id}-${baseEvts.length + idx + 1}`
            }));
            resolved.push(...baseEvts, ...missing);
          });
          return resolved;
        };

        // Current season matches (plus any unsynced offline matches for this season)
        const scopedMatches = matchData.filter(
          (m) => m.team_id === teamInfo.id || (!m.team_id && teamInfo.id === legacyTeamId)
        );
        const matchesWithStats = mergeOfflineDirtyMatches(enrichMatchesList(scopedMatches), teamInfo.id);
        const resolvedCurrentEvents = resolveEventsForMatches(matchesWithStats);

        setGoalEvents(resolvedCurrentEvents);
        setMatches(matchesWithStats);
        saveOfflineTeamDataCache(teamInfo.id, { squad: squadData ? squadData.filter((p) => p.team_id === teamInfo.id || (!p.team_id && teamInfo.id === legacyTeamId)) : squad, matches: matchesWithStats });

        // All seasons matches across accessible teams
        const allAccessibleRawMatches = matchData.filter(
          (m) => (m.team_id && accessibleTeamIds.has(m.team_id)) || (!m.team_id && accessibleTeamIds.has(legacyTeamId))
        );
        const allMatchesWithStats = mergeOfflineDirtyMatches(enrichMatchesList(allAccessibleRawMatches), null);
        const resolvedAllSeasonsEvents = resolveEventsForMatches(allMatchesWithStats);

        setAllSeasonsMatches(allMatchesWithStats);
        setAllSeasonsGoalEvents(resolvedAllSeasonsEvents);
      } else {
        // Offline fallback using cached team data + dirty offline queue
        const cached = getOfflineTeamDataCache(teamInfo.id);
        const mergedOfflineMatches = mergeOfflineDirtyMatches(cached.matches || [], teamInfo.id);
        const fallbackEvents = [];
        mergedOfflineMatches.forEach((m) => {
          const localEvts = getLocalTimelineEvents(m.id);
          const missing = generateMissingTimelineEvents(m, [], localEvts).map((evt, idx) => ({
            ...evt,
            id: `synthetic-${m.id}-${localEvts.length + idx + 1}`
          }));
          fallbackEvents.push(...localEvts, ...missing);
        });
        setMatches(mergedOfflineMatches);
        setGoalEvents(fallbackEvents);
        setAllSeasonsMatches(mergedOfflineMatches);
        setAllSeasonsGoalEvents(fallbackEvents);
      }
    } catch (error) {
      console.error('fetchSquadAndMatches exception:', error);
      markServerUnreachable(true);
      const cached = getOfflineTeamDataCache(teamInfo?.id);
      if (cached.squad?.length > 0) setSquad(cached.squad);
      const mergedOfflineMatches = mergeOfflineDirtyMatches(cached.matches || [], teamInfo?.id);
      setMatches(mergedOfflineMatches);
    }
  };

  const handleSelectTeam = (team) => {
    setTeamInfo(team);
  };

  const handleAddNewTeam = (prefillTeamName = null) => {
    setNewTeamName(typeof prefillTeamName === 'string' ? prefillTeamName : (teamInfo?.name || ''));
    setNewSeasonName('');
    setNewLeagueName('');
    setNewTimeframe('');
    setCarryOverSquad(true);
    setNewTeamClubId(currentUserProfile?.club_id || teamInfo?.club_id || (allClubs[0]?.id || ''));
    setShowAddTeamModal(true);
  };

  const handleCreateNewTeam = async (e) => {
    e.preventDefault();
    if (!newTeamName.trim() || !newSeasonName.trim() || !session?.user?.id) return;
    setAddTeamLoading(true);

    const targetClubId = isDevAdmin(currentUserProfile)
      ? (newTeamClubId || (allClubs[0]?.id || null))
      : (currentUserProfile?.club_id || (allClubs[0]?.id || null));

    const cleanLeague = newLeagueName.trim();
    const cleanTimeframe = newTimeframe.trim();
    const matchingExistingTeam = allTeams.find(
      (t) =>
        (t.name || '').trim().toLowerCase() === newTeamName.trim().toLowerCase() &&
        (t.club_id || null) === (targetClubId || null) &&
        (t.badge_url || t.settings?.badge_url)
    );
    const inheritedBadgeUrl = matchingExistingTeam?.badge_url || matchingExistingTeam?.settings?.badge_url || '';

    const newSettings = {
      ...(teamInfo?.settings ? teamInfo.settings : {}),
      ...(cleanLeague ? { league: cleanLeague } : {}),
      ...(cleanTimeframe ? { timeframe: cleanTimeframe } : {}),
      badge_url: inheritedBadgeUrl
    };

    const newTeamObj = {
      user_id: session.user.id,
      name: newTeamName.trim(),
      season: newSeasonName.trim(),
      league: cleanLeague || null,
      timeframe: cleanTimeframe || null,
      club_id: targetClubId,
      hide_positions: teamInfo?.hide_positions || false,
      settings: newSettings
    };

    try {
      let { data, error } = await supabase.from('team').insert([newTeamObj]).select().single();

      // Fallback if league or timeframe columns do not exist on team table
      if (error && (error.message?.includes('column') || error.code === '42703' || error.code === 'PGRST204')) {
        const { league: _omitL, timeframe: _omitT, ...fallbackWithoutCols } = newTeamObj;
        const retry = await supabase.from('team').insert([fallbackWithoutCols]).select().single();
        data = retry.data;
        error = retry.error;
      }

      // Fallback if settings column does not exist on team table
      if (error && (error.message?.includes('settings') || error.code === 'PGRST204')) {
        const { settings: _omitSettings, league: _omitL, timeframe: _omitT, ...fallbackTeamObj } = newTeamObj;
        const retry = await supabase.from('team').insert([fallbackTeamObj]).select().single();
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        showWarningDialog('Error Adding Team', `Error adding team: ${error.message}`);
        setAddTeamLoading(false);
        return;
      }

      if (data) {
        if (currentUserProfile?.id) {
          try {
            await supabase.from('user_team_assignments').insert([
              { user_profile_id: currentUserProfile.id, team_id: data.id }
            ]);
          } catch {
            // ignore assignment error if already assigned or table not used
          }
        }

        try {
          if (cleanLeague) localStorage.setItem(`team_league_${data.id}`, cleanLeague);
          if (cleanTimeframe) localStorage.setItem(`team_timeframe_${data.id}`, cleanTimeframe);
          if (inheritedBadgeUrl) localStorage.setItem(`team_badge_${data.id}`, inheritedBadgeUrl);
        } catch {
          // ignore localStorage error
        }

        // Carry over current squad players to the new season if checked
        if (carryOverSquad && squad.length > 0) {
          const clonedPlayers = squad.map((p) => ({
            user_id: session.user.id,
            team_id: data.id,
            name: p.name,
            position: p.position || 'FW'
          }));
          try {
            await supabase.from('squad').insert(clonedPlayers);
          } catch (cloneErr) {
            console.warn('Could not clone squad to new season:', cloneErr);
          }
        }

        const enrichedTeam = {
          ...data,
          league: cleanLeague || data.league || data.settings?.league || '',
          timeframe: cleanTimeframe || data.timeframe || data.settings?.timeframe || '',
          badge_url: inheritedBadgeUrl || data.badge_url || data.settings?.badge_url || '',
          ...getTeamFeatures(data)
        };
        setAllTeams([enrichedTeam, ...allTeams]);
        setTeamInfo(enrichedTeam);
        setShowAddTeamModal(false);
        setNewTeamName('');
        setNewSeasonName('');
        setNewLeagueName('');
        setNewTimeframe('');
      }
    } catch (err) {
      showWarningDialog('Error Creating Team', `Error creating team: ${err.message}`);
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
          allSeasonsMatches={allSeasonsMatches}
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
          allSeasonsMatches={allSeasonsMatches}
          allSeasonsSquad={allSeasonsSquad}
          allSeasonsGoalEvents={allSeasonsGoalEvents}
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
        setTeamInfo={setTeamInfo}
        allTeams={allTeams}
        setAllTeams={setAllTeams}
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
                  list="existing-teams-list"
                  required
                />
                <datalist id="existing-teams-list">
                  {Array.from(new Set(allTeams.map((t) => t.name).filter(Boolean))).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.2rem', display: 'block' }}>
                  Select an existing team name to add a season to it, or type a new team name.
                </span>
              </div>
              <div className="input-group">
                <label className="label">Season *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. 2026/27"
                  value={newSeasonName}
                  onChange={(e) => setNewSeasonName(e.target.value)}
                  required
                />
              </div>

              <div className="input-group">
                <label className="label">League / Competition (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Autumn League, Spring League"
                  value={newLeagueName}
                  onChange={(e) => setNewLeagueName(e.target.value)}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.2rem', display: 'block' }}>
                  Distinguishes sub-seasons (e.g. Autumn League, Winter Cup, Spring League).
                </span>
              </div>

              <div className="input-group">
                <label className="label">Season Timeframe / Dates (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. September 2026 – December 2026"
                  value={newTimeframe}
                  onChange={(e) => setNewTimeframe(e.target.value)}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.2rem', display: 'block' }}>
                  The months or dates when matches for this season are scheduled.
                </span>
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

              {squad.length > 0 && (
                <div className="input-group" style={{ marginTop: '0.5rem' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      color: 'var(--color-text-main)'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={carryOverSquad}
                      onChange={(e) => setCarryOverSquad(e.target.checked)}
                      style={{ accentColor: 'var(--color-primary)', width: '16px', height: '16px', cursor: 'pointer' }}
                    />
                    <span>Carry over current squad players &amp; settings to this new season</span>
                  </label>
                </div>
              )}

              <div className="flex-row gap-2 mt-4">
                <button type="submit" disabled={addTeamLoading} className="btn btn-primary" style={{ flex: 1 }}>
                  {addTeamLoading ? 'Saving...' : 'Create Season'}
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

      {/* In-app Warning and Confirmation Dialog */}
      <ConfirmDialog {...dialogConfig} />
    </>
  );
}
