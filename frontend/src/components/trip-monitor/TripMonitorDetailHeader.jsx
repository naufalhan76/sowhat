import React, { useState } from 'react';
import { X, Clock3, Route, Truck, Phone, RefreshCw, AlertTriangle } from 'lucide-react';
import { Action, Pill, Surface, TripMonitorOverrideBadge } from '../index';

export function TripMonitorDetailHeader({
  detail,
  headlineJob,
  shippingStatus,
  eta,
  overrideActive,
  isStale,
  refreshing,
  onClose,
  onRefresh,
  onForceClose,
  onOverrideBadge,
  onWaDriver,
  displayUnitLabel,
  driver1Name,
  driver2Name,
  routeSummary,
  severityKey,
  customerName,
  tmsSeverityLabel
}) {
  const [showForceCloseConfirm, setShowForceCloseConfirm] = useState(false);
  const [forceCloseReason, setForceCloseReason] = useState('');
  const [isSubmittingClose, setIsSubmittingClose] = useState(false);

  const handleForceCloseSubmit = async () => {
    if (forceCloseReason.length < 5) return;
    setIsSubmittingClose(true);
    try {
      await onForceClose(forceCloseReason);
      setShowForceCloseConfirm(false);
      setForceCloseReason('');
    } finally {
      setIsSubmittingClose(false);
    }
  };

  return (
    <div className="tm-drawer-header-wrapper">
      {/* Tier 1: Sticky Glance */}
      <div 
        className="tm-drawer-header-tier1" 
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '48px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600, fontFamily: 'Inter', letterSpacing: '-0.01em', color: 'var(--text-main)' }}>
            {displayUnitLabel}
          </h2>
          
          <span className={`tm-severity-badge severity-${severityKey}`}>
            {tmsSeverityLabel ? tmsSeverityLabel(detail?.severity) : (detail?.severity || 'Unknown')}
          </span>

          {shippingStatus && (
            <Pill variant="default" size="sm">
              {shippingStatus.label || 'Unknown Status'}
            </Pill>
          )}

          {eta && (
            <div 
              style={{ 
                fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', 
                fontSize: '14px', 
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
              <Clock3 size={14} />
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

      {/* Tier 2: Scrolling Reference */}
      <div 
        className="tm-drawer-header-tier2"
        style={{
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          background: 'var(--bg)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          {customerName && (
            <span className="tm-brand-chip">{customerName}</span>
          )}
          
          {headlineJob?.name && (
            <span className="tm-jo-chip">{headlineJob.name}</span>
          )}

          <TripMonitorOverrideBadge 
            overrides={detail?.overrides || {}} 
            joId={detail?.joId} 
            onReset={onOverrideBadge} 
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1, minWidth: '300px' }}>
            {(driver1Name || driver2Name) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {driver1Name && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-main)' }}>{driver1Name}</span>
                    <Action 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => onWaDriver?.(1)}
                      style={{ width: '28px', height: '28px', color: 'var(--success)' }}
                      title="WhatsApp Driver 1"
                    >
                      <Phone size={14} />
                    </Action>
                  </div>
                )}
                
                {driver1Name && driver2Name && (
                  <div style={{ width: '1px', height: '12px', background: 'var(--border)' }} />
                )}
                
                {driver2Name && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-main)' }}>{driver2Name}</span>
                    <Action 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => onWaDriver?.(2)}
                      style={{ width: '28px', height: '28px', color: 'var(--success)' }}
                      title="WhatsApp Driver 2"
                    >
                      <Phone size={14} />
                    </Action>
                  </div>
                )}
              </div>
            )}

            {routeSummary && (
              <>
                <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                  <Route size={14} />
                  <span>{routeSummary}</span>
                </div>
              </>
            )}
          </div>

          {onForceClose && !showForceCloseConfirm && detail?.status !== 'closed' && (
            <Action variant="danger" size="sm" onClick={() => setShowForceCloseConfirm(true)}>
              Force Close
            </Action>
          )}
          
          {showForceCloseConfirm && (
            <Surface 
              variant="elevated" 
              style={{
                position: 'absolute',
                top: '100%',
                right: '16px',
                width: '320px',
                padding: '16px',
                zIndex: 50,
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                boxShadow: 'var(--shadow-xl)',
                border: '1px solid var(--border-danger)',
                background: 'var(--surface)',
                borderRadius: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', fontWeight: 600, fontSize: '14px' }}>
                <AlertTriangle size={16} />
                <span>Confirm Force Close</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                This will mark the job order as "Selesai" and bypass all remaining validations. A reason is required.
              </p>
              <textarea
                value={forceCloseReason}
                onChange={e => setForceCloseReason(e.target.value)}
                placeholder="Reason for force closing (min 5 chars)..."
                style={{
                  width: '100%',
                  minHeight: '80px',
                  padding: '8px 12px',
                  fontSize: '13px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text-main)',
                  resize: 'vertical',
                  fontFamily: 'Inter'
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                <Action 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    setShowForceCloseConfirm(false);
                    setForceCloseReason('');
                  }}
                  disabled={isSubmittingClose}
                >
                  Cancel
                </Action>
                <Action 
                  variant="danger" 
                  size="sm" 
                  onClick={handleForceCloseSubmit}
                  disabled={forceCloseReason.length < 5 || isSubmittingClose}
                  loading={isSubmittingClose}
                >
                  Confirm Close
                </Action>
              </div>
            </Surface>
          )}
        </div>
      </div>
    </div>
  );
}
