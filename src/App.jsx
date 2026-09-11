import { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Calendar, Play, Plus, Target, Award, Flag, X, Settings as SettingsIcon, LogOut, CheckCircle, Trash2, Edit2, EyeOff, Eye } from 'lucide-react';
import { supabase } from './supabaseClient';

// --- Utility: Debounce Hook ---
function useDebounceCallback(callback, delay) {
  const timeoutRef = useRef(null);
  const debouncedFunction = useCallback((...args) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => { callback(...args); }, delay);
  }, [callback, delay]);
  return debouncedFunction;
}

export default function App() {
  // --- Auth State ---
  const [session, setSession] = useState(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  // --- App State ---
  const [teamInfo, setTeamInfo] = useState(null);
  const [squad, setSquad] = useState([]);
  const [matches, setMatches] = useState([]);
  const [currentView, setCurrentView] = useState('matches');
  const [activeMatchId, setActiveMatchId] = useState(null);
  const [isAppLoading, setIsAppLoading] = useState(true);

  // --- Form States ---
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerPos, setNewPlayerPos] = useState('FW');
  const [showNewMatchCard, setShowNewMatchCard] = useState(false);
  const [newMatchOpponent, setNewMatchOpponent] = useState('');
  const [newMatchCompType, setNewMatchCompType] = useState('Friendly');
  const [newMatchVariant, setNewMatchVariant] = useState('5-a-side');
  const [newMatchTournamentName, setNewMatchTournamentName] = useState('');
  const [newMatchDate, setNewMatchDate] = useState(new Date().toISOString().split('T')[0]);
  const [newMatchHideScore, setNewMatchHideScore] = useState(false);
  const [newMatchSquadSelection, setNewMatchSquadSelection] = useState([]);
  const [setupData, setSetupData] = useState({ teamName: '', seasonName: '' });

  const activeMatch = matches.find(m => m.id === activeMatchId);

  // --- Initialization & Auth ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setSession(session); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) { fetchAppData(); } else { setIsAppLoading(false); }
  }, [session]);

  // When new match card opens, pre-select all squad members
  useEffect(() => {
    if (showNewMatchCard) {
      setNewMatchSquadSelection(squad.map(p => p.id));
    }
  }, [showNewMatchCard, squad]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
        if (error) throw error;
        alert('Signup successful! Check your email if confirmation is required.');
      }
    } catch (error) { setAuthError(error.message); }
    finally { setAuthLoading(false); }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setTeamInfo(null); setSquad([]); setMatches([]); setCurrentView('matches');
  };

  // --- Data Fetching ---
  const fetchAppData = async () => {
    setIsAppLoading(true);
    try {
      const { data: teamData, error: teamError } = await supabase
        .from('team')
        .select('*')
        .eq('user_id', session.user.id)
        .limit(1)
        .maybeSingle();

      if (teamError) console.error('Team fetch error:', teamError);
      if (teamData) setTeamInfo(teamData);

      const { data: squadData, error: squadError } = await supabase.from('squad').select('*');
      if (squadError) console.error('Squad fetch error:', squadError);
      if (squadData) setSquad(squadData);

      const { data: matchData, error: matchError } = await supabase.from('matches').select('*').order('date', { ascending: false });
      if (matchError) console.error('Matches fetch error:', matchError);
      if (matchData) {
        const { data: statsData } = await supabase.from('match_stats').select('*');
        const matchesWithStats = matchData.map(m => {
          const matchStatsArray = statsData?.filter(s => s.match_id === m.id) || [];
          const statsMap = {};
          matchStatsArray.forEach(s => { statsMap[s.player_id] = { goals: s.goals, assists: s.assists }; });
          return { ...m, stats: statsMap };
        });
        setMatches(matchesWithStats);
      }
    } catch (error) { console.error('fetchAppData exception:', error); }
    finally { setIsAppLoading(false); }
  };

  // --- Actions ---
  const handleSetupSubmit = async (e) => {
    e.preventDefault();
    if (!setupData.teamName) return;
    const newTeam = { user_id: session.user.id, name: setupData.teamName, season: setupData.seasonName };
    setTeamInfo(newTeam);
    const { data, error } = await supabase
      .from('team')
      .insert([newTeam])
      .select()
      .single();
    if (error) {
      console.error('Team save error:', error);
      alert(`Error saving team: ${error.message}`);
    }
    if (data) setTeamInfo(data);
  };

  const addPlayer = async (e) => {
    e.preventDefault();
    if (!newPlayerName) return;
    const newPlayer = { id: Date.now().toString(), user_id: session.user.id, name: newPlayerName, position: newPlayerPos };
    setSquad([...squad, newPlayer]);
    setNewPlayerName('');
    const { data } = await supabase.from('squad').insert([{ user_id: newPlayer.user_id, name: newPlayer.name, position: newPlayer.position }]).select();
    if (data && data[0]) setSquad(prev => prev.map(p => p.id === newPlayer.id ? data[0] : p));
  };

  const removePlayer = async (id) => {
    setSquad(squad.filter(p => p.id !== id));
    await supabase.from('squad').delete().eq('id', id);
  };

  const toggleSquadSelection = (playerId) => {
    setNewMatchSquadSelection(prev =>
      prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]
    );
  };

  const createMatch = async (e) => {
    e.preventDefault();
    if (!newMatchOpponent || newMatchSquadSelection.length === 0) return;

    const initialStats = {};
    newMatchSquadSelection.forEach(pid => { initialStats[pid] = { goals: 0, assists: 0 }; });

    const newMatch = {
      id: Date.now().toString(),
      user_id: session.user.id,
      date: new Date(newMatchDate).toISOString(),
      opponent: newMatchOpponent,
      competition_type: newMatchCompType,
      tournament_name: newMatchCompType === 'Tournament' ? newMatchTournamentName : null,
      match_variant: newMatchVariant,
      team_goals: 0,
      opponent_goals: 0,
      hide_score: newMatchHideScore,
      status: 'active',
      stats: initialStats
    };

    setMatches([newMatch, ...matches]);
    setShowNewMatchCard(false);
    setNewMatchOpponent('');
    setNewMatchHideScore(false);
    setNewMatchDate(new Date().toISOString().split('T')[0]);
    setActiveMatchId(newMatch.id);
    setCurrentView('match_tracker');

    const dbMatch = { ...newMatch };
    delete dbMatch.stats;
    delete dbMatch.id;
    const { data } = await supabase.from('matches').insert([dbMatch]).select();

    if (data && data[0]) {
      const statsToInsert = newMatchSquadSelection.map(pid => ({
        match_id: data[0].id,
        player_id: pid,
        goals: 0,
        assists: 0
      }));
      await supabase.from('match_stats').insert(statsToInsert);
      setMatches(prev => prev.map(m => m.id === newMatch.id ? { ...m, id: data[0].id } : m));
      setActiveMatchId(data[0].id);
    }
  };

  const finishMatch = async (matchId) => {
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, status: 'finished' } : m));
    await supabase.from('matches').update({ status: 'finished' }).eq('id', matchId);
    setCurrentView('matches');
    setActiveMatchId(null);
  };

  const deleteMatch = async (matchId) => {
    if (!window.confirm('Are you sure you want to delete this match? This cannot be undone.')) return;
    setMatches(prev => prev.filter(m => m.id !== matchId));
    await supabase.from('match_stats').delete().eq('match_id', matchId);
    await supabase.from('matches').delete().eq('id', matchId);
  };

  const reopenMatch = async (matchId) => {
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, status: 'active' } : m));
    await supabase.from('matches').update({ status: 'active' }).eq('id', matchId);
    setActiveMatchId(matchId);
    setCurrentView('match_tracker');
  };

  // --- Autosaving with Debounce ---
  const saveMatchScoreToDb = useDebounceCallback(async (matchId, teamGoals, oppGoals) => {
    await supabase.from('matches').update({ team_goals: teamGoals, opponent_goals: oppGoals }).eq('id', matchId);
  }, 1000);

  const updateMatchScore = (matchId, team, delta) => {
    const m = matches.find(x => x.id === matchId);
    if (!m) return;
    const newVal = Math.max(0, m[team] + delta);
    setMatches(matches.map(match => match.id === matchId ? { ...match, [team]: newVal } : match));
    const tGoals = team === 'team_goals' ? newVal : m.team_goals;
    const oGoals = team === 'opponent_goals' ? newVal : m.opponent_goals;
    saveMatchScoreToDb(matchId, tGoals, oGoals);
  };

  const savePlayerStatToDb = useDebounceCallback(async (matchId, playerId, goals, assists) => {
    await supabase.from('match_stats').upsert({ match_id: matchId, player_id: playerId, goals, assists }, { onConflict: 'match_id,player_id' });
  }, 1000);

  const updateMatchStat = (matchId, playerId, stat, delta) => {
    const m = matches.find(x => x.id === matchId);
    if (!m) return;
    const currentStat = m.stats[playerId]?.[stat] || 0;
    const newVal = Math.max(0, currentStat + delta);
    setMatches(matches.map(match => {
      if (match.id !== matchId) return match;
      return { ...match, stats: { ...match.stats, [playerId]: { ...match.stats[playerId], [stat]: newVal } } };
    }));
    const g = stat === 'goals' ? newVal : (m.stats[playerId]?.goals || 0);
    const a = stat === 'assists' ? newVal : (m.stats[playerId]?.assists || 0);
    savePlayerStatToDb(matchId, playerId, g, a);
  };

  // -- Shared Components --
  const TopNav = ({ title, rightIcon, onBack, showTabs }) => (
    <div className="top-nav" style={{flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem'}}>
      <div className="top-nav-content">
        {onBack && (<button onClick={onBack} className="btn-icon"><X size={24}/></button>)}
        <h1 className="nav-title text-gradient">{title}</h1>
        {rightIcon && <div style={{marginLeft: 'auto'}}>{rightIcon}</div>}
        {!onBack && (
          <button onClick={() => setCurrentView('settings')} className="btn-icon" style={{marginLeft: rightIcon ? '0.5rem' : 'auto'}}>
            <SettingsIcon size={20}/>
          </button>
        )}
      </div>
      {showTabs && (
        <div style={{display: 'flex', gap: '1rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.5rem', margin: '0 auto', width: '100%', maxWidth: '32rem'}}>
          <button onClick={() => setCurrentView('matches')} className={`nav-item ${currentView === 'matches' ? 'active' : ''}`} style={{flexDirection: 'row', flex: 1, justifyContent: 'center', padding: '0.5rem'}}>
            <Calendar size={18} strokeWidth={currentView === 'matches' ? 2.5 : 2} /><span>Matches</span>
          </button>
          <button onClick={() => setCurrentView('squad')} className={`nav-item ${currentView === 'squad' ? 'active' : ''}`} style={{flexDirection: 'row', flex: 1, justifyContent: 'center', padding: '0.5rem'}}>
            <Users size={18} strokeWidth={currentView === 'squad' ? 2.5 : 2} /><span>Squad</span>
          </button>
        </div>
      )}
    </div>
  );

  // -- Views --
  if (isAppLoading) return <div className="app-container" style={{justifyContent: 'center', alignItems: 'center'}}>Loading...</div>;

  if (!session) {
    return (
      <div className="app-container" style={{justifyContent: 'center'}}>
        <div className="view-container">
          <div className="card">
            <h1 className="title-lg text-gradient" style={{textAlign: 'center', marginBottom: '2rem'}}>Youth Football Manager</h1>
            <div style={{display: 'flex', gap: '1rem', marginBottom: '1.5rem', backgroundColor: 'var(--color-border-light)', padding: '0.25rem', borderRadius: 'var(--radius-lg)'}}>
              <button onClick={() => setIsLogin(true)} style={{flex: 1, padding: '0.5rem', border: 'none', background: isLogin ? 'var(--color-bg-card)' : 'transparent', borderRadius: 'var(--radius-md)', fontWeight: 600, boxShadow: isLogin ? 'var(--shadow-sm)' : 'none', cursor: 'pointer'}}>Login</button>
              <button onClick={() => setIsLogin(false)} style={{flex: 1, padding: '0.5rem', border: 'none', background: !isLogin ? 'var(--color-bg-card)' : 'transparent', borderRadius: 'var(--radius-md)', fontWeight: 600, boxShadow: !isLogin ? 'var(--shadow-sm)' : 'none', cursor: 'pointer'}}>Sign Up</button>
            </div>
            <form onSubmit={handleAuth}>
              <div className="input-group">
                <label className="label">Email</label>
                <input type="email" required className="input" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="label">Password</label>
                <input type="password" required className="input" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
              </div>
              {authError && <div style={{color: 'var(--color-danger)', fontSize: '0.875rem', marginBottom: '1rem', textAlign: 'center'}}>{authError}</div>}
              <button type="submit" disabled={authLoading} className="btn btn-primary">{authLoading ? 'Loading...' : (isLogin ? 'Login' : 'Sign Up')}</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (!teamInfo) {
    return (
      <div className="app-container">
        <div className="view-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="card" style={{ padding: '2rem' }}>
            <h1 className="title-lg text-gradient">Welcome!</h1>
            <p className="subtitle">Set up your team profile to start tracking.</p>
            <form onSubmit={handleSetupSubmit}>
              <div className="input-group">
                <label className="label">Team Name</label>
                <input type="text" className="input" placeholder="e.g. AFC Richmond U10s" value={setupData.teamName} onChange={e => setSetupData({...setupData, teamName: e.target.value})} required />
              </div>
              <div className="input-group">
                <label className="label">Season</label>
                <input type="text" className="input" placeholder="e.g. 2024/25" value={setupData.seasonName} onChange={e => setSetupData({...setupData, seasonName: e.target.value})} required />
              </div>
              <button type="submit" className="btn btn-primary mt-4">Save Profile</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (currentView === 'settings') {
    return (
      <div className="app-container">
        <TopNav title="Settings" onBack={() => setCurrentView('matches')} />
        <div className="view-container">
          <div className="card">
            <h2 className="title-md">Account</h2>
            <p style={{fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '1.5rem'}}>Logged in as {session.user.email}</p>
            <button onClick={handleSignOut} className="btn btn-secondary" style={{color: 'var(--color-danger)'}}>
              <LogOut size={18}/> Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (currentView === 'squad') {
    return (
      <div className="app-container">
        <TopNav title="Squad Management" showTabs={true} />
        <div className="view-container">
          <div className="card">
            <h2 className="title-md">Add Player</h2>
            <form onSubmit={addPlayer} className="flex-row gap-2">
              <input type="text" className="input" placeholder="Player Name" value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)} style={{ flex: 1 }} />
              <select className="input select" value={newPlayerPos} onChange={e => setNewPlayerPos(e.target.value)} style={{ width: '5rem', paddingRight: '2rem' }}>
                <option>GK</option><option>DEF</option><option>MID</option><option>FW</option>
              </select>
              <button type="submit" className="btn btn-primary" style={{ width: 'auto', padding: '0.875rem' }}><Plus size={20} /></button>
            </form>
          </div>
          <div className="card" style={{ padding: 0 }}>
            {squad.map(player => (
              <div key={player.id} className="list-item">
                <div className="flex-row gap-4">
                  <div className="avatar">{player.name.charAt(0).toUpperCase()}</div>
                  <div>
                    <div className="item-title">{player.name}</div>
                    <div className="item-subtitle">{player.position}</div>
                  </div>
                </div>
                <button onClick={() => removePlayer(player.id)} className="btn-icon"><X size={20} /></button>
              </div>
            ))}
            {squad.length === 0 && <div className="empty-state">No players added yet.</div>}
          </div>
        </div>
      </div>
    );
  }

  if (currentView === 'matches') {
    return (
      <div className="app-container">
        <TopNav title={teamInfo.name} rightIcon={<span style={{fontSize:'0.75rem', fontWeight:'bold', color:'var(--color-primary)'}}>{teamInfo.season}</span>} showTabs={true} />
        <div className="view-container">
          <div className="flex-between mb-4">
            <h2 className="title-md" style={{marginBottom: 0}}>Matches</h2>
            {!showNewMatchCard && (
              <button onClick={() => setShowNewMatchCard(true)} className="btn btn-primary" style={{width: 'auto', padding: '0.5rem 1rem', borderRadius: 'var(--radius-lg)'}}>
                <Plus size={16}/> New Match
              </button>
            )}
          </div>

          {showNewMatchCard && (
            <div className="card">
              <div className="flex-between mb-4">
                <h3 className="title-md" style={{marginBottom: 0}}>Create Match</h3>
                <button onClick={() => setShowNewMatchCard(false)} className="btn-icon"><X size={20}/></button>
              </div>
              <form onSubmit={createMatch}>
                <div className="flex-row gap-4 mb-4">
                  <div style={{flex: 1}}>
                    <label className="label">Opponent</label>
                    <input type="text" className="input" placeholder="Opponent Team" value={newMatchOpponent} onChange={e => setNewMatchOpponent(e.target.value)} required />
                  </div>
                  <div style={{flex: 1}}>
                    <label className="label">Date</label>
                    <input type="date" className="input" value={newMatchDate} onChange={e => setNewMatchDate(e.target.value)} required />
                  </div>
                </div>

                <div className="flex-row gap-4 mb-4">
                  <div style={{flex: 1}}>
                    <label className="label">Type</label>
                    <select className="input select" value={newMatchCompType} onChange={e => setNewMatchCompType(e.target.value)}>
                      <option>Friendly</option><option>League</option><option>Cup</option><option>Tournament</option>
                    </select>
                  </div>
                  <div style={{flex: 1}}>
                    <label className="label">Format</label>
                    <select className="input select" value={newMatchVariant} onChange={e => setNewMatchVariant(e.target.value)}>
                      <option>5-a-side</option><option>7-a-side</option><option>9-a-side</option><option>11-a-side</option>
                    </select>
                  </div>
                </div>

                {newMatchCompType === 'Tournament' && (
                  <div className="input-group">
                    <label className="label">Tournament Name</label>
                    <input type="text" className="input" placeholder="e.g. Summer Cup 2024" value={newMatchTournamentName} onChange={e => setNewMatchTournamentName(e.target.value)} required />
                  </div>
                )}

                {/* Hide Score Toggle */}
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'var(--color-border-light)', borderRadius: 'var(--radius-lg)', marginBottom: '1rem'}}>
                  <div>
                    <div style={{fontWeight: 600, fontSize: '0.875rem'}}>Hide Score</div>
                    <div style={{fontSize: '0.75rem', color: 'var(--color-text-muted)'}}>Useful for younger age groups</div>
                  </div>
                  <button type="button" onClick={() => setNewMatchHideScore(v => !v)}
                    style={{width: '3rem', height: '1.75rem', borderRadius: '999px', border: 'none', cursor: 'pointer', transition: 'background 0.2s', background: newMatchHideScore ? 'var(--color-primary)' : 'var(--color-border)', position: 'relative'}}>
                    <div style={{position: 'absolute', top: '0.2rem', left: newMatchHideScore ? 'calc(100% - 1.35rem)' : '0.2rem', width: '1.35rem', height: '1.35rem', background: 'white', borderRadius: '50%', transition: 'left 0.2s', boxShadow: 'var(--shadow-sm)'}}/>
                  </button>
                </div>

                {/* Matchday Squad Selection */}
                <div className="input-group">
                  <label className="label">Matchday Squad ({newMatchSquadSelection.length} selected)</label>
                  <div style={{border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden'}}>
                    {squad.map(player => {
                      const selected = newMatchSquadSelection.includes(player.id);
                      return (
                        <div key={player.id} onClick={() => toggleSquadSelection(player.id)}
                          style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', cursor: 'pointer', background: selected ? 'var(--color-primary-light)' : 'var(--color-bg-card)', borderBottom: '1px solid var(--color-border-light)', transition: 'background 0.15s'}}>
                          <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
                            <div className="avatar" style={{background: selected ? 'var(--color-primary)' : 'var(--color-border-light)', color: selected ? 'white' : 'var(--color-text-muted)', width: '2rem', height: '2rem', fontSize: '0.875rem'}}>
                              {player.name.charAt(0).toUpperCase()}
                            </div>
                            <span style={{fontWeight: 600, fontSize: '0.875rem', color: selected ? 'var(--color-primary-dark)' : 'var(--color-text-main)'}}>{player.name}</span>
                          </div>
                          <span style={{fontSize: '0.75rem', color: 'var(--color-text-muted)'}}>{player.position}</span>
                        </div>
                      );
                    })}
                    {squad.length === 0 && <div className="empty-state">Add players to your squad first.</div>}
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" disabled={newMatchSquadSelection.length === 0}>
                  <Play size={18}/> Start Match Tracker
                </button>
                {newMatchSquadSelection.length === 0 && <p style={{fontSize: '0.75rem', color: 'var(--color-danger)', marginTop: '0.5rem', textAlign: 'center'}}>Select at least one player.</p>}
              </form>
            </div>
          )}

          {matches.map(match => {
            const date = new Date(match.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            const isFinished = match.status === 'finished';
            return (
              <div key={match.id} className="card" style={{cursor: isFinished ? 'default' : 'pointer'}}
                onClick={!isFinished ? () => { setActiveMatchId(match.id); setCurrentView('match_tracker'); } : undefined}>
                <div className="match-item-header">
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                    <span className="match-date">{date}</span>
                    {isFinished && (
                      <span style={{fontSize: '0.65rem', fontWeight: 700, backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-dark)', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-full)', textTransform: 'uppercase'}}>
                        Full Time
                      </span>
                    )}
                  </div>
                  <div className="badge badge-blue">
                    <Flag size={12} />
                    {match.competition_type === 'Tournament' ? match.tournament_name : match.competition_type || 'Friendly'}
                  </div>
                </div>

                <div className="flex-between mt-4">
                  <div className="item-title" style={{fontSize: '1.125rem'}}>vs {match.opponent}</div>
                  {match.hide_score ? (
                    <div style={{display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--color-text-muted)'}}>
                      <EyeOff size={14}/> Score hidden
                    </div>
                  ) : (
                    <div className="match-score">
                      <span className={match.team_goals > match.opponent_goals ? 'score-win' : match.team_goals < match.opponent_goals ? 'score-loss' : 'score-draw'}>{match.team_goals}</span>
                      <span style={{color: 'var(--color-border)', fontSize: '1rem', fontWeight: 400}}>-</span>
                      <span className={match.opponent_goals > match.team_goals ? 'score-win' : match.opponent_goals < match.team_goals ? 'score-loss' : 'score-draw'}>{match.opponent_goals}</span>
                    </div>
                  )}
                </div>

                {/* Edit/Delete for finished matches */}
                {isFinished && (
                  <div style={{display: 'flex', gap: '0.5rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border-light)'}}>
                    <button onClick={(e) => { e.stopPropagation(); reopenMatch(match.id); }}
                      className="btn btn-secondary" style={{flex: 1, padding: '0.5rem', fontSize: '0.8rem'}}>
                      <Edit2 size={14}/> Re-open
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deleteMatch(match.id); }}
                      className="btn btn-secondary" style={{flex: 1, padding: '0.5rem', fontSize: '0.8rem', color: 'var(--color-danger)'}}>
                      <Trash2 size={14}/> Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {matches.length === 0 && !showNewMatchCard && <div className="empty-state card">No matches recorded yet. Create one to start tracking!</div>}
        </div>
      </div>
    );
  }

  if (currentView === 'match_tracker' && activeMatch) {
    const playersInMatch = activeMatch.stats ? Object.keys(activeMatch.stats).map(pid => {
      const pInfo = squad.find(s => s.id === pid);
      return { id: pid, name: pInfo ? pInfo.name : 'Unknown Player', ...activeMatch.stats[pid] };
    }).sort((a, b) => a.name.localeCompare(b.name)) : [];

    const totalGoals = playersInMatch.reduce((sum, p) => sum + (p.goals || 0), 0);
    const totalAssists = playersInMatch.reduce((sum, p) => sum + (p.assists || 0), 0);

    return (
      <div className="app-container">
        <TopNav
          title={activeMatch.competition_type === 'Tournament' ? activeMatch.tournament_name : `${activeMatch.competition_type || 'Friendly'} Match`}
          onBack={() => { setActiveMatchId(null); setCurrentView('matches'); }}
        />
        <div className="view-container">

          {/* Scoreboard — hidden if hide_score is true */}
          {activeMatch.hide_score ? (
            <div className="card" style={{textAlign: 'center', padding: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: 'var(--color-text-muted)'}}>
              <EyeOff size={16}/>
              <span style={{fontSize: '0.875rem', fontWeight: 600}}>Score hidden for this match</span>
            </div>
          ) : (
            <div className="scoreboard">
              <div className="scoreboard-badge">{activeMatch.match_variant || '5-a-side'}</div>
              <div className="team-col">
                <span className="team-name home">{teamInfo.name}</span>
                <div className="score-controls">
                  <button onClick={() => updateMatchScore(activeMatch.id, 'team_goals', -1)} className="btn-score-minus">-</button>
                  <span className="score-value">{activeMatch.team_goals || 0}</span>
                  <button onClick={() => updateMatchScore(activeMatch.id, 'team_goals', 1)} className="btn-score-plus"><Plus size={20}/></button>
                </div>
              </div>
              <div className="vs-divider">VS</div>
              <div className="team-col">
                <span className="team-name away">{activeMatch.opponent}</span>
                <div className="score-controls">
                  <button onClick={() => updateMatchScore(activeMatch.id, 'opponent_goals', -1)} className="btn-score-minus">-</button>
                  <span className="score-value">{activeMatch.opponent_goals || 0}</span>
                  <button onClick={() => updateMatchScore(activeMatch.id, 'opponent_goals', 1)} className="btn-score-plus away"><Plus size={20}/></button>
                </div>
              </div>
            </div>
          )}

          {/* Player Stats List */}
          <div className="stats-list mt-6">
            <div className="stats-header">
              <span>Matchday Squad</span>
              <div className="stat-cols">
                <div className="stat-col-header goals"><Target size={14}/> Goals</div>
                <div className="stat-col-header assists"><Award size={14}/> Asts</div>
              </div>
            </div>
            <div style={{backgroundColor: 'var(--color-bg-card)'}}>
              {playersInMatch.map(player => (
                <div key={player.id} className="stat-row">
                  <span className="stat-player-name">{player.name}</span>
                  <div className="stat-cols">
                    <div className="stat-control-group">
                      <button onClick={() => updateMatchStat(activeMatch.id, player.id, 'goals', -1)} className="btn-stat">-</button>
                      <span className="stat-value">{player.goals}</span>
                      <button onClick={() => updateMatchStat(activeMatch.id, player.id, 'goals', 1)} className="btn-stat-plus goals"><Plus size={16}/></button>
                    </div>
                    <div className="stat-control-group">
                      <button onClick={() => updateMatchStat(activeMatch.id, player.id, 'assists', -1)} className="btn-stat">-</button>
                      <span className="stat-value">{player.assists}</span>
                      <button onClick={() => updateMatchStat(activeMatch.id, player.id, 'assists', 1)} className="btn-stat-plus assists"><Plus size={16}/></button>
                    </div>
                  </div>
                </div>
              ))}

              {/* Totals Footer */}
              {playersInMatch.length > 0 && (
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', backgroundColor: 'var(--color-border-light)', borderTop: '2px solid var(--color-border)'}}>
                  <span style={{fontWeight: 700, fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em'}}>Totals</span>
                  <div className="stat-cols">
                    <div style={{width: '75px', textAlign: 'center', fontWeight: 800, color: 'var(--color-primary-dark)', fontSize: '0.875rem'}}>{totalGoals}</div>
                    <div style={{width: '75px', textAlign: 'center', fontWeight: 800, color: 'var(--color-secondary-dark)', fontSize: '0.875rem'}}>{totalAssists}</div>
                  </div>
                </div>
              )}

              {playersInMatch.length === 0 && <div className="empty-state">No players in this match.</div>}
            </div>
          </div>

          {/* Finish Match Button */}
          <div style={{marginTop: '1.5rem'}}>
            <button onClick={() => finishMatch(activeMatch.id)} className="btn btn-primary">
              <CheckCircle size={18}/> Finish Match
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <div className="app-container" style={{justifyContent: 'center', alignItems: 'center'}}>Loading...</div>;
}
