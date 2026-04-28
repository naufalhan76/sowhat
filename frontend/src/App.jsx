
import React, { startTransition, useCallback, useEffect, useId, useMemo, useRef, useState, useDeferredValue } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, AlertCircle, AlertTriangle, ArrowRight, BarChart3, Box, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Clock3, Flag, LayoutDashboard, Map as MapIcon, MapPinOff, Menu, MessageSquare, MoonStar, Navigation,
  PackageSearch, RefreshCw, Route, Settings, ShieldAlert, Sun, Thermometer, Truck, X, Zap, Search
} from 'lucide-react';
import { NavRail } from './layout/NavRail.jsx';
import { CommandBar } from './layout/CommandBar.jsx';
import { StatusFooter } from './layout/StatusFooter.jsx';
import {
  Surface, SurfaceHeader, SurfaceBody,
  Action, ActionGroup,
  Pill as UIPill,
  Stat, StatGrid,
  Section,
  EmptyState,
  Spinner as UISpinner,
  Skeleton, SkeletonGroup,
  ErrorBoundary,
  CommandPalette,
} from './components/index.js';
import { ApiMonitorPanel } from './components/ApiMonitorPanel.jsx';
import { ConfigPanel } from './components/ConfigPanel.jsx';
import { AdminPanel } from './components/AdminPanel.jsx';
import { HistoricalPanel } from './components/HistoricalPanel.jsx';
import { TripMonitorPanel } from './components/trip-monitor/TripMonitorPanel.jsx';
import { TripMonitorFloatingPanel as TripMonitorFloatingPanelExtracted } from './components/trip-monitor/TripMonitorFloatingPanel.jsx';
import { AstroReportPanel } from './components/AstroReportPanel.jsx';
import { MapPanel } from './components/MapPanel.jsx';
import { TempErrorsPanel } from './components/TempErrorsPanel.jsx';
import { StopIdlePanel } from './components/StopIdlePanel.jsx';

const ROUTE_PANEL_IDS = new Set([
  'overview', 'fleet', 'trip-monitor', 'map', 'astro-report', 'temp-errors',
  'stop', 'api-monitor', 'historical', 'pod', 'config', 'admin',
]);

function useActivePanelRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const segment = (location.pathname || '/').split('/').filter(Boolean)[0] || 'overview';
  const activePanel = ROUTE_PANEL_IDS.has(segment) ? segment : 'overview';
  const setActivePanel = useCallback((next) => {
    const value = typeof next === 'function' ? next(activePanel) : next;
    if (!value || !ROUTE_PANEL_IDS.has(value)) return;
    if (value === activePanel) return;
    navigate('/' + value);
  }, [navigate, activePanel]);
  return [activePanel, setActivePanel];
}
// Compatibility wrappers - old call sites pass `variant`/`color`/`onPress` style props.
// Map these to the new component primitives without changing 5800 lines of JSX.
const Button = ({ children, variant, color, className = '', onPress, onClick, ...props }) => {
  const handle = onClick || onPress;
  const next = variant === 'bordered' || variant === 'flat' ? 'secondary'
    : variant === 'light' ? 'ghost'
    : color === 'danger' || color === 'error' ? 'danger'
    : 'primary';
  return <Action variant={next} className={className} onClick={handle} {...props}>{children}</Action>;
};

const Card = React.forwardRef(({ children, className = '', ...props }, ref) => (
  <Surface ref={ref} className={`sf-card-compat ${className}`.trim()} {...props}>{children}</Surface>
));
const CardHeader = ({ children, className = '' }) => <SurfaceHeader className={className}>{children}</SurfaceHeader>;
const CardContent = ({ children, className = '' }) => <SurfaceBody className={className}>{children}</SurfaceBody>;

const Chip = ({ children, variant, color = 'default', className = '', ...props }) => (
  <UIPill color={color} className={className} {...props}>{children}</UIPill>
);

const Link = ({ children, className = '', ...props }) => <a className={`sf-link ${className}`} {...props}>{children}</a>;
const Spinner = ({ size }) => <UISpinner size={size === 'sm' ? 'sm' : 'md'} />;

const StatGridSkeleton = ({ count = 4 }) => (
  <div className="stat-strip">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="stat-card" style={{ minHeight: 80 }}>
        <Skeleton width="60%" height="12px" />
        <Skeleton width="40%" height="22px" style={{ marginTop: 8 }} />
        <Skeleton width="80%" height="12px" style={{ marginTop: 8 }} />
      </div>
    ))}
  </div>
);

const BrandLockup = ({ compact = false }) => <div className={`brand-lockup ${compact ? 'brand-lockup-compact' : ''}`}>
  <span className="brand-mark">S</span>
  <span className="brand-wordmark"><span className="brand-wordmark-primary">Sowhat</span></span>
</div>;

function formatInputDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year || ''}-${lookup.month || ''}-${lookup.day || ''}`;
}

function today(offset = 0) {
  return formatInputDate(new Date(Date.now() + (offset * 24 * 60 * 60 * 1000)));
}

function normalizeInputDayValue(value, fallback = today(0)) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? formatInputDate(new Date(timestamp)) : fallback;
}

function deriveTripMonitorHistoryRange(detail) {
  const fallbackDay = normalizeInputDayValue(detail?.day || '', today(0));
  const jobOrders = detail?.metadata?.jobOrders || [];
  const timestamps = [];
  for (const job of jobOrders) {
    const etaOrigin = toTimestampMs(job?.etaOrigin);
    const etaDestination = toTimestampMs(job?.etaDestination);
    if (etaOrigin) timestamps.push(etaOrigin);
    if (etaDestination) timestamps.push(etaDestination);
  }
  if (!timestamps.length) {
    return { startDate: fallbackDay, endDate: fallbackDay };
  }
  return {
    startDate: formatInputDate(new Date(Math.min(...timestamps))),
    endDate: formatInputDate(new Date(Math.max(...timestamps))),
  };
}

function formatTripMonitorRangeLabel(range) {
  if (!range?.startDate || !range?.endDate) return '-';
  return `${range.startDate} to ${range.endDate}`;
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeTemperatureRange(minValue, maxValue) {
  const numericValues = [minValue, maxValue]
    .map((value) => value === null || value === undefined || value === '' ? null : Number(value))
    .filter((value) => Number.isFinite(value));
  if (!numericValues.length) {
    return { min: null, max: null };
  }
  return {
    min: Math.min(...numericValues),
    max: Math.max(...numericValues),
  };
}

const THEME_STORAGE_KEY = 'mabox-theme';

function readStoredTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === 'light' || storedTheme === 'dark') {
      return storedTheme;
    }
  } catch {}
  return window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
}

function normalizeTmsDriverAssign(driverAssign) {
  if (!Array.isArray(driverAssign)) return [];
  return [...driverAssign]
    .filter(Boolean)
    .sort((left, right) => Number(left?.idx ?? left?.index ?? 0) - Number(right?.idx ?? right?.index ?? 0));
}

function collectNestedDriverTexts(value, bucket, visited, depth = 0) {
  if (!value || depth > 4) return;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text) bucket.names.push(text);
    return;
  }
  if (typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectNestedDriverTexts(item, bucket, visited, depth + 1));
    return;
  }

  const nameCandidates = [
    value.driver_name,
    value.driverName,
    value.employee_name,
    value.employeeName,
    value.full_name,
    value.fullName,
    value.user_full_name,
    value.userFullName,
    value.driver_label,
    value.driverLabel,
    value.employee_label,
    value.employeeLabel,
    value.employee_full_name,
    value.employeeFullName,
    value.nama,
    value.nama_driver,
    value.driver,
    value.employee,
    value.name,
    value.label,
    value.title,
  ];
  const idCandidates = [
    value.driver_id,
    value.driverId,
    value.employee_id,
    value.employeeId,
    value.crew_id,
    value.crewId,
    value.user_id,
    value.userId,
    value.name,
  ];

  nameCandidates.forEach((candidate) => {
    const text = String(candidate || '').trim();
    if (text) bucket.names.push(text);
  });
  idCandidates.forEach((candidate) => {
    const text = String(candidate || '').trim();
    if (text) bucket.ids.push(text);
  });

  Object.entries(value).forEach(([key, nested]) => {
    if (nested === null || nested === undefined) return;
    const normalizedKey = String(key || '').trim().toLowerCase();
    if ([
      'idx',
      'index',
      'doctype',
      'owner',
      'modified_by',
      'creation',
      'modified',
      'parent',
      'parentfield',
      'parenttype',
      'assignment_status',
      'driver_status',
      'job_offer_status',
      'status',
    ].includes(normalizedKey)) {
      return;
    }
    if (typeof nested === 'object') {
      collectNestedDriverTexts(nested, bucket, visited, depth + 1);
    }
  });
}

function extractTmsDriverName(driver) {
  if (!driver) return '-';
  if (typeof driver === 'string') return driver.trim() || '-';
  const bucket = { names: [], ids: [] };
  collectNestedDriverTexts(driver, bucket, new Set());
  return pickFirstText(...bucket.names, ...bucket.ids) || '-';
}

function splitCsvText(value) {
  return String(value || "")
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}


const EMPTY_FORM = {
  baseUrl: 'https://www.solofleet.com',
  endpointPath: '/ReportTemperatureChart/getVehicleDetailDefrostJson',
  refererPath: '/ReportTemperatureChart',
  vehiclePagePath: '/Vehicle',
  discoveryEndpointPath: '/Vehicle/vehiclelivewithoutzonetripNewModelCondense',
  vehicleRoleId: '',
  sessionCookie: '',
  unitsText: '',
  customerProfilesText: '',
  podSitesText: '',
  pollIntervalSeconds: 60,
  requestLookbackMinutes: 30,
  requestIntervalSeconds: 120,
  historyRetentionDays: 7,
  minDurationMinutes: 5,
  maxGapMinutes: '',
  archiveType: 'liveserver',
  tempProfile: '-1',
  temperatureProcessing: '',
  autoStart: false,
};

const EMPTY_WEB_LOGIN_FORM = { username: '', password: '' };
const EMPTY_SOLOFLEET_LOGIN_FORM = { email: '', password: '', rememberMe: true, label: '' };
const EMPTY_WEB_USER_FORM = { id: '', username: '', displayName: '', password: '', role: 'admin', isActive: true };
const EMPTY_ADMIN_ROLLUP_FORM = { id: '', day: today(0), accountId: 'primary', accountLabel: '', unitId: '', unitLabel: '', vehicle: '', type: 'temp1', label: '', incidents: '0', temp1Incidents: '0', temp2Incidents: '0', bothIncidents: '0', firstStartTimestamp: '', lastEndTimestamp: '', durationMinutes: '0', totalMinutes: '0', longestMinutes: '0', temp1Min: '', temp1Max: '', temp2Min: '', temp2Max: '', minSpeed: '', maxSpeed: '', latitude: '', longitude: '', locationSummary: '', zoneName: '' };
const EMPTY_ADMIN_POD_FORM = { id: '', day: today(0), timestamp: '', time: '', unitId: '', unitLabel: '', customerName: '', podId: '', podName: '', latitude: '', longitude: '', speed: '', distanceMeters: '', locationSummary: '' };
const EMPTY_REMOTE_RESET_FORM = { enabled: false, selectedAccountIds: [] };
const UNIT_CATEGORY_OPTIONS = [
  { value: 'uncategorized', label: 'Uncategorized' },
  { value: 'oncall', label: 'OnCall' },
  { value: 'dedicated-astro', label: 'Dedicated Astro' },
  { value: 'dedicated-havi', label: 'Dedicated HAVI' },
];
const UNIT_CATEGORY_LABELS = Object.fromEntries(UNIT_CATEGORY_OPTIONS.map((option) => [option.value, option.label]));
const UNIT_CATEGORY_TONES = {
  uncategorized: 'default',
  oncall: 'info',
  'dedicated-astro': 'primary',
  'dedicated-havi': 'success',
};
const EMPTY_TMS_FORM = {
  tenantLabel: 'CargoShare TMS',
  baseUrl: 'https://1903202401.cargoshare.id',
  username: '',
  password: '',
  autoSync: true,
  syncIntervalMinutes: 15,
  geofenceRadiusMeters: 250,
  longStopMinutes: 45,
  appStagnantMinutes: 45,
};
const TMS_SEVERITY_META = {
  critical: { label: 'Critical', tone: 'danger' },
  warning: { label: 'Warning', tone: 'warning' },
  normal: { label: 'Normal', tone: 'success' },
  unmatched: { label: 'Unmatched', tone: 'info' },
  'no-job-order': { label: 'No JO', tone: 'default' },
};
const TMS_BOARD_COLUMNS = [
  { key: 'critical', label: 'Critical' },
  { key: 'warning', label: 'Warning' },
  { key: 'normal', label: 'Normal' },
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'no-job-order', label: 'No JO' },
];
const TMS_INCIDENT_META = {
  'gps-error': { label: 'GPS error', tone: 'danger' },
  'temp-error': { label: 'Temp error', tone: 'danger' },
  'temp-out-of-range': { label: 'Temp out of range', tone: 'danger' },
  'late-origin': { label: 'Late load', tone: 'warning' },
  'late-destination': { label: 'Late destination', tone: 'warning' },
  'geofence-origin': { label: 'Miss load geofence', tone: 'info' },
  'geofence-destination': { label: 'Miss destination geofence', tone: 'info' },
  'long-stop': { label: 'Long stop', tone: 'warning' },
};
const TMS_INCIDENT_LEGEND_CODES = [
  'gps-error',
  'temp-error',
  'temp-out-of-range',
  'late-origin',
  'late-destination',
  'long-stop',
  'geofence-origin',
  'geofence-destination',
];
const TMS_SHIPPING_STATUS_META = {
  'otw-load': { label: 'OTW LOAD' },
  'sampai-load': { label: 'SAMPAI LOAD' },
  'menuju-unload': { label: 'MENUJU UNLOAD' },
  'sampai-unload': { label: 'SAMPAI UNLOAD' },
  selesai: { label: 'SELESAI' },
};
const GEOFENCE_LOCATION_TYPES = ['WH', 'POD', 'POOL', 'POL', 'REST', 'PELABUHAN'];
const GEOFENCE_LOCATION_LABELS = {
  WH: 'Warehouse',
  POD: 'POD',
  POOL: 'Pool',
  POL: 'POL',
  REST: 'Rest Area',
  PELABUHAN: 'Pelabuhan',
};
const EMPTY_ASTRO_LOCATION_FORM = { id: '', name: '', latitude: '', longitude: '', radiusMeters: '150', type: 'POD', scopeMode: 'global', scopeAccountIds: '', scopeCustomerNames: '', isActive: true, notes: '' };
const ASTRO_GROUP_PREVIEW_LIMIT = 5;
const ASTRO_ROUTE_MAX_PODS = 5;
const createBlankAstroPodSlaArray = (count = 1) => Array.from({ length: Math.max(1, Math.min(ASTRO_ROUTE_MAX_PODS, Number(count || 1))) }, () => '');
const EMPTY_ASTRO_ROUTE_FORM = { id: '', accountId: 'primary', unitId: '', customerName: 'Astro', whLocationId: '', poolLocationId: '', podSequence: [''], rit1Start: '05:00', rit1End: '14:59', rit1WhArrivalTimeSla: '', rit1PodArrivalTimeSlas: createBlankAstroPodSlaArray(1), rit2Enabled: false, rit2Start: '19:00', rit2End: '06:00', rit2WhArrivalTimeSla: '', rit2PodArrivalTimeSlas: createBlankAstroPodSlaArray(1), whArrivalTempMinSla: '', whArrivalTempMaxSla: '', isActive: true, notes: '' };
const ASTRO_LOCATION_SAMPLE_CSV = ['Nama Tempat,Latitude,Longitude,Radius,Type', 'Astro WH CBN,-6.296412,107.146281,180,WH', 'Astro POD Bekasi Timur,-6.238765,106.999321,120,POD', 'Astro Pool Cakung,-6.182450,106.935870,160,POOL', 'Rest KM 39,-6.557777,106.781111,180,REST'].join('\n');
const ASTRO_ROUTE_SAMPLE_CSV = ['Account ID,Nopol,Customer,WH,POOL,POD1,POD2,POD3,POD4,POD5,Rit1 Start,Rit1 End,Rit1 WH Arrival Time SLA,Rit1 POD1 SLA,Rit1 POD2 SLA,Rit1 POD3 SLA,Rit1 POD4 SLA,Rit1 POD5 SLA,Rit2 Enabled,Rit2 Start,Rit2 End,Rit2 WH Arrival Time SLA,Rit2 POD1 SLA,Rit2 POD2 SLA,Rit2 POD3 SLA,Rit2 POD4 SLA,Rit2 POD5 SLA,WH Arrival Temp Min SLA,WH Arrival Temp Max SLA,Active,Notes', 'primary,B 9749 SXW,Astro,Astro WH CBN,Astro Pool Cakung,Astro POD Bekasi Timur,,,,,05:00,14:59,06:30,07:00,,,,,false,19:00,06:00,,,,,,2,8,true,Rit pagi only'].join('\n');

let leafletModulePromise = null;

function loadLeafletModule() {
  if (!leafletModulePromise) {
    leafletModulePromise = import('leaflet').then((module) => module.default || module);
  }
  return leafletModulePromise;
}

function useLeafletModule(enabled = true) {
  const [leaflet, setLeaflet] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    loadLeafletModule()
      .then((module) => {
        if (!cancelled) {
          setLeaflet(module);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLeaflet(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return leaflet;
}
const api = async (url, options = {}) => {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const payload = await response.json().catch(() => ({ ok: false, error: 'Invalid server response.' }));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
};
const parseDateValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? new Date(numeric) : null;
  }

  const localMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (localMatch && !/(Z|[+\-]\d{2}:?\d{2})$/i.test(text)) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = localMatch;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const toTimestampMs = (value) => {
  const parsed = parseDateValue(value);
  return parsed ? parsed.getTime() : 0;
};
const formatStayText = (startValue, endValue) => {
  const start = parseDateValue(startValue);
  const end = parseDateValue(endValue);
  if (!start || !end) return '-';
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return '-';
  const totalMinutes = Math.round(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
};
const formatMinutesText = (totalMinutes) => {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '-';
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
};
const haversineKm = (leftLat, leftLng, rightLat, rightLng) => {
  const lat1 = Number(leftLat);
  const lng1 = Number(leftLng);
  const lat2 = Number(rightLat);
  const lng2 = Number(rightLng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return 0;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const sanitizeRouteRecords = (records = []) => {
  const ordered = [...(records || [])]
    .map((record) => ({
      ...record,
      timestampMs: toTimestampMs(record.timestamp),
      latitude: Number(record.latitude),
      longitude: Number(record.longitude),
      speed: Number(record.speed ?? 0),
    }))
    .filter((record) => Number.isFinite(record.timestampMs) && Number.isFinite(record.latitude) && Number.isFinite(record.longitude) && record.timestampMs > 1600000000000)
    .sort((left, right) => left.timestampMs - right.timestampMs);

  const cleaned = [];
  let previous = null;
  for (const record of ordered) {
    if (!previous) {
      cleaned.push(record);
      previous = record;
      continue;
    }

    const diffMinutes = (record.timestampMs - previous.timestampMs) / 60000;
    if (!Number.isFinite(diffMinutes) || diffMinutes <= 0) {
      continue;
    }

    const distanceKm = haversineKm(previous.latitude, previous.longitude, record.latitude, record.longitude);
    const inferredSpeedKmh = diffMinutes > 0 ? distanceKm / (diffMinutes / 60) : 0;
    const bothSlow = (previous.speed || 0) <= 5 && (record.speed || 0) <= 5;

    if (bothSlow && distanceKm <= 0.03) {
      cleaned[cleaned.length - 1] = record;
      previous = record;
      continue;
    }

    if (inferredSpeedKmh > 130) {
      continue;
    }

    if (bothSlow && distanceKm > 0.3) {
      continue;
    }

    cleaned.push(record);
    previous = record;
  }

  return cleaned;
};
const calculateTripMetrics = (records = []) => {
  const ordered = sanitizeRouteRecords(records);
  if (ordered.length < 2) return { distanceKm: 0, movingMinutes: 0, stoppedMinutes: 0 };
  let distanceKm = 0;
  let movingMinutes = 0;
  let stoppedMinutes = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const diffMinutes = (current.timestampMs - previous.timestampMs) / 60000;
    if (!Number.isFinite(diffMinutes) || diffMinutes <= 0) continue;
    distanceKm += haversineKm(previous.latitude, previous.longitude, current.latitude, current.longitude);
    const moving = Number(previous.speed ?? current.speed ?? 0) > 0;
    if (moving) movingMinutes += diffMinutes;
    else stoppedMinutes += diffMinutes;
  }
  return { distanceKm, movingMinutes, stoppedMinutes };
};
const DISPLAY_TIMEZONE = 'Asia/Bangkok';
const fmtDate = (value) => {
  const parsed = parseDateValue(value);
  return parsed ? new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'long', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: DISPLAY_TIMEZONE }).format(parsed) : '-';
};
const fmtDateCompact = (value) => {
  const parsed = parseDateValue(value);
  return parsed ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: DISPLAY_TIMEZONE }).format(parsed) : '-';
};
const fmtDateOnly = (value) => {
  const parsed = parseDateValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value} 00:00:00` : value);
  if (!parsed) return '-';
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'long', day: '2-digit' }).format(parsed);
};
const fmtNum = (value, digits = 1) => value === null || value === undefined || value === '' ? '-' : Number(value).toFixed(digits);
const fmtPct = (value, digits = 1) => `${fmtNum(value ?? 0, digits)}%`;
const fmtCoord = (value) => value === null || value === undefined || value === '' ? '-' : Number(value).toFixed(6);
const sanitizeTripMonitorStops = (stops = []) => {
  const next = [];
  const offsets = new Map();
  stops.forEach((stop, index) => {
    const latitude = Number(stop?.latitude);
    const longitude = Number(stop?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }
    const key = `${latitude.toFixed(6)}:${longitude.toFixed(6)}`;
    const duplicateIndex = offsets.get(key) || 0;
    offsets.set(key, duplicateIndex + 1);
    const offsetStep = duplicateIndex * 0.00018;
    next.push({
      idx: Number(stop?.idx || index + 1),
      label: String(stop?.label || `S${index + 1}`).trim() || `S${index + 1}`,
      name: String(stop?.name || '').trim(),
      taskType: String(stop?.taskType || stop?.task_type || '').trim().toLowerCase(),
      taskAddress: String(stop?.taskAddress || stop?.task_address || '').trim(),
      coordinateSource: String(stop?.coordinateSource || stop?.coordinate_source || '').trim(),
      latitude: latitude + offsetStep,
      longitude: longitude + offsetStep,
      originalLatitude: latitude,
      originalLongitude: longitude,
    });
  });
  return next.slice(0, 15);
};
const fmtClock = (value) => {
  const parsed = parseDateValue(value);
  return parsed ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: DISPLAY_TIMEZONE }).format(parsed) : '-';
};
const fmtStayDuration = (startValue, endValue) => formatStayText(startValue, endValue);
const normalizeUnitCategory = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'uncategorized';
  if (raw === 'oncall' || raw === 'on-call' || raw === 'on call') return 'oncall';
  if (raw === 'dedicated-astro' || raw === 'dedicated astro' || raw === 'astro' || raw === 'dedicatedastro') return 'dedicated-astro';
  if (raw === 'dedicated-havi' || raw === 'dedicated havi' || raw === 'havi' || raw === 'dedicatedhavi') return 'dedicated-havi';
  return 'uncategorized';
};
const unitCategoryLabel = (value) => UNIT_CATEGORY_LABELS[normalizeUnitCategory(value)] || UNIT_CATEGORY_LABELS.uncategorized;
const unitCategoryTone = (value) => UNIT_CATEGORY_TONES[normalizeUnitCategory(value)] || 'default';
const normalizeAstroPodSlaDraft = (values, count) => {
  const next = Array.isArray(values) ? values.map((value) => String(value || '').trim()) : [];
  const targetCount = Math.max(1, Math.min(ASTRO_ROUTE_MAX_PODS, Number(count || 1)));
  while (next.length < targetCount) next.push('');
  return next.slice(0, targetCount);
};
const astroKpiTone = (status) => status === 'pass' ? 'success' : status === 'fail' ? 'danger' : 'default';
const astroKpiLabel = (status) => status === 'pass' ? 'Pass' : status === 'fail' ? 'Fail' : 'N/A';
const normalizeUnitLookupKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const toDateTimeLocalInput = (value) => {
  const parsed = parseDateValue(value);
  if (!parsed) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
};
const fmtAgo = (minutes) => minutes === null || minutes === undefined ? '-' : `${fmtNum(minutes, 1)} min ago`;
const unitsToText = (units) => (units || []).map((unit) => `${unit.id}|${unit.label}|${normalizeUnitCategory(unit.category)}`).join('\n');
const parseUnits = (text) => String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
  const parts = line.split('|');
  const id = String(parts[0] || '').trim();
  const label = String(parts[1] || parts[0] || '').trim();
  const category = normalizeUnitCategory(parts[2] || '');
  return id ? { id, label: label || id, category, categoryLabel: unitCategoryLabel(category) } : null;
}).filter(Boolean);
const customerProfilesToText = (profiles) => (profiles || []).map((profile) => `${profile.name || profile.id}|${profile.tempMin ?? ''}|${profile.tempMax ?? ''}|${(profile.unitIds || []).join(',')}`).join('\n');
const parseCustomerProfiles = (text) => String(text || '').split(/\r?\n/).map((line, index) => {
  const parts = line.split('|').map((item) => item.trim());
  if (!parts[0]) return null;
  return { id: `customer-${index + 1}`, name: parts[0], tempMin: parts[1] === '' ? null : Number(parts[1]), tempMax: parts[2] === '' ? null : Number(parts[2]), unitIds: String(parts[3] || '').split(',').map((item) => item.trim()).filter(Boolean) };
}).filter(Boolean);
const podSitesToText = (sites) => (sites || []).map((site) => `${site.name || site.id}|${site.latitude}|${site.longitude}|${site.radiusMeters}|${site.maxSpeedKph}|${site.customerId || ''}|${(site.unitIds || []).join(',')}`).join('\n');
const parsePodSites = (text) => String(text || '').split(/\r?\n/).map((line, index) => {
  const parts = line.split('|').map((item) => item.trim());
  if (!parts[0] || !parts[1] || !parts[2]) return null;
  return { id: `pod-${index + 1}`, name: parts[0], latitude: Number(parts[1]), longitude: Number(parts[2]), radiusMeters: parts[3] === '' ? 150 : Number(parts[3]), maxSpeedKph: parts[4] === '' ? 5 : Number(parts[4]), customerId: parts[5] || '', unitIds: String(parts[6] || '').split(',').map((item) => item.trim()).filter(Boolean) };
}).filter(Boolean);

const makeAccountId = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ('account-' + Date.now());
const accountName = (account) => account?.label || account?.authEmail || account?.id || 'Account';
const unitRowKey = (rowOrAccountId, unitId) => {
  if (rowOrAccountId && typeof rowOrAccountId === 'object') {
    return `${rowOrAccountId.accountId || 'primary'}::${rowOrAccountId.id || ''}`;
  }
  return `${rowOrAccountId || 'primary'}::${unitId || ''}`;
};

const formFromConfig = (config, accountId = 'primary') => {
  const account = accountId && accountId !== 'primary'
    ? (config.accounts || []).find((item) => item.id === accountId)
    : null;
  const scoped = account || {
    vehicleRoleId: config.vehicleRoleId,
    units: config.units,
    customerProfiles: config.customerProfiles,
    podSites: config.podSites,
  };

  return {
    baseUrl: config.solofleetBaseUrl || EMPTY_FORM.baseUrl,
    endpointPath: config.endpointPath || EMPTY_FORM.endpointPath,
    refererPath: config.refererPath || EMPTY_FORM.refererPath,
    vehiclePagePath: config.vehiclePagePath || EMPTY_FORM.vehiclePagePath,
    discoveryEndpointPath: config.discoveryEndpointPath || EMPTY_FORM.discoveryEndpointPath,
    vehicleRoleId: scoped.vehicleRoleId || '',
    sessionCookie: '',
    unitsText: unitsToText(scoped.units),
    customerProfilesText: customerProfilesToText(scoped.customerProfiles),
    podSitesText: podSitesToText(scoped.podSites),
    pollIntervalSeconds: config.pollIntervalSeconds || 60,
    requestLookbackMinutes: config.requestLookbackMinutes || 30,
    requestIntervalSeconds: config.requestIntervalSeconds || 120,
    historyRetentionDays: config.historyRetentionDays || 7,
    minDurationMinutes: config.minDurationMinutes || 5,
    maxGapMinutes: config.maxGapMinutes ?? '',
    archiveType: config.archiveType || 'liveserver',
    tempProfile: config.tempProfile || '-1',
    temperatureProcessing: config.temperatureProcessing || '',
    autoStart: Boolean(config.autoStart),
  };
};
const remoteResetFormFromConfig = (config) => ({
  enabled: Boolean(config?.remoteResetAutomation?.enabled),
  selectedAccountIds: Array.isArray(config?.remoteResetAutomation?.selectedAccountIds) ? config.remoteResetAutomation.selectedAccountIds : [],
});
const tmsFormFromConfig = (config) => {
  const source = config?.tms || config || {};
  return {
    tenantLabel: source.tenantLabel || EMPTY_TMS_FORM.tenantLabel,
    baseUrl: source.baseUrl || EMPTY_TMS_FORM.baseUrl,
    username: source.username || '',
    password: '',
    autoSync: source.autoSync !== false,
    syncIntervalMinutes: Number(source.syncIntervalMinutes || EMPTY_TMS_FORM.syncIntervalMinutes),
    geofenceRadiusMeters: Number(source.geofenceRadiusMeters || EMPTY_TMS_FORM.geofenceRadiusMeters),
    longStopMinutes: Number(source.longStopMinutes || EMPTY_TMS_FORM.longStopMinutes),
    appStagnantMinutes: Number(source.appStagnantMinutes || EMPTY_TMS_FORM.appStagnantMinutes),
  };
};
const tmsSeverityLabel = (value) => TMS_SEVERITY_META[String(value || '').toLowerCase()]?.label || 'Normal';
const tmsSeverityTone = (value) => TMS_SEVERITY_META[String(value || '').toLowerCase()]?.tone || 'default';
const tmsIncidentLabel = (value) => TMS_INCIDENT_META[String(value || '').toLowerCase()]?.label || value || '-';
const tmsShippingStatusLabel = (value) => TMS_SHIPPING_STATUS_META[String(value || '').toLowerCase()]?.label || value || '-';
const dedupeTripMonitorIncidentCodes = (codes) => [...new Set((codes || []).map((code) => String(code || '').trim()).filter(Boolean))];
const tripMonitorIncidentHistoryStatusLabel = (value) => String(value || '').toLowerCase() === 'resolved' ? 'Resolved' : 'Active';
const tripMonitorIncidentHistoryStatusTone = (value) => String(value || '').toLowerCase() === 'resolved' ? 'success' : 'warning';
const buildTripMonitorIncidentHistoryLocationLabel = (item) => {
  const first = String(item?.firstLocationSummary || '').trim();
  const last = String(item?.lastLocationSummary || '').trim();
  const resolved = String(item?.resolvedLocationSummary || '').trim();
  if (String(item?.status || '').toLowerCase() === 'resolved') {
    return {
      primary: first || last || resolved || '-',
      secondary: resolved ? `Resolved: ${resolved}` : (last ? `Last: ${last}` : '-'),
    };
  }
  return {
    primary: first || last || '-',
    secondary: last ? `Last: ${last}` : '-',
  };
};
const buildTripMonitorIncidentHistoryDescription = (item) => {
  const primary = String(
    (String(item?.status || '').toLowerCase() === 'resolved'
      ? (item?.detailClose || item?.detailOpen)
      : item?.detailOpen) || '-',
  ).trim() || '-';
  const secondary = String(item?.detailOpen || '').trim();
  if (String(item?.status || '').toLowerCase() === 'resolved' && secondary && secondary !== primary) {
    return { primary, secondary: `Opened: ${secondary}` };
  }
  return { primary, secondary: '' };
};
const formatTripMonitorStatusTime = (value) => value ? fmtDateCompact(value) : '-';
const formatEtaText = (value) => value ? `${fmtDateOnly(value)} ${fmtClock(value)}` : '-';
const csv = (name, rows) => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const body = [headers.join(','), ...rows.map((row) => headers.map((key) => {
    const text = String(row[key] ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(','))].join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

const rowHasSensorError = (row) => Boolean(row?.hasLiveSensorFault);
const rowIsCriticalError = (row) => row?.liveSensorFaultType === 'temp1+temp2';
const rowHasSetpointIssue = (row) => Boolean(row?.outsideSetpoint);
const rowHasGpsLate = (row) => row?.minutesSinceUpdate !== null && row?.minutesSinceUpdate > 30;
const rowPriority = (row) => {
  if (rowIsCriticalError(row)) return 6;
  if (rowHasSensorError(row)) return 5;
  if (rowHasSetpointIssue(row)) return 4;
  if (rowHasGpsLate(row)) return 3;
  if (row?.errGps) return 2;
  if (row?.isMoving) return 1;
  return 0;
};

const health = (row) => {
  if (rowIsCriticalError(row)) return { label: 'Temp1 + Temp2 error', tone: 'danger' };
  if (rowHasSensorError(row)) return { label: 'Temp error', tone: 'danger' };
  if (rowHasSetpointIssue(row)) return { label: 'Setpoint mismatch', tone: 'warning' };
  if (rowHasGpsLate(row)) return { label: 'GPS late > 30m', tone: 'warning' };
  if (row.errGps) return { label: 'GPS flag', tone: 'warning' };
  if (row.isMoving) return { label: 'Moving', tone: 'success' };
  return { label: 'Normal', tone: 'default' };
};
const REGION_RULES = [
  { name: 'Jabodetabek', keywords: ['dki jakarta', 'jakarta', 'bogor', 'depok', 'tangerang', 'tangerang selatan', 'bekasi'] },
  { name: 'Jogja', keywords: ['di yogyakarta', 'yogyakarta', 'jogja', 'sleman', 'bantul', 'kulon progo', 'gunungkidul'] },
  { name: 'Bali', keywords: ['bali', 'denpasar', 'badung', 'tabanan', 'gianyar', 'klungkung', 'karangasem', 'buleleng', 'jembrana', 'bangli'] },
  { name: 'Jawa Barat', keywords: ['jawa barat', 'bandung', 'cimahi', 'garut', 'tasikmalaya', 'ciamis', 'banjar', 'kuningan', 'cirebon', 'majalengka', 'sumedang', 'subang', 'purwakarta', 'karawang', 'sukabumi', 'cianjur', 'indramayu', 'pangandaran'] },
  { name: 'Jawa Tengah', keywords: ['jawa tengah', 'semarang', 'solo', 'surakarta', 'salatiga', 'magelang', 'tegal', 'pekalongan', 'brebes', 'purwokerto', 'cilacap', 'kebumen', 'purworejo', 'klaten', 'boyolali', 'sragen', 'wonogiri', 'karanganyar', 'kudus', 'pati', 'jepara', 'demak', 'kendal', 'batang', 'temanggung', 'wonosobo'] },
  { name: 'Jawa Timur', keywords: ['jawa timur', 'surabaya', 'sidoarjo', 'gresik', 'malang', 'batu', 'pasuruan', 'probolinggo', 'mojokerto', 'jombang', 'kediri', 'blitar', 'madiun', 'ngawi', 'nganjuk', 'lamongan', 'bojonegoro', 'tuban', 'banyuwangi', 'jember', 'lumajang', 'situbondo', 'bondowoso', 'madura', 'pamekasan', 'sampang', 'sumenep', 'bangkalan'] },
  { name: 'Sumatera', keywords: ['aceh', 'sumatera utara', 'medan', 'binjai', 'pematangsiantar', 'riau', 'pekanbaru', 'dumai', 'sumatera barat', 'padang', 'bukittinggi', 'jambi', 'palembang', 'sumatera selatan', 'lampung', 'bandar lampung', 'bengkulu', 'kepulauan riau', 'batam', 'tanjung pinang', 'bangka belitung', 'pangkal pinang'] },
];
const regionTextForRow = (row) => [row?.locationSummary, row?.zoneName, row?.group, row?.customerName].map((value) => String(value || '').toLowerCase()).join(' | ');
const resolveFleetRegion = (row) => {
  const text = regionTextForRow(row);
  if (!text.trim()) return 'Lainnya';
  const match = REGION_RULES.find((rule) => rule.keywords.some((keyword) => text.includes(keyword)));
  return match?.name || 'Lainnya';
};
const getMapStatusMeta = (row) => {
  if (rowIsCriticalError(row)) return { key: 'temp-both', label: '2 temp error', color: '#ef4444' };
  if (rowHasSensorError(row)) return { key: 'temp-single', label: '1 temp error', color: '#f97316' };
  if (rowHasGpsLate(row) || row?.errGps) return { key: 'gps-late', label: 'Late GPS', color: '#eab308' };
  if (row?.isMoving || Number(row?.speed || 0) > 0) return { key: 'moving', label: 'Moving', color: '#22c55e' };
  return { key: 'stop', label: 'Stop', color: '#94a3b8' };
};
const TRUCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.684-.949V8a1 1 0 0 1 1-1h1.382a1 1 0 0 1 .894.553l1.448 2.894A1 1 0 0 0 20.382 11H22v5a2 2 0 0 1-2 2"/><circle cx="7" cy="18" r="2"/><circle cx="20" cy="18" r="2" style="display:none"/></svg>`;
const buildTruckDivIcon = (leaflet, color, size = 28) => leaflet.divIcon({
  className: 'fleet-truck-marker-shell',
  html: `<div class="fleet-truck-marker" style="--truck-color:${color};width:${size}px;height:${size}px">${TRUCK_SVG}</div>`,
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
});
const geofenceChipTone = (row) => {
  const label = String(row?.geofenceStatusLabel || '').trim().toLowerCase();
  if (!label) return 'default';
  if (label.startsWith('sampai pod')) return 'success';
  if (label.startsWith('sampai wh')) return 'info';
  if (label.startsWith('sampai pool')) return 'primary';
  if (label.startsWith('sampai pol')) return 'warning';
  if (label.startsWith('sampai pelabuhan')) return 'danger';
  if (label.startsWith('sampai rest')) return 'default';
  if (label === 'en route') return 'primary';
  if (label === 'idle') return 'default';
  return row?.geofenceActive ? 'success' : (row?.isMoving ? 'primary' : 'default');
};
const sortFleetRows = (rows) => [...rows].sort((left, right) => {
  const priorityGap = rowPriority(right) - rowPriority(left);
  if (priorityGap !== 0) return priorityGap;
  const alertGap = (right.currentAlertsCount || 0) - (left.currentAlertsCount || 0);
  if (alertGap !== 0) return alertGap;
  const deltaGap = (right.liveTempDelta ?? -1) - (left.liveTempDelta ?? -1);
  if (deltaGap !== 0) return deltaGap;
  const freshnessGap = (left.minutesSinceUpdate ?? Number.MAX_SAFE_INTEGER) - (right.minutesSinceUpdate ?? Number.MAX_SAFE_INTEGER);
  if (freshnessGap !== 0) return freshnessGap;
  return String(left.label || left.id).localeCompare(String(right.label || right.id));
});

const buildErrorOverview = (alerts) => {
  const units = new Set();
  let totalMinutes = 0;
  let criticalAlerts = 0;
  for (const alert of alerts) {
    units.add(`${alert.accountId || 'primary'}::${alert.unitId}`);
    totalMinutes += Number(alert.durationMinutes || 0);
    if (alert.type === 'temp1+temp2') criticalAlerts += 1;
  }
  return { alerts: alerts.length, affectedUnits: units.size, criticalAlerts, totalMinutes };
};

export default function App() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState(null);
  const [report, setReport] = useState(null);
  const [apiMonitor, setApiMonitor] = useState(null);
  const [stopReport, setStopReport] = useState(null);
  const [unitDetail, setUnitDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [historicalDetail, setHistoricalDetail] = useState(null);
  const [historicalDetailBusy, setHistoricalDetailBusy] = useState(false);
  const [historicalAppliedSelection, setHistoricalAppliedSelection] = useState(null);
  const [banner, setBanner] = useState({ tone: 'info', message: '' });
  const [authModal, setAuthModal] = useState({ open: false, message: '' });
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('Sedang memproses aksi...');
  const [loaded, setLoaded] = useState(false);
  const [activePanel, setActivePanel] = useActivePanelRoute();
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [selectedUnitAccountId, setSelectedUnitAccountId] = useState('primary');
  const [activeAccountId, setActiveAccountId] = useState('primary');
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [fleetAccountFilter, setFleetAccountFilter] = useState('all');
  const [fleetCategoryFilter, setFleetCategoryFilter] = useState('all');
  const [mapSearch, setMapSearch] = useState('');
  const [mapAccountFilter, setMapAccountFilter] = useState('all');
  const [mapRegionPages, setMapRegionPages] = useState({});
  const [theme, setTheme] = useState(readStoredTheme);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileTopbarExpanded, setMobileTopbarExpanded] = useState(false);
  const [compactTopbar, setCompactTopbar] = useState(false);
  const [expandedFleetRowKey, setExpandedFleetRowKey] = useState('');
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [historicalSearch, setHistoricalSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const deferredHistoricalSearch = useDeferredValue(historicalSearch);
  const deferredMapSearch = useDeferredValue(mapSearch);
  const [range, setRange] = useState({ startDate: today(0), endDate: today(0) });
  const [historicalRangeDraft, setHistoricalRangeDraft] = useState({ startDate: today(0), endDate: today(0) });
  const [historicalRangeApplied, setHistoricalRangeApplied] = useState({ startDate: today(0), endDate: today(0) });
  const [stopForm, setStopForm] = useState({ accountId: 'primary', unitId: '', reportType: '3', minDuration: '0' });
  const [webLoginForm, setWebLoginForm] = useState(EMPTY_WEB_LOGIN_FORM);
  const [accountLoginForm, setAccountLoginForm] = useState(EMPTY_SOLOFLEET_LOGIN_FORM);
  const [webSessionUser, setWebSessionUser] = useState(null);
  const [webUsers, setWebUsers] = useState([]);
  const [webUserForm, setWebUserForm] = useState(EMPTY_WEB_USER_FORM);
  const [adminStorageProvider, setAdminStorageProvider] = useState('local-bootstrap');
  const [adminTempRollups, setAdminTempRollups] = useState([]);
  const [adminPodSnapshots, setAdminPodSnapshots] = useState([]);
  const [adminRollupForm, setAdminRollupForm] = useState(EMPTY_ADMIN_ROLLUP_FORM);
  const [adminPodForm, setAdminPodForm] = useState(EMPTY_ADMIN_POD_FORM);
  const [remoteResetForm, setRemoteResetForm] = useState(EMPTY_REMOTE_RESET_FORM);
  const [remoteResetLogs, setRemoteResetLogs] = useState([]);
  const [selectedAstroLocationIds, setSelectedAstroLocationIds] = useState([]);
  const [selectedAstroRouteIds, setSelectedAstroRouteIds] = useState([]);
  const [astroLocationForm, setAstroLocationForm] = useState(EMPTY_ASTRO_LOCATION_FORM);
  const [astroRouteForm, setAstroRouteForm] = useState(EMPTY_ASTRO_ROUTE_FORM);
  const [astroLocationSectionOpen, setAstroLocationSectionOpen] = useState(false);
  const [astroRouteSectionOpen, setAstroRouteSectionOpen] = useState(false);
  const [remoteResetSectionOpen, setRemoteResetSectionOpen] = useState(false);
  const [linkedAccountSectionOpen, setLinkedAccountSectionOpen] = useState(false);
  const [unitCategorySectionOpen, setUnitCategorySectionOpen] = useState(false);
  const [astroCsvText, setAstroCsvText] = useState('');
  const [astroLocationExpanded, setAstroLocationExpanded] = useState({});
  const [astroRouteExpanded, setAstroRouteExpanded] = useState({});
  const [astroLocationSearch, setAstroLocationSearch] = useState('');
  const [astroRouteSearch, setAstroRouteSearch] = useState('');
  const [astroRouteCsvText, setAstroRouteCsvText] = useState('');
  const [unitCategorySearch, setUnitCategorySearch] = useState('');
  const [selectedUnitCategoryIds, setSelectedUnitCategoryIds] = useState([]);
  const [unitCategoryBulkValue, setUnitCategoryBulkValue] = useState('uncategorized');
  const [unitCategoryCsvText, setUnitCategoryCsvText] = useState('');
  const [astroReportFilters, setAstroReportFilters] = useState({ startDate: today(-1), endDate: today(0), accountId: 'all', routeId: '' });
  const [astroReportMode, setAstroReportMode] = useState('plain');
  const [astroReport, setAstroReport] = useState(null);
  const [astroDiagnosticsOpen, setAstroDiagnosticsOpen] = useState(false);
  const [overviewAccountId, setOverviewAccountId] = useState('primary');
  const [overviewAstroSummary, setOverviewAstroSummary] = useState(null);
  const [overviewAstroBusy, setOverviewAstroBusy] = useState(false);
  const [revealedWhCount, setRevealedWhCount] = useState(0);
  const [astroSnapshotLogs, setAstroSnapshotLogs] = useState([]);
  const [astroSnapshotLogsBusy, setAstroSnapshotLogsBusy] = useState(false);
  const [astroSnapshotAutoSync, setAstroSnapshotAutoSync] = useState(null);
  const [astroSnapshotConsoleSectionOpen, setAstroSnapshotConsoleSectionOpen] = useState(false);
  const [tmsForm, setTmsForm] = useState(EMPTY_TMS_FORM);
  const [tmsLogs, setTmsLogs] = useState([]);
  const [tmsLogsBusy, setTmsLogsBusy] = useState(false);
  const [tripMonitorBoard, setTripMonitorBoard] = useState({ rows: [], summary: null });
  const [tripMonitorBusy, setTripMonitorBusy] = useState(false);
  const [tripMonitorFilters, setTripMonitorFilters] = useState({ customer: 'all', severity: 'all', incidentCode: 'all', appStatus: '', search: '' });
  const [tripMonitorPanels, setTripMonitorPanels] = useState([]);
  const [tmsConfigSectionOpen, setTmsConfigSectionOpen] = useState(false);
  const astroLocationCardRef = useRef(null);
  const astroRouteCardRef = useRef(null);
  const busyTimeoutRef = useRef(null);
  const dashboardAbortRef = useRef(null);
  const tripMonitorBoardRequestRef = useRef(0);
  const tripMonitorNextZRef = useRef(100);
  const fleetRows = status?.fleet?.rows || [];
  const availableAccounts = status?.config?.accounts || [];
  const connectedAccounts = useMemo(() => availableAccounts.filter((account) => account.hasSessionCookie), [availableAccounts]);
  const fleetFilterAccounts = useMemo(() => availableAccounts.filter((account) => fleetRows.some((row) => (row.accountId || 'primary') === account.id)), [availableAccounts, fleetRows]);
  const currentAccount = useMemo(() => availableAccounts.find((account) => account.id === activeAccountId) || availableAccounts[0] || null, [availableAccounts, activeAccountId]);
  const overviewAccountOptions = useMemo(() => availableAccounts.map((account) => ({ value: account.id, label: account.label || account.authEmail || account.id })), [availableAccounts]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {}
  }, [theme]);
  const overviewAccountStats = useMemo(() => {
    const overviewAccounts = status?.overview?.accounts || [];
    return overviewAccounts.find((account) => account.id === overviewAccountId)
      || overviewAccounts[0]
      || {
        id: overviewAccountId || 'primary',
        label: accountName(availableAccounts.find((account) => account.id === overviewAccountId) || currentAccount || { id: overviewAccountId || 'primary' }),
        totalConfiguredUnits: 0,
        tempErrorUnits: 0,
        movingUnits: 0,
        idleUnits: 0,
        noLiveUnits: 0,
        tempErrorRate: 0,
        movingRate: 0,
        idleRate: 0,
      };
  }, [status?.overview?.accounts, overviewAccountId, availableAccounts, currentAccount]);
  useEffect(() => {
    if (!overviewAccountOptions.length) return;
    setOverviewAccountId((current) => overviewAccountOptions.some((option) => option.value === current)
      ? current
      : activeAccountId || overviewAccountOptions[0].value);
  }, [overviewAccountOptions, activeAccountId]);
  const configuredUnits = useMemo(() => parseUnits(form.unitsText), [form.unitsText]);
  const filteredConfiguredUnits = useMemo(() => {
    const q = unitCategorySearch.trim().toLowerCase();
    if (!q) return configuredUnits;
    return configuredUnits.filter((unit) => [unit.id, unit.label, unitCategoryLabel(unit.category)].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [configuredUnits, unitCategorySearch]);
  useEffect(() => {
    setSelectedUnitCategoryIds((current) => current.filter((id) => configuredUnits.some((unit) => unit.id === id)));
  }, [configuredUnits]);
  const astroLocations = status?.config?.astroLocations || [];
  const astroRoutes = status?.config?.astroRoutes || [];
  const astroWhLocations = useMemo(() => astroLocations.filter((location) => location.type === 'WH'), [astroLocations]);
  const astroPodLocations = useMemo(() => astroLocations.filter((location) => location.type === 'POD'), [astroLocations]);
  const astroPoolLocations = useMemo(() => astroLocations.filter((location) => location.type === 'POOL'), [astroLocations]);
  const geofenceLocationCounts = useMemo(() => {
    const counts = Object.fromEntries(GEOFENCE_LOCATION_TYPES.map((type) => [type, 0]));
    astroLocations.forEach((location) => {
      if (counts[location.type] !== undefined) {
        counts[location.type] += 1;
      }
    });
    return counts;
  }, [astroLocations]);
  const astroRouteUnitOptions = useMemo(() => {
    const seen = new Set();
    return [...fleetRows.map((row) => ({ accountId: row.accountId || 'primary', accountLabel: row.accountLabel || row.accountId || 'primary', id: row.id, label: row.label })), ...availableAccounts.flatMap((account) => (account.units || []).map((unit) => ({ accountId: account.id, accountLabel: account.label || account.authEmail || account.id, id: unit.id, label: unit.label })))]
      .filter((unit) => {
        const key = `${unit.accountId}::${unit.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => String(left.accountLabel).localeCompare(String(right.accountLabel)) || String(left.id).localeCompare(String(right.id)));
  }, [fleetRows, availableAccounts]);
  const astroRouteAccountOptions = useMemo(() => availableAccounts.map((account) => ({ value: account.id, label: account.label || account.authEmail || account.id })).sort((left, right) => left.label.localeCompare(right.label)), [availableAccounts]);
  const astroUnitLabelByKey = useMemo(() => {
    const map = new globalThis.Map();
    astroRouteUnitOptions.forEach((unit) => {
      map.set(`${unit.accountId || 'primary'}::${unit.id}`, unit.label || unit.id);
    });
    return map;
  }, [astroRouteUnitOptions]);
  const astroRouteFilteredUnitOptions = useMemo(() => astroRouteUnitOptions.filter((unit) => unit.accountId === astroRouteForm.accountId).map((unit) => ({ value: unit.id, label: `${unit.accountLabel} | ${unit.label || unit.id}` })), [astroRouteUnitOptions, astroRouteForm.accountId]);
  const historicalTripMetrics = useMemo(() => calculateTripMetrics(historicalDetail?.records || []), [historicalDetail?.records]);
  const historicalGeofenceEvents = useMemo(() => historicalDetail?.geofenceEvents || [], [historicalDetail?.geofenceEvents]);
  const astroWhOptions = useMemo(() => astroWhLocations.map((location) => ({ value: location.id, label: location.name })).sort((left, right) => left.label.localeCompare(right.label)), [astroWhLocations]);
  const astroPoolOptions = useMemo(() => [{ value: '', label: 'Optional' }, ...astroPoolLocations.map((location) => ({ value: location.id, label: location.name })).sort((left, right) => left.label.localeCompare(right.label))], [astroPoolLocations]);
  const astroPodOptions = useMemo(() => [{ value: '', label: 'Optional' }, ...astroPodLocations.map((location) => ({ value: location.id, label: location.name })).sort((left, right) => left.label.localeCompare(right.label))], [astroPodLocations]);
  const astroLocationGroups = useMemo(() => GEOFENCE_LOCATION_TYPES.map((type) => ({ key: type, title: GEOFENCE_LOCATION_LABELS[type] || type, items: astroLocations.filter((location) => location.type === type).sort((left, right) => Number(right.isActive !== false) - Number(left.isActive !== false) || String(left.name).localeCompare(String(right.name))) })).filter((group) => group.items.length > 0), [astroLocations]);
  const astroRouteGroups = useMemo(() => {
    const grouped = new globalThis.Map();
    astroRoutes.forEach((route) => {
      const accountId = route.accountId || 'primary';
      const account = availableAccounts.find((item) => item.id === accountId);
      if (!grouped.has(accountId)) grouped.set(accountId, { key: accountId, title: accountName(account || { id: accountId }), items: [] });
      grouped.get(accountId).items.push(route);
    });
    return [...grouped.values()].map((group) => ({
      ...group,
      items: group.items.sort((left, right) => {
        const leftLabel = astroUnitLabelByKey.get(`${left.accountId || 'primary'}::${left.unitId}`) || left.unitId;
        const rightLabel = astroUnitLabelByKey.get(`${right.accountId || 'primary'}::${right.unitId}`) || right.unitId;
        return String(leftLabel).localeCompare(String(rightLabel));
      }),
    })).sort((left, right) => String(left.title).localeCompare(String(right.title)));
  }, [astroRoutes, availableAccounts, astroUnitLabelByKey]);
  const astroFilteredLocationGroups = useMemo(() => {
    const query = astroLocationSearch.trim().toLowerCase();
    if (!query) return astroLocationGroups;
    return astroLocationGroups.map((group) => ({
      ...group,
      items: group.items.filter((location) => [location.name, location.id, location.type, location.notes, location.scopeMode, ...(location.scopeAccountIds || []), ...(location.scopeCustomerNames || [])].some((value) => String(value || '').toLowerCase().includes(query))),
    })).filter((group) => group.items.length > 0);
  }, [astroLocationGroups, astroLocationSearch]);
  const astroFilteredRouteGroups = useMemo(() => {
    const query = astroRouteSearch.trim().toLowerCase();
    if (!query) return astroRouteGroups;
    return astroRouteGroups.map((group) => ({
      ...group,
      items: group.items.filter((route) => {
        const unitLabel = astroUnitLabelByKey.get(`${route.accountId || 'primary'}::${route.unitId}`) || route.unitId;
        const whName = astroLocations.find((location) => location.id === route.whLocationId)?.name || '';
        const poolName = astroLocations.find((location) => location.id === route.poolLocationId)?.name || '';
        const podNames = (route.podSequence || []).map((locationId) => astroLocations.find((location) => location.id === locationId)?.name || locationId).join(' ');
        return [unitLabel, route.unitId, route.customerName, whName, poolName, podNames, route.notes].some((value) => String(value || '').toLowerCase().includes(query));
      }),
    })).filter((group) => group.items.length > 0);
  }, [astroRouteGroups, astroRouteSearch, astroUnitLabelByKey, astroLocations]);
  const astroReportAccountOptions = useMemo(() => [{ value: 'all', label: 'All accounts' }, ...availableAccounts.map((account) => ({ value: account.id, label: account.label || account.authEmail || account.id })).sort((left, right) => left.label.localeCompare(right.label))], [availableAccounts]);
  const astroReportUnitOptions = useMemo(() => astroRoutes.map((route) => {
    const accountId = route.accountId || 'primary';
    const accountLabel = accountName(availableAccounts.find((account) => account.id === accountId));
    const unitLabel = astroUnitLabelByKey.get(`${accountId}::${route.unitId}`) || route.unitId;
    const whName = astroLocations.find((location) => location.id === route.whLocationId)?.name || 'WH';
    const podNames = (route.podSequence || []).map((locationId) => astroLocations.find((location) => location.id === locationId)?.name || locationId);
    const routePreview = `${accountLabel} | ${unitLabel}${podNames.length ? ` | ${whName} -> ${podNames.join(' -> ')}` : ` | ${whName}`}`;
    const statusLabel = route.isActive === false ? 'Inactive' : 'Active';
    return {
      value: route.id,
      accountId,
      isActive: route.isActive !== false,
      label: `${routePreview}${route.isActive === false ? ' | Inactive' : ''}`,
      preview: `${routePreview}\nStatus: ${statusLabel}${route.rit1Start && route.rit1End ? `\nRit 1: ${route.rit1Start} to ${route.rit1End}` : ''}${route.rit2Enabled && route.rit2Start && route.rit2End ? `\nRit 2: ${route.rit2Start} to ${route.rit2End}` : ''}`,
    };
  }).sort((left, right) => left.label.localeCompare(right.label)), [astroRoutes, availableAccounts, astroUnitLabelByKey, astroLocations]);
  const astroReportVisibleRouteOptions = useMemo(() => astroReportUnitOptions.filter((option) => option.isActive && (astroReportFilters.accountId === 'all' || option.accountId === astroReportFilters.accountId)), [astroReportUnitOptions, astroReportFilters.accountId]);
  useEffect(() => {
    if (!astroReportFilters.routeId) return;
    const selectedOption = astroReportUnitOptions.find((option) => option.value === astroReportFilters.routeId);
    const matchesAccount = astroReportFilters.accountId === 'all' || selectedOption?.accountId === astroReportFilters.accountId;
    if (!selectedOption?.isActive || !matchesAccount) {
      setAstroReportFilters((current) => (current.routeId ? { ...current, routeId: '' } : current));
    }
  }, [astroReportFilters.routeId, astroReportFilters.accountId, astroReportUnitOptions]);
    const astroReportMaxPods = astroReport?.summary?.maxPods || 0;
  const overviewAccountFleetRows = useMemo(() => fleetRows.filter((row) => (row.accountId || 'primary') === overviewAccountId), [fleetRows, overviewAccountId]);
  const overviewDonutSegments = useMemo(() => {
    const totalConfigured = Number(overviewAccountStats.totalConfiguredUnits || 0);
    const tempErrorUnits = overviewAccountFleetRows.filter((row) => row.hasLiveSensorFault).length;
    const movingUnits = overviewAccountFleetRows.filter((row) => row.hasLiveSnapshot && row.isMoving && !row.hasLiveSensorFault).length;
    const idleUnits = overviewAccountFleetRows.filter((row) => row.hasLiveSnapshot && !row.isMoving && !row.hasLiveSensorFault).length;
    const noLiveUnits = Math.max(0, totalConfigured - tempErrorUnits - movingUnits - idleUnits);
    return [
      { key: 'temp-error', label: 'Temp error', value: tempErrorUnits, tone: 'danger' },
      { key: 'moving', label: 'Moving', value: movingUnits, tone: 'success' },
      { key: 'idle', label: 'Idle', value: idleUnits, tone: 'warning' },
      { key: 'no-live', label: 'No live data', value: noLiveUnits, tone: 'default' },
    ];
  }, [overviewAccountStats.totalConfiguredUnits, overviewAccountFleetRows]);
  const overviewAstroKpi = overviewAstroSummary?.summary?.kpi || null;
  const overviewAstroTrend = overviewAstroKpi?.trend || overviewAstroSummary?.trend || [];
  const overviewAstroByWarehouse = useMemo(() => [...(overviewAstroKpi?.byWarehouse || [])]
    .sort((left, right) => (right.eligibleRows || 0) - (left.eligibleRows || 0) || (right.failRows || 0) - (left.failRows || 0))
    .slice(0, 6), [overviewAstroKpi]);
  const tmsConfig = status?.config?.tms || null;
  const tripMonitorRows = tripMonitorBoard?.rows || [];
  const tripMonitorIncludedStatusesLabel = 'On Progress, Fully Pickup, Partial Delivered, Fully Delivered';
  const tripMonitorSummary = tripMonitorBoard?.summary || {
    total: 0,
    bySeverity: { critical: 0, warning: 0, normal: 0, unmatched: 0, 'no-job-order': 0 },
    byIncident: {},
    customers: [],
    lastSync: null,
  };
  const tripMonitorCustomerOptions = useMemo(() => ['all', ...(tripMonitorSummary.customers || [])], [tripMonitorSummary.customers]);
  const tripMonitorBaseRows = useMemo(() => {
    const q = String(tripMonitorFilters.search || '').trim().toLowerCase();
    const appNeedle = String(tripMonitorFilters.appStatus || '').trim().toLowerCase();
    return tripMonitorRows.filter((row) => {
      if (tripMonitorFilters.customer !== 'all' && row.customerName !== tripMonitorFilters.customer) return false;
      if (tripMonitorFilters.incidentCode !== 'all' && !(row.incidentCodes || []).includes(tripMonitorFilters.incidentCode)) return false;
      if (appNeedle && appNeedle !== 'all' && !String(row.driverAppStatus || '').toLowerCase().includes(appNeedle)) return false;
      if (q) {
        const haystack = [row.unitId, row.unitLabel, row.jobOrderId, row.originName, row.destinationName, row.customerName, row.driverAppStatus, row.incidentSummary].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [tripMonitorRows, tripMonitorFilters.customer, tripMonitorFilters.incidentCode, tripMonitorFilters.appStatus, tripMonitorFilters.search]);
  const tripMonitorIncidentOptions = useMemo(() => ['all', ...Array.from(new Set(tripMonitorBaseRows.flatMap((row) => row.incidentCodes || []))).sort()], [tripMonitorBaseRows]);
  const tripMonitorSeverityCounts = useMemo(() => {
    const counts = { total: tripMonitorBaseRows.length, bySeverity: { critical: 0, warning: 0, normal: 0, unmatched: 0, 'no-job-order': 0 } };
    tripMonitorBaseRows.forEach((row) => {
      const severity = String(row?.severity || '').trim();
      if (counts.bySeverity[severity] !== undefined) {
        counts.bySeverity[severity] += 1;
      }
    });
    return counts;
  }, [tripMonitorBaseRows]);
  const filteredTripMonitorRows = useMemo(() => tripMonitorBaseRows.filter((row) => {
    if (tripMonitorFilters.severity !== 'all' && row.severity !== tripMonitorFilters.severity) return false;
    return true;
  }), [tripMonitorBaseRows, tripMonitorFilters.severity]);
  const tripMonitorVisibleRows = useMemo(() => filteredTripMonitorRows
    .slice()
    .sort((left, right) => {
      const severityOrder = { critical: 4, warning: 3, unmatched: 2, normal: 1, 'no-job-order': 0 };
      const severityGap = (severityOrder[right.severity] || 0) - (severityOrder[left.severity] || 0);
      if (severityGap) return severityGap;
      const incidentGap = (right.incidentCodes?.length || 0) - (left.incidentCodes?.length || 0);
      if (incidentGap) return incidentGap;
      const leftEta = left.etaDestination || left.etaOrigin || Number.MAX_SAFE_INTEGER;
      const rightEta = right.etaDestination || right.etaOrigin || Number.MAX_SAFE_INTEGER;
      if (leftEta !== rightEta) return leftEta - rightEta;
      return String(left.unitLabel || left.unitId || '').localeCompare(String(right.unitLabel || right.unitId || ''));
    }), [filteredTripMonitorRows]);
  useEffect(() => {
    if (activePanel !== 'overview' || !overviewAccountId || !range.startDate || !range.endDate) {
      return undefined;
    }
    let cancelled = false;
    setOverviewAstroBusy(true);
    setRevealedWhCount(0);
    api(`/api/astro/snapshots?${new URLSearchParams({
      startDate: range.startDate,
      endDate: range.endDate,
      accountId: overviewAccountId,
    }).toString()}`)
      .then((payload) => {
        if (!cancelled) {
          setOverviewAstroSummary(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOverviewAstroSummary(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOverviewAstroBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activePanel, overviewAccountId, range.startDate, range.endDate]);

  // Staggered reveal: after data loads, reveal WH cards one by one
  useEffect(() => {
    if (overviewAstroBusy || !overviewAstroSummary) {
      setRevealedWhCount(0);
      return undefined;
    }
    setRevealedWhCount(0);
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      setRevealedWhCount(count);
      if (count >= 4) clearInterval(timer);
    }, 800);
    return () => clearInterval(timer);
  }, [overviewAstroBusy, overviewAstroSummary]);

  useEffect(() => {
    if (!webSessionUser || (activePanel !== 'trip-monitor' && activePanel !== 'fleet')) {
      return undefined;
    }
    loadTripMonitorBoard(true).catch(() => {});
    const refreshTimer = setInterval(() => {
      loadTripMonitorBoard(true).catch(() => {});
    }, 60000);
    return () => clearInterval(refreshTimer);
  }, [activePanel, webSessionUser?.id]);

  useEffect(() => {
    if (activePanel !== 'config' || webSessionUser?.role !== 'admin') {
      return undefined;
    }
    loadTmsLogs(true).catch(() => {});
    return undefined;
  }, [activePanel, webSessionUser?.role]);

  const astroReportColumns = useMemo(() => {
    const base = [
      { key: 'serviceDate', label: 'Service date' },
      { key: 'rit', label: 'Rit' },
      { key: 'nopol', label: 'Nopol' },
      { key: 'wh', label: 'WH' },
      { key: 'whArrivalTime', label: 'WH arrival time' },
      { key: 'whArrivalTemp', label: 'WH arrival temp' },
      ...(astroReportMode === 'kpi'
        ? [
            { key: 'whArrivalTimeKpi', label: 'WH time KPI' },
            { key: 'whArrivalTempKpi', label: 'WH temp KPI' },
          ]
        : []),
      { key: 'whDepartureTemp', label: 'WH dep temp' },
      { key: 'whStay', label: 'WH stay' },
    ];
    const podColumns = Array.from({ length: astroReportMaxPods }, (_, index) => {
      const order = index + 1;
      return [
        { key: `pod${order}ArrivalTime`, label: `POD ${order} arrival time` },
        ...(astroReportMode === 'kpi' ? [{ key: `pod${order}Kpi`, label: `POD ${order} KPI` }] : []),
        { key: `pod${order}ArrivalTemp`, label: `POD ${order} arrival temp` },
        { key: `pod${order}DepartureTemp`, label: `POD ${order} dep temp` },
        { key: `pod${order}Stay`, label: `POD ${order} stay` },
      ];
    }).flat();
    return astroReportMode === 'kpi'
      ? [...base, ...podColumns, { key: 'overallKpi', label: 'Overall KPI' }]
      : [...base, ...podColumns];
  }, [astroReportMaxPods, astroReportMode]);
  const astroReportTableRows = useMemo(() => (astroReport?.rows || []).map((row) => {
    const renderTimeKpiCell = (entry) => <div className="astro-kpi-cell"><Chip color={astroKpiTone(entry?.status)}>{entry?.label || astroKpiLabel(entry?.status)}</Chip>{entry?.sla ? <div className="subtle-line">SLA {entry.sla}</div> : <div className="subtle-line">No SLA</div>}</div>;
    const renderTempKpiCell = (entry) => <div className="astro-kpi-cell"><Chip color={astroKpiTone(entry?.status)}>{entry?.label || astroKpiLabel(entry?.status)}</Chip>{entry && (entry.min !== null || entry.max !== null) ? <div className="subtle-line">Range {entry.min ?? '-'} to {entry.max ?? '-'}</div> : <div className="subtle-line">No SLA</div>}</div>;
    const cells = [
      row.serviceDate,
      row.rit,
      row.unitLabel || row.unitId,
      row.whName,
      fmtDateCompact(row.whEta),
      fmtNum(row.whArrivalTemp, 1),
    ];
    if (astroReportMode === 'kpi') {
      cells.push(renderTimeKpiCell(row.kpi?.whArrivalTime), renderTempKpiCell(row.kpi?.whArrivalTemp));
    }
    cells.push(fmtNum(row.whDepartureTemp, 1), fmtStayDuration(row.whEta, row.whEtd));
    for (let index = 0; index < astroReportMaxPods; index += 1) {
      const pod = row.pods?.[index];
      cells.push(pod ? fmtDateCompact(pod.eta) : '-');
      if (astroReportMode === 'kpi') {
        cells.push(renderTimeKpiCell(row.kpi?.podArrivalTimes?.[index]));
      }
      cells.push(
        pod ? fmtNum(pod.arrivalTemp, 1) : '-',
        pod ? fmtNum(pod.departureTemp, 1) : '-',
        pod ? fmtStayDuration(pod.eta, pod.etd) : '-',
      );
    }
    if (astroReportMode === 'kpi') {
      cells.push(<Chip color={astroKpiTone(row.kpi?.overallStatus)}>{row.kpi?.overallLabel || astroKpiLabel(row.kpi?.overallStatus)}</Chip>);
    }
    return cells;
  }), [astroReport, astroReportMaxPods, astroReportMode]);
  const astroDiagnostics = astroReport?.diagnostics || [];
  const astroDiagnosticRows = useMemo(() => astroDiagnostics.map((row) => [
    row.serviceDate || '-',
    row.rit || '-',
    row.unitLabel || row.unitId || '-',
    row.status || '-',
    row.reason || '-',
  ]), [astroDiagnostics]);
  const prioritizedFleet = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    let filtered = fleetRows;
    if (fleetAccountFilter !== 'all') filtered = filtered.filter((row) => (row.accountId || 'primary') === fleetAccountFilter);
    if (fleetCategoryFilter !== 'all') filtered = filtered.filter((row) => normalizeUnitCategory(row.unitCategory) === fleetCategoryFilter);
    if (quickFilter === 'temp-error') filtered = filtered.filter((row) => rowHasSensorError(row));
    if (quickFilter === 'setpoint') filtered = filtered.filter((row) => rowHasSetpointIssue(row));
    if (quickFilter === 'gps-late') filtered = filtered.filter((row) => rowHasGpsLate(row));
    if (q) {
      filtered = filtered.filter((row) => [row.accountLabel, row.id, row.label, row.alias, row.group, row.locationSummary, row.zoneName, row.customerName, row.setpointLabel, row.errSensor, row.errGps, row.unitCategoryLabel].some((value) => String(value || '').toLowerCase().includes(q)));
    }
    return sortFleetRows(filtered);
  }, [deferredSearch, fleetRows, fleetAccountFilter, fleetCategoryFilter, quickFilter]);
  const mapFleetRows = useMemo(() => {
    const q = deferredMapSearch.trim().toLowerCase();
    let filtered = fleetRows;
    if (mapAccountFilter !== 'all') filtered = filtered.filter((row) => (row.accountId || 'primary') === mapAccountFilter);
    if (q) {
      filtered = filtered.filter((row) => [row.accountLabel, row.id, row.label, row.alias, row.locationSummary, row.zoneName, row.customerName].some((value) => String(value || '').toLowerCase().includes(q)));
    }
    return sortFleetRows(filtered);
  }, [fleetRows, deferredMapSearch, mapAccountFilter]);
  const mapRegionSummary = useMemo(() => {
    const grouped = new globalThis.Map();
    mapFleetRows.forEach((row) => {
      const region = resolveFleetRegion(row);
      if (!grouped.has(region)) grouped.set(region, []);
      grouped.get(region).push(row);
    });
    const orderedRegions = [...REGION_RULES.map((rule) => rule.name), 'Lainnya'];
    return orderedRegions.map((region) => ({
      region,
      rows: sortFleetRows(grouped.get(region) || []),
    })).filter((group) => group.rows.length > 0);
  }, [mapFleetRows]);
  const explicitSelectedFleetRow = useMemo(() => fleetRows.find((row) => row.id === selectedUnitId && row.accountId === selectedUnitAccountId) || null, [fleetRows, selectedUnitId, selectedUnitAccountId]);
  const selectedFleetRow = useMemo(() => explicitSelectedFleetRow || prioritizedFleet[0] || fleetRows[0] || null, [explicitSelectedFleetRow, prioritizedFleet, fleetRows]);
  const expandedFleetRow = useMemo(() => prioritizedFleet.find((row) => unitRowKey(row) === expandedFleetRowKey) || null, [prioritizedFleet, expandedFleetRowKey]);
  const historicalFleet = useMemo(() => {
    const q = deferredHistoricalSearch.trim().toLowerCase();
    let filtered = fleetRows;
    if (q) {
      filtered = filtered.filter((row) => [row.accountLabel, row.id, row.label, row.alias, row.group, row.locationSummary, row.zoneName, row.customerName].some((value) => String(value || '').toLowerCase().includes(q)));
    }
    return sortFleetRows(filtered);
  }, [deferredHistoricalSearch, fleetRows]);
  const selectedHistoricalRow = useMemo(() => historicalFleet.find((row) => row.id === selectedUnitId && row.accountId === selectedUnitAccountId) || historicalFleet[0] || explicitSelectedFleetRow || fleetRows[0] || null, [historicalFleet, explicitSelectedFleetRow, fleetRows, selectedUnitId, selectedUnitAccountId]);
  const historicalAppliedRow = useMemo(() => {
    if (!historicalAppliedSelection?.unitId) return null;
    return historicalFleet.find((row) => row.id === historicalAppliedSelection.unitId && row.accountId === historicalAppliedSelection.accountId) || fleetRows.find((row) => row.id === historicalAppliedSelection.unitId && row.accountId === historicalAppliedSelection.accountId) || null;
  }, [historicalAppliedSelection, historicalFleet, fleetRows]);
  const activeDetailRow = activePanel === 'historical' ? selectedHistoricalRow : selectedFleetRow;
  const activeHistoricalRange = activePanel === 'historical' ? historicalRangeApplied : range;
  const errorRows = useMemo(() => [...(report?.tempErrorIncidents || [])].sort((left, right) => (right.firstStartTimestamp || 0) - (left.firstStartTimestamp || 0)), [report]);
  const podRows = useMemo(() => [...(report?.podSnapshots || [])].sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0)), [report]);
  const errorOverview = useMemo(() => buildErrorOverview(errorRows), [errorRows]);
  const compileDailyRows = useMemo(() => [...(report?.compileByDay || [])].sort((left, right) => new Date(right.day) - new Date(left.day)), [report]);
  const errorUnitsSummary = useMemo(() => [...(report?.compileByUnitDay || [])].sort((left, right) => (new Date(right.day) - new Date(left.day)) || (right.incidents || 0) - (left.incidents || 0)), [report]);

  const overviewTempTrend = useMemo(() => {
    const grouped = new Map();
    const rowsToProcess = Array.isArray(errorUnitsSummary) ? errorUnitsSummary : [];
    
    rowsToProcess
      .filter((row) => overviewAccountId === 'all' || String(row.accountId || 'primary') === String(overviewAccountId || 'primary'))
      .forEach((row) => {
        let dayStr = String(row.day || '').trim();
        // Standarisasi string hari menjadi YYYY-MM-DD kalau formatnya menyimpang (seperti '01 Apr 2026')
        if (dayStr && !/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) {
          // If only day/month is provided, force it to use the year from the UI range 
          // to avoid JS fallback to year 2001.
          const fallbackYear = range.startDate ? new Date(range.startDate).getFullYear() : new Date().getFullYear();
          const parsed = new Date(Date.parse(`${dayStr} ${fallbackYear}`));
          if (!isNaN(parsed.getTime())) {
            const y = parsed.getFullYear();
            const m = String(parsed.getMonth() + 1).padStart(2, '0');
            const d = String(parsed.getDate()).padStart(2, '0');
            dayStr = `${y}-${m}-${d}`;
          }
        }
        if (!dayStr) return;
        
        if (!grouped.has(dayStr)) {
          grouped.set(dayStr, { day: dayStr, incidents: 0, affectedUnitKeys: new Set(), totalMinutes: 0 });
        }
        const bucket = grouped.get(dayStr);
        bucket.incidents += Number(row.incidents || 0);
        bucket.totalMinutes += Number(row.totalMinutes || 0);
        bucket.affectedUnitKeys.add(String(row.unitId || row.vehicle || row.unitLabel || `unit-${bucket.affectedUnitKeys.size + 1}`));
      });

    const daysSet = new Set();
    const startObj = new Date(range.startDate);
    const endObj = new Date(range.endDate);
    
    if (!isNaN(startObj.getTime()) && !isNaN(endObj.getTime())) {
      // Gunakan iterasi UTC yang stabil untuk menghindari skip hari karena DST lokal
      let currentUtc = new Date(Date.UTC(startObj.getFullYear(), startObj.getMonth(), startObj.getDate()));
      const endUtc = new Date(Date.UTC(endObj.getFullYear(), endObj.getMonth(), endObj.getDate()));
      
      while (currentUtc <= endUtc) {
        daysSet.add(currentUtc.toISOString().split('T')[0]);
        currentUtc.setUTCDate(currentUtc.getUTCDate() + 1);
      }
    }
    
    // Safety check: Paksakan seluruh day yang berisi incident tampil di chart
    [...grouped.keys()].forEach((d) => daysSet.add(d));

    const finalDays = [...daysSet].sort();

    return finalDays.map((day) => {
      const bucket = grouped.get(day);
      return {
        day,
        incidents: Number(bucket?.incidents || 0),
        affectedUnits: bucket?.affectedUnitKeys instanceof Set ? bucket.affectedUnitKeys.size : Number(bucket?.affectedUnits || 0),
        totalMinutes: Number(bucket?.totalMinutes || 0),
      };
    });
  }, [errorUnitsSummary, overviewAccountId, range.startDate, range.endDate]);
  const overviewTempHotspots = useMemo(() => {
    const grouped = new Map();
    errorUnitsSummary
      .filter((row) => overviewAccountId === 'all' || String(row.accountId || 'primary') === String(overviewAccountId || 'primary'))
      .forEach((row) => {
        const key = `${row.accountId || 'primary'}::${row.unitId || row.vehicle || row.unitLabel || 'unit'}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            key,
            label: row.unitLabel || row.vehicle || row.unitId || '-',
            unitId: row.unitId || '-',
            incidents: 0,
            totalMinutes: 0,
          });
        }
        const bucket = grouped.get(key);
        bucket.incidents += Number(row.incidents || 0);
        bucket.totalMinutes += Number(row.totalMinutes || 0);
      });
    return [...grouped.values()]
      .sort((left, right) => (right.incidents || 0) - (left.incidents || 0) || (right.totalMinutes || 0) - (left.totalMinutes || 0))
      .slice(0, 6);
  }, [errorUnitsSummary, overviewAccountId]);
  const overviewTempSummary = useMemo(() => {
    const affectedUnits = new Set();
    let totalIncidents = 0;
    let totalMinutes = 0;
    let longestMinutes = 0;
    errorUnitsSummary
      .filter((row) => overviewAccountId === 'all' || String(row.accountId || 'primary') === String(overviewAccountId || 'primary'))
      .forEach((row) => {
        affectedUnits.add(row.unitId || row.vehicle || row.unitLabel || `unit-${affectedUnits.size + 1}`);
        totalIncidents += Number(row.incidents || 0);
        totalMinutes += Number(row.totalMinutes || 0);
        longestMinutes = Math.max(longestMinutes, Number(row.longestMinutes || 0));
      });
    return {
      totalIncidents,
      affectedUnits: affectedUnits.size,
      totalMinutes,
      longestMinutes,
    };
  }, [errorUnitsSummary, overviewAccountId]);

  const autoFilterCards = status?.autoFilterCards || [];
  const hasSolofleetAccounts = connectedAccounts.length > 0;
  const isAdmin = webSessionUser?.role === 'admin';
  const remoteResetStatus = status?.remoteReset || null;
  const showOverviewChrome = false;
  const navItems = useMemo(() => ([
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'fleet', label: 'Fleet Live', icon: Navigation },
    { id: 'trip-monitor', label: 'Trip Monitor', icon: Truck },
    { id: 'map', label: 'Map', icon: MapIcon },
    { id: 'astro-report', label: 'Astro Report', icon: BarChart3 },
    { id: 'temp-errors', label: 'Temp Errors', icon: Thermometer },
    { id: 'stop', label: 'Stop/Idle', icon: Flag },
    { id: 'api-monitor', label: 'API Monitor', icon: Activity },
    ...(isAdmin ? [{ id: 'config', label: 'Config', icon: Settings }, { id: 'admin', label: 'Admin', icon: Settings }] : []),
  ]), [isAdmin]);

  const cmdPaletteCommands = useMemo(() => [
    ...navItems.map((item, index) => ({
      id: `nav-${item.id}`,
      label: item.label,
      icon: item.icon,
      section: 'Panel',
      shortcut: index < 9 ? `${index + 1}` : undefined,
      onSelect: () => setActivePanel(item.id),
    })),
    { id: 'action-poll', label: 'Poll now', icon: Zap, section: 'Aksi', onSelect: () => loadDashboard(true, false).catch(() => {}) },
    { id: 'action-refresh', label: 'Refresh dashboard', icon: RefreshCw, section: 'Aksi', onSelect: () => loadDashboard(false, false).catch(() => {}) },
    { id: 'action-theme', label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: theme === 'dark' ? Sun : MoonStar, section: 'Aksi', onSelect: () => setTheme((c) => c === 'light' ? 'dark' : 'light') },
    { id: 'action-export-fleet', label: 'Export fleet CSV', icon: PackageSearch, section: 'Aksi', onSelect: () => exportFleet?.() },
    { id: 'action-export-alerts', label: 'Export temp error CSV', icon: AlertTriangle, section: 'Aksi', onSelect: () => exportAlerts?.() },
  ], [navItems, theme, setActivePanel, setTheme]);

  const stopBusy = () => {
    if (busyTimeoutRef.current) {
      window.clearTimeout(busyTimeoutRef.current);
      busyTimeoutRef.current = null;
    }
    setBusy(false);
    setBusyMessage('Sedang memproses aksi...');
  };

  const startBusy = (message = 'Sedang memproses aksi...') => {
    if (busyTimeoutRef.current) {
      window.clearTimeout(busyTimeoutRef.current);
      busyTimeoutRef.current = null;
    }
    setBusyMessage(message);
    setBusy(true);
    busyTimeoutRef.current = window.setTimeout(() => {
      busyTimeoutRef.current = null;
      setBusy(false);
      setBusyMessage('Sedang memproses aksi...');
      setAuthModal({ open: true, message: 'Aksi dihentikan karena melebihi batas tunggu 5 menit. Coba ulang lagi.' });
      setBanner({ tone: 'error', message: 'Aksi dihentikan karena melebihi batas tunggu 5 menit.' });
    }, 5 * 60 * 1000);
  };

  const runQuickBlockingAction = async (message, action) => {
    startBusy(message);
    try {
      await Promise.resolve(action());
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    } finally {
      stopBusy();
    }
  };

  const handleQuickFilterSelect = (nextFilter) => {
    setQuickFilter(nextFilter);
    setActivePanel('fleet');
  };

  useEffect(() => {
    loadDashboard(true, true).catch((error) => {
      setWebSessionUser(null);
      setLoaded(true);
      setBanner({ tone: 'error', message: error.message });
      setAuthModal({ open: true, message: error.message || 'Gagal memuat dashboard.' });
    });
  }, []);

  useEffect(() => {
    if (!banner.message) return undefined;
    const delay = banner.tone === 'error' ? 6000 : 4200;
    const timer = window.setTimeout(() => {
      setBanner((current) => current.message === banner.message ? { ...current, message: '' } : current);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [banner.message, banner.tone]);

  useEffect(() => () => {
    if (busyTimeoutRef.current) window.clearTimeout(busyTimeoutRef.current);
    if (dashboardAbortRef.current) dashboardAbortRef.current.abort();
  }, []);

  // Global Ctrl+K / Cmd+K -> command palette
  useEffect(() => {
    const handleGlobalKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setCmdPaletteOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadDashboard(false, true).catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [range.startDate, range.endDate]);

  useEffect(() => {
    if (!prioritizedFleet.length) return;
    if (!selectedUnitId || !fleetRows.some((row) => row.id === selectedUnitId && row.accountId === selectedUnitAccountId)) {
      setSelectedUnitId(prioritizedFleet[0].id);
      setSelectedUnitAccountId(prioritizedFleet[0].accountId || 'primary');
    }
  }, [prioritizedFleet, selectedUnitId, selectedUnitAccountId, fleetRows]);

  useEffect(() => {
    const detailRow = selectedFleetRow;
    if (!detailRow) return;
    if (!['fleet', 'temp-errors'].includes(activePanel)) return;
    loadUnitDetail(detailRow.accountId || 'primary', detailRow.id, false, 'merged', range).catch(() => {});
  }, [activePanel, selectedFleetRow?.id, selectedFleetRow?.accountId, range.startDate, range.endDate]);

  useEffect(() => {
    const detailRow = selectedFleetRow;
    if (!detailRow) return;
    if (!['fleet', 'temp-errors'].includes(activePanel)) return;
    const intervalMs = Math.max(30000, Number(status?.config?.pollIntervalSeconds || 60) * 1000);
    const timer = window.setInterval(() => {
      loadUnitDetail(detailRow.accountId || 'primary', detailRow.id, true, 'merged', range).catch(() => {});
      loadDashboard(false, true).catch(() => {});
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [activePanel, selectedFleetRow?.id, selectedFleetRow?.accountId, range.startDate, range.endDate, status?.config?.pollIntervalSeconds]);

  useEffect(() => {
    if (!expandedFleetRowKey) return;
    if (!prioritizedFleet.some((row) => unitRowKey(row) === expandedFleetRowKey)) {
      setExpandedFleetRowKey('');
    }
  }, [expandedFleetRowKey, prioritizedFleet]);

  useEffect(() => {
    tripMonitorPanels.forEach((panel) => {
      if (panel.detail?.rowId && !panel.historyDetail && !panel.historyBusy) {
        loadPanelHistory(panel.id, panel.detail, range).catch(() => {});
      }
    });
  }, [tripMonitorPanels.map((panel) => panel.detail?.rowId).join(','), range.startDate, range.endDate]);

  useEffect(() => {
    setSelectedAstroLocationIds((current) => {
      const next = current.filter((id) => astroLocations.some((location) => location.id === id));
      if (next.length === current.length && next.every((id, index) => id === current[index])) {
        return current;
      }
      return next;
    });
  }, [astroLocations]);

  useEffect(() => {
    setSelectedAstroRouteIds((current) => {
      const next = current.filter((id) => astroRoutes.some((route) => route.id === id));
      if (next.length === current.length && next.every((id, index) => id === current[index])) {
        return current;
      }
      return next;
    });
  }, [astroRoutes]);
  const stableRenderTemperatureChart = useCallback((props) => <TemperatureChart {...props} />, []);
  const stableRenderUnitRouteMap = useCallback((props) => <UnitRouteMap {...props} />, []);

  const loadDashboard = async (syncConfig = false, quiet = false) => {
    if (dashboardAbortRef.current) dashboardAbortRef.current.abort();
    const controller = new AbortController();
    dashboardAbortRef.current = controller;
    if (!quiet) startBusy();
    try {
      const query = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
      const nextStatus = await api('/api/status', { signal: controller.signal });
      if (!nextStatus.webAuth?.sessionUser) {
        startTransition(() => {
          setStatus(nextStatus);
          setReport(null);
          setApiMonitor(null);
          setWebSessionUser(null);
          setRemoteResetLogs([]);
          if (syncConfig || !loaded) {
            setLoaded(true);
          }
        });
        return;
      }

      const [nextReport, nextMonitor] = await Promise.all([api(`/api/report?${query.toString()}`, { signal: controller.signal }), api('/api/monitor', { signal: controller.signal })]);
      startTransition(() => {
        const nextActiveAccountId = nextStatus.config?.activeAccountId || 'primary';
        setStatus(nextStatus);
        setReport(nextReport);
        setApiMonitor(nextMonitor);
        setWebSessionUser(nextStatus.webAuth?.sessionUser || null);
        if (syncConfig || !loaded) {
          setActiveAccountId(nextActiveAccountId);
          setForm(formFromConfig(nextStatus.config, nextActiveAccountId));
          setRemoteResetForm(remoteResetFormFromConfig(nextStatus.config));
          setTmsForm(tmsFormFromConfig(nextStatus.config));
          setLoaded(true);
        }
        setAuthModal((current) => current.open ? { open: false, message: '' } : current);
        if (!stopForm.unitId && nextStatus.fleet?.rows?.length) {
          setStopForm((current) => ({ ...current, accountId: nextStatus.fleet.rows[0].accountId || 'primary', unitId: nextStatus.fleet.rows[0].id }));
        }
        if (!quiet && nextStatus.webAuth?.sessionUser) setBanner({ tone: 'success', message: 'Dashboard diperbarui.' });
      });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      throw error;
    } finally {
      if (!quiet) stopBusy();
      if (dashboardAbortRef.current === controller) dashboardAbortRef.current = null;
    }
  };

  const loadAdminUsers = async (quiet = false) => {
    if (!isAdmin) return;
    if (!quiet) startBusy();
    try {
      const payload = await api('/api/admin/users');
      startTransition(() => {
        setWebUsers(payload.users || []);
      });
    } finally {
      if (!quiet) stopBusy();
    }
  };

  const loadAdminDatabase = async (quiet = false) => {
    if (!isAdmin) return;
    if (!quiet) startBusy('Mengambil database tools...');
    try {
      const payload = await api('/api/admin/db');
      startTransition(() => {
        setAdminStorageProvider(payload.storageProvider || 'local-bootstrap');
        setAdminTempRollups(payload.rollups || []);
        setAdminPodSnapshots(payload.podSnapshots || []);
      });
    } finally {
      if (!quiet) stopBusy();
    }
  };

  const loadRemoteResetLogs = async (quiet = false) => {
    if (!isAdmin) return;
    if (!quiet) startBusy('Mengambil remote reset logs...');
    try {
      const payload = await api('/api/admin/remote-reset/logs');
      startTransition(() => {
        setRemoteResetLogs(payload.logs || []);
      });
    } finally {
      if (!quiet) stopBusy();
    }
  };

  const loadAstroSnapshotLogs = async (quiet = false) => {
    if (!quiet) setAstroSnapshotLogsBusy(true);
    try {
      const payload = await api('/api/astro/snapshots/logs');
      startTransition(() => {
        setAstroSnapshotLogs(payload.logs || []);
        setAstroSnapshotAutoSync(payload.autoSync || null);
      });
    } catch (e) {
      if (!quiet) setBanner({ tone: 'error', message: `Gagal load snapshot logs: ${e.message}` });
    } finally {
      setAstroSnapshotLogsBusy(false);
    }
  };

  const loadTmsLogs = async (quiet = false) => {
    if (!quiet) setTmsLogsBusy(true);
    try {
      const payload = await api('/api/tms/logs?limit=30');
      startTransition(() => {
        setTmsLogs(payload.logs || []);
      });
    } catch (error) {
      if (!quiet) setBanner({ tone: 'error', message: error.message || 'Gagal load TMS logs.' });
    } finally {
      setTmsLogsBusy(false);
    }
  };

  const loadTripMonitorBoard = async (quiet = false) => {
    const requestId = tripMonitorBoardRequestRef.current + 1;
    tripMonitorBoardRequestRef.current = requestId;
    if (!quiet) setTripMonitorBusy(true);
    try {
      const payload = await api('/api/tms/board');
      if (tripMonitorBoardRequestRef.current !== requestId) {
        return payload;
      }
      startTransition(() => {
        setTripMonitorBoard({ rows: payload.rows || [], summary: payload.summary || null });
      });
      return payload;
    } catch (error) {
      if (tripMonitorBoardRequestRef.current !== requestId) {
        throw error;
      }
      if (!quiet) setBanner({ tone: 'error', message: error.message || 'Trip Monitor gagal dimuat.' });
      throw error;
    } finally {
      if (tripMonitorBoardRequestRef.current === requestId) {
        setTripMonitorBusy(false);
      }
    }
  };

  const refreshTripMonitorBoard = async () => {
    await Promise.all([
      loadTripMonitorBoard(false),
      loadTmsLogs(true),
    ]);
  };
  const saveTmsConfig = async () => {
    startBusy('Menyimpan config TMS...');
    try {
      await api('/api/tms/config', {
        method: 'POST',
        body: JSON.stringify({
          tenantLabel: tmsForm.tenantLabel,
          baseUrl: tmsForm.baseUrl,
          username: tmsForm.username,
          password: tmsForm.password,
          autoSync: Boolean(tmsForm.autoSync),
          syncIntervalMinutes: Number(tmsForm.syncIntervalMinutes || 15),
          geofenceRadiusMeters: Number(tmsForm.geofenceRadiusMeters || 250),
          longStopMinutes: Number(tmsForm.longStopMinutes || 45),
          appStagnantMinutes: Number(tmsForm.appStagnantMinutes || 45),
        }),
      });
      await loadDashboard(true, true);
      startTransition(() => {
        setTmsForm((current) => ({ ...current, password: '' }));
        setBanner({ tone: 'success', message: 'Config TMS tersimpan.' });
      });
    } finally {
      stopBusy();
    }
  };

  const loginWithTms = async () => {
    startBusy('Menyambungkan akun TMS...');
    try {
      await api('/api/tms/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          tenantLabel: tmsForm.tenantLabel,
          baseUrl: tmsForm.baseUrl,
          username: tmsForm.username,
          password: tmsForm.password,
        }),
      });
      await loadDashboard(true, true);
      await loadTmsLogs(true);
      startTransition(() => {
        setTmsForm((current) => ({ ...current, password: '' }));
        setBanner({ tone: 'success', message: 'Login TMS berhasil.' });
      });
    } catch (error) {
      setBanner({ tone: 'error', message: error.message || 'Login TMS gagal.' });
    } finally {
      stopBusy();
    }
  };

  const logoutTms = async () => {
    startBusy('Memutuskan sesi TMS...');
    try {
      await api('/api/tms/auth/logout', { method: 'POST', body: JSON.stringify({}) });
      await loadDashboard(true, true);
      startTransition(() => {
        setBanner({ tone: 'success', message: 'Sesi TMS dihapus.' });
      });
    } finally {
      stopBusy();
    }
  };

  const triggerTmsSync = async () => {
    startBusy('Menjalankan sync TMS...');
    try {
      const payload = await api('/api/tms/sync', { method: 'POST', body: JSON.stringify({}) });
      await Promise.all([loadTripMonitorBoard(true), loadTmsLogs(true), loadDashboard(false, true)]);
      setBanner({ tone: 'success', message: payload.result?.message || 'Sync TMS selesai.' });
    } catch (error) {
      setBanner({ tone: 'error', message: error.message || 'Sync TMS gagal.' });
    } finally {
      stopBusy();
    }
  };

  const closeTripMonitorDetail = (panelId) => {
    if (panelId) {
      setTripMonitorPanels((current) => current.filter((panel) => panel.id !== panelId));
      return;
    }
    setTripMonitorPanels([]);
  };

  const loadPanelHistory = async (panelId, detail, rangeOverride = null) => {
    const fleetRow = resolveTripMonitorFleetRow(detail);
    const fallbackRange = deriveTripMonitorHistoryRange(detail);
    const requestedRange = rangeOverride || range || fallbackRange;
    const resolvedRange = {
      startDate: normalizeInputDayValue(requestedRange?.startDate || '', fallbackRange.startDate),
      endDate: normalizeInputDayValue(requestedRange?.endDate || '', fallbackRange.endDate),
    };
    setTripMonitorPanels((current) => current.map((panel) => panel.id === panelId ? { ...panel, historyRange: resolvedRange, historyDetail: null, historyBusy: true } : panel));
    if (!fleetRow?.id) {
      setTripMonitorPanels((current) => current.map((panel) => panel.id === panelId ? { ...panel, historyDetail: { unit: { id: detail?.unitId || '' }, records: [], incidents: [], geofenceEvents: [] }, historyBusy: false } : panel));
      return;
    }
    try {
      const query = new URLSearchParams({ accountId: fleetRow.accountId || 'primary', unitId: fleetRow.id, startDate: resolvedRange.startDate, endDate: resolvedRange.endDate, source: 'remote' });
      const payload = await api(`/api/unit-history?${query.toString()}`);
      if (payload.remoteError) setBanner({ tone: 'warning', message: `Data tidak lengkap. Error: ${payload.remoteError}` });
      setTripMonitorPanels((current) => current.map((panel) => panel.id === panelId ? { ...panel, historyDetail: payload, historyBusy: false } : panel));
    } catch (error) {
      setTripMonitorPanels((current) => current.map((panel) => panel.id === panelId ? { ...panel, historyDetail: { unit: { id: fleetRow.id }, records: [], incidents: [], geofenceEvents: [] }, historyBusy: false } : panel));
      setBanner({ tone: 'error', message: error.message || 'Historical Trip Monitor gagal diambil.' });
    }
  };

  const openTripMonitorDetail = async (rowId) => {
    if (!rowId) return;
    const existing = tripMonitorPanels.find((panel) => panel.rowId === rowId);
    if (existing) {
      const nextZ = tripMonitorNextZRef.current++;
      setTripMonitorPanels((current) => current.map((panel) => panel.id === existing.id ? { ...panel, zIndex: nextZ } : panel));
      return;
    }
    if (tripMonitorPanels.length >= 5) {
      setBanner({ tone: 'warning', message: 'Max 5 panel terbuka. Tutup salah satu dulu.' });
      return;
    }
    const cascadeOffset = tripMonitorPanels.length * 30;
    const panelId = `tm-panel-${rowId}`;
    const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
    const newPanel = {
      id: panelId,
      rowId,
      detail: null,
      detailBusy: true,
      historyDetail: null,
      historyBusy: false,
      historyRange: { startDate: '', endDate: '' },
      position: {
        x: Math.max(0, Math.min(viewportWidth - 520, 200 + cascadeOffset)),
        y: Math.max(0, Math.min(viewportHeight - 640, 60 + cascadeOffset)),
      },
      size: { width: 480, height: 600 },
      zIndex: tripMonitorNextZRef.current++,
    };
    setTripMonitorPanels((current) => [...current, newPanel]);
    try {
      const payload = await api(`/api/tms/board/detail?${new URLSearchParams({ rowId }).toString()}`);
      const detail = payload.detail || null;
      setTripMonitorPanels((current) => current.map((panel) => panel.id === panelId ? { ...panel, detail, detailBusy: false } : panel));
    } catch (error) {
      setBanner({ tone: 'error', message: error.message || 'Detail Trip Monitor gagal diambil.' });
      setTripMonitorPanels((current) => current.filter((panel) => panel.id !== panelId));
    }
  };

  const triggerAstroSnapshotSync = async () => {
    startBusy('Menjalankan Astro snapshot sync...');
    try {
      const result = await api('/api/astro/snapshots/sync', {
        method: 'POST',
        body: JSON.stringify({ skipExistingDays: true }),
      });
      setBanner({
        tone: 'success',
        message: `Sync selesai: ${result.snapshotsSaved || 0} row snapshot, ${result.processedDays || 0} hari diproses, ${result.skippedDays || 0} hari di-skip, ${result.eligibleUnitCount || 0} unit eligible KPI.`
      });
      await loadAstroSnapshotLogs(true);
    } catch (e) {
      setBanner({ tone: 'error', message: `Sync gagal: ${e.message}` });
    } finally {
      stopBusy();
    }
  };

  const toggleRemoteResetAccount = (accountId) => {
    setRemoteResetForm((current) => {
      const selected = new Set(current.selectedAccountIds || []);
      if (selected.has(accountId)) {
        selected.delete(accountId);
      } else {
        selected.add(accountId);
      }
      return {
        ...current,
        selectedAccountIds: [...selected],
      };
    });
  };

  const runRemoteResetNow = async () => {
    startBusy('Menjalankan remote CPU reset...');
    try {
      const payload = await api('/api/admin/remote-reset/run', { method: 'POST', body: JSON.stringify({}) });
      startTransition(() => {
        setRemoteResetLogs(payload.logs || []);
        if (payload.status) {
          setStatus(payload.status);
          setWebSessionUser(payload.status.webAuth?.sessionUser || webSessionUser);
        }
        setBanner({ tone: 'success', message: payload.remoteReset?.lastRunMessage || 'Remote CPU reset dijalankan.' });
      });
    } catch (error) {
      setBanner({ tone: 'error', message: error.message || 'Remote CPU reset gagal dijalankan.' });
    } finally {
      stopBusy();
    }
  };
  const loginToWeb = async () => {
    startBusy('Mencoba login dashboard...');
    try {
      const payload = await api('/api/web-auth/login', {
        method: 'POST',
        body: JSON.stringify(webLoginForm),
      });
      startTransition(() => {
        setWebSessionUser(payload.user || null);
        setBanner({ tone: 'success', message: `Welcome ${payload.user?.displayName || payload.user?.username || ''}`.trim() });
        setAuthModal({ open: false, message: '' });
      });
      await loadDashboard(true, true);
      if ((payload.user?.role || '') === 'admin') {
        await loadAdminUsers(true).catch(() => {});
      }
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Login gagal. Periksa username dan password.' });
      setBanner({ tone: 'error', message: error.message || 'Login gagal.' });
    } finally {
      stopBusy();
    }
  };

  const logoutWeb = async () => {
    startBusy();
    try {
      await api('/api/web-auth/logout', { method: 'POST', body: JSON.stringify({}) });
      startTransition(() => {
        setWebSessionUser(null);
        setWebUsers([]);
        setActivePanel('overview');
        setBanner({ tone: 'success', message: 'Berhasil logout dari dashboard.' });
      });
    } finally {
      stopBusy();
    }
  };

  const loadUnitDetail = async (accountId, unitId, quiet = false, source = 'merged', rangeOverride = null) => {
    if (!unitId) return;
    if (!quiet) setDetailBusy(true);
    try {
      const detailRange = rangeOverride || range;
      const query = new URLSearchParams({ accountId: accountId || 'primary', unitId, startDate: detailRange.startDate, endDate: detailRange.endDate });
      if (source === 'remote') query.set('source', 'remote');
      const payload = await api(`/api/unit-history?${query.toString()}`);
      startTransition(() => {
        if (payload.remoteError) setBanner({ tone: 'warning', message: `Data tidak lengkap. Error: ${payload.remoteError}` });
        setUnitDetail(payload);
        setSelectedUnitId(unitId);
        setSelectedUnitAccountId(accountId || 'primary');
      });
    } catch (error) {
      startTransition(() => {
        setUnitDetail({ unit: { id: unitId }, records: [], incidents: [] });
        setBanner({ tone: 'error', message: error.message });
      });
    }
    if (!quiet) setDetailBusy(false);
  };

  const loadHistoricalDetail = async (accountId, unitId, rangeOverride = null, quiet = false) => {
    if (!unitId) return;
    if (!quiet) setHistoricalDetailBusy(true);
    try {
      const detailRange = rangeOverride || historicalRangeDraft;
      const query = new URLSearchParams({ accountId: accountId || 'primary', unitId, startDate: detailRange.startDate, endDate: detailRange.endDate, source: 'remote' });
      const payload = await api(`/api/unit-history?${query.toString()}`);
      startTransition(() => {
        if (payload.remoteError) setBanner({ tone: 'warning', message: `Data tidak lengkap. Error: ${payload.remoteError}` });
        setHistoricalDetail(payload);
        setHistoricalAppliedSelection({ accountId: accountId || 'primary', unitId });
        setHistoricalRangeApplied({ ...detailRange });
        setSelectedUnitId(unitId);
        setSelectedUnitAccountId(accountId || 'primary');
      });
    } catch (error) {
      startTransition(() => {
        setHistoricalDetail({ unit: { id: unitId }, records: [], incidents: [], geofenceEvents: [] });
        setHistoricalAppliedSelection({ accountId: accountId || 'primary', unitId });
        setHistoricalRangeApplied({ ...(rangeOverride || historicalRangeDraft) });
        setBanner({ tone: 'error', message: error.message });
      });
    }
    if (!quiet) setHistoricalDetailBusy(false);
  };
  const saveConfig = async (keepBanner = false) => {
    startBusy('Menyimpan config...');
    try {
      const payload = {
        activeAccountId, solofleetBaseUrl: form.baseUrl.trim(), endpointPath: form.endpointPath.trim(), refererPath: form.refererPath.trim(), vehiclePagePath: form.vehiclePagePath.trim(), discoveryEndpointPath: form.discoveryEndpointPath.trim(), vehicleRoleId: form.vehicleRoleId.trim(), units: parseUnits(form.unitsText), customerProfiles: parseCustomerProfiles(form.customerProfilesText), podSites: parsePodSites(form.podSitesText), pollIntervalSeconds: Number(form.pollIntervalSeconds || 60), requestLookbackMinutes: Number(form.requestLookbackMinutes || 30), requestIntervalSeconds: Number(form.requestIntervalSeconds || 120), historyRetentionDays: Number(form.historyRetentionDays || 7), minDurationMinutes: Number(form.minDurationMinutes || 5), maxGapMinutes: form.maxGapMinutes === '' ? null : Number(form.maxGapMinutes), archiveType: form.archiveType.trim(), tempProfile: form.tempProfile.trim(), temperatureProcessing: form.temperatureProcessing.trim(), autoStart: Boolean(form.autoStart),
        remoteResetAutomation: {
          enabled: Boolean(remoteResetForm.enabled),
          intervalHours: 3,
          selectedAccountIds: remoteResetForm.selectedAccountIds || [],
          tempErrorOnly: true,
          maxUnitsPerRun: 10,
          requestSpacingSeconds: 3,
          onlyWhenPollingActive: true,
        },      };
      if (form.sessionCookie.trim()) payload.sessionCookie = form.sessionCookie.trim();
      const result = await api('/api/config', { method: 'POST', body: JSON.stringify(payload) });
      startTransition(() => {
        const nextActive = result.config.activeAccountId || activeAccountId;
        setActiveAccountId(nextActive);
        setForm(formFromConfig(result.config, nextActive));
        setRemoteResetForm(remoteResetFormFromConfig(result.config));
        if (!keepBanner) setBanner({ tone: 'success', message: 'Config saved.' });
      });
      await loadDashboard(false, true);
    } finally {
      stopBusy();
    }
  };
  const loginWithSolofleet = async (mode = 'primary') => {
    startBusy();
    try {
      setAuthModal({ open: false, message: '' });
      const accountId = mode === 'linked' ? makeAccountId(accountLoginForm.label || accountLoginForm.email) : 'primary';
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ ...accountLoginForm, accountId, label: accountLoginForm.label || accountLoginForm.email }),
      });
      startTransition(() => {
        const nextActive = mode === 'linked' ? accountId : 'primary';
        setActiveAccountId(nextActive);
        setForm(formFromConfig(result.config, nextActive));
        setAccountLoginForm((current) => ({ ...current, password: '' }));
        setBanner({ tone: 'success', message: mode === 'linked' ? 'Linked Solofleet account added.' : 'Logged in to Solofleet.' });
        setAuthModal({ open: false, message: '' });
      });
      await loadDashboard(true, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Login Solofleet gagal. Periksa email dan password.' });
      setBanner({ tone: 'error', message: error.message || 'Login Solofleet gagal.' });
    } finally {
      stopBusy();
    }
  };

  const logoutAccount = async (accountId = activeAccountId) => {
    startBusy();
    try {
      const result = await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ accountId }) });
      startTransition(() => {
        const nextActive = result.config.activeAccountId || 'primary';
        setActiveAccountId(nextActive);
        setForm(formFromConfig(result.config, nextActive));
        setUnitDetail(null);
        setReport(null);
        setStopReport(null);
        setBanner({ tone: 'success', message: accountId === 'primary' ? 'Primary account logged out.' : 'Linked account removed.' });
      });
      await loadDashboard(true, true).catch(() => {});
    } finally {
      stopBusy();
    }
  };

  const saveWebUserEntry = async () => {
    startBusy();
    try {
      const payload = await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(webUserForm),
      });
      startTransition(() => {
        setWebUsers(payload.users || []);
        setWebUserForm(EMPTY_WEB_USER_FORM);
        setBanner({ tone: 'success', message: 'Web user saved.' });
      });
    } finally {
      stopBusy();
    }
  };

  const deleteWebUserEntry = async (userId) => {
    startBusy();
    try {
      const payload = await api(`/api/admin/users?id=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      startTransition(() => {
        setWebUsers(payload.users || []);
        if (webUserForm.id === userId) setWebUserForm(EMPTY_WEB_USER_FORM);
        setBanner({ tone: 'success', message: 'Web user deleted.' });
      });
    } finally {
      stopBusy();
    }
  };

  const editAdminRollup = (row) => {
    setAdminRollupForm({
      id: row.id || '',
      day: row.day || today(0),
      accountId: row.accountId || 'primary',
      accountLabel: row.accountLabel || '',
      unitId: row.unitId || '',
      unitLabel: row.unitLabel || '',
      vehicle: row.vehicle || '',
      type: row.type || 'temp1',
      label: row.label || '',
      incidents: String(row.incidents ?? '0'),
      temp1Incidents: String(row.temp1Incidents ?? '0'),
      temp2Incidents: String(row.temp2Incidents ?? '0'),
      bothIncidents: String(row.bothIncidents ?? '0'),
      firstStartTimestamp: toDateTimeLocalInput(row.firstStartTimestamp),
      lastEndTimestamp: toDateTimeLocalInput(row.lastEndTimestamp),
      durationMinutes: String(row.durationMinutes ?? '0'),
      totalMinutes: String(row.totalMinutes ?? '0'),
      longestMinutes: String(row.longestMinutes ?? '0'),
      temp1Min: row.temp1Min ?? '',
      temp1Max: row.temp1Max ?? '',
      temp2Min: row.temp2Min ?? '',
      temp2Max: row.temp2Max ?? '',
      minSpeed: row.minSpeed ?? '',
      maxSpeed: row.maxSpeed ?? '',
      latitude: row.latitude ?? '',
      longitude: row.longitude ?? '',
      locationSummary: row.locationSummary || '',
      zoneName: row.zoneName || '',
    });
  };

  const saveAdminRollupEntry = async () => {
    startBusy('Menyimpan temp rollup...');
    try {
      const payload = await api('/api/admin/db/rollups', {
        method: 'POST',
        body: JSON.stringify(adminRollupForm),
      });
      startTransition(() => {
        setAdminStorageProvider(payload.storageProvider || adminStorageProvider);
        setAdminTempRollups(payload.rollups || []);
        setAdminRollupForm(EMPTY_ADMIN_ROLLUP_FORM);
        setBanner({ tone: 'success', message: 'Temp rollup saved.' });
      });
    } finally {
      stopBusy();
    }
  };

  const deleteAdminRollupEntry = async (id) => {
    startBusy('Menghapus temp rollup...');
    try {
      const payload = await api(`/api/admin/db/rollups?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      startTransition(() => {
        setAdminStorageProvider(payload.storageProvider || adminStorageProvider);
        setAdminTempRollups(payload.rollups || []);
        if (adminRollupForm.id === id) setAdminRollupForm(EMPTY_ADMIN_ROLLUP_FORM);
        setBanner({ tone: 'success', message: 'Temp rollup deleted.' });
      });
    } finally {
      stopBusy();
    }
  };

  const editAdminPodSnapshot = (row) => {
    setAdminPodForm({
      id: row.id || '',
      day: row.day || today(0),
      timestamp: toDateTimeLocalInput(row.timestamp),
      time: row.time || '',
      unitId: row.unitId || '',
      unitLabel: row.unitLabel || '',
      customerName: row.customerName || '',
      podId: row.podId || '',
      podName: row.podName || '',
      latitude: row.latitude ?? '',
      longitude: row.longitude ?? '',
      speed: row.speed ?? '',
      distanceMeters: row.distanceMeters ?? '',
      locationSummary: row.locationSummary || '',
    });
  };

  const saveAdminPodEntry = async () => {
    startBusy('Menyimpan POD snapshot...');
    try {
      const payload = await api('/api/admin/db/pod-snapshots', {
        method: 'POST',
        body: JSON.stringify(adminPodForm),
      });
      startTransition(() => {
        setAdminStorageProvider(payload.storageProvider || adminStorageProvider);
        setAdminPodSnapshots(payload.podSnapshots || []);
        setAdminPodForm(EMPTY_ADMIN_POD_FORM);
        setBanner({ tone: 'success', message: 'POD snapshot saved.' });
      });
    } finally {
      stopBusy();
    }
  };

  const deleteAdminPodEntry = async (id) => {
    startBusy('Menghapus POD snapshot...');
    try {
      const payload = await api(`/api/admin/db/pod-snapshots?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      startTransition(() => {
        setAdminStorageProvider(payload.storageProvider || adminStorageProvider);
        setAdminPodSnapshots(payload.podSnapshots || []);
        if (adminPodForm.id === id) setAdminPodForm(EMPTY_ADMIN_POD_FORM);
        setBanner({ tone: 'success', message: 'POD snapshot deleted.' });
      });
    } finally {
      stopBusy();
    }
  };

  useEffect(() => {
    if (activePanel === 'admin' && isAdmin) {
      loadAdminUsers(true).catch((error) => setBanner({ tone: 'error', message: error.message }));
      loadAdminDatabase(true).catch((error) => setBanner({ tone: 'error', message: error.message }));
    }
  }, [activePanel, isAdmin]);
  useEffect(() => {
    if (activePanel === 'config' && isAdmin) {
      loadRemoteResetLogs(true).catch((error) => setBanner({ tone: 'error', message: error.message }));
    }
  }, [activePanel, isAdmin]);
  useEffect(() => {
    if (!isAdmin && (activePanel === 'config' || activePanel === 'admin')) {
      setActivePanel('overview');
    }
  }, [activePanel, isAdmin]);

  useEffect(() => {
    setMobileNavOpen(false);
    if (compactTopbar) {
      setMobileTopbarExpanded(false);
    }
  }, [activePanel, compactTopbar]);

  // Auto-compact topbar on narrow viewports, auto-close mobile nav on wide viewports
  useEffect(() => {
    const mobileNavMedia = window.matchMedia('(max-width: 960px)');
    const compactTopbarMedia = window.matchMedia('(max-width: 1700px)');
    const syncLayout = () => {
      const nextCompactTopbar = compactTopbarMedia.matches;
      const nextMobileNav = mobileNavMedia.matches;
      setCompactTopbar(nextCompactTopbar);
      if (!nextMobileNav) {
        setMobileNavOpen(false);
      }
      setMobileTopbarExpanded(false);
    };
    syncLayout();
    mobileNavMedia.addEventListener?.('change', syncLayout);
    compactTopbarMedia.addEventListener?.('change', syncLayout);
    return () => {
      mobileNavMedia.removeEventListener?.('change', syncLayout);
      compactTopbarMedia.removeEventListener?.('change', syncLayout);
    };
  }, []);

  const discoverUnits = async (targetAccountId = activeAccountId) => {
    const resolvedAccountId = targetAccountId || activeAccountId;
    if (resolvedAccountId === activeAccountId) {
      await saveConfig(true);
    }
    startBusy();
    try {
      setAuthModal({ open: false, message: '' });
      const result = await api('/api/discover/units', { method: 'POST', body: JSON.stringify({ accountId: resolvedAccountId }) });
      startTransition(() => {
        setActiveAccountId(resolvedAccountId);
        setForm(formFromConfig(result.config, resolvedAccountId));
        setBanner({ tone: 'success', message: `Discovered ${result.units.length} units from Solofleet.` });
      });
      await loadDashboard(false, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Discover unit gagal.' });
      setBanner({ tone: 'error', message: error.message || 'Discover unit gagal.' });
    } finally {
      stopBusy();
    }
  };

  const updateConfiguredUnits = (updater) => {
    setForm((current) => {
      const currentUnits = parseUnits(current.unitsText);
      const nextUnits = typeof updater === 'function' ? updater(currentUnits) : updater;
      return {
        ...current,
        unitsText: unitsToText(nextUnits),
      };
    });
  };

  const updateConfiguredUnitCategory = (unitId, category) => {
    updateConfiguredUnits((units) => units.map((unit) => unit.id === unitId
      ? { ...unit, category: normalizeUnitCategory(category) }
      : unit));
  };

  const toggleConfiguredUnitSelection = (unitId) => {
    setSelectedUnitCategoryIds((current) => current.includes(unitId)
      ? current.filter((id) => id !== unitId)
      : [...current, unitId]);
  };

  const selectVisibleConfiguredUnits = () => {
    setSelectedUnitCategoryIds(filteredConfiguredUnits.map((unit) => unit.id));
  };

  const clearConfiguredUnitSelection = () => {
    setSelectedUnitCategoryIds([]);
  };

  const applyCategoryToSelectedUnits = () => {
    if (!selectedUnitCategoryIds.length) {
      setBanner({ tone: 'info', message: 'Pilih unit dulu untuk bulk category update.' });
      return;
    }
    const selectedIdSet = new Set(selectedUnitCategoryIds);
    updateConfiguredUnits((units) => units.map((unit) => selectedIdSet.has(unit.id)
      ? { ...unit, category: normalizeUnitCategory(unitCategoryBulkValue) }
      : unit));
    setBanner({ tone: 'success', message: `Updated category untuk ${selectedUnitCategoryIds.length} unit.` });
  };

  const loadUnitCategoryCsvFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const textValue = await file.text();
    setUnitCategoryCsvText(textValue);
  };

  const downloadUnitCategoryCsvTemplate = () => {
    const rows = configuredUnits.length
      ? configuredUnits.map((unit) => ({
        label: unit.label || unit.id,
        unitId: unit.id,
        category: normalizeUnitCategory(unit.category),
      }))
      : [{ label: 'B 1234 XYZ', unitId: 'COL56', category: 'dedicated-astro' }];
    csv(`unit-category-template-${activeAccountId || 'primary'}.csv`, rows);
  };

  const importUnitCategoryCsv = () => {
    if (!unitCategoryCsvText.trim()) {
      setBanner({ tone: 'info', message: 'Paste CSV category dulu sebelum import.' });
      return;
    }

    const lines = String(unitCategoryCsvText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      setBanner({ tone: 'info', message: 'CSV category kosong.' });
      return;
    }

    const configuredById = new Map(configuredUnits.map((unit) => [String(unit.id || ''), unit]));
    const configuredByLabel = new Map(configuredUnits.map((unit) => [normalizeUnitLookupKey(unit.label || unit.id), unit]));
    const accountIds = new Set(availableAccounts.map((account) => account.id));
    const parseCsvParts = (line) => line.split(',').map((part) => part.trim());
    const firstParts = parseCsvParts(lines[0]);
    const headerAliases = { account: 'accountId', accountid: 'accountId', unit: 'unitId', unitid: 'unitId', label: 'label', nopol: 'label', category: 'category' };
    const headerMap = {};
    firstParts.forEach((part, index) => {
      const key = headerAliases[String(part || '').trim().toLowerCase()];
      if (key && headerMap[key] === undefined) {
        headerMap[key] = index;
      }
    });
    const hasHeader = Object.keys(headerMap).length > 0 && headerMap.category !== undefined;
    const rows = [];
    let skippedMissingMatch = 0;
    let skippedOtherAccount = 0;

    lines.forEach((line, index) => {
      if (hasHeader && index === 0) return;
      const parts = parseCsvParts(line);
      if (!parts.length) return;
      if (!hasHeader && index === 0 && parts.some((part) => /unit|category|account|label|nopol/i.test(part))) return;

      let accountId = activeAccountId;
      let unitId = '';
      let label = '';
      let category = 'uncategorized';

      if (hasHeader) {
        accountId = parts[headerMap.accountId] || activeAccountId;
        unitId = parts[headerMap.unitId] || '';
        label = parts[headerMap.label] || '';
        category = parts[headerMap.category] || 'uncategorized';
      } else if (parts.length >= 4) {
        accountId = parts[0] || activeAccountId;
        unitId = parts[1] || '';
        label = parts[2] || '';
        category = parts[3] || 'uncategorized';
      } else if (parts.length === 3) {
        if (accountIds.has(parts[0])) {
          accountId = parts[0] || activeAccountId;
          unitId = parts[1] || '';
          category = parts[2] || 'uncategorized';
        } else {
          unitId = parts[0] || '';
          label = parts[1] || '';
          category = parts[2] || 'uncategorized';
        }
      } else if (parts.length === 2) {
        const identifier = parts[0] || '';
        category = parts[1] || 'uncategorized';
        const matchedUnit = configuredById.get(identifier) || configuredByLabel.get(normalizeUnitLookupKey(identifier));
        if (matchedUnit) {
          unitId = matchedUnit.id;
          label = matchedUnit.label || matchedUnit.id;
        } else {
          label = identifier;
        }
      }

      if (accountId !== activeAccountId) {
        skippedOtherAccount += 1;
        return;
      }

      if (!unitId && label) {
        const matchedUnit = configuredByLabel.get(normalizeUnitLookupKey(label));
        if (matchedUnit) {
          unitId = matchedUnit.id;
          label = matchedUnit.label || matchedUnit.id;
        }
      }

      if (!unitId) {
        skippedMissingMatch += 1;
        return;
      }

      rows.push({
        unitId,
        label,
        category: normalizeUnitCategory(category),
      });
    });

    if (!rows.length) {
      setBanner({ tone: 'error', message: 'Tidak ada row CSV yang cocok untuk account aktif.' });
      return;
    }

    const csvMap = new Map(rows.map((row) => [row.unitId, row]));
    let updatedCount = 0;
    let addedCount = 0;
    updateConfiguredUnits((units) => {
      const nextUnits = units.map((unit) => {
        const csvRow = csvMap.get(unit.id);
        if (!csvRow) return unit;
        updatedCount += 1;
        csvMap.delete(unit.id);
        return {
          ...unit,
          label: csvRow.label || unit.label,
          category: csvRow.category,
        };
      });

      for (const csvRow of csvMap.values()) {
        nextUnits.push({
          id: csvRow.unitId,
          label: csvRow.label || csvRow.unitId,
          category: csvRow.category,
        });
        addedCount += 1;
      }

      return nextUnits.sort((left, right) => String(left.label || left.id).localeCompare(String(right.label || right.id)) || String(left.id).localeCompare(String(right.id)));
    });

    setUnitCategoryCsvText('');
    const notices = [];
    if (skippedMissingMatch) notices.push(`${skippedMissingMatch} row tanpa match unit`);
    if (skippedOtherAccount) notices.push(`${skippedOtherAccount} row account lain di-skip`);
    setBanner({ tone: 'success', message: `Imported category CSV. Updated ${updatedCount} unit, added ${addedCount} unit.${notices.length ? ` ${notices.join(' | ')}.` : ''}` });
  };
  const runPollNow = async () => {
    startBusy();
    try {
      await api('/api/poll/run', { method: 'POST', body: JSON.stringify({}) });
      await loadDashboard(false, true);
      setBanner({ tone: 'success', message: 'Manual polling finished.' });
    } finally {
      stopBusy();
    }
  };

  const togglePolling = async () => {
    if (!status?.runtime) return;
    startBusy();
    try {
      await api(status.runtime.isPolling ? '/api/poll/stop' : '/api/poll/start', { method: 'POST', body: JSON.stringify({}) });
      await loadDashboard(false, true);
      setBanner({ tone: 'success', message: status.runtime.isPolling ? 'Auto polling stopped.' : 'Auto polling started.' });
    } finally {
      stopBusy();
    }
  };

  const loadStopReport = async () => {
    if (!stopForm.unitId) return;
    startBusy();
    try {
      const query = new URLSearchParams({ accountId: stopForm.accountId || 'primary', unitId: stopForm.unitId, startDate: range.startDate, endDate: range.endDate, reportType: stopForm.reportType, minDuration: stopForm.minDuration, withTrack: 'withtrack' });
      const payload = await api(`/api/report/stop?${query.toString()}`);
      setStopReport(payload);
      setBanner({ tone: 'success', message: `Loaded ${payload.rows.length} stop/idle rows.` });
    } finally {
      stopBusy();
    }
  };

  const switchAccount = async (accountId) => {
    const nextAccountId = accountId || 'primary';
    if (nextAccountId === activeAccountId && status?.config?.activeAccountId === nextAccountId) {
      return;
    }
    try {
      const result = await api('/api/config', {
        method: 'POST',
        body: JSON.stringify({ activeAccountId: nextAccountId }),
      });
      startTransition(() => {
        const resolvedAccountId = result.config?.activeAccountId || nextAccountId;
        setActiveAccountId(resolvedAccountId);
        setStatus((current) => current ? { ...current, config: result.config } : current);
        setForm(formFromConfig(result.config, resolvedAccountId));
        setRemoteResetForm(remoteResetFormFromConfig(result.config));
        const firstAccountRow = fleetRows.find((row) => row.accountId === resolvedAccountId);
        if (firstAccountRow) {
          setStopForm((current) => ({ ...current, accountId: resolvedAccountId, unitId: firstAccountRow.id }));
        } else {
          setStopForm((current) => ({ ...current, accountId: resolvedAccountId }));
        }
      });
    } catch (error) {
      setBanner({ tone: 'error', message: error.message || 'Gagal mengganti active Solofleet account.' });
    }
  };

  const openUnit = (accountId, unitId, panel = 'fleet') => {
    setSelectedUnitAccountId(accountId || 'primary');
    setSelectedUnitId(unitId);
    setActivePanel(panel);
  };
  const toggleFleetGraph = (row) => {
    if (!row) return;
    const nextKey = unitRowKey(row);
    setSelectedUnitAccountId(row.accountId || 'primary');
    setSelectedUnitId(row.id);
    setActivePanel('fleet');
    setExpandedFleetRowKey((current) => current === nextKey ? '' : nextKey);
  };
  const resolveTripMonitorFleetRow = (row) => {
    const metadataFleetRow = row?.metadata?.fleetRow;
    if (metadataFleetRow?.id) {
      return fleetRows.find((fleetRow) => fleetRow.id === metadataFleetRow.id && (fleetRow.accountId || 'primary') === (metadataFleetRow.accountId || 'primary')) || metadataFleetRow;
    }
    const [unitAccountId, unitId] = String(row?.unitKey || '').split('::');
    if (unitId) {
      return fleetRows.find((fleetRow) => fleetRow.id === unitId && (fleetRow.accountId || 'primary') === (unitAccountId || 'primary')) || null;
    }
    if (row?.unitId) {
      return fleetRows.find((fleetRow) => fleetRow.id === row.unitId) || null;
    }
    return null;
  };
  const openTripMonitorInvestigation = (row, target = 'historical') => {
    const fleetRow = resolveTripMonitorFleetRow(row);
    if (!fleetRow?.id) {
      setBanner({ tone: 'error', message: 'Unit ini belum match ke Solofleet, jadi detail investigasi belum bisa dibuka.' });
      return;
    }
    if (target === 'fleet') {
      toggleFleetGraph(fleetRow);
      return;
    }
    if (target === 'map') {
      setSelectedUnitAccountId(fleetRow.accountId || 'primary');
      setSelectedUnitId(fleetRow.id);
      setMapAccountFilter(fleetRow.accountId || 'primary');
      setMapSearch(fleetRow.label || fleetRow.id || row?.unitLabel || row?.unitId || '');
      setActivePanel('map');
      return;
    }
    const nextRange = {
      startDate: normalizeInputDayValue(range.startDate),
      endDate: normalizeInputDayValue(range.endDate),
    };
    setHistoricalRangeDraft(nextRange);
    setSelectedUnitAccountId(fleetRow.accountId || 'primary');
    setSelectedUnitId(fleetRow.id);
    setActivePanel('historical');
    loadHistoricalDetail(fleetRow.accountId || 'primary', fleetRow.id, nextRange, false).catch(() => {});
  };
  const selectHistoricalUnit = (value) => {
    const [accountId, unitId] = String(value || '').split('::');
    if (!unitId) return;
    openUnit(accountId || 'primary', unitId, 'historical');
  };
  const pullHistoricalData = () => {
    if (!selectedHistoricalRow) return;
    loadHistoricalDetail(selectedHistoricalRow.accountId || 'primary', selectedHistoricalRow.id, historicalRangeDraft, false).catch(() => {});
  };
  const exportFleet = async () => runQuickBlockingAction('Menyiapkan Fleet CSV...', () => csv('solofleet-fleet-live.csv', prioritizedFleet.map((row) => ({ account_id: row.accountId, account_label: row.accountLabel, unit_id: row.id, label: row.label, alias: row.alias, unit_category: row.unitCategory, unit_category_label: row.unitCategoryLabel, group_name: row.group, speed: row.speed, live_temp1: row.liveTemp1, live_temp2: row.liveTemp2, temp_gap: row.liveTempDelta, sensor_error: row.errSensor, gps_error: row.errGps, location: row.locationSummary, zone_name: row.zoneName, latitude: row.latitude, longitude: row.longitude, last_updated_at: row.lastUpdatedAt }))));
  const exportAlerts = async () => runQuickBlockingAction('Menyiapkan Alerts CSV...', () => csv('solofleet-temp-alerts.csv', errorRows.map((row) => ({ account_id: row.accountId, account_label: row.accountLabel, error_date: row.day, start_time: row.startTime, end_time: row.endTime, duration_minutes: row.durationMinutes, incidents: row.incidents, unit_id: row.unitId, unit_label: row.unitLabel, type: row.label, temp1_min: row.temp1Min, temp1_max: row.temp1Max, temp2_min: row.temp2Min, temp2_max: row.temp2Max, speed_min: row.minSpeed, speed_max: row.maxSpeed, latitude: row.latitude, longitude: row.longitude, location: row.locationSummary }))));
  const exportStop = async () => runQuickBlockingAction('Menyiapkan Stop CSV...', () => csv('solofleet-stop-idle.csv', (stopReport?.rows || []).map((row) => ({ account_id: stopForm.accountId, account_label: accountName(availableAccounts.find((account) => account.id === stopForm.accountId)), unit_id: row.unitId, alias: row.alias, start_time: row.startTimestamp ? new Date(row.startTimestamp).toISOString() : '', end_time: row.endTimestamp ? new Date(row.endTimestamp).toISOString() : '', duration_minutes: row.durationMinutes, movement_distance_km: row.movementDistance, avg_temp: row.avgTemp, location: row.locationSummary, latitude: row.latitude, longitude: row.longitude, zone_name: row.zoneName, google_maps_url: row.googleMapsUrl }))));
  const historyTargetRow = historicalAppliedRow || selectedHistoricalRow || selectedFleetRow;
  const exportHistory = async () => {
    const unitPlate = String(historyTargetRow?.label || historyTargetRow?.alias || historyTargetRow?.id || selectedUnitId || 'Unit').trim() || 'Unit';
    const rangeLabel = `${historicalRangeApplied.startDate} to ${historicalRangeApplied.endDate}`;
    const fileName = `Historical Temperature ${rangeLabel} ${unitPlate}.csv`;
    await runQuickBlockingAction('Menyiapkan Historical CSV...', () => csv(fileName, (historicalDetail?.records || []).map((row) => ({ account_id: historyTargetRow?.accountId || selectedUnitAccountId, account_label: historyTargetRow?.accountLabel || accountName(availableAccounts.find((account) => account.id === (historyTargetRow?.accountId || selectedUnitAccountId)) || currentAccount), unit_id: historyTargetRow?.id || selectedUnitId, timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : '', speed: row.speed, temp1: row.temp1, temp2: row.temp2, location: row.locationSummary, latitude: row.latitude, longitude: row.longitude, power_supply: row.powerSupply, zone_name: row.zoneName }))));
  };
  const exportCompile = async () => runQuickBlockingAction('Menyiapkan Compile CSV...', () => csv('solofleet-compile-by-unit-day.csv', errorUnitsSummary.map((row) => ({ day: row.day, account_id: row.accountId, account_label: row.accountLabel, unit_id: row.unitId, unit_label: row.unitLabel, incidents: row.incidents, temp1_incidents: row.temp1Incidents, temp2_incidents: row.temp2Incidents, both_incidents: row.bothIncidents, total_minutes: row.totalMinutes, longest_minutes: row.longestMinutes }))));
  const exportPods = async () => runQuickBlockingAction('Menyiapkan POD CSV...', () => csv('solofleet-pod-snapshots.csv', podRows.map((row) => ({ account_id: row.accountId, account_label: row.accountLabel, day: row.day, time: row.time, unit_id: row.unitId, unit_label: row.unitLabel, customer_name: row.customerName, pod_name: row.podName, distance_meters: row.distanceMeters, speed: row.speed, latitude: row.latitude, longitude: row.longitude, location: row.locationSummary }))));
  const astroLocationPayload = (draft = astroLocationForm) => ({
    id: draft.id || undefined,
    name: draft.name.trim(),
    latitude: Number(draft.latitude),
    longitude: Number(draft.longitude),
    radiusMeters: Number(draft.radiusMeters || 150),
    type: draft.type,
    scopeMode: draft.scopeMode || 'global',
    scopeAccountIds: splitCsvText(draft.scopeAccountIds),
    scopeCustomerNames: splitCsvText(draft.scopeCustomerNames),
    isActive: Boolean(draft.isActive),
    notes: draft.notes.trim(),
  });

  const astroRoutePayload = (draft = astroRouteForm) => {
    const podCount = Math.max(1, Math.min(ASTRO_ROUTE_MAX_PODS, (draft.podSequence || []).length || 1));
    return {
      id: draft.id || undefined,
      accountId: draft.accountId || 'primary',
      unitId: draft.unitId.trim().toUpperCase(),
      customerName: draft.customerName.trim() || 'Astro',
      whLocationId: draft.whLocationId,
      poolLocationId: draft.poolLocationId || '',
      podSequence: (draft.podSequence || []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, ASTRO_ROUTE_MAX_PODS),
      rit1: {
        start: draft.rit1Start,
        end: draft.rit1End,
        enabled: true,
        whArrivalTimeSla: String(draft.rit1WhArrivalTimeSla || '').trim(),
        podArrivalTimeSlas: normalizeAstroPodSlaDraft(draft.rit1PodArrivalTimeSlas, podCount),
      },
      rit2: draft.rit2Enabled ? {
        start: draft.rit2Start,
        end: draft.rit2End,
        enabled: true,
        whArrivalTimeSla: String(draft.rit2WhArrivalTimeSla || '').trim(),
        podArrivalTimeSlas: normalizeAstroPodSlaDraft(draft.rit2PodArrivalTimeSlas, podCount),
      } : null,
      whArrivalTempMinSla: String(draft.whArrivalTempMinSla || '').trim(),
      whArrivalTempMaxSla: String(draft.whArrivalTempMaxSla || '').trim(),
      isActive: Boolean(draft.isActive),
      notes: draft.notes.trim(),
    };
  };

  const validateAstroRouteWhTempRange = (draft = astroRouteForm) => {
    const minText = String(draft.whArrivalTempMinSla || '').trim();
    const maxText = String(draft.whArrivalTempMaxSla || '').trim();
    if (!minText || !maxText) {
      throw new Error('WH temp min dan max SLA wajib diisi.');
    }
    const minValue = Number(minText);
    const maxValue = Number(maxText);
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
      throw new Error('WH temp min dan max SLA harus berupa angka valid.');
    }
    if (minValue > maxValue) {
      throw new Error('WH temp min SLA tidak boleh lebih besar dari max SLA.');
    }
    return { minValue, maxValue };
  };

  const updateAstroRoutePod = (index, value) => {
    setAstroRouteForm((current) => ({
      ...current,
      podSequence: (current.podSequence || ['']).map((item, itemIndex) => itemIndex === index ? value : item),
    }));
  };

  const updateAstroRoutePodSla = (ritKey, index, value) => {
    const field = ritKey === 'rit2' ? 'rit2PodArrivalTimeSlas' : 'rit1PodArrivalTimeSlas';
    setAstroRouteForm((current) => ({
      ...current,
      [field]: normalizeAstroPodSlaDraft((current[field] || []).map((item, itemIndex) => itemIndex === index ? value : item), (current.podSequence || []).length),
    }));
  };

  const addAstroRoutePod = () => {
    setAstroRouteForm((current) => {
      const nextPods = [...(current.podSequence || [])];
      if (nextPods.length >= ASTRO_ROUTE_MAX_PODS) {
        return current;
      }
      nextPods.push('');
      return {
        ...current,
        podSequence: nextPods,
        rit1PodArrivalTimeSlas: normalizeAstroPodSlaDraft([...(current.rit1PodArrivalTimeSlas || []), ''], nextPods.length),
        rit2PodArrivalTimeSlas: normalizeAstroPodSlaDraft([...(current.rit2PodArrivalTimeSlas || []), ''], nextPods.length),
      };
    });
  };

  const removeAstroRoutePod = (index) => {
    setAstroRouteForm((current) => {
      const currentPods = current.podSequence || [''];
      if (currentPods.length <= 1) {
        return {
          ...current,
          podSequence: [''],
          rit1PodArrivalTimeSlas: createBlankAstroPodSlaArray(1),
          rit2PodArrivalTimeSlas: createBlankAstroPodSlaArray(1),
        };
      }
      const nextPods = currentPods.filter((_, itemIndex) => itemIndex !== index);
      return {
        ...current,
        podSequence: nextPods.length ? nextPods : [''],
        rit1PodArrivalTimeSlas: normalizeAstroPodSlaDraft((current.rit1PodArrivalTimeSlas || []).filter((_, itemIndex) => itemIndex !== index), nextPods.length),
        rit2PodArrivalTimeSlas: normalizeAstroPodSlaDraft((current.rit2PodArrivalTimeSlas || []).filter((_, itemIndex) => itemIndex !== index), nextPods.length),
      };
    });
  };
  const focusAstroEditor = (ref, message) => {
    setActivePanel('config');
    setBanner({ tone: 'info', message });
    setTimeout(() => ref?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  const editAstroLocationEntry = (location) => {
    setAstroLocationSectionOpen(true);
    setAstroLocationForm({
      id: location.id || '',
      name: location.name || '',
      latitude: String(location.latitude ?? ''),
      longitude: String(location.longitude ?? ''),
      radiusMeters: String(location.radiusMeters ?? 150),
      type: location.type || 'POD',
      scopeMode: location.scopeMode || 'global',
      scopeAccountIds: (location.scopeAccountIds || []).join(', '),
      scopeCustomerNames: (location.scopeCustomerNames || []).join(', '),
      isActive: location.isActive !== false,
      notes: location.notes || '',
    });
    focusAstroEditor(astroLocationCardRef, `Editing geofence ${location.name || location.id || ''}`.trim());
  };

  const saveAstroLocationEntry = async () => {
    startBusy();
    try {
      const entry = astroLocationPayload();
      const nextLocations = astroLocationForm.id
        ? astroLocations.map((location) => location.id === astroLocationForm.id ? entry : location)
        : [...astroLocations, entry];
      await api('/api/astro/config/locations', { method: 'POST', body: JSON.stringify({ locations: nextLocations }) });
      setAstroLocationForm(EMPTY_ASTRO_LOCATION_FORM);
      setBanner({ tone: 'success', message: 'Geofence saved.' });
      await loadDashboard(true, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Geofence gagal disimpan.' });
      setBanner({ tone: 'error', message: error.message || 'Geofence gagal disimpan.' });
    } finally {
      stopBusy();
    }
  };
  const toggleAstroLocationSelection = (locationId) => {
    setSelectedAstroLocationIds((current) => current.includes(locationId)
      ? current.filter((id) => id !== locationId)
      : [...current, locationId]);
  };

  const selectVisibleAstroLocations = () => {
    setSelectedAstroLocationIds(Array.from(new Set(astroFilteredLocationGroups.flatMap((group) => group.items.map((location) => location.id)))));
  };

  const clearSelectedAstroLocations = () => {
    setSelectedAstroLocationIds([]);
  };

  const deleteAstroLocations = async (locationIds) => {
    const uniqueIds = Array.from(new Set((locationIds || []).filter(Boolean)));
    if (!uniqueIds.length) return;
    startBusy();
    try {
      const selectedIdSet = new Set(uniqueIds);
      const nextLocations = astroLocations.filter((location) => !selectedIdSet.has(location.id));
      const nextRoutes = astroRoutes.filter((route) => !selectedIdSet.has(route.whLocationId) && !selectedIdSet.has(route.poolLocationId) && !(route.podSequence || []).some((locationId) => selectedIdSet.has(locationId)));
      await api('/api/astro/config/locations', { method: 'POST', body: JSON.stringify({ locations: nextLocations, routes: nextRoutes }) });
      if (astroLocationForm.id && selectedIdSet.has(astroLocationForm.id)) setAstroLocationForm(EMPTY_ASTRO_LOCATION_FORM);
      if (astroRouteForm.id && !nextRoutes.some((route) => route.id === astroRouteForm.id)) setAstroRouteForm({ ...EMPTY_ASTRO_ROUTE_FORM, rit1PodArrivalTimeSlas: createBlankAstroPodSlaArray(1), rit2PodArrivalTimeSlas: createBlankAstroPodSlaArray(1) });
      setSelectedAstroLocationIds([]);
      setBanner({ tone: 'success', message: uniqueIds.length === 1 ? 'Geofence deleted.' : `${uniqueIds.length} geofence deleted.` });
      await loadDashboard(true, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Geofence gagal dihapus.' });
      setBanner({ tone: 'error', message: error.message || 'Geofence gagal dihapus.' });
    } finally {
      stopBusy();
    }
  };

  const deleteAstroLocationEntry = async (locationId) => {
    await deleteAstroLocations([locationId]);
  };

  const editAstroRouteEntry = (route) => {
    setAstroRouteSectionOpen(true);
    setAstroRouteForm({
      id: route.id || '',
      accountId: route.accountId || 'primary',
      unitId: route.unitId || '',
      customerName: route.customerName || 'Astro',
      whLocationId: route.whLocationId || '',
      poolLocationId: route.poolLocationId || '',
      podSequence: route.podSequence?.length ? route.podSequence.slice(0, ASTRO_ROUTE_MAX_PODS) : [''],
      rit1Start: route.rit1?.start || '05:00',
      rit1End: route.rit1?.end || '14:59',
      rit1WhArrivalTimeSla: route.rit1?.whArrivalTimeSla || '',
      rit1PodArrivalTimeSlas: normalizeAstroPodSlaDraft(route.rit1?.podArrivalTimeSlas, route.podSequence?.length || 1),
      rit2Enabled: Boolean(route.rit2),
      rit2Start: route.rit2?.start || '19:00',
      rit2End: route.rit2?.end || '06:00',
      rit2WhArrivalTimeSla: route.rit2?.whArrivalTimeSla || '',
      rit2PodArrivalTimeSlas: normalizeAstroPodSlaDraft(route.rit2?.podArrivalTimeSlas, route.podSequence?.length || 1),
      whArrivalTempMinSla: route.whArrivalTempMinSla ?? '',
      whArrivalTempMaxSla: route.whArrivalTempMaxSla ?? '',
      isActive: route.isActive !== false,
      notes: route.notes || '',
    });
    focusAstroEditor(astroRouteCardRef, `Editing Astro route ${route.unitId || route.id || ''}`.trim());
  };

  const saveAstroRouteEntry = async () => {
    startBusy();
    try {
      validateAstroRouteWhTempRange();
      const entry = astroRoutePayload();
      const nextRoutes = astroRouteForm.id
        ? astroRoutes.map((route) => route.id === astroRouteForm.id ? entry : route)
        : [...astroRoutes, entry];
      await api('/api/astro/config/routes', { method: 'POST', body: JSON.stringify({ routes: nextRoutes }) });
      setAstroRouteForm((current) => ({ ...EMPTY_ASTRO_ROUTE_FORM, accountId: current.accountId || 'primary', podSequence: [''], rit1PodArrivalTimeSlas: createBlankAstroPodSlaArray(1), rit2PodArrivalTimeSlas: createBlankAstroPodSlaArray(1) }));
      setBanner({ tone: 'success', message: 'Astro route saved.' });
      await loadDashboard(true, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Astro route gagal disimpan.' });
      setBanner({ tone: 'error', message: error.message || 'Astro route gagal disimpan.' });
    } finally {
      stopBusy();
    }
  };

  const toggleAstroRouteSelection = (routeId) => {
    setSelectedAstroRouteIds((current) => current.includes(routeId)
      ? current.filter((id) => id !== routeId)
      : [...current, routeId]);
  };

  const selectVisibleAstroRoutes = () => {
    setSelectedAstroRouteIds(Array.from(new Set(astroFilteredRouteGroups.flatMap((group) => group.items.map((route) => route.id)))));
  };

  const clearSelectedAstroRoutes = () => {
    setSelectedAstroRouteIds([]);
  };

  const deleteAstroRoutes = async (routeIds) => {
    const uniqueIds = Array.from(new Set((routeIds || []).filter(Boolean)));
    if (!uniqueIds.length) return;
    startBusy();
    try {
      const selectedIdSet = new Set(uniqueIds);
      const nextRoutes = astroRoutes.filter((route) => !selectedIdSet.has(route.id));
      await api('/api/astro/config/routes', { method: 'POST', body: JSON.stringify({ routes: nextRoutes }) });
      if (astroRouteForm.id && selectedIdSet.has(astroRouteForm.id)) setAstroRouteForm({ ...EMPTY_ASTRO_ROUTE_FORM, rit1PodArrivalTimeSlas: createBlankAstroPodSlaArray(1), rit2PodArrivalTimeSlas: createBlankAstroPodSlaArray(1) });
      setSelectedAstroRouteIds([]);
      setBanner({ tone: 'success', message: uniqueIds.length === 1 ? 'Astro route deleted.' : `${uniqueIds.length} Astro route deleted.` });
      await loadDashboard(true, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Astro route gagal dihapus.' });
      setBanner({ tone: 'error', message: error.message || 'Astro route gagal dihapus.' });
    } finally {
      stopBusy();
    }
  };

  const deleteAstroRouteEntry = async (routeId) => {
    await deleteAstroRoutes([routeId]);
  };
  const importAstroLocations = async (replace = false) => {
    if (!astroCsvText.trim()) return;
    startBusy();
    try {
      const payload = await api('/api/astro/config/locations/import', { method: 'POST', body: JSON.stringify({ csvText: astroCsvText, replace }) });
      setAstroCsvText('');
      setBanner({ tone: 'success', message: `Imported ${payload.imported || 0} Astro location row(s).` });
      await loadDashboard(true, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Import Astro location gagal.' });
      setBanner({ tone: 'error', message: error.message || 'Import Astro location gagal.' });
    } finally {
      stopBusy();
    }
  };

  const loadAstroCsvFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const textValue = await file.text();
    setAstroCsvText(textValue);
  };

  const importAstroRoutes = async (replace = false) => {
    if (!astroRouteCsvText.trim()) return;
    startBusy();
    try {
      const payload = await api('/api/astro/config/routes/import', { method: 'POST', body: JSON.stringify({ csvText: astroRouteCsvText, replace }) });
      setAstroRouteCsvText('');
      setBanner({ tone: 'success', message: `Imported ${payload.imported || 0} Astro route row(s).` });
      await loadDashboard(true, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Import Astro route gagal.' });
      setBanner({ tone: 'error', message: error.message || 'Import Astro route gagal.' });
    } finally {
      stopBusy();
    }
  };

  const loadAstroRouteCsvFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const textValue = await file.text();
    setAstroRouteCsvText(textValue);
  };

  const generateAstroReport = async () => {
    startBusy('Generating Astro report...');
    try {
      const query = new URLSearchParams({ startDate: astroReportFilters.startDate, endDate: astroReportFilters.endDate });
      if (astroReportFilters.accountId && astroReportFilters.accountId !== 'all') query.set('accountId', astroReportFilters.accountId);
      if (astroReportFilters.routeId) {
        const selectedRoute = astroRoutes.find((route) => route.id === astroReportFilters.routeId);
        if (selectedRoute?.accountId) query.set('accountId', selectedRoute.accountId);
        query.set('routeId', astroReportFilters.routeId);
      }
      const payload = await api(`/api/astro/report?${query.toString()}`);
      setAstroReport(payload);
      setBanner({ tone: 'success', message: `Astro report loaded with ${payload.rows?.length || 0} rit row(s).` });
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Astro report gagal diambil.' });
      setBanner({ tone: 'error', message: error.message || 'Astro report gagal diambil.' });
    } finally {
      stopBusy();
    }
  };

  const exportAstroReport = async () => {
    startBusy('Menyiapkan Astro CSV...');
    try {
      const query = new URLSearchParams({ startDate: astroReportFilters.startDate, endDate: astroReportFilters.endDate });
      let nopolPrefix = '';
      if (astroReportFilters.accountId && astroReportFilters.accountId !== 'all') query.set('accountId', astroReportFilters.accountId);
      if (astroReportFilters.routeId) {
        const selectedRoute = astroRoutes.find((route) => route.id === astroReportFilters.routeId);
        if (selectedRoute?.accountId) query.set('accountId', selectedRoute.accountId);
        query.set('routeId', astroReportFilters.routeId);
        const routeAccountId = selectedRoute?.accountId || astroReportFilters.accountId || 'primary';
        const routeUnitId = selectedRoute?.unitId || '';
        const unitLabel = astroUnitLabelByKey.get(`${routeAccountId}::${routeUnitId}`) || routeUnitId;
        const sanitizedNopol = unitLabel.replace(/[^a-zA-Z0-9]/g, '');
        nopolPrefix = `${sanitizedNopol}-`;
      }
      const response = await fetch(`/api/astro/report/export?${query.toString()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `astro-report-${nopolPrefix}${astroReportFilters.startDate}-to-${astroReportFilters.endDate}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setBanner({ tone: 'success', message: 'Astro CSV exported.' });
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Astro CSV gagal di-export.' });
      setBanner({ tone: 'error', message: error.message || 'Astro CSV gagal di-export.' });
    } finally {
      stopBusy();
    }
  };

  const busyOverlay = busy ? <div className="loading-overlay"><div className="loading-overlay-card"><Spinner /><h3>{busyMessage}</h3><p>Mohon tunggu, request sedang diproses. Aksi lain dikunci sementara untuk menghindari spam request.</p></div></div> : null;

  if (!loaded) {
    return <div className="auth-shell" data-state="loading">
      <div className="auth-split-left">
        <div className="auth-brand-showcase">
          <div className="auth-brand-logo"><span className="brand-mark">S</span></div>
          <p className="auth-brand-tagline">Loading workspace...</p>
          <div className="auth-brand-spinner"><UISpinner /></div>
        </div>
        <div className="auth-topo-lines" aria-hidden="true">
          <svg viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg" className="auth-topo-svg">
            <circle cx="80" cy="320" r="180" stroke="currentColor" strokeWidth="0.5" opacity="0.12" />
            <circle cx="80" cy="320" r="130" stroke="currentColor" strokeWidth="0.5" opacity="0.09" />
            <circle cx="80" cy="320" r="80" stroke="currentColor" strokeWidth="0.5" opacity="0.06" />
            <circle cx="340" cy="60" r="120" stroke="currentColor" strokeWidth="0.5" opacity="0.10" />
            <circle cx="340" cy="60" r="70" stroke="currentColor" strokeWidth="0.5" opacity="0.07" />
          </svg>
        </div>
      </div>
      <div className="auth-split-right">
        <div className="auth-card">
          <div className="auth-loader">
            <UISpinner />
            <p className="auth-loader-text">Memuat...</p>
          </div>
        </div>
      </div>
    </div>;
  }

  if (loaded && !webSessionUser) {
    return <div className="auth-shell" data-state="signin">
      <div className="auth-split-left">
        <div className="auth-brand-showcase">
          <div className="auth-brand-logo"><span className="brand-mark">S</span></div>
          <h2 className="auth-brand-headline">Sowhat</h2>
          <p className="auth-brand-tagline">Fleet intelligence, temperature compliance, and operational clarity - in one workspace.</p>
          <div className="auth-brand-stats" aria-hidden="true">
            <div className="auth-brand-stat">
              <span className="auth-brand-stat-value">24/7</span>
              <span className="auth-brand-stat-label">Live monitoring</span>
            </div>
            <div className="auth-brand-stat">
              <span className="auth-brand-stat-value">0.3s</span>
              <span className="auth-brand-stat-label">Avg response</span>
            </div>
            <div className="auth-brand-stat">
              <span className="auth-brand-stat-value">99.8%</span>
              <span className="auth-brand-stat-label">Uptime</span>
            </div>
          </div>
        </div>
        <div className="auth-topo-lines" aria-hidden="true">
          <svg viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg" className="auth-topo-svg">
            <circle cx="80" cy="320" r="180" stroke="currentColor" strokeWidth="0.5" opacity="0.12" />
            <circle cx="80" cy="320" r="130" stroke="currentColor" strokeWidth="0.5" opacity="0.09" />
            <circle cx="80" cy="320" r="80" stroke="currentColor" strokeWidth="0.5" opacity="0.06" />
            <circle cx="340" cy="60" r="120" stroke="currentColor" strokeWidth="0.5" opacity="0.10" />
            <circle cx="340" cy="60" r="70" stroke="currentColor" strokeWidth="0.5" opacity="0.07" />
          </svg>
        </div>
      </div>

      <div className="auth-split-right">
        <button
          type="button"
          className="auth-theme-toggle"
          onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? <MoonStar size={15} strokeWidth={1.75} /> : <Sun size={15} strokeWidth={1.75} />}
        </button>

        <div className="auth-card">
          <h1 className="auth-title">Sign in</h1>
          <p className="auth-subtitle">Masuk ke workspace Sowhat.</p>

          {authModal.open ? (
            <div className="auth-error" role="alert">
              <AlertCircle size={15} strokeWidth={1.75} />
              <span>{authModal.message}</span>
              <button type="button" className="auth-error-dismiss" onClick={() => setAuthModal({ open: false, message: '' })} aria-label="Tutup">
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ) : null}

          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); loginToWeb(); }}>
            <label className="auth-field">
              <span className="auth-field-label">Username</span>
              <input
                type="text"
                value={webLoginForm.username}
                onChange={(event) => setWebLoginForm((current) => ({ ...current, username: event.target.value }))}
                placeholder="admin"
                autoComplete="username"
                autoFocus
                aria-invalid={authModal.open || undefined}
              />
            </label>
            <label className="auth-field">
              <span className="auth-field-label">Password</span>
              <input
                type="password"
                value={webLoginForm.password}
                onChange={(event) => setWebLoginForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="Password"
                autoComplete="current-password"
                aria-invalid={authModal.open || undefined}
              />
            </label>
            <Action variant="primary" size="md" type="submit" className="auth-submit" loading={busy} disabled={busy || !webLoginForm.username.trim()}>
              Sign in
            </Action>
          </form>

          <p className="auth-footer-note">Protected workspace. Unauthorized access prohibited.</p>
        </div>
      </div>

      {busyOverlay}
    </div>;
  }

  return (
    
    <div className={`bridge-shell ${sidebarCollapsed ? 'navrail-is-collapsed' : ''} ${mobileNavOpen ? 'mobile-nav-open' : ''}`}>
      <button type="button" className="bridge-mobile-toggle" onClick={() => setMobileNavOpen((current) => !current)} aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}>
        {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
      </button>
      <button type="button" className="bridge-mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />
      <NavRail
        activePanel={activePanel}
        onSelect={(id) => { setActivePanel(id); setMobileNavOpen(false); }}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        isAdmin={isAdmin}
        theme={theme}
        onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
        user={webSessionUser}
        onProfileClick={() => { setActivePanel(isAdmin ? 'admin' : 'overview'); setMobileNavOpen(false); }}
        onLogout={logoutWeb}
      />
      <CommandBar
        activePanel={activePanel}
        range={range}
        onRangeChange={setRange}
        search={search}
        onSearchChange={setSearch}
        accountName={accountName(currentAccount)}
        onExportFleet={exportFleet}
        onExportAlerts={exportAlerts}
        onRefresh={() => loadDashboard(false, false)}
        onPollNow={runPollNow}
        onTogglePolling={togglePolling}
        isPolling={!!status?.runtime?.isPolling}
        isOnline={!status?.runtime?.lastSnapshotError}
        busy={busy}
      />

      <main className="workspace">
        <ErrorBoundary key={activePanel}>
        {showOverviewChrome ? <div className="overview-chrome">
          <div className="stat-strip">
            {[
              { label: 'Monitored Units', value: status?.overview?.monitoredUnits, note: 'Aktif di config' },
              { label: 'Live Alerts', value: status?.overview?.liveAlerts, note: 'Alert current', danger: true },
              { label: 'Critical Alerts', value: status?.overview?.criticalAlerts, note: 'T1+T2 Error', danger: true },
              { label: 'Moving', value: status?.overview?.movingUnits, note: 'Speed > 0' },
              { label: 'Stale Feeds', value: status?.overview?.staleUnits, note: '> 15 mins', warning: true },
            ].map((s, i) => (
              <div key={i} className={`stat-card ${s.danger ? 'stat-card-danger' : s.warning ? 'stat-card-warning' : ''}`}>
                <span className="stat-label">{s.label}</span>
                <div className="stat-value">{s.value ?? '-'}</div>
                <span className="stat-note">{s.note}</span>
              </div>
            ))}
          </div>

        </div> : null}
        <div className="panel-container">
          
          

                    {activePanel === 'overview' ? (
  <div className="overview-workspace">
    {/* Header row */}
    <div className="overview-header">
      <div className="overview-header-left">
        <h2 className="overview-title">Overview</h2>
        <p className="overview-subtitle">Operational summary across fleet, temperature, and compliance.</p>
      </div>
      <div className="overview-toolbar">
        <label className="field overview-account-field">
          <span>Account</span>
          <select value={overviewAccountId} onChange={(event) => setOverviewAccountId(event.target.value)}>
            {overviewAccountOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
    </div>

    {/* KPI strip */}
    {!status ? <StatGridSkeleton count={4} /> : (
    <div className="overview-kpi-grid">
      <div className="overview-kpi-card overview-kpi-card-wide info" style={{ '--kpi-index': 0 }}>
        <span>Total units</span>
        <strong>{overviewAccountStats.totalConfiguredUnits || 0}</strong>
        <small>Configured in this account</small>
      </div>
      <div className="overview-kpi-card danger" style={{ '--kpi-index': 1 }}>
        <span>Temp error</span>
        <strong>{fmtPct(overviewAccountStats.tempErrorRate)}</strong>
        <small>{overviewAccountStats.tempErrorUnits}/{overviewAccountStats.totalConfiguredUnits || 0} units</small>
      </div>
      <div className="overview-kpi-card success" style={{ '--kpi-index': 2 }}>
        <span>Moving</span>
        <strong>{fmtPct(overviewAccountStats.movingRate)}</strong>
        <small>{overviewAccountStats.movingUnits}/{overviewAccountStats.totalConfiguredUnits || 0} units</small>
      </div>
      <div className="overview-kpi-card warning" style={{ '--kpi-index': 3 }}>
        <span>Idle</span>
        <strong>{fmtPct(overviewAccountStats.idleRate)}</strong>
        <small>{overviewAccountStats.idleUnits}/{overviewAccountStats.totalConfiguredUnits || 0} units</small>
      </div>
    </div>
    )}

    {/* Hero: Temp chart (wide) + Fleet donut (narrow) */}
    <div className="overview-hero-row">
      <div className="overview-chart-card overview-hero-chart">
        <div className="overview-chart-head">
          <div>
            <h3>Temperature incidents</h3>
            <p>Trend across selected date range.</p>
          </div>
          <Chip color={busy ? 'warning' : 'default'}>{busy ? 'Loading...' : `${overviewTempTrend.length} day(s)`}</Chip>
        </div>
        <div className="overview-chart-stack">
          <OverviewTempTrendChart points={overviewTempTrend} busy={busy} />
        </div>
        <div className="overview-mini-summary overview-mini-summary-compact">
          <div className="mini-metric"><span>Incidents</span><strong>{overviewTempSummary.totalIncidents || 0}</strong></div>
          <div className="mini-metric"><span>Affected</span><strong>{overviewTempSummary.affectedUnits || 0}</strong></div>
          <div className="mini-metric"><span>Total</span><strong>{formatMinutesText(overviewTempSummary.totalMinutes || 0)}</strong></div>
          <div className="mini-metric"><span>Longest</span><strong>{formatMinutesText(overviewTempSummary.longestMinutes || 0)}</strong></div>
        </div>
      </div>

      <div className="overview-chart-card overview-hero-donut">
        <div className="overview-chart-head">
          <div>
            <h3>Fleet composition</h3>
            <p>Live snapshot today.</p>
          </div>
          <Chip>{overviewAccountStats.totalConfiguredUnits || 0} unit</Chip>
        </div>
        <div className="overview-donut-layout">
          <OverviewDonutChart segments={overviewDonutSegments} total={overviewAccountStats.totalConfiguredUnits || 0} />
          <div className="overview-legend">
            {overviewDonutSegments.map((segment) => (
              <div key={segment.key} className="overview-legend-row">
                <span className={`overview-legend-dot ${segment.tone}`} />
                <div>
                  <strong>{segment.label}</strong>
                  <small>{segment.value} unit</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>

    {/* Astro KPI Per Warehouse */}
    <div className="overview-section">
      <div className="overview-section-head">
        <div>
          <h3>Astro KPI per Warehouse</h3>
          <p>Sequential data per warehouse location.</p>
        </div>
        <Chip color={overviewAstroBusy ? 'warning' : revealedWhCount < 4 ? 'warning' : 'default'}>
          {overviewAstroBusy ? 'Loading...' : revealedWhCount < 4 ? `${revealedWhCount}/4 WH` : `${overviewAstroByWarehouse.length} WH`}
        </Chip>
      </div>
      <div className="overview-wh-grid-horizontal">
        {(() => {
          const TARGET_WH = ['BGO', 'CBN', 'PGS', 'SRG'];
          const kpiLines = [
            { key: 'whArrivalTimeRate', colorHex: '#4FC3F7', label: 'WH Arrival Time' },
            { key: 'whArrivalTempRate', colorHex: '#81C784', label: 'WH Temp Pass' },
            { key: 'podArrivalRate', colorHex: '#FFB74D', label: 'POD Arrival Time' },
          ];

          return TARGET_WH.map((whKey, index) => {
            const warehouseData = overviewAstroByWarehouse.find(wh =>
              (wh.whName || wh.warehouse || '').toUpperCase().includes(whKey)
            );
            const isRevealed = !overviewAstroBusy && index < revealedWhCount;

            return (
              <div key={`wh-${whKey}`} className={`overview-wh-card ${isRevealed ? 'wh-card-revealed' : 'wh-card-loading'}`} style={{ '--wh-index': index }}>
                <h4 className="overview-wh-card-title">WH {whKey}</h4>
                {isRevealed ? (
                  warehouseData ? (
                    <OverviewMultiLineChart
                      points={warehouseData.trend || []}
                      busy={false}
                      lines={kpiLines}
                      emptyMessage="No trend data for this WH."
                      maxFloor={100}
                      tooltipTitle={(point) => formatChartDayTitle(point?.day)}
                    />
                  ) : (
                    <div className="overview-chart-empty">No data for WH {whKey}.</div>
                  )
                ) : (
                  <div className="wh-card-shimmer">
                    <div className="wh-shimmer-bar" />
                    <div className="wh-shimmer-bar short" />
                    <span className="wh-loading-text">Loading data...</span>
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div>
    </div>
  </div>
) : null}
          {activePanel === 'trip-monitor' ? <TripMonitorPanel
            tripMonitorFilters={tripMonitorFilters}
            setTripMonitorFilters={setTripMonitorFilters}
            tripMonitorSeverityCounts={tripMonitorSeverityCounts}
            tripMonitorCustomerOptions={tripMonitorCustomerOptions}
            tripMonitorIncidentOptions={tripMonitorIncidentOptions}
            tripMonitorVisibleRows={tripMonitorVisibleRows}
            tripMonitorPanels={tripMonitorPanels}
            tripMonitorBusy={tripMonitorBusy}
            tripMonitorSummary={tripMonitorSummary}
            tripMonitorIncludedStatusesLabel={tripMonitorIncludedStatusesLabel}
            tmsConfig={tmsConfig}
            tmsForm={tmsForm}
            range={range}
            onRefreshBoard={refreshTripMonitorBoard}
            onSyncTms={triggerTmsSync}
            onOpenDetail={(rowId) => openTripMonitorDetail(rowId)}
            isAdmin={isAdmin}
            fmtDate={fmtDate}
          /> : null}
          {activePanel === 'fleet' ? <FleetWorkspace
            rows={prioritizedFleet}
            selectedRow={selectedFleetRow}
            onSelectUnit={(row) => openUnit(row.accountId || 'primary', row.id, 'fleet')}
            onBack={() => { setSelectedUnitId(''); setSelectedUnitAccountId('primary'); }}
            detail={unitDetail}
            detailBusy={detailBusy}
            quickFilter={quickFilter}
            onQuickFilterChange={handleQuickFilterSelect}
            autoFilterCards={autoFilterCards}
            fleetAccountFilter={fleetAccountFilter}
            onFleetAccountFilterChange={setFleetAccountFilter}
            fleetFilterAccounts={fleetFilterAccounts}
            fleetCategoryFilter={fleetCategoryFilter}
            onFleetCategoryFilterChange={setFleetCategoryFilter}
            onExportFleet={exportFleet}
            onOpenTempErrors={(row) => openUnit(row.accountId || 'primary', row.id, 'temp-errors')}
            onSeeHistorical={(row) => openUnit(row.accountId || 'primary', row.id, 'historical')}
            rangeLabel={`${range.startDate} to ${range.endDate}`}
            tripMonitorRows={tripMonitorRows}
          /> : null}
          {/* Fleet legacy table block - DEPRECATED, kept disabled for reference; remove after parity confirmed */}
          {false ? <>
            <div className="filter-strip">
              <button type="button" className={`filter-pill ${quickFilter === 'all' ? 'active' : ''}`} onClick={() => handleQuickFilterSelect('all')}>
                <span>All Fleet</span><span className="filter-badge">All</span>
              </button>
              {autoFilterCards.map(c => (
                <button type="button" key={c.id} className={`filter-pill ${quickFilter === c.id ? 'active' : ''}`} onClick={() => handleQuickFilterSelect(c.id)}>
                  <span>{c.label}</span><span className="filter-badge">{c.count}</span>
                </button>
              ))}
            </div>
            <Card className="panel-card">
              <CardHeader className="panel-card-header">
                <div>
                  <h2>Fleet live snapshot</h2>
                  <p>Buka grafik unit di modal terpisah agar tabel fleet tetap rapi dan mudah dibaca.</p>
                </div>
                <div className="inline-buttons">
                  <Button variant="bordered" onPress={exportFleet}>Export fleet CSV</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="fleet-filter-bar" style={{ justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <label className="field fleet-filter-field">
                    <span>Account filter</span>
                    <select value={fleetAccountFilter} onChange={(event) => setFleetAccountFilter(event.target.value)}>
                      <option value="all">All accounts</option>
                      {fleetFilterAccounts.map((account) => <option key={account.id} value={account.id}>{account.label || account.authEmail || account.id}</option>)}
                    </select>
                  </label>
                  <label className="field fleet-filter-field">
                    <span>Category filter</span>
                    <select value={fleetCategoryFilter} onChange={(event) => setFleetCategoryFilter(event.target.value)}>
                      <option value="all">All categories</option>
                      {UNIT_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="fleet-table-summary">
                  <span>{prioritizedFleet.length} unit tampil di fleet live</span>
                  <span>{fleetAccountFilter === 'all' ? 'Semua account' : accountName(fleetFilterAccounts.find((account) => account.id === fleetAccountFilter))} | {fleetCategoryFilter === 'all' ? 'Semua kategori' : unitCategoryLabel(fleetCategoryFilter)} | {expandedFleetRowKey ? '1 modal grafik sedang terbuka' : 'Belum ada grafik yang dibuka'}</span>
                </div>
                {prioritizedFleet.length ? <div className="table-shell table-compact">
                  <table className="data-table fleet-inline-table">
                    <thead>
                      <tr>
                        <th>Health</th>
                        <th>Account</th>
                        <th style={{ minWidth: 180, maxWidth: 180 }}>Unit</th>
                        <th style={{ minWidth: 240, maxWidth: 240 }}>Status</th>
                        <th style={{ minWidth: 220, maxWidth: 220 }}>Location</th>
                        <th>Speed</th>
                        <th>Temp 1</th>
                        <th>Temp 2</th>
                        <th>Gap</th>
                        <th>Errors</th>
                        <th>Updated</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prioritizedFleet.map((row, rowIndex) => {
                        const state = health(row);
                        const rowKey = unitRowKey(row);
                        const expanded = expandedFleetRowKey === rowKey;
                        return <React.Fragment key={row.rowKey || rowKey || `fleet-${rowIndex}`}>
                          <tr className={`${rowPriority(row) >= 5 ? 'data-row data-row-danger' : rowPriority(row) >= 3 ? 'data-row data-row-warning' : 'data-row'}${expanded ? ' data-row-active' : ''}`}>
                            <td><Chip color={state.tone} variant="flat">{state.label}</Chip></td>
                            <td>{row.accountLabel || row.accountId || '-'}</td>
                            <td style={{ minWidth: 180, maxWidth: 180, whiteSpace: 'normal', wordBreak: 'break-word' }}><div><strong>{row.id}</strong><div className="subtle-line">{row.label}</div><div className="subtle-line">{row.alias}</div><div style={{ marginTop: '6px' }}><Chip color={unitCategoryTone(row.unitCategory)}>{row.unitCategoryLabel || unitCategoryLabel(row.unitCategory)}</Chip></div></div></td>
                            <td style={{ minWidth: 240, maxWidth: 240, whiteSpace: 'normal' }}>
                              <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                                {(() => {
                                  const chips = [];
                                  if (row.geofenceStatusLabel) {
                                    chips.push({ text: row.geofenceStatusLabel, color: geofenceChipTone(row) });
                                  }
                                  if (row.astroActive && row.astroStatusLabel) {
                                    chips.push({ text: row.astroStatusLabel, color: row.astroCurrentLocation ? 'warning' : 'default' });
                                  }
                                  if (chips.length === 0) {
                                    chips.push({ text: row.locationSummary || row.zoneName || 'IDLE', color: 'default' });
                                  }

                                  const displayChips = chips.filter((c, idx) => {
                                    const t = c.text.toLowerCase();
                                    if (chips.findIndex(oc => oc.text.toLowerCase() === t) < idx) return false;
                                    if (t === 'en route' && chips.some(oc => oc.text.toLowerCase().includes('en route astro'))) return false;
                                    return true;
                                  });

                                  return displayChips.map((c, i) => <Chip key={i} className="wrap-chip" color={c.color} variant="flat">{c.text}</Chip>);
                                })()}
                              </div>
                            </td>
                            <td style={{ minWidth: 220, maxWidth: 220, whiteSpace: 'normal', wordBreak: 'break-word' }}><div><div>{row.locationSummary || '-'}</div><div className="subtle-line">{row.zoneName || 'No zone'}</div><div className="subtle-line">{fmtCoord(row.latitude)}, {fmtCoord(row.longitude)}</div></div></td>
                            <td>{fmtNum(row.speed, 0)}</td>
                            <td>{fmtNum(row.liveTemp1)}</td>
                            <td>{fmtNum(row.liveTemp2)}</td>
                            <td>{row.liveTempDelta !== null ? <Chip color={row.liveTempDelta >= 5 ? 'warning' : 'default'} variant="flat">{fmtNum(row.liveTempDelta)}</Chip> : '-'}</td>
                            <td><div><div>{row.liveSensorFaultLabel || (row.recentAlertsCount ? `${row.recentAlertsCount} recent alert(s)` : row.errSensor || 'Sensor OK')}</div><div className="subtle-line">{row.errGps || 'GPS OK'}</div></div></td>
                            <td><div><div>{fmtDate(row.lastUpdatedAt)}</div><div className="subtle-line">{fmtAgo(row.minutesSinceUpdate)}</div></div></td>
                            <td>
                              <div className="fleet-row-actions">
                                <Button variant={expanded ? 'light' : 'bordered'} className="fleet-row-button" onPress={() => toggleFleetGraph(row)}>{expanded ? 'Close graphic' : 'See graphic'}</Button>
                                <Button variant="bordered" className="fleet-row-button" onPress={() => openUnit(row.accountId || 'primary', row.id, 'historical')}>See historical</Button>
                              </div>
                            </td>
                          </tr>
                        </React.Fragment>;
                      })}
                    </tbody>
                  </table>
                </div> : <div className="empty-state">Belum ada fleet snapshot. Save config lalu jalankan Poll now.</div>}
              </CardContent>
            </Card>
          </> : null}
                    {activePanel === 'map' ? <MapPanel
            mapFleetRows={mapFleetRows}
            mapRegionSummary={mapRegionSummary}
            mapSearch={mapSearch}
            setMapSearch={setMapSearch}
            mapAccountFilter={mapAccountFilter}
            setMapAccountFilter={setMapAccountFilter}
            fleetFilterAccounts={fleetFilterAccounts}
            accountName={accountName}
            getMapStatusMeta={getMapStatusMeta}
            resolveFleetRegion={resolveFleetRegion}
            buildTruckDivIcon={buildTruckDivIcon}
            fmtNum={fmtNum}
          /> : null}
          {activePanel === 'astro-report' ? <AstroReportPanel
            astroReportFilters={astroReportFilters}
            setAstroReportFilters={setAstroReportFilters}
            astroReportMode={astroReportMode}
            setAstroReportMode={setAstroReportMode}
            astroReport={astroReport}
            astroRoutes={astroRoutes}
            astroLocations={astroLocations}
            astroReportAccountOptions={astroReportAccountOptions}
            astroReportVisibleRouteOptions={astroReportVisibleRouteOptions}
            astroReportColumns={astroReportColumns}
            astroReportTableRows={astroReportTableRows}
            astroDiagnostics={astroDiagnostics}
            astroDiagnosticRows={astroDiagnosticRows}
            astroDiagnosticsOpen={astroDiagnosticsOpen}
            setAstroDiagnosticsOpen={setAstroDiagnosticsOpen}
            onGenerateReport={generateAstroReport}
            onExportReport={exportAstroReport}
            fmtPct={fmtPct}
            SearchableSelect={SearchableSelect}
            DataTable={DataTable}
          /> : null}
          {activePanel === 'temp-errors' ? <TempErrorsPanel
            errorRows={errorRows}
            errorOverview={errorOverview}
            compileDailyRows={compileDailyRows}
            selectedFleetRow={selectedFleetRow}
            unitDetail={unitDetail}
            detailBusy={detailBusy}
            onExportAlerts={exportAlerts}
            onExportCompile={exportCompile}
            onOpenUnit={(accountId, unitId) => openUnit(accountId, unitId, 'temp-errors')}
            fmtDate={fmtDate}
            fmtDateOnly={fmtDateOnly}
            fmtNum={fmtNum}
            DataTable={DataTable}
            TemperatureChart={TemperatureChart}
          /> : null}
          {activePanel === 'historical' ? <HistoricalPanel
            fleetRows={fleetRows}
            historicalFleet={historicalFleet}
            selectedHistoricalRow={selectedHistoricalRow}
            historicalAppliedRow={historicalAppliedRow}
            historicalSearch={historicalSearch}
            setHistoricalSearch={setHistoricalSearch}
            historicalRangeDraft={historicalRangeDraft}
            setHistoricalRangeDraft={setHistoricalRangeDraft}
            historicalRangeApplied={historicalRangeApplied}
            historicalDetail={historicalDetail}
            historicalDetailBusy={historicalDetailBusy}
            historicalTripMetrics={historicalTripMetrics}
            historicalGeofenceEvents={historicalGeofenceEvents}
            onSelectUnit={selectHistoricalUnit}
            onPullData={pullHistoricalData}
            onExportHistory={exportHistory}
            onBackToFleet={() => setActivePanel('fleet')}
            renderTemperatureChart={stableRenderTemperatureChart}
            fmtDate={fmtDate}
            fmtNum={fmtNum}
            fmtCoord={fmtCoord}
            formatMinutesText={formatMinutesText}
            unitRowKey={unitRowKey}
          /> : null}

          {activePanel === 'pod' ? <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>POD auto capture</h2><p>Snapshot harian kalau unit masuk radius POD dengan speed rendah. Lokasi POD bisa kamu atur sendiri.</p></div><div className="inline-buttons"><Button variant="bordered" onPress={exportPods}>Export POD CSV</Button></div></CardHeader><CardContent><DataTable columns={['Day', 'Time', 'Account', 'Unit', 'Customer', 'POD', 'Distance', 'Speed', 'Location']} emptyMessage="Belum ada POD capture di range ini." rows={podRows.map((row) => [row.day, row.time, row.accountLabel || row.accountId || '-', <div><strong>{row.unitId}</strong><div className="subtle-line">{row.unitLabel}</div></div>, row.customerName || '-', row.podName, `${fmtNum(row.distanceMeters, 0)} m`, fmtNum(row.speed, 0), row.locationSummary || '-'])} /></CardContent></Card> : null}

          {activePanel === 'api-monitor' ? <ApiMonitorPanel apiMonitor={apiMonitor} fmtDate={fmtDate} fmtNum={fmtNum} /> : null}
          {activePanel === 'config' ? <ConfigPanel
            availableAccounts={availableAccounts}
            activeAccountId={activeAccountId}
            currentAccount={currentAccount}
            onSwitchAccount={switchAccount}
            onDiscoverUnits={discoverUnits}
            onLogoutAccount={logoutAccount}
            onSaveConfig={saveConfig}
            linkedAccountSectionOpen={linkedAccountSectionOpen}
            setLinkedAccountSectionOpen={setLinkedAccountSectionOpen}
            accountLoginForm={accountLoginForm}
            setAccountLoginForm={setAccountLoginForm}
            onLoginLinkedAccount={() => loginWithSolofleet('linked')}
            unitCategorySectionOpen={unitCategorySectionOpen}
            setUnitCategorySectionOpen={setUnitCategorySectionOpen}
            configuredUnits={configuredUnits}
            filteredConfiguredUnits={filteredConfiguredUnits}
            unitCategorySearch={unitCategorySearch}
            setUnitCategorySearch={setUnitCategorySearch}
            selectedUnitCategoryIds={selectedUnitCategoryIds}
            onToggleUnitCategorySelection={toggleConfiguredUnitSelection}
            onSelectVisibleUnits={selectVisibleConfiguredUnits}
            onClearUnitSelection={clearConfiguredUnitSelection}
            unitCategoryBulkValue={unitCategoryBulkValue}
            setUnitCategoryBulkValue={setUnitCategoryBulkValue}
            onApplyBulkCategory={applyCategoryToSelectedUnits}
            unitCategoryCsvText={unitCategoryCsvText}
            setUnitCategoryCsvText={setUnitCategoryCsvText}
            onImportUnitCategoryCsv={importUnitCategoryCsv}
            onLoadUnitCategoryCsvFile={loadUnitCategoryCsvFile}
            onDownloadUnitCategoryTemplate={downloadUnitCategoryCsvTemplate}
            UNIT_CATEGORY_OPTIONS={UNIT_CATEGORY_OPTIONS}
            normalizeUnitCategory={normalizeUnitCategory}
            unitCategoryLabel={unitCategoryLabel}
            unitCategoryTone={unitCategoryTone}
            tmsConfigSectionOpen={tmsConfigSectionOpen}
            setTmsConfigSectionOpen={setTmsConfigSectionOpen}
            tmsConfig={tmsConfig}
            tmsForm={tmsForm}
            setTmsForm={setTmsForm}
            tmsLogs={tmsLogs}
            tmsLogsBusy={tmsLogsBusy}
            onLoadTmsLogs={loadTmsLogs}
            onSaveTmsConfig={saveTmsConfig}
            onLoginTms={loginWithTms}
            onLogoutTms={logoutTms}
            onTriggerTmsSync={triggerTmsSync}
            onOpenTripMonitor={() => { setActivePanel('trip-monitor'); loadTripMonitorBoard(false).catch(() => {}); }}
            remoteResetSectionOpen={remoteResetSectionOpen}
            setRemoteResetSectionOpen={setRemoteResetSectionOpen}
            remoteResetForm={remoteResetForm}
            setRemoteResetForm={setRemoteResetForm}
            remoteResetStatus={remoteResetStatus}
            remoteResetLogs={remoteResetLogs}
            onLoadRemoteResetLogs={loadRemoteResetLogs}
            onRunRemoteResetNow={runRemoteResetNow}
            onToggleRemoteResetAccount={toggleRemoteResetAccount}
            astroLocationSectionOpen={astroLocationSectionOpen}
            setAstroLocationSectionOpen={setAstroLocationSectionOpen}
            astroLocationForm={astroLocationForm}
            setAstroLocationForm={setAstroLocationForm}
            EMPTY_ASTRO_LOCATION_FORM={EMPTY_ASTRO_LOCATION_FORM}
            astroLocations={astroLocations}
            astroFilteredLocationGroups={astroFilteredLocationGroups}
            geofenceLocationCounts={geofenceLocationCounts}
            selectedAstroLocationIds={selectedAstroLocationIds}
            onToggleAstroLocationSelection={toggleAstroLocationSelection}
            onSelectVisibleAstroLocations={selectVisibleAstroLocations}
            onClearAstroLocationSelection={clearSelectedAstroLocations}
            onSaveAstroLocation={saveAstroLocationEntry}
            onEditAstroLocation={editAstroLocationEntry}
            onDeleteAstroLocation={deleteAstroLocationEntry}
            onDeleteAstroLocations={deleteAstroLocations}
            astroLocationSearch={astroLocationSearch}
            setAstroLocationSearch={setAstroLocationSearch}
            astroLocationExpanded={astroLocationExpanded}
            setAstroLocationExpanded={setAstroLocationExpanded}
            astroCsvText={astroCsvText}
            setAstroCsvText={setAstroCsvText}
            onLoadAstroCsvFile={loadAstroCsvFile}
            onImportAstroLocations={importAstroLocations}
            ASTRO_LOCATION_SAMPLE_CSV={ASTRO_LOCATION_SAMPLE_CSV}
            GEOFENCE_LOCATION_TYPES={GEOFENCE_LOCATION_TYPES}
            GEOFENCE_LOCATION_LABELS={GEOFENCE_LOCATION_LABELS}
            ASTRO_GROUP_PREVIEW_LIMIT={ASTRO_GROUP_PREVIEW_LIMIT}
            fmtCoord={fmtCoord}
            astroRouteSectionOpen={astroRouteSectionOpen}
            setAstroRouteSectionOpen={setAstroRouteSectionOpen}
            astroRouteForm={astroRouteForm}
            setAstroRouteForm={setAstroRouteForm}
            EMPTY_ASTRO_ROUTE_FORM={EMPTY_ASTRO_ROUTE_FORM}
            astroRoutes={astroRoutes}
            astroFilteredRouteGroups={astroFilteredRouteGroups}
            selectedAstroRouteIds={selectedAstroRouteIds}
            onToggleAstroRouteSelection={toggleAstroRouteSelection}
            onSelectVisibleAstroRoutes={selectVisibleAstroRoutes}
            onClearAstroRouteSelection={clearSelectedAstroRoutes}
            onSaveAstroRoute={saveAstroRouteEntry}
            onEditAstroRoute={editAstroRouteEntry}
            onDeleteAstroRoute={deleteAstroRouteEntry}
            onDeleteAstroRoutes={deleteAstroRoutes}
            astroRouteSearch={astroRouteSearch}
            setAstroRouteSearch={setAstroRouteSearch}
            astroRouteExpanded={astroRouteExpanded}
            setAstroRouteExpanded={setAstroRouteExpanded}
            astroRouteCsvText={astroRouteCsvText}
            setAstroRouteCsvText={setAstroRouteCsvText}
            onLoadAstroRouteCsvFile={loadAstroRouteCsvFile}
            onImportAstroRoutes={importAstroRoutes}
            ASTRO_ROUTE_SAMPLE_CSV={ASTRO_ROUTE_SAMPLE_CSV}
            ASTRO_ROUTE_MAX_PODS={ASTRO_ROUTE_MAX_PODS}
            astroRouteAccountOptions={astroRouteAccountOptions}
            astroRouteFilteredUnitOptions={astroRouteFilteredUnitOptions}
            astroWhOptions={astroWhOptions}
            astroPoolOptions={astroPoolOptions}
            astroPodOptions={astroPodOptions}
            astroUnitLabelByKey={astroUnitLabelByKey}
            onAddAstroRoutePod={addAstroRoutePod}
            onRemoveAstroRoutePod={removeAstroRoutePod}
            onUpdateAstroRoutePod={updateAstroRoutePod}
            onUpdateAstroRoutePodSla={updateAstroRoutePodSla}
            createBlankAstroPodSlaArray={createBlankAstroPodSlaArray}
            astroSnapshotConsoleSectionOpen={astroSnapshotConsoleSectionOpen}
            setAstroSnapshotConsoleSectionOpen={setAstroSnapshotConsoleSectionOpen}
            astroSnapshotAutoSync={astroSnapshotAutoSync}
            astroSnapshotLogs={astroSnapshotLogs}
            astroSnapshotLogsBusy={astroSnapshotLogsBusy}
            onLoadAstroSnapshotLogs={loadAstroSnapshotLogs}
            onTriggerAstroSnapshotSync={triggerAstroSnapshotSync}
            astroLocationCardRef={astroLocationCardRef}
            astroRouteCardRef={astroRouteCardRef}
            fmtDate={fmtDate}
            fmtNum={fmtNum}
            accountName={accountName}
          /> : null}
          {activePanel === 'admin' ? <AdminPanel
            webSessionUser={webSessionUser}
            webUsers={webUsers}
            webUserForm={webUserForm}
            setWebUserForm={setWebUserForm}
            onSaveWebUser={saveWebUserEntry}
            onDeleteWebUser={deleteWebUserEntry}
            EMPTY_WEB_USER_FORM={EMPTY_WEB_USER_FORM}
            adminStorageProvider={adminStorageProvider}
            adminTempRollups={adminTempRollups}
            adminPodSnapshots={adminPodSnapshots}
            adminRollupForm={adminRollupForm}
            setAdminRollupForm={setAdminRollupForm}
            adminPodForm={adminPodForm}
            setAdminPodForm={setAdminPodForm}
            EMPTY_ADMIN_ROLLUP_FORM={EMPTY_ADMIN_ROLLUP_FORM}
            EMPTY_ADMIN_POD_FORM={EMPTY_ADMIN_POD_FORM}
            onSaveRollup={saveAdminRollupEntry}
            onDeleteRollup={deleteAdminRollupEntry}
            onSavePod={saveAdminPodEntry}
            onDeletePod={deleteAdminPodEntry}
            onRefreshDb={() => loadAdminDatabase()}
            fmtDate={fmtDate}
            fmtNum={fmtNum}
          /> : null}

          {activePanel === 'stop' ? <StopIdlePanel
            stopForm={stopForm}
            setStopForm={setStopForm}
            stopReport={stopReport}
            fleetRows={fleetRows}
            onLoadReport={loadStopReport}
            onExportStop={exportStop}
            accountName={accountName}
            fmtDate={fmtDate}
            fmtNum={fmtNum}
            fmtCoord={fmtCoord}
            DataTable={DataTable}
          /> : null}
        </div>

        
        </ErrorBoundary>
      </main>
      
      {tripMonitorPanels.map((panel) => <TripMonitorFloatingPanelExtracted
          key={panel.id}
          panel={panel}
          webSessionUser={webSessionUser}
          onClose={() => closeTripMonitorDetail(panel.id)}
          onOpenFleet={() => openTripMonitorInvestigation(panel.detail, 'fleet')}
          onOpenMap={() => openTripMonitorInvestigation(panel.detail, 'map')}
          onOpenHistorical={() => openTripMonitorInvestigation(panel.detail, 'historical')}
          onBringToFront={() => {
            const nextZ = tripMonitorNextZRef.current++;
            setTripMonitorPanels((current) => current.map((item) => item.id === panel.id ? { ...item, zIndex: nextZ } : item));
          }}
          onMove={(position) => setTripMonitorPanels((current) => current.map((item) => item.id === panel.id ? { ...item, position } : item))}
          onResize={(size) => setTripMonitorPanels((current) => current.map((item) => item.id === panel.id ? { ...item, size } : item))}
          renderTemperatureChart={stableRenderTemperatureChart}
          renderUnitRouteMap={stableRenderUnitRouteMap}
          fmtDate={fmtDate}
          fmtNum={fmtNum}
          fmtCoord={fmtCoord}
          formatMinutesText={formatMinutesText}
        />)}
        {/* Astro diagnostics modal now rendered inside AstroReportPanel */}

      {/* Fleet detail modal removed - selected unit detail now renders inline inside FleetWorkspace */}
      
      <StatusFooter
        isPolling={!!status?.runtime?.isPolling}
        nextRunLabel={fmtDate(status?.runtime?.nextRunAt)}
        snapshotLabel={fmtDate(status?.runtime?.lastSnapshotAt)}
        accountName={accountName(currentAccount)}
        errorMessage={status?.runtime?.lastSnapshotError || null}
      />

      {busyOverlay}

      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        commands={cmdPaletteCommands}
      />

      {banner.message && (
        <div className="toast-container" role="status" aria-live="polite">
          <div className={`toast ${banner.tone === 'error' ? 'toast-error' : banner.tone === 'success' ? 'toast-success' : 'toast-info'}`}>
            {banner.tone === 'error' ? <ShieldAlert size={16} /> : <Box size={16} />}
            <span>{banner.message}</span>
            {banner.tone === 'error' ? (
              <button type="button" className="toast-retry-btn" onClick={() => { setBanner({ tone: '', message: '' }); loadDashboard(false, true).catch(() => {}); }} aria-label="Coba lagi">
                <RefreshCw size={13} />
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>

  );
}
function SummaryMetric({ label, value, danger = false }) {
  return <div className={danger ? 'mini-metric mini-metric-danger' : 'mini-metric'}><span>{label}</span><strong>{value}</strong></div>;
}

function FleetExpandedDetails({ row, detail, busy, onOpenTempErrors, onSeeHistorical, rangeLabel }) {
  if (!row) return null;
  const state = health(row);
  const autoRefreshSeconds = 60;
  const routeRecords = detail?.records || [];
  const tripMetrics = calculateTripMetrics(routeRecords);
  return <div className="fleet-expand-shell fleet-expand-shell-modal">
    <div className="fleet-expand-head">
      <div>
        <p className="eyebrow local-eyebrow">Selected unit</p>
        <h3>{row.id} | {row.label}</h3>
        <p className="focus-copy">{row.locationSummary || '-'}{row.zoneName ? ` | ${row.zoneName}` : ''}</p>
        <div className="chip-row">
          <Chip color={state.tone} variant="flat">{state.label}</Chip>
          <Chip variant="flat">{row.customerName || row.group || 'No customer'}</Chip>
          <Chip variant="flat">Updated {fmtAgo(row.minutesSinceUpdate)}</Chip>
          <Chip variant="flat">Auto refresh {autoRefreshSeconds}s</Chip>
          {row.matchedPodSite ? <Chip color="success" variant="flat">POD {row.matchedPodSite.name}</Chip> : null}
          {row.geofenceStatusLabel ? <Chip color={geofenceChipTone(row)} variant="flat">{row.geofenceStatusLabel}</Chip> : null}
          {row.astroActive ? <Chip color={row.astroCurrentLocation ? 'warning' : 'default'} variant="flat">{row.astroStatusLabel}</Chip> : null}
        </div>
      </div>
      <div className="fleet-modal-actions">
        {row.latitude !== null && row.longitude !== null ? <a className="sf-btn sf-btn-bordered fleet-action-link" href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`} target="_blank" rel="noreferrer">Open map</a> : null}
        <Button variant="bordered" onPress={onOpenTempErrors}>Open temp errors</Button>
        <Button variant="bordered" onPress={onSeeHistorical}>See historical</Button>
      </div>
    </div>
        <div className="unit-summary-grid">
      <SummaryMetric label="Temp 1" value={fmtNum(row.liveTemp1)} danger={row.liveSensorFaultType === 'temp1' || row.liveSensorFaultType === 'temp1+temp2'} />
      <SummaryMetric label="Temp 2" value={fmtNum(row.liveTemp2)} danger={row.liveSensorFaultType === 'temp2' || row.liveSensorFaultType === 'temp1+temp2'} />
      <SummaryMetric label="Gap" value={fmtNum(row.liveTempDelta)} />
      <SummaryMetric label="Speed" value={fmtNum(row.speed, 0)} />
      <SummaryMetric label="Trip km" value={fmtNum(tripMetrics.distanceKm, 1)} />
      <SummaryMetric label="Moving" value={formatMinutesText(tripMetrics.movingMinutes)} />
      <SummaryMetric label="Stopped" value={formatMinutesText(tripMetrics.stoppedMinutes)} />
      <SummaryMetric label="Customer setpoint" value={row.targetTempMin !== null || row.targetTempMax !== null ? `${fmtNum(row.targetTempMin)} to ${fmtNum(row.targetTempMax)}` : 'Not set'} danger={rowHasSetpointIssue(row)} />
      <SummaryMetric label="Status" value={row.liveSensorFaultLabel || row.setpointLabel || (rowHasSensorError(row) ? state.label : 'Normal')} danger={rowHasSetpointIssue(row) || rowHasSensorError(row)} />
      <SummaryMetric label="GPS" value={row.errGps || 'OK'} danger={Boolean(row.errGps) || rowHasGpsLate(row)} />
    </div>
    <UnitRouteMap row={row} records={routeRecords} busy={busy} rangeLabel={rangeLabel} />
    <TemperatureChart records={routeRecords} busy={busy} title="Temperature trend" description="Historical Solofleet dari unit yang sedang kamu buka. Hover line buat lihat suhu dan waktu, lalu pakai zoom controls kalau mau fokus ke window tertentu." compact />
  </div>;
}

const FLEET_WORKSPACE_SPLIT_KEY = 'sowhat:fleet-workspace-split';
const FLEET_WORKSPACE_SPLIT_MIN = 0.45;
const FLEET_WORKSPACE_SPLIT_MAX = 0.92;
const FLEET_WORKSPACE_SPLIT_DEFAULT = 0.88;

function readFleetWorkspaceSplit() {
  if (typeof window === 'undefined') return FLEET_WORKSPACE_SPLIT_DEFAULT;
  try {
    const raw = window.localStorage.getItem(FLEET_WORKSPACE_SPLIT_KEY);
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed) && parsed >= FLEET_WORKSPACE_SPLIT_MIN && parsed <= FLEET_WORKSPACE_SPLIT_MAX) {
      return parsed;
    }
  } catch (_err) {
    // ignore
  }
  return FLEET_WORKSPACE_SPLIT_DEFAULT;
}

function FleetWorkspace({
  rows,
  selectedRow,
  onSelectUnit,
  onBack,
  detail,
  detailBusy,
  quickFilter,
  onQuickFilterChange,
  autoFilterCards,
  fleetAccountFilter,
  onFleetAccountFilterChange,
  fleetFilterAccounts,
  fleetCategoryFilter,
  onFleetCategoryFilterChange,
  onExportFleet,
  onOpenTempErrors,
  onSeeHistorical,
  rangeLabel,
  tripMonitorRows = [],
}) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const filteredRows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const haystack = `${row.id || ''} ${row.label || ''} ${row.alias || ''} ${row.accountLabel || row.accountId || ''} ${row.locationSummary || ''} ${row.zoneName || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, deferredSearch]);

  const accountOptions = fleetFilterAccounts || [];
  const categoryOptions = UNIT_CATEGORY_OPTIONS;

  const selectedRowKey = selectedRow ? unitRowKey(selectedRow) : '';

  return (
    <div className="fleet-workspace" data-has-selection={selectedRow ? 'true' : 'false'}>
      <aside className="fleet-workspace-list" aria-label="Fleet list">
        <div className="fleet-workspace-list-toolbar">
          <label className="fleet-workspace-search">
            <span className="sr-only">Cari unit</span>
            <Search size={14} className="fleet-workspace-search-icon" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search units, plates, locations..."
            />
          </label>
          <div className="fleet-workspace-list-filters">
            <select
              aria-label="Account filter"
              value={fleetAccountFilter}
              onChange={(event) => onFleetAccountFilterChange(event.target.value)}
            >
              <option value="all">All accounts</option>
              {accountOptions.map((account) => (
                <option key={account.id} value={account.id}>{account.label || account.authEmail || account.id}</option>
              ))}
            </select>
            <select
              aria-label="Category filter"
              value={fleetCategoryFilter}
              onChange={(event) => onFleetCategoryFilterChange(event.target.value)}
            >
              <option value="all">All categories</option>
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="fleet-workspace-pills" role="tablist" aria-label="Fleet quick filters">
          <button
            type="button"
            role="tab"
            aria-selected={quickFilter === 'all'}
            className={`fleet-workspace-pill ${quickFilter === 'all' ? 'active' : ''}`}
            onClick={() => onQuickFilterChange('all')}
          >
            <span>All</span>
            <span className="fleet-workspace-pill-count">{rows.length}</span>
          </button>
          {autoFilterCards.map((card) => (
            <button
              type="button"
              role="tab"
              aria-selected={quickFilter === card.id}
              key={card.id}
              className={`fleet-workspace-pill ${quickFilter === card.id ? 'active' : ''}`}
              onClick={() => onQuickFilterChange(card.id)}
            >
              <span>{card.label}</span>
              <span className="fleet-workspace-pill-count">{card.count}</span>
            </button>
          ))}
        </div>
        <div className="fleet-workspace-list-meta">
          <span>{filteredRows.length} of {rows.length} units</span>
          <button type="button" className="fleet-workspace-export" onClick={onExportFleet}>Export</button>
        </div>
        <div className="fleet-workspace-rows" role="list">
          {filteredRows.length === 0 ? (
            <div className="fleet-workspace-empty">
              <Navigation size={28} strokeWidth={1.25} />
              <p>No units match this filter.</p>
            </div>
          ) : filteredRows.map((row, idx) => {
            const rowKey = unitRowKey(row);
            const state = health(row);
            const active = rowKey === selectedRowKey;
            const tempFault = row.liveSensorFaultType || '';
            const isMoving = row.isMoving || Number(row.speed || 0) > 0;
            return (
              <button
                type="button"
                key={row.rowKey || rowKey || `fleet-row-${idx}`}
                className={`fleet-workspace-row ${active ? 'is-active' : ''} fleet-workspace-row-${state.tone}`}
                onClick={() => onSelectUnit(row)}
                aria-pressed={active}
                aria-label={`${row.label || row.alias || 'Unit'}: ${state.label}`}
              >
                <span className={`fleet-workspace-row-indicator fleet-workspace-row-indicator-${state.tone}`} aria-hidden />
                <span className="fleet-workspace-row-main">
                  <span className="fleet-workspace-row-top">
                    <span className="fleet-workspace-row-label">{row.label || row.alias || '-'}</span>
                    {isMoving ? <span className="fleet-workspace-row-speed">{fmtNum(row.speed, 0)} km/h</span> : null}
                  </span>
                  <span className="fleet-workspace-row-meta">
                    {row.locationSummary || row.zoneName || 'No location'}
                  </span>
                  <span className="fleet-workspace-row-status">
                    {row.geofenceStatusLabel
                      ? <span className={`fleet-workspace-row-tag fleet-workspace-row-tag-${geofenceChipTone(row)}`}>{row.geofenceStatusLabel}</span>
                      : null}
                    {row.astroActive && row.astroStatusLabel
                      ? <span className={`fleet-workspace-row-tag fleet-workspace-row-tag-${row.astroCurrentLocation ? 'warning' : 'default'}`}>{row.astroStatusLabel}</span>
                      : null}
                    <span className={`fleet-workspace-row-tag fleet-workspace-row-tag-${state.tone}`}>{state.label}</span>
                  </span>
                </span>
                <span className="fleet-workspace-row-temps">
                  <span className={`fleet-workspace-row-temp ${tempFault === 'temp1' || tempFault === 'temp1+temp2' ? 'is-fault' : ''}`}>
                    <span className="fleet-workspace-row-temp-label">T1</span>
                    {fmtNum(row.liveTemp1)}
                  </span>
                  <span className={`fleet-workspace-row-temp ${tempFault === 'temp2' || tempFault === 'temp1+temp2' ? 'is-fault' : ''}`}>
                    <span className="fleet-workspace-row-temp-label">T2</span>
                    {fmtNum(row.liveTemp2)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>
      <section className="fleet-workspace-detail" aria-label="Selected unit detail">
        {selectedRow ? (
          <FleetWorkspaceDetail
            row={selectedRow}
            detail={detail}
            busy={detailBusy}
            rangeLabel={rangeLabel}
            onOpenTempErrors={() => onOpenTempErrors(selectedRow)}
            onSeeHistorical={() => onSeeHistorical(selectedRow)}
            onBack={onBack}
            tripMonitorRows={tripMonitorRows}
            allRows={filteredRows}
            onSelectUnit={onSelectUnit}
          />
        ) : (
          <div className="fleet-workspace-detail-empty">
            <Navigation size={32} strokeWidth={1.25} />
            <p>Select a unit to view its map and temperature chart.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function FleetWorkspaceDetail({ row, detail, busy, rangeLabel, onOpenTempErrors, onSeeHistorical, onBack, tripMonitorRows = [], allRows = [], onSelectUnit }) {
  const [splitRatio, setSplitRatio] = useState(() => readFleetWorkspaceSplit());
  const splitContainerRef = useRef(null);
  const dragStateRef = useRef(null);

  const persistSplit = useCallback((value) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(FLEET_WORKSPACE_SPLIT_KEY, String(value));
    } catch (_err) {
      // ignore
    }
  }, []);

  const handlePointerMove = useCallback((event) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const rect = splitContainerRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    const offset = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    const ratio = Math.min(Math.max(offset / rect.height, FLEET_WORKSPACE_SPLIT_MIN), FLEET_WORKSPACE_SPLIT_MAX);
    setSplitRatio(ratio);
  }, []);

  const handlePointerUp = useCallback(() => {
    dragStateRef.current = null;
    document.body.classList.remove('fleet-workspace-resizing');
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    setSplitRatio((current) => {
      persistSplit(current);
      return current;
    });
  }, [handlePointerMove, persistSplit]);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    dragStateRef.current = { startY: event.clientY, startRatio: splitRatio };
    document.body.classList.add('fleet-workspace-resizing');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    event.preventDefault();
  }, [splitRatio, handlePointerMove, handlePointerUp]);

  useEffect(() => () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    document.body.classList.remove('fleet-workspace-resizing');
  }, [handlePointerMove, handlePointerUp]);

  const state = health(row);
  const routeRecords = detail?.records || [];
  const tripMetrics = calculateTripMetrics(routeRecords);
  const detailKey = unitRowKey(row);

  const tmsThreshold = useMemo(() => {
    if (!Array.isArray(tripMonitorRows) || !tripMonitorRows.length) return null;
    const candidates = [row?.label, row?.alias, row?.id]
      .map((value) => (typeof value === 'string' ? value.trim().toUpperCase() : ''))
      .filter(Boolean);
    if (!candidates.length) return null;
    const match = tripMonitorRows.find((tripRow) => {
      const tripCandidates = [tripRow?.unitLabel, tripRow?.normalizedPlate, tripRow?.unitId]
        .map((value) => (typeof value === 'string' ? value.trim().toUpperCase() : ''))
        .filter(Boolean);
      return tripCandidates.some((value) => candidates.includes(value));
    });
    if (!match) return null;
    const range = normalizeTemperatureRange(match.tempMin, match.tempMax);
    if (range.min === null && range.max === null) return null;
    return { min: range.min, max: range.max, jobOrderId: match.jobOrderId || null };
  }, [tripMonitorRows, row?.label, row?.alias, row?.id]);

  const unitPickerOptions = useMemo(() => allRows.map((r) => ({
    value: unitRowKey(r),
    label: r.label || r.alias || r.id || '-',
    preview: `${r.label || r.id} · ${health(r).label}`,
  })), [allRows]);

  return (
    <div className="fleet-workspace-detail-shell">
      <header className="fleet-workspace-detail-head">
        <div className="fleet-workspace-detail-title">
          {onBack ? (
            <div className="fleet-workspace-detail-nav">
              <button type="button" className="fleet-workspace-detail-back" onClick={onBack} aria-label="Back to fleet list"><ChevronLeft size={16} strokeWidth={2} /><span>Fleet</span></button>
              {onSelectUnit && allRows.length > 1 ? (
                <div className="fleet-workspace-detail-picker">
                  <SearchableSelect
                    label=""
                    value={detailKey}
                    options={unitPickerOptions}
                    onChange={(nextKey) => {
                      const target = allRows.find((r) => unitRowKey(r) === nextKey);
                      if (target) onSelectUnit(target);
                    }}
                    placeholder="Cari unit..."
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="fleet-workspace-detail-name-row">
            <h2>{row.label || row.alias || '-'}</h2>
            <span className={`fleet-workspace-detail-state fleet-workspace-detail-state-${state.tone}`}>{state.label}</span>
          </div>
          <p className="fleet-workspace-detail-meta">{row.accountLabel || row.accountId || '-'} · {row.locationSummary || row.zoneName || 'No location'}</p>
          <div className="fleet-workspace-detail-chips">
            {row.unitCategoryLabel ? <Chip variant="flat">{row.unitCategoryLabel}</Chip> : null}
            {row.customerName ? <Chip variant="flat">{row.customerName}</Chip> : null}
            {row.geofenceStatusLabel ? <Chip color={geofenceChipTone(row)} variant="flat">{row.geofenceStatusLabel}</Chip> : null}
            {row.astroActive && row.astroStatusLabel ? <Chip color={row.astroCurrentLocation ? 'warning' : 'default'} variant="flat">{row.astroStatusLabel}</Chip> : null}
            <Chip variant="flat">Updated {fmtAgo(row.minutesSinceUpdate)}</Chip>
          </div>
        </div>
        <div className="fleet-workspace-detail-actions">
          {row.latitude !== null && row.longitude !== null ? (
            <a
              className="sf-btn sf-btn-bordered fleet-workspace-detail-action"
              href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`}
              target="_blank"
              rel="noreferrer"
            >Maps</a>
          ) : null}
          <Button variant="bordered" onPress={onOpenTempErrors}>Temp errors</Button>
          <Button variant="bordered" onPress={onSeeHistorical}>Historical</Button>
        </div>
      </header>

      <div className="fleet-workspace-detail-metrics">
        <SummaryMetric label="Temp 1" value={fmtNum(row.liveTemp1)} danger={row.liveSensorFaultType === 'temp1' || row.liveSensorFaultType === 'temp1+temp2'} />
        <SummaryMetric label="Temp 2" value={fmtNum(row.liveTemp2)} danger={row.liveSensorFaultType === 'temp2' || row.liveSensorFaultType === 'temp1+temp2'} />
        <SummaryMetric label="Gap" value={fmtNum(row.liveTempDelta)} />
        <SummaryMetric label="Speed" value={fmtNum(row.speed, 0)} />
        <SummaryMetric label="Trip km" value={fmtNum(tripMetrics.distanceKm, 1)} />
        <SummaryMetric label="Setpoint" value={row.targetTempMin !== null || row.targetTempMax !== null ? `${fmtNum(row.targetTempMin)} to ${fmtNum(row.targetTempMax)}` : 'Not set'} danger={rowHasSetpointIssue(row)} />
        <SummaryMetric label="GPS" value={row.errGps || 'OK'} danger={Boolean(row.errGps) || rowHasGpsLate(row)} />
      </div>

      <div
        className="fleet-workspace-split"
        ref={splitContainerRef}
        style={{ '--fleet-split-ratio': splitRatio.toFixed(3) }}
      >
        <div className="fleet-workspace-split-pane fleet-workspace-split-map" key={`map-${detailKey}`}>
          <UnitRouteMap row={row} records={routeRecords} busy={busy} rangeLabel={rangeLabel} />
        </div>
        <div
          className="fleet-workspace-split-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize map and chart"
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              setSplitRatio((current) => {
                const delta = event.key === 'ArrowUp' ? -0.04 : 0.04;
                const next = Math.min(Math.max(current + delta, FLEET_WORKSPACE_SPLIT_MIN), FLEET_WORKSPACE_SPLIT_MAX);
                persistSplit(next);
                return next;
              });
            }
          }}
        >
          <span className="fleet-workspace-split-grip" aria-hidden />
        </div>
        <div className="fleet-workspace-split-pane fleet-workspace-split-chart" key={`chart-${detailKey}`}>
          <TemperatureChart
            records={routeRecords}
            busy={busy}
            title="Temperature trend"
            description="Historical Solofleet dari unit terpilih. Hover line buat lihat suhu tepat di waktu itu."
            compact
            thresholdMin={tmsThreshold?.min ?? null}
            thresholdMax={tmsThreshold?.max ?? null}
            thresholdLabel={tmsThreshold ? (tmsThreshold.jobOrderId ? `TMS · ${tmsThreshold.jobOrderId}` : 'TMS range') : 'Setpoint'}
          />
        </div>
      </div>
    </div>
  );
}

function FleetStatusMap({ rows }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const lastFitKeyRef = useRef('');
  const leaflet = useLeafletModule(true);
  const plottedRows = useMemo(() => (rows || []).filter((row) => Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))), [rows]);
  const plottedRowsFitKey = useMemo(() => plottedRows.map((row) => `${row.accountId || 'primary'}:${row.id}`).sort().join('|'), [plottedRows]);
  const legendItems = useMemo(() => [
    { key: 'temp-single', label: '1 temp error', color: '#f97316' },
    { key: 'temp-both', label: '2 temp error', color: '#ef4444' },
    { key: 'moving', label: 'Moving', color: '#22c55e' },
    { key: 'gps-late', label: 'Late GPS', color: '#eab308' },
    { key: 'stop', label: 'Stop', color: '#94a3b8' },
  ], []);

  useEffect(() => {
    if (!leaflet || !containerRef.current || mapRef.current) return undefined;
    const map = leaflet.map(containerRef.current, { zoomControl: true, attributionControl: true });
    leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    const layer = leaflet.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;
    window.setTimeout(() => map.invalidateSize(), 80);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [leaflet]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!leaflet || !map || !layer) return;
    layer.clearLayers();
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
      marker.bindTooltip(row.label || row.id, { permanent: true, direction: 'top', offset: [0, -14], className: 'fleet-map-label' });
      marker.bindPopup(`<div class="fleet-map-popup"><strong>${row.label || row.id}</strong><div>${row.id}</div><div>${row.accountLabel || row.accountId || '-'}</div><div>${statusMeta.label}</div><div>${row.locationSummary || '-'}</div><div>${region}</div><div>Temp 1 ${fmtNum(row.liveTemp1, 1)} C</div><div>Temp 2 ${fmtNum(row.liveTemp2, 1)} C</div><div>Speed ${fmtNum(row.speed, 0)} km/h</div></div>`);
      marker.addTo(layer);
      bounds.push([latitude, longitude]);
    });
    if (lastFitKeyRef.current !== plottedRowsFitKey) {
      if (bounds.length === 1) map.setView(bounds[0], 11);
      else map.fitBounds(bounds, { padding: [28, 28], maxZoom: 11 });
      lastFitKeyRef.current = plottedRowsFitKey;
    }
    window.setTimeout(() => map.invalidateSize(), 50);
  }, [leaflet, plottedRows, plottedRowsFitKey]);

  return <div className="unit-map-shell unit-map-shell-dark fleet-status-map-shell">
    <div className="unit-map-head">
      <div>
        <strong>All fleet map</strong>
        <span>{rows.length} unit live | {plottedRows.length} titik punya koordinat</span>
      </div>
      <div className="chip-row unit-map-chip-row fleet-map-legend">
        {legendItems.map((item) => <Chip key={item.key} variant="flat"><span className="region-unit-dot" style={{ backgroundColor: item.color }} />{item.label}</Chip>)}
      </div>
    </div>
    <div className="unit-map-frame fleet-status-map-frame">
      <div ref={containerRef} className="unit-map-canvas fleet-status-map-canvas" />
      {!leaflet ? <div className="unit-map-overlay">Loading map...</div> : null}
      {leaflet && !plottedRows.length ? <div className="unit-map-overlay">Belum ada unit dengan koordinat live untuk digambar di map.</div> : null}
    </div>
  </div>;
}

const UnitRouteMap = React.memo(function UnitRouteMap({ row, records, busy, rangeLabel, stops = [], hoveredStopKey = null, onHoverStop = null }) {
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const containerRef = useRef(null);
  const stopMarkerRefs = useRef(new Map());
  const mapInteractionRef = useRef(false);
  const lastFitKeyRef = useRef('');
  const [showRoute, setShowRoute] = useState(true);
  const leaflet = useLeafletModule(true);
  const stopMarkers = useMemo(() => sanitizeTripMonitorStops(stops), [stops]);
  const trackPoints = useMemo(() => {
    const next = [];
    let previousKey = '';
    for (const record of sanitizeRouteRecords(records)) {
      const key = `${record.latitude.toFixed(6)}:${record.longitude.toFixed(6)}`;
      if (key === previousKey) {
        continue;
      }
      previousKey = key;
      next.push({
        latitude: record.latitude,
        longitude: record.longitude,
        timestamp: record.timestampMs || null,
        locationSummary: record.locationSummary || '',
      });
    }
    return next;
  }, [records]);
  const currentPoint = useMemo(() => {
    const latitude = Number(row?.latitude);
    const longitude = Number(row?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    return {
      latitude,
      longitude,
      timestamp: toTimestampMs(row?.lastUpdatedAt) || null,
      locationSummary: row?.locationSummary || '',
    };
  }, [row?.latitude, row?.longitude, row?.lastUpdatedAt, row?.locationSummary]);
  const mapFitKey = useMemo(() => [
    row?.accountId || 'primary',
    row?.id || '',
    rangeLabel || '',
  ].join('::'), [row?.accountId, row?.id, rangeLabel]);
  const buildPopupHtml = (title, point) => [
    `<strong>${title}</strong>`,
    point?.timestamp ? fmtDate(point.timestamp) : '-',
    point?.locationSummary || 'No location',
    `${fmtCoord(point?.latitude)}, ${fmtCoord(point?.longitude)}`,
  ].filter(Boolean).join('<br/>');
  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const buildStopPopupHtml = (stop) => [
    `<strong>${escapeHtml(stop?.name || stop?.label || 'Stop')}</strong>`,
    escapeHtml(stop?.taskAddress || 'No address'),
    stop?.coordinateSource ? `Source: ${escapeHtml(stop.coordinateSource)}` : '',
    `${fmtCoord(stop?.originalLatitude ?? stop?.latitude)}, ${fmtCoord(stop?.originalLongitude ?? stop?.longitude)}`,
  ].filter(Boolean).join('<br/>');

  useEffect(() => {
    if (!leaflet || !containerRef.current || mapRef.current) {
      return undefined;
    }
    const map = leaflet.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    }).setView([row?.latitude || -6.2, row?.longitude || 106.8], 11);
    leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    const layer = leaflet.layerGroup().addTo(map);
    const markUserInteracted = () => {
      mapInteractionRef.current = true;
    };
    ['dragstart', 'zoomstart', 'movestart', 'touchstart'].forEach((eventName) => map.on(eventName, markUserInteracted));
    mapRef.current = map;
    layerRef.current = layer;
    window.setTimeout(() => map.invalidateSize(), 80);
    return () => {
      ['dragstart', 'zoomstart', 'movestart', 'touchstart'].forEach((eventName) => map.off(eventName, markUserInteracted));
      layer.clearLayers();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [leaflet, row?.latitude, row?.longitude]);

  useEffect(() => {
    mapInteractionRef.current = false;
    lastFitKeyRef.current = '';
  }, [mapFitKey]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!leaflet || !map || !layer) {
      return;
    }

    layer.clearLayers();
    const bounds = [];
    const lastTrackPoint = trackPoints.length ? trackPoints[trackPoints.length - 1] : null;
    const currentMatchesLastTrack = currentPoint && lastTrackPoint
      ? Math.abs(currentPoint.latitude - lastTrackPoint.latitude) < 0.00005
        && Math.abs(currentPoint.longitude - lastTrackPoint.longitude) < 0.00005
      : false;

    if (showRoute && trackPoints.length > 1) {
      const latLngs = trackPoints.map((point) => {
        const latLng = [point.latitude, point.longitude];
        bounds.push(latLng);
        return latLng;
      });
      leaflet.polyline(latLngs, {
        color: '#ff7a2f',
        weight: 4,
        opacity: 0.92,
      }).addTo(layer);
    }

    if (trackPoints.length) {
      const startPoint = trackPoints[0];
      bounds.push([startPoint.latitude, startPoint.longitude]);
      leaflet.circleMarker([startPoint.latitude, startPoint.longitude], {
        radius: 6,
        weight: 2,
        color: '#0f172a',
        fillColor: '#34d399',
        fillOpacity: 1,
      }).bindTooltip('Start point').bindPopup(buildPopupHtml('Start point', startPoint)).addTo(layer);

      const endPoint = trackPoints[trackPoints.length - 1];
      bounds.push([endPoint.latitude, endPoint.longitude]);
      if (currentMatchesLastTrack) {
        leaflet.marker([endPoint.latitude, endPoint.longitude], {
          icon: buildTruckDivIcon(leaflet, '#38bdf8', 30),
        }).bindTooltip('Current live position').bindPopup(buildPopupHtml('Current live position', endPoint)).addTo(layer);
      } else {
        leaflet.circleMarker([endPoint.latitude, endPoint.longitude], {
          radius: 7, weight: 2, color: '#0f172a', fillColor: '#fb923c', fillOpacity: 1,
        }).bindTooltip('Last history point').bindPopup(buildPopupHtml('Last history point', endPoint)).addTo(layer);
      }
    }

    if (currentPoint && !currentMatchesLastTrack) {
      bounds.push([currentPoint.latitude, currentPoint.longitude]);
      leaflet.marker([currentPoint.latitude, currentPoint.longitude], {
        icon: buildTruckDivIcon(leaflet, '#38bdf8', 30),
      }).bindTooltip('Current live position').bindPopup(buildPopupHtml('Current live position', currentPoint)).addTo(layer);
    }

    stopMarkerRefs.current.clear();
    stopMarkers.forEach((stop, i) => {
      const stopLatLng = [stop.latitude, stop.longitude];
      const tone = stop.taskType === 'load' ? 'load' : 'unload';
      const key = tripMonitorStopKey(stop, i);
      bounds.push(stopLatLng);
      const marker = leaflet.marker(stopLatLng, {
        icon: leaflet.divIcon({
          className: 'trip-stop-marker-shell',
          html: `<div class="trip-stop-marker trip-stop-marker-${tone}" data-stop-key="${escapeHtml(key)}">${escapeHtml(stop.label)}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
      }).bindPopup(buildStopPopupHtml(stop)).addTo(layer);
      if (key) {
        stopMarkerRefs.current.set(key, marker);
        marker.on('mouseover', () => onHoverStop?.(key));
        marker.on('mouseout', () => onHoverStop?.((current) => (current === key ? null : current)));
      }
    });

    if (!mapInteractionRef.current && lastFitKeyRef.current !== mapFitKey) {
      if (bounds.length === 1) {
        map.setView(bounds[0], 14);
      } else if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
      } else if (currentPoint) {
        map.setView([currentPoint.latitude, currentPoint.longitude], 15);
      }
      lastFitKeyRef.current = mapFitKey;
    }
    window.setTimeout(() => map.invalidateSize(), 50);
  }, [leaflet, trackPoints, currentPoint, showRoute, stopMarkers, mapFitKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const nodes = container.querySelectorAll('.trip-stop-marker');
    nodes.forEach((node) => {
      const matches = node.getAttribute('data-stop-key') === hoveredStopKey;
      node.classList.toggle('is-hovered', !!hoveredStopKey && matches);
    });
  }, [hoveredStopKey, stopMarkers]);

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

  const routePointCount = trackPoints.length;
  const hasMapData = routePointCount > 0 || Boolean(currentPoint) || stopMarkers.length > 0;

  return <div className="unit-map-shell unit-map-shell-dark">
    <div className="unit-map-frame">
      <div ref={containerRef} className="unit-map-canvas" />
      <button
        type="button"
        className="unit-map-route-toggle"
        onClick={() => setShowRoute((current) => !current)}
        aria-pressed={showRoute}
      >
        {showRoute ? 'Hide route' : 'Show route'}
      </button>
      {!leaflet ? <div className="unit-map-overlay">Loading map...</div> : null}
      {leaflet && busy ? <div className="unit-map-overlay">Loading route map...</div> : null}
      {leaflet && !busy && !hasMapData ? <div className="unit-map-overlay">Belum ada koordinat historis untuk digambar di map.</div> : null}
    </div>
  </div>;
});

function OverviewDonutChart({ segments, total }) {
  const safeSegments = (segments || []).filter((segment) => Number(segment?.value || 0) > 0);
  const chartTotal = Math.max(0, Number(total || 0));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const [hoveredKey, setHoveredKey] = useState(null);
  const hoveredSegment = safeSegments.find((segment) => segment.key === hoveredKey) || null;
  let offset = 0;
  return <div className="overview-donut-chart">{hoveredSegment ? <div className="overview-chart-tooltip overview-chart-tooltip-static"><strong>{hoveredSegment.label}</strong><span>{hoveredSegment.value} unit</span><span>{chartTotal > 0 ? fmtPct((hoveredSegment.value / chartTotal) * 100, 1) : '0.0%'}</span></div> : null}<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r={radius} className="overview-donut-track" />{safeSegments.map((segment) => {
    const value = Number(segment.value || 0);
    const length = chartTotal > 0 ? (value / chartTotal) * circumference : 0;
    const circle = <circle key={segment.key} cx="60" cy="60" r={radius} className={`overview-donut-ring ${segment.tone || 'default'} ${hoveredKey === segment.key ? 'is-hovered' : ''}`} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} onMouseEnter={() => setHoveredKey(segment.key)} onMouseLeave={() => setHoveredKey((current) => current === segment.key ? null : current)} />;
    offset += length;
    return circle;
  })}<circle cx="60" cy="60" r="28" className="overview-donut-hole" /></svg><div className="overview-donut-center"><strong>{chartTotal}</strong><span>Configured</span></div></div>;
}

function parseChartDayValue(dayValue) {
  if (!dayValue) return null;
  const text = String(dayValue).trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatChartDayLabel(dayValue) {
  const parsed = parseChartDayValue(dayValue);
  if (parsed) {
    return new Intl.DateTimeFormat('en-GB', { month: 'short', day: '2-digit' }).format(parsed);
  }
  const text = String(dayValue || '').trim();
  return text.length > 6 ? text.slice(text.length - 6) : text;
}

function formatChartDayTitle(dayValue) {
  const parsed = parseChartDayValue(dayValue);
  if (parsed) {
    return new Intl.DateTimeFormat('en-GB', { month: 'long', day: '2-digit' }).format(parsed);
  }
  const text = String(dayValue || '').trim();
  return text || '-';
}

function OverviewMetricLineChart({ points, busy, emptyMessage, valueKey = 'value', maxFloor = 100, tone = 'astro', tooltipTitle, tooltipLines, yAxisSuffix = '', legendLabel = null }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  if (busy) return <div className="overview-chart-empty">Loading chart...</div>;
  if (!(points || []).length) return <div className="overview-chart-empty">{emptyMessage || 'Belum ada data untuk digambar.'}</div>;
  const width = 520;
  const height = 200;
  const paddingLeft = 40;
  const paddingRight = 20;
  const paddingTop = 28;
  const paddingBottom = 36;
  const values = points.map((point) => Number(point?.[valueKey] || 0));
  const maxValue = Math.max(maxFloor, ...values, 1);
  const xStep = points.length > 1 ? (width - paddingLeft - paddingRight) / (points.length - 1) : 0;
  const toX = (index) => paddingLeft + (index * xStep);
  const toY = (value) => height - paddingBottom - ((Number(value || 0) / maxValue) * (height - paddingTop - paddingBottom));
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(index)} ${toY(point?.[valueKey] || 0)}`).join(' ');
  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex] || null;
  const hoveredDotY = hoveredPoint ? toY(hoveredPoint?.[valueKey] || 0) : 0;
  const tooltipLeft = hoveredPoint ? `${Math.max(14, Math.min(86, (toX(hoveredIndex) / width) * 100))}%` : '50%';
  const tooltipTop = hoveredPoint ? `${Math.max(0, Math.min(50, ((hoveredDotY - 60) / height) * 100))}%` : '10%';
  const tooltipRows = hoveredPoint ? (typeof tooltipLines === 'function' ? tooltipLines(hoveredPoint) : [`Value: ${Number(hoveredPoint?.[valueKey] || 0)}`]) : [];
  const title = hoveredPoint ? (typeof tooltipTitle === 'function' ? tooltipTitle(hoveredPoint) : (hoveredPoint.day ? fmtDateOnly(hoveredPoint.day) : hoveredPoint.label || 'Detail')) : '';
  const yGuides = [0, maxValue / 2, maxValue];
  return <div className="overview-trend-chart-container"><div className="overview-trend-chart">{hoveredPoint ? <div className="overview-chart-tooltip" style={{ left: tooltipLeft, top: tooltipTop }}><strong>{title}</strong>{tooltipRows.map((line, index) => <span key={`${title}-${index}`}>{line}</span>)}</div> : null}<svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">{yGuides.map((val, i) => <g key={`yguide-${i}`}><line x1={paddingLeft} x2={width - paddingRight} y1={toY(val)} y2={toY(val)} className="overview-axis-grid" /><text x={paddingLeft - 8} y={toY(val) + 4} className="overview-axis-label" textAnchor="end">{Math.round(val)}{yAxisSuffix}</text></g>)}<line x1={paddingLeft} y1={height - paddingBottom} x2={width - paddingRight} y2={height - paddingBottom} className="overview-axis" /><line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={height - paddingBottom} className="overview-axis" /><path d={linePath} className={`overview-trend-line ${tone}`} />{points.map((point, index) => <g key={`${point.day || point.label || 'point'}-${index}`} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex((current) => current === index ? null : current)}><circle cx={toX(index)} cy={toY(point?.[valueKey] || 0)} r="18" fill="transparent" stroke="none" className="overview-trend-hit" /><circle cx={toX(index)} cy={toY(point?.[valueKey] || 0)} r={hoveredIndex === index ? 7 : 5} className={`overview-trend-dot ${tone} ${hoveredIndex === index ? 'is-hovered' : ''}`} /><text x={toX(index)} y={height - 8} textAnchor="middle" className="overview-trend-label">{formatChartDayLabel(point.day) || String(point.label || '').slice(0, 6)}</text></g>)}</svg></div>{legendLabel ? <div className="overview-chart-legend"><div className="overview-chart-legend-item"><span className={`overview-legend-dot ${tone}`}></span><span>{legendLabel}</span></div></div> : null}</div>;
}

function OverviewMultiLineChart({ points, busy, emptyMessage, lines, maxFloor = 100, tooltipTitle }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  if (busy) return <div className="overview-chart-empty">Loading chart...</div>;
  if (!(points || []).length) return <div className="overview-chart-empty">{emptyMessage || 'Belum ada data untuk digambar.'}</div>;
  const width = 520;
  const height = 200;
  const paddingLeft = 40;
  const paddingRight = 20;
  const paddingTop = 28;
  const paddingBottom = 36;
  const allValues = points.flatMap(p => lines.map(l => Number(p?.[l.key] || 0)));
  const maxValue = Math.max(maxFloor, ...allValues, 1);
  const xStep = points.length > 1 ? (width - paddingLeft - paddingRight) / (points.length - 1) : 0;
  const toX = (index) => paddingLeft + (index * xStep);
  const toY = (value) => height - paddingBottom - ((Number(value || 0) / maxValue) * (height - paddingTop - paddingBottom));
  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex] || null;
  const hoveredDotYList = hoveredPoint ? lines.map(l => toY(hoveredPoint?.[l.key] || 0)) : [];
  const minHoveredY = hoveredDotYList.length ? Math.min(...hoveredDotYList) : 0;
  const tooltipLeft = hoveredPoint ? `${Math.max(14, Math.min(86, (toX(hoveredIndex) / width) * 100))}%` : '50%';
  const tooltipTop = hoveredPoint ? `${Math.max(0, Math.min(50, ((minHoveredY - 60) / height) * 100))}%` : '10%';
  const title = hoveredPoint ? (typeof tooltipTitle === 'function' ? tooltipTitle(hoveredPoint) : (hoveredPoint.day ? fmtDateOnly(hoveredPoint.day) : hoveredPoint.label || 'Detail')) : '';
  const yGuides = [0, maxValue / 2, maxValue];
  return <div className="overview-trend-chart-container"><div className="overview-trend-chart">{hoveredPoint ? <div className="overview-chart-tooltip" style={{ left: tooltipLeft, top: tooltipTop }}><strong>{title}</strong>{lines.map((l, i) => <span key={l.key || i} style={{color: l.colorHex}}>{l.label}: {fmtPct(hoveredPoint[l.key] || 0)}</span>)}</div> : null}<svg viewBox={"0 0 " + width + " " + height} aria-hidden="true">{yGuides.map((val, i) => <g key={`yguide-${i}`}><line x1={paddingLeft} x2={width - paddingRight} y1={toY(val)} y2={toY(val)} className="overview-axis-grid" /><text x={paddingLeft - 8} y={toY(val) + 4} className="overview-axis-label" textAnchor="end">{Math.round(val)}%</text></g>)}<line x1={paddingLeft} y1={height - paddingBottom} x2={width - paddingRight} y2={height - paddingBottom} className="overview-axis" /><line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={height - paddingBottom} className="overview-axis" />{lines.map(l => {
    const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(index)} ${toY(point?.[l.key] || 0)}`).join(' ');
    return <path key={l.key} d={linePath} fill="none" stroke={l.colorHex || 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
  })}{points.map((point, index) => <g key={"point-"+index} onMouseEnter={() => setHoveredIndex(index)} onMouseLeave={() => setHoveredIndex((current) => current === index ? null : current)}><circle cx={toX(index)} cy={toY(point?.[lines[0]?.key] || 0)} r="18" fill="transparent" stroke="none" className="overview-trend-hit" />{lines.map((l, lIdx) => <circle key={"dot-"+lIdx} cx={toX(index)} cy={toY(point?.[l.key] || 0)} r={hoveredIndex === index ? 5 : 3} fill={l.colorHex || 'currentColor'} stroke="none" />)}<text x={toX(index)} y={height - 8} textAnchor="middle" className="overview-trend-label">{formatChartDayLabel(point.day) || String(point.label || '').slice(0, 6)}</text></g>)}</svg></div><div className="overview-chart-legend">{lines.map((l, i) => <div key={i} className="overview-chart-legend-item"><span className="overview-legend-dot-custom" style={{backgroundColor: l.colorHex}}></span><span>{l.label}</span></div>)}</div></div>;
}

function OverviewAstroTrendChart({ points, busy }) {
  return <OverviewMetricLineChart points={points} busy={busy} emptyMessage="Belum ada data Astro KPI di range ini." valueKey="passRate" maxFloor={100} tone="astro" tooltipTitle={(point) => formatChartDayTitle(point.day)} tooltipLines={(point) => [`Pass rate: ${fmtPct(point.passRate || 0)}`, `Eligible rit: ${point.eligibleRows || 0}`, `Pass: ${point.passRows || 0}`, `Fail: ${point.failRows || 0}`]} yAxisSuffix="%" legendLabel="Pass Rate" />;
}

function OverviewTempTrendChart({ points, busy }) {
  return <OverviewMetricLineChart points={points} busy={busy} emptyMessage="Belum ada temp error di range ini." valueKey="incidents" maxFloor={1} tone="danger" tooltipTitle={(point) => formatChartDayTitle(point.day)} tooltipLines={(point) => [`Incidents: ${point.incidents || 0}`, `Affected units: ${point.affectedUnits || 0}`, `Total duration: ${formatMinutesText(point.totalMinutes || 0)}`]} legendLabel="Incidents" />;
}

function OverviewBarList({ items, busy, emptyMessage, valueKey = 'value', valueFormatter, metaFormatter, tone = 'default', tooltipTitle, tooltipLines }) {
  const [hoveredKey, setHoveredKey] = useState(null);
  if (busy) return <div className="overview-chart-empty">Loading chart...</div>;
  if (!(items || []).length) return <div className="overview-chart-empty">{emptyMessage || 'Belum ada data untuk ditampilkan.'}</div>;
  const maxValue = Math.max(1, ...items.map((item) => Number(item?.[valueKey] || 0)));
  const hoveredItem = items.find((item) => (item.key || item.label) === hoveredKey) || null;
  const hoveredTitle = hoveredItem ? (typeof tooltipTitle === 'function' ? tooltipTitle(hoveredItem) : hoveredItem.label) : '';
  const hoveredLines = hoveredItem ? (typeof tooltipLines === 'function' ? tooltipLines(hoveredItem) : [metaFormatter ? metaFormatter(hoveredItem) : `${Number(hoveredItem?.[valueKey] || 0)}`]) : [];
  return <div className="overview-bar-list">{hoveredItem ? <div className="overview-chart-tooltip overview-chart-tooltip-static"><strong>{hoveredTitle}</strong>{hoveredLines.filter(Boolean).map((line, index) => <span key={`${hoveredTitle}-${index}`}>{line}</span>)}</div> : null}{items.map((item) => {
    const rawValue = Number(item?.[valueKey] || 0);
    const width = `${Math.max(8, (rawValue / maxValue) * 100)}%`;
    const appliedTone = item.tone || tone;
    return <div key={item.key || item.label} className={`overview-bar-row ${hoveredKey === (item.key || item.label) ? 'is-hovered' : ''}`} onMouseEnter={() => setHoveredKey(item.key || item.label)} onMouseLeave={() => setHoveredKey((current) => current === (item.key || item.label) ? null : current)}><div className="overview-bar-copy"><strong title={item.label}>{item.label}</strong><small>{metaFormatter ? metaFormatter(item) : ''}</small></div><div className="overview-bar-track"><span className={`overview-bar-fill ${appliedTone}`} style={{ width }} /></div><div className="overview-bar-value">{valueFormatter ? valueFormatter(rawValue, item) : rawValue}</div></div>;
  })}</div>;
}

function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const v = Number.isFinite(min) ? min : 0;
    return [v - 1, v, v + 1];
  }
  const range = max - min;
  const rough = range / Math.max(1, count - 1);
  const pow = Math.pow(10, Math.floor(Math.log10(Math.abs(rough) || 1)));
  const fraction = rough / pow;
  let nice;
  if (fraction < 1.5) nice = 1;
  else if (fraction < 3) nice = 2;
  else if (fraction < 7) nice = 5;
  else nice = 10;
  const step = nice * pow;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(parseFloat(v.toFixed(10)));
  }
  return ticks;
}

const TemperatureChart = React.memo(function TemperatureChart({ records, busy, title, description, compact = false, chartHeight = null, thresholdMin = null, thresholdMax = null, thresholdLabel = 'Setpoint' }) {
  const chartId = useId().replace(/:/g, '');
  const chartContainerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(860);
  const normalizedThresholdRange = normalizeTemperatureRange(thresholdMin, thresholdMax);
  const fullSeries = useMemo(() => (records || [])
    .filter((record) => record.temp1 !== null || record.temp2 !== null)
    .map((record) => ({ ...record, timestamp: toTimestampMs(record.timestamp) || null }))
    .sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0)), [records]);
  const [zoomRange, setZoomRange] = useState({ start: 0, end: 0 });
  const [hoverIndex, setHoverIndex] = useState(null);
  const [dragState, setDragState] = useState(null);

  useEffect(() => {
    setZoomRange({ start: 0, end: Math.max(0, fullSeries.length - 1) });
    setHoverIndex(null);
    setDragState(null);
  }, [fullSeries.length, fullSeries[0]?.timestamp, fullSeries[fullSeries.length - 1]?.timestamp]);

  useEffect(() => {
    const node = chartContainerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const w = node.getBoundingClientRect().width;
      if (w > 0) setContainerWidth(Math.round(w));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (busy) return <div className="chart-empty">Loading chart...</div>;
  if (!fullSeries.length) return <div className="chart-empty">Belum ada historical temperature yang cukup buat digambar.</div>;

  const totalPoints = fullSeries.length;
  const rangeStart = Math.max(0, Math.min(zoomRange.start, totalPoints - 1));
  const rangeEnd = Math.max(rangeStart, Math.min(zoomRange.end, totalPoints - 1));
  const series = fullSeries.slice(rangeStart, rangeEnd + 1);
  const width = Math.max(300, containerWidth);
  const height = Number.isFinite(Number(chartHeight)) && Number(chartHeight) > 0
    ? Number(chartHeight)
    : compact ? 180 : 240;
  const padding = { top: 18, right: 24, bottom: 44, left: 56 };
  const thresholdValues = [normalizedThresholdRange.min, normalizedThresholdRange.max].filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
    const temps = series.flatMap((record) => [record.temp1, record.temp2]).filter((value) => value !== null && value !== undefined).concat(thresholdValues);
    const rawMin = Math.min(...temps);
    const rawMax = Math.max(...temps);
    const pad = Math.max(1, (rawMax - rawMin) * 0.15 || 1);
    const yTicks = niceTicks(rawMin - pad, rawMax + pad, 5);
    const minY = yTicks[0];
    const maxY = yTicks[yTicks.length - 1];
    const isNegativeRange = normalizedThresholdRange.min < 0 && normalizedThresholdRange.max <= 0;
    const minLabel = isNegativeRange ? `${thresholdLabel} max` : `${thresholdLabel} min`;
    const maxLabel = isNegativeRange ? `${thresholdLabel} min` : `${thresholdLabel} max`;

    const thresholdGuides = [
      normalizedThresholdRange.min !== null && Number.isFinite(Number(normalizedThresholdRange.min)) ? { key: 'min', value: Number(normalizedThresholdRange.min), color: 'var(--chart-threshold-low)', label: minLabel } : null,
      normalizedThresholdRange.max !== null && Number.isFinite(Number(normalizedThresholdRange.max)) ? { key: 'max', value: Number(normalizedThresholdRange.max), color: 'var(--chart-threshold-high)', label: maxLabel } : null,
    ].filter(Boolean);
  const timeStart = series[0].timestamp;
  const timeEnd = series[series.length - 1].timestamp;
  const xFor = (timestamp) => timeStart === timeEnd ? padding.left : padding.left + ((timestamp - timeStart) / (timeEnd - timeStart)) * (width - padding.left - padding.right);
  const yFor = (value) => value === null || value === undefined ? null : height - padding.bottom - ((value - minY) / (maxY - minY || 1)) * (height - padding.top - padding.bottom);
  const buildPath = (field) => {
    const pts = [];
    for (const point of series) {
      const y = yFor(point[field]);
      if (y === null) continue;
      pts.push({ x: xFor(point.timestamp), y });
    }
    if (!pts.length) return '';
    if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    const tension = 0.18;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) * tension;
      const c1y = p1.y + (p2.y - p0.y) * tension;
      const c2x = p2.x - (p3.x - p1.x) * tension;
      const c2y = p2.y - (p3.y - p1.y) * tension;
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  };
  const temp1Path = buildPath('temp1');
  const temp2Path = buildPath('temp2');
  const guideValues = yTicks;
  const xTickCount = compact ? 5 : 6;
  const timeGuides = timeStart === timeEnd
    ? [timeStart]
    : Array.from({ length: xTickCount }, (_, i) => timeStart + ((timeEnd - timeStart) * i) / (xTickCount - 1));
  const spansMultipleDays = timeStart && timeEnd && new Date(timeStart).toDateString() !== new Date(timeEnd).toDateString();
  const plottedPoints = series.map((record, index) => ({
    record,
    absoluteIndex: rangeStart + index,
    x: xFor(record.timestamp),
    temp1Y: yFor(record.temp1),
    temp2Y: yFor(record.temp2),
  }));
  const hoveredPoint = hoverIndex === null ? null : plottedPoints.find((point) => point.absoluteIndex === hoverIndex) || null;
  const windowSize = rangeEnd - rangeStart + 1;
  const canZoomIn = totalPoints > 8 && windowSize > 8;
  const canZoomOut = windowSize < totalPoints;
  const autoRefreshSeconds = 60;
  const clampPlotX = (x) => Math.max(padding.left, Math.min(width - padding.right, x));
  const eventToSvgX = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return clampPlotX(((event.clientX - rect.left) / rect.width) * width);
  };
  const findNearestPoint = (x) => plottedPoints.reduce((best, point) => {
    if (!best) return point;
    return Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best;
  }, null);
  const xToAbsoluteIndex = (x) => {
    const nearest = findNearestPoint(x);
    return nearest ? nearest.absoluteIndex : rangeStart;
  };

  const setRangeAround = (anchorIndex, nextWindowSize) => {
    const clampedWindow = Math.max(8, Math.min(totalPoints, nextWindowSize));
    let start = Math.max(0, anchorIndex - Math.floor(clampedWindow / 2));
    let end = Math.min(totalPoints - 1, start + clampedWindow - 1);
    start = Math.max(0, end - clampedWindow + 1);
    setZoomRange({ start, end });
  };

  const zoomIn = () => {
    if (!canZoomIn) return;
    const anchor = hoverIndex ?? Math.floor((rangeStart + rangeEnd) / 2);
    setRangeAround(anchor, Math.floor(windowSize * 0.65));
  };

  const zoomOut = () => {
    if (!canZoomOut) return;
    const anchor = hoverIndex ?? Math.floor((rangeStart + rangeEnd) / 2);
    setRangeAround(anchor, Math.ceil(windowSize * 1.45));
  };

  const resetZoom = () => {
    setZoomRange({ start: 0, end: totalPoints - 1 });
    setDragState(null);
  };

  const handlePointerMove = (event) => {
    const x = eventToSvgX(event);
    const nearest = findNearestPoint(x);
    setHoverIndex(nearest ? nearest.absoluteIndex : null);
    setDragState((current) => current ? { ...current, currentX: x } : current);
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    const x = eventToSvgX(event);
    setDragState({ startX: x, currentX: x });
    const nearest = findNearestPoint(x);
    setHoverIndex(nearest ? nearest.absoluteIndex : null);
  };

  const handlePointerUp = () => {
    if (!dragState) return;
    const startX = clampPlotX(dragState.startX);
    const endX = clampPlotX(dragState.currentX);
    setDragState(null);
    if (Math.abs(endX - startX) < 14) return;
    const nextStart = xToAbsoluteIndex(Math.min(startX, endX));
    const nextEnd = xToAbsoluteIndex(Math.max(startX, endX));
    if (nextEnd <= nextStart) return;
    setZoomRange({ start: nextStart, end: nextEnd });
    setHoverIndex(Math.round((nextStart + nextEnd) / 2));
  };

  const handlePointerLeave = () => {
    if (!dragState) {
      setHoverIndex(null);
    }
  };

  const tooltipLeft = hoveredPoint ? `${Math.max(12, Math.min(88, (hoveredPoint.x / width) * 100))}%` : '50%';
  const tooltipTop = hoveredPoint ? `${Math.max(12, Math.min(72, ((Math.min(hoveredPoint.temp1Y ?? height, hoveredPoint.temp2Y ?? height) - 18) / height) * 100))}%` : '12%';
  const selectionStart = dragState ? Math.min(dragState.startX, dragState.currentX) : 0;
  const selectionWidth = dragState ? Math.abs(dragState.currentX - dragState.startX) : 0;

  return <div className={compact ? 'chart-shell chart-shell-compact' : 'chart-shell'}>
    <div className="chart-meta">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="chart-tools">
        <div className="chart-legend">
            <span><i className="legend-dot legend-dot-temp1" /> Temp 1</span>
            <span><i className="legend-dot legend-dot-temp2" /> Temp 2</span>
            {thresholdGuides.map((guide) => <span key={guide.key}><i className="legend-dot legend-dot-threshold" style={{ background: guide.color }} /> {guide.label}</span>)}
            <span className="chart-refresh-note">Drag chart untuk box zoom</span>
            <span className="chart-refresh-note">Auto refresh {autoRefreshSeconds}s</span>
          </div>
        <div className="chart-zoom-controls">
          <Button variant="light" onPress={zoomIn} disabled={!canZoomIn}>Zoom in</Button>
          <Button variant="light" onPress={zoomOut} disabled={!canZoomOut}>Zoom out</Button>
          <Button variant="light" onPress={resetZoom} disabled={!canZoomOut}>Reset</Button>
        </div>
      </div>
    </div>
    <div className="chart-stage" ref={chartContainerRef}>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Temperature trend chart" onMouseDown={handlePointerDown} onMouseMove={handlePointerMove} onMouseUp={handlePointerUp} onMouseLeave={handlePointerLeave}>
        <defs>
          <linearGradient id={`fillTemp1-${chartId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-temp1)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--chart-temp1)" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id={`fillTemp2-${chartId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-temp2)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--chart-temp2)" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="10" fill="var(--chart-panel-fill)" />
        <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} stroke="var(--chart-axis-stroke)" strokeWidth="1" />
        <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} stroke="var(--chart-axis-stroke)" strokeWidth="1" />
        {guideValues.map((value, index) => {
            const y = yFor(value);
            if (y === null || y < padding.top - 0.5 || y > height - padding.bottom + 0.5) return null;
            return <g key={`guide-${index}`}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--chart-guide-stroke)" strokeDasharray="2 4" />
              <line x1={padding.left - 4} x2={padding.left} y1={y} y2={y} stroke="var(--chart-axis-stroke)" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 3.5} fontSize="11" textAnchor="end" fill="var(--chart-guide-text)" className="chart-axis-tick">{Number(value).toFixed(0)}°</text>
            </g>;
          })}
        <text x={14} y={padding.top + (height - padding.top - padding.bottom) / 2} fontSize="10" textAnchor="middle" fill="var(--chart-axis-label)" className="chart-axis-label" transform={`rotate(-90 14 ${padding.top + (height - padding.top - padding.bottom) / 2})`}>Temperature (°C)</text>
        {thresholdGuides.length === 2 ? (() => {
          const yMin = yFor(thresholdGuides[0].value);
          const yMax = yFor(thresholdGuides[1].value);
          if (yMin === null || yMax === null) return null;
          const top = Math.min(yMin, yMax);
          const bottom = Math.max(yMin, yMax);
          return <rect key={`threshold-band-${thresholdGuides[0].value}-${thresholdGuides[1].value}`} className="chart-threshold-band" x={padding.left} y={top} width={width - padding.left - padding.right} height={Math.max(0, bottom - top)} fill="var(--chart-threshold-band)" pointerEvents="none" />;
        })() : null}
        {thresholdGuides.map((guide) => {
            const y = yFor(guide.value);
            if (y === null) return null;
            return <g key={`threshold-${guide.key}`}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke={guide.color} strokeWidth="1" strokeDasharray="6 5" opacity="0.75" />
              <text x={width - padding.right - 6} y={y - 4} textAnchor="end" fontSize="10" fill={guide.color} className="chart-axis-tick">{guide.label} · {fmtNum(guide.value, 1)}°</text>
            </g>;
          })}
        {timeGuides.map((value, index) => {
          const x = xFor(value);
          const isFirst = index === 0;
          const isLast = index === timeGuides.length - 1;
          const showDate = spansMultipleDays && (isFirst || isLast);
          return <g key={`time-${index}`}>
            <line x1={x} x2={x} y1={height - padding.bottom} y2={height - padding.bottom + 4} stroke="var(--chart-axis-stroke)" strokeWidth="1" />
            <text x={x} y={height - padding.bottom + 18} fontSize="11" textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'} fill="var(--chart-guide-text)" className="chart-axis-tick">{fmtClock(value)}</text>
            {showDate ? <text x={x} y={height - padding.bottom + 32} fontSize="10" textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'} fill="var(--chart-axis-label)" className="chart-axis-label">{fmtDateOnly(value)}</text> : null}
          </g>;
        })}
        <text x={padding.left + (width - padding.left - padding.right) / 2} y={height - 4} fontSize="10" textAnchor="middle" fill="var(--chart-axis-label)" className="chart-axis-label">Time</text>
        {(() => {
          const animKey = `${totalPoints}-${rangeStart}-${rangeEnd}-${timeStart}-${timeEnd}`;
          return <g key={animKey}>
            {temp1Path ? <path className="chart-area-anim" d={`${temp1Path} L ${xFor(timeEnd)} ${height - padding.bottom} L ${xFor(timeStart)} ${height - padding.bottom} Z`} fill={`url(#fillTemp1-${chartId})`} /> : null}
            {temp2Path ? <path className="chart-area-anim" d={`${temp2Path} L ${xFor(timeEnd)} ${height - padding.bottom} L ${xFor(timeStart)} ${height - padding.bottom} Z`} fill={`url(#fillTemp2-${chartId})`} /> : null}
            {temp2Path ? <path className="chart-path-anim" pathLength="1" d={temp2Path} fill="none" stroke="var(--chart-temp2)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /> : null}
            {temp1Path ? <path className="chart-path-anim" pathLength="1" d={temp1Path} fill="none" stroke="var(--chart-temp1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null}
          </g>;
        })()}
        {dragState && selectionWidth > 0 ? <rect x={selectionStart} y={padding.top} width={selectionWidth} height={height - padding.top - padding.bottom} fill="rgba(16,185,129,0.10)" stroke="rgba(16,185,129,0.55)" strokeDasharray="4 4" rx="4" /> : null}
        {hoveredPoint ? <g>
          <line x1={hoveredPoint.x} x2={hoveredPoint.x} y1={padding.top} y2={height - padding.bottom} stroke="var(--chart-crosshair-stroke)" strokeDasharray="3 4" />
          {hoveredPoint.temp1Y !== null ? <circle cx={hoveredPoint.x} cy={hoveredPoint.temp1Y} r="4" fill="var(--chart-temp1)" stroke="var(--chart-point-stroke)" strokeWidth="2" /> : null}
          {hoveredPoint.temp2Y !== null ? <circle cx={hoveredPoint.x} cy={hoveredPoint.temp2Y} r="4" fill="var(--chart-temp2)" stroke="var(--chart-point-stroke)" strokeWidth="2" /> : null}
        </g> : null}
      </svg>
      {hoveredPoint ? <div className="chart-tooltip" style={{ left: tooltipLeft, top: tooltipTop }}>
        <strong>{fmtDate(hoveredPoint.record.timestamp)}</strong>
        {hoveredPoint.record.temp1 !== null && hoveredPoint.record.temp1 !== undefined ? <span>Temp 1: {fmtNum(hoveredPoint.record.temp1, 2)} C</span> : null}
        {hoveredPoint.record.temp2 !== null && hoveredPoint.record.temp2 !== undefined ? <span>Temp 2: {fmtNum(hoveredPoint.record.temp2, 2)} C</span> : null}
        {hoveredPoint.record.speed !== null && hoveredPoint.record.speed !== undefined ? <span>Speed: {fmtNum(hoveredPoint.record.speed, 0)} km/h</span> : null}
      </div> : null}
    </div>
  </div>;
});

function SearchableSelect({ label, value, options, onChange, placeholder = 'Search option...' }) {
  const wrapperRef = useRef(null);
  const searchInputRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value) || null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => {
      const haystacks = [option.label, option.value, option.preview];
      return haystacks.some((candidate) => String(candidate || '').toLowerCase().includes(normalizedQuery));
    })
    : options;

  const pickOption = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
  };

  return <label className="field searchable-field" ref={wrapperRef}><span>{label}</span><button type="button" className={`searchable-trigger ${open ? 'is-open' : ''}`} title={selectedOption?.preview || selectedOption?.label || placeholder} onClick={() => setOpen((current) => !current)}><span className={`searchable-trigger-text ${selectedOption ? '' : 'is-placeholder'}`}>{selectedOption?.label || placeholder}</span><span className="searchable-trigger-icon">v</span></button>{open ? <div className="searchable-dropdown"><div className="searchable-dropdown-search"><Search size={14} /><input ref={searchInputRef} type="text" aria-label={`Search ${label}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} /></div><div className="searchable-dropdown-list">{filteredOptions.length ? filteredOptions.map((option) => <button key={`${label}-${option.value || 'empty'}`} type="button" className={`searchable-option ${option.value === value ? 'is-selected' : ''}`} title={option.preview || option.label} onMouseDown={(event) => event.preventDefault()} onClick={() => pickOption(option.value)}>{option.label}</button>) : <div className="searchable-empty">No match found</div>}</div></div> : null}</label>;
}

function DataTable({ columns, rows, emptyMessage, getRowProps, className = '', shellClassName = '', pagination = null }) {
  const rowsPerPageOptions = pagination?.rowsPerPageOptions || [10, 20, 50];
  const initialRowsPerPage = pagination?.initialRowsPerPage || rowsPerPageOptions[0] || 10;
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setRowsPerPage(initialRowsPerPage);
    setPage(1);
  }, [rows.length, initialRowsPerPage]);

  const totalPages = pagination ? Math.max(1, Math.ceil(rows.length / rowsPerPage)) : 1;
  const pageStart = pagination ? (page - 1) * rowsPerPage : 0;
  const visibleRows = pagination ? rows.slice(pageStart, pageStart + rowsPerPage) : rows;

  useEffect(() => {
    if (!pagination) return;
    setPage((current) => Math.min(current, totalPages));
  }, [pagination, totalPages]);

  if (!rows.length) return <div className="empty-state">{emptyMessage}</div>;
  return <div className={`table-shell${shellClassName ? ` ${shellClassName}` : ''}`}><table className={`data-table${className ? ` ${className}` : ''}`}><thead><tr>{columns.map((column, columnIndex) => {
    const columnKey = typeof column === 'string' ? column : column.key || `column-${columnIndex}`;
    const columnLabel = typeof column === 'string' ? column : column.label;
    return <th key={columnKey}>{columnLabel}</th>;
  })}</tr></thead><tbody>{visibleRows.map((row, rowIndex) => {
    const absoluteRowIndex = pageStart + rowIndex;
    const rowProps = getRowProps ? getRowProps(row, absoluteRowIndex) : {};
    const { key, className: rowClassName, ...restRowProps } = rowProps || {};
    return <tr key={key || `row-${absoluteRowIndex}`} className={rowClassName || ''} {...restRowProps}>{row.map((cell, cellIndex) => <td key={`cell-${absoluteRowIndex}-${cellIndex}`}>{cell}</td>)}</tr>;
  })}</tbody></table>{pagination ? <div className="table-pagination"><div className="table-pagination-meta"><span>Rows per page</span><select aria-label="Rows per page" value={rowsPerPage} onChange={(event) => {
    const nextRowsPerPage = Number(event.target.value || initialRowsPerPage);
    setRowsPerPage(nextRowsPerPage);
    setPage(1);
  }}>{rowsPerPageOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></div><div className="table-pagination-meta">Page {page} of {totalPages}</div><div className="table-pagination-controls"><button type="button" className="table-page-button" aria-label="First page" onClick={() => setPage(1)} disabled={page <= 1}>{'<<'}</button><button type="button" className="table-page-button" aria-label="Previous page" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>{'<'}</button><button type="button" className="table-page-button" aria-label="Next page" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>{'>'}</button><button type="button" className="table-page-button" aria-label="Last page" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>{'>>'}</button></div></div> : null}</div>;
}








































































































