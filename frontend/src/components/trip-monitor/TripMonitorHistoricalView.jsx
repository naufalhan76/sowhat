import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Download } from 'lucide-react';
import { TripMonitorDeepDiveShell } from './TripMonitorDeepDiveShell.jsx';

/**
 * Deep-dive Historical Records sub-view.
 * Full-width DataTable showing historical temperature/location records for a unit.
 * Self-fetches data from /api/historical endpoint.
 */
export function TripMonitorHistoricalView({ context, range, onBack, DataTable, fmtDate, fmtNum }) {
  const [records, setRecords] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const unitId = context?.id || context?.unitId || '';
  const accountId = context?.accountId || 'primary';
  const rangeLabel = range ? `${range.startDate || '-'} to ${range.endDate || '-'}` : '-';

  const fetchRecords = useCallback(async () => {
    if (!unitId) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        accountId,
        unitId,
        ...(range?.startDate ? { startDate: range.startDate } : {}),
        ...(range?.endDate ? { endDate: range.endDate } : {}),
      });
      const response = await fetch(`/api/historical?${params.toString()}`);
      const payload = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
      setRecords(payload.records || []);
    } catch (err) {
      setError(err.message || 'Failed to load historical records');
      setRecords([]);
    } finally {
      setBusy(false);
    }
  }, [unitId, accountId, range?.startDate, range?.endDate]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const fmt = fmtDate || ((v) => v ? new Date(v).toLocaleString('id-ID') : '-');
  const num = fmtNum || ((v, d = 1) => v != null ? Number(v).toFixed(d) : '-');

  const columns = ['Timestamp', 'Status', 'Speed', 'Temp 1', 'Temp 2', 'Location', 'Maps'];
  const rows = records.map((row) => [
    fmt(row.timestamp),
    row.status || '-',
    num(row.speed, 0),
    num(row.temp1),
    num(row.temp2),
    row.locationSummary || '-',
    row.latitude && row.longitude
      ? <a href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`} target="_blank" rel="noopener noreferrer" className="tm-maps-link">Maps</a>
      : '-',
  ]);

  return (
    <TripMonitorDeepDiveShell title="Historical Records" context={context} onBack={onBack}>
      <div className="tm-deep-dive-toolbar">
        <span className="tm-deep-dive-range-label">Range: {rangeLabel}</span>
        <span className="tm-deep-dive-count">{records.length} records</span>
        <button type="button" className="sf-btn sf-btn-bordered sf-btn-sm" onClick={fetchRecords} disabled={busy}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      {busy ? (
        <div className="empty-state">Loading historical records...</div>
      ) : error ? (
        <div className="empty-state tm-error-state">{error}</div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          emptyMessage="No historical records found for this unit in the selected range."
          pagination={{ initialRowsPerPage: 50, rowsPerPageOptions: [20, 50, 100] }}
        />
      )}
    </TripMonitorDeepDiveShell>
  );
}
