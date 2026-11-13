import { useState, useMemo, useRef, useEffect } from 'react';
import { Calendar, Upload, Plus, Trash2, X, Check, AlertCircle, Sparkles } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { parseFixturesText } from '../utils/fixtureUtils';
import { computeSeasonTimeframeFromMatches } from '../utils/seasonUtils';
import { getDefaultMatchVariant } from '../utils/variantPreferences';
import { queueOfflineMatchSnapshot, isOfflineId, markServerUnreachable } from '../utils/offlineSync';
import DatePicker from './DatePicker';

export default function FixtureImportModal({
  isOpen,
  onClose,
  teamInfo,
  session,
  existingMatches = [],
  initialMode = 'bulk', // 'bulk' | 'single'
  editingFixture = null,
  onFixturesImported,
  onFixtureUpdated,
  onSyncTimeframe
}) {
  const [mode, setMode] = useState(initialMode);
  const [defaultComp, setDefaultComp] = useState('League');
  const [defaultVariant, setDefaultVariant] = useState(getDefaultMatchVariant);

  // Bulk Paste / CSV State
  const [rawText, setRawText] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [parseErrors, setParseErrors] = useState([]);
  const fileInputRef = useRef(null);

  // Single Fixture State
  const [singleDate, setSingleDate] = useState(new Date().toISOString().split('T')[0]);
  const [singleOpponent, setSingleOpponent] = useState('');
  const [singleComp, setSingleComp] = useState('League');
  const [singleVariant, setSingleVariant] = useState(getDefaultMatchVariant);

  // Timeframe Sync
  const [autoSyncTimeframe, setAutoSyncTimeframe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Sync modal state when opened or switching between create/edit
  useEffect(() => {
    if (!isOpen) return;
    setSubmitError(null);
    if (editingFixture) {
      setMode('single');
      const d = editingFixture.date ? new Date(editingFixture.date) : null;
      setSingleDate(
        d && !Number.isNaN(d.getTime())
          ? d.toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0]
      );
      setSingleOpponent(editingFixture.opponent || '');
      setSingleComp(editingFixture.competition || 'League');
      setSingleVariant(editingFixture.match_variant || getDefaultMatchVariant());
    } else {
      setMode(initialMode);
    }
  }, [isOpen, editingFixture, initialMode]);

  // Compute preview timeframe if imported/updated
  const previewTimeframe = useMemo(() => {
    if (editingFixture) {
      const updatedList = existingMatches.map((m) =>
        m.id === editingFixture.id ? { ...m, date: singleDate || m.date } : m
      );
      return computeSeasonTimeframeFromMatches(updatedList);
    }
    const candidateFixtures =
      mode === 'bulk'
        ? parsedRows
        : singleOpponent.trim() && singleDate
        ? [{ date: singleDate }]
        : [];
    const combined = [...existingMatches, ...candidateFixtures];
    return computeSeasonTimeframeFromMatches(combined);
  }, [existingMatches, parsedRows, mode, singleOpponent, singleDate, editingFixture]);

  if (!isOpen) return null;

  const handleParseText = (textOverride = null) => {
    const source = textOverride !== null ? textOverride : rawText;
    const { parsed, errors } = parseFixturesText(source, defaultComp, defaultVariant);
    setParsedRows(parsed);
    setParseErrors(errors);
    setSubmitError(null);
  };

  const handleCsvUpload = (e) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = String(evt.target?.result || '');
      setRawText(content);
      handleParseText(content);
    };
    reader.readAsText(file);
  };

  const updateParsedRow = (tempId, field, value) => {
    setParsedRows((prev) =>
      prev.map((row) => (row.tempId === tempId ? { ...row, [field]: value } : row))
    );
  };

  const removeParsedRow = (tempId) => {
    setParsedRows((prev) => prev.filter((row) => row.tempId !== tempId));
  };

  const persistFixtures = async (fixturesToInsert) => {
    if (!fixturesToInsert || fixturesToInsert.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);

    const dbPayloads = fixturesToInsert.map((f) => ({
      user_id: session.user.id,
      team_id: teamInfo?.id || null,
      date: new Date(f.date).toISOString(),
      opponent: f.opponent.trim(),
      competition: f.competition || 'League',
      tournament: null,
      match_variant: f.match_variant || defaultVariant,
      team_goals: 0,
      opponent_goals: 0,
      hide_score: false,
      status: 'scheduled'
    }));

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    let inserted = [];
    let insertError = null;

    if (!isOffline) {
      try {
        const res = await supabase.from('matches').insert(dbPayloads).select();
        if (res.error) {
          insertError = res.error;
        } else if (res.data) {
          inserted = res.data.map((m) => ({ ...m, stats: {} }));
        }
      } catch (err) {
        insertError = err;
      }
    }

    if (isOffline || insertError || inserted.length === 0) {
      if (insertError) {
        console.warn('Could not insert fixtures online, queueing offline:', insertError);
        markServerUnreachable(true);
      }
      inserted = dbPayloads.map((p, idx) => {
        const offlineFixture = {
          ...p,
          id: `offline-match-${Date.now()}-${idx}`,
          stats: {}
        };
        queueOfflineMatchSnapshot(offlineFixture);
        return offlineFixture;
      });
    }

    if (onFixturesImported) {
      onFixturesImported(inserted);
    }

    if (autoSyncTimeframe && onSyncTimeframe && previewTimeframe) {
      await onSyncTimeframe(previewTimeframe);
    }

    setSubmitting(false);
    onClose();
  };

  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    if (parsedRows.length === 0) {
      setSubmitError('Please parse at least one valid fixture before importing.');
      return;
    }
    const invalid = parsedRows.some((r) => !r.date || !r.opponent.trim());
    if (invalid) {
      setSubmitError('All fixtures must have a valid date and opponent name.');
      return;
    }
    await persistFixtures(parsedRows);
  };

  const handleSingleSubmit = async (e) => {
    e.preventDefault();
    if (!singleDate || !singleOpponent.trim()) {
      setSubmitError('Please enter both a date and opponent name.');
      return;
    }

    if (editingFixture) {
      setSubmitting(true);
      setSubmitError(null);
      const updatedFields = {
        date: new Date(`${singleDate}T12:00:00`).toISOString(),
        opponent: singleOpponent.trim(),
        competition: singleComp,
        match_variant: singleVariant
      };

      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      const editingOffline = isOfflineId(editingFixture.id);
      let updatedRow = null;

      if (!isOffline && !editingOffline) {
        try {
          const { data, error } = await supabase
            .from('matches')
            .update(updatedFields)
            .eq('id', editingFixture.id)
            .select();
          if (!error && data?.[0]) {
            updatedRow = { ...editingFixture, ...data[0] };
          } else if (error) {
            console.warn('Could not update fixture online — queueing offline:', error);
            markServerUnreachable(true);
          }
        } catch (err) {
          console.warn('Network error updating fixture — queueing offline:', err);
          markServerUnreachable(true);
        }
      }

      if (!updatedRow) {
        updatedRow = { ...editingFixture, ...updatedFields };
        queueOfflineMatchSnapshot(updatedRow);
      }

      if (onFixtureUpdated) onFixtureUpdated(updatedRow);
      if (autoSyncTimeframe && previewTimeframe && onSyncTimeframe) {
        await onSyncTimeframe(previewTimeframe);
      }
      setSubmitting(false);
      onClose();
      return;
    }

    await persistFixtures([
      {
        date: singleDate,
        opponent: singleOpponent.trim(),
        competition: singleComp,
        match_variant: singleVariant
      }
    ]);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-between mb-3">
          <h3 className="title-md flex-row gap-2" style={{ margin: 0 }}>
            <Calendar size={18} color="var(--color-primary)" />
            {editingFixture ? 'Edit Fixture' : 'Import / Schedule Fixtures'}
          </h3>
          <button type="button" className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Mode Switcher (hidden when editing an existing fixture) */}
        {!editingFixture && (
          <div className="matches-tab-bar" style={{ marginBottom: '1rem' }}>
            <button
              type="button"
              className={`btn-matches-tab ${mode === 'bulk' ? 'active' : ''}`}
              onClick={() => {
                setMode('bulk');
                setSubmitError(null);
              }}
            >
              <Upload size={14} /> Bulk Import (Paste / CSV)
            </button>
            <button
              type="button"
              className={`btn-matches-tab ${mode === 'single' ? 'active' : ''}`}
              onClick={() => {
                setMode('single');
                setSubmitError(null);
              }}
            >
              <Plus size={14} /> Add Single Fixture
            </button>
          </div>
        )}

        {mode === 'bulk' ? (
          <form onSubmit={handleBulkSubmit}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label className="label">Default Competition</label>
                <select
                  className="input"
                  value={defaultComp}
                  onChange={(e) => setDefaultComp(e.target.value)}
                >
                  <option value="League">League</option>
                  <option value="Cup">Cup</option>
                  <option value="Friendly">Friendly</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label className="label">Default Format</label>
                <select
                  className="input"
                  value={defaultVariant}
                  onChange={(e) => setDefaultVariant(e.target.value)}
                >
                  <option value="5v5">5v5</option>
                  <option value="7v7">7v7</option>
                  <option value="9v9">9v9</option>
                  <option value="11v11">11v11</option>
                </select>
              </div>
            </div>

            <div className="input-group">
              <div className="flex-between mb-1" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <label className="label" style={{ marginBottom: 0 }}>
                  Paste Fixture List or Upload CSV
                </label>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    onChange={handleCsvUpload}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn btn-secondary flex-row gap-1"
                    style={{ width: 'auto', fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                  >
                    <Upload size={12} /> Upload .CSV / .TXT
                  </button>
                </div>
              </div>

              <textarea
                className="input"
                rows={5}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={
                  'Paste one fixture per line (Date, Opponent, Venue/Comp):\n12/09/2026, Banbury United, Home, League\n19/09/2026, Eynsham Association, Away, League\n26/09/2026, Witney Vikings, Cup'
                }
                style={{ fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.45 }}
              />
              <div className="flex-between mt-2" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                  Supports DD/MM/YYYY, YYYY-MM-DD, or &quot;12 Sep 2026&quot; separated by comma, tab, or pipe.
                </span>
                <button
                  type="button"
                  onClick={() => handleParseText()}
                  disabled={!rawText.trim()}
                  className="btn btn-secondary"
                  style={{ width: 'auto', fontSize: '0.78rem', padding: '0.35rem 0.85rem' }}
                >
                  Parse Fixtures
                </button>
              </div>
            </div>

            {parseErrors.length > 0 && (
              <div className="alert alert-danger mb-3" style={{ fontSize: '0.78rem' }}>
                <div className="flex-row gap-1" style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                  <AlertCircle size={14} /> Some lines could not be parsed:
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                  {parseErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {parsedRows.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <div className="label" style={{ marginBottom: '0.4rem' }}>
                  Preview ({parsedRows.length} {parsedRows.length === 1 ? 'fixture' : 'fixtures'} ready)
                </div>
                <div
                  style={{
                    maxHeight: '220px',
                    overflowY: 'auto',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.35rem'
                  }}
                >
                  {parsedRows.map((row) => (
                    <div
                      key={row.tempId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.35rem',
                        borderBottom: '1px solid var(--color-border-light)',
                        flexWrap: 'wrap'
                      }}
                    >
                      <DatePicker
                        compact
                        value={row.date}
                        onChange={(val) => updateParsedRow(row.tempId, 'date', val)}
                        style={{ width: '135px' }}
                      />
                      <input
                        type="text"
                        className="input"
                        value={row.opponent}
                        onChange={(e) => updateParsedRow(row.tempId, 'opponent', e.target.value)}
                        placeholder="Opponent"
                        style={{ flex: 1, minWidth: '140px', padding: '0.3rem 0.5rem', fontSize: '0.78rem' }}
                      />
                      <select
                        className="input"
                        value={row.competition}
                        onChange={(e) => updateParsedRow(row.tempId, 'competition', e.target.value)}
                        style={{ width: '95px', padding: '0.3rem 0.4rem', fontSize: '0.78rem' }}
                      >
                        <option value="League">League</option>
                        <option value="Cup">Cup</option>
                        <option value="Friendly">Friendly</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeParsedRow(row.tempId)}
                        className="btn-icon-subtle"
                        style={{ color: 'var(--color-danger)', padding: '0.3rem' }}
                        title="Remove row"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Auto-sync timeframe option */}
            {previewTimeframe && (
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-primary-light)',
                  border: '1px solid rgba(2, 132, 199, 0.2)',
                  marginBottom: '1rem'
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    color: 'var(--color-primary-dark)',
                    fontWeight: 500
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoSyncTimeframe}
                    onChange={(e) => setAutoSyncTimeframe(e.target.checked)}
                    style={{ accentColor: 'var(--color-primary)', width: '16px', height: '16px' }}
                  />
                  <span>
                    <Sparkles size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }} />
                    Update season timeframe to <strong>{previewTimeframe}</strong>
                  </span>
                </label>
              </div>
            )}

            {submitError && <div className="alert alert-danger mb-3">{submitError}</div>}

            <div className="flex-row gap-2">
              <button
                type="submit"
                disabled={submitting || parsedRows.length === 0}
                className="btn btn-primary flex-row gap-1"
                style={{ flex: 1 }}
              >
                <Check size={16} />
                {submitting
                  ? 'Importing...'
                  : `Import ${parsedRows.length || ''} ${parsedRows.length === 1 ? 'Fixture' : 'Fixtures'}`}
              </button>
              <button type="button" onClick={onClose} className="btn btn-secondary" style={{ width: 'auto' }}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSingleSubmit}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
              <div style={{ flex: 1, minWidth: '150px' }}>
                <label className="label">Fixture Date *</label>
                <DatePicker
                  value={singleDate}
                  onChange={setSingleDate}
                  required
                />
              </div>
              <div style={{ flex: 2, minWidth: '180px' }}>
                <label className="label">Opponent *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Banbury United (H)"
                  value={singleOpponent}
                  onChange={(e) => setSingleOpponent(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label className="label">Competition</label>
                <select
                  className="input"
                  value={singleComp}
                  onChange={(e) => setSingleComp(e.target.value)}
                >
                  <option value="League">League</option>
                  <option value="Cup">Cup</option>
                  <option value="Friendly">Friendly</option>
                </select>
              </div>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label className="label">Match Format</label>
                <select
                  className="input"
                  value={singleVariant}
                  onChange={(e) => setSingleVariant(e.target.value)}
                >
                  <option value="5v5">5v5</option>
                  <option value="7v7">7v7</option>
                  <option value="9v9">9v9</option>
                  <option value="11v11">11v11</option>
                </select>
              </div>
            </div>

            {previewTimeframe && (
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-primary-light)',
                  border: '1px solid rgba(2, 132, 199, 0.2)',
                  marginBottom: '1rem'
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    color: 'var(--color-primary-dark)',
                    fontWeight: 500
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoSyncTimeframe}
                    onChange={(e) => setAutoSyncTimeframe(e.target.checked)}
                    style={{ accentColor: 'var(--color-primary)', width: '16px', height: '16px' }}
                  />
                  <span>
                    <Sparkles size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }} />
                    Update season timeframe to <strong>{previewTimeframe}</strong>
                  </span>
                </label>
              </div>
            )}

            {submitError && <div className="alert alert-danger mb-3">{submitError}</div>}

            <div className="flex-row gap-2">
              <button
                type="submit"
                disabled={submitting || !singleOpponent.trim()}
                className="btn btn-primary flex-row gap-1"
                style={{ flex: 1 }}
              >
                <Check size={16} />{' '}
                {submitting
                  ? editingFixture
                    ? 'Saving...'
                    : 'Scheduling...'
                  : editingFixture
                  ? 'Save Changes'
                  : 'Schedule Fixture'}
              </button>
              <button type="button" onClick={onClose} className="btn btn-secondary" style={{ width: 'auto' }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

