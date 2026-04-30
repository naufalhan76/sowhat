import React from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * Generic wrapper for deep-dive sub-views (Historical, Incidents, Audit Log).
 * Renders a back button, contextual header, and children content.
 */
export function TripMonitorDeepDiveShell({ title, context, onBack, children }) {
  const unitLabel = context?.alias || context?.label || context?.unitId || '-';
  const jobOrderId = context?.jobOrderId || context?.rowId || null;

  return (
    <div className="tm-deep-dive-shell">
      <div className="tm-deep-dive-header">
        <button type="button" className="sf-btn sf-btn-bordered tm-deep-dive-back" onClick={onBack}>
          <ArrowLeft size={14} />
          <span>Back to Board</span>
        </button>
        <div className="tm-deep-dive-title-block">
          <h2 className="tm-deep-dive-title">{title}</h2>
          <div className="tm-deep-dive-context">
            <span className="tm-deep-dive-chip">{unitLabel}</span>
            {jobOrderId ? <span className="tm-deep-dive-chip tm-deep-dive-chip--muted">JO: {jobOrderId}</span> : null}
          </div>
        </div>
      </div>
      <div className="tm-deep-dive-body">
        {children}
      </div>
    </div>
  );
}
