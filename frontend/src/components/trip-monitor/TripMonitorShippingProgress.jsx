import React, { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import {
  SHIPPING_STEP_ICONS,
  tmsShippingStatusLabel,
  formatTripMonitorStatusTime,
  tripMonitorStopKey,
} from './helpers.jsx';

const DEFAULT_SHIPPING_STEPS = [
  { key: 'otw-load', label: 'OTW LOAD', changedAt: null, locationName: '', active: true, completed: false },
  { key: 'sampai-load', label: 'SAMPAI LOAD', changedAt: null, locationName: '', active: false, completed: false },
  { key: 'menuju-unload', label: 'MENUJU UNLOAD', changedAt: null, locationName: '', active: false, completed: false },
  { key: 'sampai-unload', label: 'SAMPAI UNLOAD', changedAt: null, locationName: '', active: false, completed: false },
  { key: 'selesai', label: 'SELESAI', changedAt: null, locationName: '', active: false, completed: false },
];

function getShippingSteps(shippingStatus) {
  return Array.isArray(shippingStatus?.steps) && shippingStatus.steps.length
    ? shippingStatus.steps
    : DEFAULT_SHIPPING_STEPS;
}

function getStepLabel(step) {
  return step?.label || tmsShippingStatusLabel(step?.key);
}

function getStepStops(step, headlineJob) {
  const stepKey = String(step?.key || '').toLowerCase();
  const directStops = Array.isArray(step?.stops) ? step.stops : [];

  if (directStops.length) return directStops;

  if (stepKey.includes('load')) {
    return Array.isArray(headlineJob?.loadStops) ? headlineJob.loadStops : [];
  }

  if (stepKey.includes('unload')) {
    return Array.isArray(headlineJob?.unloadStops) ? headlineJob.unloadStops : [];
  }

  return [];
}

function getStopLabel(stop, fallbackIndex) {
  return String(
    stop?.locationName
      || stop?.location_name
      || stop?.name
      || stop?.label
      || stop?.address
      || `Stop ${fallbackIndex + 1}`,
  ).trim();
}

function getStopMeta(stop) {
  return String(stop?.changedAt || stop?.changed_at || stop?.time || stop?.eta || '').trim();
}

function getProgressPercent(steps) {
  if (steps.length <= 1) return steps[0]?.completed ? 100 : 0;

  const activeIndex = steps.findIndex((step) => step?.active);
  const lastCompletedIndex = steps.reduce((last, step, index) => (step?.completed ? index : last), -1);
  const currentIndex = Math.max(activeIndex, lastCompletedIndex, 0);

  if (steps.every((step) => step?.completed)) return 100;
  return Math.round((currentIndex / (steps.length - 1)) * 100);
}

export function TripMonitorShippingProgress({ shippingStatus }) {
  const steps = getShippingSteps(shippingStatus);

  return (
    <div className="trip-monitor-progress">
      {steps.map((step, index) => (
        <React.Fragment key={step?.key || `${getStepLabel(step)}-${index}`}>
          {index > 0 && <div className="trip-monitor-progress-connector" aria-hidden="true" />}
          <div className="trip-monitor-progress-step">
            <span className="trip-monitor-progress-marker" aria-hidden="true">
              {step?.completed ? '✓' : ''}
            </span>
            <div className="trip-monitor-progress-copy">
              <strong>{getStepLabel(step)}</strong>
              <span>{formatTripMonitorStatusTime(step?.changedAt)}</span>
              {step?.locationName ? <small>{step.locationName}</small> : null}
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

export function TripMonitorShippingProgressClean({
  shippingStatus,
  headlineJob,
  hoveredStopKey = null,
  onHoverStop = null,
}) {
  const [expandedStopKey, setExpandedStopKey] = useState(null);
  const steps = getShippingSteps(shippingStatus);
  const progressPercent = getProgressPercent(steps);

  return (
    <div className="trip-monitor-progress-shell">
      <div className="trip-monitor-progress-track" aria-hidden="true">
        <div className="trip-monitor-progress-track-fill" style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="trip-monitor-progress">
        {steps.map((step, index) => {
          const stepKey = step?.key || `step-${index}`;
          const Icon = SHIPPING_STEP_ICONS[String(stepKey).toLowerCase()];
          const stops = getStepStops(step, headlineJob);
          const hasStops = stops.length > 0;
          const isExpanded = expandedStopKey === stepKey;

          return (
            <React.Fragment key={stepKey}>
              {index > 0 && <div className="trip-monitor-progress-connector" aria-hidden="true" />}
              <div className={`trip-monitor-progress-step ${step?.completed ? 'is-completed' : (step?.active ? 'is-active' : 'is-pending')}`}>
                <span className="trip-monitor-progress-marker" aria-hidden="true">
                  {Icon ? <Icon size={14} /> : (step?.completed ? '✓' : '')}
                </span>

                <div className="trip-monitor-progress-copy">
                  <strong>{getStepLabel(step)}</strong>
                  <span>{formatTripMonitorStatusTime(step?.changedAt)}</span>
                  {step?.locationName ? <small>{step.locationName}</small> : null}

                  {hasStops ? (
                    <div className="trip-monitor-progress-stops">
                      <button
                        type="button"
                        className="trip-monitor-progress-stops-toggle"
                        onClick={() => setExpandedStopKey(isExpanded ? null : stepKey)}
                        aria-expanded={isExpanded}
                      >
                        <span>{stops.length} stop{stops.length === 1 ? '' : 's'}</span>
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>

                      {isExpanded ? (
                        <div className="trip-monitor-progress-stops-list">
                          {stops.map((stop, stopIndex) => {
                            const stopKey = tripMonitorStopKey(stop, stopIndex);
                            const isHovered = hoveredStopKey && hoveredStopKey === stopKey;

                            return (
                              <button
                                key={stopKey || `${stepKey}-stop-${stopIndex}`}
                                type="button"
                                className={`trip-monitor-progress-stop${isHovered ? ' is-hovered' : ''}`}
                                onMouseEnter={() => onHoverStop?.(stopKey, stop)}
                                onMouseLeave={() => onHoverStop?.(null, null)}
                              >
                                <span>{getStopLabel(stop, stopIndex)}</span>
                                {getStopMeta(stop) ? <small>{getStopMeta(stop)}</small> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

