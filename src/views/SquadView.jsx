import { useState } from 'react';
import { Plus, X, Trash2 } from 'lucide-react';
import TopNav from '../components/TopNav';
import { supabase } from '../supabaseClient';

export default function SquadView({
  squad,
  setSquad,
  session,
  teamInfo,
  allTeams,
  onSelectTeam,
  onAddNewTeam,
  setCurrentView
}) {
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerPos, setNewPlayerPos] = useState('FW');
  const [playerToRemove, setPlayerToRemove] = useState(null); // { id, name }

  const addPlayer = async (e) => {
    e.preventDefault();
    if (!newPlayerName) return;

    const tempId = Date.now().toString();
    const newPlayerObj = {
      id: tempId,
      user_id: session.user.id,
      name: newPlayerName,
      position: newPlayerPos
    };

    setSquad([...squad, newPlayerObj]);
    setNewPlayerName('');

    const { data, error } = await supabase
      .from('squad')
      .insert([{ user_id: session.user.id, name: newPlayerObj.name, position: newPlayerObj.position }])
      .select();

    if (error) {
      console.error('Add player error:', error);
    } else if (data && data[0]) {
      setSquad((prev) => prev.map((p) => (p.id === tempId ? data[0] : p)));
    }
  };

  const removePlayer = async (id) => {
    setSquad(squad.filter((p) => p.id !== id));
    setPlayerToRemove(null);
    await supabase.from('squad').delete().eq('id', id);
  };

  return (
    <div className="app-container">
      <TopNav
        title="Squad Management"
        showTabs={true}
        currentView="squad"
        setCurrentView={setCurrentView}
        teamInfo={teamInfo}
        allTeams={allTeams}
        onSelectTeam={onSelectTeam}
        onAddNewTeam={onAddNewTeam}
      />

      <div className="view-container">
        <div className="card">
          <h2 className="title-md">Add Player</h2>
          <form onSubmit={addPlayer} className="flex-row gap-2">
            <input
              type="text"
              className="input"
              placeholder="Player Name"
              value={newPlayerName}
              onChange={(e) => setNewPlayerName(e.target.value)}
              style={{ flex: 1 }}
            />
            {!teamInfo.hide_positions && (
              <select
                className="input select"
                value={newPlayerPos}
                onChange={(e) => setNewPlayerPos(e.target.value)}
                style={{ width: '5.5rem', paddingRight: '1.5rem' }}
              >
                <option value="GK">GK</option>
                <option value="DEF">DEF</option>
                <option value="MID">MID</option>
                <option value="FW">FW</option>
              </select>
            )}
            <button type="submit" className="btn btn-primary" style={{ width: 'auto', padding: '0.875rem' }}>
              <Plus size={20} />
            </button>
          </form>
        </div>

        <div className="card" style={{ padding: 0 }}>
          {squad.map((player) => (
            <div key={player.id} className="list-item">
              <div className="flex-row gap-4">
                <div className="avatar">{player.name.charAt(0).toUpperCase()}</div>
                <div>
                  <div className="item-title">{player.name}</div>
                  {!teamInfo.hide_positions && <div className="item-subtitle">{player.position}</div>}
                </div>
              </div>
              <button onClick={() => setPlayerToRemove({ id: player.id, name: player.name })} className="btn-icon" title="Remove Player">
                <Trash2 size={18} style={{ color: 'var(--color-danger)' }} />
              </button>
            </div>
          ))}
          {squad.length === 0 && <div className="empty-state">No players added yet. Add players above to build your matchday squad!</div>}
        </div>

        {/* Remove Player Confirmation Modal */}
        {playerToRemove && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
          }}>
            <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
              <div className="flex-between mb-4">
                <h3 className="title-md" style={{ marginBottom: 0, color: 'var(--color-danger)' }}>Remove Player?</h3>
                <button onClick={() => setPlayerToRemove(null)} className="btn-icon">
                  <X size={20} />
                </button>
              </div>
              <p style={{ fontSize: '0.9rem', color: 'var(--color-text-main)', marginBottom: '1.5rem' }}>
                Remove <strong>{playerToRemove.name}</strong> from the squad? This will not delete their historical stats from past matches.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  onClick={() => removePlayer(playerToRemove.id)}
                  className="btn btn-primary"
                  style={{ flex: 1, background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                >
                  Yes, Remove
                </button>
                <button onClick={() => setPlayerToRemove(null)} className="btn btn-secondary" style={{ flex: 1 }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
