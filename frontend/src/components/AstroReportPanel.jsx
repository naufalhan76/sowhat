import React, { useState } from 'react';
import { BarChart3, Download, AlertTriangle, RefreshCw, ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { Surface, SurfaceHeader, SurfaceBody, Action, Pill } from './index.js';

const Card = React.forwardRef(({ children, className = '', ...props }, ref) => (
  <Surface ref={ref} className={`sf-card-compat ${className}`.trim()} {...props}>{children}</Surface>
));
const CardHeader = ({ children, className = '' }) => <SurfaceHeader className={className}>{children}</SurfaceHeader>;
const CardContent = ({ children, className = '' }) => <SurfaceBody className={className}>{children}</SurfaceBody>;
const Chip = ({ children, color = 'default', className = '', ...props }) => <Pill color={color} className={className} {...props}>{children}</Pill>;

export function AstroReportPanel({
  astroReportFilters,
  setAstroReportFilters,
  astroReportMode,
  setAstroReportMode,
  astroReport,
  astroRoutes,
  astroLocations,
  astroReportAccountOptions,
  astroReportWhOptions,
  astroReportVisibleRouteOptions,
  astroReportColumns,
  astroReportTableRows,
  astroDiagnostics,
  astroDiagnosticRows,
  astroDiagnosticsOpen,
  setAstroDiagnosticsOpen,
  onGenerateReport,
  onExportReport,
  fmtPct,
  SearchableSelect,
  DataTable,
}) {
  const [filtersOpen, setFiltersOpen] = useState(true);
  const summary = astroReport?.summary || {};
  const warnings = astroReport?.warnings || [];
  const kpi = summary.kpi || {};

  return (
    <section className="astro-page">
      {/* Hero */}
      <header className="astro-page-hero">
        <div className="astro-page-hero-left">
          <h1 className="astro-page-title">Astro delivery report</h1>
          <p className="astro-page-subtitle">Ringkasan rit Astro berdasarkan geofence lokasi dan data historical Solofleet.</p>
        </div>
        <div className="astro-page-hero-actions">
          {astroDiagnostics.length ? (
            <button type="button" className="sf-btn sf-btn-bordered" onClick={() => setAstroDiagnosticsOpen(true)}>
              <AlertTriangle size={14} /> Tanggal error ({astroDiagnostics.length})
            </button>
          ) : null}
          <button type="button" className="sf-btn sf-btn-bordered" onClick={onExportReport}>
            <Download size={14} /> Export CSV
          </button>
        </div>
      </header>

      {/* Metrics */}
      <div className="astro-metrics-strip">
        <div className="astro-metric">
          <span className="astro-metric-value">{astroRoutes.length}</span>
          <span className="astro-metric-label">Configured routes</span>
        </div>
        <div className="astro-metric">
          <span className="astro-metric-value">{astroLocations.length}</span>
          <span className="astro-metric-label">Locations</span>
        </div>
        <div className="astro-metric">
          <span className="astro-metric-value">{summary.rows ?? 0}</span>
          <span className="astro-metric-label">Report rows</span>
        </div>
        <div className="astro-metric">
          <span className="astro-metric-value">{summary.partialRows ?? 0}</span>
          <span className="astro-metric-label">Partial diagnostics</span>
        </div>
        <div className="astro-metric">
          <span className="astro-metric-value">{summary.warnings ?? 0}</span>
          <span className="astro-metric-label">Warnings</span>
        </div>
      </div>

      {/* KPI summary (when mode = kpi) */}
      {astroReportMode === 'kpi' ? (
        <div className="astro-kpi-strip">
          <div className="astro-kpi-item"><span className="astro-kpi-value">{kpi.eligibleRows ?? 0}</span><span className="astro-kpi-label">Eligible rit</span></div>
          <div className="astro-kpi-item astro-kpi-item--primary"><span className="astro-kpi-value">{fmtPct(kpi.overallRate ?? 0)}</span><span className="astro-kpi-label">Overall pass</span></div>
          <div className="astro-kpi-item"><span className="astro-kpi-value">{fmtPct(kpi.whArrivalTimeRate ?? 0)}</span><span className="astro-kpi-label">WH on-time</span></div>
          <div className="astro-kpi-item"><span className="astro-kpi-value">{fmtPct(kpi.whArrivalTempRate ?? 0)}</span><span className="astro-kpi-label">WH temp pass</span></div>
          <div className="astro-kpi-item"><span className="astro-kpi-value">{fmtPct(kpi.podArrivalRate ?? 0)}</span><span className="astro-kpi-label">POD on-time</span></div>
        </div>
      ) : null}

      {/* Controls row */}
      <div className="astro-controls-row">
        <div className="astro-controls-left">
          <label className="astro-inline-field">
            <span>View mode</span>
            <select value={astroReportMode} onChange={(event) => setAstroReportMode(event.target.value)}>
              <option value="plain">Without KPI</option>
              <option value="kpi">With KPI</option>
            </select>
          </label>
          <button type="button" className="sf-btn sf-btn-primary" onClick={onGenerateReport}>
            <RefreshCw size={14} /> Generate report
          </button>
        </div>
        <button
          type="button"
          className={`sf-btn sf-btn-bordered astro-filter-toggle ${filtersOpen ? 'is-active' : ''}`}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <SlidersHorizontal size={14} /> Filters
          <ChevronDown size={12} className={`astro-filter-chevron ${filtersOpen ? 'is-open' : ''}`} />
        </button>
      </div>

      {/* Filter drawer */}
      {filtersOpen ? (
        <div className="astro-filter-drawer">
          <div className="astro-filter-grid">
            <label className="astro-filter-field">
              <span>Start date</span>
              <input type="date" value={astroReportFilters.startDate} onChange={(event) => setAstroReportFilters((current) => ({ ...current, startDate: event.target.value }))} />
            </label>
            <label className="astro-filter-field">
              <span>End date</span>
              <input type="date" value={astroReportFilters.endDate} onChange={(event) => setAstroReportFilters((current) => ({ ...current, endDate: event.target.value }))} />
            </label>
            <SearchableSelect label="Account" value={astroReportFilters.accountId} options={astroReportAccountOptions} onChange={(nextValue) => setAstroReportFilters((current) => ({ ...current, accountId: nextValue || 'all', whLocationId: '', routeId: '' }))} placeholder="Search account..." />
            <SearchableSelect label="Warehouse" value={astroReportFilters.whLocationId} options={astroReportWhOptions || []} onChange={(nextValue) => setAstroReportFilters((current) => ({ ...current, whLocationId: nextValue || '', routeId: '' }))} placeholder="Search warehouse..." />
            <SearchableSelect label="Nopol route" value={astroReportFilters.routeId} options={[{ value: '', label: 'All configured routes', preview: 'Show all active configured routes for the selected account.' }, ...astroReportVisibleRouteOptions]} onChange={(nextValue) => setAstroReportFilters((current) => ({ ...current, routeId: nextValue || '' }))} placeholder="Search route..." />
          </div>
        </div>
      ) : null}

      {/* Warnings */}
      {warnings.length ? (
        <div className="astro-warnings">
          {warnings.map((warning, index) => <div key={`astro-warning-${index}`} className="astro-warning-item">{warning}</div>)}
        </div>
      ) : null}

      {/* Diagnostic hint */}
      {astroDiagnostics.length ? <p className="astro-diagnostic-hint">Tanggal yang belum lengkap tetap bisa ditinjau melalui tombol Lihat tanggal error.</p> : null}

      {/* Report table */}
      <Card className="panel-card">
        <CardHeader className="panel-card-header">
          <div>
            <h2>Astro rit summary</h2>
            <p>Row tetap tampil per rit. Titik yang tidak ketemu snapshot akan diisi tanda - . Urutan POD mengikuti route config.</p>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            className="astro-report-table"
            shellClassName="astro-report-table-shell"
            pagination={{ initialRowsPerPage: 10, rowsPerPageOptions: [10, 20, 50] }}
            columns={astroReportColumns}
            rows={astroReportTableRows}
            emptyMessage={warnings.length ? 'Belum ada rit Astro lengkap di range ini. Lihat informasi di atas untuk penyebabnya.' : 'Belum ada Astro report. Pilih rentang tanggal lalu klik Generate report.'}
          />
        </CardContent>
      </Card>

      {/* Diagnostics modal */}
      {astroDiagnosticsOpen ? (
        <div className="auth-modal-backdrop" onClick={() => setAstroDiagnosticsOpen(false)}>
          <Card className="auth-modal-card diagnostic-modal-card" onClick={(event) => event.stopPropagation()}>
            <CardHeader className="panel-card-header">
              <div>
                <p className="eyebrow local-eyebrow">Astro Diagnostics</p>
                <h2>Tanggal yang tidak complete</h2>
                <p>Lihat tanggal yang gagal dan requirement yang belum terpenuhi.</p>
              </div>
              <div className="inline-buttons">
                <button type="button" className="sf-btn sf-btn-bordered" onClick={() => setAstroDiagnosticsOpen(false)}>
                  <X size={14} /> Close
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable
                pagination={{ initialRowsPerPage: 10, rowsPerPageOptions: [10, 20, 50] }}
                columns={['Service date', 'Rit', 'Nopol', 'Status', 'Requirement not met']}
                rows={astroDiagnosticRows}
                emptyMessage="Belum ada tanggal error untuk report ini."
              />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
