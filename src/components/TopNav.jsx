import { Users, Calendar, Settings as SettingsIcon, X, BarChart3, ChevronDown, Plus, Shield, WifiOff, RefreshCw, Check } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
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

  const groupedTeams = useMemo(() => {
    const map = new Map();
    (allTeams || []).forEach((t) => {
      const key = `${t.club_id || ''}:::${(t.name || '').trim().toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: (t.name || '').trim(),
          clubId: t.club_id,
          seasons: []
        });
      }
      map.get(key).seasons.push(t);
    });
    return Array.from(map.values());
  }, [allTeams]);

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
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.25rem 0.65rem',
                    fontSize: '0.75rem',
                    maxWidth: '240px'
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{teamInfo.name}</span>
                    <span style={{ opacity: 0.55 }}>•</span>
                    <span style={{ fontWeight: 500 }}>
                      {seasonScope === 'ALL_TIME' ? 'All Seasons' : (teamInfo.season || 'Active')}
                    </span>
                  </span>
                  <ChevronDown size={13} style={{ flexShrink: 0 }} />
                </button>

                {showTeamMenu && (
                  <>
                    <div
                      className="dropdown-backdrop"
                      onClick={() => setShowTeamMenu(false)}
                    />
                    <div className="dropdown-menu" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
                      <div className="dropdown-header">
                        {activeClub ? `${activeClub.name} • Teams & Seasons` : 'Teams & Seasons'}
                      </div>

                      {groupedTeams.map((group, groupIdx) => {
                        const isCurrentTeam = group.seasons.some((s) => s.id === teamInfo?.id);
                        const tClub = allClubs.find((c) => c.id === group.clubId);

                        return (
                          <div key={group.key} className="dropdown-team-group" style={{ marginBottom: '0.4rem' }}>
                            {groupIdx > 0 && <div className="dropdown-divider" style={{ margin: '0.35rem 0' }} />}
                            
                            <div
                              style={{
                                padding: '0.35rem 0.85rem 0.25rem 0.85rem',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                                color: isCurrentTeam ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: isCurrentTeam ? 'rgba(2, 132, 199, 0.05)' : 'transparent'
                              }}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                <Shield size={12} />
                                {group.name}
                              </span>
                              {tClub && (
                                <span style={{ fontSize: '0.65rem', fontWeight: 500, color: 'var(--color-text-muted)', textTransform: 'none' }}>
                                  {tClub.name}
                                </span>
                              )}
                            </div>

                            <div className="dropdown-team-seasons">
                              {group.seasons.map((s) => {
                                const isActive = s.id === teamInfo.id && seasonScope !== 'ALL_TIME';
                                return (
                                  <button
                                    key={s.id}
                                    className={`dropdown-item ${isActive ? 'active' : ''}`}
                                    onClick={() => {
                                      if (onSelectSeasonScope) onSelectSeasonScope('CURRENT');
                                      if (onSelectTeam) onSelectTeam(s);
                                      setShowTeamMenu(false);
                                    }}
                                    style={{ paddingLeft: '1.25rem' }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.5rem' }}>
                                      <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                          <span className="dropdown-item-title" style={{ fontWeight: isActive ? 700 : 500 }}>
                                            {s.season || 'Active Season'}
                                          </span>
                                          {s.league && (
                                            <span
                                              className="badge"
                                              style={{
                                                fontSize: '0.65rem',
                                                padding: '0.1rem 0.4rem',
                                                background: isActive ? 'var(--color-primary-light)' : 'var(--color-border-light)',
                                                color: isActive ? 'var(--color-primary-dark)' : 'var(--color-text-main)',
                                                fontWeight: 600,
                                                border: '1px solid var(--color-border)'
                                              }}
                                            >
                                              {s.league}
                                            </span>
                                          )}
                                        </div>
                                        {s.timeframe && (
                                          <span className="dropdown-item-subtitle" style={{ display: 'block', fontSize: '0.68rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                                            {s.timeframe}
                                          </span>
                                        )}
                                      </div>
                                      {isActive && (
                                        <span className="badge badge-primary flex-row gap-1" style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem', flexShrink: 0 }}>
                                          <Check size={10} /> Active
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}

                              {/* All Time option scoped to this team */}
                              {group.seasons.length > 1 && isCurrentTeam && onSelectSeasonScope && (
                                <button
                                  className={`dropdown-item ${seasonScope === 'ALL_TIME' ? 'active' : ''}`}
                                  onClick={() => {
                                    onSelectSeasonScope('ALL_TIME');
                                    setShowTeamMenu(false);
                                  }}
                                  style={{ paddingLeft: '1.25rem' }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: '0.5rem' }}>
                                    <div>
                                      <span className="dropdown-item-title" style={{ fontWeight: seasonScope === 'ALL_TIME' ? 700 : 500 }}>
                                        All Time (All {group.seasons.length} Seasons)
                                      </span>
                                      <span className="dropdown-item-subtitle" style={{ display: 'block', fontSize: '0.68rem' }}>
                                        Combined stats for {group.name}
                                      </span>
                                    </div>
                                    {seasonScope === 'ALL_TIME' && (
                                      <span className="badge badge-primary flex-row gap-1" style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem' }}>
                                        <Check size={10} /> Active
                                      </span>
                                    )}
                                  </div>
                                </button>
                              )}
                            </div>
                          </div>
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
