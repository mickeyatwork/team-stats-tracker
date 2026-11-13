import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function TeamSetupView({ userId, onTeamCreated }) {
  const [clubName, setClubName] = useState('Tower Hill FC');
  const [teamName, setTeamName] = useState('Tower Hill U10s');
  const [seasonName, setSeasonName] = useState('2026/27');
  const [leagueName, setLeagueName] = useState('Autumn League');
  const [timeframe, setTimeframe] = useState('September 2026 – December 2026');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!teamName.trim() || !seasonName.trim()) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      // 1. Ensure club exists
      let clubId = null;
      if (clubName.trim()) {
        try {
          const { data: existingClub } = await supabase
            .from('club')
            .select('id')
            .eq('name', clubName.trim())
            .maybeSingle();

          if (existingClub) {
            clubId = existingClub.id;
          } else {
            const { data: newClub } = await supabase
              .from('club')
              .insert([{ name: clubName.trim(), location: 'Witney' }])
              .select('id')
              .single();
            if (newClub) clubId = newClub.id;
          }
        } catch {
          // club table might not be migrated yet, continue without it
        }
      }

      // 2. Create team
      const cleanLeague = leagueName.trim();
      const cleanTimeframe = timeframe.trim();

      const newTeam = {
        user_id: userId,
        name: teamName.trim(),
        season: seasonName.trim(),
        league: cleanLeague || null,
        timeframe: cleanTimeframe || null,
        club_id: clubId,
        hide_positions: false,
        settings: {
          ...(cleanLeague ? { league: cleanLeague } : {}),
          ...(cleanTimeframe ? { timeframe: cleanTimeframe } : {})
        }
      };

      let { data, error } = await supabase.from('team').insert([newTeam]).select().single();

      if (error && (error.message?.includes('column') || error.code === '42703' || error.code === 'PGRST204')) {
        const { league: _omitL, timeframe: _omitT, ...fallback } = newTeam;
        const retry = await supabase.from('team').insert([fallback]).select().single();
        data = retry.data;
        error = retry.error;
      }

      if (error && (error.message?.includes('settings') || error.code === 'PGRST204')) {
        const { settings: _omitS, league: _omitL, timeframe: _omitT, ...bare } = newTeam;
        const retry = await supabase.from('team').insert([bare]).select().single();
        data = retry.data;
        error = retry.error;
      }

      if (error) throw error;

      if (data) {
        try {
          if (cleanLeague) localStorage.setItem(`team_league_${data.id}`, cleanLeague);
          if (cleanTimeframe) localStorage.setItem(`team_timeframe_${data.id}`, cleanTimeframe);
        } catch {}

        onTeamCreated({
          ...data,
          league: cleanLeague || '',
          timeframe: cleanTimeframe || ''
        });
      }
    } catch (error) {
      console.error('Team creation error:', error);
      setErrorMsg(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-container">
      <div className="view-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div className="card" style={{ padding: '2rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <h1 className="title-lg text-gradient" style={{ margin: 0 }}>Welcome to Team Tracker!</h1>
            <p className="subtitle" style={{ marginTop: '0.4rem' }}>
              Set up your club and team profile to start recording match stats.
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="input-group">
              <label className="label">Club Name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Tower Hill FC"
                value={clubName}
                onChange={(e) => setClubName(e.target.value)}
                required
              />
            </div>
            <div className="input-group">
              <label className="label">Team / Sub-team Name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Tower Hill U9s"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                required
              />
            </div>
            <div className="input-group">
              <label className="label">Season *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. 2026/27"
                value={seasonName}
                onChange={(e) => setSeasonName(e.target.value)}
                required
              />
            </div>
            <div className="input-group">
              <label className="label">League / Competition (optional)</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Autumn League, Spring League"
                value={leagueName}
                onChange={(e) => setLeagueName(e.target.value)}
              />
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.2rem', display: 'block' }}>
                Helps separate sub-seasons (e.g. Autumn League, Spring League).
              </span>
            </div>
            <div className="input-group">
              <label className="label">Season Timeframe / Dates (optional)</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. September 2026 – December 2026"
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
              />
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.2rem', display: 'block' }}>
                The scheduled months or dates for this season or league.
              </span>
            </div>

            {errorMsg && <div className="alert alert-danger">{errorMsg}</div>}

            <button type="submit" disabled={isSubmitting} className="btn btn-primary mt-4">
              {isSubmitting ? 'Saving Profile...' : 'Save Profile & Get Started'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
