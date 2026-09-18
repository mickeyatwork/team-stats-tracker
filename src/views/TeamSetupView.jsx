import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function TeamSetupView({ userId, onTeamCreated }) {
  const [teamName, setTeamName] = useState('');
  const [seasonName, setSeasonName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!teamName || !seasonName) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    const newTeam = { user_id: userId, name: teamName, season: seasonName };
    const { data, error } = await supabase.from('team').insert([newTeam]).select().single();

    if (error) {
      console.error('Team creation error:', error);
      setErrorMsg(error.message);
      setIsSubmitting(false);
      return;
    }

    if (data) {
      onTeamCreated(data);
    }
  };

  return (
    <div className="app-container">
      <div className="view-container" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div className="card" style={{ padding: '2rem' }}>
          <h1 className="title-lg text-gradient">Welcome!</h1>
          <p className="subtitle">Set up your team profile to start tracking match stats.</p>
          <form onSubmit={handleSubmit}>
            <div className="input-group">
              <label className="label">Team Name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. AFC Richmond U10s"
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
                placeholder="e.g. 2024/25"
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
