import React from 'react';
import { X, Clock3, Phone, RefreshCw } from 'lucide-react';
import { Action, TripMonitorOverrideBadge } from '../index';

export function TripMonitorDetailHeader({
  detail,
  headlineJob,
  eta,
  isStale,
  refreshing,
  onClose,
  onRefresh,
  onOverrideBadge,
  onWaDriver,
  displayUnitLabel,
  driver1Name,
  driver2Name,
  severityKey,
  customerName,
  tmsSeverityLabel
}) {
  return (
    <div className="tm-drawer-header-wrapper">
      <div
        className="tm-drawer-header-tier1"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#ffffff',
          borderBottom: '1px solid #e5e7eb',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '48px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, fontFamily: 'Inter', letterSpacing: '-0.01em', color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayUnitLabel}
          </h2>

          <span className={`tm-severity-dot severity-${severityKey}`} />
          <span className={`tm-severity-badge severity-${severityKey}`}>
            {tmsSeverityLabel ? tmsSeverityLabel(detail?.severity) : (detail?.severity || 'Unknown')}
          </span>

          {eta ? (
            <div
              style={{
                fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                fontSize: '12px',
                fontWeight: 500,
                letterSpacing: '-0.01em',
                color: eta.status === 'on-time' ? 'var(--success)' :
                  eta.status === 'at-risk' ? 'var(--warning)' :
                  eta.status === 'late' ? 'var(--danger)' : 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Clock3 size={13} />
              <span>
                {eta.durationSeconds
                  ? `~${Math.floor(eta.durationSeconds / 3600)}h ${Math.floor((eta.durationSeconds % 3600) / 60)}m`
                  : 'ETA Unknown'}
              </span>
              {eta.distanceMeters && (
                <span style={{ opacity: 0.7, fontSize: '12px' }}>
                  ({Math.round(eta.distanceMeters / 1000)}km)
                </span>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '12px' }}>
              <Clock3 size={12} style={{ opacity: 0.5 }} />
              <span>Calculating ETA...</span>
            </div>
          )}

          {isStale && (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--warning)', fontSize: '11px', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.1)' }}
              onClick={onRefresh}
              title="Data updated on board. Click to refresh detail."
            >
              <div
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--warning)',
                  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                }}
              />
              Data updated
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onRefresh && (
            <Action
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              disabled={refreshing}
              title="Refresh Data"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </Action>
          )}
          <Action
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close drawer"
            title="Close (Esc)"
          >
            <X size={18} />
          </Action>
        </div>
      </div>

      <div
        className="tm-drawer-header-tier2"
        style={{
          padding: '10px 16px',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px 12px',
          background: '#ffffff'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          {customerName && <span className="tm-brand-chip">{customerName}</span>}
          {headlineJob?.name && <span className="tm-jo-chip">{headlineJob.name}</span>}
          <TripMonitorOverrideBadge
            overrides={detail?.overrides || {}}
            joId={detail?.joId}
            onReset={onOverrideBadge}
          />
        </div>

        {(driver1Name || driver2Name) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '8px', flex: '1 1 220px' }}>
            {driver1Name && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', color: '#374151' }}>{driver1Name}</span>
                <Action variant="ghost" size="icon" onClick={() => onWaDriver?.(1)} style={{ width: '24px', height: '24px', color: 'var(--success)' }} title="WhatsApp Driver 1">
                  <Phone size={14} />
                </Action>
              </div>
            )}
            {driver1Name && driver2Name && <div style={{ width: '1px', height: '12px', background: 'var(--border)' }} />}
            {driver2Name && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', color: '#374151' }}>{driver2Name}</span>
                <Action variant="ghost" size="icon" onClick={() => onWaDriver?.(2)} style={{ width: '24px', height: '24px', color: 'var(--success)' }} title="WhatsApp Driver 2">
                  <Phone size={14} />
                </Action>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
