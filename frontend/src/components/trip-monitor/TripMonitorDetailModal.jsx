import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, Clock3, Route, Truck, X } from 'lucide-react';
import { Surface, SurfaceHeader, SurfaceBody, Action, Pill } from '../index.js';
import {
  tmsSeverityLabel, tmsSeverityTone, tmsIncidentLabel,
  dedupeTripMonitorIncidentCodes, normalizeTemperatureRange,
  pickFirstText, normalizeTmsDriverAssign, extractTmsDriverName,
  formatTripMonitorStatusTime, formatTripMonitorRangeLabel,
  tripMonitorIncidentHistoryStatusLabel, tripMonitorIncidentHistoryStatusTone,
  buildTripMonitorIncidentHistoryDescription, buildTripMonitorIncidentHistoryLocationLabel,
} from './helpers.jsx';
import { TripMonitorShippingProgressClean } from './TripMonitorShippingProgress.jsx';
import { TripMonitorIncidentComments } from './TripMonitorIncidentComments.jsx';

const defaultFmtDate = (value) => value || '-';
const defaultFmtNum = (value, digits = 1) => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString('id-ID', { maximumFractionDigits: digits }) : String(value);
};
const defaultFmtCoord = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(6) : '-';
};
const defaultFormatMinutesText = (minutes) => {
  const numeric = Number(minutes || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0m';
  const hours = Math.floor(numeric / 60);
  const mins = Math.round(numeric % 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
};

const Button = ({ children, variant, color, className = '', onPress, onClick, ...props }) => {
  const resolvedVariant = variant === 'bordered' || variant === 'flat' ? 'secondary'
    : variant === 'light' ? 'ghost'
    : color === 'danger' || color === 'error' ? 'danger'
    : 'primary';
  return <Action variant={resolvedVariant} className={className} onClick={onClick || onPress} {...props}>{children}</Action>;
};

const Card = React.forwardRef(function Card({ children, className = '', ...props }, ref) {
  return <Surface ref={ref} className={`sf-card-compat ${className}`.trim()} {...props}>{children}</Surface>;
});
const CardHeader = ({ children, className = '' }) => <SurfaceHeader className={className}>{children}</SurfaceHeader>;
const CardContent = ({ children, className = '' }) => <SurfaceBody className={className}>{children}</SurfaceBody>;
const Chip = ({ children, color = 'default', className = '', ...props }) => <Pill color={color} className={className} {...props}>{children}</Pill>;
const Link = ({ children, className = '', ...props }) => <a className={`sf-link ${className}`.trim()} {...props}>{children}</a>;

function DataTable({ columns, rows, emptyMessage, getRowProps, className = '', shellClassName = '', pagination = null }) {
  const rowsPerPageOptions = pagination?.rowsPerPageOptions || [10, 20, 50];
  const initialRowsPerPage = pagination?.initialRowsPerPage || rowsPerPageOptions[0] || 10;
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setRowsPerPage(initialRowsPerPage);
    setPage(1);
  }, [rows.length, initialRowsPerPage]);

  const totalPages = pagination ? Math.max(1, Math.ceil(rows.length / rowsPerPage)) : 1;
  const pageStart = pagination ? (page - 1) * rowsPerPage : 0;
  const visibleRows = pagination ? rows.slice(pageStart, pageStart + rowsPerPage) : rows;

  useEffect(() => {
    if (!pagination) return;
    setPage((current) => Math.min(current, totalPages));
  }, [pagination, totalPages]);

  if (!rows.length) return <div className="empty-state">{emptyMessage}</div>;

  return (
    <div className={`table-shell${shellClassName ? ` ${shellClassName}` : ''}`}>
      <table className={`data-table${className ? ` ${className}` : ''}`}>
        <thead>
          <tr>{columns.map((column, index) => <th key={typeof column === 'string' ? column : column.key || `column-${index}`}>{typeof column === 'string' ? column : column.label}</th>)}</tr>
        </thead>
        <tbody>
          {visibleRows.map((row, rowIndex) => {
            const absoluteRowIndex = pageStart + rowIndex;
            const rowProps = getRowProps ? getRowProps(row, absoluteRowIndex) : {};
            const { key, className: rowClassName, ...restRowProps } = rowProps || {};
            return (
              <tr key={key || `row-${absoluteRowIndex}`} className={rowClassName || ''} {...restRowProps}>
                {row.map((cell, cellIndex) => <td key={`cell-${absoluteRowIndex}-${cellIndex}`}>{cell}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
      {pagination ? (
        <div className="table-pagination">
          <div className="table-pagination-meta">
            <span>Rows per page</span>
            <select
              aria-label="Rows per page"
              value={rowsPerPage}
              onChange={(event) => {
                setRowsPerPage(Number(event.target.value || initialRowsPerPage));
                setPage(1);
              }}
            >
              {rowsPerPageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className="table-pagination-meta">Page {page} of {totalPages}</div>
          <div className="table-pagination-controls">
            <button type="button" className="table-page-button" aria-label="First page" onClick={() => setPage(1)} disabled={page <= 1}>{'<<'}</button>
            <button type="button" className="table-page-button" aria-label="Previous page" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>{'<'}</button>
            <button type="button" className="table-page-button" aria-label="Next page" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>{'>'}</button>
            <button type="button" className="table-page-button" aria-label="Last page" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>{'>>'}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizeSeverity(value) {
  const severity = String(value || '').toLowerCase();
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'warning';
  return 'normal';
}

function formatAlertTime(value) {
  if (!value) return '--:--';
  try {
    return new Date(value).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(/\./g, ':');
  } catch {
    return '--:--';
  }
}

export function TripMonitorDetailModal({
  detail,
  busy,
  historyDetail,
  historyBusy,
  historyRange,
  webSessionUser,
  onClose,
  onOpenFleet,
  onOpenMap,
  onOpenHistorical,
  renderTemperatureChart,
  renderUnitRouteMap,
  mode = 'drawer',
  fmtDate = defaultFmtDate,
  fmtNum = defaultFmtNum,
  fmtCoord = defaultFmtCoord,
  formatMinutesText = defaultFormatMinutesText,
}) {
  const [hoveredStopKey, setHoveredStopKey] = useState(null);

  useEffect(() => {
    if (!detail || mode !== 'drawer') return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [detail, mode, onClose]);

  const derived = useMemo(() => {
    if (!detail) return null;

    const fleetRow = detail?.metadata?.fleetRow || null;
    const jobOrders = Array.isArray(detail?.metadata?.jobOrders) ? detail.metadata.jobOrders : [];
    const incidents = Array.isArray(detail?.metadata?.incidents) ? detail.metadata.incidents : [];
    const incidentHistory = Array.isArray(detail?.incidentHistory) ? detail.incidentHistory : [];
    const headlineJob = detail?.metadata?.headlineJobOrder || jobOrders[0] || null;
    const historyRows = [...(historyDetail?.records || [])].reverse();
    const historyLabel = formatTripMonitorRangeLabel(historyRange);
    const shippingStatus = detail?.metadata?.shippingStatus || {
      label: detail?.shippingStatusLabel || '-',
      changedAt: detail?.shippingStatusChangedAt || null,
      steps: [],
    };
    const headlineDrivers = normalizeTmsDriverAssign(headlineJob?.driverAssign);
    const jobDrivers = headlineDrivers.length ? headlineDrivers : jobOrders.flatMap((job) => normalizeTmsDriverAssign(job?.driverAssign));
    const normalizedJobTempRange = normalizeTemperatureRange(headlineJob?.tempMin, headlineJob?.tempMax);
    const incidentsByLevel = {
      critical: incidentHistory.filter((item) => String(item?.severity || '').toLowerCase() === 'critical'),
      warning: incidentHistory.filter((item) => String(item?.severity || '').toLowerCase() === 'warning'),
      normal: incidentHistory.filter((item) => {
        const severity = String(item?.severity || '').toLowerCase();
        return severity !== 'critical' && severity !== 'warning';
      }),
    };

    return {
      fleetRow,
      jobOrders,
      incidents,
      incidentHistory,
      headlineJob,
      routeSummary: headlineJob ? `${headlineJob.originName || '-'} -> ${headlineJob.destinationName || '-'}` : '-',
      historyRows,
      historyLabel,
      displayUnitLabel: pickFirstText(fleetRow?.alias, detail.unitLabel, fleetRow?.label, detail.unitId) || '-',
      normalizedJobTempRange,
      mapStops: headlineJob?.stops || [],
      severityKey: normalizeSeverity(detail?.severity),
      shippingStatus,
      incidentCodes: dedupeTripMonitorIncidentCodes(incidents.map((incident) => incident.code)),
      driver1Name: extractTmsDriverName(jobDrivers[0]),
      driver2Name: extractTmsDriverName(jobDrivers[1]),
      appStatus: detail?.driverAppStatus || [jobDrivers[0]?.assignment_status, jobDrivers[0]?.driver_status, jobDrivers[0]?.job_offer_status].filter(Boolean).join(' | ') || '-',
      incidentHistoryActiveCount: incidentHistory.filter((item) => String(item?.status || '').toLowerCase() !== 'resolved').length,
      incidentHistoryResolvedCount: incidentHistory.filter((item) => String(item?.status || '').toLowerCase() === 'resolved').length,
      incidentHistoryTotalMinutes: incidentHistory.reduce((total, item) => total + Number(item?.durationMinutes || 0), 0),
      incidentsByLevel,
    };
  }, [detail, historyDetail, historyRange]);

  if (!detail) return null;

  const {
    fleetRow,
    incidentHistory,
    headlineJob,
    routeSummary,
    historyRows,
    historyLabel,
    displayUnitLabel,
    normalizedJobTempRange,
    mapStops,
    severityKey,
    shippingStatus,
    driver1Name,
    driver2Name,
    appStatus,
    incidentHistoryActiveCount,
    incidentHistoryResolvedCount,
    incidentHistoryTotalMinutes,
    incidentsByLevel,
  } = derived;

  const totalIncidents = incidentHistory.length;
  const mapContent = fleetRow?.id && renderUnitRouteMap
    ? renderUnitRouteMap({ row: fleetRow, records: historyDetail?.records || [], busy: historyBusy, rangeLabel: historyLabel, stops: mapStops, hoveredStopKey, onHoverStop: setHoveredStopKey })
    : null;
  const temperatureContent = fleetRow?.id && renderTemperatureChart
    ? renderTemperatureChart({ records: historyDetail?.records || [], busy: historyBusy, title: 'Temperature trend', description: `Historical Solofleet mengikuti topbar range ${historyLabel}.`, compact: true, chartHeight: 240, thresholdMin: normalizedJobTempRange.min, thresholdMax: normalizedJobTempRange.max, thresholdLabel: 'TMS range' })
    : null;

  const body = (
    <CardContent>
      {busy ? <div className="empty-state">Loading detail...</div> : (
        <div className="tm-stack">
          <div className="tm-stack-section tm-driver-section">
            <div className="tm-driver-row">
              <div className="tm-driver-info">
                <span className="tm-stack-label">Drivers</span>
                <strong className="tm-driver-names">
                  {driver1Name}{driver2Name && driver2Name !== '-' ? <> <span className="tm-divider-dot">·</span> {driver2Name}</> : null}
                </strong>
              </div>
              <span className={`tm-status-pill status-${String(shippingStatus?.label || '').toLowerCase().replace(/\s+/g, '-')}`}>
                {shippingStatus?.label || 'Unknown'}
              </span>
            </div>
            <p className="tm-route-line">{routeSummary}</p>
            {appStatus && appStatus !== '-' ? <p className="tm-route-line">Driver app: {appStatus}</p> : null}
          </div>

          <div className="tm-stack-section tm-map-section">
            <div className="tm-map-frame">
              {fleetRow?.id ? (mapContent || <div className="empty-state">Map renderer belum tersedia.</div>) : <div className="empty-state">Unit ini belum match ke Solofleet, jadi map belum bisa ditampilkan.</div>}
            </div>
            <div className="tm-action-row">
              <button type="button" className="tm-action-btn" onClick={() => onOpenMap?.(fleetRow)} disabled={!fleetRow?.id}><Route size={14} /> Track Route</button>
              <button type="button" className="tm-action-btn" onClick={() => onOpenHistorical?.(fleetRow)} disabled={!fleetRow?.id}><Clock3 size={14} /> Trip History</button>
              <button type="button" className="tm-action-btn" onClick={() => onOpenFleet?.(fleetRow)} disabled={!fleetRow?.id}><Truck size={14} /> Open Fleet</button>
            </div>
          </div>

          <details className="tm-stack-section tm-section-collapsible" open>
            <summary className="tm-section-summary">
              <span className="tm-section-title">Notification</span>
              <span className="tm-section-meta">{totalIncidents > 0 ? <span className="tm-section-count">{totalIncidents}</span> : null}<ChevronDown size={14} className="tm-section-chevron" /></span>
            </summary>
            <div className="tm-section-content">
              {totalIncidents === 0 ? <div className="tm-empty-soft">No incidents on this trip.</div> : ['critical', 'warning', 'normal'].map((level) => {
                const list = incidentsByLevel[level] || [];
                if (!list.length) return null;
                const labelMap = { critical: 'Critical', warning: 'Warning', normal: 'Resolved / Normal' };
                return (
                  <details key={level} className={`tm-incident-group severity-${level}`} open={level !== 'normal'}>
                    <summary className="tm-incident-group-summary">
                      <span className={`tm-severity-dot severity-${level}`} />
                      <span className="tm-incident-group-label">{labelMap[level]}</span>
                      <span className="tm-incident-group-count">({list.length})</span>
                      <ChevronDown size={12} className="tm-section-chevron" />
                    </summary>
                    <div className="tm-incident-group-body">
                      {list.slice(0, 6).map((item, index) => (
                        <div key={item.id || `${level}-${index}`} className={`tm-alert-row severity-${level}`}>
                          <span className="tm-alert-time">{formatAlertTime(item.openedAt)}</span>
                          <span className="tm-alert-content">
                            <strong className="tm-alert-label">{item.label || tmsIncidentLabel(item.incidentCode)}</strong>
                            <span className="tm-alert-meta">{tripMonitorIncidentHistoryStatusLabel(item.status)}{item.durationMinutes ? ` · ${formatMinutesText(item.durationMinutes)}` : ''}</span>
                          </span>
                        </div>
                      ))}
                      {list.length > 6 ? <div className="tm-section-more">+ {list.length - 6} more incidents</div> : null}
                    </div>
                  </details>
                );
              })}
            </div>
          </details>

          <details className="tm-stack-section tm-section-collapsible" open>
            <summary className="tm-section-summary"><span className="tm-section-title">Stops Timeline</span><span className="tm-section-meta">{mapStops.length ? <span className="tm-section-count">{mapStops.length}</span> : null}<ChevronDown size={14} className="tm-section-chevron" /></span></summary>
            <div className="tm-section-content"><TripMonitorShippingProgressClean shippingStatus={shippingStatus} headlineJob={headlineJob} hoveredStopKey={hoveredStopKey} onHoverStop={setHoveredStopKey} /></div>
          </details>

          <div className="tm-stack-section">
            <div className="tm-section-summary tm-section-summary-static"><span className="tm-section-title">Schedule</span></div>
            <div className="tm-section-content tm-info-grid">
              <div className="tm-info-cell"><span className="tm-info-key">ETA Load</span><strong className="tm-info-value">{formatTripMonitorStatusTime(shippingStatus?.loadEta)}</strong></div>
              <div className="tm-info-cell"><span className="tm-info-key">ETD Unload</span><strong className="tm-info-value">{formatTripMonitorStatusTime(shippingStatus?.unloadEtd)}</strong></div>
              <div className="tm-info-cell"><span className="tm-info-key">Last update</span><strong className="tm-info-value">{formatTripMonitorStatusTime(shippingStatus?.changedAt)}</strong></div>
              <div className="tm-info-cell"><span className="tm-info-key">TMS Range</span><strong className="tm-info-value">{headlineJob ? `${fmtNum(normalizedJobTempRange.min)}° / ${fmtNum(normalizedJobTempRange.max)}°` : '-'}</strong></div>
            </div>
          </div>

          <details className="tm-stack-section tm-section-collapsible">
            <summary className="tm-section-summary"><span className="tm-section-title">Temperature Trend</span><span className="tm-section-meta"><span className="tm-section-count tm-range-chip">{historyLabel}</span><ChevronDown size={14} className="tm-section-chevron" /></span></summary>
            <div className="tm-section-content">{fleetRow?.id ? (temperatureContent || <div className="empty-state">Temperature renderer belum tersedia.</div>) : <div className="empty-state">Unit ini belum match ke Solofleet.</div>}</div>
          </details>

          <details className="tm-stack-section tm-section-collapsible">
            <summary className="tm-section-summary"><span className="tm-section-title">Historical Records</span><span className="tm-section-meta"><ChevronDown size={14} className="tm-section-chevron" /></span></summary>
            <div className="tm-section-content">
              {fleetRow?.id ? (
                <DataTable
                  pagination={{ initialRowsPerPage: 20, rowsPerPageOptions: [20, 50, 100] }}
                  columns={["Timestamp", "Status", "Speed", "Temp 1", "Temp 2", "Location", "Maps"]}
                  emptyMessage="Belum ada historical rows untuk unit ini di topbar range yang dipilih."
                  rows={historyRows.map((row) => [
                    fmtDate(row.timestamp),
                    <div><div>{row.geofenceStatusLabel || '-'}</div><div className="subtle-line">{row.geofenceLocationName || row.geofenceLocationType || 'Outside geofence'}</div></div>,
                    fmtNum(row.speed, 0),
                    fmtNum(row.temp1),
                    fmtNum(row.temp2),
                    <div><div>{row.locationSummary || '-'}</div><div className="subtle-line">{row.zoneName || `${fmtCoord(row.latitude)}, ${fmtCoord(row.longitude)}`}</div></div>,
                    row.latitude !== null && row.longitude !== null ? <Link href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`} target="_blank" rel="noreferrer">Open map</Link> : '-',
                  ])}
                />
              ) : <div className="empty-state">Historical belum tersedia karena unit belum terhubung ke Solofleet.</div>}
            </div>
          </details>

          <details className="tm-stack-section tm-section-collapsible">
            <summary className="tm-section-summary"><span className="tm-section-title">Incident History (full)</span><span className="tm-section-meta"><span className="tm-section-count">{incidentHistory.length}</span><ChevronDown size={14} className="tm-section-chevron" /></span></summary>
            <div className="tm-section-content">
              <div className="tm-section-more">Active {incidentHistoryActiveCount} · Resolved {incidentHistoryResolvedCount} · Total {formatMinutesText(incidentHistoryTotalMinutes)}</div>
              <DataTable
                pagination={{ initialRowsPerPage: 20, rowsPerPageOptions: [20, 50, 100] }}
                columns={["Label", "Description", "Severity", "Status", "Duration", "Anomaly start", "Anomaly end", "Location", "Actions"]}
                emptyMessage="Belum ada incident history untuk JO ini."
                rows={incidentHistory.map((item) => {
                  const description = buildTripMonitorIncidentHistoryDescription(item);
                  const locationLabel = buildTripMonitorIncidentHistoryLocationLabel(item);
                  return [
                    <div><strong>{item.label || tmsIncidentLabel(item.incidentCode)}</strong><div className="subtle-line">{item.incidentCode || '-'}</div></div>,
                    <div><div>{description.primary}</div>{description.secondary ? <div className="subtle-line">{description.secondary}</div> : null}</div>,
                    <Chip color={tmsSeverityTone(item.severity)}>{tmsSeverityLabel(item.severity)}</Chip>,
                    <Chip color={tripMonitorIncidentHistoryStatusTone(item.status)}>{tripMonitorIncidentHistoryStatusLabel(item.status)}</Chip>,
                    formatMinutesText(item.durationMinutes || 0),
                    fmtDate(item.openedAt),
                    String(item.status || '').toLowerCase() === 'resolved' ? fmtDate(item.resolvedAt) : (item.lastSeenAt ? `${fmtDate(item.lastSeenAt)} (active)` : '-'),
                    <div><div>{locationLabel.primary}</div><div className="subtle-line">{locationLabel.secondary}</div></div>,
                    <TripMonitorIncidentComments incidentId={item.id} webSessionUser={webSessionUser} fmtDate={fmtDate} />,
                  ];
                })}
              />
            </div>
          </details>
        </div>
      )}
    </CardContent>
  );

  if (mode === 'floating') return body;

  return (
    <div className="tm-drawer-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Trip detail drawer">
      <Card className={`tm-drawer-panel trip-monitor-detail-modal tm-drawer-cardstack severity-${severityKey}`} onClick={(event) => event.stopPropagation()}>
        <CardHeader className="panel-card-header tm-drawer-header">
          <div className="tm-drawer-header-inner">
            <div className="tm-drawer-title-block">
              <div className="tm-drawer-title-row">
                <h2>{displayUnitLabel}</h2>
                <span className={`tm-severity-badge severity-${severityKey}`}>{tmsSeverityLabel(detail.severity)}</span>
              </div>
              <div className="tm-drawer-meta-row">
                <span className="tm-brand-chip">{detail.customerName || 'No customer'}</span>
                {headlineJob?.name ? <span className="tm-jo-chip">{headlineJob.name}</span> : null}
              </div>
            </div>
            <div className="tm-drawer-header-actions">
              <Button variant="light" className="tm-drawer-close" onPress={onClose} aria-label="Close drawer" title="Close (Esc)"><X size={18} /></Button>
            </div>
          </div>
        </CardHeader>
        {body}
      </Card>
    </div>
  );
}

