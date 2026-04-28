import React from 'react';
import { Search, Download, MapPin } from 'lucide-react';
import { Surface, SurfaceHeader, SurfaceBody } from './index.js';

const Card = React.forwardRef(({ children, className = '', ...props }, ref) => (
  <Surface ref={ref} className={`sf-card-compat ${className}`.trim()} {...props}>{children}</Surface>
));
const CardHeader = ({ children, className = '' }) => <SurfaceHeader className={className}>{children}</SurfaceHeader>;
const CardContent = ({ children, className = '' }) => <SurfaceBody className={className}>{children}</SurfaceBody>;
const Link = ({ children, className = '', ...props }) => <a className={`sf-link ${className}`} {...props}>{children}</a>;

export function StopIdlePanel({
  stopForm,
  setStopForm,
  stopReport,
  fleetRows,
  onLoadReport,
  onExportStop,
  accountName,
  fmtDate,
  fmtNum,
  fmtCoord,
  DataTable,
}) {
  const summary = stopReport?.summary || {};
  const rows = stopReport?.rows || [];
  const hasReport = !!stopReport;

  return (
    <section className="stopidle-page">
      {/* Hero */}
      <header className="stopidle-page-hero">
        <div className="stopidle-page-hero-left">
          <h1 className="stopidle-page-title">Stop / idle explorer</h1>
          <p className="stopidle-page-subtitle">Analisis stop dan idle berdasarkan report Solofleet untuk unit yang dipilih.</p>
        </div>
        <div className="stopidle-page-hero-actions">
          <button type="button" className="sf-btn sf-btn-bordered" onClick={onExportStop} disabled={!hasReport}>
            <Download size={14} /> Export stop CSV
          </button>
        </div>
      </header>

      {/* Form controls */}
      <div className="stopidle-form">
        <label className="stopidle-field">
          <span>Unit</span>
          <select
            value={`${stopForm.accountId}::${stopForm.unitId}`}
            onChange={(event) => {
              const [accountId, unitId] = event.target.value.split('::');
              setStopForm((current) => ({ ...current, accountId: accountId || 'primary', unitId: unitId || '' }));
            }}
          >
            {fleetRows.map((row) => (
              <option key={row.rowKey || `${row.accountId}-${row.id}`} value={`${row.accountId || 'primary'}::${row.id}`}>
                {accountName({ id: row.accountId, label: row.accountLabel })} | {row.id} | {row.label}
              </option>
            ))}
          </select>
        </label>
        <label className="stopidle-field">
          <span>Report type</span>
          <select value={stopForm.reportType} onChange={(event) => setStopForm((current) => ({ ...current, reportType: event.target.value }))}>
            <option value="1">Stop Engine Report</option>
            <option value="2">Idle Engine Report</option>
            <option value="3">Speed-based idle/stop Report</option>
          </select>
        </label>
        <label className="stopidle-field stopidle-field--narrow">
          <span>Min duration (min)</span>
          <input type="number" min="0" value={stopForm.minDuration} onChange={(event) => setStopForm((current) => ({ ...current, minDuration: event.target.value }))} />
        </label>
        <div className="stopidle-field stopidle-field--action">
          <span>&nbsp;</span>
          <button type="button" className="sf-btn sf-btn-primary" onClick={onLoadReport}>
            <Search size={14} /> Analyze stop / idle
          </button>
        </div>
      </div>

      {/* Results */}
      {hasReport ? (
        <>
          {/* Metrics */}
          <div className="stopidle-metrics-strip">
            <div className="stopidle-metric">
              <span className="stopidle-metric-value">{summary.incidents ?? '-'}</span>
              <span className="stopidle-metric-label">Rows</span>
            </div>
            <div className="stopidle-metric">
              <span className="stopidle-metric-value">{fmtNum(summary.totalMinutes, 1)}</span>
              <span className="stopidle-metric-label">Total minutes</span>
            </div>
            <div className="stopidle-metric">
              <span className="stopidle-metric-value">{fmtNum(summary.longestMinutes, 1)}</span>
              <span className="stopidle-metric-label">Longest</span>
            </div>
            <div className="stopidle-metric">
              <span className="stopidle-metric-value">{summary.withLocation ?? '-'}</span>
              <span className="stopidle-metric-label">With lat/lng</span>
            </div>
          </div>

          {/* Results table */}
          <Card className="panel-card">
            <CardHeader className="panel-card-header">
              <div>
                <h2>Stop/idle result</h2>
                <p>Lihat durasi, lokasi, suhu rata-rata, dan tautan peta untuk setiap hasil stop atau idle.</p>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={['Start', 'End', 'Minutes', 'Distance', 'Avg temp', 'Location', 'Lat', 'Lng', 'Zone', 'Engine', 'Maps']}
                emptyMessage="Belum ada row stop/idle di range ini."
                rows={rows.map((row) => [
                  fmtDate(row.startTimestamp),
                  fmtDate(row.endTimestamp),
                  fmtNum(row.durationMinutes, 1),
                  fmtNum(row.movementDistance, 1),
                  fmtNum(row.avgTemp, 1),
                  row.locationSummary || '-',
                  fmtCoord(row.latitude),
                  fmtCoord(row.longitude),
                  row.zoneName || row.zoneBoundary || '-',
                  row.engineDetected === 1 ? 'idle' : row.engineDetected === 0 ? 'stop' : '-',
                  row.googleMapsUrl ? <Link href={row.googleMapsUrl} target="_blank">Open map</Link> : '-',
                ])}
              />
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="empty-state">Klik Analyze stop / idle buat ambil report dari Solofleet.</div>
      )}
    </section>
  );
}
