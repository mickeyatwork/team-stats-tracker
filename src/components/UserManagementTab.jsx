import { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Check,
  X,
  Copy,
  Lock,
  Edit2,
  Trash2,
  Search,
  Filter
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import {
  ROLES,
  ROLE_LABELS,
  USER_STATUS,
  isDevAdmin,
  isTeamAdmin
} from '../utils/authRoles';
import { sendUserInviteEmail } from '../utils/emailService';

export default function UserManagementTab({
  currentUserProfile,
  session,
  allClubs = [],
  allTeams = []
}) {
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [clubFilter, setClubFilter] = useState('all');

  // Modal States
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  // Invite Form State
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState(ROLES.NORMAL_USER);
  const [inviteClubId, setInviteClubId] = useState(() => currentUserProfile?.club_id || (allClubs[0]?.id || ''));
  const [inviteSelectedTeams, setInviteSelectedTeams] = useState([]);
  const [inviteTempPassword, setInviteTempPassword] = useState('');
  const [autoGenPassword, setAutoGenPassword] = useState(true);
  const [sendEmailInvite, setSendEmailInvite] = useState(true);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteNotice, setInviteNotice] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const isDev = isDevAdmin(currentUserProfile);
  const isTeamAdm = isTeamAdmin(currentUserProfile);

  // Fetch users & assignments
  useEffect(() => {
    fetchUsersAndAssignments();
  }, [currentUserProfile]);

  const fetchUsersAndAssignments = async () => {
    setLoading(true);
    try {
      let query = supabase.from('user_profiles').select('*').order('created_at', { ascending: false });
      
      // If Team Admin, scope to their own club
      if (isTeamAdm && currentUserProfile?.club_id) {
        query = query.eq('club_id', currentUserProfile.club_id);
      }

      const { data: profiles, error: pError } = await query;
      if (pError) console.error('Error fetching user profiles:', pError);

      const { data: assigns, error: aError } = await supabase.from('user_team_assignments').select('*');
      if (aError) console.error('Error fetching assignments:', aError);

      setUsers(profiles || []);
      setAssignments(assigns || []);
    } catch (err) {
      console.error('fetchUsers exception:', err);
    } finally {
      setLoading(false);
    }
  };

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
    let pass = '';
    for (let i = 0; i < 10; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pass;
  };

  const handleOpenInviteModal = () => {
    setInviteEmail('');
    setInviteName('');
    setInviteRole(ROLES.NORMAL_USER);
    const defaultClub = currentUserProfile?.club_id || (allClubs[0]?.id || '');
    setInviteClubId(defaultClub);
    setInviteSelectedTeams([]);
    setInviteTempPassword(generateRandomPassword());
    setAutoGenPassword(true);
    setSendEmailInvite(true);
    setInviteNotice(null);
    setShowInviteModal(true);
  };

  const handleToggleTeamSelection = (teamId) => {
    setInviteSelectedTeams((prev) =>
      prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId]
    );
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviteSubmitting(true);
    setInviteNotice(null);

    const emailClean = inviteEmail.trim().toLowerCase();
    const finalPassword = autoGenPassword ? inviteTempPassword : inviteTempPassword.trim();
    const targetClubId = isDev ? (inviteClubId || null) : currentUserProfile?.club_id;

    try {
      // 1. Create or update profile in user_profiles
      const { data: newProfile, error: profileErr } = await supabase
        .from('user_profiles')
        .insert([
          {
            email: emailClean,
            name: inviteName.trim() || emailClean.split('@')[0],
            role: inviteRole,
            club_id: targetClubId,
            status: USER_STATUS.INVITED,
            temp_password: finalPassword || null
          }
        ])
        .select()
        .single();

      if (profileErr) {
        throw new Error(profileErr.message);
      }

      // 2. Insert team assignments if any selected
      if (inviteSelectedTeams.length > 0 && newProfile?.id) {
        const assignsToInsert = inviteSelectedTeams.map((tid) => ({
          user_profile_id: newProfile.id,
          team_id: tid
        }));
        await supabase.from('user_team_assignments').insert(assignsToInsert);
      }

      // 3. Optional: Trigger 3rd party email if enabled
      let emailResultMsg = '';
      if (sendEmailInvite) {
        const clubObj = allClubs.find((c) => c.id === targetClubId);
        const assignedTeamNames = allTeams
          .filter((t) => inviteSelectedTeams.includes(t.id))
          .map((t) => t.name);

        const emailRes = await sendUserInviteEmail({
          email: emailClean,
          name: newProfile.name,
          roleName: ROLE_LABELS[inviteRole] || inviteRole,
          clubName: clubObj?.name || 'Tower Hill FC',
          teamNames: assignedTeamNames,
          tempPassword: finalPassword
        });

        if (emailRes.success) {
          emailResultMsg = ` and email dispatched to ${emailClean}`;
        } else if (emailRes.notConfigured) {
          emailResultMsg = ` (Email API key not configured - please copy credentials manually)`;
        } else {
          emailResultMsg = ` (Email error: ${emailRes.error || 'Failed to send'})`;
        }
      }

      // Refresh list
      await fetchUsersAndAssignments();

      setInviteNotice({
        type: 'success',
        text: `User ${emailClean} added successfully${emailResultMsg}!`,
        credentials: {
          email: emailClean,
          password: finalPassword,
          role: ROLE_LABELS[inviteRole],
          teams: allTeams.filter((t) => inviteSelectedTeams.includes(t.id)).map((t) => t.name).join(', ')
        }
      });
    } catch (err) {
      console.error('Error creating user:', err);
      setInviteNotice({
        type: 'error',
        text: `Failed to add user: ${err.message}`
      });
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleToggleUserStatus = async (user) => {
    // Safety check: Dev Admin cannot deactivate themselves
    if (user.email === session?.user?.email) {
      alert("You cannot deactivate your own administrative account.");
      return;
    }

    const nextStatus = user.status === USER_STATUS.ACTIVE ? USER_STATUS.DEACTIVATED : USER_STATUS.ACTIVE;
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ status: nextStatus })
        .eq('id', user.id);

      if (error) throw error;
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: nextStatus } : u)));
    } catch (err) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  const handleDeleteUser = async (user) => {
    if (user.email === session?.user?.email) {
      alert("You cannot delete your own administrative account.");
      return;
    }

    const confirmDelete = window.confirm(
      `Are you sure you want to remove user "${user.name || user.email}"? Their team assignments will also be deleted.`
    );
    if (!confirmDelete) return;

    try {
      const { error } = await supabase.from('user_profiles').delete().eq('id', user.id);
      if (error) throw error;

      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setAssignments((prev) => prev.filter((a) => a.user_profile_id !== user.id));
    } catch (err) {
      alert(`Failed to delete user: ${err.message}`);
    }
  };

  const handleOpenEditModal = (user) => {
    setSelectedUser(user);
    const userAssigns = assignments
      .filter((a) => a.user_profile_id === user.id)
      .map((a) => a.team_id);
    setInviteSelectedTeams(userAssigns);
    setInviteRole(user.role);
    setInviteClubId(user.club_id || '');
    setShowEditModal(true);
  };

  const handleSaveEditUser = async (e) => {
    e.preventDefault();
    if (!selectedUser) return;

    try {
      const targetClubId = isDev ? (inviteClubId || null) : selectedUser.club_id;
      const { error: pErr } = await supabase
        .from('user_profiles')
        .update({
          role: inviteRole,
          club_id: targetClubId
        })
        .eq('id', selectedUser.id);

      if (pErr) throw pErr;

      // Update assignments: delete existing, insert new
      await supabase.from('user_team_assignments').delete().eq('user_profile_id', selectedUser.id);
      if (inviteSelectedTeams.length > 0) {
        const assignsToInsert = inviteSelectedTeams.map((tid) => ({
          user_profile_id: selectedUser.id,
          team_id: tid
        }));
        await supabase.from('user_team_assignments').insert(assignsToInsert);
      }

      await fetchUsersAndAssignments();
      setShowEditModal(false);
      setSelectedUser(null);
    } catch (err) {
      alert(`Failed to update user: ${err.message}`);
    }
  };

  const handleCopyCredentials = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Filtered users
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      (u.name && u.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesClub = clubFilter === 'all' || String(u.club_id) === String(clubFilter);

    return matchesSearch && matchesRole && matchesClub;
  });

  // Calculate statistics
  const totalCount = users.length;
  const activeCount = users.filter((u) => u.status === USER_STATUS.ACTIVE).length;
  const deactivatedCount = users.filter((u) => u.status === USER_STATUS.DEACTIVATED).length;
  const invitedCount = users.filter((u) => u.status === USER_STATUS.INVITED).length;

  // Filtered teams for selection based on selected club
  const activeClubTeams = allTeams.filter((t) => {
    if (!inviteClubId) return true;
    return String(t.club_id) === String(inviteClubId);
  });

  return (
    <div>
      {/* Top Header & Metrics Bar */}
      <div className="card mb-4" style={{ padding: '1.25rem' }}>
        <div className="flex-between mb-3" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 className="title-md flex-row gap-2" style={{ margin: 0 }}>
              <Users size={20} color="var(--color-primary)" /> User &amp; Access Management
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0.25rem 0 0 0' }}>
              {isDev
                ? 'Global access control: Manage Dev Admins, Team Admins, Normal Users, and team permissions.'
                : 'Manage coach accounts and team permissions for your club.'}
            </p>
          </div>
          <button onClick={handleOpenInviteModal} className="btn btn-primary flex-row gap-2">
            <UserPlus size={16} /> Add / Invite User
          </button>
        </div>

        {/* Stats Row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '0.75rem',
            paddingTop: '0.5rem',
            borderTop: '1px solid var(--color-border)'
          }}
        >
          <div style={{ padding: '0.5rem', background: 'var(--color-bg-alt, rgba(0,0,0,0.02))', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Total Users</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{totalCount}</div>
          </div>
          <div style={{ padding: '0.5rem', background: 'rgba(34, 197, 94, 0.08)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '0.75rem', color: 'rgb(22, 101, 52)' }}>Active</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'rgb(22, 101, 52)' }}>{activeCount}</div>
          </div>
          <div style={{ padding: '0.5rem', background: 'rgba(234, 179, 8, 0.08)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '0.75rem', color: 'rgb(133, 77, 14)' }}>Pending Invites</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'rgb(133, 77, 14)' }}>{invitedCount}</div>
          </div>
          <div style={{ padding: '0.5rem', background: 'rgba(239, 68, 68, 0.08)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '0.75rem', color: 'rgb(153, 27, 27)' }}>Deactivated</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'rgb(153, 27, 27)' }}>{deactivatedCount}</div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        className="card mb-4"
        style={{
          padding: '0.85rem 1rem',
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input
            type="text"
            className="input"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '2.25rem', height: '36px', fontSize: '0.85rem' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Filter size={15} color="var(--color-text-muted)" />
          <select
            className="input"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            style={{ height: '36px', fontSize: '0.85rem', width: 'auto' }}
          >
            <option value="all">All Roles</option>
            <option value={ROLES.DEV_ADMIN}>Dev Admin</option>
            <option value={ROLES.TEAM_ADMIN}>Team Admin</option>
            <option value={ROLES.NORMAL_USER}>Normal User</option>
          </select>

          {isDev && allClubs.length > 1 && (
            <select
              className="input"
              value={clubFilter}
              onChange={(e) => setClubFilter(e.target.value)}
              style={{ height: '36px', fontSize: '0.85rem', width: 'auto' }}
            >
              <option value="all">All Clubs</option>
              {allClubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.location ? `(${c.location})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* User Directory List */}
      <div className="card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
            Loading users directory...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--color-text-muted)' }}>
            <Users size={32} style={{ margin: '0 auto 0.75rem auto', opacity: 0.4 }} />
            <div style={{ fontWeight: 600 }}>No users found</div>
            <div style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
              {searchQuery ? 'Try clearing your search filters.' : 'Click "Add / Invite User" to onboard a coach.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filteredUsers.map((user) => {
              const isCurrentUser = user.email === session?.user?.email;
              const userClub = allClubs.find((c) => c.id === user.club_id);
              const userAssignedTeamIds = assignments
                .filter((a) => a.user_profile_id === user.id)
                .map((a) => a.team_id);
              const userAssignedTeams = allTeams.filter((t) => userAssignedTeamIds.includes(t.id));

              // Badges styling
              const isDevRole = user.role === ROLES.DEV_ADMIN;
              const isTeamAdminRole = user.role === ROLES.TEAM_ADMIN;
              const isDeactivated = user.status === USER_STATUS.DEACTIVATED;
              const isInvited = user.status === USER_STATUS.INVITED;

              return (
                <div
                  key={user.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '1rem',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--color-border)',
                    background: isDeactivated ? 'var(--color-bg-alt, rgba(0,0,0,0.03))' : 'var(--color-bg-card)',
                    opacity: isDeactivated ? 0.75 : 1,
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
                    {/* User Identity */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          background: isDevRole
                            ? 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)'
                            : isTeamAdminRole
                            ? 'var(--color-primary)'
                            : 'var(--color-border)',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '0.95rem',
                          flexShrink: 0
                        }}
                      >
                        {(user.name || user.email || 'U')[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                            {user.name || 'Unnamed Coach'}
                          </span>
                          {isCurrentUser && (
                            <span className="badge badge-primary" style={{ fontSize: '0.65rem' }}>
                              You
                            </span>
                          )}
                          {/* Role Badge */}
                          <span
                            style={{
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: '999px',
                              background: isDevRole
                                ? 'rgba(139, 92, 246, 0.15)'
                                : isTeamAdminRole
                                ? 'rgba(2, 132, 199, 0.15)'
                                : 'var(--color-border-light)',
                              color: isDevRole ? '#7c3aed' : isTeamAdminRole ? 'var(--color-primary-dark)' : 'var(--color-text-muted)',
                              border: `1px solid ${isDevRole ? '#c4b5fd' : isTeamAdminRole ? '#bae6fd' : 'var(--color-border)'}`
                            }}
                          >
                            {ROLE_LABELS[user.role] || user.role}
                          </span>
                          {/* Status Badge */}
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 600,
                              padding: '1px 6px',
                              borderRadius: '4px',
                              background: isDeactivated
                                ? 'rgba(239, 68, 68, 0.15)'
                                : isInvited
                                ? 'rgba(234, 179, 8, 0.15)'
                                : 'rgba(34, 197, 94, 0.15)',
                              color: isDeactivated ? '#dc2626' : isInvited ? '#b45309' : '#15803d'
                            }}
                          >
                            {isDeactivated ? 'Deactivated' : isInvited ? 'Invited' : 'Active'}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                          {user.email}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
                      {user.temp_password && (
                        <button
                          type="button"
                          className="btn-icon"
                          title="Copy Login Details & Temp Password"
                          onClick={() => {
                            const creds = `Login URL: ${window.location.origin}\nEmail: ${user.email}\nTemporary Password: ${user.temp_password}`;
                            handleCopyCredentials(creds, user.id);
                          }}
                        >
                          {copiedId === user.id ? <Check size={16} color="var(--color-primary)" /> : <Copy size={16} />}
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn-icon"
                        title="Edit Roles & Teams"
                        onClick={() => handleOpenEditModal(user)}
                      >
                        <Edit2 size={16} />
                      </button>

                      {/* Activate / Deactivate Toggle */}
                      {!isCurrentUser && (
                        <button
                          type="button"
                          onClick={() => handleToggleUserStatus(user)}
                          style={{
                            padding: '0.3rem 0.65rem',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid',
                            cursor: 'pointer',
                            background: isDeactivated ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.08)',
                            borderColor: isDeactivated ? '#86efac' : '#fca5a5',
                            color: isDeactivated ? '#15803d' : '#b91c1c'
                          }}
                        >
                          {isDeactivated ? 'Activate' : 'Deactivate'}
                        </button>
                      )}

                      {/* Delete User */}
                      {!isCurrentUser && (
                        <button
                          type="button"
                          className="btn-icon"
                          title="Delete User"
                          style={{ color: 'var(--color-danger)' }}
                          onClick={() => handleDeleteUser(user)}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Club & Assigned Teams Summary Row */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginTop: '0.75rem',
                      paddingTop: '0.5rem',
                      borderTop: '1px solid var(--color-border)',
                      fontSize: '0.78rem',
                      flexWrap: 'wrap'
                    }}
                  >
                    <span style={{ color: 'var(--color-text-muted)' }}>Club:</span>
                    <span style={{ fontWeight: 600 }}>{userClub?.name || 'Tower Hill FC'}</span>

                    <span style={{ color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>Assigned Teams:</span>
                    {userAssignedTeams.length > 0 ? (
                      userAssignedTeams.map((t) => (
                        <span
                          key={t.id}
                          style={{
                            padding: '2px 8px',
                            background: 'var(--color-primary-light)',
                            color: 'var(--color-primary-dark)',
                            borderRadius: '999px',
                            fontSize: '0.72rem',
                            fontWeight: 600
                          }}
                        >
                          {t.name}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontStyle: 'italic', color: 'var(--color-text-muted)' }}>
                        {isDevRole || isTeamAdminRole ? 'All club teams (Admin access)' : 'No teams assigned yet'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ================= ADD / INVITE USER MODAL ================= */}
      {showInviteModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div className="flex-between mb-3">
              <h3 className="title-md flex-row gap-2" style={{ margin: 0 }}>
                <UserPlus size={18} color="var(--color-primary)" /> Add / Invite User
              </h3>
              <button className="btn-icon" onClick={() => setShowInviteModal(false)}>
                <X size={18} />
              </button>
            </div>

            {inviteNotice && (
              <div
                className={`alert ${inviteNotice.type === 'success' ? 'alert-success' : 'alert-danger'} mb-3`}
                style={{ fontSize: '0.85rem' }}
              >
                <div>{inviteNotice.text}</div>
                {inviteNotice.credentials && (
                  <div
                    style={{
                      marginTop: '0.6rem',
                      padding: '0.6rem',
                      background: 'rgba(255,255,255,0.85)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-border)',
                      fontSize: '0.78rem'
                    }}
                  >
                    <div><strong>Email:</strong> {inviteNotice.credentials.email}</div>
                    <div><strong>Password:</strong> <code>{inviteNotice.credentials.password}</code></div>
                    <div><strong>Role:</strong> {inviteNotice.credentials.role}</div>
                    <div><strong>Teams:</strong> {inviteNotice.credentials.teams || 'None'}</div>
                    <button
                      type="button"
                      className="btn btn-secondary mt-2 flex-row gap-1"
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                      onClick={() => {
                        const str = `Login URL: ${window.location.origin}\nEmail: ${inviteNotice.credentials.email}\nTemporary Password: ${inviteNotice.credentials.password}`;
                        navigator.clipboard.writeText(str);
                        alert('Credentials copied to clipboard!');
                      }}
                    >
                      <Copy size={12} /> Copy Invite Message
                    </button>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleCreateUser}>
              <div className="input-group">
                <label className="label">Coach Email Address *</label>
                <input
                  type="email"
                  className="input"
                  required
                  placeholder="coach@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="label">Coach Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Ted Lasso"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="label">Access Role *</label>
                <select
                  className="input"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  <option value={ROLES.NORMAL_USER}>Normal User (Assigned teams only)</option>
                  <option value={ROLES.TEAM_ADMIN}>Team Admin (Manage all teams in club)</option>
                  {isDev && <option value={ROLES.DEV_ADMIN}>Dev Admin (Unrestricted global access)</option>}
                </select>
              </div>

              {/* Club Selection (Only Dev Admin can choose; Team Admin is locked) */}
              {isDev && allClubs.length > 0 && (
                <div className="input-group">
                  <label className="label">Assigned Club</label>
                  <select
                    className="input"
                    value={inviteClubId}
                    onChange={(e) => setInviteClubId(e.target.value)}
                  >
                    {allClubs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.location ? `(${c.location})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Sub-teams multi-select checkboxes */}
              <div className="input-group">
                <label className="label">Assign Teams / Sub-teams</label>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0 0 0.5rem 0' }}>
                  Select which teams this coach is permitted to see and track:
                </p>
                <div
                  style={{
                    maxHeight: '140px',
                    overflowY: 'auto',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.5rem'
                  }}
                >
                  {activeClubTeams.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', padding: '0.5rem' }}>
                      No teams created under this club yet.
                    </div>
                  ) : (
                    activeClubTeams.map((team) => {
                      const isChecked = inviteSelectedTeams.includes(team.id);
                      return (
                        <label
                          key={team.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.35rem 0.5rem',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            background: isChecked ? 'var(--color-primary-light)' : 'transparent',
                            fontSize: '0.85rem'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleTeamSelection(team.id)}
                          />
                          <span style={{ fontWeight: isChecked ? 600 : 400 }}>{team.name}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                            {team.season}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Temporary Password Options */}
              <div
                style={{
                  background: 'var(--color-border-light)',
                  padding: '0.85rem',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '1rem'
                }}
              >
                <div className="flex-between mb-2">
                  <div style={{ fontWeight: 600, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Lock size={14} /> Temporary Password
                  </div>
                  <button
                    type="button"
                    onClick={() => setInviteTempPassword(generateRandomPassword())}
                    style={{ fontSize: '0.72rem', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Generate New
                  </button>
                </div>
                <input
                  type="text"
                  className="input"
                  value={inviteTempPassword}
                  onChange={(e) => setInviteTempPassword(e.target.value)}
                  placeholder="Temporary password"
                  style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}
                />
              </div>

              {/* 3rd Party Email Dispatch Option */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <input
                  type="checkbox"
                  id="sendEmailCheck"
                  checked={sendEmailInvite}
                  onChange={(e) => setSendEmailInvite(e.target.checked)}
                />
                <label htmlFor="sendEmailCheck" style={{ fontSize: '0.82rem', cursor: 'pointer' }}>
                  Send automated invite email via 3rd-party API (if configured)
                </label>
              </div>

              <div className="flex-row gap-2">
                <button
                  type="submit"
                  disabled={inviteSubmitting}
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                >
                  {inviteSubmitting ? 'Saving & Inviting...' : 'Create & Invite User'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="btn btn-secondary"
                  style={{ width: 'auto' }}
                >
                  Close
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= EDIT USER MODAL ================= */}
      {showEditModal && selectedUser && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="flex-between mb-3">
              <h3 className="title-md flex-row gap-2" style={{ margin: 0 }}>
                <Edit2 size={18} color="var(--color-primary)" /> Edit User Access
              </h3>
              <button className="btn-icon" onClick={() => setShowEditModal(false)}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              Editing access for <strong>{selectedUser.name || selectedUser.email}</strong> ({selectedUser.email})
            </p>

            <form onSubmit={handleSaveEditUser}>
              <div className="input-group">
                <label className="label">User Role</label>
                <select
                  className="input"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  disabled={selectedUser.email === session?.user?.email}
                >
                  <option value={ROLES.NORMAL_USER}>Normal User (Assigned teams only)</option>
                  <option value={ROLES.TEAM_ADMIN}>Team Admin (Manage all teams in club)</option>
                  {isDev && <option value={ROLES.DEV_ADMIN}>Dev Admin (Unrestricted global access)</option>}
                </select>
                {selectedUser.email === session?.user?.email && (
                  <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', margin: '0.2rem 0 0 0' }}>
                    You cannot change your own role.
                  </p>
                )}
              </div>

              {isDev && allClubs.length > 0 && (
                <div className="input-group">
                  <label className="label">Club</label>
                  <select
                    className="input"
                    value={inviteClubId}
                    onChange={(e) => setInviteClubId(e.target.value)}
                  >
                    {allClubs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.location ? `(${c.location})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="input-group">
                <label className="label">Assigned Teams</label>
                <div
                  style={{
                    maxHeight: '160px',
                    overflowY: 'auto',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.5rem'
                  }}
                >
                  {activeClubTeams.map((team) => {
                    const isChecked = inviteSelectedTeams.includes(team.id);
                    return (
                      <label
                        key={team.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.35rem 0.5rem',
                          cursor: 'pointer',
                          borderRadius: '4px',
                          background: isChecked ? 'var(--color-primary-light)' : 'transparent',
                          fontSize: '0.85rem'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleTeamSelection(team.id)}
                        />
                        <span style={{ fontWeight: isChecked ? 600 : 400 }}>{team.name}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                          {team.season}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex-row gap-2 mt-4">
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
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
    </div>
  );
}
