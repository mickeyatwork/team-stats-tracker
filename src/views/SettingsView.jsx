import { useState, useEffect } from 'react';
import {
  LogOut,
  User,
  Lock,
  Mail,
  Shield,
  Plus,
  Check,
  Edit3,
  Sliders,
  Palette,
  Calendar,
  Users,
  Building2,
  ToggleLeft
} from 'lucide-react';
import TopNav from '../components/TopNav';
import UserManagementTab from '../components/UserManagementTab';
import ClubManagementModal from '../components/ClubManagementModal';
import { supabase } from '../supabaseClient';
import { getDefaultMatchVariant, setDefaultMatchVariant, MATCH_VARIANTS } from '../utils/variantPreferences';
import { FEATURE_KEYS, isFeatureEnabled, setFeatureFlag } from '../utils/featureFlags';
import { THEME_CONFIGS, getSavedTheme, applyTheme } from '../utils/themePreferences';
import {
  isDevAdmin,
  hasAdminPrivileges,
  canManageFeatureFlags,
  canManageClubs
} from '../utils/authRoles';

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
  setCurrentTheme
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
  const [hidePositionsInput, setHidePositionsInput] = useState(teamInfo?.hide_positions || false);
  const [matchDynamicsInput, setMatchDynamicsInput] = useState(() => isFeatureEnabled(teamInfo, FEATURE_KEYS.MATCH_DYNAMICS));
  const [efficiencyRatingInput, setEfficiencyRatingInput] = useState(() => isFeatureEnabled(teamInfo, FEATURE_KEYS.EFFICIENCY_RATING));
  const [attemptsInput, setAttemptsInput] = useState(() => isFeatureEnabled(teamInfo, FEATURE_KEYS.ATTEMPTS));
  const [defensiveContributionsInput, setDefensiveContributionsInput] = useState(() => isFeatureEnabled(teamInfo, FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS));
  const [defaultVariant, setDefaultVariant] = useState(getDefaultMatchVariant);
  const [teamStatus, setTeamStatus] = useState({ loading: false, success: null, error: null });

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
    applyTheme(newTheme);
    if (setCurrentTheme) {
      setCurrentTheme(newTheme);
    }
  };

  // Keep form inputs synced if active team changes
  useEffect(() => {
    if (teamInfo) {
      setTeamNameInput(teamInfo.name || '');
      setHidePositionsInput(teamInfo.hide_positions || false);
      setMatchDynamicsInput(isFeatureEnabled(teamInfo, FEATURE_KEYS.MATCH_DYNAMICS));
      setEfficiencyRatingInput(isFeatureEnabled(teamInfo, FEATURE_KEYS.EFFICIENCY_RATING));
      setAttemptsInput(isFeatureEnabled(teamInfo, FEATURE_KEYS.ATTEMPTS));
      setDefensiveContributionsInput(isFeatureEnabled(teamInfo, FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS));
    }
  }, [teamInfo]);

  // Add New Team Form Modal state inside settings
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newSeasonName, setNewSeasonName] = useState('');
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
      const newSettings = {
        ...(teamInfo.settings || {}),
        [FEATURE_KEYS.MATCH_DYNAMICS]: matchDynamicsInput,
        [FEATURE_KEYS.EFFICIENCY_RATING]: efficiencyRatingInput,
        [FEATURE_KEYS.ATTEMPTS]: attemptsInput,
        [FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS]: defensiveContributionsInput
      };

      // Try updating with settings JSONB column
      let { error } = await supabase
        .from('team')
        .update({
          name: teamNameInput,
          hide_positions: hidePositionsInput,
          settings: newSettings
        })
        .eq('id', teamInfo.id);

      // If settings column doesn't exist yet in database, fallback to updating without it
      if (error && (error.message?.includes('settings') || error.code === 'PGRST204')) {
        const retry = await supabase
          .from('team')
          .update({ name: teamNameInput, hide_positions: hidePositionsInput })
          .eq('id', teamInfo.id);
        if (retry.error) throw retry.error;
      } else if (error) {
        throw error;
      }

      setFeatureFlag(teamInfo.id, FEATURE_KEYS.MATCH_DYNAMICS, matchDynamicsInput);
      setFeatureFlag(teamInfo.id, FEATURE_KEYS.EFFICIENCY_RATING, efficiencyRatingInput);
      setFeatureFlag(teamInfo.id, FEATURE_KEYS.ATTEMPTS, attemptsInput);
      setFeatureFlag(teamInfo.id, FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS, defensiveContributionsInput);

      const updated = {
        ...teamInfo,
        name: teamNameInput,
        hide_positions: hidePositionsInput,
        [FEATURE_KEYS.MATCH_DYNAMICS]: matchDynamicsInput,
        [FEATURE_KEYS.EFFICIENCY_RATING]: efficiencyRatingInput,
        [FEATURE_KEYS.ATTEMPTS]: attemptsInput,
        [FEATURE_KEYS.DEFENSIVE_CONTRIBUTIONS]: defensiveContributionsInput,
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

  const handleCreateNewTeam = async (e) => {
    e.preventDefault();
    if (!newTeamName || !newSeasonName) return;
    setAddTeamLoading(true);

    const targetClubId = isDev
      ? (newTeamClubId || (allClubs[0]?.id || null))
      : (currentUserProfile?.club_id || (allClubs[0]?.id || null));

    const newTeamObj = {
      user_id: session.user.id,
      name: newTeamName.trim(),
      season: newSeasonName.trim(),
      club_id: targetClubId,
      hide_positions: false
    };

    const { data, error } = await supabase.from('team').insert([newTeamObj]).select().single();

    if (error) {
      alert(`Error adding team: ${error.message}`);
      setAddTeamLoading(false);
      return;
    }

    if (data) {
      // Also automatically assign creator to this team in user_team_assignments
      if (currentUserProfile?.id) {
        await supabase.from('user_team_assignments').insert([
          { user_profile_id: currentUserProfile.id, team_id: data.id }
        ]);
      }

      setAllTeams([data, ...allTeams]);
      setTeamInfo(data);
      setShowAddTeamModal(false);
      setNewTeamName('');
      setNewSeasonName('');
    }
    setAddTeamLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const activeClub = allClubs.find((c) => c.id === teamInfo?.club_id);

  return (
    <div className="app-container">
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
              <div className="flex-between mb-2">
                <h2 className="title-md flex-row gap-2" style={{ margin: 0 }}>
                  <Edit3 size={18} color="var(--color-primary)" /> Team Profile &amp; Squad Settings
                </h2>
                {showClubManager && (
                  <button
                    type="button"
                    onClick={() => setShowClubModal(true)}
                    className="btn btn-secondary flex-row gap-1"
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.7rem' }}
                  >
                    <Building2 size={14} /> Manage Clubs
                  </button>
                )}
              </div>

              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Active Club: <strong>{activeClub?.name || 'Tower Hill FC'}</strong>
                {activeClub?.location && ` (${activeClub.location})`}
              </p>

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

                {teamStatus.error && <div className="alert alert-danger">{teamStatus.error}</div>}
                {teamStatus.success && <div className="alert alert-success">{teamStatus.success}</div>}

                <button type="submit" disabled={teamStatus.loading} className="btn btn-primary mt-2">
                  {teamStatus.loading ? 'Updating...' : 'Save Team Details'}
                </button>
              </form>
            </div>

            {/* Teams & Sub-teams Switcher / Creator */}
            <div className="card mt-4">
              <div className="flex-between mb-2">
                <h2 className="title-md flex-row gap-2" style={{ margin: 0 }}>
                  <Shield size={18} color="var(--color-secondary)" /> Teams &amp; Seasons in Club
                </h2>
                <button
                  onClick={onAddNewTeam || (() => setShowAddTeamModal(true))}
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                >
                  <Plus size={14} /> Add Team
                </button>
              </div>

              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                Switch active team context or add a new team profile.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {allTeams.map((t) => {
                  const isActive = t.id === teamInfo?.id;
                  const tClub = allClubs.find((c) => c.id === t.club_id);
                  return (
                    <div
                      key={t.id}
                      onClick={() => onSelectTeam(t)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.75rem 1rem',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid',
                        borderColor: isActive ? 'var(--color-primary)' : 'var(--color-border)',
                        background: isActive ? 'var(--color-primary-light)' : 'var(--color-bg-card)',
                        cursor: 'pointer'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', color: isActive ? 'var(--color-primary-dark)' : 'var(--color-text-main)' }}>
                          {t.name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          {t.season} {tClub ? `• ${tClub.name}` : ''}
                        </div>
                      </div>
                      {isActive && (
                        <span className="badge badge-primary flex-row gap-1">
                          <Check size={12} /> Active
                        </span>
                      )}
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
                    Display match involvement consistency % in the Squad Breakdown and the Mr. Reliable honour
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
                  marginBottom: '1rem'
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
    </div>
  );
}
