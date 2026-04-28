import { AlertCircle, Thermometer } from 'lucide-react';

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

export function TripMonitorUnitCard({ row, onOpen, isActive = false }) {
  const unitLabel = row?.unitLabel || row?.unitId || row?.normalizedPlate || '-';
  const shippingStatus = row?.shippingStatusLabel || row?.metadata?.shippingStatus?.label || '-';
  const activeStopName = row?.metadata?.shippingStatus?.activeStopName || '';
  const sublineText = `${row?.jobOrderId || '-'} | ${row?.customerName || '-'}`;
  const tempRange = normalizeTemperatureRange(row?.tempMin, row?.tempMax);
  const tempLabel = tempRange.min !== null ? `${fmtNum(tempRange.min)}°C s/d ${fmtNum(tempRange.max)}°C` : null;
  const incidentSummary = row?.incidentSummary && row.incidentSummary !== '-' ? row.incidentSummary : '';
  const driverAppStatus = row?.driverAppStatus && row.driverAppStatus !== '-' ? row.driverAppStatus : '';
  const driverAppCompact = compactDriverStatus(driverAppStatus);
  const cardClasses = ['trip-monitor-card', `trip-monitor-card-${row?.severity || 'normal'}`];

  if (isActive) cardClasses.push('is-active');

  return (
    <button type="button" className={cardClasses.join(' ')} onClick={onOpen} title={`${unitLabel} — ${sublineText}`}>
      <div className="trip-monitor-card-head">
        <div className="trip-monitor-card-titleblock">
          <strong title={unitLabel}>{unitLabel}</strong>
          <div className="trip-monitor-card-subline" title={sublineText}>{sublineText}</div>
        </div>
        <TripMonitorIncidentIcons codes={row?.incidentCodes || []} />
      </div>

      <div className="trip-monitor-card-status">
        <strong title={shippingStatus}>{shippingStatus}</strong>
        {activeStopName ? <div className="trip-monitor-card-location" title={activeStopName}>{activeStopName}</div> : null}
      </div>

      {incidentSummary ? (
        <div className="trip-monitor-card-incident-summary" title={incidentSummary}>
          <AlertCircle size={12} /> {incidentSummary}
        </div>
      ) : null}

      <div className="trip-monitor-card-meta">
        {tempLabel ? <span className="trip-monitor-card-temp"><Thermometer size={12} /> {tempLabel}</span> : null}
        {driverAppCompact ? <span className="trip-monitor-card-driver-pill" title={driverAppStatus}>{driverAppCompact}</span> : null}
      </div>

      {row?.unmatchedReason ? <div className="trip-monitor-card-note" title={row.unmatchedReason}>{row.unmatchedReason}</div> : null}
    </button>
  );
}

