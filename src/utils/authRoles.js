/**
 * Role-Based Access Control (RBAC) Constants & Permissions
 */

export const ROLES = {
  DEV_ADMIN: 'dev_admin',
  TEAM_ADMIN: 'team_admin',
  NORMAL_USER: 'normal_user'
};

export const ROLE_LABELS = {
  [ROLES.DEV_ADMIN]: 'Dev Admin',
  [ROLES.TEAM_ADMIN]: 'Team Admin',
  [ROLES.NORMAL_USER]: 'Normal User'
};

export const USER_STATUS = {
  ACTIVE: 'active',
  DEACTIVATED: 'deactivated',
  INVITED: 'invited'
};

export const STATUS_LABELS = {
  [USER_STATUS.ACTIVE]: 'Active',
  [USER_STATUS.DEACTIVATED]: 'Deactivated',
  [USER_STATUS.INVITED]: 'Invited'
};

/**
 * Check if the user profile has Dev Admin role.
 * Mickey or any user with role === 'dev_admin'.
 */
export const isDevAdmin = (userProfile) => {
  if (!userProfile) return false;
  return userProfile.role === ROLES.DEV_ADMIN;
};

/**
 * Check if the user profile has Team Admin role.
 */
export const isTeamAdmin = (userProfile) => {
  if (!userProfile) return false;
  return userProfile.role === ROLES.TEAM_ADMIN;
};

/**
 * Check if user has at least Team Admin privileges (Dev Admin or Team Admin).
 */
export const hasAdminPrivileges = (userProfile) => {
  if (!userProfile) return false;
  return userProfile.role === ROLES.DEV_ADMIN || userProfile.role === ROLES.TEAM_ADMIN;
};

/**
 * Check if user is a basic/normal user.
 */
export const isNormalUser = (userProfile) => {
  if (!userProfile) return true;
  return userProfile.role === ROLES.NORMAL_USER;
};

/**
 * Permission check: Dev Admin only feature switches.
 */
export const canManageFeatureFlags = (userProfile) => {
  return isDevAdmin(userProfile);
};

/**
 * Permission check: Dev Admin only global user management across all clubs.
 */
export const canManageGlobalUsers = (userProfile) => {
  return isDevAdmin(userProfile);
};

/**
 * Permission check: Manage users (Dev Admin globally, Team Admin within own club).
 */
export const canManageClubUsers = (userProfile) => {
  return hasAdminPrivileges(userProfile);
};

/**
 * Permission check: Dev Admin only club creation and global club editing.
 */
export const canManageClubs = (userProfile) => {
  return isDevAdmin(userProfile);
};

/**
 * Permission check: Manage team profile settings (Dev Admin or Team Admin).
 */
export const canManageTeamSettings = (userProfile) => {
  return hasAdminPrivileges(userProfile);
};

/**
 * Permission check: Create new teams/sub-teams.
 */
export const canCreateTeams = (userProfile) => {
  return hasAdminPrivileges(userProfile);
};

/**
 * Check if a user can access a specific team.
 * Dev Admin: access to all teams.
 * Team Admin: access to all teams in their club.
 * Normal User: access only to assigned teams.
 */
export const canAccessTeam = (userProfile, team, assignedTeamIds = []) => {
  if (!userProfile) return false;
  if (isDevAdmin(userProfile)) return true;
  if (isTeamAdmin(userProfile)) {
    // Team admin has access if team belongs to their club
    return !userProfile.club_id || team?.club_id === userProfile.club_id;
  }
  // Normal user only has access if specifically assigned
  return assignedTeamIds.includes(team?.id);
};
