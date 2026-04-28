import React, { useMemo, useState } from 'react';
import { Search, ArrowLeft, Download, Clock3, Route, MapPin } from 'lucide-react';
import { Surface, SurfaceHeader, SurfaceBody, Action, Pill, Spinner } from './index.js';

const EMPTY_RANGE = { startDate: '', endDate: '' };

const Button = ({ children, variant, color, onPress, onClick, className = '', ...props }) => {
  const resolvedVariant = variant === 'bordered' || variant === 'flat' ? 'secondary'
    : variant === 'light' ? 'ghost'
    : color === 'danger' || color === 'error' ? 'danger'
    : 'primary';

  return (
    <Action variant={resolvedVariant} className={className} onClick={onClick || onPress} {...props}>
      {children}
    </Action>
  );
};

const Card = React.forwardRef(function Card({ children, className = '', ...props }, ref) {
  return <Surface ref={ref} className={`sf-card-compat panel-card ${className}`.trim()} {...props}>{children}</Surface>;
});

const CardHeader = ({ children, className = '' }) => <SurfaceHeader className={`panel-card-header ${className}`.trim()}>{children}</SurfaceHeader>;
const CardContent = ({ children, className = '' }) => <SurfaceBody className={className}>{children}</SurfaceBody>;
const Chip = ({ children, color = 'default', className = '' }) => <Pill color={color} className={className}>{children}</Pill>;
const Link = ({ children, className = '', ...props }) => <a className={`sf-link ${className}`.trim()} rel={props.target === '_blank' ? 'noreferrer' : undefined} {...props}>{children}</a>;

function DataTable({ columns, rows, emptyMessage, className = '', shellClassName = '', pagination = null }) {
  const rowsPerPageOptions = pagination?.rowsPerPageOptions || [10, 20, 50];
  const initialRowsPerPage = pagination?.initialRowsPerPage || rowsPerPageOptions[0] || 10;
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage);
  const [page, setPage] = useState(1);
  const totalPages = pagination ? Math.max(1, Math.ceil(rows.length / rowsPerPage)) : 1;
  const safePage = Math.min(page, totalPages);
  const pageStart = pagination ? (safePage - 1) * rowsPerPage : 0;
  const visibleRows = pagination ? rows.slice(pageStart, pageStart + rowsPerPage) : rows;

  if (!rows.length) return <div className="empty-state">{emptyMessage}</div>;

  return (
    <div className={`table-shell${shellClassName ? ` ${shellClassName}` : ''}`}>
      <table className={`data-table${className ? ` ${className}` : ''}`}>
        <thead>
          <tr>{columns.map((column, index) => <th key={typeof column === 'string' ? column : column.key || index}>{typeof column === 'string' ? column : column.label}</th>)}</tr>
        </thead>
        <tbody>
          {visibleRows.map((row, rowIndex) => (
            <tr key={`row-${pageStart + rowIndex}`}>{row.map((cell, cellIndex) => <td key={`cell-${pageStart + rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {pagination ? (
        <div className="table-pagination">
          <div className="table-pagination-meta">
            <span>Rows per page</span>
            <select aria-label="Rows per page" value={rowsPerPage} onChange={(event) => { setRowsPerPage(Number(event.target.value || initialRowsPerPage)); setPage(1); }}>
              {rowsPerPageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className="table-pagination-meta">Page {safePage} of {totalPages}</div>
          <div className="table-pagination-controls">
            <button type="button" className="table-page-button" aria-label="First page" onClick={() => setPage(1)} disabled={safePage <= 1}>{'<<'}</button>
            <button type="button" className="table-page-button" aria-label="Previous page" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1}>{'<'}</button>
            <button type="button" className="table-page-button" aria-label="Next page" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage >= totalPages}>{'>'}</button>
            <button type="button" className="table-page-button" aria-label="Last page" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}>{'>>'}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, icon: Icon }) {
  return (
    <div className="mini-metric">
      <span>{Icon ? <Icon size={14} aria-hidden="true" /> : null}{label}</span>
      <strong className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{value}</strong>
    </div>
  );
}

function hasCoordinate(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function chipTone(statusLabel = '') {
  const normalized = String(statusLabel).toLowerCase();
  if (normalized.includes('inside') || normalized.includes('masuk') || normalized.includes('in ')) return 'success';
  if (normalized.includes('outside') || normalized.includes('keluar') || normalized.includes('out')) return 'warning';
  return 'default';
}

export function HistoricalPanel({
  fleetRows = [],
  historicalFleet = [],
  selectedHistoricalRow,
  historicalAppliedRow,
  historicalSearch = '',
  setHistoricalSearch,
  historicalRangeDraft = EMPTY_RANGE,
  setHistoricalRangeDraft,
  historicalRangeApplied = EMPTY_RANGE,
  historicalDetail,
  historicalDetailBusy = false,
  historicalTripMetrics = {},
  historicalGeofenceEvents = [],
  onSelectUnit,
  onPullData,
  onExportHistory,
  onBackToFleet,
  renderTemperatureChart,
  fmtDate = (value) => value || '-',
  fmtNum = (value) => (value ?? value === 0 ? String(value) : '-'),
  fmtCoord = (value) => (value ?? value === 0 ? String(value) : '-'),
  formatMinutesText = (value) => (value ?? value === 0 ? `${value} min` : '-'),
  unitRowKey = (row) => row?.rowKey || `${row?.accountId || 'primary'}::${row?.id || ''}`,
}) {
  const records = historicalDetail?.records || [];
  const selectedKey = selectedHistoricalRow ? unitRowKey(selectedHistoricalRow) : '';
  const appliedKey = historicalAppliedRow ? unitRowKey(historicalAppliedRow) : '';
  const hasPendingSelection = Boolean(selectedKey && appliedKey && selectedKey !== appliedKey);

  const rawRows = useMemo(() => [...records].reverse().map((row) => {
    const hasMap = hasCoordinate(row.latitude) && hasCoordinate(row.longitude);
    return [
      <span className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{fmtDate(row.timestamp)}</span>,
      <div>
        <Chip className="wrap-chip" color={chipTone(row.geofenceStatusLabel)}>{row.geofenceStatusLabel || '-'}</Chip>
        <div className="subtle-line">{row.geofenceLocationName || row.geofenceLocationType || 'Outside geofence'}</div>
      </div>,
      <span className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{fmtNum(row.speed, 0)}</span>,
      <span className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{fmtNum(row.temp1)}</span>,
      <span className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{fmtNum(row.temp2)}</span>,
      <div><div>{row.locationSummary || '-'}</div><div className="subtle-line">{row.zoneName || 'No zone'}</div></div>,
      <span className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{fmtCoord(row.latitude)}</span>,
      <span className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{fmtCoord(row.longitude)}</span>,
      <span className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{fmtNum(row.powerSupply, 2)}</span>,
      hasMap ? <Link href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`} target="_blank">Open map</Link> : '-',
    ];
  }), [fmtCoord, fmtDate, fmtNum, records]);

  const geofenceRows = useMemo(() => historicalGeofenceEvents.map((event) => [
    <Chip className="wrap-chip" color={chipTone(event.statusLabel)}>{event.statusLabel || '-'}</Chip>,
    <span className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{fmtDate(event.enteredAt)}</span>,
    <span className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{fmtDate(event.leftAt)}</span>,
    <span className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{formatMinutesText(event.durationMinutes)}</span>,
    <span className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{event.distanceMeters != null ? `${fmtNum(event.distanceMeters, 0)} m` : '-'}</span>,
    <div><div>{event.locationName || '-'}</div><div className="subtle-line">{event.locationType || '-'}</div></div>,
  ]), [fmtDate, fmtNum, formatMinutesText, historicalGeofenceEvents]);

  const chart = renderTemperatureChart ? renderTemperatureChart({
    records,
    busy: historicalDetailBusy,
    title: 'Historical temperature chart',
    description: 'Tarik langsung dari historical Solofleet sesuai range yang dipilih di page ini.',
  }) : null;

  return (
    <Card className="panel-card">
      <CardHeader className="panel-card-header">
        <div>
          <h2>Historical temperature</h2>
          <p>Cari unit, ganti unit, dan ubah rentang tanggal langsung dari halaman ini.</p>
        </div>
        <div className="inline-buttons">
          <Button variant="bordered" onPress={onBackToFleet}><ArrowLeft size={16} aria-hidden="true" /> Back to Fleet Live</Button>
          <Button variant="bordered" onPress={onExportHistory}><Download size={16} aria-hidden="true" /> Export history CSV</Button>
        </div>
      </CardHeader>
      <CardContent>
        {fleetRows.length ? <>
          <div className="historical-toolbar">
            <label className="historical-field historical-search-field">
              <span>Search unit</span>
              <div className="search-box historical-search-box">
                <Search size={16} className="search-icon" aria-hidden="true" />
                <input type="search" value={historicalSearch} onChange={(event) => setHistoricalSearch?.(event.target.value)} placeholder="Cari account, unit, customer, lokasi..." />
              </div>
            </label>
            <label className="historical-field historical-unit-field">
              <span>Unit</span>
              <select value={selectedKey} onChange={(event) => onSelectUnit?.(event.target.value)}>
                {historicalFleet.map((row) => <option key={row.rowKey || unitRowKey(row)} value={unitRowKey(row)}>{row.accountLabel || row.accountId || 'Account'} | {row.id} | {row.label}</option>)}
              </select>
            </label>
            <label className="historical-field historical-date-field">
              <span>Start date</span>
              <input type="date" value={historicalRangeDraft.startDate || ''} onChange={(event) => setHistoricalRangeDraft?.((current) => ({ ...current, startDate: event.target.value }))} />
            </label>
            <label className="historical-field historical-date-field">
              <span>End date</span>
              <input type="date" value={historicalRangeDraft.endDate || ''} onChange={(event) => setHistoricalRangeDraft?.((current) => ({ ...current, endDate: event.target.value }))} />
            </label>
            <div className="historical-action-field">
              <span>Action</span>
              <Button color="primary" onPress={onPullData} disabled={historicalDetailBusy || !selectedHistoricalRow}>{historicalDetailBusy ? <><Spinner size="sm" /> Menarik...</> : 'Tarik Data'}</Button>
            </div>
          </div>
          <div className="historical-summary">{historicalFleet.length} unit tersedia buat dipilih dari fleet live. Menampilkan {historicalRangeApplied.startDate || '-'} to {historicalRangeApplied.endDate || '-'}.</div>
          {hasPendingSelection ? <div className="subtle-line historical-pending-hint">Pilihan unit atau range berubah. Klik Tarik Data untuk memuat historical terbaru.</div> : null}
          {historicalAppliedRow ? <>
            <div className="spacer-16" />
            <div className="focus-side-meta">
              <strong>{historicalAppliedRow.id} | {historicalAppliedRow.label}</strong>
              <div className="subtle-line">{historicalAppliedRow.accountLabel || historicalAppliedRow.accountId || 'Account'} | {historicalAppliedRow.customerName || 'No customer profile'}</div>
              <div className="subtle-line">{historicalAppliedRow.locationSummary || historicalAppliedRow.zoneName || '-'}</div>
            </div>
            <div className="spacer-16" />
            <div className="unit-summary-grid historical-metrics-grid">
              <Metric icon={Route} label="Trip km" value={fmtNum(historicalTripMetrics.distanceKm, 1)} />
              <Metric icon={Clock3} label="Moving time" value={formatMinutesText(historicalTripMetrics.movingMinutes)} />
              <Metric icon={MapPin} label="Stopped time" value={formatMinutesText(historicalTripMetrics.stoppedMinutes)} />
            </div>
            <div className="spacer-16" />
            {chart}
            <div className="spacer-16" />
            <DataTable columns={['Status', 'Masuk', 'Keluar', 'Durasi', 'Jarak', 'Lokasi']} emptyMessage="Belum ada event geofence yang valid di range ini." rows={geofenceRows} />
            <div className="spacer-16" />
            <DataTable pagination={{ initialRowsPerPage: 30, rowsPerPageOptions: [30, 50, 100] }} columns={['Timestamp', 'Status', 'Speed', 'Temp 1', 'Temp 2', 'Location', 'Lat', 'Lng', 'Power supply', 'Maps link']} emptyMessage="Belum ada historical rows untuk unit ini di range ini." rows={rawRows} />
          </> : selectedHistoricalRow ? <div className="empty-state">Pilih unit dan range, lalu klik Tarik Data untuk memuat historical dari Solofleet.</div> : <div className="empty-state">Belum ada unit yang cocok dengan filter historical.</div>}
        </> : <div className="empty-state">Belum ada unit dari fleet live untuk dipilih.</div>}
      </CardContent>
    </Card>
  );
}
