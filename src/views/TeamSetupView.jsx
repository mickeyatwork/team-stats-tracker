import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Shield } from 'lucide-react';

export default function TeamSetupView({ userId, onTeamCreated }) {
  const [clubName, setClubName] = useState('Tower Hill FC');
  const [teamName, setTeamName] = useState('Tower Hill U9s');
  const [seasonName, setSeasonName] = useState('2025/26');
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
      const newTeam = {
        user_id: userId,
        name: teamName.trim(),
        season: seasonName.trim(),
        club_id: clubId,
        hide_positions: false
      };

      const { data, error } = await supabase.from('team').insert([newTeam]).select().single();

      if (error) throw error;

      if (data) {
        onTeamCreated(data);
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
              <label className="label">Season</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. 2025/26"
                value={seasonName}
                onChange={(e) => setSeasonName(e.target.value)}
                required
              />
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
