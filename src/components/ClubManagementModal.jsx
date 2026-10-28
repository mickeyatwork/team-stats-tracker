import { useState } from 'react';
import { Shield, Plus, X, Edit2, Trash2, MapPin, Check } from 'lucide-react';
import { supabase } from '../supabaseClient';

export default function ClubManagementModal({
  isOpen,
  onClose,
  allClubs = [],
  allTeams = [],
  onClubsUpdated
}) {
  const [newClubName, setNewClubName] = useState('');
  const [newClubLocation, setNewClubLocation] = useState('');
  const [newClubCode, setNewClubCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Edit club state
  const [editingClub, setEditingClub] = useState(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');

  if (!isOpen) return null;

  const handleCreateClub = async (e) => {
    e.preventDefault();
    if (!newClubName.trim()) return;

    setLoading(true);
    setErrorMsg(null);
    try {
      const payload = {
        name: newClubName.trim(),
        location: newClubLocation.trim() || null,
        code: newClubCode.trim().toUpperCase() || null
      };

      const { data, error } = await supabase.from('club').insert([payload]).select().single();
      if (error) throw error;

      if (data && onClubsUpdated) {
        onClubsUpdated([...allClubs, data]);
      }

      setNewClubName('');
      setNewClubLocation('');
      setNewClubCode('');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (club) => {
    setEditingClub(club);
    setEditName(club.name);
    setEditLocation(club.location || '');
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingClub || !editName.trim()) return;

    try {
      const { data, error } = await supabase
        .from('club')
        .update({
          name: editName.trim(),
          location: editLocation.trim() || null
        })
        .eq('id', editingClub.id)
        .select()
        .single();

      if (error) throw error;

      if (data && onClubsUpdated) {
        onClubsUpdated(allClubs.map((c) => (c.id === editingClub.id ? data : c)));
      }
      setEditingClub(null);
    } catch (err) {
      alert(`Failed to update club: ${err.message}`);
    }
  };

  const handleDeleteClub = async (club) => {
    const teamsInClub = allTeams.filter((t) => t.club_id === club.id);
    if (teamsInClub.length > 0) {
      alert(`Cannot delete "${club.name}" because it still contains ${teamsInClub.length} team(s). Reassign or remove the teams first.`);
      return;
    }

    const confirm = window.confirm(`Are you sure you want to delete club "${club.name}"?`);
    if (!confirm) return;

    try {
      const { error } = await supabase.from('club').delete().eq('id', club.id);
      if (error) throw error;

      if (onClubsUpdated) {
        onClubsUpdated(allClubs.filter((c) => c.id !== club.id));
      }
    } catch (err) {
      alert(`Failed to delete club: ${err.message}`);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '520px' }}>
        <div className="flex-between mb-3">
          <h3 className="title-md flex-row gap-2" style={{ margin: 0 }}>
            <Shield size={20} color="var(--color-primary)" /> Manage Clubs &amp; Organizations
          </h3>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
          Clubs house multiple playing teams and squads. You can add unique locations to disambiguate clubs with identical names.
        </p>

        {errorMsg && <div className="alert alert-danger mb-3">{errorMsg}</div>}

        {/* Existing Clubs List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem', maxHeight: '220px', overflowY: 'auto' }}>
          {allClubs.map((club) => {
            const teamCount = allTeams.filter((t) => t.club_id === club.id).length;
            const isEditing = editingClub?.id === club.id;

            if (isEditing) {
              return (
                <form
                  key={club.id}
                  onSubmit={handleSaveEdit}
                  style={{
                    padding: '0.75rem',
                    border: '1px solid var(--color-primary)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-primary-light)'
                  }}
                >
                  <div className="input-group" style={{ marginBottom: '0.5rem' }}>
                    <input
                      type="text"
                      className="input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Club Name"
                      required
                      style={{ height: '34px', fontSize: '0.85rem' }}
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: '0.5rem' }}>
                    <input
                      type="text"
                      className="input"
                      value={editLocation}
                      onChange={(e) => setEditLocation(e.target.value)}
                      placeholder="Location / Town (e.g. Witney)"
                      style={{ height: '34px', fontSize: '0.85rem' }}
                    />
                  </div>
                  <div className="flex-row gap-2">
                    <button type="submit" className="btn btn-primary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}>
                      <Check size={14} /> Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingClub(null)}
                      className="btn btn-secondary"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              );
            }

            return (
              <div
                key={club.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-card)'
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {club.name}
                    {club.location && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 400, display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                        <MapPin size={12} /> {club.location}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                    {teamCount} team{teamCount === 1 ? '' : 's'} housed
                  </div>
                </div>

                <div className="flex-row gap-1">
                  <button
                    type="button"
                    className="btn-icon"
                    title="Edit Club Details"
                    onClick={() => handleStartEdit(club)}
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    title="Delete Club"
                    style={{ color: 'var(--color-danger)' }}
                    onClick={() => handleDeleteClub(club)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add New Club Form */}
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.88rem', fontWeight: 600 }}>Add New Club</h4>
          <form onSubmit={handleCreateClub}>
            <div className="input-group">
              <label className="label">Club Name *</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. AFC Richmond"
                value={newClubName}
                onChange={(e) => setNewClubName(e.target.value)}
                required
              />
            </div>
            <div className="input-group">
              <label className="label">Location / Town (optional disambiguation)</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Richmond, London"
                value={newClubLocation}
                onChange={(e) => setNewClubLocation(e.target.value)}
              />
            </div>
            <div className="flex-row gap-2 mt-3">
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary flex-row gap-1"
                style={{ flex: 1 }}
              >
                <Plus size={16} /> {loading ? 'Adding Club...' : 'Add Club'}
              </button>
              <button type="button" onClick={onClose} className="btn btn-secondary">
                Done
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
