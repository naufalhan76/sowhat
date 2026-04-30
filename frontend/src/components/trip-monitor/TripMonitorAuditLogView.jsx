import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Clock, User, FileEdit } from 'lucide-react';
import { TripMonitorDeepDiveShell } from './TripMonitorDeepDiveShell.jsx';

const FIELD_LABELS = {
  stops_override: 'Stops',
  temp_range_override: 'Temp Range',
  force_closed: 'Force Closed',
  shipping_status_override: 'Shipping Status',
  all_overrides: 'All Overrides',
  notes: 'Notes',
};

function formatFieldLabel(field) {
  return FIELD_LABELS[field] || field || '-';
}

function formatAuditValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (value === 'true' || value === true) return 'Yes';
  if (value === 'false' || value === false) return 'No';
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return `${parsed.length} item${parsed.length !== 1 ? 's' : ''}`;
    if (typeof parsed === 'object' && parsed !== null) {
      if (parsed.tempMin != null || parsed.tempMax != null) return `${parsed.tempMin ?? '?'}°C – ${parsed.tempMax ?? '?'}°C`;
      return JSON.stringify(parsed);
    }
  } catch { /* not JSON, use raw */ }
  return String(value).length > 80 ? `${String(value).slice(0, 77)}...` : String(value);
}

/**
 * Deep-dive Override Audit Log sub-view.
 * Timeline view: timestamp + field changed + old→new + who + reason.
 * Self-fetches from GET /api/tms/overrides/:jobOrderId/audit.
 */
export function TripMonitorAuditLogView({ context, onBack, fmtDate }) {
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // jobOrderId comes from the detail row — could be in context.rowId or context.jobOrderId
  const jobOrderId = context?.jobOrderId || context?.rowId || '';

  const fetchAudit = useCallback(async () => {
    if (!jobOrderId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tms/overrides/${encodeURIComponent(jobOrderId)}/audit`);
      const payload = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
      setEntries(payload.audit || []);
    } catch (err) {
      setError(err.message || 'Failed to load audit log');
      setEntries([]);
    } finally {
      setBusy(false);
    }
  }, [jobOrderId]);

  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  const fmt = fmtDate || ((v) => v ? new Date(v).toLocaleString('id-ID') : '-');

  return (
    <TripMonitorDeepDiveShell title="Override Audit Log" context={context} onBack={onBack}>
      <div className="tm-deep-dive-toolbar">
        <span className="tm-deep-dive-count">{entries.length} audit entries</span>
        <button type="button" className="sf-btn sf-btn-bordered sf-btn-sm" onClick={fetchAudit} disabled={busy}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      {busy ? (
        <div className="empty-state">Loading audit log...</div>
      ) : error ? (
        <div className="empty-state tm-error-state">{error}</div>
      ) : entries.length === 0 ? (
        <div className="empty-state">No override changes recorded for this job order.</div>
      ) : (
        <div className="tm-audit-timeline">
          {entries.map((entry, index) => (
            <div key={entry.id || `audit-${index}`} className="tm-audit-entry">
              <div className="tm-audit-rail">
                <div className="tm-audit-dot" />
                {index < entries.length - 1 ? <div className="tm-audit-line" /> : null}
              </div>
              <div className="tm-audit-content">
                <div className="tm-audit-header">
                  <span className="tm-audit-time">
                    <Clock size={12} />
                    {fmt(entry.performed_at)}
                  </span>
                  <span className="tm-audit-user">
                    <User size={12} />
                    {entry.performed_by || 'unknown'}
                  </span>
                </div>
                <div className="tm-audit-field">
                  <FileEdit size={12} />
                  <strong>{formatFieldLabel(entry.field_changed)}</strong>
                </div>
                <div className="tm-audit-diff">
                  <span className="tm-audit-old" title="Previous value">{formatAuditValue(entry.old_value)}</span>
                  <span className="tm-audit-arrow">→</span>
                  <span className="tm-audit-new" title="New value">{formatAuditValue(entry.new_value)}</span>
                </div>
                {entry.reason ? (
                  <div className="tm-audit-reason">
                    <em>Reason:</em> {entry.reason}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </TripMonitorDeepDiveShell>
  );
}
