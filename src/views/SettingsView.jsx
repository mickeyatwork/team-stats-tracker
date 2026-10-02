import { useState } from 'react';
import { LogOut, User, Lock, Mail, Shield, Plus, Check, Edit3 } from 'lucide-react';
import TopNav from '../components/TopNav';
import { supabase } from '../supabaseClient';

export default function SettingsView({
  session,
  teamInfo,
  setTeamInfo,
  allTeams,
  setAllTeams,
  onSelectTeam,
  onAddNewTeam,
  setCurrentView
}) {
  // Update Email Form
  const [newEmail, setNewEmail] = useState('');
  const [emailStatus, setEmailStatus] = useState({ loading: false, success: null, error: null });

  // Update Password Form
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState({ loading: false, success: null, error: null });

  // Update Active Team Details
  const [teamNameInput, setTeamNameInput] = useState(teamInfo?.name || '');
  const [seasonInput, setSeasonInput] = useState(teamInfo?.season || '');
  const [hidePositionsInput, setHidePositionsInput] = useState(teamInfo?.hide_positions || false);
  const [teamStatus, setTeamStatus] = useState({ loading: false, success: null, error: null });

  // Add New Team Form Modal state inside settings
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newSeasonName, setNewSeasonName] = useState('');
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
      const { error } = await supabase
        .from('team')
        .update({ name: teamNameInput, season: seasonInput, hide_positions: hidePositionsInput })
        .eq('id', teamInfo.id);

      if (error) {
        // Fallback if hide_positions column isn't created yet
        if (error.message.includes('hide_positions')) {
          const { error: fallbackError } = await supabase
            .from('team')
            .update({ name: teamNameInput, season: seasonInput })
            .eq('id', teamInfo.id);
          if (fallbackError) throw fallbackError;
        } else {
          throw error;
        }
      }

      const updated = { ...teamInfo, name: teamNameInput, season: seasonInput, hide_positions: hidePositionsInput };

      setTeamInfo(updated);
      setAllTeams(allTeams.map((t) => (t.id === teamInfo.id ? updated : t)));
      setTeamStatus({ loading: false, success: 'Team details updated!', error: null });
    } catch (error) {
      setTeamStatus({ loading: false, success: null, error: error.message });
    }
  };

  const handleCreateNewTeam = async (e) => {
    e.preventDefault();
    if (!newTeamName || !newSeasonName) return;
    setAddTeamLoading(true);

    const newTeamObj = {
      user_id: session.user.id,
      name: newTeamName,
      season: newSeasonName,
      hide_positions: false
    };

    const { data, error } = await supabase.from('team').insert([newTeamObj]).select().single();

    if (error) {
      if (error.message.includes('hide_positions')) {
        const { data: fallbackData, error: fallbackError } = await supabase.from('team').insert([{
          user_id: session.user.id,
          name: newTeamName,
          season: newSeasonName
        }]).select().single();
        if (fallbackError) {
          alert(`Error adding team: ${fallbackError.message}`);
          setAddTeamLoading(false);
          return;
        }
        if (fallbackData) {
          setAllTeams([fallbackData, ...allTeams]);
          setTeamInfo(fallbackData);
          setShowAddTeamModal(false);
          setNewTeamName('');
          setNewSeasonName('');
        }
      } else {
        alert(`Error adding team: ${error.message}`);
      }
      setAddTeamLoading(false);
      return;
    }

    if (data) {
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

  return (
    <div className="app-container">
      <TopNav
        title="Settings"
        onBack={() => setCurrentView('matches')}
        currentView="settings"
        setCurrentView={setCurrentView}
      />

      <div className="view-container">
        {/* Active Team / Season Details */}
        <div className="card">
          <h2 className="title-md flex-row gap-2 mb-2">
            <Edit3 size={18} color="var(--color-primary)" /> Team Profile Settings
          </h2>
          <form onSubmit={handleUpdateTeamDetails}>
            <div className="input-group">
              <label className="label">Team Name</label>
              <input
                type="text"
                className="input"
                value={teamNameInput}
                onChange={(e) => setTeamNameInput(e.target.value)}
                required
              />
            </div>
            <div className="input-group">
              <label className="label">Season Label</label>
              <input
                type="text"
                className="input"
                value={seasonInput}
                onChange={(e) => setSeasonInput(e.target.value)}
                placeholder="e.g. 2024/25"
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
                  Don't require or show positions (e.g. for younger ages)
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
                  position: 'relative'
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

        {/* Multi-Team & Season Switcher */}
        <div className="card mt-4">
          <div className="flex-between mb-2">
            <h2 className="title-md flex-row gap-2" style={{ margin: 0 }}>
              <Shield size={18} color="var(--color-secondary)" /> Your Teams & Seasons
            </h2>
            <button
              onClick={() => setShowAddTeamModal(true)}
              className="btn btn-secondary"
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
            >
              <Plus size={14} /> Add Profile
            </button>
          </div>

          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
            Switch active team context or add a new team/season profile.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {allTeams.map((t) => {
              const isActive = t.id === teamInfo?.id;
              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTeam(t)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justify: 'space-between',
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
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{t.season}</div>
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
                <div className="flex-row gap-2 mt-2">
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
          )}
        </div>

        {/* Update Account Email */}
        <div className="card mt-4">
          <h2 className="title-md flex-row gap-2 mb-2">
            <Mail size={18} /> Update Email Address
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
            Current email: <strong>{session.user.email}</strong>
          </p>
          <form onSubmit={handleUpdateEmail}>
            <div className="input-group">
              <label className="label">New Email Address</label>
              <input
                type="email"
                className="input"
                placeholder="newemail@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </div>
            {emailStatus.error && <div className="alert alert-danger">{emailStatus.error}</div>}
            {emailStatus.success && <div className="alert alert-success">{emailStatus.success}</div>}
            <button type="submit" disabled={emailStatus.loading} className="btn btn-primary mt-2">
              {emailStatus.loading ? 'Updating...' : 'Update Email'}
            </button>
          </form>
        </div>

        {/* Change Password */}
        <div className="card mt-4">
          <h2 className="title-md flex-row gap-2 mb-2">
            <Lock size={18} /> Change Password
          </h2>
          <form onSubmit={handleUpdatePassword}>
            <div className="input-group">
              <label className="label">New Password</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="input-group">
              <label className="label">Confirm New Password</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            {passwordStatus.error && <div className="alert alert-danger">{passwordStatus.error}</div>}
            {passwordStatus.success && <div className="alert alert-success">{passwordStatus.success}</div>}
            <button type="submit" disabled={passwordStatus.loading} className="btn btn-primary mt-2">
              {passwordStatus.loading ? 'Updating...' : 'Change Password'}
            </button>
          </form>
        </div>

        {/* Sign Out */}
        <div className="card mt-4">
          <h2 className="title-md flex-row gap-2 mb-2">
            <User size={18} /> Account Session
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
            Signed in as {session.user.email}
          </p>
          <button onClick={handleSignOut} className="btn btn-secondary" style={{ color: 'var(--color-danger)' }}>
            <LogOut size={18} /> Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
