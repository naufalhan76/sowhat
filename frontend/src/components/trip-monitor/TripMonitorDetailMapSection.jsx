import React from 'react';
import { Route, Clock3, Truck, Pencil } from 'lucide-react';
import { useIsVisible } from './TripMonitorDetailModal';

/**
 * TripMonitorDetailMapSection
 * Displays map frame, tracking actions, and 4-column schedule grid.
 * Temp Range edit functionality is deferred to Phase 1C.
 */
export default function TripMonitorDetailMapSection({
  fleetRow,
  headlineJob,
  shippingStatus,
  normalizedJobTempRange,
  historyDetail,
  historyBusy,
  historyLabel,
  mapStops = [],
  hoveredStopKey,
  onHoverStop,
  onOpenMap,
  onOpenHistorical,
  onOpenFleet,
  renderUnitRouteMap,
  fmtNum,
  formatTripMonitorStatusTime,
}) {
  const [mapSentinelRef, mapVisible] = useIsVisible();

  const mapContent = fleetRow?.id && renderUnitRouteMap && mapVisible
    ? renderUnitRouteMap({
        row: fleetRow,
        records: historyDetail?.records || [],
        busy: historyBusy,
        rangeLabel: historyLabel,
        stops: mapStops,
        hoveredStopKey,
        onHoverStop,
      })
    : null;

  return (
    <div className="tm-stack-section tm-map-section" ref={mapSentinelRef}>
      {/* Map Frame */}
      <div className="tm-map-frame" style={{ height: '200px' }}>
        {fleetRow?.id ? (
          mapVisible ? (
            mapContent || <div className="empty-state">Map renderer belum tersedia.</div>
          ) : (
            <div className="empty-state">Loading map...</div>
          )
        ) : (
          <div className="empty-state">Unit ini belum match ke Solofleet, jadi map belum bisa ditampilkan.</div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="tm-action-row" style={{ display: 'flex', gap: '8px', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <button type="button" className="tm-action-btn" onClick={() => onOpenMap?.(fleetRow)} disabled={!fleetRow?.id}>
          <Route size={14} /> Track Route
        </button>
        <button type="button" className="tm-action-btn" onClick={() => onOpenHistorical?.(fleetRow)} disabled={!fleetRow?.id}>
          <Clock3 size={14} /> Trip History
        </button>
        <button type="button" className="tm-action-btn" onClick={() => onOpenFleet?.(fleetRow)} disabled={!fleetRow?.id}>
          <Truck size={14} /> Open Fleet
        </button>
      </div>

      {/* Schedule Grid */}
      <div style={{ padding: '12px 16px' }}>
        <style>{`
          .tm-schedule-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1px;
            background: var(--border);
            border-radius: 6px;
            overflow: hidden;
          }
          .tm-schedule-cell {
            background: var(--surface);
            padding: 8px 10px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            position: relative;
          }
          .tm-schedule-label {
            font-size: 11px;
            font-weight: 400;
            font-family: Inter, sans-serif;
            letter-spacing: 0.01em;
            color: var(--text-muted);
          }
          .tm-schedule-value {
            font-size: 13px;
            font-weight: 600;
            font-family: "JetBrains Mono", monospace;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .tm-temp-edit-icon {
            opacity: 0;
            transition: opacity 0.2s;
            color: var(--text-muted);
          }
          @media (hover: hover) {
            .tm-schedule-cell:hover .tm-temp-edit-icon {
              opacity: 1;
            }
          }
          @media (hover: none) {
            .tm-temp-edit-icon {
              opacity: 1;
            }
          }
          @media (max-width: 480px) {
            .tm-schedule-grid {
              grid-template-columns: repeat(2, 1fr);
            }
          }
        `}</style>
        <div className="tm-schedule-grid">
          <div className="tm-schedule-cell">
            <span className="tm-schedule-label">ETA Load</span>
            <strong className="tm-schedule-value">{formatTripMonitorStatusTime(shippingStatus?.loadEta)}</strong>
          </div>
          <div className="tm-schedule-cell">
            <span className="tm-schedule-label">ETD Unload</span>
            <strong className="tm-schedule-value">{formatTripMonitorStatusTime(shippingStatus?.unloadEtd)}</strong>
          </div>
          <div className="tm-schedule-cell" style={{ cursor: 'pointer' }} title="Edit Temp Range (Phase 1C)">
            <span className="tm-schedule-label">Temp Range</span>
            <strong className="tm-schedule-value">
              {headlineJob ? `${fmtNum(normalizedJobTempRange?.min)}° / ${fmtNum(normalizedJobTempRange?.max)}°` : '-'}
              <Pencil size={14} className="tm-temp-edit-icon" />
            </strong>
          </div>
          <div className="tm-schedule-cell">
            <span className="tm-schedule-label">Last update</span>
            <strong className="tm-schedule-value">{formatTripMonitorStatusTime(shippingStatus?.changedAt)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
