import { TMS_INCIDENT_META, dedupeTripMonitorIncidentCodes, tmsIncidentIcon, tmsIncidentLabel } from './helpers.jsx';

export function TripMonitorIncidentIcons({ codes, className = '', size = 14 }) {
  const uniqueCodes = dedupeTripMonitorIncidentCodes(codes);

  if (!uniqueCodes.length) {
    return <span className={`trip-monitor-incident-empty${className ? ` ${className}` : ''}`}>No incidents</span>;
  }

  return (
    <div className={`trip-monitor-incident-icons${className ? ` ${className}` : ''}`}>
      {uniqueCodes.map((code) => {
        const normalizedCode = String(code || '').toLowerCase();
        const label = tmsIncidentLabel(code);

        return (
          <span
            key={code}
            className={`trip-monitor-incident-icon trip-monitor-incident-icon-${TMS_INCIDENT_META[normalizedCode]?.tone || 'default'}`}
            title={label}
            aria-label={label}
          >
            {tmsIncidentIcon(normalizedCode, size)}
          </span>
        );
      })}
    </div>
  );
}

