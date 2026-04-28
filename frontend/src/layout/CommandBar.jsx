import React from 'react';
import { Search, Calendar, RefreshCw, Download, ShieldAlert, Play, Square, Zap } from 'lucide-react';
import { Action } from '../components/Action.jsx';

const PANEL_TITLES = {
  overview: 'Overview',
  fleet: 'Fleet',
  'trip-monitor': 'Trips',
  map: 'Map',
  'astro-report': 'Astro report',
  'temp-errors': 'Temp errors',
  stop: 'Stop / idle',
  'api-monitor': 'API monitor',
  config: 'Config',
  admin: 'Admin',
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
  busy,
}) {
  const title = PANEL_TITLES[activePanel] || 'Workspace';
  return (
    <header className="command-bar" role="banner">
      <div className="command-bar-left">
        <h1 className="command-bar-title-text">{title}</h1>
        {accountName ? <span className="command-bar-account">{accountName}</span> : null}
      </div>

      <div className="command-bar-center">
        <div className="command-bar-search" role="search">
          <Search size={14} strokeWidth={1.75} className="command-bar-search-icon" aria-hidden />
          <input
            type="text"
            placeholder="Search units, alerts..."
            value={search || ''}
            onChange={(event) => onSearchChange?.(event.target.value)}
            aria-label="Global search"
          />
          <kbd className="command-bar-search-kbd">Ctrl K</kbd>
        </div>
      </div>

      <div className="command-bar-right">
        <div className="command-bar-range">
          <Calendar size={13} strokeWidth={1.75} className="command-bar-range-icon" aria-hidden />
          <input
            type="date"
            value={range?.startDate || ''}
            onClick={(event) => event.currentTarget.showPicker?.()}
            onChange={(event) => onRangeChange?.((c) => ({ ...c, startDate: event.target.value }))}
            aria-label="Range start"
          />
          <span className="command-bar-range-sep" aria-hidden>—</span>
          <input
            type="date"
            value={range?.endDate || ''}
            onClick={(event) => event.currentTarget.showPicker?.()}
            onChange={(event) => onRangeChange?.((c) => ({ ...c, endDate: event.target.value }))}
            aria-label="Range end"
          />
        </div>

        <div className="command-bar-divider" aria-hidden />

        <div className="command-bar-actions">
          {onRefresh ? (
            <button type="button" className="command-bar-icon-btn" onClick={onRefresh} disabled={busy} title="Refresh" aria-label="Refresh">
              <RefreshCw size={14} strokeWidth={1.75} className={busy ? 'command-bar-spin' : ''} />
            </button>
          ) : null}
          {onExportFleet ? (
            <button type="button" className="command-bar-icon-btn" onClick={onExportFleet} title="Export fleet CSV" aria-label="Export fleet CSV">
              <Download size={14} strokeWidth={1.75} />
            </button>
          ) : null}
          {onExportAlerts ? (
            <button type="button" className="command-bar-icon-btn" onClick={onExportAlerts} title="Export alerts" aria-label="Export alerts">
              <ShieldAlert size={14} strokeWidth={1.75} />
            </button>
          ) : null}
          {onTogglePolling ? (
            <button
              type="button"
              className={`command-bar-icon-btn ${isPolling ? 'command-bar-icon-btn-on' : ''}`.trim()}
              onClick={onTogglePolling}
              title={isPolling ? 'Stop polling' : 'Start polling'}
              aria-label={isPolling ? 'Stop polling' : 'Start polling'}
            >
              {isPolling ? <Square size={14} strokeWidth={1.75} /> : <Play size={14} strokeWidth={1.75} />}
            </button>
          ) : null}
          {onPollNow ? (
            <Action variant="primary" size="sm" startIcon={<Zap size={13} strokeWidth={1.75} />} onClick={onPollNow} disabled={busy} loading={busy}>
              Poll
            </Action>
          ) : null}
        </div>
      </div>
    </header>
  );
}
