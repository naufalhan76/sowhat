import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  tmsIncidentLabel,
  tripMonitorIncidentHistoryStatusLabel,
  tripMonitorIncidentHistoryStatusTone,
  buildTripMonitorIncidentHistoryDescription,
  buildTripMonitorIncidentHistoryLocationLabel,
} from './helpers.jsx';
import { TripMonitorDeepDiveShell } from './TripMonitorDeepDiveShell.jsx';
import { TripMonitorIncidentComments } from './TripMonitorIncidentComments.jsx';

/**
 * Deep-dive Incident History sub-view.
 * Full-width DataTable showing all incidents for a trip monitor row.
 * Self-fetches data from /api/tms/board/detail endpoint.
 */
export function TripMonitorIncidentView({ context, onBack, DataTable, fmtDate, formatMinutesText }) {
  const [incidents, setIncidents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const rowId = context?.rowId || '';

  const fetchIncidents = useCallback(async () => {
    if (!rowId) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ rowId });
      const response = await fetch(`/api/tms/board/detail?${params.toString()}`);
      const payload = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
      setIncidents(payload.detail?.incidentHistory || []);
    } catch (err) {
      setError(err.message || 'Failed to load incident history');
      setIncidents([]);
    } finally {
      setBusy(false);
    }
  }, [rowId]);

  useEffect(() => { fetchIncidents(); }, [fetchIncidents]);

  const fmt = fmtDate || ((v) => v ? new Date(v).toLocaleString('id-ID') : '-');
  const fmtMinutes = formatMinutesText || ((m) => m != null ? `${Math.round(m)} min` : '-');

  const activeCount = incidents.filter((i) => String(i?.status || '').toLowerCase() !== 'resolved').length;
  const resolvedCount = incidents.filter((i) => String(i?.status || '').toLowerCase() === 'resolved').length;

  const columns = [
    'Label', 'Description', 'Severity', 'Status', 'Duration',
    'Anomaly Start', 'Anomaly End', 'Location', 'Actions',
  ];

  const rows = incidents.map((item) => {
    const statusLabel = tripMonitorIncidentHistoryStatusLabel(item.status);
    const statusTone = tripMonitorIncidentHistoryStatusTone(item.status);
    const isExpanded = expandedId === item.id;

    return [
      <strong>{item.label || tmsIncidentLabel(item.incidentCode)}</strong>,
      buildTripMonitorIncidentHistoryDescription(item) || '-',
      <span className={`tm-severity-badge severity-${String(item.severity || 'normal').toLowerCase()}`}>
        {item.severity || 'normal'}
      </span>,
      <span className={`tm-status-pill tone-${statusTone}`}>{statusLabel}</span>,
      item.durationMinutes ? fmtMinutes(item.durationMinutes) : '-',
      fmt(item.openedAt),
      fmt(item.resolvedAt || item.closedAt),
      buildTripMonitorIncidentHistoryLocationLabel(item) || '-',
      <button
        type="button"
        className={`sf-btn sf-btn-bordered sf-btn-sm ${isExpanded ? 'is-active' : ''}`}
        onClick={() => setExpandedId(isExpanded ? null : item.id)}
      >
        {isExpanded ? 'Hide' : 'Comments'}
      </button>,
    ];
  });

  return (
    <TripMonitorDeepDiveShell title="Incident History" context={context} onBack={onBack}>
      <div className="tm-deep-dive-toolbar">
        <span className="tm-deep-dive-count">
          {incidents.length} incidents · {activeCount} active · {resolvedCount} resolved
        </span>
        <button type="button" className="sf-btn sf-btn-bordered sf-btn-sm" onClick={fetchIncidents} disabled={busy}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      {busy ? (
        <div className="empty-state">Loading incident history...</div>
      ) : error ? (
        <div className="empty-state tm-error-state">{error}</div>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            emptyMessage="No incidents recorded for this trip."
            pagination={{ initialRowsPerPage: 20, rowsPerPageOptions: [20, 50, 100] }}
            getRowProps={(row, index) => {
              const item = incidents[index];
              if (!item) return {};
              return expandedId === item.id ? { className: 'tm-incident-row-expanded' } : {};
            }}
          />
          {expandedId ? (
            <div className="tm-incident-comments-panel">
              <TripMonitorIncidentComments
                incidentId={expandedId}
                incident={incidents.find((i) => i.id === expandedId)}
              />
            </div>
          ) : null}
        </>
      )}
    </TripMonitorDeepDiveShell>
  );
}
