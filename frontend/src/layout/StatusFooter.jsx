import React from 'react';
import { AlertTriangle } from 'lucide-react';

export function StatusFooter({ isPolling, nextRunLabel, snapshotLabel, errorMessage, accountName }) {
  return (
    <footer className="status-strip" role="contentinfo">
      <div className="status-strip-section">
        <span className={`status-strip-state ${isPolling ? 'status-strip-state-on' : 'status-strip-state-off'}`}>
          <span className="status-strip-pulse" aria-hidden />
          <span className="status-strip-state-label">{isPolling ? 'Polling' : 'Idle'}</span>
        </span>
        {nextRunLabel ? (
          <span className="status-strip-meta">
            <span className="status-strip-meta-label">Next</span>
            <strong>{nextRunLabel}</strong>
          </span>
        ) : null}
      </div>
      <div className="status-strip-section status-strip-section-end">
        {accountName ? (
          <span className="status-strip-meta">
            <span className="status-strip-meta-label">Account</span>
            <strong>{accountName}</strong>
          </span>
        ) : null}
        {snapshotLabel ? (
          <span className="status-strip-meta">
            <span className="status-strip-meta-label">Snapshot</span>
            <strong>{snapshotLabel}</strong>
          </span>
        ) : null}
        {errorMessage ? (
          <span className="status-strip-error">
            <AlertTriangle size={12} strokeWidth={1.75} />
            <span>{errorMessage}</span>
          </span>
        ) : null}
      </div>
    </footer>
  );
}
