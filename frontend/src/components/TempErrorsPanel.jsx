import React from 'react';
import { Download, Thermometer, AlertCircle } from 'lucide-react';
import { Surface, SurfaceHeader, SurfaceBody, Pill } from './index.js';

const Card = React.forwardRef(({ children, className = '', ...props }, ref) => (
  <Surface ref={ref} className={`sf-card-compat ${className}`.trim()} {...props}>{children}</Surface>
));
const CardHeader = ({ children, className = '' }) => <SurfaceHeader className={className}>{children}</SurfaceHeader>;
const CardContent = ({ children, className = '' }) => <SurfaceBody className={className}>{children}</SurfaceBody>;
const Chip = ({ children, color = 'default', className = '', ...props }) => <Pill color={color} className={className} {...props}>{children}</Pill>;

export function TempErrorsPanel({
  errorRows,
  errorOverview,
  compileDailyRows,
  selectedFleetRow,
  unitDetail,
  detailBusy,
  onExportAlerts,
  onExportCompile,
  onOpenUnit,
  fmtDate,
  fmtDateOnly,
  fmtNum,
  DataTable,
  TemperatureChart,
}) {
  const overview = errorOverview || {};

  return (
    <section className="temperr-page">
      {/* Hero */}
      <header className="temperr-page-hero">
        <div className="temperr-page-hero-left">
          <h1 className="temperr-page-title">Temp error incidents</h1>
          <p className="temperr-page-subtitle">Satu baris mewakili satu unit per hari agar durasi error lebih mudah dipantau.</p>
        </div>
        <div className="temperr-page-hero-actions">
          <button type="button" className="sf-btn sf-btn-bordered" onClick={onExportAlerts}>
            <Download size={14} /> Export temp error CSV
          </button>
          <button type="button" className="sf-btn sf-btn-bordered" onClick={onExportCompile}>
            <Download size={14} /> Export compile CSV
          </button>
        </div>
      </header>

      {/* Metrics */}
      <div className="temperr-metrics-strip">
        <div className="temperr-metric">
          <span className="temperr-metric-value">{overview.alerts ?? 0}</span>
          <span className="temperr-metric-label">Rows</span>
        </div>
        <div className="temperr-metric">
          <span className="temperr-metric-value">{overview.affectedUnits ?? 0}</span>
          <span className="temperr-metric-label">Affected units</span>
        </div>
        <div className="temperr-metric temperr-metric--danger">
          <span className="temperr-metric-value">{overview.criticalAlerts ?? 0}</span>
          <span className="temperr-metric-label">Critical</span>
        </div>
        <div className="temperr-metric temperr-metric--warning">
          <span className="temperr-metric-value">{fmtNum(overview.totalMinutes ?? 0, 1)}</span>
          <span className="temperr-metric-label">Total minutes</span>
        </div>
      </div>

      {/* Split: incidents table + chart */}
      <div className="temperr-split">
        {/* Incidents table */}
        <Card className="panel-card temperr-incidents-card">
          <CardHeader className="panel-card-header">
            <div>
              <h2>Temp error incidents</h2>
              <p>Klik baris untuk membuka detail grafik unit terkait.</p>
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              className="temp-error-table"
              shellClassName="temp-error-table-shell"
              pagination={{ initialRowsPerPage: 5, rowsPerPageOptions: [5, 10, 20, 50] }}
              columns={['Tanggal', 'Mulai', 'Selesai', 'Durasi', 'Account', 'Nopol', 'Severity', 'Temp 1', 'Temp 2', 'Speed']}
              emptyMessage="Belum ada temp error incident di range ini."
              rows={errorRows.map((row) => [
                row.day ? fmtDateOnly(row.day) : '-',
                row.startTime || '-',
                row.endTime || '-',
                row.durationMinutes != null ? fmtNum(row.durationMinutes, 1) : '-',
                row.accountLabel || row.accountId || '-',
                <div><strong>{row.unitLabel || row.unitId}</strong><div className="subtle-line">{row.unitId}</div></div>,
                <Chip className="wrap-chip" color={row.type === 'temp1+temp2' ? 'danger' : 'warning'} variant="flat">{row.label}</Chip>,
                `${fmtNum(row.temp1Min)} to ${fmtNum(row.temp1Max)}`,
                `${fmtNum(row.temp2Min)} to ${fmtNum(row.temp2Max)}`,
                `${fmtNum(row.minSpeed, 0)} - ${fmtNum(row.maxSpeed, 0)}`,
              ])}
              getRowProps={(row, rowIndex) => ({
                key: `${errorRows[rowIndex]?.accountId || 'account'}-${errorRows[rowIndex]?.unitId || 'alert'}-${errorRows[rowIndex]?.day || rowIndex}`,
                className: errorRows[rowIndex]?.type === 'temp1+temp2' ? 'data-row data-row-danger' : 'data-row data-row-warning',
                onClick: () => onOpenUnit(errorRows[rowIndex].accountId || 'primary', errorRows[rowIndex].unitId),
              })}
            />
          </CardContent>
        </Card>

        {/* Selected unit chart */}
        <Card className="panel-card temperr-chart-card">
          <CardHeader className="panel-card-header">
            <div>
              <h2>Selected unit chart</h2>
              <p>Grafik suhu untuk unit yang dipilih dari daftar error.</p>
            </div>
          </CardHeader>
          <CardContent>
            {selectedFleetRow ? (
              <>
                <div className="temperr-unit-meta">
                  <strong>{selectedFleetRow.id} | {selectedFleetRow.label}</strong>
                  <div className="subtle-line">{selectedFleetRow.accountLabel || selectedFleetRow.accountId}</div>
                  <div className="subtle-line">{selectedFleetRow.locationSummary || '-'}</div>
                </div>
                <TemperatureChart
                  records={unitDetail?.records || []}
                  busy={detailBusy}
                  title="Sensor trend"
                  description="Grafik menampilkan data historical Solofleet sesuai tanggal aktif yang dipilih."
                  compact
                />
              </>
            ) : (
              <div className="empty-state">Klik salah satu incident buat lihat chart unit.</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Compile by day */}
      <Card className="panel-card">
        <CardHeader className="panel-card-header">
          <div>
            <h2>Unit compile by day</h2>
            <p>Section ini selalu 1 hari 1 row. Detail unit tetap dipakai waktu export CSV.</p>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={['Day', 'Error units', 'Temp1 units', 'Temp2 units', 'Both units', 'Incidents', 'Total min', 'Longest']}
            emptyMessage="Belum ada compile error by day di range ini."
            rows={compileDailyRows.map((row) => [
              row.day,
              row.units,
              row.temp1Units,
              row.temp2Units,
              row.bothUnits,
              row.incidents,
              fmtNum(row.totalMinutes, 1),
              fmtNum(row.longestMinutes, 1),
            ])}
          />
        </CardContent>
      </Card>
    </section>
  );
}
