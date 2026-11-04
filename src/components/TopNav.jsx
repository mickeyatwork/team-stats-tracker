import { Users, Calendar, Settings as SettingsIcon, X, BarChart3, ChevronDown, Plus, Shield, WifiOff, RefreshCw } from 'lucide-react';
import { useState, useEffect } from 'react';
import { hasAdminPrivileges } from '../utils/authRoles';
import { getOfflineSyncState, subscribeOfflineSync, flushOfflineSyncQueue } from '../utils/offlineSync';
import { supabase } from '../supabaseClient';

export default function TopNav({
  title,
  rightIcon,
  onBack,
  showTabs,
  currentView,
  setCurrentView,
  teamInfo,
  allTeams = [],
  allClubs = [],
  currentUserProfile,
  onSelectTeam,
  onAddNewTeam,
  seasonScope,
  onSelectSeasonScope
}) {
  const [showTeamMenu, setShowTeamMenu] = useState(false);
  const [offlineState, setOfflineState] = useState(getOfflineSyncState);
  const canAddTeam = hasAdminPrivileges(currentUserProfile);
  const activeClub = allClubs.find((c) => c.id === teamInfo?.club_id);

  useEffect(() => {
    return subscribeOfflineSync((nextState) => {
      setOfflineState(nextState);
    });
  }, []);

  const handleManualSync = async () => {
    await flushOfflineSyncQueue(supabase);
  };

  return (
    <div className="top-nav" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
      <div className="top-nav-content">
        {onBack ? (
          <button onClick={onBack} className="btn-icon">
            <X size={24} />
          </button>
        ) : null}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, justifyContent: 'center' }}>
          {teamInfo && (
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                marginBottom: '0.15rem',
                flexWrap: 'wrap'
              }}
            >
              <Shield size={12} color="var(--color-primary)" style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 600, color: 'var(--color-text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {teamInfo.name}
              </span>
              {activeClub && <span style={{ whiteSpace: 'nowrap' }}>• {activeClub.name}</span>}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h1 className="nav-title text-gradient" style={{ margin: 0, lineHeight: 1.2, flex: '0 1 auto' }}>
              {title}
            </h1>

            {teamInfo && (allTeams.length > 0 || canAddTeam) && !onBack && (
              <div className="team-switcher-wrapper">
                <button
                  onClick={() => setShowTeamMenu(!showTeamMenu)}
                  className="team-switcher-btn"
                  title="Switch Team / Season"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.6rem', fontSize: '0.75rem' }}
                >
                  <span>
                    {seasonScope === 'ALL_TIME'
                      ? 'All Time (All Seasons)'
                      : (teamInfo.season || 'Active')}
                  </span>
                  <ChevronDown size={13} />
                </button>

                {showTeamMenu && (
                  <>
                    <div
                      className="dropdown-backdrop"
                      onClick={() => setShowTeamMenu(false)}
                    />
                    <div className="dropdown-menu">
                      <div className="dropdown-header">
                        {activeClub ? `${activeClub.name} • Seasons` : 'Switch Team / Season'}
                      </div>

                      {onSelectSeasonScope && allTeams.length > 1 && (
                        <>
                          <button
                            className={`dropdown-item ${seasonScope === 'ALL_TIME' ? 'active' : ''}`}
                            onClick={() => {
                              onSelectSeasonScope('ALL_TIME');
                              setShowTeamMenu(false);
                            }}
                          >
                            <span className="dropdown-item-title">All Time (All Seasons)</span>
                            <span className="dropdown-item-subtitle">
                              Combined stats across all {allTeams.length} seasons
                            </span>
                          </button>
                          <div className="dropdown-divider" />
                        </>
                      )}

                      {allTeams.map((t) => {
                        const tClub = allClubs.find((c) => c.id === t.club_id);
                        const isActiveSeason = t.id === teamInfo.id && seasonScope !== 'ALL_TIME';
                        return (
                          <button
                            key={t.id}
                            className={`dropdown-item ${isActiveSeason ? 'active' : ''}`}
                            onClick={() => {
                              if (onSelectSeasonScope) onSelectSeasonScope('CURRENT');
                              if (onSelectTeam) onSelectTeam(t);
                              setShowTeamMenu(false);
                            }}
                          >
                            <span className="dropdown-item-title">{t.name}</span>
                            <span className="dropdown-item-subtitle">
                              {t.season} {tClub && tClub.id !== activeClub?.id ? `• ${tClub.name}` : ''}
                            </span>
                          </button>
                        );
                      })}

                      {canAddTeam && (
                        <>
                          <div className="dropdown-divider" />
                          <button
                            className="dropdown-item dropdown-item-action"
                            onClick={() => {
                              setShowTeamMenu(false);
                              if (onAddNewTeam) onAddNewTeam();
                            }}
                          >
                            <Plus size={16} style={{ flexShrink: 0 }} />
                            <span>Add New Team / Season</span>
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {rightIcon && <div style={{ marginLeft: 'auto' }}>{rightIcon}</div>}

        {!onBack && (
          <button
            onClick={() => setCurrentView('settings')}
            className={`btn-icon ${currentView === 'settings' ? 'active' : ''}`}
            style={{ marginLeft: rightIcon ? '0.5rem' : 'auto', flexShrink: 0 }}
            title="Settings"
          >
            <SettingsIcon size={20} />
          </button>
        )}
      </div>

      {(!offlineState.isOnline || offlineState.pendingCount > 0) && (
        <div className={`offline-status-banner ${!offlineState.isOnline ? 'is-offline' : 'is-syncing'}`}>
          <div className="offline-status-main">
            {!offlineState.isOnline ? (
              <WifiOff size={14} style={{ flexShrink: 0 }} />
            ) : (
              <RefreshCw size={14} className={offlineState.isSyncing ? 'spin-icon' : ''} style={{ flexShrink: 0 }} />
            )}
            <span>
              {!offlineState.isOnline
                ? `Offline Mode — Stats are saved locally${offlineState.pendingCount > 0 ? ` (${offlineState.pendingCount} ${offlineState.pendingCount === 1 ? 'match' : 'matches'} queued)` : ''} and will sync when back online`
                : offlineState.isSyncing
                  ? `Syncing ${offlineState.pendingCount} offline ${offlineState.pendingCount === 1 ? 'match' : 'matches'} to server...`
                  : `${offlineState.pendingCount} offline ${offlineState.pendingCount === 1 ? 'match' : 'matches'} ready to sync`}
            </span>
          </div>
          {offlineState.browserOnline && !offlineState.isSyncing && offlineState.pendingCount > 0 && (
            <button
              type="button"
              onClick={handleManualSync}
              className="btn-offline-sync"
            >
              Sync Now
            </button>
          )}
        </div>
      )}

      {showTabs && (
        <div className="tab-container">
          <button
            onClick={() => setCurrentView('matches')}
            className={`nav-item ${currentView === 'matches' ? 'active' : ''}`}
          >
            <Calendar size={18} strokeWidth={currentView === 'matches' ? 2.5 : 2} />
            <span>Matches</span>
          </button>
          <button
            onClick={() => setCurrentView('squad')}
            className={`nav-item ${currentView === 'squad' ? 'active' : ''}`}
          >
            <Users size={18} strokeWidth={currentView === 'squad' ? 2.5 : 2} />
            <span>Squad</span>
          </button>
          <button
            onClick={() => setCurrentView('stats')}
            className={`nav-item ${currentView === 'stats' ? 'active' : ''}`}
          >
            <BarChart3 size={18} strokeWidth={currentView === 'stats' ? 2.5 : 2} />
            <span>Stats</span>
          </button>
        </div>
      )}
    </div>
  );
}
