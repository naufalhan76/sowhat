import React, { useRef, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { tmsSeverityLabel, pickFirstText, normalizeTmsDriverAssign, extractTmsDriverName, normalizeTemperatureRange } from './helpers.jsx';
import { TripMonitorDetailModal } from './TripMonitorDetailModal.jsx';
import { TripMonitorDetailHeader } from './TripMonitorDetailHeader.jsx';

const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const MIN_WIDTH = 360;
const MIN_HEIGHT = 300;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSeverity(value) {
  const severity = String(value || '').toLowerCase();
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'warning';
  return 'normal';
}

function clampPosition(position, size) {
  const width = Number(size?.width) || MIN_WIDTH;
  const height = Number(size?.height) || MIN_HEIGHT;
  return {
    x: clamp(Number(position?.x) || 0, 0, Math.max(0, window.innerWidth - width)),
    y: clamp(Number(position?.y) || 0, 0, Math.max(0, window.innerHeight - height)),
  };
}

export function TripMonitorFloatingPanel({
  panel,
  webSessionUser,
  onClose,
  onOpenFleet,
  onOpenMap,
  onOpenHistorical,
  onOpenIncidents,
  onOpenOverrideLog,
  onBringToFront,
  onMove,
  onResize,
  renderTemperatureChart,
  renderUnitRouteMap,
  fmtDate,
  fmtNum,
  fmtCoord,
  formatMinutesText,
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!panel) return null;

  const position = panel.position || { x: 0, y: 0 };
  const size = panel.size || { width: 560, height: 680 };

  const applyPanelFrame = (nextPosition, nextSize = size) => {
    const el = panelRef.current;
    if (!el) return;
    el.style.left = `${nextPosition.x}px`;
    el.style.top = `${nextPosition.y}px`;
    el.style.width = `${nextSize.width}px`;
    el.style.height = `${nextSize.height}px`;
  };

  const handleDragStart = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    onBringToFront?.();

    const pointerOffset = {
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    };
    let lastPosition = clampPosition(position, size);

    const handleMove = (moveEvent) => {
      lastPosition = clampPosition({
        x: moveEvent.clientX - pointerOffset.x,
        y: moveEvent.clientY - pointerOffset.y,
      }, size);
      applyPanelFrame(lastPosition);
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      onMove?.(lastPosition);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const handleResizeStart = (event, direction) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onBringToFront?.();

    const start = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: position.x,
      y: position.y,
      width: Number(size.width) || MIN_WIDTH,
      height: Number(size.height) || MIN_HEIGHT,
    };
    let lastPosition = { x: start.x, y: start.y };
    let lastSize = { width: start.width, height: start.height };

    const handleMove = (moveEvent) => {
      const dx = moveEvent.clientX - start.pointerX;
      const dy = moveEvent.clientY - start.pointerY;
      let nextX = start.x;
      let nextY = start.y;
      let nextWidth = start.width;
      let nextHeight = start.height;

      if (direction.includes('e')) nextWidth = start.width + dx;
      if (direction.includes('s')) nextHeight = start.height + dy;
      if (direction.includes('w')) {
        nextWidth = start.width - dx;
        nextX = start.x + dx;
      }
      if (direction.includes('n')) {
        nextHeight = start.height - dy;
        nextY = start.y + dy;
      }

      if (nextWidth < MIN_WIDTH) {
        if (direction.includes('w')) nextX -= MIN_WIDTH - nextWidth;
        nextWidth = MIN_WIDTH;
      }
      if (nextHeight < MIN_HEIGHT) {
        if (direction.includes('n')) nextY -= MIN_HEIGHT - nextHeight;
        nextHeight = MIN_HEIGHT;
      }

      nextX = clamp(nextX, 0, Math.max(0, window.innerWidth - MIN_WIDTH));
      nextY = clamp(nextY, 0, Math.max(0, window.innerHeight - MIN_HEIGHT));
      nextWidth = Math.min(nextWidth, Math.max(MIN_WIDTH, window.innerWidth - nextX));
      nextHeight = Math.min(nextHeight, Math.max(MIN_HEIGHT, window.innerHeight - nextY));

      lastPosition = { x: nextX, y: nextY };
      lastSize = { width: nextWidth, height: nextHeight };
      applyPanelFrame(lastPosition, lastSize);
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      onResize?.(lastSize);
      onMove?.(lastPosition);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const detail = panel.detail;
  if (!detail && !panel.detailBusy && !panel.detailError) return null;

  const severityKey = normalizeSeverity(detail?.severity);
  const displayLabel = detail
    ? pickFirstText(detail.metadata?.fleetRow?.alias, detail.unitLabel, detail.metadata?.fleetRow?.label, detail.unitId)
    : 'Loading...';

  const headerDerived = useMemo(() => {
    if (!detail) return null;
    const jobOrders = Array.isArray(detail?.metadata?.jobOrders) ? detail.metadata.jobOrders : [];
    const headlineJob = detail?.metadata?.headlineJobOrder || jobOrders[0] || null;
    const headlineDrivers = normalizeTmsDriverAssign(headlineJob?.driverAssign);
    const jobDrivers = headlineDrivers.length ? headlineDrivers : jobOrders.flatMap((job) => normalizeTmsDriverAssign(job?.driverAssign));
    const shippingStatus = detail?.metadata?.shippingStatus || { label: detail?.shippingStatusLabel || '-', changedAt: null, steps: [] };
    return {
      headlineJob,
      shippingStatus,
      routeSummary: headlineJob ? `${headlineJob.originName || '-'} -> ${headlineJob.destinationName || '-'}` : '-',
      driver1Name: extractTmsDriverName(jobDrivers[0]),
      driver2Name: extractTmsDriverName(jobDrivers[1]),
    };
  }, [detail]);

  return (
    <div
      ref={panelRef}
      className={`tm-float-panel severity-${severityKey}`}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        zIndex: panel.zIndex,
      }}
      onPointerDown={onBringToFront}
      role="dialog"
      aria-label="Trip Monitor floating panel"
    >
      {RESIZE_DIRECTIONS.map((direction) => (
        <div
          key={direction}
          className={`tm-float-resize tm-float-resize-${direction}`}
          onPointerDown={(event) => handleResizeStart(event, direction)}
          aria-hidden="true"
        />
      ))}

      <div className="tm-float-header" onPointerDown={handleDragStart}>
        {detail && headerDerived ? (
          <TripMonitorDetailHeader
            detail={detail}
            headlineJob={headerDerived.headlineJob}
            shippingStatus={headerDerived.shippingStatus}
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
            displayUnitLabel={displayLabel || '-'}
            driver1Name={headerDerived.driver1Name}
            driver2Name={headerDerived.driver2Name}
            routeSummary={headerDerived.routeSummary}
            severityKey={severityKey}
            customerName={detail.customerName}
            tmsSeverityLabel={tmsSeverityLabel}
          />
        ) : (
          <>
            <div className="tm-float-title-block">
              <h3 className="tm-float-title">{displayLabel || '-'}</h3>
            </div>
            <button type="button" className="tm-float-close" onClick={(event) => { event.stopPropagation(); onClose?.(); }} aria-label="Close panel" title="Close (Esc)">
              <X size={16} />
            </button>
          </>
        )}
      </div>

      <div className="tm-float-body" style={{ overflowY: 'auto', overflowX: 'hidden' }}>
        {panel.detailBusy ? (
          <div className="empty-state">Loading detail...</div>
        ) : panel.detailError ? (
          <div className="empty-state" style={{ color: 'var(--danger)', padding: '24px', textAlign: 'center' }}>
            <p style={{ fontWeight: 600, marginBottom: '8px' }}>Gagal memuat detail</p>
            <p style={{ fontSize: '13px', opacity: 0.8 }}>{panel.detailError}</p>
          </div>
        ) : (
          <TripMonitorDetailModal
            detail={detail}
            busy={false}
            historyDetail={panel.historyDetail}
            historyBusy={panel.historyBusy}
            historyRange={panel.historyRange}
            webSessionUser={webSessionUser}
            onOpenFleet={onOpenFleet}
            onOpenMap={onOpenMap}
            onOpenHistorical={onOpenHistorical}
            onOpenIncidents={onOpenIncidents}
            onOpenOverrideLog={onOpenOverrideLog}
            renderTemperatureChart={renderTemperatureChart}
            renderUnitRouteMap={renderUnitRouteMap}
            fmtDate={fmtDate}
            fmtNum={fmtNum}
            fmtCoord={fmtCoord}
            formatMinutesText={formatMinutesText}
            onShippingStatusOverride={detail?.onShippingStatusOverride}
            onForceClose={detail?.onForceClose}
            mode="floating"
          />
        )}
      </div>
    </div>
  );
}

