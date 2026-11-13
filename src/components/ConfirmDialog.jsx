import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

/**
 * Reusable modal dialog for warnings, alerts, and destructive confirmations.
 * Replaces native window.alert() and window.confirm() with accessible, in-app dialogs.
 */
export default function ConfirmDialog({
  isOpen,
  title,
  message,
  type = 'warning', // 'warning' | 'danger' | 'info'
  isAlert = false, // When true, only shows the confirm button (alert style)
  confirmText = 'OK',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  confirmDisabled = false,
  loading = false,
  children
}) {
  if (!isOpen) return null;

  const isDanger = type === 'danger';
  const isWarning = type === 'warning';

  const iconBg = isDanger
    ? 'rgba(239, 68, 68, 0.12)'
    : isWarning
    ? 'rgba(245, 158, 11, 0.12)'
    : 'rgba(2, 132, 199, 0.12)';

  const iconColor = isDanger
    ? 'var(--color-danger)'
    : isWarning
    ? '#d97706'
    : 'var(--color-primary)';

  const IconComponent = isDanger ? AlertCircle : isWarning ? AlertTriangle : Info;

  const handleClose = () => {
    if (loading) return;
    if (onCancel) {
      onCancel();
    } else if (onConfirm) {
      onConfirm();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '440px', padding: '1.5rem' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem', marginBottom: '1rem' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: 'var(--radius-lg, 0.75rem)',
              backgroundColor: iconBg,
              color: iconColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <IconComponent size={22} />
          </div>

          <div style={{ flex: 1, minWidth: 0, paddingTop: '0.15rem' }}>
            <h3 className="title-md" style={{ margin: 0, fontSize: '1.15rem', lineHeight: 1.3 }}>
              {title || (isAlert ? 'Notice' : 'Please Confirm')}
            </h3>
          </div>

          <button
            type="button"
            className="btn-icon"
            onClick={handleClose}
            disabled={loading}
            style={{ margin: '-0.35rem -0.35rem 0 0' }}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.5, marginBottom: '1.5rem' }}>
          {message && <p style={{ margin: 0 }}>{message}</p>}
          {children}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
          {!isAlert && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
              disabled={loading}
              style={{ width: 'auto', minWidth: '85px', padding: '0.5rem 1rem' }}
            >
              {cancelText}
            </button>
          )}

          <button
            type="button"
            className={isDanger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={confirmDisabled || loading}
            style={{ width: 'auto', minWidth: '95px', padding: '0.5rem 1rem' }}
          >
            {loading ? 'Please wait...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

