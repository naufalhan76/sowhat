import React from 'react';
import { AlertTriangle } from 'lucide-react';

function joinMeta(parts) {
  return parts.filter(Boolean).join(' · ');
}

export function StatusFooter({ isPolling, nextRunLabel, snapshotLabel, errorMessage }) {
  const left = joinMeta([
    isPolling ? 'Polling on' : 'Polling off',
    nextRunLabel ? `next ${nextRunLabel}` : null,
  ]);
  const right = joinMeta([
    snapshotLabel ? `last sync ${snapshotLabel}` : null,
  ]);
  return (
    <footer className="status-strip" role="contentinfo">
      <span className={`status-strip-text ${isPolling ? 'status-strip-on' : ''}`.trim()}>{left}</span>
      {right ? <span className="status-strip-text status-strip-text-end">{right}</span> : null}
      {errorMessage ? (
        <span className="status-strip-error">
          <AlertTriangle size={12} strokeWidth={1.75} aria-hidden />
          <span>{errorMessage}</span>
        </span>
      ) : null}
    </footer>
  );
}
