import React, { useState } from 'react';
import { Route, Clock3, Truck, Pencil, Check, X, RotateCcw } from 'lucide-react';
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
  onRefetchDetail // Optional callback to refresh data after save
}) {
  const [mapSentinelRef, mapVisible] = useIsVisible();

  // T1C.1: Temp Range Inline Edit State
  const [editMode, setEditMode] = useState(false);
  const [overridden, setOverridden] = useState(false);
  // Default to normalized range if headlineJob provides it, else null
  const defaultMin = headlineJob ? normalizedJobTempRange?.min : '';
  const defaultMax = headlineJob ? normalizedJobTempRange?.max : '';
  const [minValue, setMinValue] = useState(defaultMin);
  const [maxValue, setMaxValue] = useState(defaultMax);
  const [originalTmsValue, setOriginalTmsValue] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // Sync state when headlineJob changes and not in edit mode
  React.useEffect(() => {
    if (!editMode && headlineJob) {
      setMinValue(normalizedJobTempRange?.min ?? '');
      setMaxValue(normalizedJobTempRange?.max ?? '');
      // Check if it's already overridden (you might need a flag from backend, assuming it's not present yet, we'll just handle local overrides for now, or check if an override object exists on headlineJob if that's how the backend returns it. For now, rely on local state or assume not overridden initially unless specified).
    }
  }, [headlineJob, normalizedJobTempRange, editMode]);

  const handleSaveTempRange = async () => {
    if (!headlineJob?.jobOrderId) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/tms/overrides/${headlineJob.jobOrderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempRange: { tempMin: Number(minValue), tempMax: Number(maxValue) } })
      });
      if (!response.ok) throw new Error('Failed to save override');
      
      setOriginalTmsValue({ min: normalizedJobTempRange?.min, max: normalizedJobTempRange?.max });
      setOverridden(true);
      setEditMode(false);
      onRefetchDetail?.();
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save temp range override');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetTempRange = async () => {
    if (!headlineJob?.jobOrderId) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/tms/overrides/${headlineJob.jobOrderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempRange: null })
      });
      if (!response.ok) throw new Error('Failed to reset override');
      
      setOverridden(false);
      setEditMode(false);
      setMinValue(originalTmsValue?.min ?? '');
      setMaxValue(originalTmsValue?.max ?? '');
      setOriginalTmsValue(null);
      onRefetchDetail?.();
    } catch (error) {
      console.error('Reset failed:', error);
      alert('Failed to reset temp range override');
    } finally {
      setIsSaving(false);
    }
  };

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
              <button type="button" className="tm-action-btn" onClick={() => onOpenHistorical?.({ rowId: headlineJob?.id, ...fleetRow })} disabled={!fleetRow?.id}>
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
            transition: background 0.2s ease, border 0.2s ease;
          }
          .tm-schedule-cell.is-editing {
            background: var(--edit-mode-bg, rgba(6, 182, 212, 0.04));
            box-shadow: inset 0 0 0 1px var(--edit-mode-border, rgba(6, 182, 212, 0.32));
          }
          .tm-schedule-label {
            font-size: 11px;
            font-weight: 400;
            font-family: Inter, sans-serif;
            letter-spacing: 0.01em;
            color: var(--text-muted);
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .tm-schedule-value {
            font-size: 13px;
            font-weight: 600;
            font-family: "JetBrains Mono", monospace;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 6px;
            min-height: 20px;
          }
          .tm-temp-edit-icon {
            opacity: 0;
            transition: opacity 0.2s;
            color: var(--text-muted);
            cursor: pointer;
            padding: 2px;
            border-radius: 4px;
          }
          .tm-temp-edit-icon:hover {
            color: var(--text);
            background: var(--surface-hover);
          }
          .tm-schedule-cell:hover .tm-temp-edit-icon {
            opacity: 1;
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
          /* Inline Edit Specific Styles */
          .tm-inline-edit-actions {
            display: flex;
            gap: 4px;
            margin-left: auto;
          }
          .tm-inline-action-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: none;
            padding: 4px;
            border-radius: 4px;
            cursor: pointer;
            color: var(--text-muted);
            transition: background 0.2s, color 0.2s;
          }
          .tm-inline-action-btn:hover {
            background: var(--surface-hover, rgba(255,255,255,0.1));
            color: var(--text);
          }
          .tm-inline-action-btn.save-btn:hover {
            color: var(--success, #10B981);
          }
          .tm-inline-action-btn.cancel-btn:hover {
            color: var(--danger, #EF4444);
          }
          .tm-temp-input {
            width: 48px;
            height: 24px;
            background: var(--edit-field-bg, rgba(255, 255, 255, 0.04));
            border: 1px solid var(--edit-field-border, rgba(255, 255, 255, 0.12));
            border-radius: 4px;
            color: var(--text);
            font-family: "JetBrains Mono", monospace;
            font-size: 12px;
            text-align: center;
            outline: none;
            padding: 0 4px;
          }
          .tm-temp-input:focus {
            border-color: var(--edit-field-focus, #06B6D4);
          }
          .tm-temp-input::-webkit-inner-spin-button,
          .tm-temp-input::-webkit-outer-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }
          .tm-overridden-badge {
            background: var(--override-surface, rgba(6, 182, 212, 0.06));
            color: var(--override-text, #22D3EE);
            font-size: 11px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 4px;
            border: 1px solid var(--override-border, rgba(6, 182, 212, 0.24));
            display: inline-flex;
            align-items: center;
            height: 18px;
            line-height: 1;
            margin-left: 4px;
          }
          .tm-original-tms-value {
            font-size: 11px;
            color: var(--text-muted);
            text-decoration: line-through;
            font-weight: 400;
            margin-left: 4px;
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
          <div className={`tm-schedule-cell ${editMode ? 'is-editing' : ''}`} title={editMode ? '' : "Edit Temp Range"}>
            <span className="tm-schedule-label">
              <span>Temp Range</span>
              {editMode && (
                <div className="tm-inline-edit-actions">
                  <button type="button" className="tm-inline-action-btn save-btn" onClick={handleSaveTempRange} disabled={isSaving} title="Save">
                    <Check size={14} />
                  </button>
                  <button type="button" className="tm-inline-action-btn cancel-btn" onClick={() => { setEditMode(false); setMinValue(defaultMin); setMaxValue(defaultMax); }} disabled={isSaving} title="Cancel">
                    <X size={14} />
                  </button>
                </div>
              )}
              {overridden && !editMode && (
                <button type="button" className="tm-inline-action-btn" onClick={handleResetTempRange} disabled={isSaving} title="Reset Override" style={{ marginLeft: 'auto', padding: '2px' }}>
                  <RotateCcw size={12} />
                </button>
              )}
            </span>
            <div className="tm-schedule-value" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
              {editMode ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input type="number" className="tm-temp-input" value={minValue} onChange={e => setMinValue(e.target.value)} disabled={isSaving} step="1" />
                  <span style={{ color: 'var(--text-muted)' }}>-</span>
                  <input type="number" className="tm-temp-input" value={maxValue} onChange={e => setMaxValue(e.target.value)} disabled={isSaving} step="1" />
                </div>
              ) : (
                <>
                  {headlineJob ? (
                    overridden ? (
                      <>
                        <span style={{ fontWeight: '700', fontSize: '13px' }}>{fmtNum(minValue)}° / {fmtNum(maxValue)}°</span>
                        {originalTmsValue && <span className="tm-original-tms-value">({fmtNum(originalTmsValue.min)}°/{fmtNum(originalTmsValue.max)}°)</span>}
                        <span className="tm-overridden-badge">Overridden</span>
                      </>
                    ) : (
                      <span>{fmtNum(normalizedJobTempRange?.min)}° / {fmtNum(normalizedJobTempRange?.max)}°</span>
                    )
                  ) : '-'}
                  
                  {headlineJob && !editMode && (
                    <Pencil size={14} className="tm-temp-edit-icon" onClick={() => setEditMode(true)} style={{ cursor: 'pointer' }} />
                  )}
                </>
              )}
            </div>
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
