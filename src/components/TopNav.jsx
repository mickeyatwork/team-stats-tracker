import { Users, Calendar, Settings as SettingsIcon, X, BarChart3, ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';

export default function TopNav({
  title,
  rightIcon,
  onBack,
  showTabs,
  currentView,
  setCurrentView,
  teamInfo,
  allTeams = [],
  onSelectTeam,
  onAddNewTeam
}) {
  const [showTeamMenu, setShowTeamMenu] = useState(false);

  return (
    <div className="top-nav" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
      <div className="top-nav-content">
        {onBack ? (
          <button onClick={onBack} className="btn-icon">
            <X size={24} />
          </button>
        ) : null}

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}>
          <h1 className="nav-title text-gradient" style={{ margin: 0 }}>
            {title}
          </h1>

          {teamInfo && allTeams.length > 0 && !onBack && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowTeamMenu(!showTeamMenu)}
                className="team-switcher-btn"
                title="Switch Team / Season"
              >
                <span>{teamInfo.season || 'Active'}</span>
                <ChevronDown size={14} />
              </button>

              {showTeamMenu && (
                <div className="dropdown-menu">
                  <div className="dropdown-header">Switch Team / Season</div>
                  {allTeams.map((t) => (
                    <button
                      key={t.id}
                      className={`dropdown-item ${t.id === teamInfo.id ? 'active' : ''}`}
                      onClick={() => {
                        onSelectTeam(t);
                        setShowTeamMenu(false);
                      }}
                    >
                      <span className="dropdown-item-title">{t.name}</span>
                      <span className="dropdown-item-subtitle">{t.season}</span>
                    </button>
                  ))}
                  <div className="dropdown-divider" />
                  <button
                    className="dropdown-item flex-row gap-2"
                    style={{ color: 'var(--color-primary)' }}
                    onClick={() => {
                      setShowTeamMenu(false);
                      if (onAddNewTeam) onAddNewTeam();
                    }}
                  >
                    <Plus size={16} /> Add New Team / Season
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {rightIcon && <div style={{ marginLeft: 'auto' }}>{rightIcon}</div>}

        {!onBack && (
          <button
            onClick={() => setCurrentView('settings')}
            className={`btn-icon ${currentView === 'settings' ? 'active' : ''}`}
            style={{ marginLeft: rightIcon ? '0.5rem' : 'auto' }}
            title="Settings"
          >
            <SettingsIcon size={20} />
          </button>
        )}
      </div>

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
