import { useState, useMemo } from 'react';
import { Target, Award, Shield, Trophy, Activity, Flame, ArrowUpDown, ChevronUp, ChevronDown, Zap, Heart, X } from 'lucide-react';
import TopNav from '../components/TopNav';

export default function StatsView({
  matches,
  squad,
  teamInfo,
  allTeams,
  onSelectTeam,
  onAddNewTeam,
  setCurrentView,
  goalEvents = []
}) {
  // Sort state for squad breakdown table
  const [sortField, setSortField] = useState('ga'); // default sort by G+A
  const [sortDirection, setSortDirection] = useState('desc'); // default descending
  
  // State for expanded leaderboard modal
  const [expandedLeaderboard, setExpandedLeaderboard] = useState(null);

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
        saves: 0,
        cleanSheets: 0
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
              saves: 0,
              cleanSheets: 0
            };
          }
          const pStat = m.stats[pid];
          playerAgg[pid].appearances += 1;
          playerAgg[pid].goals += pStat.goals || 0;
          playerAgg[pid].assists += pStat.assists || 0;
          playerAgg[pid].saves += pStat.saves || 0;
          
          if (pStat.is_goalkeeper && m.opponent_goals === 0 && !m.hide_score) {
            playerAgg[pid].cleanSheets += 1;
          }
        });
      }
    });

    const playerList = Object.values(playerAgg);

    const fullScorers = [...playerList].sort((a, b) => b.goals - a.goals || b.appearances - a.appearances);
    const topScorers = fullScorers.slice(0, 3);
    
    const fullAssists = [...playerList].sort((a, b) => b.assists - a.assists || b.appearances - a.appearances);
    const topAssists = fullAssists.slice(0, 3);
    
    const fullSaves = [...playerList].sort((a, b) => b.saves - a.saves || b.appearances - a.appearances);
    const topSaves = fullSaves.slice(0, 3);
    
    const fullCleanSheets = [...playerList].sort((a, b) => b.cleanSheets - a.cleanSheets || b.appearances - a.appearances);
    const topCleanSheets = fullCleanSheets.slice(0, 3);
    
    const fullInvolvements = [...playerList].sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists) || b.appearances - a.appearances);
    const topInvolvements = fullInvolvements.slice(0, 3);

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
      topSaves,
      topCleanSheets,
      topInvolvements,
      fullScorers,
      fullAssists,
      fullSaves,
      fullCleanSheets,
      fullInvolvements
    };
  }, [matches, squad]);

  const { topCombinations, fullCombinations } = useMemo(() => {
    const combos = {};
    goalEvents.forEach(e => {
      if (!e.scorer_id || !e.assister_id) return;
      const key = [e.scorer_id, e.assister_id].sort().join('__');
      if (!combos[key]) {
        combos[key] = { scorer_id: e.scorer_id, assister_id: e.assister_id, count: 0 };
      }
      combos[key].count += 1;
    });

    const full = Object.values(combos)
      .sort((a, b) => b.count - a.count)
      .map(c => {
        const scorer = squad.find(p => p.id === c.scorer_id);
        const assister = squad.find(p => p.id === c.assister_id);
        return {
          scorerName: scorer ? scorer.name : 'Unknown',
          assisterName: assister ? assister.name : 'Unknown',
          count: c.count
        };
      });

    return { fullCombinations: full, topCombinations: full.slice(0, 5) };
  }, [goalEvents, squad]);

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
        case 'cleanSheets':
          valA = a.cleanSheets;
          valB = b.cleanSheets;
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
            <div className="leaderboard-box" onClick={() => setExpandedLeaderboard('goals')} style={{ cursor: 'pointer', position: 'relative' }}>
              <div className="leaderboard-box-title goals" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span><Target size={16} /> Top Goals</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>View All</span>
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
            <div className="leaderboard-box" onClick={() => setExpandedLeaderboard('assists')} style={{ cursor: 'pointer', position: 'relative' }}>
              <div className="leaderboard-box-title assists" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span><Award size={16} /> Top Assists</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>View All</span>
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

            {/* Top Goal Involvements */}
            <div className="leaderboard-box" onClick={() => setExpandedLeaderboard('involvements')} style={{ cursor: 'pointer', position: 'relative' }}>
              <div className="leaderboard-box-title" style={{ color: 'var(--color-primary-dark)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span><Zap size={16} /> Goal Involvements</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>View All</span>
              </div>
              {statsSummary.topInvolvements.filter((p) => (p.goals + p.assists) > 0).length === 0 ? (
                <div className="empty-sub">No involvements yet</div>
              ) : (
                statsSummary.topInvolvements
                  .filter((p) => (p.goals + p.assists) > 0)
                  .map((p, idx) => (
                    <div key={p.id} className="leaderboard-row">
                      <span className="rank">{idx + 1}.</span>
                      <span className="p-name">{p.name}</span>
                      <span className="p-score" style={{ color: 'var(--color-primary-dark)', background: 'var(--color-primary-light)' }}>
                        {p.goals + p.assists}
                      </span>
                    </div>
                  ))
              )}
            </div>

            {/* Top Saves */}
            <div className="leaderboard-box" onClick={() => setExpandedLeaderboard('saves')} style={{ cursor: 'pointer', position: 'relative' }}>
              <div className="leaderboard-box-title saves" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span><Shield size={16} /> Top Saves</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>View All</span>
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

            {/* Top Clean Sheets */}
            <div className="leaderboard-box" onClick={() => setExpandedLeaderboard('cleanSheets')} style={{ cursor: 'pointer', position: 'relative' }}>
              <div className="leaderboard-box-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#10b981' }}>
                <span><Shield size={16} /> Top Clean Sheets</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>View All</span>
              </div>
              {statsSummary.topCleanSheets.filter((p) => p.cleanSheets > 0).length === 0 ? (
                <div className="empty-sub">No clean sheets recorded yet</div>
              ) : (
                statsSummary.topCleanSheets
                  .filter((p) => p.cleanSheets > 0)
                  .map((p, idx) => (
                    <div key={p.id} className="leaderboard-row">
                      <span className="rank">{idx + 1}.</span>
                      <span className="p-name">{p.name}</span>
                      <span className="p-score" style={{ color: '#059669', background: '#d1fae5' }}>{p.cleanSheets}</span>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>

        {/* Top Combinations */}
        {topCombinations.length > 0 && (
          <div className="card mt-4" onClick={() => setExpandedLeaderboard('combinations')} style={{ cursor: 'pointer', position: 'relative' }}>
            <h2 className="title-md mb-4 flex-between gap-2">
              <span className="flex-row gap-2"><Heart size={20} color="var(--color-primary-dark)" /> <span style={{ color: 'var(--color-primary-dark)' }}>Top Combinations</span></span>
              <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>View All</span>
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              Scorer &amp; assister pairs with the most linked goals this season.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {topCombinations.map((combo, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-lg)',
                    background: idx === 0 ? 'var(--color-primary-light)' : 'var(--color-bg-body)',
                    border: '1px solid',
                    borderColor: idx === 0 ? 'var(--color-primary)' : 'var(--color-border-light)'
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text-muted)', width: '1.5rem' }}>
                    {idx + 1}.
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: idx === 0 ? 'var(--color-primary-dark)' : 'var(--color-text-main)' }}>
                      {combo.scorerName}
                      <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', margin: '0 0.4rem' }}>+</span>
                      {combo.assisterName}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                      {combo.count} linked {combo.count === 1 ? 'goal' : 'goals'} together
                    </div>
                  </div>
                  <div style={{
                    fontWeight: 800, fontSize: '1.25rem',
                    color: idx === 0 ? 'var(--color-primary-dark)' : 'var(--color-text-main)',
                    background: idx === 0 ? 'transparent' : 'var(--color-border-light)',
                    padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-lg)'
                  }}>
                    {combo.count}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
                  {!teamInfo.hide_positions && (
                    <th onClick={() => handleSort('position')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        Pos {renderSortIndicator('position')}
                      </div>
                    </th>
                  )}
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
                  <th onClick={() => handleSort('ga')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      G+A {renderSortIndicator('ga')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('saves')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      Saves {renderSortIndicator('saves')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('cleanSheets')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                      CS {renderSortIndicator('cleanSheets')}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    {!teamInfo.hide_positions && (
                      <td>
                        <span className="badge-pos">{p.position}</span>
                      </td>
                    )}
                    <td style={{ textAlign: 'center' }}>{p.appearances}</td>
                    <td style={{ textAlign: 'center', fontWeight: p.goals > 0 ? 700 : 400, color: p.goals > 0 ? '#ca5d03' : 'inherit' }}>
                      {p.goals}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: p.assists > 0 ? 700 : 400, color: p.assists > 0 ? 'var(--color-secondary-dark)' : 'inherit' }}>
                      {p.assists}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 800, color: sortField === 'ga' ? 'var(--color-primary-dark)' : 'inherit' }}>
                      {p.goals + p.assists}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: p.saves > 0 ? 700 : 400, color: p.saves > 0 ? '#909c2a' : 'inherit' }}>
                      {p.saves}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: p.cleanSheets > 0 ? 700 : 400, color: p.cleanSheets > 0 ? '#10b981' : 'inherit' }}>
                      {p.cleanSheets}
                    </td>
                  </tr>
                ))}
                {sortedPlayers.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--color-text-muted)' }}>
                      No squad stats available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Expanded Leaderboard Modal */}
      {expandedLeaderboard && (
        <div 
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
          }}
          onClick={() => setExpandedLeaderboard(null)}
        >
          <div 
            className="card"
            style={{
              width: '100%',
              maxWidth: '400px',
              maxHeight: '80vh',
              overflowY: 'auto',
              position: 'relative',
              backgroundColor: 'var(--color-bg-body)',
              margin: 0
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => setExpandedLeaderboard(null)}
              style={{
                position: 'absolute',
                top: '1.25rem',
                right: '1.25rem',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--color-border-light)'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <X size={20} />
            </button>
            <h3 className="title-md mb-4 flex-row gap-2" style={{ textTransform: 'capitalize', paddingRight: '2rem' }}>
              {expandedLeaderboard === 'goals' && <><Target size={20} color="var(--color-primary-dark)" /> <span style={{ color: 'var(--color-primary-dark)' }}>Top Goals</span></>}
              {expandedLeaderboard === 'assists' && <><Award size={20} color="var(--color-secondary-dark)" /> <span style={{ color: 'var(--color-secondary-dark)' }}>Top Assists</span></>}
              {expandedLeaderboard === 'involvements' && <><Zap size={20} color="var(--color-primary-dark)" /> <span style={{ color: 'var(--color-primary-dark)' }}>Goal Involvements</span></>}
              {expandedLeaderboard === 'saves' && <><Shield size={20} color="#b45309" /> <span style={{ color: '#b45309' }}>Top Saves</span></>}
              {expandedLeaderboard === 'cleanSheets' && <><Shield size={20} color="#10b981" /> <span style={{ color: '#10b981' }}>Top Clean Sheets</span></>}
              {expandedLeaderboard === 'combinations' && <><Heart size={20} color="var(--color-primary-dark)" /> <span style={{ color: 'var(--color-primary-dark)' }}>Top Combinations</span></>}
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(() => {
                if (expandedLeaderboard === 'combinations') {
                  if (fullCombinations.length === 0) return <div className="empty-sub">No combinations yet</div>;
                  return fullCombinations.map((combo, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.75rem 1rem',
                        borderBottom: '1px solid var(--color-border-light)'
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text-muted)', width: '1.5rem' }}>
                        {idx + 1}.
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text-main)' }}>
                          {combo.scorerName}
                          <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', margin: '0 0.4rem' }}>+</span>
                          {combo.assisterName}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                          {combo.count} linked {combo.count === 1 ? 'goal' : 'goals'} together
                        </div>
                      </div>
                      <div style={{
                        fontWeight: 800, fontSize: '1.25rem',
                        color: 'var(--color-text-main)',
                        background: 'var(--color-border-light)',
                        padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-lg)'
                      }}>
                        {combo.count}
                      </div>
                    </div>
                  ));
                }

                let list = [];
                let metric = '';
                let color = '';
                if (expandedLeaderboard === 'goals') { list = statsSummary.fullScorers.filter(p => p.goals > 0); metric = 'goals'; color = 'goals'; }
                else if (expandedLeaderboard === 'assists') { list = statsSummary.fullAssists.filter(p => p.assists > 0); metric = 'assists'; color = 'assists'; }
                else if (expandedLeaderboard === 'involvements') { list = statsSummary.fullInvolvements.filter(p => (p.goals + p.assists) > 0); metric = 'involvements'; }
                else if (expandedLeaderboard === 'saves') { list = statsSummary.fullSaves.filter(p => p.saves > 0); metric = 'saves'; color = 'saves'; }
                else if (expandedLeaderboard === 'cleanSheets') { list = statsSummary.fullCleanSheets.filter(p => p.cleanSheets > 0); metric = 'cleanSheets'; color = ''; }
                
                if (list.length === 0) return <div className="empty-sub">No stats recorded yet</div>;
                
                return list.map((p, idx) => (
                  <div key={p.id} className="leaderboard-row" style={{ padding: '0.75rem', borderBottom: '1px solid var(--color-border-light)', borderRadius: 0, marginBottom: 0 }}>
                    <span className="rank">{idx + 1}.</span>
                    <span className="p-name">{p.name}</span>
                    <span className={`p-score ${color}`} style={metric === 'involvements' ? { color: 'var(--color-primary-dark)', background: 'var(--color-primary-light)' } : metric === 'cleanSheets' ? { color: '#059669', background: '#d1fae5' } : {}}>
                      {metric === 'goals' ? p.goals : metric === 'assists' ? p.assists : metric === 'saves' ? p.saves : metric === 'cleanSheets' ? p.cleanSheets : (p.goals + p.assists)}
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
