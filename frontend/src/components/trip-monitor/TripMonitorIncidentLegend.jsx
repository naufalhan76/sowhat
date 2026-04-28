import { TMS_INCIDENT_META, dedupeTripMonitorIncidentCodes, tmsIncidentIcon, tmsIncidentLabel } from './helpers.jsx';

export function TripMonitorIncidentLegend({ codes, className = '' }) {
  const uniqueCodes = dedupeTripMonitorIncidentCodes(codes);

  if (!uniqueCodes.length) return null;

  return (
    <div className={`trip-monitor-incident-legend${className ? ` ${className}` : ''}`}>
      {uniqueCodes.map((code) => {
        const normalizedCode = String(code || '').toLowerCase();

        return (
          <div key={`legend-${code}`} className="trip-monitor-incident-legend-item">
            <span
              className={`trip-monitor-incident-icon trip-monitor-incident-icon-${TMS_INCIDENT_META[normalizedCode]?.tone || 'default'}`}
              aria-hidden="true"
            >
              {tmsIncidentIcon(normalizedCode, 13)}
            </span>
            <span>{tmsIncidentLabel(code)}</span>
          </div>
        );
      })}
    </div>
  );
}

