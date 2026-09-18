import { useState, useMemo } from 'react';
import { Target, Award, Shield, Trophy, Activity, Flame, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import TopNav from '../components/TopNav';

export default function StatsView({
  matches,
  squad,
  teamInfo,
  allTeams,
  onSelectTeam,
  onAddNewTeam,
  setCurrentView
}) {
  // Sort state for squad breakdown table
  const [sortField, setSortField] = useState('ga'); // default sort by G+A
  const [sortDirection, setSortDirection] = useState('desc'); // default descending

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      // Default to ascending for text (name/position), descending for numerical stats
      setSortDirection(field === 'name' || field === 'position' ? 'asc' : 'desc');
    }
  };

  // Aggregate stats from all finished & active matches for the team
  const statsSummary = useMemo(() => {
    let played = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;
    let cleanSheets = 0;

    const playerAgg = {};
    squad.forEach((p) => {
      playerAgg[p.id] = {
        id: p.id,
        name: p.name,
        position: p.position,
        appearances: 0,
        goals: 0,
        assists: 0,
        saves: 0
      };
    });

    matches.forEach((m) => {
      played++;
      goalsFor += m.team_goals || 0;
      goalsAgainst += m.opponent_goals || 0;

      if (!m.hide_score) {
        if (m.opponent_goals === 0) cleanSheets++;
        if (m.team_goals > m.opponent_goals) wins++;
        else if (m.team_goals === m.opponent_goals) draws++;
        else losses++;
      }

      if (m.stats) {
        Object.keys(m.stats).forEach((pid) => {
          if (!playerAgg[pid]) {
            const pInfo = squad.find((s) => s.id === pid);
            playerAgg[pid] = {
              id: pid,
              name: pInfo ? pInfo.name : 'Unknown Player',
              position: pInfo ? pInfo.position : 'FW',
              appearances: 0,
              goals: 0,
              assists: 0,
              saves: 0
            };
          }
          const pStat = m.stats[pid];
          playerAgg[pid].appearances += 1;
          playerAgg[pid].goals += pStat.goals || 0;
          playerAgg[pid].assists += pStat.assists || 0;
          playerAgg[pid].saves += pStat.saves || 0;
        });
      }
    });

    const playerList = Object.values(playerAgg);

    const topScorers = [...playerList].sort((a, b) => b.goals - a.goals || b.appearances - a.appearances).slice(0, 3);
    const topAssists = [...playerList].sort((a, b) => b.assists - a.assists || b.appearances - a.appearances).slice(0, 3);
    const topSaves = [...playerList].sort((a, b) => b.saves - a.saves || b.appearances - a.appearances).slice(0, 3);

    const winRate = played > 0 ? Math.round((wins / played) * 100) : 0;

    return {
      played,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      goalDiff: goalsFor - goalsAgainst,
      cleanSheets,
      winRate,
      playerList,
      topScorers,
      topAssists,
      topSaves
    };
  }, [matches, squad]);

  // Sort player list dynamically based on sortField and sortDirection
  const sortedPlayers = useMemo(() => {
    return [...statsSummary.playerList].sort((a, b) => {
      let valA, valB;
      switch (sortField) {
        case 'name':
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'position':
          valA = a.position;
          valB = b.position;
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'appearances':
          valA = a.appearances;
          valB = b.appearances;
          break;
        case 'goals':
          valA = a.goals;
          valB = b.goals;
          break;
        case 'assists':
          valA = a.assists;
          valB = b.assists;
          break;
        case 'saves':
          valA = a.saves;
          valB = b.saves;
          break;
        case 'ga':
        default:
          valA = a.goals + a.assists;
          valB = b.goals + b.assists;
          break;
      }
      if (valA !== valB) {
        return sortDirection === 'asc' ? valA - valB : valB - valA;
      }
      // Secondary sort tiebreaker by name
      return a.name.localeCompare(b.name);
    });
  }, [statsSummary.playerList, sortField, sortDirection]);

  const renderSortIndicator = (field) => {
    if (sortField !== field) {
      return <ArrowUpDown size={12} style={{ opacity: 0.35, marginLeft: '0.2rem' }} />;
    }
    return sortDirection === 'asc' ? (
      <ChevronUp size={14} style={{ color: 'var(--color-primary-dark)', marginLeft: '0.2rem' }} />
    ) : (
      <ChevronDown size={14} style={{ color: 'var(--color-primary-dark)', marginLeft: '0.2rem' }} />
    );
  };

  return (
    <div className="app-container">
      <TopNav
        title="Team Analytics"
        showTabs={true}
        currentView="stats"
        setCurrentView={setCurrentView}
        teamInfo={teamInfo}
        allTeams={allTeams}
        onSelectTeam={onSelectTeam}
        onAddNewTeam={onAddNewTeam}
      />

      <div className="view-container">
        {/* Key Metrics Grid */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-card-title">
              <Activity size={16} /> Matches Played
            </div>
            <div className="stat-card-value">{statsSummary.played}</div>
            <div className="stat-card-subtitle">
              {statsSummary.wins}W - {statsSummary.draws}D - {statsSummary.losses}L
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-title">
              <Trophy size={16} /> Win Rate
            </div>
            <div className="stat-card-value">{statsSummary.winRate}%</div>
            <div className="stat-card-subtitle">{statsSummary.wins} Wins</div>
          </div>

          <div className="stat-card">
            <div className="stat-card-title">
              <Flame size={16} /> Goals Scored
            </div>
            <div className="stat-card-value">{statsSummary.goalsFor}</div>
            <div className="stat-card-subtitle">GD: {statsSummary.goalDiff >= 0 ? `+${statsSummary.goalDiff}` : statsSummary.goalDiff}</div>
          </div>

          <div className="stat-card">
            <div className="stat-card-title">
              <Shield size={16} /> Clean Sheets
            </div>
            <div className="stat-card-value">{statsSummary.cleanSheets}</div>
            <div className="stat-card-subtitle">Conceded: {statsSummary.goalsAgainst}</div>
          </div>
        </div>

        {/* Leaderboards */}
        <div className="card mt-4">
          <h2 className="title-md mb-4 flex-row gap-2">
            <Trophy size={20} color="var(--color-primary)" /> Leaderboards
          </h2>

          <div className="leaderboard-grid">
            {/* Top Goals */}
            <div className="leaderboard-box">
              <div className="leaderboard-box-title goals">
                <Target size={16} /> Top Goals
              </div>
              {statsSummary.topScorers.filter((p) => p.goals > 0).length === 0 ? (
                <div className="empty-sub">No goals recorded yet</div>
              ) : (
                statsSummary.topScorers
                  .filter((p) => p.goals > 0)
                  .map((p, idx) => (
                    <div key={p.id} className="leaderboard-row">
                      <span className="rank">{idx + 1}.</span>
                      <span className="p-name">{p.name}</span>
                      <span className="p-score goals">{p.goals}</span>
                    </div>
                  ))
              )}
            </div>

            {/* Top Assists */}
            <div className="leaderboard-box">
              <div className="leaderboard-box-title assists">
                <Award size={16} /> Top Assists
              </div>
              {statsSummary.topAssists.filter((p) => p.assists > 0).length === 0 ? (
                <div className="empty-sub">No assists recorded yet</div>
              ) : (
                statsSummary.topAssists
                  .filter((p) => p.assists > 0)
                  .map((p, idx) => (
                    <div key={p.id} className="leaderboard-row">
                      <span className="rank">{idx + 1}.</span>
                      <span className="p-name">{p.name}</span>
                      <span className="p-score assists">{p.assists}</span>
                    </div>
                  ))
              )}
            </div>

            {/* Top Saves */}
            <div className="leaderboard-box">
              <div className="leaderboard-box-title saves">
                <Shield size={16} /> Top Saves
              </div>
              {statsSummary.topSaves.filter((p) => p.saves > 0).length === 0 ? (
                <div className="empty-sub">No saves recorded yet</div>
              ) : (
                statsSummary.topSaves
                  .filter((p) => p.saves > 0)
                  .map((p, idx) => (
                    <div key={p.id} className="leaderboard-row">
                      <span className="rank">{idx + 1}.</span>
                      <span className="p-name">{p.name}</span>
                      <span className="p-score saves">{p.saves}</span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>

        {/* Full Player Breakdown Table */}
        <div className="card mt-4" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="flex-between" style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)' }}>
            <h2 className="title-md" style={{ margin: 0 }}>
              Squad Breakdown
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              Click column headers to sort
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="stats-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      Player {renderSortIndicator('name')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('position')} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      Pos {renderSortIndicator('position')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('appearances')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      Apps {renderSortIndicator('appearances')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('goals')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      Goals {renderSortIndicator('goals')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('assists')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      Asts {renderSortIndicator('assists')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('saves')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      Saves {renderSortIndicator('saves')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('ga')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      G+A {renderSortIndicator('ga')}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>
                      <span className="badge-pos">{p.position}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>{p.appearances}</td>
                    <td style={{ textAlign: 'center', fontWeight: p.goals > 0 ? 700 : 400, color: p.goals > 0 ? 'var(--color-primary-dark)' : 'inherit' }}>
                      {p.goals}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: p.assists > 0 ? 700 : 400, color: p.assists > 0 ? 'var(--color-secondary-dark)' : 'inherit' }}>
                      {p.assists}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: p.saves > 0 ? 700 : 400, color: p.saves > 0 ? '#b45309' : 'inherit' }}>
                      {p.saves}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 800, color: sortField === 'ga' ? 'var(--color-primary-dark)' : 'inherit' }}>
                      {p.goals + p.assists}
                    </td>
                  </tr>
                ))}
                {sortedPlayers.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--color-text-muted)' }}>
                      No squad stats available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
