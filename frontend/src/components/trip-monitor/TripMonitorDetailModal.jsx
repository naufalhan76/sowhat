import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ChevronDown, Clock3, Route, Truck, X, FileText, AlertTriangle, FileEdit } from 'lucide-react';
import { Surface, SurfaceHeader, SurfaceBody, Action, Pill } from '../index.js';
import {
  tmsSeverityLabel, tmsSeverityTone, tmsIncidentLabel,
  dedupeTripMonitorIncidentCodes, normalizeTemperatureRange,
  pickFirstText, normalizeTmsDriverAssign, extractTmsDriverName,
  formatTripMonitorStatusTime, formatTripMonitorRangeLabel,
  tripMonitorIncidentHistoryStatusLabel, tripMonitorIncidentHistoryStatusTone,
  buildTripMonitorIncidentHistoryDescription, buildTripMonitorIncidentHistoryLocationLabel,
} from './helpers.jsx';
import { TripMonitorShippingProgressClean } from './TripMonitorShippingProgress.jsx';
import { TripMonitorStopsEditor } from './TripMonitorStopsEditor.jsx';
import { TripMonitorDetailHeader } from './TripMonitorDetailHeader.jsx';
import TripMonitorDetailMapSection from './TripMonitorDetailMapSection.jsx';
import { TripMonitorIncidentComments } from './TripMonitorIncidentComments.jsx';

export function useIsVisible(options = {}) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { rootMargin: '100px', threshold: 0, ...options },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, visible];
}

function normalizeSeverity(value) {
  const severity = String(value || '').toLowerCase();
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'warning';
  return 'normal';
}

function formatAlertTime(value) {
  if (!value) return '--:--';
  try {
    return new Date(value).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(/\./g, ':');
  } catch {
    return '--:--';
  }
}

export function TripMonitorDetailModal({
  detail,
  busy,
  historyDetail,
  historyBusy,
  historyRange,
  webSessionUser,
  onClose,
  onOpenFleet,
  onOpenMap,
  onOpenHistorical,
  onOpenIncidents,
  onOpenOverrideLog,
  renderTemperatureChart,
  renderUnitRouteMap,
  mode = 'drawer',
  fmtDate = defaultFmtDate,
  fmtNum = defaultFmtNum,
  fmtCoord = defaultFmtCoord,
  formatMinutesText = defaultFormatMinutesText,
}) {
  const [hoveredStopKey, setHoveredStopKey] = useState(null);

  useEffect(() => {
    if (!detail || mode !== 'drawer') return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [detail, mode, onClose]);

  const derived = useMemo(() => {
    if (!detail) return null;

    const fleetRow = detail?.metadata?.fleetRow || null;
    const jobOrders = Array.isArray(detail?.metadata?.jobOrders) ? detail.metadata.jobOrders : [];
    const incidents = Array.isArray(detail?.metadata?.incidents) ? detail.metadata.incidents : [];
    const incidentHistory = Array.isArray(detail?.incidentHistory) ? detail.incidentHistory : [];
    const headlineJob = detail?.metadata?.headlineJobOrder || jobOrders[0] || null;
    const historyRows = [...(historyDetail?.records || [])].reverse();
    const historyLabel = formatTripMonitorRangeLabel(historyRange);
    const shippingStatus = detail?.metadata?.shippingStatus || {
      label: detail?.shippingStatusLabel || '-',
      changedAt: detail?.shippingStatusChangedAt || null,
      steps: [],
    };
    const shippingStatusHistory = Array.isArray(detail?.metadata?.shippingStatusHistory) ? detail.metadata.shippingStatusHistory : [];
    const headlineDrivers = normalizeTmsDriverAssign(headlineJob?.driverAssign);
    const jobDrivers = headlineDrivers.length ? headlineDrivers : jobOrders.flatMap((job) => normalizeTmsDriverAssign(job?.driverAssign));
    const normalizedJobTempRange = normalizeTemperatureRange(headlineJob?.tempMin, headlineJob?.tempMax);
    const incidentsByLevel = {
      critical: incidentHistory.filter((item) => String(item?.severity || '').toLowerCase() === 'critical'),
      warning: incidentHistory.filter((item) => String(item?.severity || '').toLowerCase() === 'warning'),
      normal: incidentHistory.filter((item) => {
        const severity = String(item?.severity || '').toLowerCase();
        return severity !== 'critical' && severity !== 'warning';
      }),
    };

    return {
      fleetRow,
      jobOrders,
      incidents,
      incidentHistory,
      headlineJob,
      routeSummary: headlineJob ? `${headlineJob.originName || '-'} -> ${headlineJob.destinationName || '-'}` : '-',
      historyRows,
      historyLabel,
      displayUnitLabel: pickFirstText(fleetRow?.alias, detail.unitLabel, fleetRow?.label, detail.unitId) || '-',
      normalizedJobTempRange,
      mapStops: headlineJob?.stops || [],
      severityKey: normalizeSeverity(detail?.severity),
      shippingStatus,
      shippingStatusHistory,
      incidentCodes: dedupeTripMonitorIncidentCodes(incidents.map((incident) => incident.code)),
      driver1Name: extractTmsDriverName(jobDrivers[0]),
      driver2Name: extractTmsDriverName(jobDrivers[1]),
      appStatus: detail?.driverAppStatus || [jobDrivers[0]?.assignment_status, jobDrivers[0]?.driver_status, jobDrivers[0]?.job_offer_status].filter(Boolean).join(' | ') || '-',
      incidentHistoryActiveCount: incidentHistory.filter((item) => String(item?.status || '').toLowerCase() !== 'resolved').length,
      incidentHistoryResolvedCount: incidentHistory.filter((item) => String(item?.status || '').toLowerCase() === 'resolved').length,
      incidentHistoryTotalMinutes: incidentHistory.reduce((total, item) => total + Number(item?.durationMinutes || 0), 0),
      incidentsByLevel,
    };
  }, [detail, historyDetail, historyRange]);

  if (!detail) return null;

  const {
    fleetRow,
    incidentHistory,
    headlineJob,
    routeSummary,
    historyRows,
    historyLabel,
    displayUnitLabel,
    normalizedJobTempRange,
    mapStops,
    severityKey,
    shippingStatus,
    shippingStatusHistory,
    driver1Name,
    driver2Name,
    appStatus,
    incidentHistoryActiveCount,
    incidentHistoryResolvedCount,
    incidentHistoryTotalMinutes,
    incidentsByLevel,
  } = derived;

  const totalIncidents = incidentHistory.length;
  const [chartSentinelRef, chartVisible] = useIsVisible();

  const temperatureContent = fleetRow?.id && renderTemperatureChart && chartVisible
    ? renderTemperatureChart({ records: historyDetail?.records || [], busy: historyBusy, title: 'Temperature trend', description: `Historical Solofleet mengikuti topbar range ${historyLabel}.`, compact: true, chartHeight: 240, thresholdMin: normalizedJobTempRange.min, thresholdMax: normalizedJobTempRange.max, thresholdLabel: 'TMS range' })
    : null;

  const body = (
    <div className="tm-detail-modal-body">
      {busy ? <div className="empty-state">Loading detail...</div> : (
        <div className="tm-stack">
          <TripMonitorDetailMapSection
            fleetRow={fleetRow}
            headlineJob={headlineJob}
            shippingStatus={shippingStatus}
            normalizedJobTempRange={normalizedJobTempRange}
            historyDetail={historyDetail}
            historyBusy={historyBusy}
            historyLabel={historyLabel}
            mapStops={mapStops}
            hoveredStopKey={hoveredStopKey}
            onHoverStop={setHoveredStopKey}
            onOpenMap={onOpenMap}
            onOpenHistorical={onOpenHistorical}
            onOpenFleet={onOpenFleet}
            renderUnitRouteMap={renderUnitRouteMap}
            fmtNum={fmtNum}
            formatTripMonitorStatusTime={formatTripMonitorStatusTime}
          />

          <details className="tm-stack-section tm-section-collapsible" ref={chartSentinelRef}>
            <summary className="tm-section-summary"><span className="tm-section-title">Temperature Trend</span><span className="tm-section-meta"><span className="tm-section-count tm-range-chip">{historyLabel}</span><ChevronDown size={14} className="tm-section-chevron" /></span></summary>
            <div className="tm-section-content">{fleetRow?.id ? (chartVisible ? (temperatureContent || <div className="empty-state">Temperature renderer belum tersedia.</div>) : <div className="empty-state">Loading chart...</div>) : <div className="empty-state">Unit ini belum match ke Solofleet.</div>}</div>
          </details>

          <details className="tm-stack-section tm-section-collapsible" open>
            <summary className="tm-section-summary">
              <span className="tm-section-title">Notification</span>
              <span className="tm-section-meta">{totalIncidents > 0 ? <span className="tm-section-count">{totalIncidents}</span> : null}<ChevronDown size={14} className="tm-section-chevron" /></span>
            </summary>
            <div className="tm-section-content">
              {totalIncidents === 0 ? <div className="tm-empty-soft">No incidents on this trip.</div> : ['critical', 'warning', 'normal'].map((level) => {
                const list = incidentsByLevel[level] || [];
                if (!list.length) return null;
                const labelMap = { critical: 'Critical', warning: 'Warning', normal: 'Resolved / Normal' };
                return (
                  <details key={level} className={`tm-incident-group severity-${level}`} open={level !== 'normal'}>
                    <summary className="tm-incident-group-summary">
                      <span className={`tm-severity-dot severity-${level}`} />
                      <span className="tm-incident-group-label">{labelMap[level]}</span>
                      <span className="tm-incident-group-count">({list.length})</span>
                      <ChevronDown size={12} className="tm-section-chevron" />
                    </summary>
                    <div className="tm-incident-group-body">
                      {list.slice(0, 6).map((item, index) => (
                        <div key={item.id || `${level}-${index}`} className={`tm-alert-row severity-${level}`}>
                          <span className="tm-alert-time">{formatAlertTime(item.openedAt)}</span>
                          <span className="tm-alert-content">
                            <strong className="tm-alert-label">{item.label || tmsIncidentLabel(item.incidentCode)}</strong>
                            <span className="tm-alert-meta">{tripMonitorIncidentHistoryStatusLabel(item.status)}{item.durationMinutes ? ` · ${formatMinutesText(item.durationMinutes)}` : ''}</span>
                          </span>
                        </div>
                      ))}
                      {list.length > 6 ? <div className="tm-section-more">+ {list.length - 6} more incidents</div> : null}
                    </div>
                  </details>
                );
              })}
            </div>
          </details>

          <details className="tm-stack-section tm-section-collapsible" open>
            <summary className="tm-section-summary"><span className="tm-section-title">Stops Timeline</span><span className="tm-section-meta">{mapStops.length ? <span className="tm-section-count">{mapStops.length}</span> : null}<ChevronDown size={14} className="tm-section-chevron" /></span></summary>
            <div className="tm-section-content">
              <TripMonitorStopsEditor 
                jobOrderId={headlineJob?.jobOrderId || detail.rowId}
                originalStops={mapStops}
                shippingStatus={shippingStatus} 
                headlineJob={headlineJob} 
                hoveredStopKey={hoveredStopKey} 
                onHoverStop={setHoveredStopKey} 
              />
            </div>
          </details>

          <details className="tm-stack-section tm-section-collapsible">
            <summary className="tm-section-summary">
              <span className="tm-section-title">Status Change History</span>
              <span className="tm-section-meta">{shippingStatusHistory.length > 0 ? <span className="tm-section-count">{shippingStatusHistory.length}</span> : null}<ChevronDown size={14} className="tm-section-chevron" /></span>
            </summary>
            <div className="tm-section-content">
              {shippingStatusHistory.length === 0 ? <div className="tm-empty-soft">No status changes recorded.</div> : (
                <div className="tm-incident-group-body">
                  {shippingStatusHistory.map((item, index) => (
                    <div key={index} className="tm-alert-row severity-normal">
                      <span className="tm-alert-time">{formatAlertTime(item.timestamp)}</span>
                      <span className="tm-alert-content">
                        <strong className="tm-alert-label">{item.oldStatus?.label || 'UNKNOWN'} &rarr; {item.newStatus?.label || 'UNKNOWN'}</strong>
                        <span className="tm-alert-meta">
                          {item.source === 'override' ? <span className="tm-range-chip severity-warning">Manual Override</span> : <span className="tm-range-chip">Auto-detected</span>}
                          {item.reason ? ` · ${item.reason}` : ''}
                          {item.changedBy ? ` · by ${item.changedBy}` : ''}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>

          <div className="tm-stack-section tm-action-row tm-deep-dive-actions">
            <button type="button" className="tm-action-btn" disabled={!fleetRow?.id} onClick={() => onOpenHistorical?.({ rowId: detail.id, ...fleetRow })}>
              <FileText size={16} />
              <span>Historical Records</span>
            </button>
            <button type="button" className="tm-action-btn" onClick={() => onOpenIncidents?.({ rowId: detail.id, ...fleetRow })}>
              <AlertTriangle size={16} />
              <span>Incident History</span>
            </button>
            <button type="button" className="tm-action-btn" onClick={() => onOpenOverrideLog?.({ rowId: detail.id, ...fleetRow })}>
              <FileEdit size={16} />
              <span>Override Audit Log</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (mode === 'floating') return body;

  return (
    <div className="tm-drawer-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Trip detail drawer">
      <div className={`tm-drawer-panel trip-monitor-detail-modal tm-drawer-cardstack severity-${severityKey}`} onClick={(event) => event.stopPropagation()}>
        <TripMonitorDetailHeader
          detail={detail}
          headlineJob={headlineJob}
          shippingStatus={shippingStatus}
          eta={detail.eta}
          overrideActive={detail.overrideActive}
          isStale={detail.isStale}
          refreshing={detail.refreshing}
          onClose={onClose}
          onRefresh={detail.onRefresh}
          onForceClose={detail.onForceClose}
          onOverrideBadge={detail.onOverrideBadge}
          onWaDriver={detail.onWaDriver}
          onShippingStatusOverride={detail.onShippingStatusOverride}
          displayUnitLabel={displayUnitLabel}
          driver1Name={driver1Name}
          driver2Name={driver2Name}
          routeSummary={routeSummary}
          severityKey={severityKey}
          customerName={detail.customerName}
          tmsSeverityLabel={tmsSeverityLabel}
        />
        {body}
      </div>
    </div>
  );
}

