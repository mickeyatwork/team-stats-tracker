import { useState, useEffect, useMemo, useRef } from 'react';
import {
  LogOut,
  User,
  Lock,
  Mail,
  Shield,
  Plus,
  Check,
  Edit2,
  Edit3,
  Sliders,
  Palette,
  Calendar,
  Users,
  Building2,
  ToggleLeft,
  Trash2,
  X,
  AlertCircle,
  CheckCircle2,
  Upload
} from 'lucide-react';
import TopNav from '../components/TopNav';
import UserManagementTab from '../components/UserManagementTab';
import ClubManagementModal from '../components/ClubManagementModal';
import ConfirmDialog from '../components/ConfirmDialog';
import TeamBadge from '../components/TeamBadge';
import { supabase } from '../supabaseClient';
import {
  validateBadgeFile,
  resizeImageToWebp,
  uploadTeamBadge,
  deleteTeamBadge
} from '../utils/imageUtils';
import { getDefaultMatchVariant, setDefaultMatchVariant, MATCH_VARIANTS } from '../utils/variantPreferences';
import {
  FEATURE_KEYS,
  isFeatureEnabled,
  setFeatureFlag,
  DEFAULT_PERFORMANCE_WEIGHTS,
  DEFAULT_MIN_FINISHER_ATTEMPTS,
  getPerformanceWeights,
  getMinFinisherAttempts
} from '../utils/featureFlags';
import { THEME_CONFIGS, getSavedTheme, applyTheme } from '../utils/themePreferences';
import {
  isDevAdmin,
  hasAdminPrivileges,
  canManageFeatureFlags,
  canManageClubs
} from '../utils/authRoles';
import {
  computeSeasonTimeframeFromMatches,
  getEffectiveTimeframe
} from '../utils/seasonUtils';

export default function SettingsView({
  session,
  currentUserProfile,
  teamInfo,
  setTeamInfo,
  allTeams = [],
  setAllTeams,
  allClubs = [],
  setAllClubs,
  onSelectTeam,
  onAddNewTeam,
  setCurrentView,
  currentTheme,
  setCurrentTheme,
  allSeasonsMatches = []
}) {
  // Update Email Form
  const [newEmail, setNewEmail] = useState('');
  const [emailStatus, setEmailStatus] = useState({ loading: false, success: null, error: null });

  // Update Password Form
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState({ loading: false, success: null, error: null });

  // Update Active Team Details & Feature Switches
  const [teamNameInput, setTeamNameInput] = useState(teamInfo?.name || '');
  const [seasonNameInput, setSeasonNameInput] = useState(teamInfo?.season || '');
  const [leagueInput, setLeagueInput] = useState(teamInfo?.league || teamInfo?.settings?.league || '');
  const [timeframeInput, setTimeframeInput] = useState(teamInfo?.timeframe || teamInfo?.settings?.timeframe || '');
  const [hidePositionsInput, setHidePositionsInput] = useState(teamInfo?.hide_positions || false);
  const [matchDynamicsInput, setMatchDynamicsInput] = useState(() => isFeatureEnabled(teamInfo, FEATURE_KEYS.MATCH_DYNAMICS));
  const [efficiencyRatingInput, setEfficiencyRatingInput] = useState(() => isFeatureEnabled(teamInfo, FEATURE_KEYS.EFFICIENCY_RATING));
  const [attemptsInput, setAttemptsInput] = useState(() => isFeatureEnabled(teamInfo, FEATURE_KEYS.ATTEMPTS));
  const [defensiveContributionsInput, setDefensiveContributionsInput] = useState(() => isFeatureEnabled(teamInfo, FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS));
  const [performancePointsInput, setPerformancePointsInput] = useState(() => isFeatureEnabled(teamInfo, FEATURE_KEYS.PERFORMANCE_POINTS));
  const [playerOfTheMatchInput, setPlayerOfTheMatchInput] = useState(() => isFeatureEnabled(teamInfo, FEATURE_KEYS.PLAYER_OF_THE_MATCH));
  const [captainInput, setCaptainInput] = useState(() => isFeatureEnabled(teamInfo, FEATURE_KEYS.CAPTAIN));
  const [minFinisherAttemptsInput, setMinFinisherAttemptsInput] = useState(() => getMinFinisherAttempts(teamInfo));
  const [performanceWeightsInput, setPerformanceWeightsInput] = useState(() => getPerformanceWeights(teamInfo));
  const [defaultVariant, setDefaultVariant] = useState(getDefaultMatchVariant);
  const [teamStatus, setTeamStatus] = useState({ loading: false, success: null, error: null });

  // Team Badge / Logo State
  const [badgeUrlInput, setBadgeUrlInput] = useState(teamInfo?.badge_url || teamInfo?.settings?.badge_url || '');
  const [badgeUploading, setBadgeUploading] = useState(false);
  const badgeFileInputRef = useRef(null);

  // Season Rename & Delete Modal State
  const [editingSeason, setEditingSeason] = useState(null);
  const [editingSeasonName, setEditingSeasonName] = useState('');
  const [editingLeagueName, setEditingLeagueName] = useState('');
  const [editingTimeframe, setEditingTimeframe] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [seasonActionStatus, setSeasonActionStatus] = useState(null);

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

  const showConfirmDialog = ({ title, message, type = 'danger', confirmText = 'Confirm', onConfirm }) => {
    setDialogConfig({
      isOpen: true,
      type,
      isAlert: false,
      title,
      message,
      confirmText,
      cancelText: 'Cancel',
      onConfirm: async () => {
        setDialogConfig(null);
        await onConfirm();
      },
      onCancel: () => setDialogConfig(null)
    });
  };

  // Group teams by name and club
  const groupedTeams = useMemo(() => {
    const map = new Map();
    (allTeams || []).forEach((t) => {
      const key = `${t.club_id || ''}:::${(t.name || '').trim().toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: (t.name || '').trim(),
          club_id: t.club_id,
          seasons: []
        });
      }
      map.get(key).seasons.push(t);
    });
    return Array.from(map.values());
  }, [allTeams]);

  const getMatchCountForSeason = (seasonId) => {
    if (!allSeasonsMatches || allSeasonsMatches.length === 0) return 0;
    return allSeasonsMatches.filter((m) => m.team_id === seasonId).length;
  };

  // RBAC Privileges
  const isDev = isDevAdmin(currentUserProfile);
  const isAdmin = hasAdminPrivileges(currentUserProfile);
  const showDevFeatures = canManageFeatureFlags(currentUserProfile);
  const showClubManager = canManageClubs(currentUserProfile);

  // Settings Tab State: 'preferences' | 'admin' | 'features' | 'users'
  const [settingsTab, setSettingsTab] = useState('preferences');

  // Club Management Modal state
  const [showClubModal, setShowClubModal] = useState(false);

  // Theme selection state
  const [activeTheme, setActiveTheme] = useState(() => currentTheme || getSavedTheme());

  useEffect(() => {
    if (currentTheme) {
      setActiveTheme(currentTheme);
    }
  }, [currentTheme]);

  const handleThemeChange = (newTheme) => {
    setActiveTheme(newTheme);
    applyTheme(newTheme, true);
    if (setCurrentTheme) {
      setCurrentTheme(newTheme);
    }
  };

  // Keep form inputs synced if active team changes
  useEffect(() => {
    if (teamInfo) {
      setTeamNameInput(teamInfo.name || '');
      setSeasonNameInput(teamInfo.season || '');
      setLeagueInput(teamInfo.league || teamInfo.settings?.league || '');
      setTimeframeInput(teamInfo.timeframe || teamInfo.settings?.timeframe || '');
      setBadgeUrlInput(teamInfo.badge_url || teamInfo.settings?.badge_url || '');
      setHidePositionsInput(teamInfo.hide_positions || false);
      setMatchDynamicsInput(isFeatureEnabled(teamInfo, FEATURE_KEYS.MATCH_DYNAMICS));
      setEfficiencyRatingInput(isFeatureEnabled(teamInfo, FEATURE_KEYS.EFFICIENCY_RATING));
      setAttemptsInput(isFeatureEnabled(teamInfo, FEATURE_KEYS.ATTEMPTS));
      setDefensiveContributionsInput(isFeatureEnabled(teamInfo, FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS));
      setPerformancePointsInput(isFeatureEnabled(teamInfo, FEATURE_KEYS.PERFORMANCE_POINTS));
      setPlayerOfTheMatchInput(isFeatureEnabled(teamInfo, FEATURE_KEYS.PLAYER_OF_THE_MATCH));
      setCaptainInput(isFeatureEnabled(teamInfo, FEATURE_KEYS.CAPTAIN));
      setMinFinisherAttemptsInput(getMinFinisherAttempts(teamInfo));
      setPerformanceWeightsInput(getPerformanceWeights(teamInfo));
    }
  }, [teamInfo]);

  // Detected match timeframe for active team
  const detectedActiveTimeframe = useMemo(() => {
    if (!teamInfo?.id || !allSeasonsMatches) return '';
    const seasonMatches = allSeasonsMatches.filter((m) => m.team_id === teamInfo.id);
    return computeSeasonTimeframeFromMatches(seasonMatches);
  }, [teamInfo?.id, allSeasonsMatches]);

  // Detected match timeframe for season currently being edited
  const editingComputedTimeframe = useMemo(() => {
    if (!editingSeason?.id || !allSeasonsMatches) return '';
    const seasonMatches = allSeasonsMatches.filter((m) => m.team_id === editingSeason.id);
    return computeSeasonTimeframeFromMatches(seasonMatches);
  }, [editingSeason?.id, allSeasonsMatches]);

  // Add New Team Form Modal state inside settings
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newSeasonName, setNewSeasonName] = useState('');
  const [newLeagueName, setNewLeagueName] = useState('');
  const [newTimeframe, setNewTimeframe] = useState('');
  const [newTeamClubId, setNewTeamClubId] = useState(() => currentUserProfile?.club_id || (allClubs[0]?.id || ''));
  const [addTeamLoading, setAddTeamLoading] = useState(false);

  const handleUpdateEmail = async (e) => {
    e.preventDefault();
    if (!newEmail) return;
    setEmailStatus({ loading: true, success: null, error: null });
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) throw error;
      setEmailStatus({ loading: false, success: 'Confirmation link sent to your new email address!', error: null });
      setNewEmail('');
    } catch (error) {
      setEmailStatus({ loading: false, success: null, error: error.message });
    }
  };

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (!newPassword) return;
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ loading: false, success: null, error: 'Passwords do not match.' });
      return;
    }
    setPasswordStatus({ loading: true, success: null, error: null });
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordStatus({ loading: false, success: 'Password updated successfully!', error: null });
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      setPasswordStatus({ loading: false, success: null, error: error.message });
    }
  };

  const handleUpdateTeamDetails = async (e) => {
    e.preventDefault();
    if (!teamNameInput || !teamInfo?.id) return;
    setTeamStatus({ loading: true, success: null, error: null });
    try {
      const cleanLeague = leagueInput.trim();
      const cleanTimeframe = timeframeInput.trim();

      const newSettings = {
        ...teamInfo.settings,
        league: cleanLeague,
        timeframe: cleanTimeframe,
        [FEATURE_KEYS.MATCH_DYNAMICS]: matchDynamicsInput,
        [FEATURE_KEYS.EFFICIENCY_RATING]: efficiencyRatingInput,
        [FEATURE_KEYS.ATTEMPTS]: attemptsInput,
        [FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS]: defensiveContributionsInput,
        [FEATURE_KEYS.PERFORMANCE_POINTS]: performancePointsInput,
        [FEATURE_KEYS.PLAYER_OF_THE_MATCH]: playerOfTheMatchInput,
        [FEATURE_KEYS.CAPTAIN]: captainInput,
        min_finisher_attempts: Number(minFinisherAttemptsInput) || DEFAULT_MIN_FINISHER_ATTEMPTS,
        performance_weights: performanceWeightsInput
      };

      // Try updating with settings JSONB and optional columns
      const updatePayload = {
        name: teamNameInput.trim(),
        season: seasonNameInput.trim(),
        league: cleanLeague || null,
        timeframe: cleanTimeframe || null,
        hide_positions: hidePositionsInput,
        settings: newSettings
      };

      let { error } = await supabase
        .from('team')
        .update(updatePayload)
        .eq('id', teamInfo.id);

      // Fallback if league/timeframe column doesn't exist
      if (error && (error.message?.includes('column') || error.code === '42703' || error.code === 'PGRST204')) {
        const { league: _omitL, timeframe: _omitT, ...fallbackWithoutCols } = updatePayload;
        const retry = await supabase.from('team').update(fallbackWithoutCols).eq('id', teamInfo.id);
        error = retry.error;
      }

      // If settings column doesn't exist yet in database, fallback to updating without it
      if (error && (error.message?.includes('settings') || error.code === 'PGRST204')) {
        const retry = await supabase
          .from('team')
          .update({ name: teamNameInput.trim(), season: seasonNameInput.trim(), hide_positions: hidePositionsInput })
          .eq('id', teamInfo.id);
        if (retry.error) throw retry.error;
      } else if (error) {
        throw error;
      }

      setFeatureFlag(teamInfo.id, FEATURE_KEYS.MATCH_DYNAMICS, matchDynamicsInput);
      setFeatureFlag(teamInfo.id, FEATURE_KEYS.EFFICIENCY_RATING, efficiencyRatingInput);
      setFeatureFlag(teamInfo.id, FEATURE_KEYS.ATTEMPTS, attemptsInput);
      setFeatureFlag(teamInfo.id, FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS, defensiveContributionsInput);
      setFeatureFlag(teamInfo.id, FEATURE_KEYS.PERFORMANCE_POINTS, performancePointsInput);
      setFeatureFlag(teamInfo.id, FEATURE_KEYS.PLAYER_OF_THE_MATCH, playerOfTheMatchInput);
      setFeatureFlag(teamInfo.id, FEATURE_KEYS.CAPTAIN, captainInput);
      try {
        localStorage.setItem(`team_min_finisher_${teamInfo.id}`, String(minFinisherAttemptsInput));
        localStorage.setItem(`team_perf_weights_${teamInfo.id}`, JSON.stringify(performanceWeightsInput));
        if (cleanLeague) localStorage.setItem(`team_league_${teamInfo.id}`, cleanLeague);
        if (cleanTimeframe) localStorage.setItem(`team_timeframe_${teamInfo.id}`, cleanTimeframe);
      } catch {
        // fallback
      }

      const updated = {
        ...teamInfo,
        name: teamNameInput.trim(),
        season: seasonNameInput.trim(),
        league: cleanLeague,
        timeframe: cleanTimeframe,
        hide_positions: hidePositionsInput,
        [FEATURE_KEYS.MATCH_DYNAMICS]: matchDynamicsInput,
        [FEATURE_KEYS.EFFICIENCY_RATING]: efficiencyRatingInput,
        [FEATURE_KEYS.ATTEMPTS]: attemptsInput,
        [FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS]: defensiveContributionsInput,
        [FEATURE_KEYS.PERFORMANCE_POINTS]: performancePointsInput,
        [FEATURE_KEYS.PLAYER_OF_THE_MATCH]: playerOfTheMatchInput,
        [FEATURE_KEYS.CAPTAIN]: captainInput,
        settings: newSettings
      };

      setDefaultMatchVariant(defaultVariant);
      setTeamInfo(updated);
      setAllTeams(allTeams.map((t) => (t.id === teamInfo.id ? updated : t)));
      setTeamStatus({ loading: false, success: 'Team details updated successfully!', error: null });
    } catch (error) {
      setTeamStatus({ loading: false, success: null, error: error.message });
    }
  };

  const persistBadgeUrlForTeam = async (newUrl) => {
    if (!teamInfo?.id) return;
    const teamNameKey = (teamInfo.name || '').trim().toLowerCase();
    const clubKey = teamInfo.club_id || null;

    const matchingSeasons = allTeams.filter(
      (t) => (t.name || '').trim().toLowerCase() === teamNameKey && (t.club_id || null) === clubKey
    );
    const targets = matchingSeasons.length > 0 ? matchingSeasons : [teamInfo];

    for (const seasonRow of targets) {
      const updatedSettings = {
        ...seasonRow.settings,
        badge_url: newUrl
      };
      const { error } = await supabase
        .from('team')
        .update({ settings: updatedSettings })
        .eq('id', seasonRow.id);
      if (error && !error.message?.includes('settings') && error.code !== 'PGRST204') {
        throw error;
      }
      try {
        if (newUrl) {
          localStorage.setItem(`team_badge_${seasonRow.id}`, newUrl);
        } else {
          localStorage.removeItem(`team_badge_${seasonRow.id}`);
        }
      } catch {
        // ignore storage errors
      }
    }

    const updatedIds = new Set(targets.map((t) => t.id));
    setAllTeams(
      allTeams.map((t) =>
        updatedIds.has(t.id)
          ? { ...t, badge_url: newUrl, settings: { ...t.settings, badge_url: newUrl } }
          : t
      )
    );
    setTeamInfo((prev) =>
      prev && updatedIds.has(prev.id)
        ? { ...prev, badge_url: newUrl, settings: { ...prev.settings, badge_url: newUrl } }
        : prev
    );
    setBadgeUrlInput(newUrl);
  };

  const handleBadgeFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (badgeFileInputRef.current) {
      badgeFileInputRef.current.value = '';
    }
    if (!file || !teamInfo?.id) return;

    const validation = validateBadgeFile(file);
    if (!validation.valid) {
      showWarningDialog('Invalid Badge Image', validation.error);
      return;
    }

    setBadgeUploading(true);
    try {
      const webpBlob = await resizeImageToWebp(file, 256);
      const publicUrl = await uploadTeamBadge(webpBlob, teamInfo.club_id, teamInfo.name);
      await persistBadgeUrlForTeam(publicUrl);
      setTeamStatus({ loading: false, success: 'Team badge updated!', error: null });
    } catch (err) {
      showWarningDialog('Logo Storage Unavailable', err.message || 'Could not upload team badge.');
    } finally {
      setBadgeUploading(false);
    }
  };

  const handleRemoveBadge = () => {
    if (!teamInfo?.id || !badgeUrlInput) return;
    showConfirmDialog({
      title: 'Remove Team Badge',
      message: `Remove the custom badge for ${teamInfo.name}? The app will revert to the default shield icon.`,
      type: 'danger',
      confirmText: 'Remove Badge',
      onConfirm: async () => {
        setBadgeUploading(true);
        try {
          await deleteTeamBadge(teamInfo.club_id, teamInfo.name);
          await persistBadgeUrlForTeam('');
          setTeamStatus({ loading: false, success: 'Team badge removed.', error: null });
        } catch (err) {
          showWarningDialog('Error Removing Badge', err.message || 'Could not remove team badge.');
        } finally {
          setBadgeUploading(false);
        }
      }
    });
  };

  const handleCreateNewTeam = async (e) => {
    e.preventDefault();
    if (!newTeamName || !newSeasonName) return;
    setAddTeamLoading(true);

    const targetClubId = isDev
      ? (newTeamClubId || (allClubs[0]?.id || null))
      : (currentUserProfile?.club_id || (allClubs[0]?.id || null));

    const cleanLeague = newLeagueName.trim();
    const cleanTimeframe = newTimeframe.trim();

    const newSettings = {
      ...(teamInfo?.settings ? teamInfo.settings : {}),
      ...(cleanLeague ? { league: cleanLeague } : {}),
      ...(cleanTimeframe ? { timeframe: cleanTimeframe } : {})
    };

    const newTeamObj = {
      user_id: session.user.id,
      name: newTeamName.trim(),
      season: newSeasonName.trim(),
      league: cleanLeague || null,
      timeframe: cleanTimeframe || null,
      club_id: targetClubId,
      hide_positions: false,
      settings: newSettings
    };

    let { data, error } = await supabase.from('team').insert([newTeamObj]).select().single();

    if (error && (error.message?.includes('column') || error.code === '42703' || error.code === 'PGRST204')) {
      const { league: _omitL, timeframe: _omitT, ...fallbackWithoutCols } = newTeamObj;
      const retry = await supabase.from('team').insert([fallbackWithoutCols]).select().single();
      data = retry.data;
      error = retry.error;
    }

    if (error && (error.message?.includes('settings') || error.code === 'PGRST204')) {
      const { settings: _omitSettings, league: _omitL, timeframe: _omitT, ...fallbackTeamObj } = newTeamObj;
      const retry = await supabase.from('team').insert([fallbackTeamObj]).select().single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      showWarningDialog('Error Adding Team', error.message);
      setAddTeamLoading(false);
      return;
    }

    if (data) {
      try {
        if (cleanLeague) localStorage.setItem(`team_league_${data.id}`, cleanLeague);
        if (cleanTimeframe) localStorage.setItem(`team_timeframe_${data.id}`, cleanTimeframe);
      } catch {}

      const enriched = {
        ...data,
        league: cleanLeague || data.league || data.settings?.league || '',
        timeframe: cleanTimeframe || data.timeframe || data.settings?.timeframe || '',
        ...getTeamFeatures(data)
      };

      // Also automatically assign creator to this team in user_team_assignments
      if (currentUserProfile?.id) {
        await supabase.from('user_team_assignments').insert([
          { user_profile_id: currentUserProfile.id, team_id: data.id }
        ]);
      }

      setAllTeams([enriched, ...allTeams]);
      setTeamInfo(enriched);
      setShowAddTeamModal(false);
      setNewTeamName('');
      setNewSeasonName('');
      setNewLeagueName('');
      setNewTimeframe('');
    }
    setAddTeamLoading(false);
  };

  const handleSaveEditSeason = async (e) => {
    e.preventDefault();
    if (!editingSeason?.id || !editingSeasonName.trim()) return;
    const cleanName = editingSeasonName.trim();
    const cleanLeague = editingLeagueName.trim();
    const cleanTimeframe = editingTimeframe.trim();
    setRenameLoading(true);
    try {
      const updatedSettings = {
        ...editingSeason.settings,
        league: cleanLeague,
        timeframe: cleanTimeframe
      };

      const updatePayload = {
        season: cleanName,
        league: cleanLeague || null,
        timeframe: cleanTimeframe || null,
        settings: updatedSettings
      };

      let { error } = await supabase
        .from('team')
        .update(updatePayload)
        .eq('id', editingSeason.id);

      if (error && (error.message?.includes('column') || error.code === '42703' || error.code === 'PGRST204')) {
        const { league: _omitL, timeframe: _omitT, ...fallbackWithoutCols } = updatePayload;
        const retry = await supabase.from('team').update(fallbackWithoutCols).eq('id', editingSeason.id);
        error = retry.error;
      }

      if (error && (error.message?.includes('settings') || error.code === 'PGRST204')) {
        const retry = await supabase
          .from('team')
          .update({ season: cleanName })
          .eq('id', editingSeason.id);
        if (retry.error) throw retry.error;
      } else if (error) {
        throw error;
      }

      try {
        if (cleanLeague) localStorage.setItem(`team_league_${editingSeason.id}`, cleanLeague);
        if (cleanTimeframe) localStorage.setItem(`team_timeframe_${editingSeason.id}`, cleanTimeframe);
      } catch {}

      const updatedTeams = allTeams.map((t) =>
        t.id === editingSeason.id
          ? {
              ...t,
              season: cleanName,
              league: cleanLeague,
              timeframe: cleanTimeframe,
              settings: updatedSettings
            }
          : t
      );
      setAllTeams(updatedTeams);

      if (teamInfo?.id === editingSeason.id) {
        const updatedInfo = {
          ...teamInfo,
          season: cleanName,
          league: cleanLeague,
          timeframe: cleanTimeframe,
          settings: updatedSettings
        };
        setTeamInfo(updatedInfo);
        setSeasonNameInput(cleanName);
        setLeagueInput(cleanLeague);
        setTimeframeInput(cleanTimeframe);
      }

      setEditingSeason(null);
      setEditingSeasonName('');
      setEditingLeagueName('');
      setEditingTimeframe('');
      setSeasonActionStatus({ success: `Season details for "${cleanName}" updated successfully!`, error: null });
      setTimeout(() => setSeasonActionStatus(null), 4000);
    } catch (err) {
      setSeasonActionStatus({ success: null, error: `Error saving season details: ${err.message}` });
    } finally {
      setRenameLoading(false);
    }
  };

  const handleDeleteSeason = async (seasonToDelete, teamName) => {
    if (!seasonToDelete?.id) return;

    if (allTeams.length <= 1) {
      showWarningDialog(
        'Cannot Delete Season',
        'This is the only team and season in the system. At least one active season must remain.'
      );
      return;
    }

    const clientCount = getMatchCountForSeason(seasonToDelete.id);
    if (clientCount > 0) {
      showWarningDialog(
        'Season Has Recorded Matches',
        `Cannot delete season "${seasonToDelete.season || 'Active'}" because it contains ${clientCount} recorded match(es). To delete this season, its matches must be removed first.`
      );
      return;
    }

    try {
      // Authoritative database check
      const { count, error: countErr } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', seasonToDelete.id);

      if (countErr) throw countErr;
      if (count && count > 0) {
        showWarningDialog(
          'Season Has Recorded Matches',
          `Cannot delete season "${seasonToDelete.season || 'Active'}" because it contains ${count} recorded match(es). To delete this season, its matches must be removed first.`
        );
        return;
      }

      showConfirmDialog({
        title: 'Delete Season',
        message: `Are you sure you want to delete season "${seasonToDelete.season || 'Active'}" for team "${teamName}"? This season has no recorded matches and will be permanently removed.`,
        type: 'danger',
        confirmText: 'Delete Season',
        onConfirm: async () => {
          try {
            // Clean up empty squad and assignments for this season
            await supabase.from('squad').delete().eq('team_id', seasonToDelete.id);
            await supabase.from('user_team_assignments').delete().eq('team_id', seasonToDelete.id);
            const { error: delErr } = await supabase.from('team').delete().eq('id', seasonToDelete.id);
            if (delErr) throw delErr;

            const remainingTeams = allTeams.filter((t) => t.id !== seasonToDelete.id);
            setAllTeams(remainingTeams);

            // If active team was deleted, switch to another season of the same team, or the next available team
            if (teamInfo?.id === seasonToDelete.id) {
              const sameTeamAlt = remainingTeams.find(
                (t) => (t.name || '').trim().toLowerCase() === (teamName || '').trim().toLowerCase()
              );
              const nextActive = sameTeamAlt || remainingTeams[0];
              if (nextActive && onSelectTeam) {
                onSelectTeam(nextActive);
              }
            }

            setSeasonActionStatus({ success: `Season "${seasonToDelete.season || 'Active'}" deleted successfully.`, error: null });
            setTimeout(() => setSeasonActionStatus(null), 4000);
          } catch (delError) {
            showWarningDialog('Error Deleting Season', `Failed to delete season: ${delError.message}`);
          }
        }
      });
    } catch (err) {
      showWarningDialog('Error Checking Season', `Could not verify match count: ${err.message}`);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const activeClub = allClubs.find((c) => c.id === teamInfo?.club_id);

  return (
    <div className="app-container app-view-settings">
      <TopNav
        title="Settings"
        onBack={() => setCurrentView('matches')}
        currentView="settings"
        setCurrentView={setCurrentView}
        teamInfo={teamInfo}
        allTeams={allTeams}
        allClubs={allClubs}
        currentUserProfile={currentUserProfile}
      />

      <div className="view-container">
        {/* Navigation Options List (Only rendered if user has Admin privileges) */}
        {isAdmin && (
          <div className="card mb-4" style={{ padding: '0.6rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0.4rem 0.6rem 0.5rem 0.6rem' }}>
              Settings Sections
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {[
                {
                  id: 'preferences',
                  label: 'Preferences',
                  desc: 'Color theme, match format default & account details',
                  icon: Sliders
                },
                {
                  id: 'admin',
                  label: 'Team Settings',
                  desc: 'Team profiles, squad positions & club seasons',
                  icon: Shield
                },
                {
                  id: 'users',
                  label: 'User Management',
                  desc: 'Coaches, access roles, team assignments & invitations',
                  icon: Users
                },
                ...(showDevFeatures
                  ? [
                    {
                      id: 'features',
                      label: 'Feature Switches',
                      desc: 'Dev Admin analytics switches & dynamic metrics',
                      icon: ToggleLeft
                    }
                  ]
                  : [])
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = settingsTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSettingsTab(tab.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.7rem 0.85rem',
                      borderRadius: 'var(--radius-lg)',
                      border: '1px solid',
                      borderColor: isActive ? 'var(--color-primary)' : 'transparent',
                      background: isActive ? 'var(--color-primary-light)' : 'transparent',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div
                        style={{
                          width: '34px',
                          height: '34px',
                          borderRadius: 'var(--radius-md)',
                          background: isActive ? 'var(--color-primary)' : 'var(--color-border-light)',
                          color: isActive ? 'white' : 'var(--color-text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}
                      >
                        <Icon size={17} />
                      </div>
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: '0.9rem',
                            color: isActive ? 'var(--color-primary-dark)' : 'var(--color-text-main)'
                          }}
                        >
                          {tab.label}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>
                          {tab.desc}
                        </div>
                      </div>
                    </div>
                    {isActive && (
                      <span className="badge badge-primary" style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                        Active
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= PREFERENCES TAB ================= */}
        {(!isAdmin || settingsTab === 'preferences') && (
          <>
            {/* App Appearance & Color Theme */}
            <div className="card">
              <div className="flex-between mb-2">
                <h2 className="title-md flex-row gap-2" style={{ margin: 0 }}>
                  <Palette size={18} color="var(--color-primary)" /> App Appearance &amp; Color Theme
                </h2>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Choose your preferred color theme. The entire interface updates immediately.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                {Object.values(THEME_CONFIGS).map((theme) => {
                  const isSelected = activeTheme === theme.id;
                  return (
                    <div
                      key={theme.id}
                      onClick={() => handleThemeChange(theme.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleThemeChange(theme.id);
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.85rem 1rem',
                        borderRadius: 'var(--radius-lg)',
                        border: '2px solid',
                        borderColor: isSelected ? 'var(--color-primary)' : 'var(--color-border)',
                        background: isSelected ? 'var(--color-primary-light)' : 'var(--color-bg-card)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            background: `linear-gradient(135deg, ${theme.primaryColor} 0%, ${theme.darkColor} 100%)`,
                            boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                            border: '2px solid white',
                            flexShrink: 0
                          }}
                        />
                        <div>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: '0.95rem',
                              color: isSelected ? 'var(--color-primary-dark)' : 'var(--color-text-main)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.4rem'
                            }}
                          >
                            {theme.name}
                            {isSelected && <Check size={14} color="var(--color-primary)" />}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            {theme.description}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Default Match Format Preference */}
            <div className="card mt-4">
              <div className="flex-between mb-2">
                <h2 className="title-md flex-row gap-2" style={{ margin: 0 }}>
                  <Calendar size={18} color="var(--color-primary)" /> Default Match Format
                </h2>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Select the pre-selected match variant when scheduling new matches.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                {Object.entries(MATCH_VARIANTS).map(([key, variant]) => {
                  const isSelected = defaultVariant === key;
                  return (
                    <div
                      key={key}
                      onClick={() => {
                        setDefaultVariant(key);
                        setDefaultMatchVariant(key);
                      }}
                      role="button"
                      tabIndex={0}
                      style={{
                        padding: '0.85rem 1rem',
                        borderRadius: 'var(--radius-lg)',
                        border: '2px solid',
                        borderColor: isSelected ? 'var(--color-primary)' : 'var(--color-border)',
                        background: isSelected ? 'var(--color-primary-light)' : 'var(--color-bg-card)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', color: isSelected ? 'var(--color-primary-dark)' : 'var(--color-text-main)' }}>
                          {variant.label}
                        </div>
                        {isSelected && <Check size={16} color="var(--color-primary)" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Change Email */}
            <div className="card mt-4">
              <h2 className="title-md flex-row gap-2 mb-2">
                <Mail size={18} /> Update Email Address
              </h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Current Email: <strong>{session?.user?.email}</strong>
              </p>
              <form onSubmit={handleUpdateEmail}>
                <div className="input-group">
                  <label className="label">New Email Address</label>
                  <input
                    type="email"
                    required
                    className="input"
                    placeholder="new-email@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </div>
                {emailStatus.error && <div className="alert alert-danger">{emailStatus.error}</div>}
                {emailStatus.success && <div className="alert alert-success">{emailStatus.success}</div>}
                <button type="submit" disabled={emailStatus.loading} className="btn btn-primary mt-2">
                  {emailStatus.loading ? 'Updating...' : 'Send Confirmation Email'}
                </button>
              </form>
            </div>

            {/* Change Password */}
            <div className="card mt-4">
              <h2 className="title-md flex-row gap-2 mb-2">
                <Lock size={18} /> Update Password
              </h2>
              <form onSubmit={handleUpdatePassword}>
                <div className="input-group">
                  <label className="label">New Password</label>
                  <input
                    type="password"
                    required
                    className="input"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="input-group">
                  <label className="label">Confirm New Password</label>
                  <input
                    type="password"
                    required
                    className="input"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                {passwordStatus.error && <div className="alert alert-danger">{passwordStatus.error}</div>}
                {passwordStatus.success && <div className="alert alert-success">{passwordStatus.success}</div>}
                <button type="submit" disabled={passwordStatus.loading} className="btn btn-primary mt-2">
                  {passwordStatus.loading ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            </div>

            {/* Account Session & Sign Out */}
            <div className="card mt-4">
              <h2 className="title-md flex-row gap-2 mb-2">
                <User size={18} /> Account Session
              </h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                Signed in as <strong>{session?.user?.email}</strong>
              </p>
              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Role: <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{currentUserProfile?.role || 'Normal User'}</span>
                {activeClub && <span> • Club: <strong>{activeClub.name}</strong></span>}
              </div>
              <button onClick={handleSignOut} className="btn btn-secondary" style={{ color: 'var(--color-danger)' }}>
                <LogOut size={18} /> Sign Out
              </button>
            </div>
          </>
        )}

        {/* ================= TEAM SETTINGS TAB ================= */}
        {isAdmin && settingsTab === 'admin' && (
          <>
            <div className="card">
              <div className="flex-between mb-2" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <h2 className="title-md flex-row gap-2" style={{ margin: 0 }}>
                  <Edit3 size={18} color="var(--color-primary)" /> Team Profile &amp; Squad Settings
                </h2>
                {showClubManager && (
                  <button
                    type="button"
                    onClick={() => setShowClubModal(true)}
                    className="btn btn-secondary flex-row gap-1"
                    style={{ width: 'auto', fontSize: '0.78rem', padding: '0.35rem 0.7rem', whiteSpace: 'nowrap' }}
                  >
                    <Building2 size={14} /> Manage Clubs
                  </button>
                )}
              </div>

              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Active Club: <strong>{activeClub?.name || 'Tower Hill FC'}</strong>
                {activeClub?.location && ` (${activeClub.location})`}
              </p>

              {/* Team Badge / Logo Upload */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  padding: '0.85rem 1rem',
                  background: 'var(--color-border-light)',
                  borderRadius: 'var(--radius-lg)',
                  marginBottom: '1.15rem',
                  flexWrap: 'wrap'
                }}
              >
                <div
                  style={{
                    width: '72px',
                    height: '72px',
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    overflow: 'hidden',
                    padding: '6px'
                  }}
                >
                  <TeamBadge url={badgeUrlInput} size={56} />
                </div>

                <div style={{ flex: 1, minWidth: '180px' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.2rem' }}>
                    Team Badge / Logo
                  </div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--color-text-muted)', marginBottom: '0.55rem' }}>
                    PNG, JPG, WebP or SVG — max 2 MB (resized to 256×256 WebP). Applies to all seasons of {teamInfo?.name}.
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input
                      ref={badgeFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={handleBadgeFileSelect}
                      style={{ display: 'none' }}
                    />
                    <button
                      type="button"
                      onClick={() => badgeFileInputRef.current?.click()}
                      disabled={badgeUploading}
                      className="btn btn-secondary flex-row gap-1"
                      style={{ width: 'auto', fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                    >
                      <Upload size={13} />
                      {badgeUploading ? 'Uploading...' : badgeUrlInput ? 'Replace Logo' : 'Upload Logo'}
                    </button>

                    {badgeUrlInput && (
                      <button
                        type="button"
                        onClick={handleRemoveBadge}
                        disabled={badgeUploading}
                        className="btn btn-secondary flex-row gap-1"
                        style={{ width: 'auto', fontSize: '0.78rem', padding: '0.35rem 0.75rem', color: 'var(--color-danger)' }}
                      >
                        <Trash2 size={13} /> Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <form onSubmit={handleUpdateTeamDetails}>
                <div className="input-group">
                  <label className="label">Team / Sub-team Name</label>
                  <input
                    type="text"
                    className="input"
                    value={teamNameInput}
                    onChange={(e) => setTeamNameInput(e.target.value)}
                    required
                  />
                </div>

                <div className="input-group">
                  <label className="label">Season *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. 2026/27"
                    value={seasonNameInput}
                    onChange={(e) => setSeasonNameInput(e.target.value)}
                    required
                  />
                </div>

                <div className="input-group">
                  <label className="label">League / Competition (optional)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Autumn League, Spring League"
                    value={leagueInput}
                    onChange={(e) => setLeagueInput(e.target.value)}
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.2rem', display: 'block' }}>
                    Helps separate sub-seasons (e.g. Autumn League, Spring League) under the same team.
                  </span>
                </div>

                <div className="input-group">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <label className="label" style={{ marginBottom: 0 }}>Season Timeframe / Dates (optional)</label>
                    {detectedActiveTimeframe && (
                      <button
                        type="button"
                        onClick={() => setTimeframeInput(detectedActiveTimeframe)}
                        className="btn-link"
                        style={{ fontSize: '0.72rem', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        Auto-fill from match dates ({detectedActiveTimeframe})
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. September 2026 – December 2026"
                    value={timeframeInput}
                    onChange={(e) => setTimeframeInput(e.target.value)}
                    style={{ marginTop: '0.25rem' }}
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.2rem', display: 'block' }}>
                    The scheduled months or date range for this season.
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem 1rem',
                    background: 'var(--color-border-light)',
                    borderRadius: 'var(--radius-lg)',
                    marginBottom: '1rem'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Hide Positions</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      Don't require or display positions in squad and match breakdowns
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHidePositionsInput((v) => !v)}
                    style={{
                      width: '3rem',
                      height: '1.75rem',
                      borderRadius: '999px',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                      background: hidePositionsInput ? 'var(--color-primary)' : 'var(--color-border)',
                      position: 'relative',
                      flexShrink: 0
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: '0.2rem',
                        left: hidePositionsInput ? 'calc(100% - 1.35rem)' : '0.2rem',
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

                {/* Clinical Finisher Threshold (Only visible when Attempts feature is active) */}
                {attemptsInput && (
                  <div className="input-group" style={{ marginBottom: '1rem' }}>
                    <label className="label">Clinical Finisher Min Attempts</label>
                    <input
                      type="number"
                      min="1"
                      max="50"
                      className="input"
                      value={minFinisherAttemptsInput}
                      onChange={(e) => setMinFinisherAttemptsInput(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    />
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem', display: 'block' }}>
                      Minimum attempts on goal required to qualify for the Clinical Finisher honour (default: 3).
                    </span>
                  </div>
                )}

                {teamStatus.error && <div className="alert alert-danger">{teamStatus.error}</div>}
                {teamStatus.success && <div className="alert alert-success">{teamStatus.success}</div>}

                <button type="submit" disabled={teamStatus.loading} className="btn btn-primary mt-2">
                  {teamStatus.loading ? 'Updating...' : 'Save Team Details'}
                </button>
              </form>
            </div>

            {/* Teams & Seasons in Club */}
            <div className="card mt-4">
              <div className="flex-between mb-2" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <h2 className="title-md flex-row gap-2" style={{ margin: 0 }}>
                  <Shield size={18} color="var(--color-secondary)" /> Teams &amp; Seasons in Club
                </h2>
                <button
                  onClick={onAddNewTeam ? () => onAddNewTeam('') : (() => {
                    setNewTeamName('');
                    setNewSeasonName('');
                    setShowAddTeamModal(true);
                  })}
                  className="btn btn-secondary"
                  style={{ width: 'auto', padding: '0.4rem 0.75rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                >
                  <Plus size={14} /> Add Team / Season
                </button>
              </div>

              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Seasons are grouped by team. Switch active season, rename seasons, or remove seasons with no recorded data.
              </p>

              {seasonActionStatus?.error && (
                <div className="alert alert-danger mb-3 flex-row gap-2" style={{ alignItems: 'flex-start' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <span>{seasonActionStatus.error}</span>
                </div>
              )}

              {seasonActionStatus?.success && (
                <div className="alert alert-success mb-3 flex-row gap-2" style={{ alignItems: 'flex-start' }}>
                  <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <span>{seasonActionStatus.success}</span>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {groupedTeams.map((group) => {
                  const isCurrentTeam = group.seasons.some((s) => s.id === teamInfo?.id);
                  const tClub = allClubs.find((c) => c.id === group.club_id);
                  const groupBadgeUrl = group.seasons.find((s) => s.badge_url || s.settings?.badge_url)?.badge_url
                    || group.seasons.find((s) => s.settings?.badge_url)?.settings?.badge_url
                    || '';

                  return (
                    <div
                      key={group.key}
                      style={{
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-xl)',
                        background: 'var(--color-bg-card)',
                        overflow: 'hidden',
                        boxShadow: 'var(--shadow-sm)'
                      }}
                    >
                      {/* Team Header */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.75rem 1rem',
                          background: isCurrentTeam ? 'rgba(2, 132, 199, 0.08)' : 'var(--color-border-light)',
                          borderBottom: '1px solid var(--color-border)',
                          flexWrap: 'wrap',
                          gap: '0.5rem'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: 'var(--radius-md)',
                              background: groupBadgeUrl ? 'var(--color-bg-card)' : (isCurrentTeam ? 'var(--color-primary)' : 'var(--color-text-muted)'),
                              border: groupBadgeUrl ? '1px solid var(--color-border)' : 'none',
                              color: 'white',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              overflow: 'hidden',
                              padding: groupBadgeUrl ? '2px' : 0
                            }}
                          >
                            <TeamBadge url={groupBadgeUrl} size={groupBadgeUrl ? 26 : 16} color="white" />
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: isCurrentTeam ? 'var(--color-primary-dark)' : 'var(--color-text-main)' }}>
                              {group.name}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                              {group.seasons.length} {group.seasons.length === 1 ? 'Season' : 'Seasons'} {tClub ? `• ${tClub.name}` : ''}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (onAddNewTeam) {
                              onAddNewTeam(group.name);
                            } else {
                              setNewTeamName(group.name);
                              setNewSeasonName('');
                              setShowAddTeamModal(true);
                            }
                          }}
                          className="btn btn-secondary"
                          style={{ width: 'auto', padding: '0.3rem 0.65rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                          title={`Add a new season to ${group.name}`}
                        >
                          <Plus size={13} /> Add Season
                        </button>
                      </div>

                      {/* Seasons List */}
                      <div style={{ padding: '0.4rem' }}>
                        {group.seasons.map((s) => {
                          const isActive = s.id === teamInfo?.id;
                          const matchCount = getMatchCountForSeason(s.id);

                          return (
                            <div
                              key={s.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '0.65rem 0.85rem',
                                borderRadius: 'var(--radius-md)',
                                margin: '0.2rem 0',
                                border: '1px solid',
                                borderColor: isActive ? 'var(--color-primary)' : 'transparent',
                                background: isActive ? 'var(--color-primary-light)' : 'transparent',
                                flexWrap: 'wrap',
                                gap: '0.5rem'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: '160px' }}>
                                <Calendar size={15} style={{ color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)', flexShrink: 0 }} />
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: isActive ? 'var(--color-primary-dark)' : 'var(--color-text-main)' }}>
                                      {s.season || 'Active Season'}
                                    </span>
                                    {s.league && (
                                      <span
                                        className="badge"
                                        style={{
                                          fontSize: '0.68rem',
                                          padding: '0.1rem 0.45rem',
                                          background: isActive ? 'var(--color-primary-light)' : 'var(--color-border-light)',
                                          color: isActive ? 'var(--color-primary-dark)' : 'var(--color-text-main)',
                                          fontWeight: 600,
                                          border: '1px solid var(--color-border)'
                                        }}
                                      >
                                        {s.league}
                                      </span>
                                    )}
                                    {isActive && (
                                      <span className="badge badge-primary flex-row gap-1" style={{ fontSize: '0.65rem', padding: '0.15rem 0.45rem' }}>
                                        <Check size={10} /> Active
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                    {(s.timeframe || getEffectiveTimeframe(s, allSeasonsMatches.filter((m) => m.team_id === s.id))) && (
                                      <span>
                                        {s.timeframe || getEffectiveTimeframe(s, allSeasonsMatches.filter((m) => m.team_id === s.id))}
                                        <span style={{ margin: '0 0.35rem', opacity: 0.5 }}>•</span>
                                      </span>
                                    )}
                                    {matchCount > 0 ? (
                                      <span style={{ color: 'var(--color-primary-dark)', fontWeight: 500 }}>{matchCount} {matchCount === 1 ? 'match recorded' : 'matches recorded'}</span>
                                    ) : (
                                      <span style={{ fontStyle: 'italic', opacity: 0.8 }}>No matches recorded (can delete)</span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
                                {!isActive && (
                                  <button
                                    type="button"
                                    onClick={() => onSelectTeam(s)}
                                    className="btn btn-secondary"
                                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', width: 'auto' }}
                                  >
                                    Select
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSeason(s);
                                    setEditingSeasonName(s.season || '');
                                    setEditingLeagueName(s.league || s.settings?.league || '');
                                    setEditingTimeframe(s.timeframe || s.settings?.timeframe || '');
                                  }}
                                  className="btn-icon-subtle"
                                  title="Edit season details"
                                  style={{ padding: '0.35rem' }}
                                >
                                  <Edit2 size={14} />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteSeason(s, group.name)}
                                  className="btn-icon-subtle"
                                  disabled={matchCount > 0}
                                  title={
                                    matchCount > 0
                                      ? `Cannot delete: season has ${matchCount} recorded match(es)`
                                      : 'Delete unused season'
                                  }
                                  style={{
                                    padding: '0.35rem',
                                    color: matchCount > 0 ? 'var(--color-text-muted)' : 'var(--color-danger)',
                                    opacity: matchCount > 0 ? 0.35 : 1,
                                    cursor: matchCount > 0 ? 'not-allowed' : 'pointer'
                                  }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {showAddTeamModal && (
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
                  <h3 className="title-sm mb-2">Add New Team / Season</h3>
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
                    </div>
                    {isDev && allClubs.length > 1 && (
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
                    <div className="flex-row gap-2 mt-2">
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
              )}
            </div>
          </>
        )}

        {/* ================= USER MANAGEMENT TAB ================= */}
        {isAdmin && settingsTab === 'users' && (
          <UserManagementTab
            currentUserProfile={currentUserProfile}
            session={session}
            allClubs={allClubs}
            allTeams={allTeams}
          />
        )}

        {/* ================= DEV FEATURE SWITCHES TAB ================= */}
        {showDevFeatures && settingsTab === 'features' && (
          <div className="card">
            <h2 className="title-md flex-row gap-2 mb-2">
              <ToggleLeft size={18} color="var(--color-primary)" /> Dev Admin: Analytics &amp; Feature Switches
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
              These switches are globally controlled by Dev Admin and configure advanced analytical modules per team profile.
            </p>

            <form onSubmit={handleUpdateTeamDetails}>
              {/* Match Dynamics & Milestones Switch */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  background: 'var(--color-border-light)',
                  borderRadius: 'var(--radius-lg)',
                  marginBottom: '0.75rem'
                }}
              >
                <div style={{ paddingRight: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Match Dynamics &amp; Milestones</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Display goal dynamics, opening goal records, distributor honours, and scoring milestone cards
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMatchDynamicsInput((v) => !v)}
                  style={{
                    width: '3rem',
                    height: '1.75rem',
                    borderRadius: '999px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                    background: matchDynamicsInput ? 'var(--color-primary)' : 'var(--color-border)',
                    position: 'relative',
                    flexShrink: 0
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '0.2rem',
                      left: matchDynamicsInput ? 'calc(100% - 1.35rem)' : '0.2rem',
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

              {/* Player Efficiency Rating Switch */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  background: 'var(--color-border-light)',
                  borderRadius: 'var(--radius-lg)',
                  marginBottom: '0.75rem'
                }}
              >
                <div style={{ paddingRight: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Player Efficiency Rating (Eff %)</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Display match involvement consistency % in the Squad Breakdown and the Ever-Reliable honour
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEfficiencyRatingInput((v) => !v)}
                  style={{
                    width: '3rem',
                    height: '1.75rem',
                    borderRadius: '999px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                    background: efficiencyRatingInput ? 'var(--color-primary)' : 'var(--color-border)',
                    position: 'relative',
                    flexShrink: 0
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '0.2rem',
                      left: efficiencyRatingInput ? 'calc(100% - 1.35rem)' : '0.2rem',
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

              {/* Attempts at Goal Switch */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  background: 'var(--color-border-light)',
                  borderRadius: 'var(--radius-lg)',
                  marginBottom: '0.75rem'
                }}
              >
                <div style={{ paddingRight: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Attempts at Goal</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Track shots and attempts per player during matches; scoring a goal automatically adds an attempt
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAttemptsInput((v) => !v)}
                  style={{
                    width: '3rem',
                    height: '1.75rem',
                    borderRadius: '999px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                    background: attemptsInput ? 'var(--color-primary)' : 'var(--color-border)',
                    position: 'relative',
                    flexShrink: 0
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '0.2rem',
                      left: attemptsInput ? 'calc(100% - 1.35rem)' : '0.2rem',
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

              {/* Defensive Contributions (DC) Switch */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  background: 'var(--color-border-light)',
                  borderRadius: 'var(--radius-lg)',
                  marginBottom: '0.75rem'
                }}
              >
                <div style={{ paddingRight: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Defensive Contributions (DC)</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Track tackles, interceptions, blocks, and clearances under defensive contributions in match counters and charts
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDefensiveContributionsInput((v) => !v)}
                  style={{
                    width: '3rem',
                    height: '1.75rem',
                    borderRadius: '999px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                    background: defensiveContributionsInput ? 'var(--color-primary)' : 'var(--color-border)',
                    position: 'relative',
                    flexShrink: 0
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '0.2rem',
                      left: defensiveContributionsInput ? 'calc(100% - 1.35rem)' : '0.2rem',
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

              {/* Player of the Match Switch */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  background: 'var(--color-border-light)',
                  borderRadius: 'var(--radius-lg)',
                  marginBottom: '0.75rem'
                }}
              >
                <div style={{ paddingRight: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Player of the Match</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Allow selecting a standout Player of the Match on the match tracker and displaying it on match reports
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPlayerOfTheMatchInput((v) => !v)}
                  style={{
                    width: '3rem',
                    height: '1.75rem',
                    borderRadius: '999px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                    background: playerOfTheMatchInput ? 'var(--color-primary)' : 'var(--color-border)',
                    position: 'relative',
                    flexShrink: 0
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '0.2rem',
                      left: playerOfTheMatchInput ? 'calc(100% - 1.35rem)' : '0.2rem',
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

              {/* Captain Selection Switch */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  background: 'var(--color-border-light)',
                  borderRadius: 'var(--radius-lg)',
                  marginBottom: '0.75rem'
                }}
              >
                <div style={{ paddingRight: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Captain Selection</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Select a match captain and display a captain&apos;s armband (C) icon next to their name on the tracker
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCaptainInput((v) => !v)}
                  style={{
                    width: '3rem',
                    height: '1.75rem',
                    borderRadius: '999px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                    background: captainInput ? 'var(--color-primary)' : 'var(--color-border)',
                    position: 'relative',
                    flexShrink: 0
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '0.2rem',
                      left: captainInput ? 'calc(100% - 1.35rem)' : '0.2rem',
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

              {/* Player Performance Rating (Points) Switch */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  background: 'var(--color-border-light)',
                  borderRadius: 'var(--radius-lg)',
                  marginBottom: '1rem'
                }}
              >
                <div style={{ paddingRight: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>Player Performance Rating (Points)</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    Calculate a balanced match impact score weighting goals, assists, clean sheets, saves, and defensive contributions
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPerformancePointsInput((v) => !v)}
                  style={{
                    width: '3rem',
                    height: '1.75rem',
                    borderRadius: '999px',
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                    background: performancePointsInput ? 'var(--color-primary)' : 'var(--color-border)',
                    position: 'relative',
                    flexShrink: 0
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '0.2rem',
                      left: performancePointsInput ? 'calc(100% - 1.35rem)' : '0.2rem',
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

              {/* Dev Admin Point Weights Panel (Only visible when feature is enabled) */}
              {performancePointsInput && (
                <div
                  style={{
                    padding: '1rem',
                    background: 'var(--color-bg-body)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--color-border)',
                    marginBottom: '1rem'
                  }}
                >
                  <div className="flex-between mb-2" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      Performance Point Weights
                    </div>
                    <button
                      type="button"
                      onClick={() => setPerformanceWeightsInput({ ...DEFAULT_PERFORMANCE_WEIGHTS })}
                      className="btn btn-secondary"
                      style={{ width: 'auto', padding: '0.25rem 0.6rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                    >
                      Reset Defaults
                    </button>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
                    Customize the impact points awarded per match event.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
                    <div className="input-group" style={{ margin: 0 }}>
                      <label className="label" style={{ fontSize: '0.75rem' }}>Goal</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        className="input"
                        value={performanceWeightsInput.goal}
                        onChange={(e) => setPerformanceWeightsInput((prev) => ({ ...prev, goal: parseFloat(e.target.value) || 0 }))}
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                      />
                    </div>
                    <div className="input-group" style={{ margin: 0 }}>
                      <label className="label" style={{ fontSize: '0.75rem' }}>Assist</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        className="input"
                        value={performanceWeightsInput.assist}
                        onChange={(e) => setPerformanceWeightsInput((prev) => ({ ...prev, assist: parseFloat(e.target.value) || 0 }))}
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                      />
                    </div>
                    <div className="input-group" style={{ margin: 0 }}>
                      <label className="label" style={{ fontSize: '0.75rem' }}>Clean Sheet</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        className="input"
                        value={performanceWeightsInput.cleanSheet}
                        onChange={(e) => setPerformanceWeightsInput((prev) => ({ ...prev, cleanSheet: parseFloat(e.target.value) || 0 }))}
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                      />
                    </div>
                    <div className="input-group" style={{ margin: 0 }}>
                      <label className="label" style={{ fontSize: '0.75rem' }}>Save</label>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        className="input"
                        value={performanceWeightsInput.save}
                        onChange={(e) => setPerformanceWeightsInput((prev) => ({ ...prev, save: parseFloat(e.target.value) || 0 }))}
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                      />
                    </div>
                    <div className="input-group" style={{ margin: 0 }}>
                      <label className="label" style={{ fontSize: '0.75rem' }}>DefCon (DC)</label>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        className="input"
                        value={performanceWeightsInput.defcon}
                        onChange={(e) => setPerformanceWeightsInput((prev) => ({ ...prev, defcon: parseFloat(e.target.value) || 0 }))}
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {teamStatus.error && <div className="alert alert-danger">{teamStatus.error}</div>}
              {teamStatus.success && <div className="alert alert-success">{teamStatus.success}</div>}

              <button type="submit" disabled={teamStatus.loading} className="btn btn-primary mt-2">
                {teamStatus.loading ? 'Updating...' : 'Save Feature Switches'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Dev Admin Club Management Modal */}
      {showClubModal && (
        <ClubManagementModal
          isOpen={showClubModal}
          onClose={() => setShowClubModal(false)}
          allClubs={allClubs}
          allTeams={allTeams}
          onClubsUpdated={setAllClubs}
        />
      )}

      {/* Edit Season Details Modal */}
      {editingSeason && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <div className="flex-between mb-3">
              <h3 className="title-sm" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Edit2 size={16} style={{ color: 'var(--color-primary)' }} />
                Edit Season Details
              </h3>
              <button className="btn-icon" onClick={() => setEditingSeason(null)}>
                <X size={16} />
              </button>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              Edit season, league, and timeframe for <strong>{editingSeason.name}</strong>.
            </p>

            <form onSubmit={handleSaveEditSeason}>
              <div className="input-group">
                <label className="label">Season *</label>
                <input
                  type="text"
                  className="input"
                  value={editingSeasonName}
                  onChange={(e) => setEditingSeasonName(e.target.value)}
                  placeholder="e.g. 2026/27"
                  required
                  autoFocus
                />
              </div>

              <div className="input-group">
                <label className="label">League / Competition (optional)</label>
                <input
                  type="text"
                  className="input"
                  value={editingLeagueName}
                  onChange={(e) => setEditingLeagueName(e.target.value)}
                  placeholder="e.g. Autumn League, Spring League"
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.2rem', display: 'block' }}>
                  Distinguishes sub-seasons (e.g. Autumn League vs Spring League).
                </span>
              </div>

              <div className="input-group">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <label className="label" style={{ marginBottom: 0 }}>Season Timeframe / Dates (optional)</label>
                  {editingComputedTimeframe && (
                    <button
                      type="button"
                      onClick={() => setEditingTimeframe(editingComputedTimeframe)}
                      className="btn-link"
                      style={{ fontSize: '0.72rem', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      Use match dates ({editingComputedTimeframe})
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  className="input"
                  value={editingTimeframe}
                  onChange={(e) => setEditingTimeframe(e.target.value)}
                  placeholder="e.g. September 2026 – December 2026"
                  style={{ marginTop: '0.25rem' }}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.2rem', display: 'block' }}>
                  The months or dates when matches for this season are scheduled.
                </span>
              </div>

              <div className="flex-row gap-2 mt-4">
                <button type="submit" disabled={renameLoading} className="btn btn-primary" style={{ flex: 1 }}>
                  {renameLoading ? 'Saving...' : 'Save Season Details'}
                </button>
                <button type="button" onClick={() => setEditingSeason(null)} className="btn btn-secondary" style={{ width: 'auto' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global In-App Confirmation / Warning Dialog */}
      <ConfirmDialog {...dialogConfig} />
    </div>
  );
}
