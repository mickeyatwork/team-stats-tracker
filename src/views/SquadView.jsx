import { useState } from 'react';
import { Plus, X, Trash2 } from 'lucide-react';
import TopNav from '../components/TopNav';
import { supabase } from '../supabaseClient';
import { getDefaultOffPlayerIds, setPlayerDefaultOff, togglePlayerDefaultOff } from '../utils/playerPreferences';

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
  const [newPlayerDefaultOff, setNewPlayerDefaultOff] = useState(false);
  const [playerToRemove, setPlayerToRemove] = useState(null); // { id, name }
  const [defaultOffIds, setDefaultOffIds] = useState(getDefaultOffPlayerIds);

  const handleToggleDefaultOff = (playerId) => {
    togglePlayerDefaultOff(playerId);
    setDefaultOffIds(getDefaultOffPlayerIds());
  };

  const addPlayer = async (e) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;

    const tempId = Date.now().toString();
    const newPlayerObj = {
      id: tempId,
      user_id: session.user.id,
      name: newPlayerName.trim(),
      position: newPlayerPos
    };

    if (newPlayerDefaultOff) {
      setPlayerDefaultOff(tempId, true);
      setDefaultOffIds(getDefaultOffPlayerIds());
    }

    setSquad([...squad, newPlayerObj]);
    setNewPlayerName('');
    setNewPlayerDefaultOff(false);

    const { data, error } = await supabase
      .from('squad')
      .insert([{ user_id: session.user.id, name: newPlayerObj.name, position: newPlayerObj.position }])
      .select();

    if (error) {
      console.error('Add player error:', error);
    } else if (data && data[0]) {
      const realId = data[0].id;
      if (newPlayerDefaultOff && realId !== tempId) {
        setPlayerDefaultOff(tempId, false);
        setPlayerDefaultOff(realId, true);
        setDefaultOffIds(getDefaultOffPlayerIds());
      }
      setSquad((prev) => prev.map((p) => (p.id === tempId ? data[0] : p)));
    }
  };

  const removePlayer = async (id) => {
    setSquad(squad.filter((p) => p.id !== id));
    setPlayerDefaultOff(id, false);
    setDefaultOffIds(getDefaultOffPlayerIds());
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
          <form onSubmit={addPlayer}>
            <div className="flex-row gap-2">
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
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.65rem' }}>
              <input
                type="checkbox"
                id="newPlayerDefaultOffCheck"
                checked={newPlayerDefaultOff}
                onChange={(e) => setNewPlayerDefaultOff(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="newPlayerDefaultOffCheck" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                Default as 'Off' in squad selections (e.g. training only player)
              </label>
            </div>
          </form>
        </div>

        {/* Tip / helper info */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0.65rem 0.9rem',
            background: 'var(--color-bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
            marginBottom: '0.75rem',
            fontSize: '0.78rem',
            color: 'var(--color-text-muted)',
            lineHeight: 1.4
          }}
        >
          <span>
            💡 <strong>Squad Selection Default:</strong> Click a player's badge to toggle between <strong>Default: In</strong> and <strong>Default: Off</strong>. Players marked 'Default: Off' will start deselected when setting up match and tournament squads.
          </span>
        </div>

        <div className="card" style={{ padding: 0 }}>
          {squad.map((player) => {
            const isOff = defaultOffIds.includes(String(player.id));
            return (
              <div key={player.id} className="list-item">
                <div className="flex-row gap-4" style={{ minWidth: 0, flex: 1 }}>
                  <div className="avatar">{player.name.charAt(0).toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="item-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {player.name}
                    </div>
                    {!teamInfo.hide_positions && <div className="item-subtitle">{player.position}</div>}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => handleToggleDefaultOff(player.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.25rem 0.6rem',
                      borderRadius: 'var(--radius-full)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: isOff ? '1px solid #fde68a' : '1px solid var(--color-border)',
                      background: isOff ? '#fef3c7' : 'var(--color-border-light)',
                      color: isOff ? '#b45309' : 'var(--color-text-muted)',
                      transition: 'all var(--transition-fast)'
                    }}
                    title={isOff ? "Currently defaulted to OFF. Click to set as Default: In." : "Currently defaulted to IN. Click to set as Default: Off."}
                  >
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: isOff ? '#d97706' : 'var(--color-primary)'
                      }}
                    />
                    {isOff ? 'Default: Off' : 'Default: In'}
                  </button>

                  <button onClick={() => setPlayerToRemove({ id: player.id, name: player.name })} className="btn-icon" title="Remove Player">
                    <Trash2 size={18} style={{ color: 'var(--color-danger)' }} />
                  </button>
                </div>
              </div>
            );
          })}
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
