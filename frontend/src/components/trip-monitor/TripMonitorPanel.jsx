import React, { useState, useEffect } from 'react';
import { Search, SlidersHorizontal, RefreshCw, ArrowUpDown, ChevronDown } from 'lucide-react';

import { Action, Spinner, ModalPortal } from '../index.js';
import { TMS_BOARD_COLUMNS, TMS_INCIDENT_LEGEND_CODES, tmsIncidentLabel } from './helpers.jsx';
import { TripMonitorIncidentLegend } from './TripMonitorIncidentLegend.jsx';
import { TripMonitorKanban } from './TripMonitorKanban.jsx';
import { TripMonitorHistoricalView } from './TripMonitorHistoricalView.jsx';
import { TripMonitorIncidentView } from './TripMonitorIncidentView.jsx';
import { TripMonitorAuditLogView } from './TripMonitorAuditLogView.jsx';
import { TripMonitorDeepDiveShell } from './TripMonitorDeepDiveShell.jsx';

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
  onRefresh,
  onSyncTms,
  onOpenDetail,
  isAdmin,
  fmtDate,
  fmtNum,
  formatMinutesText,
  DataTable,
  setTripMonitorPanels,
  pendingSubView,
  clearPendingSubView,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [subView, setSubView] = useState({ type: 'board', context: null });
  const [statusFilter, setStatusFilter] = useState('all');
  const [addJoOpen, setAddJoOpen] = useState(false);
  const [addJoValue, setAddJoValue] = useState('');
  const [addJoLoading, setAddJoLoading] = useState(false);
  const [addJoError, setAddJoError] = useState('');
  const filters = tripMonitorFilters || {};
  const summary = tripMonitorSummary || {};
  const visibleRows = tripMonitorVisibleRows || [];
  const severityCounts = tripMonitorSeverityCounts || {};
  const filteredRows = statusFilter === 'all'
    ? visibleRows
    : visibleRows.filter((row) => {
      const key = row?.metadata?.shippingStatus?.key || '';
      return key === statusFilter;
    });

  // Consume pending sub-view from floating panel navigation
  useEffect(() => {
    if (pendingSubView) {
      setSubView(pendingSubView);
      clearPendingSubView?.();
    }
  }, [pendingSubView]);

  const updateFilters = (patch) => {
    setTripMonitorFilters((current) => ({ ...current, ...patch }));
  };

  const handleOpenHistorical = (context) => {
    setSubView({ type: 'historical', context });
    if (setTripMonitorPanels) setTripMonitorPanels([]);
  };

  const handleOpenIncidents = (context) => {
    setSubView({ type: 'incidents', context });
    if (setTripMonitorPanels) setTripMonitorPanels([]);
  };

  const handleOpenAuditLog = (context) => {
    setSubView({ type: 'audit-log', context });
    if (setTripMonitorPanels) setTripMonitorPanels([]);
  };

  const handleBackToBoard = () => {
    setSubView({ type: 'board', context: null });
  };

  const handleOpenAddJo = () => {
    setAddJoError('');
    setAddJoOpen(true);
  };

  const handleCloseAddJo = () => {
    if (addJoLoading) return;
    setAddJoOpen(false);
    setAddJoValue('');
    setAddJoError('');
  };

  const handleSubmitAddJo = async (event) => {
    event.preventDefault();
    const joId = addJoValue.trim();

    if (!joId) {
      setAddJoError('JO number wajib diisi');
      return;
    }

    setAddJoLoading(true);
    setAddJoError('');

    try {
      const response = await fetch('/api/tms/board/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
          Referer: window.location.href,
        },
        body: JSON.stringify({ joId }),
      });

      if (response.ok) {
        setAddJoOpen(false);
        setAddJoValue('');
        setAddJoError('');
        onRefreshBoard?.();
        onRefresh?.();
        return;
      }

      if (response.status === 409) {
        setAddJoError('JO sudah ada di board');
      } else if (response.status === 404) {
        setAddJoError('JO tidak ditemukan di TMS');
      } else if (response.status === 422) {
        setAddJoError('Unit tidak terdaftar di Solofleet');
      } else {
        setAddJoError('Gagal menambahkan JO');
      }
    } catch (error) {
      setAddJoError('Gagal menambahkan JO');
    } finally {
      setAddJoLoading(false);
    }
  };

  const totalCount = severityCounts.total || 0;
  const criticalCount = severityCounts.bySeverity?.critical || 0;
  const warningCount = severityCounts.bySeverity?.warning || 0;
  const normalCount = severityCounts.bySeverity?.normal || 0;
  const unmatchedCount = severityCounts.bySeverity?.unmatched || 0;
  const noJoCount = severityCounts.bySeverity?.['no-job-order'] || 0;
  const tenantLabel = tmsConfig?.tenantLabel || tmsForm?.tenantLabel || '-';
  const lastSyncLabel = summary.lastSync?.syncedAt ? fmtDate(summary.lastSync.syncedAt) : 'Belum pernah';
  const autoSyncLabel = summary.autoSync ? `Aktif / ${summary.syncIntervalMinutes || 15} min` : 'Off';

  const hasActiveFilters = (filters.customer && filters.customer !== 'all')
    || (filters.incidentCode && filters.incidentCode !== 'all')
    || (filters.appStatus && filters.appStatus !== '');

  return (
    <section className="tm-page">
      {/* ── Hero: title + metrics ── */}
      <header className="tm-page-hero">
        <div className="tm-page-hero-left">
          <h1 className="tm-page-title">Trip Monitor</h1>
          <p className="tm-page-subtitle">
            {tenantLabel} — {tripMonitorIncludedStatusesLabel}
          </p>
        </div>
        <div className="tm-page-hero-actions">
          <button
            type="button"
            className="sf-btn sf-btn-bordered tm-add-jo-btn"
            onClick={handleOpenAddJo}
          >
            + Add JO
          </button>
          <button
            type="button"
            className="sf-btn sf-btn-bordered tm-refresh-btn"
            onClick={onRefreshBoard}
            disabled={tripMonitorBusy}
          >
            {tripMonitorBusy
              ? <><Spinner size="sm" /> Refreshing</>
              : <><RefreshCw size={14} /> Refresh</>}
          </button>
          {isAdmin ? (
            <button type="button" className="sf-btn sf-btn-primary" onClick={onSyncTms}>
              <ArrowUpDown size={14} /> Sync TMS
            </button>
          ) : null}
        </div>
      </header>

      {/* ── Metrics strip ── */}
      <div className="tm-metrics-strip">
        <div className="tm-metric">
          <span className="tm-metric-value">{totalCount}</span>
          <span className="tm-metric-label">Total unit</span>
        </div>
        <div className="tm-metric tm-metric--critical">
          <span className="tm-metric-value">{criticalCount}</span>
          <span className="tm-metric-label">Critical</span>
        </div>
        <div className="tm-metric tm-metric--warning">
          <span className="tm-metric-value">{warningCount}</span>
          <span className="tm-metric-label">Warning</span>
        </div>
        <div className="tm-metric tm-metric--normal">
          <span className="tm-metric-value">{normalCount}</span>
          <span className="tm-metric-label">Normal</span>
        </div>
        <div className="tm-metric">
          <span className="tm-metric-value">{unmatchedCount + noJoCount}</span>
          <span className="tm-metric-label">Unmatched / No JO</span>
        </div>
        <div className="tm-metric tm-metric--sync">
          <span className="tm-metric-value tm-metric-value--text">{autoSyncLabel}</span>
          <span className="tm-metric-label">Auto-sync</span>
        </div>
      </div>

      {/* ── Controls row: severity tabs + search + filter toggle ── */}
      <div className="tm-controls-row">
        <div className="tm-severity-tabs">
          <button
            type="button"
            className={`tm-severity-pill ${filters.severity === 'all' ? 'is-active' : ''}`}
            onClick={() => updateFilters({ severity: 'all' })}
          >
            All <span className="tm-pill-count">{totalCount}</span>
          </button>
          {TMS_BOARD_COLUMNS.map((column) => (
            <button
              type="button"
              key={column.key}
              className={`tm-severity-pill tm-severity-pill--${column.key} ${filters.severity === column.key ? 'is-active' : ''}`}
              onClick={() => updateFilters({ severity: column.key })}
            >
              {column.label} <span className="tm-pill-count">{severityCounts.bySeverity?.[column.key] || 0}</span>
            </button>
          ))}
        </div>

        <div className="tm-controls-right">
          <div className="tm-search-compact">
            <Search size={14} className="tm-search-icon" />
            <input
              type="search"
              value={filters.search || ''}
              onChange={(event) => updateFilters({ search: event.target.value })}
              placeholder="Cari nopol, JO..."
            />
          </div>
          <button
            type="button"
            className={`sf-btn sf-btn-bordered tm-filter-toggle ${filtersOpen ? 'is-active' : ''} ${hasActiveFilters ? 'has-filters' : ''}`}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontal size={14} />
            Filter
            {hasActiveFilters ? <span className="tm-filter-dot" /> : null}
            <ChevronDown size={12} className={`tm-filter-chevron ${filtersOpen ? 'is-open' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── Collapsible filter drawer ── */}
      {filtersOpen ? (
        <div className="tm-filter-drawer">
          <div className="tm-filter-grid">
            <label className="tm-filter-field">
              <span>Customer</span>
              <select value={filters.customer || 'all'} onChange={(event) => updateFilters({ customer: event.target.value })}>
                {(tripMonitorCustomerOptions || []).map((option) => (
                  <option key={`customer-${option}`} value={option}>{option === 'all' ? 'All customers' : option}</option>
                ))}
              </select>
            </label>

            <label className="tm-filter-field">
              <span>Incident</span>
              <select value={filters.incidentCode || 'all'} onChange={(event) => updateFilters({ incidentCode: event.target.value })}>
                <option value="all">All incidents</option>
                {(tripMonitorIncidentOptions || [])
                  .filter((option) => option !== 'all')
                  .map((option) => <option key={option} value={option}>{tmsIncidentLabel(option)}</option>)}
              </select>
            </label>

            <div className="tm-filter-field tm-filter-legend-wrap">
              <span>Incident legend</span>
              <TripMonitorIncidentLegend codes={TMS_INCIDENT_LEGEND_CODES} className="tm-filter-legend" />
            </div>
          </div>

          <div className="tm-filter-context">
            TMS window: {summary.windowStart || '-'} to {summary.windowEnd || '-'} · Topbar range: {range?.startDate || '-'} to {range?.endDate || '-'} · Last sync: {lastSyncLabel} · Rows: {visibleRows.length}
          </div>
        </div>
      ) : null}

      {addJoOpen ? (
        <ModalPortal>
          <div
            className="auth-modal-backdrop"
            onClick={handleCloseAddJo}
            role="presentation"
          >
            <div
              className="auth-modal-card tm-add-jo-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="tm-add-jo-title"
              onClick={(event) => event.stopPropagation()}
            >
              <form onSubmit={handleSubmitAddJo} className="tm-add-jo-form">
              <div className="tm-add-jo-header" style={{ marginBottom: '12px' }}>
                <div id="tm-add-jo-title" className="tm-add-jo-title" style={{ fontWeight: 700 }}>
                  Add Job Order
                </div>
                <div className="tm-add-jo-subtitle" style={{ fontSize: '12px', opacity: 0.75 }}>
                  Tambah JO manual ke board TMS
                </div>
              </div>

              <label className="tm-add-jo-field" style={{ display: 'grid', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600 }}>JO Number</span>
                <input
                  type="text"
                  value={addJoValue}
                  onChange={(event) => setAddJoValue(event.target.value)}
                  placeholder="JO-XXXXX"
                  autoFocus
                  className="tm-add-jo-input"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid rgba(148, 163, 184, 0.35)',
                    background: 'transparent',
                  }}
                />
              </label>

              {addJoError ? (
                <div className="tm-add-jo-error" style={{ marginTop: '10px', color: '#dc2626', fontSize: '12px' }}>
                  {addJoError}
                </div>
              ) : null}

              <div className="tm-add-jo-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
                <button
                  type="button"
                  className="sf-btn sf-btn-bordered tm-add-jo-cancel"
                  onClick={handleCloseAddJo}
                  disabled={addJoLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="sf-btn sf-btn-primary tm-add-jo-submit"
                  disabled={addJoLoading}
                >
                  {addJoLoading ? 'Adding...' : 'Add'}
                </button>
              </div>
            </form>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {/* ── Main Content Area ── */}
      {subView.type === 'board' ? (
        <>
          <div className="tm-status-filter-row">
            {[
              { key: 'all', label: 'Semua' },
              { key: 'otw-load', label: 'OTW Load' },
              { key: 'sampai-load', label: 'Sampai Load' },
              { key: 'menuju-unload', label: 'Menuju Unload' },
              { key: 'sampai-unload', label: 'Sampai Unload' },
              { key: 'selesai-bongkar', label: 'Selesai Bongkar' },
            ].map((filter) => (
              <button
                key={filter.key}
                type="button"
                className={`tm-status-filter-chip ${statusFilter === filter.key ? 'is-active' : ''}`}
                onClick={() => setStatusFilter(filter.key)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <TripMonitorKanban
            rows={filteredRows}
            selectedRowId={selectedTripMonitorRowId(tripMonitorPanels)}
            onOpen={(row) => onOpenDetail?.(row.rowId)}
            severityCounts={severityCounts}
          />
        </>
      ) : (
        <TripMonitorDeepDiveShell
          title={
            subView.type === 'historical' ? 'Historical Records' :
            subView.type === 'incidents' ? 'Incident History' :
            subView.type === 'audit-log' ? 'Override Audit Log' : 'Detail View'
          }
          context={subView.context}
          onBack={handleBackToBoard}
        >
          {subView.type === 'historical' ? (
            <TripMonitorHistoricalView
              context={subView.context}
              range={range}
              DataTable={DataTable}
              fmtDate={fmtDate}
              fmtNum={fmtNum}
            />
          ) : subView.type === 'incidents' ? (
            <TripMonitorIncidentView
              context={subView.context}
              DataTable={DataTable}
              fmtDate={fmtDate}
              formatMinutesText={formatMinutesText}
            />
          ) : subView.type === 'audit-log' ? (
            <TripMonitorAuditLogView
              context={subView.context}
              fmtDate={fmtDate}
            />
          ) : null}
        </TripMonitorDeepDiveShell>
      )}
    </section>
  );
}
