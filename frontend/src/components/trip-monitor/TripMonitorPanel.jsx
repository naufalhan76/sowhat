import React from 'react';
import { Search } from 'lucide-react';

import { Action, Spinner, Surface, SurfaceBody, SurfaceHeader } from '../index.js';
import { TMS_BOARD_COLUMNS, TMS_INCIDENT_LEGEND_CODES, tmsIncidentLabel } from './helpers.jsx';
import { TripMonitorIncidentLegend } from './TripMonitorIncidentLegend.jsx';
import { TripMonitorKanban } from './TripMonitorKanban.jsx';

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

function selectedTripMonitorRowId(panels = []) {
  if (!panels.length) return null;
  return panels.reduce((front, panel) => (front.zIndex > panel.zIndex ? front : panel)).rowId;
}

export function TripMonitorPanel({
  tripMonitorFilters,
  setTripMonitorFilters,
  tripMonitorSeverityCounts,
  tripMonitorCustomerOptions,
  tripMonitorIncidentOptions,
  tripMonitorVisibleRows,
  tripMonitorPanels,
  tripMonitorBusy,
  tripMonitorSummary,
  tripMonitorIncludedStatusesLabel,
  tmsConfig,
  tmsForm,
  range,
  onRefreshBoard,
  onSyncTms,
  onOpenDetail,
  isAdmin,
  fmtDate,
}) {
  const filters = tripMonitorFilters || {};
  const summary = tripMonitorSummary || {};
  const visibleRows = tripMonitorVisibleRows || [];
  const severityCounts = tripMonitorSeverityCounts || {};

  const updateFilters = (patch) => {
    setTripMonitorFilters((current) => ({ ...current, ...patch }));
  };

  return (
    <Card className="panel-card">
      <CardHeader className="panel-card-header">
        <div>
          <h2>Trip Monitor</h2>
          <p>Board exception-based untuk unit yang masih punya JO aktif di TMS.</p>
        </div>
        <div className="inline-buttons">
          <Button variant="bordered" onPress={onRefreshBoard}>
            {tripMonitorBusy ? <><Spinner size="sm" /> Refreshing</> : 'Refresh board'}
          </Button>
          {isAdmin ? <Button color="primary" onPress={onSyncTms}>Sync TMS</Button> : null}
        </div>
      </CardHeader>

      <CardContent>
        <div className="trip-monitor-toolbar">
          <div className="trip-monitor-filter-tabs">
            <button
              type="button"
              className={`trip-monitor-filter-pill ${filters.severity === 'all' ? 'is-active' : ''}`}
              onClick={() => updateFilters({ severity: 'all' })}
            >
              All <span>{severityCounts.total || 0}</span>
            </button>
            {TMS_BOARD_COLUMNS.map((column) => (
              <button
                type="button"
                key={column.key}
                className={`trip-monitor-filter-pill trip-monitor-filter-pill-${column.key} ${filters.severity === column.key ? 'is-active' : ''}`}
                onClick={() => updateFilters({ severity: column.key })}
              >
                {column.label} <span>{severityCounts.bySeverity?.[column.key] || 0}</span>
              </button>
            ))}
          </div>

          <div className="trip-monitor-toolbar-grid">
            <label className="historical-field">
              <span>Customer</span>
              <select value={filters.customer || 'all'} onChange={(event) => updateFilters({ customer: event.target.value })}>
                {(tripMonitorCustomerOptions || []).map((option) => (
                  <option key={`customer-${option}`} value={option}>{option === 'all' ? 'All customers' : option}</option>
                ))}
              </select>
            </label>

            <label className="historical-field">
              <span>Incident</span>
              <select value={filters.incidentCode || 'all'} onChange={(event) => updateFilters({ incidentCode: event.target.value })}>
                <option value="all">All incidents</option>
                {(tripMonitorIncidentOptions || [])
                  .filter((option) => option !== 'all')
                  .map((option) => <option key={option} value={option}>{tmsIncidentLabel(option)}</option>)}
              </select>
            </label>

            <label className="historical-field historical-search-field">
              <span>Search</span>
              <div className="search-box historical-search-box">
                <Search size={16} className="search-icon" />
                <input
                  type="search"
                  value={filters.search || ''}
                  onChange={(event) => updateFilters({ search: event.target.value })}
                  placeholder="Cari nopol, JO, origin, destination..."
                />
              </div>
            </label>

            <div className="historical-field trip-monitor-legend-field">
              <span>Incident legend</span>
              <TripMonitorIncidentLegend codes={TMS_INCIDENT_LEGEND_CODES} className="trip-monitor-toolbar-legend" />
            </div>
          </div>
        </div>

        <div className="historical-summary astro-summary">
          Tenant: {tmsConfig?.tenantLabel || tmsForm?.tenantLabel || '-'} | TMS window: {summary.windowStart || '-'} to {summary.windowEnd || '-'} | Topbar range: {range?.startDate || '-'} to {range?.endDate || '-'} | Status: {tripMonitorIncludedStatusesLabel} | Last sync: {summary.lastSync?.syncedAt ? fmtDate(summary.lastSync.syncedAt) : 'Belum pernah'} | Auto-sync: {summary.autoSync ? `Aktif / ${summary.syncIntervalMinutes || 15} min` : 'Off'} | Rows: {visibleRows.length}
        </div>

        <TripMonitorKanban
          rows={visibleRows}
          selectedRowId={selectedTripMonitorRowId(tripMonitorPanels)}
          onOpen={(row) => onOpenDetail?.(row.rowId)}
        />
      </CardContent>
    </Card>
  );
}

