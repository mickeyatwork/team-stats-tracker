import { useState, useMemo, Fragment } from 'react';
import { Target, Award, Shield, Trophy, Activity, Flame, ArrowUpDown, ChevronUp, ChevronDown, Zap, Heart, X, TrendingUp, Sparkles, Clock } from 'lucide-react';
import TopNav from '../components/TopNav';
import { FEATURE_KEYS, isFeatureEnabled } from '../utils/featureFlags';

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
  // Feature switches (Admin configurable per team)
  const showMatchDynamics = isFeatureEnabled(teamInfo, FEATURE_KEYS.MATCH_DYNAMICS);
  const showEfficiencyRating = isFeatureEnabled(teamInfo, FEATURE_KEYS.EFFICIENCY_RATING);

  // Sort state for squad breakdown table
  const [sortField, setSortField] = useState('ga'); // default sort by G+A
  const [sortDirection, setSortDirection] = useState('desc'); // default descending
  const [tableMode, setTableMode] = useState('totals'); // 'totals' | 'per_game'
  
  // Recent Form state (window: 3 or 5 games)
  const [formWindow, setFormWindow] = useState(3);
  const [formSortField, setFormSortField] = useState('ga');
  const [formSortDirection, setFormSortDirection] = useState('desc');
  const [isFormExpanded, setIsFormExpanded] = useState(false); // Collapsed to top 5 by default

  // State for expanded leaderboard modal
  const [expandedLeaderboard, setExpandedLeaderboard] = useState(null);

  // Competition & Tournament filtering
  const [selectedCompetition, setSelectedCompetition] = useState('ALL');
  const [selectedTournament, setSelectedTournament] = useState('ALL');

  const availableCompetitions = useMemo(() => {
    const set = new Set();
    matches.forEach((m) => {
      if (m.competition) set.add(m.competition);
    });
    const order = ['League', 'Cup', 'Tournament', 'Friendly'];
    const result = order.filter((c) => set.has(c));
    set.forEach((c) => {
      if (!result.includes(c)) result.push(c);
    });
    return result;
  }, [matches]);

  const availableTournaments = useMemo(() => {
    const set = new Set();
    matches.forEach((m) => {
      if (m.competition === 'Tournament' && m.tournament) {
        const parts = m.tournament.split('::');
        if (parts[0]) set.add(parts[0].trim());
      }
    });
    return Array.from(set);
  }, [matches]);

  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      if (selectedCompetition !== 'ALL' && m.competition !== selectedCompetition) {
        return false;
      }
      if (selectedCompetition === 'Tournament' && selectedTournament !== 'ALL') {
        const parts = (m.tournament || '').split('::');
        if (parts[0]?.trim() !== selectedTournament) return false;
      }
      return true;
    });
  }, [matches, selectedCompetition, selectedTournament]);

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
        cleanSheets: 0,
        gamesContributed: 0
      };
    });

    filteredMatches.forEach((m) => {
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
              cleanSheets: 0,
              gamesContributed: 0
            };
          }
          const pStat = m.stats[pid];
          playerAgg[pid].appearances += 1;
          playerAgg[pid].goals += pStat.goals || 0;
          playerAgg[pid].assists += pStat.assists || 0;
          playerAgg[pid].saves += pStat.saves || 0;

          if ((pStat.goals || 0) > 0 || (pStat.assists || 0) > 0) {
            playerAgg[pid].gamesContributed += 1;
          }
          
          if (pStat.is_goalkeeper && m.opponent_goals === 0 && !m.hide_score) {
            playerAgg[pid].cleanSheets += 1;
          }
        });
      }
    });

    const playerList = Object.values(playerAgg).map((p) => {
      const gPerGame = p.appearances > 0 ? p.goals / p.appearances : 0;
      const aPerGame = p.appearances > 0 ? p.assists / p.appearances : 0;
      const gaPerGame = p.appearances > 0 ? (p.goals + p.assists) / p.appearances : 0;
      const savesPerGame = p.appearances > 0 ? p.saves / p.appearances : 0;
      const consistencyRate = p.appearances > 0 ? Math.round((p.gamesContributed / p.appearances) * 100) : 0;
      return {
        ...p,
        gPerGame,
        aPerGame,
        gaPerGame,
        savesPerGame,
        consistencyRate
      };
    });

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
  }, [filteredMatches, squad]);

  const { topCombinations, fullCombinations } = useMemo(() => {
    const combos = {};
    const filteredMatchIds = new Set(filteredMatches.map((m) => m.id));

    goalEvents
      .filter((e) => filteredMatchIds.has(e.match_id))
      .forEach((e) => {
        if (!e.scorer_id || !e.assister_id) return;
        const key = [e.scorer_id, e.assister_id].sort().join('__');
        if (!combos[key]) {
          combos[key] = { scorer_id: e.scorer_id, assister_id: e.assister_id, count: 0 };
        }
        combos[key].count += 1;
      });

    const full = Object.values(combos)
      .sort((a, b) => b.count - a.count)
      .map((c) => {
        const scorer = squad.find((p) => p.id === c.scorer_id);
        const assister = squad.find((p) => p.id === c.assister_id);
        return {
          scorerName: scorer ? scorer.name : 'Unknown',
          assisterName: assister ? assister.name : 'Unknown',
          count: c.count
        };
      });

    return { fullCombinations: full, topCombinations: full.slice(0, 5) };
  }, [goalEvents, filteredMatches, squad]);

  // Sort player list dynamically based on sortField, sortDirection, and tableMode
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
          valA = tableMode === 'per_game' ? a.gPerGame : a.goals;
          valB = tableMode === 'per_game' ? b.gPerGame : b.goals;
          break;
        case 'assists':
          valA = tableMode === 'per_game' ? a.aPerGame : a.assists;
          valB = tableMode === 'per_game' ? b.aPerGame : b.assists;
          break;
        case 'saves':
          valA = tableMode === 'per_game' ? a.savesPerGame : a.saves;
          valB = tableMode === 'per_game' ? b.savesPerGame : b.saves;
          break;
        case 'cleanSheets':
          valA = a.cleanSheets;
          valB = b.cleanSheets;
          break;
        case 'efficiency':
          valA = a.consistencyRate;
          valB = b.consistencyRate;
          if (valA !== valB) {
            return sortDirection === 'asc' ? valA - valB : valB - valA;
          }
          if (a.gamesContributed !== b.gamesContributed) {
            return sortDirection === 'asc' ? a.gamesContributed - b.gamesContributed : b.gamesContributed - a.gamesContributed;
          }
          const gaA = a.goals + a.assists;
          const gaB = b.goals + b.assists;
          if (gaA !== gaB) {
            return sortDirection === 'asc' ? gaA - gaB : gaB - gaA;
          }
          break;
        case 'ga':
        default:
          valA = tableMode === 'per_game' ? a.gaPerGame : a.goals + a.assists;
          valB = tableMode === 'per_game' ? b.gaPerGame : b.goals + b.assists;
          break;
      }
      if (valA !== valB) {
        return sortDirection === 'asc' ? valA - valB : valB - valA;
      }
      // Secondary sort tiebreaker by name
      return a.name.localeCompare(b.name);
    });
  }, [statsSummary.playerList, sortField, sortDirection, tableMode]);

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

  // ==========================================
  // Scoring Milestones & In-Game Dynamics
  // ==========================================
  const milestones = useMemo(() => {
    const hatTricksMap = {};
    const bracesMap = {};
    let maxSingleGameGoals = 0;
    let singleGamePerformances = [];

    filteredMatches.forEach((m) => {
      if (!m.stats) return;
      Object.entries(m.stats).forEach(([pid, stat]) => {
        const g = stat.goals || 0;
        if (g >= 3) {
          hatTricksMap[pid] = (hatTricksMap[pid] || 0) + 1;
        } else if (g === 2) {
          bracesMap[pid] = (bracesMap[pid] || 0) + 1;
        }
        if (g > maxSingleGameGoals) {
          maxSingleGameGoals = g;
          singleGamePerformances = [{
            playerId: pid,
            opponent: m.opponent || 'Opponent',
            date: m.date
          }];
        } else if (g > 0 && g === maxSingleGameGoals) {
          singleGamePerformances.push({
            playerId: pid,
            opponent: m.opponent || 'Opponent',
            date: m.date
          });
        }
      });
    });

    const hatTrickPlayers = Object.entries(hatTricksMap)
      .map(([pid, count]) => {
        const p = squad.find((s) => s.id === pid);
        return { id: pid, name: p ? p.name : 'Unknown', count };
      })
      .sort((a, b) => b.count - a.count);

    const bracePlayers = Object.entries(bracesMap)
      .map(([pid, count]) => {
        const p = squad.find((s) => s.id === pid);
        return { id: pid, name: p ? p.name : 'Unknown', count };
      })
      .sort((a, b) => b.count - a.count);

    const totalHatTricks = Object.values(hatTricksMap).reduce((acc, c) => acc + c, 0);
    const totalBraces = Object.values(bracesMap).reduce((acc, c) => acc + c, 0);

    const recordPerformances = singleGamePerformances.map((perf) => {
      const p = squad.find((s) => s.id === perf.playerId);
      return {
        playerName: p ? p.name : 'Unknown',
        opponent: perf.opponent,
        date: perf.date
      };
    });

    return {
      totalHatTricks,
      totalBraces,
      hatTrickPlayers,
      bracePlayers,
      maxSingleGameGoals,
      recordPerformances
    };
  }, [filteredMatches, squad]);

  const goalDynamics = useMemo(() => {
    const matchIds = new Set(filteredMatches.map((m) => m.id));
    const relevantEvents = goalEvents.filter((e) => matchIds.has(e.match_id));

    const eventsByMatch = {};
    relevantEvents.forEach((e) => {
      if (!eventsByMatch[e.match_id]) eventsByMatch[e.match_id] = [];
      eventsByMatch[e.match_id].push(e);
    });

    let scoredFirstMatches = 0;
    let scoredFirstWins = 0;
    let scoredFirstDraws = 0;
    let scoredFirstLosses = 0;
    const openingScorers = {};
    const soloScorers = {};
    const distributorSets = {};

    let totalTeamGoalsWithEvents = 0;
    let assistedGoalsCount = 0;

    Object.entries(eventsByMatch).forEach(([mId, evts]) => {
      const match = filteredMatches.find((m) => m.id === mId);
      if (!match || match.hide_score) return;

      const sortedEvts = [...evts].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      const firstGoal = sortedEvts[0];
      if (firstGoal) {
        const isTeam = firstGoal.scorer_id !== 'OPPONENT';
        if (isTeam) {
          scoredFirstMatches++;
          if (match.team_goals > match.opponent_goals) scoredFirstWins++;
          else if (match.team_goals === match.opponent_goals) scoredFirstDraws++;
          else scoredFirstLosses++;

          if (firstGoal.scorer_id && firstGoal.scorer_id !== 'UNASSIGNED') {
            openingScorers[firstGoal.scorer_id] = (openingScorers[firstGoal.scorer_id] || 0) + 1;
          }
        }
      }

      sortedEvts.forEach((e) => {
        if (e.scorer_id !== 'OPPONENT') {
          totalTeamGoalsWithEvents++;
          if (e.assister_id) {
            assistedGoalsCount++;
            if (e.scorer_id && e.scorer_id !== 'UNASSIGNED') {
              if (!distributorSets[e.assister_id]) distributorSets[e.assister_id] = new Set();
              distributorSets[e.assister_id].add(e.scorer_id);
            }
          } else {
            // Solo / unassisted goal
            if (e.scorer_id && e.scorer_id !== 'UNASSIGNED') {
              soloScorers[e.scorer_id] = (soloScorers[e.scorer_id] || 0) + 1;
            }
          }
        }
      });
    });

    const scoredFirstWinRate = scoredFirstMatches > 0 
      ? Math.round((scoredFirstWins / scoredFirstMatches) * 100) 
      : 0;

    const assistedPercent = totalTeamGoalsWithEvents > 0 
      ? Math.round((assistedGoalsCount / totalTeamGoalsWithEvents) * 100) 
      : 0;

    const topIcebreakers = Object.entries(openingScorers)
      .map(([pid, count]) => {
        const p = squad.find((s) => s.id === pid);
        return { id: pid, name: p ? p.name : 'Unknown', count };
      })
      .sort((a, b) => b.count - a.count);
    const topIcebreakerCount = topIcebreakers.length > 0 ? topIcebreakers[0].count : 0;
    const icebreakerLeaders = topIcebreakers.filter((p) => p.count === topIcebreakerCount);

    const topSoloScorers = Object.entries(soloScorers)
      .map(([pid, count]) => {
        const p = squad.find((s) => s.id === pid);
        return { id: pid, name: p ? p.name : 'Unknown', count };
      })
      .sort((a, b) => b.count - a.count);
    const topSoloCount = topSoloScorers.length > 0 ? topSoloScorers[0].count : 0;
    const soloLeaders = topSoloScorers.filter((p) => p.count === topSoloCount);

    const topDistributors = Object.entries(distributorSets)
      .map(([pid, set]) => {
        const p = squad.find((s) => s.id === pid);
        return { id: pid, name: p ? p.name : 'Unknown', count: set.size };
      })
      .sort((a, b) => b.count - a.count);
    const topDistCount = topDistributors.length > 0 ? topDistributors[0].count : 0;
    const distributorLeaders = topDistributors.filter((p) => p.count === topDistCount);

    // Efficiency / Consistency leader ("Mr. Reliable")
    // Include all players who share the top consistency rate!
    const minApps = Math.min(2, Math.max(1, filteredMatches.length));
    const eligibleReliable = statsSummary.playerList
      .filter((p) => p.appearances >= minApps && p.gamesContributed > 0)
      .sort((a, b) => b.consistencyRate - a.consistencyRate || b.gamesContributed - a.gamesContributed || (b.goals + b.assists) - (a.goals + a.assists));

    const reliablePool = eligibleReliable.length > 0
      ? eligibleReliable
      : statsSummary.playerList.filter((p) => p.gamesContributed > 0).sort((a, b) => b.consistencyRate - a.consistencyRate || (b.goals + b.assists) - (a.goals + a.assists));

    const topConsistencyRate = reliablePool.length > 0 ? reliablePool[0].consistencyRate : 0;
    const reliableLeaders = reliablePool.filter((p) => p.consistencyRate === topConsistencyRate);

    return {
      scoredFirstMatches,
      scoredFirstWins,
      scoredFirstDraws,
      scoredFirstLosses,
      scoredFirstWinRate,
      totalTeamGoalsWithEvents,
      assistedGoalsCount,
      assistedPercent,
      topIcebreakers,
      icebreakerLeaders,
      topSoloScorers,
      soloLeaders,
      topDistributors,
      distributorLeaders,
      reliableLeaders
    };
  }, [filteredMatches, goalEvents, squad, statsSummary.playerList]);

  // ==========================================
  // Recent Form Calculation
  // ==========================================
  const recentEligibleMatches = useMemo(() => {
    return [...filteredMatches]
      .filter((m) => m.team_goals !== undefined && m.opponent_goals !== undefined)
      .sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        if (dateDiff !== 0) return dateDiff;
        if (b.created_at && a.created_at) {
          return new Date(b.created_at) - new Date(a.created_at);
        }
        return (b.id || 0) - (a.id || 0);
      });
  }, [filteredMatches]);

  const availableMatchCount = recentEligibleMatches.length;
  const effectiveWindow = Math.min(formWindow, availableMatchCount);
  const formMatches = useMemo(() => {
    return recentEligibleMatches.slice(0, effectiveWindow);
  }, [recentEligibleMatches, effectiveWindow]);

  const teamFormStats = useMemo(() => {
    if (formMatches.length === 0) {
      return { matches: [], wins: 0, draws: 0, losses: 0, points: 0, maxPoints: 0, goalsFor: 0, goalsAgainst: 0, cleanSheets: 0 };
    }
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;
    let cleanSheets = 0;

    const matchesList = formMatches.map((m) => {
      const gf = m.team_goals || 0;
      const ga = m.opponent_goals || 0;
      goalsFor += gf;
      goalsAgainst += ga;
      let result = 'D';
      if (!m.hide_score) {
        if (gf > ga) {
          result = 'W';
          wins++;
        } else if (gf === ga) {
          result = 'D';
          draws++;
        } else {
          result = 'L';
          losses++;
        }
        if (ga === 0) cleanSheets++;
      }
      return {
        id: m.id,
        date: m.date,
        opponent: m.opponent || 'Opponent',
        team_goals: gf,
        opponent_goals: ga,
        result,
        hide_score: m.hide_score
      };
    });

    const points = (wins * 3) + draws;
    const maxPoints = formMatches.length * 3;

    return {
      matches: matchesList,
      wins,
      draws,
      losses,
      points,
      maxPoints,
      goalsFor,
      goalsAgainst,
      cleanSheets
    };
  }, [formMatches]);

  const playerFormData = useMemo(() => {
    if (formMatches.length === 0) return [];

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
        cleanSheets: 0,
        matchContributions: []
      };
    });

    formMatches.forEach((m) => {
      const matchStats = m.stats || {};
      Object.keys(matchStats).forEach((pid) => {
        if (!playerAgg[pid]) {
          playerAgg[pid] = {
            id: pid,
            name: 'Unknown Player',
            position: 'FW',
            appearances: 0,
            goals: 0,
            assists: 0,
            saves: 0,
            cleanSheets: 0,
            matchContributions: []
          };
        }
      });

      Object.keys(playerAgg).forEach((pid) => {
        const pStat = matchStats[pid];
        if (pStat) {
          const g = pStat.goals || 0;
          const a = pStat.assists || 0;
          const s = pStat.saves || 0;
          const isGk = !!pStat.is_goalkeeper;
          const cs = isGk && m.opponent_goals === 0 && !m.hide_score ? 1 : 0;

          playerAgg[pid].appearances += 1;
          playerAgg[pid].goals += g;
          playerAgg[pid].assists += a;
          playerAgg[pid].saves += s;
          playerAgg[pid].cleanSheets += cs;

          playerAgg[pid].matchContributions.push({
            matchId: m.id,
            opponent: m.opponent || 'Opponent',
            played: true,
            goals: g,
            assists: a,
            saves: s,
            isGoalkeeper: isGk,
            cleanSheet: cs === 1
          });
        } else {
          playerAgg[pid].matchContributions.push({
            matchId: m.id,
            opponent: m.opponent || 'Opponent',
            played: false,
            goals: 0,
            assists: 0,
            saves: 0,
            isGoalkeeper: false,
            cleanSheet: false
          });
        }
      });
    });

    const activePlayers = Object.values(playerAgg).filter((p) => p.appearances > 0);

    return activePlayers.map((p) => ({
      ...p,
      ga: p.goals + p.assists
    }));
  }, [formMatches, squad]);

  const maxRecentGA = useMemo(() => {
    if (playerFormData.length === 0) return 0;
    return Math.max(...playerFormData.map((p) => p.ga));
  }, [playerFormData]);

  const handleFormSort = (field) => {
    if (formSortField === field) {
      setFormSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setFormSortField(field);
      setFormSortDirection(field === 'name' || field === 'position' ? 'asc' : 'desc');
    }
  };

  const sortedPlayerForm = useMemo(() => {
    return [...playerFormData].sort((a, b) => {
      let valA, valB;
      switch (formSortField) {
        case 'name':
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
          return formSortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'position':
          valA = a.position;
          valB = b.position;
          return formSortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
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
          valA = a.ga;
          valB = b.ga;
          break;
      }
      if (valA !== valB) {
        return formSortDirection === 'asc' ? valA - valB : valB - valA;
      }
      if (b.goals !== a.goals) return b.goals - a.goals;
      if (b.assists !== a.assists) return b.assists - a.assists;
      return a.name.localeCompare(b.name);
    });
  }, [playerFormData, formSortField, formSortDirection]);

  // Limit to top 5 performers unless expanded by the user
  const displayedPlayerForm = useMemo(() => {
    return isFormExpanded ? sortedPlayerForm : sortedPlayerForm.slice(0, 5);
  }, [isFormExpanded, sortedPlayerForm]);

  const renderFormSortIndicator = (field) => {
    if (formSortField !== field) {
      return <ArrowUpDown size={12} style={{ opacity: 0.35, marginLeft: '0.2rem' }} />;
    }
    return formSortDirection === 'asc' ? (
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
        {/* Competition Filter Bar */}
        {availableCompetitions.length > 0 && (
          <div className="competition-filter-bar">
            <button
              className={`btn-comp-filter ${selectedCompetition === 'ALL' ? 'active' : ''}`}
              onClick={() => {
                setSelectedCompetition('ALL');
                setSelectedTournament('ALL');
              }}
            >
              All ({matches.length})
            </button>
            {availableCompetitions.map((comp) => {
              const count = matches.filter((m) => m.competition === comp).length;
              return (
                <button
                  key={comp}
                  className={`btn-comp-filter ${selectedCompetition === comp ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedCompetition(comp);
                    setSelectedTournament('ALL');
                  }}
                >
                  {comp === 'Tournament' ? 'Tournaments' : comp} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Tournament Sub-filter Pills if Tournament is active and multiple exist */}
        {selectedCompetition === 'Tournament' && availableTournaments.length > 1 && (
          <div className="competition-filter-bar" style={{ marginTop: '-0.5rem', marginBottom: '1.25rem' }}>
            <button
              className={`btn-comp-filter ${selectedTournament === 'ALL' ? 'active' : ''}`}
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.65rem' }}
              onClick={() => setSelectedTournament('ALL')}
            >
              All Tournaments
            </button>
            {availableTournaments.map((tName) => (
              <button
                key={tName}
                className={`btn-comp-filter ${selectedTournament === tName ? 'active' : ''}`}
                style={{ fontSize: '0.72rem', padding: '0.2rem 0.65rem' }}
                onClick={() => setSelectedTournament(tName)}
              >
                {tName}
              </button>
            ))}
          </div>
        )}

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

        {/* Recent Form Section */}
        {availableMatchCount > 0 && (
          <div className="card mt-4 form-card">
            <div className="form-card-header">
              <div className="flex-row gap-2" style={{ alignItems: 'center' }}>
                <TrendingUp size={20} color="var(--color-primary-dark)" />
                <h2 className="title-md" style={{ margin: 0 }}>
                  Recent Form
                </h2>
                {sortedPlayerForm.length > 5 && (
                  <span className="badge-form-count">
                    {isFormExpanded ? `All ${sortedPlayerForm.length}` : `Top 5 of ${sortedPlayerForm.length}`}
                  </span>
                )}
              </div>

              {/* Window Switcher: Last 3 or Last 5 */}
              <div className="form-window-toggle">
                <button
                  type="button"
                  className={`btn-form-window ${formWindow === 3 ? 'active' : ''}`}
                  onClick={() => setFormWindow(3)}
                >
                  Last 3
                </button>
                <button
                  type="button"
                  className={`btn-form-window ${formWindow === 5 ? 'active' : ''}`}
                  onClick={() => setFormWindow(5)}
                >
                  Last 5
                </button>
              </div>
            </div>

            {/* Team Form Strip */}
            <div className="team-form-strip">
              <div className="team-form-matches">
                {teamFormStats.matches.map((m) => {
                  const badgeClass = m.result === 'W' ? 'win' : m.result === 'D' ? 'draw' : 'loss';
                  const dateStr = m.date
                    ? new Date(m.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                    : '';
                  return (
                    <div
                      key={m.id}
                      className={`form-match-badge ${badgeClass}`}
                      title={`${m.opponent} (${dateStr}): ${m.team_goals}-${m.opponent_goals}`}
                    >
                      <div className="form-match-res-circle">{m.result}</div>
                      <div className="form-match-info">
                        <span className="form-match-score">
                          {m.hide_score ? 'Played' : `${m.team_goals}-${m.opponent_goals}`}
                        </span>
                        <span className="form-match-opp" title={m.opponent}>vs {m.opponent}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="team-form-summary">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="team-form-pts">
                    {teamFormStats.points}/{teamFormStats.maxPoints} pts
                  </span>
                  <span>•</span>
                  <span>
                    {teamFormStats.wins}W {teamFormStats.draws}D {teamFormStats.losses}L
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>
                    {teamFormStats.goalsFor} GF · {teamFormStats.goalsAgainst} GA
                  </span>
                  {availableMatchCount < formWindow && (
                    <span style={{ fontStyle: 'italic', opacity: 0.8 }}>
                      (All {availableMatchCount} games)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Player Recent Form Table */}
            <div style={{ overflowX: 'auto' }}>
              <table className="stats-table form-table">
                <thead>
                  <tr>
                    <th onClick={() => handleFormSort('name')} style={{ cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        Player {renderFormSortIndicator('name')}
                      </div>
                    </th>
                    {!teamInfo.hide_positions && (
                      <th onClick={() => handleFormSort('position')} style={{ cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          Pos {renderFormSortIndicator('position')}
                        </div>
                      </th>
                    )}
                    <th onClick={() => handleFormSort('appearances')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        Apps {renderFormSortIndicator('appearances')}
                      </div>
                    </th>
                    <th onClick={() => handleFormSort('goals')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        Goals {renderFormSortIndicator('goals')}
                      </div>
                    </th>
                    <th onClick={() => handleFormSort('assists')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        Asts {renderFormSortIndicator('assists')}
                      </div>
                    </th>
                    <th onClick={() => handleFormSort('ga')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        G+A {renderFormSortIndicator('ga')}
                      </div>
                    </th>
                    <th style={{ textAlign: 'center' }}>
                      <div className="form-match-header-group">
                        {formMatches.map((m, idx) => (
                          <Fragment key={m.id || idx}>
                            {idx > 0 && <div className="form-match-header-divider" />}
                            <div className="form-match-header-col" title={`vs ${m.opponent}`}>
                              M{idx + 1}
                            </div>
                          </Fragment>
                        ))}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedPlayerForm.map((p) => {
                    return (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span>{p.name}</span>
                          </div>
                        </td>
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
                        <td style={{ textAlign: 'center', fontWeight: 800, color: formSortField === 'ga' ? 'var(--color-stat-involvements)' : 'inherit' }}>
                          {p.ga}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="form-match-pill-group">
                            {p.matchContributions.map((mc, idx) => (
                              <Fragment key={idx}>
                                {idx > 0 && <div className="form-match-divider" />}
                                {!mc.played ? (
                                  <div className="form-match-slot dnp" title={`vs ${mc.opponent}: Did not play`}>
                                    <span className="form-match-pill dnp">-</span>
                                  </div>
                                ) : !(mc.goals > 0 || mc.assists > 0 || mc.cleanSheet || mc.saves > 0) ? (
                                  <div className="form-match-slot" title={`vs ${mc.opponent}: Played`}>
                                    <span className="form-match-pill played-blank">✓</span>
                                  </div>
                                ) : (
                                  <div className="form-match-slot" title={`vs ${mc.opponent}`}>
                                    {mc.goals > 0 && (
                                      <span className="form-match-pill has-goal" title={`vs ${mc.opponent}: ${mc.goals} ${mc.goals === 1 ? 'goal' : 'goals'}`}>
                                        ⚽<span className="pill-count">{mc.goals}</span>
                                      </span>
                                    )}
                                    {mc.assists > 0 && (
                                      <span className="form-match-pill has-assist" title={`vs ${mc.opponent}: ${mc.assists} ${mc.assists === 1 ? 'assist' : 'assists'}`}>
                                        🎯<span className="pill-count">{mc.assists}</span>
                                      </span>
                                    )}
                                    {mc.cleanSheet && (
                                      <span className="form-match-pill has-cs" title={`vs ${mc.opponent}: Clean Sheet`}>
                                        🛡️<span className="pill-count">CS</span>
                                      </span>
                                    )}
                                    {mc.saves > 0 && (
                                      <span className="form-match-pill has-saves" title={`vs ${mc.opponent}: ${mc.saves} ${mc.saves === 1 ? 'save' : 'saves'}`}>
                                        🧤<span className="pill-count">{mc.saves}</span>
                                      </span>
                                    )}
                                  </div>
                                )}
                              </Fragment>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {displayedPlayerForm.length === 0 && (
                    <tr>
                      <td colSpan={teamInfo.hide_positions ? 6 : 7} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--color-text-muted)' }}>
                        No player appearances in recent matches.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Expand / Collapse Toggle for Top 5 vs All */}
            {sortedPlayerForm.length > 5 && (
              <div style={{ textAlign: 'center', padding: '0.75rem 1rem', borderTop: '1px solid var(--color-border-light)' }}>
                <button
                  type="button"
                  className="btn-form-expand"
                  onClick={() => setIsFormExpanded((prev) => !prev)}
                >
                  {isFormExpanded ? (
                    <>
                      Show Top 5 <ChevronUp size={15} />
                    </>
                  ) : (
                    <>
                      View All ({sortedPlayerForm.length} Players) <ChevronDown size={15} />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

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
              <div className="leaderboard-box-title involvements" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                      <span className="p-score involvements">
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
              <div className="leaderboard-box-title cleanSheets" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                      <span className="p-score cleanSheets">{p.cleanSheets}</span>
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

        {/* In-Game Dynamics & Milestones Card */}
        {filteredMatches.length > 0 && showMatchDynamics && (
          <div className="card mt-4">
            <h2 className="title-md mb-3">
              Match Dynamics &amp; Milestones
            </h2>

            {/* Goal Event Dynamics */}
            <div className="dynamics-section mb-4">
              <h3 className="section-label mb-2">
                Goal Dynamics
              </h3>

              <div className="dynamics-grid">
                {/* Scoring First Card */}
                <div className="dynamics-stat-box">
                  <div className="dynamics-stat-label">Scoring First Record</div>
                  <div className="dynamics-stat-value">
                    {goalDynamics.scoredFirstMatches > 0 ? (
                      <>
                        <span style={{ color: 'var(--color-success-dark)', fontWeight: 800 }}>
                          {goalDynamics.scoredFirstWinRate}%
                        </span>
                        <span className="dynamics-stat-sub">Win Rate when 1-0 up</span>
                      </>
                    ) : (
                      <span className="dynamics-stat-empty">No opening goals recorded</span>
                    )}
                  </div>
                  {goalDynamics.scoredFirstMatches > 0 && (
                    <div className="dynamics-stat-footnote">
                      {goalDynamics.scoredFirstWins}W - {goalDynamics.scoredFirstDraws}D - {goalDynamics.scoredFirstLosses}L ({goalDynamics.scoredFirstMatches} {goalDynamics.scoredFirstMatches === 1 ? 'game' : 'games'})
                    </div>
                  )}
                </div>

                {/* Icebreaker King */}
                <div className="dynamics-stat-box">
                  <div className="dynamics-stat-label">The "Icebreaker" King</div>
                  {goalDynamics.icebreakerLeaders.length > 0 ? (
                    <>
                      <div className="dynamics-stat-value" style={{ color: 'var(--color-secondary-dark)' }}>
                        {goalDynamics.icebreakerLeaders.map((p) => p.name).join(', ')}
                      </div>
                      <div className="dynamics-stat-footnote">
                        Scored the opening goal in {goalDynamics.icebreakerLeaders[0].count} {goalDynamics.icebreakerLeaders[0].count === 1 ? 'game' : 'games'}{goalDynamics.icebreakerLeaders.length > 1 ? ' each' : ''}
                      </div>
                    </>
                  ) : (
                    <div className="dynamics-stat-empty">No opening scorers yet</div>
                  )}
                </div>

                {/* Solo Specialist */}
                <div className="dynamics-stat-box">
                  <div className="dynamics-stat-label">The "Solo Specialist"</div>
                  {goalDynamics.soloLeaders.length > 0 ? (
                    <>
                      <div className="dynamics-stat-value" style={{ color: '#ea580c' }}>
                        {goalDynamics.soloLeaders.map((p) => p.name).join(', ')}
                      </div>
                      <div className="dynamics-stat-footnote">
                        {goalDynamics.soloLeaders[0].count} unassisted {goalDynamics.soloLeaders[0].count === 1 ? 'goal' : 'goals'}{goalDynamics.soloLeaders.length > 1 ? ' each' : ''}
                      </div>
                    </>
                  ) : (
                    <div className="dynamics-stat-empty">No solo goals recorded</div>
                  )}
                </div>

                {/* Ultimate Distributor */}
                <div className="dynamics-stat-box">
                  <div className="dynamics-stat-label">The "Ultimate Distributor"</div>
                  {goalDynamics.distributorLeaders.length > 0 ? (
                    <>
                      <div className="dynamics-stat-value" style={{ color: '#8b5cf6' }}>
                        {goalDynamics.distributorLeaders.map((p) => p.name).join(', ')}
                      </div>
                      <div className="dynamics-stat-footnote">
                        Assisted {goalDynamics.distributorLeaders[0].count} different {goalDynamics.distributorLeaders[0].count === 1 ? 'teammate' : 'teammates'}{goalDynamics.distributorLeaders.length > 1 ? ' each' : ''}
                      </div>
                    </>
                  ) : (
                    <div className="dynamics-stat-empty">No assists recorded yet</div>
                  )}
                </div>

                {/* Mr. Reliable (Efficiency Leader) */}
                {showEfficiencyRating && (
                  <div className="dynamics-stat-box">
                    <div className="dynamics-stat-label">"Mr. Reliable" (Efficiency)</div>
                    {goalDynamics.reliableLeaders.length > 0 ? (
                      <>
                        <div className="dynamics-stat-value" style={{ color: 'var(--color-stat-involvements)' }}>
                          {goalDynamics.reliableLeaders.map((p) => p.name).join(', ')}
                        </div>
                        <div className="dynamics-stat-footnote">
                          Involved in {goalDynamics.reliableLeaders[0].consistencyRate}% of games
                          {goalDynamics.reliableLeaders.every((p) => p.appearances === goalDynamics.reliableLeaders[0].appearances && p.gamesContributed === goalDynamics.reliableLeaders[0].gamesContributed)
                            ? ` (${goalDynamics.reliableLeaders[0].gamesContributed}/${goalDynamics.reliableLeaders[0].appearances} matches)`
                            : ` (${goalDynamics.reliableLeaders.map((p) => `${p.name}: ${p.gamesContributed}/${p.appearances}`).join(', ')})`
                          }
                        </div>
                      </>
                    ) : (
                      <div className="dynamics-stat-empty">No contributions yet</div>
                    )}
                  </div>
                )}

                {/* Teamplay / Assisted Goals Ratio */}
                <div className="dynamics-stat-box dynamics-full-width">
                  <div className="flex-between mb-1">
                    <span className="dynamics-stat-label">Teamplay Index (Assisted Goals)</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
                      {goalDynamics.totalTeamGoalsWithEvents > 0 ? `${goalDynamics.assistedPercent}% Assisted` : '0%'}
                    </span>
                  </div>
                  {goalDynamics.totalTeamGoalsWithEvents > 0 ? (
                    <>
                      <div className="teamplay-bar-track">
                        <div
                          className="teamplay-bar-fill"
                          style={{ width: `${goalDynamics.assistedPercent}%` }}
                        />
                      </div>
                      <div className="flex-between mt-1" style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                        <span>{goalDynamics.assistedGoalsCount} Assisted Goals</span>
                        <span>{goalDynamics.totalTeamGoalsWithEvents - goalDynamics.assistedGoalsCount} Solo / Unassisted</span>
                      </div>
                    </>
                  ) : (
                    <div className="dynamics-stat-empty">No recorded goal events</div>
                  )}
                </div>
              </div>
            </div>

            {/* Scoring Milestones */}
            <div className="milestones-section">
              <h3 className="section-label mb-2">
                Scoring Milestones
              </h3>

              <div className="milestones-grid">
                {/* Hat-Tricks */}
                <div className="milestone-box">
                  <div className="milestone-content">
                    <div className="milestone-title">Hat-Tricks (3+ Goals)</div>
                    <div className="milestone-value">
                      {milestones.totalHatTricks}
                    </div>
                    <div className="milestone-desc">
                      {milestones.hatTrickPlayers.length > 0
                        ? milestones.hatTrickPlayers.map((p) => `${p.name} (${p.count})`).join(', ')
                        : 'None recorded yet'}
                    </div>
                  </div>
                </div>

                {/* Braces */}
                <div className="milestone-box">
                  <div className="milestone-content">
                    <div className="milestone-title">Braces (2 Goals)</div>
                    <div className="milestone-value">
                      {milestones.totalBraces}
                    </div>
                    <div className="milestone-desc">
                      {milestones.bracePlayers.length > 0
                        ? milestones.bracePlayers.map((p) => `${p.name} (${p.count})`).join(', ')
                        : 'None recorded yet'}
                    </div>
                  </div>
                </div>

                {/* Single Match Record */}
                <div className="milestone-box">
                  <div className="milestone-content">
                    <div className="milestone-title">Match Scoring Record</div>
                    {milestones.maxSingleGameGoals > 0 ? (
                      <>
                        <div className="milestone-value" style={{ color: 'var(--color-stat-goals)' }}>
                          {milestones.maxSingleGameGoals} {milestones.maxSingleGameGoals === 1 ? 'Goal' : 'Goals'}
                        </div>
                        <div className="milestone-desc">
                          {milestones.recordPerformances.map((perf, i) => (
                            <span key={i}>
                              {perf.playerName} (vs {perf.opponent}){i < milestones.recordPerformances.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="milestone-desc" style={{ marginTop: '0.25rem' }}>No individual goals recorded</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Full Player Breakdown Table */}
        <div className="card mt-4" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="flex-between" style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 className="title-md" style={{ margin: 0 }}>
              Squad Breakdown
            </h2>
            <div className="table-mode-toggle">
              <button
                type="button"
                className={`btn-table-mode ${tableMode === 'totals' ? 'active' : ''}`}
                onClick={() => setTableMode('totals')}
              >
                Totals
              </button>
              <button
                type="button"
                className={`btn-table-mode ${tableMode === 'per_game' ? 'active' : ''}`}
                onClick={() => setTableMode('per_game')}
              >
                Per Game
              </button>
            </div>
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
                      {tableMode === 'per_game' ? 'G/G' : 'Goals'} {renderSortIndicator('goals')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('assists')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {tableMode === 'per_game' ? 'A/G' : 'Asts'} {renderSortIndicator('assists')}
                    </div>
                  </th>
                  <th onClick={() => handleSort('ga')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {tableMode === 'per_game' ? 'G+A/G' : 'G+A'} {renderSortIndicator('ga')}
                    </div>
                  </th>
                  {showEfficiencyRating && (
                    <th onClick={() => handleSort('efficiency')} style={{ cursor: 'pointer', textAlign: 'center' }} title="Efficiency / Match Involvement: % of games played with at least 1 goal or assist">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {tableMode === 'per_game' ? 'Eff %' : 'Involv %'} {renderSortIndicator('efficiency')}
                      </div>
                    </th>
                  )}
                  <th onClick={() => handleSort('saves')} style={{ cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {tableMode === 'per_game' ? 'Saves/G' : 'Saves'} {renderSortIndicator('saves')}
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
                {sortedPlayers.map((p) => {
                  const goalsDisplay = tableMode === 'per_game' ? (p.appearances > 0 ? p.gPerGame.toFixed(2) : '-') : p.goals;
                  const assistsDisplay = tableMode === 'per_game' ? (p.appearances > 0 ? p.aPerGame.toFixed(2) : '-') : p.assists;
                  const gaDisplay = tableMode === 'per_game' ? (p.appearances > 0 ? p.gaPerGame.toFixed(2) : '-') : (p.goals + p.assists);
                  const savesDisplay = tableMode === 'per_game' ? (p.appearances > 0 ? p.savesPerGame.toFixed(2) : '-') : p.saves;
                  const hasGoals = (tableMode === 'per_game' ? p.gPerGame : p.goals) > 0;
                  const hasAssists = (tableMode === 'per_game' ? p.aPerGame : p.assists) > 0;
                  const hasSaves = (tableMode === 'per_game' ? p.savesPerGame : p.saves) > 0;

                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      {!teamInfo.hide_positions && (
                        <td>
                          <span className="badge-pos">{p.position}</span>
                        </td>
                      )}
                      <td style={{ textAlign: 'center' }}>{p.appearances}</td>
                      <td style={{ textAlign: 'center', fontWeight: hasGoals ? 700 : 400, color: hasGoals ? 'var(--color-stat-goals)' : 'inherit' }}>
                        {goalsDisplay}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: hasAssists ? 700 : 400, color: hasAssists ? 'var(--color-secondary-dark)' : 'inherit' }}>
                        {assistsDisplay}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: sortField === 'ga' ? 'var(--color-stat-involvements)' : 'inherit' }}>
                        {gaDisplay}
                      </td>
                      {showEfficiencyRating && (
                        <td style={{ textAlign: 'center', fontWeight: p.consistencyRate > 0 ? 600 : 400, color: p.consistencyRate >= 50 ? 'var(--color-stat-involvements)' : 'inherit' }}>
                          {p.appearances > 0 ? `${p.consistencyRate}%` : '-'}
                          {p.appearances > 0 && (
                            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                              ({p.gamesContributed}/{p.appearances})
                            </div>
                          )}
                        </td>
                      )}
                      <td style={{ textAlign: 'center', fontWeight: hasSaves ? 700 : 400, color: hasSaves ? 'var(--color-stat-saves)' : 'inherit' }}>
                        {savesDisplay}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: p.cleanSheets > 0 ? 700 : 400, color: p.cleanSheets > 0 ? 'var(--color-stat-clean-sheets)' : 'inherit' }}>
                        {p.cleanSheets}
                      </td>
                    </tr>
                  );
                })}
                {sortedPlayers.length === 0 && (
                  <tr>
                    <td colSpan={(teamInfo.hide_positions ? 7 : 8) + (showEfficiencyRating ? 1 : 0)} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--color-text-muted)' }}>
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
              {expandedLeaderboard === 'goals' && <><Target size={20} color="var(--color-stat-goals)" /> <span style={{ color: 'var(--color-stat-goals)' }}>Top Goals</span></>}
              {expandedLeaderboard === 'assists' && <><Award size={20} color="var(--color-stat-assists)" /> <span style={{ color: 'var(--color-stat-assists)' }}>Top Assists</span></>}
              {expandedLeaderboard === 'involvements' && <><Zap size={20} color="var(--color-stat-involvements)" /> <span style={{ color: 'var(--color-stat-involvements)' }}>Goal Involvements</span></>}
              {expandedLeaderboard === 'saves' && <><Shield size={20} color="var(--color-stat-saves)" /> <span style={{ color: 'var(--color-stat-saves)' }}>Top Saves</span></>}
              {expandedLeaderboard === 'cleanSheets' && <><Shield size={20} color="var(--color-stat-clean-sheets)" /> <span style={{ color: 'var(--color-stat-clean-sheets)' }}>Top Clean Sheets</span></>}
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
                else if (expandedLeaderboard === 'involvements') { list = statsSummary.fullInvolvements.filter(p => (p.goals + p.assists) > 0); metric = 'involvements'; color = 'involvements'; }
                else if (expandedLeaderboard === 'saves') { list = statsSummary.fullSaves.filter(p => p.saves > 0); metric = 'saves'; color = 'saves'; }
                else if (expandedLeaderboard === 'cleanSheets') { list = statsSummary.fullCleanSheets.filter(p => p.cleanSheets > 0); metric = 'cleanSheets'; color = 'cleanSheets'; }
                
                if (list.length === 0) return <div className="empty-sub">No stats recorded yet</div>;
                
                return list.map((p, idx) => (
                  <div key={p.id} className="leaderboard-row" style={{ padding: '0.75rem', borderBottom: '1px solid var(--color-border-light)', borderRadius: 0, marginBottom: 0 }}>
                    <span className="rank">{idx + 1}.</span>
                    <span className="p-name">{p.name}</span>
                    <span className={`p-score ${color}`}>
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
