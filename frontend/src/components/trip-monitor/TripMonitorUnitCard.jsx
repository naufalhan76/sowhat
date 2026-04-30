import React from 'react';
import { AlertCircle, Thermometer, MapPin, Clock3 } from 'lucide-react';

import { normalizeTemperatureRange } from './helpers.jsx';
import { TripMonitorIncidentIcons } from './TripMonitorIncidentIcons.jsx';

const fmtNum = (value, digits = 1) => (value == null ? '-' : Number(value).toFixed(digits));

function compactDriverStatus(value) {
  return String(value || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ');
}

function formatEta(durationSeconds) {
  if (!durationSeconds) return null;
  const s = Number(durationSeconds);
  if (s < 3600) {
    return `~${Math.floor(s / 60)}m`;
  }
  return `~${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export const TripMonitorUnitCard = React.memo(function TripMonitorUnitCard({ row, onOpen, isActive = false }) {
  const unitLabel = row?.unitLabel || row?.unitId || row?.normalizedPlate || '-';
  const shippingStatus = row?.shippingStatusLabel || row?.metadata?.shippingStatus?.label || '-';
  const activeStopName = row?.metadata?.shippingStatus?.activeStopName || '';
  const jobOrderId = row?.jobOrderId || '-';
  const customerName = row?.customerName || '-';
  const tempRange = normalizeTemperatureRange(row?.tempMin, row?.tempMax);
  const tempLabel = tempRange.min !== null ? `${fmtNum(tempRange.min)}° — ${fmtNum(tempRange.max)}°` : null;
  const incidentSummary = row?.incidentSummary && row.incidentSummary !== '-' ? row.incidentSummary : '';
  const driverAppStatus = row?.driverAppStatus && row.driverAppStatus !== '-' ? row.driverAppStatus : '';
  const driverAppCompact = compactDriverStatus(driverAppStatus);
  const severity = row?.severity || 'normal';

  const etaData = row?.eta || row?.metadata?.eta;
  const etaLabel = etaData ? formatEta(etaData.durationSeconds) : null;
  const etaStatus = etaData?.status || 'neutral';
  
  const isOverrideActive = row?.overrideActive === true || row?.metadata?.overrideActive === true;

  const cardClasses = [
    'tm-card',
    `tm-card--${severity}`,
    isActive ? 'is-active' : '',
  ].filter(Boolean).join(' ');

  return (
    <button type="button" className={cardClasses} onClick={onOpen} title={`${unitLabel} — ${jobOrderId} | ${customerName}`}>
      {/* Severity rail */}
      <div className="tm-card-rail" aria-hidden="true" />

      {/* Primary row: unit code + incident icons */}
      <div className="tm-card-primary">
        <div className="tm-card-unit-block">
          <strong className="tm-card-unit" title={unitLabel}>{unitLabel}</strong>
          <span className="tm-card-customer" title={customerName}>{customerName}</span>
        </div>
        <TripMonitorIncidentIcons codes={row?.incidentCodes || []} />
      </div>

      {/* Incident alert (if any) */}
      {incidentSummary ? (
        <div className="tm-card-alert" title={incidentSummary}>
          <AlertCircle size={13} />
          <span>{incidentSummary}</span>
        </div>
      ) : null}

      {/* Status + location */}
      <div className="tm-card-status-row">
        <span className="tm-card-status" title={shippingStatus}>{shippingStatus}</span>
        {activeStopName ? (
          <span className="tm-card-location" title={activeStopName}>
            <MapPin size={11} /> {activeStopName}
          </span>
        ) : null}
      </div>

      {/* ETA row */}
      {etaLabel && (
        <div className={`tm-card-eta tm-card-eta--${etaStatus}`} title={`ETA to ${etaData?.stopName || 'destination'}`}>
          <Clock3 size={11} />
          <span>{etaLabel}</span>
        </div>
      )}

      {/* Metadata footer */}
      <div className="tm-card-footer">
        <span className="tm-card-jo" title={jobOrderId}>{jobOrderId}</span>
        {tempLabel ? <span className="tm-card-temp"><Thermometer size={11} /> {tempLabel}</span> : null}
        {driverAppCompact ? <span className="tm-card-driver" title={driverAppStatus}>{driverAppCompact}</span> : null}
      </div>

      {/* Unmatched reason */}
      {row?.unmatchedReason ? <div className="tm-card-note" title={row.unmatchedReason}>{row.unmatchedReason}</div> : null}
      
      {/* Override indicator */}
      {isOverrideActive ? <div className="tm-card-override-dot" title="Override active" /> : null}
    </button>
  );
});
