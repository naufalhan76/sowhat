import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, ChevronDown, ChevronUp, MapPin, X, Layers, Maximize2, RefreshCw } from 'lucide-react';

/* ── Leaflet lazy loader ── */
let leafletModulePromise = null;
function loadLeafletModule() {
  if (!leafletModulePromise) {
    leafletModulePromise = import('leaflet').then((m) => m.default || m);
  }
  return leafletModulePromise;
}

function useLeafletModule() {
  const [state, setState] = useState({ leaflet: null, error: false });
  const retry = useCallback(() => {
    leafletModulePromise = null;
    setState({ leaflet: null, error: false });
    loadLeafletModule()
      .then((mod) => setState({ leaflet: mod, error: false }))
      .catch(() => setState({ leaflet: null, error: true }));
  }, []);
  useEffect(() => {
    let cancelled = false;
    loadLeafletModule()
      .then((mod) => { if (!cancelled) setState({ leaflet: mod, error: false }); })
      .catch(() => { if (!cancelled) setState({ leaflet: null, error: true }); });
    return () => { cancelled = true; };
  }, []);
  return { ...state, retry };
}

/**
 * MapPanel — Fixed split layout: sidebar left, full-bleed map right.
 * Sidebar controls filter the map and allow click-to-zoom interaction.
 */

const LEGEND_ITEMS = [
  { key: 'temp-both', label: '2 temp error', color: '#ef4444' },
  { key: 'temp-single', label: '1 temp error', color: '#f97316' },
  { key: 'gps-late', label: 'GPS late', color: '#eab308' },
  { key: 'moving', label: 'Moving', color: '#22c55e' },
  { key: 'stop', label: 'Stop', color: '#94a3b8' },
];

const REGION_PAGE_SIZE = 6;

/* ── Region card ── */
function RegionCard({ region, rows, getMapStatusMeta, expanded, onToggle, onZoomRegion, onPanToUnit }) {
  const visibleRows = expanded ? rows : rows.slice(0, REGION_PAGE_SIZE);
  const hasMore = rows.length > REGION_PAGE_SIZE;

  return (
    <div className="mp-region-card">
      <button type="button" className="mp-region-header" onClick={() => onZoomRegion(rows)} title={`Zoom ke ${region}`}>
        <span className="mp-region-name">{region}</span>
        <span className="mp-region-count">{rows.length}</span>
      </button>
      <div className="mp-region-units">
        {visibleRows.map((row) => {
          const meta = getMapStatusMeta(row);
          return (
            <button
              type="button"
              key={row.rowKey || `${row.accountId || 'primary'}::${row.id}`}
              className="mp-region-unit"
              onClick={() => onPanToUnit(row)}
              title={`Pan ke ${row.label || row.id}`}
            >
              <span className="mp-region-dot" style={{ backgroundColor: meta.color }} />
              <div className="mp-region-unit-info">
                <strong>{row.label || row.id}</strong>
                <span>{meta.label}</span>
              </div>
            </button>
          );
        })}
      </div>
      {hasMore && !expanded ? (
        <button type="button" className="mp-region-more" onClick={onToggle}>
          +{rows.length - REGION_PAGE_SIZE} lainnya <ChevronDown size={12} />
        </button>
      ) : null}
      {hasMore && expanded ? (
        <button type="button" className="mp-region-more" onClick={onToggle}>
          Lebih sedikit <ChevronUp size={12} />
        </button>
      ) : null}
    </div>
  );
}

/* ── Legend (inline in sidebar footer) ── */
function MapLegend({ plottedCount, totalCount }) {
  return (
    <div className="mp-legend">
      <div className="mp-legend-stats">
        <span className="mp-legend-stat">{plottedCount} <small>di map</small></span>
        <span className="mp-legend-divider" />
        <span className="mp-legend-stat">{totalCount} <small>total</small></span>
      </div>
      <div className="mp-legend-items">
        {LEGEND_ITEMS.map((item) => (
          <span key={item.key} className="mp-legend-item">
            <span className="mp-legend-dot" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Map canvas (Leaflet) ── */
const FleetMapCanvas = React.memo(function FleetMapCanvas({
  rows,
  getMapStatusMeta,
  resolveFleetRegion,
  buildTruckDivIcon,
  fmtNum,
  mapActionsRef,
}) {
  const { leaflet, error, retry } = useLeafletModule();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const markerMapRef = useRef(new Map());
  const lastFitKeyRef = useRef('');

  const plottedRows = useMemo(
    () => (rows || []).filter((row) => Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))),
    [rows],
  );

  const plottedRowsFitKey = useMemo(
    () => plottedRows.map((row) => `${row.accountId || 'primary'}:${row.id}`).sort().join('|'),
    [plottedRows],
  );

  /* Init map */
  useEffect(() => {
    if (!leaflet || !containerRef.current || mapRef.current) return undefined;
    const map = leaflet.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });
    leaflet.control.zoom({ position: 'topright' }).addTo(map);
    leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    const layer = leaflet.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;
    const sizeTimer = window.setTimeout(() => map.invalidateSize(), 80);
    return () => {
      clearTimeout(sizeTimer);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [leaflet]);

  /* Update markers */
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!leaflet || !map || !layer) return;
    layer.clearLayers();
    markerMapRef.current.clear();
    if (!plottedRows.length) {
      if (lastFitKeyRef.current !== '__empty__') {
        map.setView([-2.5, 118], 5);
        lastFitKeyRef.current = '__empty__';
      }
      return;
    }
    const bounds = [];
    plottedRows.forEach((row) => {
      const latitude = Number(row.latitude);
      const longitude = Number(row.longitude);
      const statusMeta = getMapStatusMeta(row);
      const region = resolveFleetRegion(row);
      const marker = leaflet.marker([latitude, longitude], {
        icon: buildTruckDivIcon(leaflet, statusMeta.color, 28),
      });
      marker.bindTooltip(row.label || row.id, {
        permanent: true, direction: 'top', offset: [0, -14], className: 'fleet-map-label',
      });
      marker.bindPopup(
        `<div class="fleet-map-popup"><strong>${row.label || row.id}</strong><div>${row.id}</div><div>${row.accountLabel || row.accountId || '-'}</div><div>${statusMeta.label}</div><div>${row.locationSummary || '-'}</div><div>${region}</div><div>Temp 1 ${fmtNum(row.liveTemp1, 1)} C</div><div>Temp 2 ${fmtNum(row.liveTemp2, 1)} C</div><div>Speed ${fmtNum(row.speed, 0)} km/h</div></div>`,
      );
      marker.addTo(layer);
      bounds.push([latitude, longitude]);
      const rowKey = `${row.accountId || 'primary'}::${row.id}`;
      markerMapRef.current.set(rowKey, marker);
    });
    if (lastFitKeyRef.current !== plottedRowsFitKey) {
      if (bounds.length === 1) map.setView(bounds[0], 11);
      else map.fitBounds(bounds, { padding: [28, 28], maxZoom: 11 });
      lastFitKeyRef.current = plottedRowsFitKey;
    }
    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 50);
    return () => clearTimeout(resizeTimer);
  }, [leaflet, plottedRows, plottedRowsFitKey, getMapStatusMeta, resolveFleetRegion, buildTruckDivIcon, fmtNum]);

  /* Expose map actions to parent */
  useEffect(() => {
    if (!mapActionsRef) return;
    mapActionsRef.current = {
      fitAll() {
        const map = mapRef.current;
        if (!map || !plottedRows.length) return;
        const bounds = plottedRows.map((r) => [Number(r.latitude), Number(r.longitude)]);
        if (bounds.length === 1) map.setView(bounds[0], 11);
        else map.fitBounds(bounds, { padding: [28, 28], maxZoom: 11 });
      },
      zoomToRows(targetRows) {
        const map = mapRef.current;
        if (!map) return;
        const coords = targetRows
          .filter((r) => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)))
          .map((r) => [Number(r.latitude), Number(r.longitude)]);
        if (!coords.length) return;
        if (coords.length === 1) map.setView(coords[0], 13);
        else map.fitBounds(coords, { padding: [28, 28], maxZoom: 14 });
      },
      panToUnit(row) {
        const map = mapRef.current;
        if (!map) return;
        const lat = Number(row.latitude);
        const lng = Number(row.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        map.setView([lat, lng], 15);
        const key = `${row.accountId || 'primary'}::${row.id}`;
        const marker = markerMapRef.current.get(key);
        if (marker) marker.openPopup();
      },
    };
  }, [plottedRows, mapActionsRef]);

  /* Resize observer */
  useEffect(() => {
    const map = mapRef.current;
    const node = containerRef.current;
    if (!map || !node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(() => map.invalidateSize());
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [leaflet]);

  if (error) {
    return (
      <div className="mp-map-overlay">
        <MapPin size={20} />
        <span>Gagal memuat map</span>
        <button type="button" className="mp-retry-btn" onClick={retry}>
          <RefreshCw size={13} /> Coba lagi
        </button>
      </div>
    );
  }

  return (
    <div className="mp-map-canvas-wrap">
      <div ref={containerRef} className="mp-map-canvas" />
      {!leaflet ? <div className="mp-map-overlay">Memuat map...</div> : null}
      {leaflet && !plottedRows.length ? (
        <div className="mp-map-overlay">
          <MapPin size={20} />
          <span>Belum ada unit dengan koordinat untuk ditampilkan</span>
        </div>
      ) : null}
    </div>
  );
});

/* ── Main MapPanel ── */
export function MapPanel({
  mapFleetRows,
  mapRegionSummary,
  mapSearch,
  setMapSearch,
  mapAccountFilter,
  setMapAccountFilter,
  fleetFilterAccounts,
  accountName,
  getMapStatusMeta,
  resolveFleetRegion,
  buildTruckDivIcon,
  fmtNum,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedRegions, setExpandedRegions] = useState({});
  const mapActionsRef = useRef(null);

  const plottedCount = useMemo(
    () => (mapFleetRows || []).filter((row) => Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))).length,
    [mapFleetRows],
  );

  const toggleRegion = useCallback((region) => {
    setExpandedRegions((current) => ({ ...current, [region]: !current[region] }));
  }, []);

  const handleZoomRegion = useCallback((rows) => {
    mapActionsRef.current?.zoomToRows(rows);
  }, []);

  const handlePanToUnit = useCallback((row) => {
    mapActionsRef.current?.panToUnit(row);
  }, []);

  const handleFitAll = useCallback(() => {
    mapActionsRef.current?.fitAll();
  }, []);

  const statusCounts = useMemo(() => {
    const counts = { moving: 0, stop: 0, error: 0 };
    (mapFleetRows || []).forEach((row) => {
      const meta = getMapStatusMeta(row);
      if (meta.key === 'moving') counts.moving += 1;
      else if (meta.key === 'stop') counts.stop += 1;
      else counts.error += 1;
    });
    return counts;
  }, [mapFleetRows, getMapStatusMeta]);

  return (
    <section className={`mp-page ${sidebarOpen ? '' : 'mp-page--collapsed'}`}>
      {/* ── Sidebar (fixed left column) ── */}
      <aside className={`mp-sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        {/* Header */}
        <div className="mp-sidebar-header">
          <h2 className="mp-sidebar-title">Fleet map</h2>
          <button type="button" className="mp-sidebar-close mp-mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Tutup sidebar">
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="mp-search-block">
          <div className="mp-search-input">
            <Search size={14} className="mp-search-icon" />
            <input
              type="search"
              value={mapSearch}
              onChange={(e) => setMapSearch(e.target.value)}
              placeholder="Cari nopol, lokasi..."
            />
          </div>
          <select
            className="mp-account-select"
            value={mapAccountFilter}
            onChange={(e) => setMapAccountFilter(e.target.value)}
          >
            <option value="all">Semua account</option>
            {(fleetFilterAccounts || []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.label || account.authEmail || account.id}
              </option>
            ))}
          </select>
        </div>

        {/* Stats */}
        <div className="mp-stats-strip">
          <div className="mp-stat">
            <span className="mp-stat-value mp-stat--moving">{statusCounts.moving}</span>
            <span className="mp-stat-label">Moving</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-value mp-stat--stop">{statusCounts.stop}</span>
            <span className="mp-stat-label">Stop</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-value mp-stat--error">{statusCounts.error}</span>
            <span className="mp-stat-label">Alert</span>
          </div>
        </div>

        {/* Region list */}
        <div className="mp-region-list">
          {(mapRegionSummary || []).length ? (
            (mapRegionSummary || []).map((group) => (
              <RegionCard
                key={group.region}
                region={group.region}
                rows={group.rows}
                getMapStatusMeta={getMapStatusMeta}
                expanded={!!expandedRegions[group.region]}
                onToggle={() => toggleRegion(group.region)}
                onZoomRegion={handleZoomRegion}
                onPanToUnit={handlePanToUnit}
              />
            ))
          ) : (
            <div className="mp-empty">
              <MapPin size={18} />
              <span>Belum ada data fleet</span>
            </div>
          )}
        </div>

        {/* Legend (sidebar footer) */}
        <MapLegend plottedCount={plottedCount} totalCount={(mapFleetRows || []).length} />
      </aside>

      {/* ── Map area ── */}
      <div className="mp-map-area">
        <FleetMapCanvas
          rows={mapFleetRows}
          getMapStatusMeta={getMapStatusMeta}
          resolveFleetRegion={resolveFleetRegion}
          buildTruckDivIcon={buildTruckDivIcon}
          fmtNum={fmtNum}
          mapActionsRef={mapActionsRef}
        />

        {/* Fit-all button */}
        <button type="button" className="mp-fit-all-btn" onClick={handleFitAll} title="Tampilkan semua unit" aria-label="Fit semua unit">
          <Maximize2 size={15} />
        </button>

      </div>

      {/* Mobile sidebar toggle — outside map area for z-index */}
      <button
        type="button"
        className="mp-sidebar-toggle"
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label={sidebarOpen ? 'Tutup sidebar' : 'Buka sidebar'}
      >
        {sidebarOpen ? <X size={16} /> : <Layers size={16} />}
      </button>
    </section>
  );
}
