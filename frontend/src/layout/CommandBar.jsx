import React from 'react';
import { Search, ArrowRight, Calendar, Zap, RefreshCw, Download, ShieldAlert, Play, Square } from 'lucide-react';
import { Action } from '../components/Action.jsx';

const PANEL_LABELS = {
  overview: 'Mission Control',
  fleet: 'Fleet Live',
  'trip-monitor': 'Trip Monitor',
  map: 'Map View',
  'astro-report': 'Astro Report',
  'temp-errors': 'Temp Errors',
  stop: 'Stop / Idle',
  'api-monitor': 'API Monitor',
  config: 'Config',
  admin: 'Admin Console',
};

const PANEL_GROUPS = {
  overview: 'Fleet Ops',
  fleet: 'Fleet Ops',
  'trip-monitor': 'Fleet Ops',
  map: 'Fleet Ops',
  'astro-report': 'Analytics',
  'temp-errors': 'Analytics',
  stop: 'Analytics',
  'api-monitor': 'Platform',
  config: 'Platform',
  admin: 'Platform',
};

export function CommandBar({
  activePanel,
  range,
  onRangeChange,
  search,
  onSearchChange,
  accountName,
  onExportFleet,
  onExportAlerts,
  onRefresh,
  onPollNow,
  onTogglePolling,
  isPolling,
  isOnline,
  rightExtras,
}) {
  const groupLabel = PANEL_GROUPS[activePanel] || 'Workspace';
  const panelLabel = PANEL_LABELS[activePanel] || 'Workspace';
  return (
    <header className="command-bar" role="banner">
      <div className="command-bar-row command-bar-row-primary">
        <nav className="command-bar-breadcrumb" aria-label="Breadcrumb">
          <span className="breadcrumb-tag">{groupLabel}</span>
          <span className="breadcrumb-sep" aria-hidden>/</span>
          <span className="breadcrumb-current">{panelLabel}</span>
        </nav>

        <div className="command-bar-search" role="search">
          <Search size={14} className="command-bar-search-icon" strokeWidth={1.75} />
          <input
            type="text"
            placeholder="Search account, unit, location, JO..."
            value={search || ''}
            onChange={(event) => onSearchChange?.(event.target.value)}
            aria-label="Global search"
          />
          <span className="command-bar-search-hint">Cmd K</span>
        </div>

        <div className="command-bar-meta">
          <span className={`command-bar-online ${isOnline ? 'command-bar-online-on' : 'command-bar-online-off'}`}>
            <span className="command-bar-online-dot" />
            <span>{isOnline ? 'Live' : 'Offline'}</span>
          </span>
          <span className="command-bar-account" title="Active account">
            <span className="command-bar-account-label">Account</span>
            <strong>{accountName || 'Primary'}</strong>
          </span>
        </div>
      </div>

      <div className="command-bar-row command-bar-row-secondary">
        <div className="command-bar-range">
          <Calendar size={14} className="command-bar-range-icon" strokeWidth={1.75} />
          <input
            type="date"
            value={range?.startDate || ''}
            onClick={(event) => event.currentTarget.showPicker?.()}
            onChange={(event) => onRangeChange?.((c) => ({ ...c, startDate: event.target.value }))}
            aria-label="Range start"
          />
          <ArrowRight size={12} className="command-bar-range-arrow" strokeWidth={1.75} />
          <input
            type="date"
            value={range?.endDate || ''}
            onClick={(event) => event.currentTarget.showPicker?.()}
            onChange={(event) => onRangeChange?.((c) => ({ ...c, endDate: event.target.value }))}
            aria-label="Range end"
          />
        </div>

        <div className="command-bar-actions">
          {onExportFleet ? <Action variant="ghost" size="sm" startIcon={<Download size={13} strokeWidth={1.75} />} onClick={onExportFleet}>Live</Action> : null}
          {onExportAlerts ? <Action variant="ghost" size="sm" startIcon={<ShieldAlert size={13} strokeWidth={1.75} />} onClick={onExportAlerts}>Alerts</Action> : null}
          {onRefresh ? <Action variant="ghost" size="sm" startIcon={<RefreshCw size={13} strokeWidth={1.75} />} onClick={onRefresh}>Refresh</Action> : null}
          {onTogglePolling ? (
            <Action
              variant={isPolling ? 'secondary' : 'secondary'}
              size="sm"
              startIcon={isPolling ? <Square size={13} strokeWidth={1.75} /> : <Play size={13} strokeWidth={1.75} />}
              onClick={onTogglePolling}
            >
              {isPolling ? 'Stop polling' : 'Start polling'}
            </Action>
          ) : null}
          {onPollNow ? <Action variant="primary" size="sm" startIcon={<Zap size={13} strokeWidth={1.75} />} onClick={onPollNow}>Poll now</Action> : null}
          {rightExtras ? <div className="command-bar-extras">{rightExtras}</div> : null}
        </div>
      </div>
    </header>
  );
}
