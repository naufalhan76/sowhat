
import React, { startTransition, useEffect, useId, useMemo, useRef, useState, useDeferredValue } from 'react';
import {
  Activity, ArrowRight, BarChart3, Box, ChevronLeft, ChevronRight,
  Flag, LayoutDashboard, Map as MapIcon, Navigation,
  RefreshCw, Settings, ShieldAlert, Thermometer, Zap, Search
} from 'lucide-react';
import L from 'leaflet';
const Button = ({ children, variant, color, className = '', onPress, ...props }) => {
  const baseClass = variant === 'bordered' ? 'sf-btn-bordered' : variant === 'light' ? 'sf-btn-light' : 'sf-btn-primary';
  return <button type="button" className={`sf-btn ${baseClass} ${className}`} onClick={onPress} {...props}>{children}</button>;
};

const Card = React.forwardRef(({ children, className = '', ...props }, ref) => <div ref={ref} className={`sf-card ${className}`} {...props}>{children}</div>);
const CardHeader = ({ children, className = '' }) => <div className={`sf-card-header ${className}`}>{children}</div>;
const CardContent = ({ children, className = '' }) => <div className={`sf-card-content ${className}`}>{children}</div>;

const Chip = ({ children, variant, color = 'default', className = '' }) => {
  return <span className={`sf-chip sf-chip-${color} ${className}`}>{children}</span>;
};

const Link = ({ children, className = '', ...props }) => <a className={`sf-link ${className}`} {...props}>{children}</a>;
const Spinner = ({ size }) => <span className={`sf-spinner ${size === 'sm' ? 'sf-spinner-sm' : ''}`} />;

const BrandLockup = ({ compact = false }) => <div className={`brand-lockup ${compact ? 'brand-lockup-compact' : ''}`}>
  <div className="brand-mark">Sowhat</div>
  <div className="brand-cross">x</div>
  <div className="brand-wordmark">Solo<span>fleet</span></div>
</div>;
// removed object import

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
const EMPTY_ASTRO_LOCATION_FORM = { id: '', name: '', latitude: '', longitude: '', radiusMeters: '150', type: 'POD', isActive: true, notes: '' };
const ASTRO_GROUP_PREVIEW_LIMIT = 5;
const ASTRO_ROUTE_MAX_PODS = 5;
const EMPTY_ASTRO_ROUTE_FORM = { id: '', accountId: 'primary', unitId: '', customerName: 'Astro', whLocationId: '', poolLocationId: '', podSequence: [''], rit1Start: '05:00', rit1End: '14:59', rit2Enabled: false, rit2Start: '19:00', rit2End: '06:00', isActive: true, notes: '' };
const ASTRO_LOCATION_SAMPLE_CSV = ['Nama Tempat,Latitude,Longitude,Radius,Type', 'Astro WH CBN,-6.296412,107.146281,180,WH', 'Astro POD Bekasi Timur,-6.238765,106.999321,120,POD', 'Astro Pool Cakung,-6.182450,106.935870,160,POOL'].join('\n');
const ASTRO_ROUTE_SAMPLE_CSV = ['Account ID,Nopol,Customer,WH,POOL,POD1,POD2,POD3,POD4,POD5,Rit1 Start,Rit1 End,Rit2 Enabled,Rit2 Start,Rit2 End,Active,Notes', 'primary,B 9749 SXW,Astro,Astro WH CBN,Astro Pool Cakung,Astro POD Bekasi Timur,,,,,05:00,14:59,false,19:00,06:00,true,Rit pagi only'].join('\n');

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
const DISPLAY_TIMEZONE = 'Asia/Bangkok';
const fmtDate = (value) => {
  const parsed = parseDateValue(value);
  return parsed ? new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: DISPLAY_TIMEZONE }).format(parsed) : '-';
};
const fmtDateCompact = (value) => {
  const parsed = parseDateValue(value);
  return parsed ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: DISPLAY_TIMEZONE }).format(parsed) : '-';
};
const fmtDateOnly = (value) => {
  const parsed = parseDateValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value} 00:00:00` : value);
  return parsed ? new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }).format(parsed) : '-';
};
const fmtNum = (value, digits = 1) => value === null || value === undefined || value === '' ? '-' : Number(value).toFixed(digits);
const fmtCoord = (value) => value === null || value === undefined || value === '' ? '-' : Number(value).toFixed(6);
const fmtClock = (value) => {
  const parsed = parseDateValue(value);
  return parsed ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: DISPLAY_TIMEZONE }).format(parsed) : '-';
};
const fmtStayDuration = (startValue, endValue) => formatStayText(startValue, endValue);
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
const unitsToText = (units) => (units || []).map((unit) => `${unit.id}|${unit.label}`).join('\n');
const parseUnits = (text) => String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
  const parts = line.split('|');
  const id = String(parts[0] || '').trim();
  const label = String(parts[1] || parts[0] || '').trim();
  return id ? { id, label: label || id } : null;
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
  const [banner, setBanner] = useState({ tone: 'info', message: '' });
  const [authModal, setAuthModal] = useState({ open: false, message: '' });
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('Sedang memproses aksi...');
  const [loaded, setLoaded] = useState(false);
  const [activePanel, setActivePanel] = useState('overview');
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [selectedUnitAccountId, setSelectedUnitAccountId] = useState('primary');
  const [activeAccountId, setActiveAccountId] = useState('primary');
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [fleetAccountFilter, setFleetAccountFilter] = useState('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedFleetRowKey, setExpandedFleetRowKey] = useState('');
  const [historicalSearch, setHistoricalSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const deferredHistoricalSearch = useDeferredValue(historicalSearch);
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
  const [astroLocationForm, setAstroLocationForm] = useState(EMPTY_ASTRO_LOCATION_FORM);
  const [astroRouteForm, setAstroRouteForm] = useState(EMPTY_ASTRO_ROUTE_FORM);
  const [astroCsvText, setAstroCsvText] = useState('');
  const [astroLocationExpanded, setAstroLocationExpanded] = useState({});
  const [astroRouteExpanded, setAstroRouteExpanded] = useState({});
  const [astroRouteCsvText, setAstroRouteCsvText] = useState('');
  const [astroReportFilters, setAstroReportFilters] = useState({ startDate: today(-1), endDate: today(0), accountId: 'all', unitId: '' });
  const [astroReport, setAstroReport] = useState(null);
  const [astroDiagnosticsOpen, setAstroDiagnosticsOpen] = useState(false);
  const astroLocationCardRef = useRef(null);
  const astroRouteCardRef = useRef(null);
  const busyTimeoutRef = useRef(null);
  const fleetRows = status?.fleet?.rows || [];
  const availableAccounts = status?.config?.accounts || [];
  const connectedAccounts = useMemo(() => availableAccounts.filter((account) => account.hasSessionCookie), [availableAccounts]);
  const fleetFilterAccounts = useMemo(() => availableAccounts.filter((account) => fleetRows.some((row) => (row.accountId || 'primary') === account.id)), [availableAccounts, fleetRows]);
  const currentAccount = useMemo(() => availableAccounts.find((account) => account.id === activeAccountId) || availableAccounts[0] || null, [availableAccounts, activeAccountId]);
  const astroLocations = status?.config?.astroLocations || [];
  const astroRoutes = status?.config?.astroRoutes || [];
  const astroWhLocations = useMemo(() => astroLocations.filter((location) => location.type === 'WH'), [astroLocations]);
  const astroPodLocations = useMemo(() => astroLocations.filter((location) => location.type === 'POD'), [astroLocations]);
  const astroPoolLocations = useMemo(() => astroLocations.filter((location) => location.type === 'POOL'), [astroLocations]);
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
  const astroWhOptions = useMemo(() => astroWhLocations.map((location) => ({ value: location.id, label: location.name })).sort((left, right) => left.label.localeCompare(right.label)), [astroWhLocations]);
  const astroPoolOptions = useMemo(() => [{ value: '', label: 'Optional' }, ...astroPoolLocations.map((location) => ({ value: location.id, label: location.name })).sort((left, right) => left.label.localeCompare(right.label))], [astroPoolLocations]);
  const astroPodOptions = useMemo(() => [{ value: '', label: 'Optional' }, ...astroPodLocations.map((location) => ({ value: location.id, label: location.name })).sort((left, right) => left.label.localeCompare(right.label))], [astroPodLocations]);
  const astroLocationGroups = useMemo(() => ['WH', 'POD', 'POOL'].map((type) => ({ key: type, title: type === 'WH' ? 'Warehouse' : type === 'POOL' ? 'Pool' : 'POD', items: astroLocations.filter((location) => location.type === type).sort((left, right) => Number(right.isActive !== false) - Number(left.isActive !== false) || String(left.name).localeCompare(String(right.name))) })).filter((group) => group.items.length > 0), [astroLocations]);
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
  const astroReportUnitOptions = useMemo(() => astroRoutes.map((route) => ({ value: `${route.accountId || 'primary'}::${route.unitId}`, label: `${accountName(availableAccounts.find((account) => account.id === (route.accountId || 'primary')))} | ${astroUnitLabelByKey.get(`${route.accountId || 'primary'}::${route.unitId}`) || route.unitId}` })).sort((left, right) => left.label.localeCompare(right.label)), [astroRoutes, availableAccounts, astroUnitLabelByKey]);
  const astroReportMaxPods = astroReport?.summary?.maxPods || 0;
  const astroReportColumns = useMemo(() => {
    const base = [
      { key: 'serviceDate', label: 'Service date' },
      { key: 'rit', label: 'Rit' },
      { key: 'nopol', label: 'Nopol' },
      { key: 'wh', label: 'WH' },
      { key: 'whArrivalTime', label: 'WH arrival time' },
      { key: 'whArrivalTemp', label: 'WH arrival temp' },
      { key: 'whDepartureTemp', label: 'WH dep temp' },
      { key: 'whStay', label: 'WH stay' },
    ];
    const podColumns = Array.from({ length: astroReportMaxPods }, (_, index) => {
      const order = index + 1;
      return [
        { key: `pod${order}ArrivalTime`, label: `POD ${order} arrival time` },
        { key: `pod${order}ArrivalTemp`, label: `POD ${order} arrival temp` },
        { key: `pod${order}DepartureTemp`, label: `POD ${order} dep temp` },
        { key: `pod${order}Stay`, label: `POD ${order} stay` },
      ];
    }).flat();
    return [...base, ...podColumns];
  }, [astroReportMaxPods]);
  const astroReportTableRows = useMemo(() => (astroReport?.rows || []).map((row) => {
    const cells = [
      row.serviceDate,
      row.rit,
      row.unitLabel || row.unitId,
      row.whName,
      fmtDateCompact(row.whEta),
      fmtNum(row.whArrivalTemp, 1),
      fmtNum(row.whDepartureTemp, 1),
      fmtStayDuration(row.whEta, row.whEtd),
    ];
    for (let index = 0; index < astroReportMaxPods; index += 1) {
      const pod = row.pods?.[index];
      cells.push(
        pod ? fmtDateCompact(pod.eta) : '-',
        pod ? fmtNum(pod.arrivalTemp, 1) : '-',
        pod ? fmtNum(pod.departureTemp, 1) : '-',
        pod ? fmtStayDuration(pod.eta, pod.etd) : '-',
      );
    }
    return cells;
  }), [astroReport, astroReportMaxPods]);
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
    if (quickFilter === 'temp-error') filtered = filtered.filter((row) => rowHasSensorError(row));
    if (quickFilter === 'setpoint') filtered = filtered.filter((row) => rowHasSetpointIssue(row));
    if (quickFilter === 'gps-late') filtered = filtered.filter((row) => rowHasGpsLate(row));
    if (q) {
      filtered = filtered.filter((row) => [row.accountLabel, row.id, row.label, row.alias, row.group, row.locationSummary, row.zoneName, row.customerName, row.setpointLabel, row.errSensor, row.errGps].some((value) => String(value || '').toLowerCase().includes(q)));
    }
    return sortFleetRows(filtered);
  }, [deferredSearch, fleetRows, fleetAccountFilter, quickFilter]);
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
  const activeDetailRow = activePanel === 'historical' ? selectedHistoricalRow : selectedFleetRow;
  const activeHistoricalRange = activePanel === 'historical' ? historicalRangeApplied : range;
  const errorRows = useMemo(() => [...(report?.tempErrorIncidents || [])].sort((left, right) => (right.firstStartTimestamp || 0) - (left.firstStartTimestamp || 0)), [report]);
  const podRows = useMemo(() => [...(report?.podSnapshots || [])].sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0)), [report]);
  const errorOverview = useMemo(() => buildErrorOverview(errorRows), [errorRows]);
  const compileDailyRows = useMemo(() => [...(report?.compileByDay || [])].sort((left, right) => right.day.localeCompare(left.day)), [report]);
  const errorUnitsSummary = useMemo(() => [...(report?.compileByUnitDay || [])].sort((left, right) => right.day.localeCompare(left.day) || (right.incidents || 0) - (left.incidents || 0)), [report]);
  const autoFilterCards = status?.autoFilterCards || [];
  const hasSolofleetAccounts = connectedAccounts.length > 0;
  const isAdmin = webSessionUser?.role === 'admin';
  const showOverviewChrome = activePanel === 'overview';

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
      setBanner({ tone: 'error', message: 'Action timed out after 5 minutes.' });
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
      setAuthModal({ open: true, message: error.message || 'Initial dashboard load failed.' });
    });
  }, []);

  useEffect(() => {
    if (!banner.message) return undefined;
    const timer = window.setTimeout(() => {
      setBanner((current) => current.message === banner.message ? { ...current, message: '' } : current);
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [banner.message, banner.tone]);

  useEffect(() => () => {
    if (busyTimeoutRef.current) window.clearTimeout(busyTimeoutRef.current);
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
    const detailRow = activePanel === 'historical' ? selectedHistoricalRow : selectedFleetRow;
    if (!detailRow) return;
    if (!['fleet', 'temp-errors', 'historical'].includes(activePanel)) return;
    const detailSource = activePanel === 'historical' ? 'remote' : 'merged';
    loadUnitDetail(detailRow.accountId || 'primary', detailRow.id, true, detailSource, activePanel === 'historical' ? historicalRangeApplied : range).catch(() => {});
  }, [activePanel, selectedFleetRow?.id, selectedFleetRow?.accountId, selectedHistoricalRow?.id, selectedHistoricalRow?.accountId, range.startDate, range.endDate, historicalRangeApplied.startDate, historicalRangeApplied.endDate]);

  useEffect(() => {
    const detailRow = activePanel === 'historical' ? selectedHistoricalRow : selectedFleetRow;
    if (!detailRow) return;
    if (!['fleet', 'temp-errors', 'historical'].includes(activePanel)) return;
    const intervalMs = Math.max(30000, Number(status?.config?.pollIntervalSeconds || 60) * 1000);
    const detailSource = activePanel === 'historical' ? 'remote' : 'merged';
    const timer = window.setInterval(() => {
      loadUnitDetail(detailRow.accountId || 'primary', detailRow.id, true, detailSource, activePanel === 'historical' ? historicalRangeApplied : range).catch(() => {});
      if (activePanel !== 'historical') {
        loadDashboard(false, true).catch(() => {});
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [activePanel, selectedFleetRow?.id, selectedFleetRow?.accountId, selectedHistoricalRow?.id, selectedHistoricalRow?.accountId, range.startDate, range.endDate, historicalRangeApplied.startDate, historicalRangeApplied.endDate, status?.config?.pollIntervalSeconds]);

  useEffect(() => {
    if (!expandedFleetRowKey) return;
    if (!prioritizedFleet.some((row) => unitRowKey(row) === expandedFleetRowKey)) {
      setExpandedFleetRowKey('');
    }
  }, [expandedFleetRowKey, prioritizedFleet]);
  const loadDashboard = async (syncConfig = false, quiet = false) => {
    if (!quiet) startBusy();
    const query = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
    const [nextStatus, nextReport, nextMonitor] = await Promise.all([api('/api/status'), api(`/api/report?${query.toString()}`), api('/api/monitor')]);
    startTransition(() => {
      const nextActiveAccountId = nextStatus.config?.activeAccountId || 'primary';
      setStatus(nextStatus);
      setReport(nextReport);
      setApiMonitor(nextMonitor);
      setWebSessionUser(nextStatus.webAuth?.sessionUser || null);
      if (syncConfig || !loaded) {
        setActiveAccountId(nextActiveAccountId);
        setForm(formFromConfig(nextStatus.config, nextActiveAccountId));
        setLoaded(true);
      }
      setAuthModal((current) => current.open ? { open: false, message: '' } : current);
      if (!stopForm.unitId && nextStatus.fleet?.rows?.length) {
        setStopForm((current) => ({ ...current, accountId: nextStatus.fleet.rows[0].accountId || 'primary', unitId: nextStatus.fleet.rows[0].id }));
      }
      if (!quiet && nextStatus.webAuth?.sessionUser) setBanner({ tone: 'success', message: 'Dashboard refreshed.' });
    });
    if (!quiet) stopBusy();
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
      setAuthModal({ open: true, message: error.message || 'Web login failed.' });
      setBanner({ tone: 'error', message: error.message || 'Web login failed.' });
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
        setBanner({ tone: 'success', message: 'Logged out from web dashboard.' });
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

  const saveConfig = async (keepBanner = false) => {
    startBusy('Menyimpan config...');
    try {
      const payload = {
        activeAccountId, solofleetBaseUrl: form.baseUrl.trim(), endpointPath: form.endpointPath.trim(), refererPath: form.refererPath.trim(), vehiclePagePath: form.vehiclePagePath.trim(), discoveryEndpointPath: form.discoveryEndpointPath.trim(), vehicleRoleId: form.vehicleRoleId.trim(), units: parseUnits(form.unitsText), customerProfiles: parseCustomerProfiles(form.customerProfilesText), podSites: parsePodSites(form.podSitesText), pollIntervalSeconds: Number(form.pollIntervalSeconds || 60), requestLookbackMinutes: Number(form.requestLookbackMinutes || 30), requestIntervalSeconds: Number(form.requestIntervalSeconds || 120), historyRetentionDays: Number(form.historyRetentionDays || 7), minDurationMinutes: Number(form.minDurationMinutes || 5), maxGapMinutes: form.maxGapMinutes === '' ? null : Number(form.maxGapMinutes), archiveType: form.archiveType.trim(), tempProfile: form.tempProfile.trim(), temperatureProcessing: form.temperatureProcessing.trim(), autoStart: Boolean(form.autoStart),
      };
      if (form.sessionCookie.trim()) payload.sessionCookie = form.sessionCookie.trim();
      const result = await api('/api/config', { method: 'POST', body: JSON.stringify(payload) });
      startTransition(() => {
        const nextActive = result.config.activeAccountId || activeAccountId;
        setActiveAccountId(nextActive);
        setForm(formFromConfig(result.config, nextActive));
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
      setAuthModal({ open: true, message: error.message || 'Solofleet login failed. Check email/password.' });
      setBanner({ tone: 'error', message: error.message || 'Login failed.' });
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

  const switchAccount = (accountId) => {
    const nextAccountId = accountId || 'primary';
    setActiveAccountId(nextAccountId);
    if (status?.config) {
      setForm(formFromConfig(status.config, nextAccountId));
    }
    const firstAccountRow = fleetRows.find((row) => row.accountId === nextAccountId);
    if (firstAccountRow) {
      setStopForm((current) => ({ ...current, accountId: nextAccountId, unitId: firstAccountRow.id }));
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
  const selectHistoricalUnit = (value) => {
    const [accountId, unitId] = String(value || '').split('::');
    if (!unitId) return;
    openUnit(accountId || 'primary', unitId, 'historical');
  };
  const pullHistoricalData = () => {
    setHistoricalRangeApplied({ ...historicalRangeDraft });
  };
  const exportFleet = async () => runQuickBlockingAction('Menyiapkan Fleet CSV...', () => csv('solofleet-fleet-live.csv', prioritizedFleet.map((row) => ({ account_id: row.accountId, account_label: row.accountLabel, unit_id: row.id, label: row.label, alias: row.alias, group_name: row.group, speed: row.speed, live_temp1: row.liveTemp1, live_temp2: row.liveTemp2, temp_gap: row.liveTempDelta, sensor_error: row.errSensor, gps_error: row.errGps, location: row.locationSummary, zone_name: row.zoneName, latitude: row.latitude, longitude: row.longitude, last_updated_at: row.lastUpdatedAt }))));
  const exportAlerts = async () => runQuickBlockingAction('Menyiapkan Alerts CSV...', () => csv('solofleet-temp-alerts.csv', errorRows.map((row) => ({ account_id: row.accountId, account_label: row.accountLabel, error_date: row.day, start_time: row.startTime, end_time: row.endTime, duration_minutes: row.durationMinutes, incidents: row.incidents, unit_id: row.unitId, unit_label: row.unitLabel, type: row.label, temp1_min: row.temp1Min, temp1_max: row.temp1Max, temp2_min: row.temp2Min, temp2_max: row.temp2Max, speed_min: row.minSpeed, speed_max: row.maxSpeed, latitude: row.latitude, longitude: row.longitude, location: row.locationSummary }))));
  const exportStop = async () => runQuickBlockingAction('Menyiapkan Stop CSV...', () => csv('solofleet-stop-idle.csv', (stopReport?.rows || []).map((row) => ({ account_id: stopForm.accountId, account_label: accountName(availableAccounts.find((account) => account.id === stopForm.accountId)), unit_id: row.unitId, alias: row.alias, start_time: row.startTimestamp ? new Date(row.startTimestamp).toISOString() : '', end_time: row.endTimestamp ? new Date(row.endTimestamp).toISOString() : '', duration_minutes: row.durationMinutes, movement_distance_km: row.movementDistance, avg_temp: row.avgTemp, location: row.locationSummary, latitude: row.latitude, longitude: row.longitude, zone_name: row.zoneName, google_maps_url: row.googleMapsUrl }))));
  const historyTargetRow = selectedHistoricalRow || selectedFleetRow;
  const exportHistory = async () => {
    const unitPlate = String(historyTargetRow?.label || historyTargetRow?.alias || historyTargetRow?.id || selectedUnitId || 'Unit').trim() || 'Unit';
    const rangeLabel = `${historicalRangeApplied.startDate} to ${historicalRangeApplied.endDate}`;
    const fileName = `Historical Temperature ${rangeLabel} ${unitPlate}.csv`;
    await runQuickBlockingAction('Menyiapkan Historical CSV...', () => csv(fileName, (unitDetail?.records || []).map((row) => ({ account_id: historyTargetRow?.accountId || selectedUnitAccountId, account_label: historyTargetRow?.accountLabel || accountName(availableAccounts.find((account) => account.id === (historyTargetRow?.accountId || selectedUnitAccountId)) || currentAccount), unit_id: historyTargetRow?.id || selectedUnitId, timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : '', speed: row.speed, temp1: row.temp1, temp2: row.temp2, location: row.locationSummary, latitude: row.latitude, longitude: row.longitude, power_supply: row.powerSupply, zone_name: row.zoneName }))));
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
    isActive: Boolean(draft.isActive),
    notes: draft.notes.trim(),
  });

  const astroRoutePayload = (draft = astroRouteForm) => ({
    id: draft.id || undefined,
    accountId: draft.accountId || 'primary',
    unitId: draft.unitId.trim().toUpperCase(),
    customerName: draft.customerName.trim() || 'Astro',
    whLocationId: draft.whLocationId,
    poolLocationId: draft.poolLocationId || '',
    podSequence: (draft.podSequence || []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, ASTRO_ROUTE_MAX_PODS),
    rit1: { start: draft.rit1Start, end: draft.rit1End, enabled: true },
    rit2: draft.rit2Enabled ? { start: draft.rit2Start, end: draft.rit2End, enabled: true } : null,
    isActive: Boolean(draft.isActive),
    notes: draft.notes.trim(),
  });

  const updateAstroRoutePod = (index, value) => {
    setAstroRouteForm((current) => ({
      ...current,
      podSequence: (current.podSequence || ['']).map((item, itemIndex) => itemIndex === index ? value : item),
    }));
  };

  const addAstroRoutePod = () => {
    setAstroRouteForm((current) => {
      const nextPods = [...(current.podSequence || [])];
      if (nextPods.length >= ASTRO_ROUTE_MAX_PODS) {
        return current;
      }
      nextPods.push('');
      return { ...current, podSequence: nextPods };
    });
  };

  const removeAstroRoutePod = (index) => {
    setAstroRouteForm((current) => {
      const currentPods = current.podSequence || [''];
      if (currentPods.length <= 1) {
        return { ...current, podSequence: [''] };
      }
      const nextPods = currentPods.filter((_, itemIndex) => itemIndex !== index);
      return { ...current, podSequence: nextPods.length ? nextPods : [''] };
    });
  };

  const focusAstroEditor = (ref, message) => {
    setActivePanel('config');
    setBanner({ tone: 'info', message });
    setTimeout(() => ref?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  const editAstroLocationEntry = (location) => {
    setAstroLocationForm({
      id: location.id || '',
      name: location.name || '',
      latitude: String(location.latitude ?? ''),
      longitude: String(location.longitude ?? ''),
      radiusMeters: String(location.radiusMeters ?? 150),
      type: location.type || 'POD',
      isActive: location.isActive !== false,
      notes: location.notes || '',
    });
    focusAstroEditor(astroLocationCardRef, `Editing Astro location ${location.name || location.id || ''}`.trim());
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
      setBanner({ tone: 'success', message: 'Astro location saved.' });
      await loadDashboard(true, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Astro location gagal disimpan.' });
      setBanner({ tone: 'error', message: error.message || 'Astro location gagal disimpan.' });
    } finally {
      stopBusy();
    }
  };

  const deleteAstroLocationEntry = async (locationId) => {
    startBusy();
    try {
      const nextLocations = astroLocations.filter((location) => location.id !== locationId);
      await api('/api/astro/config/locations', { method: 'POST', body: JSON.stringify({ locations: nextLocations }) });
      if (astroLocationForm.id === locationId) setAstroLocationForm(EMPTY_ASTRO_LOCATION_FORM);
      setBanner({ tone: 'success', message: 'Astro location deleted.' });
      await loadDashboard(true, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Astro location gagal dihapus.' });
      setBanner({ tone: 'error', message: error.message || 'Astro location gagal dihapus.' });
    } finally {
      stopBusy();
    }
  };

  const editAstroRouteEntry = (route) => {
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
      rit2Enabled: Boolean(route.rit2),
      rit2Start: route.rit2?.start || '19:00',
      rit2End: route.rit2?.end || '06:00',
      isActive: route.isActive !== false,
      notes: route.notes || '',
    });
    focusAstroEditor(astroRouteCardRef, `Editing Astro route ${route.unitId || route.id || ''}`.trim());
  };

  const saveAstroRouteEntry = async () => {
    startBusy();
    try {
      const entry = astroRoutePayload();
      const nextRoutes = astroRouteForm.id
        ? astroRoutes.map((route) => route.id === astroRouteForm.id ? entry : route)
        : [...astroRoutes, entry];
      await api('/api/astro/config/routes', { method: 'POST', body: JSON.stringify({ routes: nextRoutes }) });
      setAstroRouteForm((current) => ({ ...EMPTY_ASTRO_ROUTE_FORM, accountId: current.accountId || 'primary', podSequence: [''] }));
      setBanner({ tone: 'success', message: 'Astro route saved.' });
      await loadDashboard(true, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Astro route gagal disimpan.' });
      setBanner({ tone: 'error', message: error.message || 'Astro route gagal disimpan.' });
    } finally {
      stopBusy();
    }
  };

  const deleteAstroRouteEntry = async (routeId) => {
    startBusy();
    try {
      const nextRoutes = astroRoutes.filter((route) => route.id !== routeId);
      await api('/api/astro/config/routes', { method: 'POST', body: JSON.stringify({ routes: nextRoutes }) });
      if (astroRouteForm.id === routeId) setAstroRouteForm(EMPTY_ASTRO_ROUTE_FORM);
      setBanner({ tone: 'success', message: 'Astro route deleted.' });
      await loadDashboard(true, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Astro route gagal dihapus.' });
      setBanner({ tone: 'error', message: error.message || 'Astro route gagal dihapus.' });
    } finally {
      stopBusy();
    }
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
      if (astroReportFilters.unitId) {
        const [routeAccountId, routeUnitId] = astroReportFilters.unitId.split('::');
        if (routeAccountId) query.set('accountId', routeAccountId);
        if (routeUnitId) query.set('unitId', routeUnitId);
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
      if (astroReportFilters.unitId) {
        const [routeAccountId, routeUnitId] = astroReportFilters.unitId.split('::');
        if (routeAccountId) query.set('accountId', routeAccountId);
        if (routeUnitId) query.set('unitId', routeUnitId);
        
        const unitLabel = astroUnitLabelByKey.get(astroReportFilters.unitId) || routeUnitId;
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
    return <div className="login-shell">
      <div className="login-backdrop" />
      <Card className="login-card">
        <CardHeader className="panel-card-header">
          <div className="brand-lockup-login-shell">
            <BrandLockup />
            <div className="login-copy">
              <p className="eyebrow local-eyebrow">Ops dashboard</p>
              <h2>Loading dashboard</h2>
              <p>Sedang cek status backend dan session web...</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="settings-stack">
            <div className="inline-buttons">
              <Spinner />
            </div>
            <div className="subtle-line">Kalau loading lama atau gagal, halaman login akan tampil otomatis.</div>
          </div>
        </CardContent>
      </Card>
    </div>;
  }

  if (loaded && !webSessionUser) {
    return <div className="login-shell">
      <div className="login-backdrop" />
      <Card className="login-card">
        <CardHeader className="panel-card-header">
          <div className="brand-lockup-login-shell">
            <BrandLockup />
            <div className="login-copy">
              <p className="eyebrow local-eyebrow">Ops dashboard</p>
              <h2>Login web dashboard</h2>
              <p>Login web sekarang dipisah dari login Solofleet. Default bootstrap lokal: <strong>admin / admin</strong>.</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="settings-stack">
            <label className="field"><span>Username</span><input type="text" value={webLoginForm.username} onChange={(event) => setWebLoginForm((current) => ({ ...current, username: event.target.value }))} placeholder="admin" /></label>
            <label className="field"><span>Password</span><input type="password" value={webLoginForm.password} onChange={(event) => setWebLoginForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password dashboard" /></label>
            <div className="inline-buttons">
              <Button color="primary" onPress={loginToWeb}>Login dashboard</Button>
            </div>
            <div className="subtle-line">Solofleet account tetap diatur dari page Config sesudah login web berhasil.</div>
          </div>
        </CardContent>
      </Card>
      {busyOverlay}
      {authModal.open ? <div className="auth-modal-backdrop">
        <Card className="auth-modal-card">
          <CardHeader className="panel-card-header">
            <div>
              <p className="eyebrow local-eyebrow">Action Error</p>
              <h2>Aksi gagal</h2>
              <p>{authModal.message}</p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="inline-buttons">
              <Button color="primary" onPress={() => setAuthModal({ open: false, message: '' })}>Tutup</Button>
            </div>
          </CardContent>
        </Card>
      </div> : null}
    </div>;
  }

  return (
    
    <div className={`command-center ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <header className="topbar">
        <div className="topbar-brand">
          <BrandLockup compact />
        </div>
        <div className="topbar-controls">
          <div className="date-range-group">
            <input type="date" value={range.startDate} onClick={(event) => event.currentTarget.showPicker?.()} onFocus={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setRange(c => ({...c, startDate: event.target.value}))} />
            <ArrowRight size={14} className="text-muted" />
            <input type="date" value={range.endDate} onClick={(event) => event.currentTarget.showPicker?.()} onFocus={(event) => event.currentTarget.showPicker?.()} onChange={(event) => setRange(c => ({...c, endDate: event.target.value}))} />
          </div>
          <div className="search-box">
            <Search size={16} className="search-icon" />
            <input type="text" placeholder="Search account, unit, location..." value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>
        <div className="topbar-actions">
          <div className="account-badge">
            <Settings size={14} />
            <span>Account</span>
            <strong>{accountName(currentAccount)}</strong>
          </div>
          <div className="control-inline-actions">
            <Button variant="bordered" onPress={exportFleet}><Navigation size={14} /> Live CSV</Button>
            <Button variant="bordered" onPress={exportAlerts}><ShieldAlert size={14} /> Alerts CSV</Button>
          </div>
          <Button variant="bordered" onPress={() => loadDashboard(false, false)}><RefreshCw size={14} /> Refresh</Button>
          <Button onPress={runPollNow}><Zap size={14} /> Poll Now</Button>
          <Button variant="bordered" onPress={togglePolling}>{status?.runtime?.isPolling ? 'Stop polling' : 'Start polling'}</Button>
        </div>
      </header>

      <nav className="sidebar">
        <div className="sidebar-top">
          <button type="button" className="nav-item collapse-btn sidebar-collapse-top" onClick={() => setSidebarCollapsed((current) => !current)}>
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            <span>{sidebarCollapsed ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
        <div className="sidebar-nav">
          {[
            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
            { id: 'fleet', label: 'Fleet Live', icon: Navigation },
            { id: 'astro-report', label: 'Astro Report', icon: BarChart3 },
            { id: 'temp-errors', label: 'Temp Errors', icon: Thermometer },
            { id: 'stop', label: 'Stop/Idle', icon: Flag },
            { id: 'api-monitor', label: 'API Monitor', icon: Activity },
            { id: 'config', label: 'Config', icon: Settings },
            ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: Settings }] : []),
          ].map(item => {
            const Icon = item.icon;
            return <button key={item.id} type="button" className={`nav-item ${activePanel === item.id ? 'active' : ''}`} onClick={() => setActivePanel(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </div>
        <div className="sidebar-bottom profile-dock">
          <button type="button" className="profile-summary-button" onClick={() => setActivePanel(isAdmin ? 'admin' : 'config')}>
            <strong>{webSessionUser?.displayName || webSessionUser?.username || 'Dashboard user'}</strong>
            <span>{webSessionUser?.username || '-'}{webSessionUser?.role ? ` | ${webSessionUser.role}` : ''}</span>
          </button>
          <div className="profile-dock-actions">
            <Button variant="bordered" className="profile-dock-btn" onPress={() => setActivePanel(isAdmin ? 'admin' : 'config')}>Profile</Button>
            <Button variant="light" className="profile-dock-btn" onPress={logoutWeb}>Logout</Button>
          </div>
        </div>
      </nav>

      <main className="workspace">
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
          
          

          {activePanel === 'overview' ? <>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Live temperature alerts</h2><p>Alert yang masih relevan dari histori poll lokal.</p></div></CardHeader><CardContent><DataTable columns={['Severity', 'Account', 'Unit', 'Start', 'End', 'Minutes', 'Speed', 'Temp range']} emptyMessage="Belum ada live temp alert." rows={(status?.liveAlerts || []).map((row) => [<Chip color={row.type === 'temp1+temp2' ? 'danger' : 'warning'} variant="flat">{row.label}</Chip>, row.accountLabel || row.accountId || '-', <div><strong>{row.unitLabel || row.vehicle}</strong><div className="subtle-line">{row.vehicle}</div></div>, fmtDate(row.startTimestamp), fmtDate(row.endTimestamp), fmtNum(row.durationMinutes, 1), `${fmtNum(row.minSpeed, 0)} - ${fmtNum(row.maxSpeed, 0)}`, `T1 ${fmtNum(row.temp1Min)} to ${fmtNum(row.temp1Max)} | T2 ${fmtNum(row.temp2Min)} to ${fmtNum(row.temp2Max)}`])} /></CardContent></Card>
            <div className="split-panels">
              <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Compile per day</h2><p>1 baris per hari biar cepat lihat total unit yang kena error. Detail per unit tetap ada di export CSV.</p></div><div className="inline-buttons"><Button variant="bordered" onPress={exportCompile}>Export compile CSV</Button></div></CardHeader><CardContent><DataTable columns={['Day', 'Error units', 'Temp1 units', 'Temp2 units', 'Both units', 'Incidents', 'Total min', 'Longest']} emptyMessage="Belum ada compile row di range ini." rows={compileDailyRows.map((row) => [row.day, row.units, row.temp1Units, row.temp2Units, row.bothUnits, row.incidents, fmtNum(row.totalMinutes, 1), fmtNum(row.longestMinutes, 1)])} /></CardContent></Card>
              <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Daily totals</h2><p>Quick scan buat lihat hari yang paling bermasalah.</p></div></CardHeader><CardContent><DataTable columns={['Day', 'Units', 'Incidents', 'Critical', 'Total min']} emptyMessage="Belum ada daily totals di range ini." rows={(report?.dailyTotals || []).map((row) => [row.day, row.units, row.incidents, row.criticalIncidents, fmtNum(row.totalMinutes, 1)])} /></CardContent></Card>
            </div>
          </> : null}
          {activePanel === 'fleet' ? <>
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
                  <p>Klik See graphic buat buka modal chart di tengah, jadi tabel fleet tetap rapi dan tidak nabrak.</p>
                </div>
                <div className="inline-buttons">
                  <Button variant="bordered" onPress={exportFleet}>Export fleet CSV</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="fleet-filter-bar">
                  <label className="field fleet-filter-field">
                    <span>Account filter</span>
                    <select value={fleetAccountFilter} onChange={(event) => setFleetAccountFilter(event.target.value)}>
                      <option value="all">All accounts</option>
                      {fleetFilterAccounts.map((account) => <option key={account.id} value={account.id}>{account.label || account.authEmail || account.id}</option>)}
                    </select>
                  </label>
                </div>
                <div className="fleet-table-summary">
                  <span>{prioritizedFleet.length} unit tampil di fleet live</span>
                  <span>{fleetAccountFilter === 'all' ? 'Semua account' : accountName(fleetFilterAccounts.find((account) => account.id === fleetAccountFilter))} | {expandedFleetRowKey ? '1 modal grafik sedang terbuka' : 'Belum ada grafik yang dibuka'}</span>
                </div>
                {prioritizedFleet.length ? <div className="table-shell">
                  <table className="data-table fleet-inline-table">
                    <thead>
                      <tr>
                        <th>Health</th>
                        <th>Account</th>
                        <th>Unit</th>
                        <th>Customer</th>
                        <th>Setpoint</th>
                        <th>Location</th>
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
                            <td><div><strong>{row.id}</strong><div className="subtle-line">{row.label}</div><div className="subtle-line">{row.alias}</div></div></td>
                            <td><div><div>{row.customerName || row.group || '-'}</div><div className="subtle-line">{row.group || 'No group'}</div>{row.astroActive ? <div className="subtle-line astro-inline-status">{row.astroStatusLabel}</div> : null}</div></td>
                            <td><div><div>{row.targetTempMin !== null || row.targetTempMax !== null ? `${fmtNum(row.targetTempMin)} to ${fmtNum(row.targetTempMax)}` : '-'}</div><div className="subtle-line">{row.setpointLabel || 'No rule'}</div></div></td>
                            <td><div><div>{row.locationSummary || '-'}</div><div className="subtle-line">{row.zoneName || 'No zone'}</div><div className="subtle-line">{fmtCoord(row.latitude)}, {fmtCoord(row.longitude)}</div></div></td>
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
          {activePanel === 'astro-report' ? <>
            <Card className="panel-card">
              <CardHeader className="panel-card-header">
                <div>
                  <h2>Astro delivery report</h2>
                  <p>Summary rit Astro berbasis geofence radius, stay minimal 3 menit, dan historical Solofleet.</p>
                </div>
                <div className="inline-buttons">
                  {astroDiagnostics.length ? <Button variant="bordered" onPress={() => setAstroDiagnosticsOpen(true)}>Lihat tanggal error ({astroDiagnostics.length})</Button> : null}
                  <Button variant="bordered" onPress={exportAstroReport}>Export Astro CSV</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="historical-toolbar astro-toolbar">
                  <label className="historical-field">
                    <span>Start date</span>
                    <input type="date" value={astroReportFilters.startDate} onChange={(event) => setAstroReportFilters((current) => ({ ...current, startDate: event.target.value }))} />
                  </label>
                  <label className="historical-field">
                    <span>End date</span>
                    <input type="date" value={astroReportFilters.endDate} onChange={(event) => setAstroReportFilters((current) => ({ ...current, endDate: event.target.value }))} />
                  </label>
                  <label className="historical-field">
                    <span>Account</span>
                    <select value={astroReportFilters.accountId} onChange={(event) => setAstroReportFilters((current) => ({ ...current, accountId: event.target.value, unitId: '' }))}>
                      <option value="all">All accounts</option>
                      {availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.label || account.authEmail || account.id}</option>)}
                    </select>
                  </label>
                  <label className="historical-field">
                    <span>Nopol route</span>
                    <select value={astroReportFilters.unitId} onChange={(event) => setAstroReportFilters((current) => ({ ...current, unitId: event.target.value }))}>
                      <option value="">All configured routes</option>
                      {astroReportUnitOptions.filter((option) => astroReportFilters.accountId === 'all' || option.value.startsWith(`${astroReportFilters.accountId}::`)).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <div className="historical-action-field">
                    <span>Action</span>
                    <Button color="primary" onPress={generateAstroReport}>Generate report</Button>
                  </div>
                </div>
                <div className="historical-summary astro-summary">Configured routes: {astroRoutes.length} | Locations: {astroLocations.length} | Report rows: {astroReport?.summary?.rows ?? 0} | Partial diagnostics: {astroReport?.summary?.partialRows ?? 0} | Warnings: {astroReport?.summary?.warnings ?? 0}</div>
                {astroDiagnostics.length ? <div className="subtle-line astro-diagnostic-hint">Tanggal yang tidak complete tidak hilang. Buka tombol Lihat tanggal error buat lihat requirement yang belum terpenuhi.</div> : null}
              </CardContent>
            </Card>
            <Card className="panel-card">
              <CardHeader className="panel-card-header">
                <div>
                  <h2>Astro rit summary</h2>
                  <p>Row tetap tampil per rit. Titik yang tidak ketemu snapshot akan diisi tanda - . Urutan POD mengikuti route config.</p>
                </div>
              </CardHeader>
              <CardContent>
                {astroReport?.warnings?.length ? <div className="astro-warning-list">{astroReport.warnings.map((warning, index) => <div key={`astro-warning-${index}`} className="subtle-line">{warning}</div>)}</div> : null}
                <DataTable className="astro-report-table" shellClassName="astro-report-table-shell" pagination={{ initialRowsPerPage: 10, rowsPerPageOptions: [10, 20, 50] }} columns={astroReportColumns} rows={astroReportTableRows} emptyMessage={astroReport?.warnings?.length ? 'Belum ada Astro rit yang complete di range ini. Cek warning di atas buat lihat penyebabnya.' : 'Belum ada Astro report. Set date lalu klik Generate report.'} />
              </CardContent>
            </Card>
          </> : null}
                    {activePanel === 'temp-errors' ? <>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Dedicated temp error page</h2><p>1 row = 1 nopol + 1 hari, jadi durasi error harian langsung kebaca tanpa pecah jadi banyak snapshot.</p></div><div className="inline-buttons"><Button variant="bordered" onPress={exportAlerts}>Export temp error CSV</Button></div></CardHeader><CardContent><div className="metric-strip"><div className="mini-metric"><span>Rows</span><strong>{errorOverview.alerts}</strong></div><div className="mini-metric"><span>Affected units</span><strong>{errorOverview.affectedUnits}</strong></div><div className="mini-metric"><span>Critical</span><strong>{errorOverview.criticalAlerts}</strong></div><div className="mini-metric"><span>Total min</span><strong>{fmtNum(errorOverview.totalMinutes, 1)}</strong></div></div></CardContent></Card>
            <div className="split-panels split-panels-tall">
              <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Temp error incidents</h2><p>Klik row buat buka unit itu di chart detail.</p></div></CardHeader><CardContent><DataTable className="temp-error-table" shellClassName="temp-error-table-shell" pagination={{ initialRowsPerPage: 5, rowsPerPageOptions: [5, 10, 20, 50] }} columns={['Tanggal', 'Mulai', 'Selesai', 'Durasi', 'Account', 'Nopol', 'Severity', 'Temp 1', 'Temp 2', 'Speed']} emptyMessage="Belum ada temp error incident di range ini." rows={errorRows.map((row) => [row.day ? fmtDateOnly(row.day) : '-', row.startTime || '-', row.endTime || '-', row.durationMinutes != null ? fmtNum(row.durationMinutes, 1) : '-', row.accountLabel || row.accountId || '-', <div><strong>{row.unitLabel || row.unitId}</strong><div className="subtle-line">{row.unitId}</div></div>, <Chip className="wrap-chip" color={row.type === 'temp1+temp2' ? 'danger' : 'warning'} variant="flat">{row.label}</Chip>, `${fmtNum(row.temp1Min)} to ${fmtNum(row.temp1Max)}`, `${fmtNum(row.temp2Min)} to ${fmtNum(row.temp2Max)}`, `${fmtNum(row.minSpeed, 0)} - ${fmtNum(row.maxSpeed, 0)}`])} getRowProps={(row, rowIndex) => ({ key: `${errorRows[rowIndex]?.accountId || 'account'}-${errorRows[rowIndex]?.unitId || 'alert'}-${errorRows[rowIndex]?.day || rowIndex}`, className: errorRows[rowIndex]?.type === 'temp1+temp2' ? 'data-row data-row-danger' : 'data-row data-row-warning', onClick: () => openUnit(errorRows[rowIndex].accountId || 'primary', errorRows[rowIndex].unitId, 'temp-errors') })} /></CardContent></Card>
              <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Selected unit chart</h2><p>Trend suhu unit yang dipilih dari panel error.</p></div></CardHeader><CardContent>{selectedFleetRow ? <><div className="focus-side-meta"><strong>{selectedFleetRow.id} | {selectedFleetRow.label}</strong><div className="subtle-line">{selectedFleetRow.accountLabel || selectedFleetRow.accountId}</div><div className="subtle-line">{selectedFleetRow.locationSummary || '-'}</div></div><TemperatureChart records={unitDetail?.records || []} busy={detailBusy} title="Sensor trend" description="Kalau mau grafik 00:00 sampai sekarang, page ini tinggal pakai data historical Solofleet untuk hari aktif yang kamu pilih." compact /></> : <div className="empty-state">Klik salah satu incident buat lihat chart unit.</div>}</CardContent></Card>
            </div>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Unit compile by day</h2><p>Section ini selalu 1 hari 1 row. Detail unit tetap dipakai waktu export CSV.</p></div><div className="inline-buttons"><Button variant="bordered" onPress={exportCompile}>Export compile CSV</Button></div></CardHeader><CardContent><DataTable columns={['Day', 'Error units', 'Temp1 units', 'Temp2 units', 'Both units', 'Incidents', 'Total min', 'Longest']} emptyMessage="Belum ada compile error by day di range ini." rows={compileDailyRows.map((row) => [row.day, row.units, row.temp1Units, row.temp2Units, row.bothUnits, row.incidents, fmtNum(row.totalMinutes, 1), fmtNum(row.longestMinutes, 1)])} /></CardContent></Card>
          </> : null}

          {activePanel === 'historical' ? <>
            <Card className="panel-card">
              <CardHeader className="panel-card-header">
                <div>
                  <h2>Historical temperature</h2>
                  <p>Masuknya dari Fleet Live. Di sini kamu bisa cari unit, ganti unit, dan ubah date range tanpa balik ke page lain.</p>
                </div>
                <div className="inline-buttons">
                  <Button variant="bordered" onPress={() => setActivePanel('fleet')}>Back to Fleet Live</Button>
                  <Button variant="bordered" onPress={exportHistory}>Export history CSV</Button>
                </div>
              </CardHeader>
              <CardContent>
                {fleetRows.length ? <>
                  <div className="historical-toolbar">
                    <label className="historical-field historical-search-field">
                      <span>Search unit</span>
                      <div className="search-box historical-search-box">
                        <Search size={16} className="search-icon" />
                        <input
                          type="search"
                          value={historicalSearch}
                          onChange={(event) => setHistoricalSearch(event.target.value)}
                          placeholder="Cari account, unit, customer, lokasi..."
                        />
                      </div>
                    </label>
                    <label className="historical-field historical-unit-field">
                      <span>Unit</span>
                      <select value={selectedHistoricalRow ? unitRowKey(selectedHistoricalRow) : ''} onChange={(event) => selectHistoricalUnit(event.target.value)}>
                        {historicalFleet.map((row) => <option key={row.rowKey || unitRowKey(row)} value={unitRowKey(row)}>{row.accountLabel || row.accountId || 'Account'} | {row.id} | {row.label}</option>)}
                      </select>
                    </label>
                    <label className="historical-field historical-date-field">
                      <span>Start date</span>
                      <input type="date" value={historicalRangeDraft.startDate} onChange={(event) => setHistoricalRangeDraft((current) => ({ ...current, startDate: event.target.value }))} />
                    </label>
                    <label className="historical-field historical-date-field">
                      <span>End date</span>
                      <input type="date" value={historicalRangeDraft.endDate} onChange={(event) => setHistoricalRangeDraft((current) => ({ ...current, endDate: event.target.value }))} />
                    </label>
                    <div className="historical-action-field">
                      <span>Action</span>
                      <Button color="primary" onPress={pullHistoricalData}>Tarik Data</Button>
                    </div>
                  </div>
                  <div className="historical-summary">{historicalFleet.length} unit tersedia buat dipilih dari fleet live. Showing {historicalRangeApplied.startDate} to {historicalRangeApplied.endDate}.</div>
                  {selectedHistoricalRow ? <>
                    <div className="focus-side-meta">
                      <strong>{selectedHistoricalRow.id} | {selectedHistoricalRow.label}</strong>
                      <div className="subtle-line">{selectedHistoricalRow.accountLabel || selectedHistoricalRow.accountId}</div>
                      <div className="subtle-line">{selectedHistoricalRow.customerName || 'No customer profile'}</div>
                    </div>
                    <TemperatureChart records={unitDetail?.records || []} busy={detailBusy} title="Historical temperature chart" description="Tarik langsung dari historical Solofleet sesuai range yang dipilih di page ini." />
                    <div className="spacer-16" />
                    <DataTable columns={['Timestamp', 'Speed', 'Temp 1', 'Temp 2', 'Location', 'Lat', 'Lng', 'Power supply']} emptyMessage="Belum ada historical rows untuk unit ini di range ini." rows={[...(unitDetail?.records || [])].reverse().map((row) => [fmtDate(row.timestamp), fmtNum(row.speed, 0), fmtNum(row.temp1), fmtNum(row.temp2), <div><div>{row.locationSummary || '-'}</div><div className="subtle-line">{row.zoneName || 'No zone'}</div></div>, fmtCoord(row.latitude), fmtCoord(row.longitude), fmtNum(row.powerSupply, 2)])} />
                  </> : <div className="empty-state">Belum ada unit yang cocok dengan filter historical.</div>}
                </> : <div className="empty-state">Belum ada unit dari fleet live untuk dipilih.</div>}
              </CardContent>
            </Card>
          </> : null}

          {activePanel === 'pod' ? <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>POD auto capture</h2><p>Snapshot harian kalau unit masuk radius POD dengan speed rendah. Lokasi POD bisa kamu atur sendiri.</p></div><div className="inline-buttons"><Button variant="bordered" onPress={exportPods}>Export POD CSV</Button></div></CardHeader><CardContent><DataTable columns={['Day', 'Time', 'Account', 'Unit', 'Customer', 'POD', 'Distance', 'Speed', 'Location']} emptyMessage="Belum ada POD capture di range ini." rows={podRows.map((row) => [row.day, row.time, row.accountLabel || row.accountId || '-', <div><strong>{row.unitId}</strong><div className="subtle-line">{row.unitLabel}</div></div>, row.customerName || '-', row.podName, `${fmtNum(row.distanceMeters, 0)} m`, fmtNum(row.speed, 0), row.locationSummary || '-'])} /></CardContent></Card> : null}

          {activePanel === 'api-monitor' ? <>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>API Monitor</h2><p>Trace ringan untuk lihat endpoint Solofleet API yang ditarik oleh backend, error, dan duration.</p></div></CardHeader><CardContent><div className="metric-strip"><div className="mini-metric"><span>Requests</span><strong>{apiMonitor?.totals?.requests ?? 0}</strong></div><div className="mini-metric"><span>Errors</span><strong>{apiMonitor?.totals?.errors ?? 0}</strong></div><div className="mini-metric"><span>Slow</span><strong>{apiMonitor?.totals?.slowRequests ?? 0}</strong></div><div className="mini-metric"><span>Endpoints</span><strong>{apiMonitor?.totals?.uniqueEndpoints ?? 0}</strong></div></div></CardContent></Card>
            <div className="split-panels split-panels-tall">
              <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Endpoint summary</h2><p>Hit count, error count, dan average duration per endpoint.</p></div></CardHeader><CardContent><DataTable columns={['Method', 'Path', 'Hits', 'Errors', 'Avg ms', 'Last status', 'Last at', 'Last error']} emptyMessage="Belum ada traffic API tercatat." rows={(apiMonitor?.endpointSummary || []).map((row) => [row.method, row.path, row.hits, row.errorCount, fmtNum(row.avgDurationMs, 1), row.lastStatusCode ?? '-', fmtDate(row.lastAt), row.lastError || '-'])} /></CardContent></Card>
              <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Recent requests</h2><p>Request data terbaru ke Solofleet beserta status HTTP-nya.</p></div></CardHeader><CardContent><DataTable columns={['Time', 'Method', 'Path', 'Status', 'Duration', 'Error']} emptyMessage="Belum ada recent request." rows={(apiMonitor?.recent || []).slice(0, 60).map((row) => [fmtDate(row.timestamp), row.method, `${row.path}${row.query || ''}`, row.statusCode, `${fmtNum(row.durationMs, 0)} ms`, row.error || '-'])} /></CardContent></Card>
            </div>
          </> : null}
                    {activePanel === 'config' ? <>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Solofleet multi-account</h2><p>Login Solofleet dipisah dari login web. Semua linked account diatur dari sini.</p></div><div className="inline-buttons"><Button color="primary" onPress={() => saveConfig(false)}>Save config</Button></div></CardHeader><CardContent><div className="settings-stack"><label className="field"><span>Active Solofleet account</span><select value={activeAccountId} onChange={(event) => switchAccount(event.target.value)}>{availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.label || account.authEmail || account.id}</option>)}</select></label><div className="account-config-list">{availableAccounts.map((account) => <div key={account.id} className={`account-config-item ${activeAccountId === account.id ? 'account-config-item-active' : ''}`}><div><strong>{account.label || account.authEmail || account.id}</strong><div className="subtle-line">{account.authEmail || 'No email saved'}{account.hasVerifiedSession ? ' | verified session' : account.hasSessionCookie ? ' | needs refresh' : ' | disconnected'}</div><div className="subtle-line">{account.units?.length || 0} unit configured</div></div><div className="inline-buttons"><Button variant="bordered" onPress={() => switchAccount(account.id)}>Use</Button><Button variant="bordered" onPress={() => discoverUnits(account.id)}>Discover units</Button>{account.id !== 'primary' ? <Button variant="light" onPress={() => logoutAccount(account.id)}>Remove</Button> : null}</div></div>)}</div></div></CardContent></Card>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Add / refresh linked account</h2><p>Masukin login Solofleet di sini kalau mau tambah account baru atau refresh session yang sudah ada. Kalau credential salah atau sesi gagal diverifikasi, modal error bakal langsung muncul.</p></div><div className="inline-buttons"><Button color="primary" onPress={() => loginWithSolofleet('linked')}>Add linked account</Button></div></CardHeader><CardContent><div className="form-grid account-login-grid"><label className="field"><span>Label</span><input type="text" value={accountLoginForm.label} onChange={(event) => setAccountLoginForm((current) => ({ ...current, label: event.target.value }))} placeholder="Vendor / Client A" /></label><label className="field"><span>Email</span><input type="email" value={accountLoginForm.email} onChange={(event) => setAccountLoginForm((current) => ({ ...current, email: event.target.value }))} placeholder="nama@company.com" /></label><label className="field"><span>Password</span><input type="password" value={accountLoginForm.password} onChange={(event) => setAccountLoginForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password Solofleet" /></label><label className="field checkbox-field"><input type="checkbox" checked={accountLoginForm.rememberMe} onChange={(event) => setAccountLoginForm((current) => ({ ...current, rememberMe: event.target.checked }))} /><span>Remember me</span></label></div></CardContent></Card>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Customer grouping + setpoint</h2><p>Format: <code>Customer|min|max|COL89,COL90</code></p></div></CardHeader><CardContent><label className="field"><span>Customer profiles</span><textarea rows="8" value={form.customerProfilesText} onChange={(event) => setForm((current) => ({ ...current, customerProfilesText: event.target.value }))} /></label></CardContent></Card>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>POD config</h2><p>Format: <code>POD|lat|lng|radiusMeter|maxSpeed|customer|COL89,COL90</code></p></div></CardHeader><CardContent><label className="field"><span>POD sites</span><textarea rows="8" value={form.podSitesText} onChange={(event) => setForm((current) => ({ ...current, podSitesText: event.target.value }))} /></label></CardContent></Card>
            <Card ref={astroLocationCardRef} className="panel-card">
              <CardHeader className="panel-card-header">
                <div>
                  <h2>Astro set location</h2>
                  <p>Master lokasi WH / POD / POOL buat report Astro. Bisa bulk import CSV atau manual satu per satu.</p>
                </div>
                <div className="inline-buttons">
                  <Button color="primary" onPress={saveAstroLocationEntry}>{astroLocationForm.id ? 'Update location' : 'Save location'}</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="settings-stack">
                  <div className="form-grid astro-config-grid">
                    <label className="field"><span>Location name</span><input type="text" value={astroLocationForm.name} onChange={(event) => setAstroLocationForm((current) => ({ ...current, name: event.target.value }))} placeholder="Astro WH CBN" /></label>
                    <label className="field"><span>Latitude</span><input type="number" step="any" value={astroLocationForm.latitude} onChange={(event) => setAstroLocationForm((current) => ({ ...current, latitude: event.target.value }))} placeholder="-6.2" /></label>
                    <label className="field"><span>Longitude</span><input type="number" step="any" value={astroLocationForm.longitude} onChange={(event) => setAstroLocationForm((current) => ({ ...current, longitude: event.target.value }))} placeholder="106.8" /></label>
                    <label className="field"><span>Radius (m)</span><input type="number" min="20" value={astroLocationForm.radiusMeters} onChange={(event) => setAstroLocationForm((current) => ({ ...current, radiusMeters: event.target.value }))} /></label>
                    <label className="field"><span>Type</span><select value={astroLocationForm.type} onChange={(event) => setAstroLocationForm((current) => ({ ...current, type: event.target.value }))}><option value="WH">WH</option><option value="POD">POD</option><option value="POOL">POOL</option></select></label>
                    <label className="field checkbox-field"><input type="checkbox" checked={astroLocationForm.isActive} onChange={(event) => setAstroLocationForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>Active</span></label>
                  </div>
                  <label className="field"><span>Notes</span><input type="text" value={astroLocationForm.notes} onChange={(event) => setAstroLocationForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional note" /></label>
                  <div className="inline-buttons">
                    <Button variant="bordered" onPress={() => setAstroLocationForm(EMPTY_ASTRO_LOCATION_FORM)}>Reset form</Button>
                  </div>
                  <div className="astro-sample-block">
                    <div className="astro-sample-head">
                      <strong>CSV sample</strong>
                      <div className="inline-buttons astro-sample-actions">
                        <a className="sf-btn sf-btn-bordered" href="/astro-location-sample.csv" download>Download sample CSV</a>
                        <Button variant="bordered" onPress={() => setAstroCsvText(ASTRO_LOCATION_SAMPLE_CSV)}>Use sample</Button>
                      </div>
                    </div>
                    <pre className="astro-sample-pre">{ASTRO_LOCATION_SAMPLE_CSV}</pre>
                  </div>
                  <label className="field"><span>Bulk CSV import</span><textarea rows="5" value={astroCsvText} onChange={(event) => setAstroCsvText(event.target.value)} placeholder="Nama Tempat, Latitude, Longitude, Radius, Type" /></label>
                  <div className="inline-buttons">
                    <input type="file" accept=".csv,text/csv" onChange={loadAstroCsvFile} />
                    <Button variant="bordered" onPress={() => importAstroLocations(false)}>Import merge</Button>
                    <Button variant="light" onPress={() => importAstroLocations(true)}>Replace all</Button>
                  </div>
                  {astroLocations.length ? <div className="astro-group-stack">
                    <div className="astro-group-summary">
                      <Chip>{astroLocations.length} lokasi</Chip>
                      <Chip color="info">WH {astroWhLocations.length}</Chip>
                      <Chip color="warning">POD {astroPodLocations.length}</Chip>
                      <Chip color="default">POOL {astroPoolLocations.length}</Chip>
                    </div>
                    {astroLocationGroups.map((group) => {
                      const expanded = astroLocationExpanded[group.key] === true;
                      const visibleItems = expanded ? group.items : group.items.slice(0, ASTRO_GROUP_PREVIEW_LIMIT);
                      return <div key={group.key} className="astro-group-card">
                        <div className="astro-group-card-head">
                          <div>
                            <strong>{group.title}</strong>
                            <span>{group.items.length} lokasi</span>
                          </div>
                          {group.items.length > ASTRO_GROUP_PREVIEW_LIMIT ? <Button variant="bordered" onPress={() => setAstroLocationExpanded((current) => ({ ...current, [group.key]: !expanded }))}>{expanded ? 'Show less' : `Show all (${group.items.length})`}</Button> : null}
                        </div>
                        <div className="astro-card-grid">
                          {visibleItems.map((location) => <div key={location.id} className="astro-entity-card">
                            <div className="astro-entity-card-head">
                              <div>
                                <strong>{location.name}</strong>
                                <span>{location.type} | {location.radiusMeters} m</span>
                              </div>
                              <Chip color={location.isActive !== false ? 'success' : 'default'}>{location.isActive !== false ? 'Active' : 'Inactive'}</Chip>
                            </div>
                            <div className="astro-entity-card-body">
                              <span>Lat {fmtCoord(location.latitude)}</span>
                              <span>Lng {fmtCoord(location.longitude)}</span>
                            </div>
                            <p className={location.notes ? 'astro-entity-note' : 'astro-entity-note astro-entity-note-muted'}>{location.notes || 'No note'}</p>
                            <div className="inline-buttons astro-entity-actions">
                              <Button variant="bordered" onPress={() => editAstroLocationEntry(location)}>Edit</Button>
                              <Button variant="light" onPress={() => deleteAstroLocationEntry(location.id)}>Delete</Button>
                            </div>
                          </div>)}
                        </div>
                      </div>;
                    })}
                  </div> : <div className="empty-state">Belum ada Astro location.</div>}
                </div>
              </CardContent>
            </Card>
            <Card ref={astroRouteCardRef} className="panel-card">
              <CardHeader className="panel-card-header">
                <div>
                  <h2>Astro route config</h2>
                  <p>Mapping nopol Astro ke WH, POOL, urutan POD, dan window rit per unit.</p>
                </div>
                <div className="inline-buttons">
                  <Button color="primary" onPress={saveAstroRouteEntry}>{astroRouteForm.id ? 'Update route' : 'Save route'}</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="settings-stack">
                  <div className="form-grid astro-config-grid">
                    <SearchableSelect label="Account" value={astroRouteForm.accountId} options={astroRouteAccountOptions} onChange={(nextValue) => setAstroRouteForm((current) => ({ ...current, accountId: nextValue || current.accountId, unitId: '' }))} placeholder="Search account..." />
                    <SearchableSelect label="Nopol" value={astroRouteForm.unitId} options={[{ value: '', label: 'Select unit' }, ...astroRouteFilteredUnitOptions]} onChange={(nextValue) => setAstroRouteForm((current) => ({ ...current, unitId: nextValue }))} placeholder="Search unit..." />
                    <label className="field"><span>Customer</span><input type="text" value={astroRouteForm.customerName} onChange={(event) => setAstroRouteForm((current) => ({ ...current, customerName: event.target.value }))} placeholder="Astro" /></label>
                    <SearchableSelect label="WH" value={astroRouteForm.whLocationId} options={[{ value: '', label: 'Select WH' }, ...astroWhOptions]} onChange={(nextValue) => setAstroRouteForm((current) => ({ ...current, whLocationId: nextValue }))} placeholder="Search WH..." />
                    <SearchableSelect label="POOL" value={astroRouteForm.poolLocationId} options={astroPoolOptions} onChange={(nextValue) => setAstroRouteForm((current) => ({ ...current, poolLocationId: nextValue }))} placeholder="Search pool..." />
                    <label className="field checkbox-field"><input type="checkbox" checked={astroRouteForm.isActive} onChange={(event) => setAstroRouteForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>Active</span></label>
                    <label className="field"><span>Rit 1 start</span><input type="time" value={astroRouteForm.rit1Start} onChange={(event) => setAstroRouteForm((current) => ({ ...current, rit1Start: event.target.value }))} /></label>
                    <label className="field"><span>Rit 1 end</span><input type="time" value={astroRouteForm.rit1End} onChange={(event) => setAstroRouteForm((current) => ({ ...current, rit1End: event.target.value }))} /></label>
                    <label className="field checkbox-field"><input type="checkbox" checked={astroRouteForm.rit2Enabled} onChange={(event) => setAstroRouteForm((current) => ({ ...current, rit2Enabled: event.target.checked }))} /><span>Enable rit 2</span></label>
                    <label className="field"><span>Rit 2 start</span><input type="time" value={astroRouteForm.rit2Start} onChange={(event) => setAstroRouteForm((current) => ({ ...current, rit2Start: event.target.value }))} disabled={!astroRouteForm.rit2Enabled} /></label>
                    <label className="field"><span>Rit 2 end</span><input type="time" value={astroRouteForm.rit2End} onChange={(event) => setAstroRouteForm((current) => ({ ...current, rit2End: event.target.value }))} disabled={!astroRouteForm.rit2Enabled} /></label>
                  </div>
                  <div className="astro-pod-list">
                    <div className="astro-pod-list-head">
                      <strong>POD sequence</strong>
                      <div className="inline-buttons astro-sample-actions">
                        <span className="subtle-line">Max {ASTRO_ROUTE_MAX_PODS} POD per rit</span>
                        <Button variant="bordered" onPress={addAstroRoutePod} disabled={(astroRouteForm.podSequence || []).length >= ASTRO_ROUTE_MAX_PODS}>Add POD</Button>
                      </div>
                    </div>
                    {(astroRouteForm.podSequence || ['']).map((podId, index) => <div key={index} className="astro-pod-row"><div className="astro-pod-field"><SearchableSelect label={`POD ${index + 1}`} value={podId} options={astroPodOptions} onChange={(nextValue) => updateAstroRoutePod(index, nextValue)} placeholder={`Search POD ${index + 1}...`} /></div><Button variant="light" onPress={() => removeAstroRoutePod(index)} disabled={(astroRouteForm.podSequence || []).length <= 1}>Remove</Button></div>)}
                  </div>
                  <label className="field"><span>Notes</span><input type="text" value={astroRouteForm.notes} onChange={(event) => setAstroRouteForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional note" /></label>
                  <div className="inline-buttons">
                    <Button variant="bordered" onPress={() => setAstroRouteForm(EMPTY_ASTRO_ROUTE_FORM)}>Reset route form</Button>
                  </div>
                  <div className="astro-sample-block">
                    <div className="astro-sample-head">
                      <strong>Route CSV sample</strong>
                      <div className="inline-buttons astro-sample-actions">
                        <a className="sf-btn sf-btn-bordered" href="/astro-route-sample.csv" download>Download route sample</a>
                        <Button variant="bordered" onPress={() => setAstroRouteCsvText(ASTRO_ROUTE_SAMPLE_CSV)}>Use sample</Button>
                      </div>
                    </div>
                    <pre className="astro-sample-pre">{ASTRO_ROUTE_SAMPLE_CSV}</pre>
                  </div>
                  <label className="field"><span>Bulk route CSV import</span><textarea rows="6" value={astroRouteCsvText} onChange={(event) => setAstroRouteCsvText(event.target.value)} placeholder="Account ID, Nopol, Customer, WH, POOL, POD1, POD2, POD3, POD4, POD5, Rit1 Start, Rit1 End, Rit2 Enabled, Rit2 Start, Rit2 End, Active, Notes" /></label>
                  <div className="inline-buttons">
                    <input type="file" accept=".csv,text/csv" onChange={loadAstroRouteCsvFile} />
                    <Button variant="bordered" onPress={() => importAstroRoutes(false)}>Import route merge</Button>
                    <Button variant="light" onPress={() => importAstroRoutes(true)}>Replace all routes</Button>
                  </div>
                  <div className="subtle-line">Bulk route CSV fleksibel: setelah kolom POOL, tambahkan kolom POD1 sampai maksimal POD5. Sistem akan baca titik POD sesuai jumlah kolom yang kamu isi.</div>
                  {astroRoutes.length ? <div className="astro-group-stack">
                    <div className="astro-group-summary">
                      <Chip>{astroRoutes.length} route</Chip>
                      <Chip color="info">Account {astroRouteGroups.length}</Chip>
                      <Chip color="warning">Max POD {ASTRO_ROUTE_MAX_PODS}</Chip>
                    </div>
                    {astroRouteGroups.map((group) => {
                      const expanded = astroRouteExpanded[group.key] === true;
                      const visibleItems = expanded ? group.items : group.items.slice(0, ASTRO_GROUP_PREVIEW_LIMIT);
                      return <div key={group.key} className="astro-group-card">
                        <div className="astro-group-card-head">
                          <div>
                            <strong>{group.title}</strong>
                            <span>{group.items.length} route</span>
                          </div>
                          {group.items.length > ASTRO_GROUP_PREVIEW_LIMIT ? <Button variant="bordered" onPress={() => setAstroRouteExpanded((current) => ({ ...current, [group.key]: !expanded }))}>{expanded ? 'Show less' : `Show all (${group.items.length})`}</Button> : null}
                        </div>
                        <div className="astro-card-grid astro-card-grid-routes">
                          {visibleItems.map((route) => <div key={route.id} className="astro-entity-card astro-route-card">
                            <div className="astro-entity-card-head">
                              <div>
                                <strong>{astroUnitLabelByKey.get(`${route.accountId || 'primary'}::${route.unitId}`) || route.unitId}</strong>
                                <span>{route.customerName || 'Astro'} | {route.unitId}</span>
                              </div>
                              <Chip color={route.isActive !== false ? 'success' : 'default'}>{route.isActive !== false ? 'Active' : 'Inactive'}</Chip>
                            </div>
                            <div className="astro-route-meta">
                              <span><strong>WH</strong>{astroLocations.find((location) => location.id === route.whLocationId)?.name || '-'}</span>
                              <span><strong>POOL</strong>{astroLocations.find((location) => location.id === route.poolLocationId)?.name || '-'}</span>
                              <span><strong>POD</strong>{(route.podSequence || []).map((locationId) => astroLocations.find((location) => location.id === locationId)?.name || locationId).join(' -> ') || '-'}</span>
                              <span><strong>Rit 1</strong>{route.rit1 ? String(route.rit1.start) + ' to ' + String(route.rit1.end) : '-'}</span>
                              <span><strong>Rit 2</strong>{route.rit2 ? String(route.rit2.start) + ' to ' + String(route.rit2.end) : 'Rit 1 only'}</span>
                            </div>
                            <div className="inline-buttons astro-entity-actions">
                              <Button variant="bordered" onPress={() => editAstroRouteEntry(route)}>Edit</Button>
                              <Button variant="light" onPress={() => deleteAstroRouteEntry(route.id)}>Delete</Button>
                            </div>
                          </div>)}
                        </div>
                      </div>;
                    })}
                  </div> : <div className="empty-state">Belum ada Astro route config.</div>}
                </div>
              </CardContent>
            </Card>
          </> : null}

          {activePanel === 'admin' ? <>
            <Card className="panel-card">
              <CardHeader className="panel-card-header">
                <div>
                  <h2>Web profile</h2>
                  <p>Kelola akun web dashboard yang login-nya beda dari account Solofleet.</p>
                </div>
                <div className="inline-buttons">
                  <Button variant="bordered" onPress={() => setWebUserForm(EMPTY_WEB_USER_FORM)}>New user</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="metric-strip admin-storage-strip">
                  <div className="mini-metric"><span>Signed in as</span><strong>{webSessionUser?.displayName || webSessionUser?.username || '-'}</strong></div>
                  <div className="mini-metric"><span>Role</span><strong>{webSessionUser?.role || '-'}</strong></div>
                  <div className="mini-metric"><span>Stored users</span><strong>{webUsers.length}</strong></div>
                  <div className="mini-metric"><span>Storage</span><strong>{adminStorageProvider || 'local-bootstrap'}</strong></div>
                  <div className="mini-metric"><span>Temp rollups</span><strong>{adminTempRollups.length}</strong></div>
                  <div className="mini-metric"><span>POD snapshots</span><strong>{adminPodSnapshots.length}</strong></div>
                </div>
              </CardContent>
            </Card>
            <div className="split-panels split-panels-tall">
              <Card className="panel-card">
                <CardHeader className="panel-card-header">
                  <div>
                    <h2>Manage web users</h2>
                    <p>Create, edit, dan delete akun web di sini.</p>
                  </div>
                </CardHeader>
                <CardContent>
                  <DataTable
                    pagination={{ initialRowsPerPage: 10, rowsPerPageOptions: [10, 20, 50] }}
                    columns={['Username', 'Display', 'Role', 'Status', 'Updated', 'Actions']}
                    emptyMessage="Belum ada web user."
                    rows={webUsers.map((user) => [
                      user.username,
                      user.displayName || '-',
                      user.role || 'admin',
                      user.isActive ? 'Active' : 'Disabled',
                      fmtDate(user.updatedAt),
                      <div className="inline-buttons">
                        <Button variant="bordered" onPress={() => setWebUserForm({ id: user.id, username: user.username, displayName: user.displayName || '', password: '', role: user.role || 'admin', isActive: user.isActive !== false })}>Edit</Button>
                        <Button variant="light" onPress={() => deleteWebUserEntry(user.id)}>Delete</Button>
                      </div>,
                    ])}
                  />
                </CardContent>
              </Card>
              <Card className="panel-card">
                <CardHeader className="panel-card-header">
                  <div>
                    <h2>{webUserForm.id ? 'Edit web user' : 'Create web user'}</h2>
                    <p>Password boleh dikosongkan kalau cuma edit display name / role user yang sudah ada.</p>
                  </div>
                  <div className="inline-buttons">
                    <Button color="primary" onPress={saveWebUserEntry}>Save user</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="settings-stack">
                    <label className="field"><span>Username</span><input type="text" value={webUserForm.username} onChange={(event) => setWebUserForm((current) => ({ ...current, username: event.target.value }))} placeholder="admin" /></label>
                    <label className="field"><span>Display name</span><input type="text" value={webUserForm.displayName} onChange={(event) => setWebUserForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="Administrator" /></label>
                    <label className="field"><span>Password</span><input type="password" value={webUserForm.password} onChange={(event) => setWebUserForm((current) => ({ ...current, password: event.target.value }))} placeholder={webUserForm.id ? 'Kosongkan kalau tidak ganti password' : 'Password baru'} /></label>
                    <label className="field"><span>Role</span><select value={webUserForm.role} onChange={(event) => setWebUserForm((current) => ({ ...current, role: event.target.value }))}><option value="admin">Admin</option><option value="viewer">Viewer</option></select></label>
                    <label className="field checkbox-field"><input type="checkbox" checked={webUserForm.isActive} onChange={(event) => setWebUserForm((current) => ({ ...current, isActive: event.target.checked }))} /><span>Active</span></label>
                  </div>
                </CardContent>
              </Card>
            </div>
            <Card className="panel-card">
              <CardHeader className="panel-card-header">
                <div>
                  <h2>Database tools</h2>
                  <p>Edit data PostgreSQL langsung dari dashboard buat rollup temp error dan POD snapshot.</p>
                </div>
                <div className="inline-buttons">
                  <Button variant="bordered" onPress={() => loadAdminDatabase()}>Refresh DB</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="metric-strip admin-storage-strip">
                  <div className="mini-metric"><span>Provider</span><strong>{adminStorageProvider || '-'}</strong></div>
                  <div className="mini-metric"><span>Rollup rows</span><strong>{adminTempRollups.length}</strong></div>
                  <div className="mini-metric"><span>POD rows</span><strong>{adminPodSnapshots.length}</strong></div>
                </div>
              </CardContent>
            </Card>
            <div className="split-panels split-panels-tall">
              <Card className="panel-card">
                <CardHeader className="panel-card-header">
                  <div>
                    <h2>Temp rollups</h2>
                    <p>Raw rollup harian yang dipakai report temp error. Edit dengan hati-hati.</p>
                  </div>
                </CardHeader>
                <CardContent>
                  <DataTable
                    pagination={{ initialRowsPerPage: 10, rowsPerPageOptions: [10, 20, 50] }}
                    columns={['Day', 'Account', 'Unit', 'Type', 'Incidents', 'Window', 'Actions']}
                    emptyMessage="Belum ada temp rollup di PostgreSQL."
                    rows={adminTempRollups.map((row) => [
                      row.day || '-',
                      row.accountLabel || row.accountId || '-',
                      <div><strong>{row.unitLabel || row.vehicle || row.unitId || '-'}</strong><div className="subtle-line">{row.unitId || '-'}</div></div>,
                      row.label || row.type || '-',
                      row.incidents ?? 0,
                      <div>{fmtDate(row.firstStartTimestamp)}<div className="subtle-line">{fmtDate(row.lastEndTimestamp)}</div></div>,
                      <div className="inline-buttons"><Button variant="bordered" onPress={() => editAdminRollup(row)}>Edit</Button><Button variant="light" onPress={() => deleteAdminRollupEntry(row.id)}>Delete</Button></div>,
                    ])}
                  />
                </CardContent>
              </Card>
              <Card className="panel-card">
                <CardHeader className="panel-card-header">
                  <div>
                    <h2>{adminRollupForm.id ? 'Edit temp rollup' : 'New temp rollup'}</h2>
                    <p>Field minimum: day, account, unit, type, dan incidents. Timestamp pakai waktu lokal VPS/browser.</p>
                  </div>
                  <div className="inline-buttons">
                    <Button color="primary" onPress={saveAdminRollupEntry}>Save rollup</Button>
                    <Button variant="bordered" onPress={() => setAdminRollupForm(EMPTY_ADMIN_ROLLUP_FORM)}>Reset</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="settings-stack">
                    <div className="form-grid admin-db-grid">
                      <label className="field"><span>Rollup id</span><input type="text" value={adminRollupForm.id} onChange={(event) => setAdminRollupForm((current) => ({ ...current, id: event.target.value }))} placeholder="auto kalau kosong" /></label>
                      <label className="field"><span>Day</span><input type="date" value={adminRollupForm.day} onChange={(event) => setAdminRollupForm((current) => ({ ...current, day: event.target.value }))} /></label>
                      <label className="field"><span>Account id</span><input type="text" value={adminRollupForm.accountId} onChange={(event) => setAdminRollupForm((current) => ({ ...current, accountId: event.target.value }))} placeholder="primary" /></label>
                      <label className="field"><span>Account label</span><input type="text" value={adminRollupForm.accountLabel} onChange={(event) => setAdminRollupForm((current) => ({ ...current, accountLabel: event.target.value }))} placeholder="Account display name" /></label>
                      <label className="field"><span>Unit id</span><input type="text" value={adminRollupForm.unitId} onChange={(event) => setAdminRollupForm((current) => ({ ...current, unitId: event.target.value }))} placeholder="COL77" /></label>
                      <label className="field"><span>Unit label / Nopol</span><input type="text" value={adminRollupForm.unitLabel} onChange={(event) => setAdminRollupForm((current) => ({ ...current, unitLabel: event.target.value }))} placeholder="B 9749 SXW" /></label>
                      <label className="field"><span>Vehicle</span><input type="text" value={adminRollupForm.vehicle} onChange={(event) => setAdminRollupForm((current) => ({ ...current, vehicle: event.target.value }))} placeholder="Vehicle label" /></label>
                      <label className="field"><span>Type</span><select value={adminRollupForm.type} onChange={(event) => setAdminRollupForm((current) => ({ ...current, type: event.target.value }))}><option value="temp1">temp1</option><option value="temp2">temp2</option><option value="temp1+temp2">temp1+temp2</option></select></label>
                      <label className="field"><span>Label</span><input type="text" value={adminRollupForm.label} onChange={(event) => setAdminRollupForm((current) => ({ ...current, label: event.target.value }))} placeholder="TEMP1 ERROR" /></label>
                      <label className="field"><span>Incidents</span><input type="number" min="0" value={adminRollupForm.incidents} onChange={(event) => setAdminRollupForm((current) => ({ ...current, incidents: event.target.value }))} /></label>
                      <label className="field"><span>Temp1 incidents</span><input type="number" min="0" value={adminRollupForm.temp1Incidents} onChange={(event) => setAdminRollupForm((current) => ({ ...current, temp1Incidents: event.target.value }))} /></label>
                      <label className="field"><span>Temp2 incidents</span><input type="number" min="0" value={adminRollupForm.temp2Incidents} onChange={(event) => setAdminRollupForm((current) => ({ ...current, temp2Incidents: event.target.value }))} /></label>
                      <label className="field"><span>Both incidents</span><input type="number" min="0" value={adminRollupForm.bothIncidents} onChange={(event) => setAdminRollupForm((current) => ({ ...current, bothIncidents: event.target.value }))} /></label>
                      <label className="field"><span>First start</span><input type="datetime-local" value={adminRollupForm.firstStartTimestamp} onChange={(event) => setAdminRollupForm((current) => ({ ...current, firstStartTimestamp: event.target.value }))} /></label>
                      <label className="field"><span>Last end</span><input type="datetime-local" value={adminRollupForm.lastEndTimestamp} onChange={(event) => setAdminRollupForm((current) => ({ ...current, lastEndTimestamp: event.target.value }))} /></label>
                      <label className="field"><span>Duration minutes</span><input type="number" step="0.1" value={adminRollupForm.durationMinutes} onChange={(event) => setAdminRollupForm((current) => ({ ...current, durationMinutes: event.target.value }))} /></label>
                      <label className="field"><span>Total minutes</span><input type="number" step="0.1" value={adminRollupForm.totalMinutes} onChange={(event) => setAdminRollupForm((current) => ({ ...current, totalMinutes: event.target.value }))} /></label>
                      <label className="field"><span>Longest minutes</span><input type="number" step="0.1" value={adminRollupForm.longestMinutes} onChange={(event) => setAdminRollupForm((current) => ({ ...current, longestMinutes: event.target.value }))} /></label>
                      <label className="field"><span>Temp1 min</span><input type="number" step="0.1" value={adminRollupForm.temp1Min} onChange={(event) => setAdminRollupForm((current) => ({ ...current, temp1Min: event.target.value }))} /></label>
                      <label className="field"><span>Temp1 max</span><input type="number" step="0.1" value={adminRollupForm.temp1Max} onChange={(event) => setAdminRollupForm((current) => ({ ...current, temp1Max: event.target.value }))} /></label>
                      <label className="field"><span>Temp2 min</span><input type="number" step="0.1" value={adminRollupForm.temp2Min} onChange={(event) => setAdminRollupForm((current) => ({ ...current, temp2Min: event.target.value }))} /></label>
                      <label className="field"><span>Temp2 max</span><input type="number" step="0.1" value={adminRollupForm.temp2Max} onChange={(event) => setAdminRollupForm((current) => ({ ...current, temp2Max: event.target.value }))} /></label>
                      <label className="field"><span>Min speed</span><input type="number" step="0.1" value={adminRollupForm.minSpeed} onChange={(event) => setAdminRollupForm((current) => ({ ...current, minSpeed: event.target.value }))} /></label>
                      <label className="field"><span>Max speed</span><input type="number" step="0.1" value={adminRollupForm.maxSpeed} onChange={(event) => setAdminRollupForm((current) => ({ ...current, maxSpeed: event.target.value }))} /></label>
                      <label className="field"><span>Latitude</span><input type="number" step="any" value={adminRollupForm.latitude} onChange={(event) => setAdminRollupForm((current) => ({ ...current, latitude: event.target.value }))} /></label>
                      <label className="field"><span>Longitude</span><input type="number" step="any" value={adminRollupForm.longitude} onChange={(event) => setAdminRollupForm((current) => ({ ...current, longitude: event.target.value }))} /></label>
                      <label className="field admin-db-grid-span-2"><span>Location summary</span><input type="text" value={adminRollupForm.locationSummary} onChange={(event) => setAdminRollupForm((current) => ({ ...current, locationSummary: event.target.value }))} placeholder="Jalan, kecamatan, kota" /></label>
                      <label className="field"><span>Zone</span><input type="text" value={adminRollupForm.zoneName} onChange={(event) => setAdminRollupForm((current) => ({ ...current, zoneName: event.target.value }))} placeholder="Zone name" /></label>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="split-panels split-panels-tall">
              <Card className="panel-card">
                <CardHeader className="panel-card-header">
                  <div>
                    <h2>POD snapshots</h2>
                    <p>Snapshot geofence POD yang tersimpan di PostgreSQL.</p>
                  </div>
                </CardHeader>
                <CardContent>
                  <DataTable
                    pagination={{ initialRowsPerPage: 10, rowsPerPageOptions: [10, 20, 50] }}
                    columns={['Day', 'Time', 'Unit', 'POD', 'Distance', 'Location', 'Actions']}
                    emptyMessage="Belum ada POD snapshot di PostgreSQL."
                    rows={adminPodSnapshots.map((row) => [
                      row.day || '-',
                      fmtDate(row.timestamp),
                      <div><strong>{row.unitLabel || row.unitId || '-'}</strong><div className="subtle-line">{row.unitId || '-'}</div></div>,
                      <div><strong>{row.podName || row.podId || '-'}</strong><div className="subtle-line">{row.podId || '-'}</div></div>,
                      row.distanceMeters ?? '-',
                      row.locationSummary || '-',
                      <div className="inline-buttons"><Button variant="bordered" onPress={() => editAdminPodSnapshot(row)}>Edit</Button><Button variant="light" onPress={() => deleteAdminPodEntry(row.id)}>Delete</Button></div>,
                    ])}
                  />
                </CardContent>
              </Card>
              <Card className="panel-card">
                <CardHeader className="panel-card-header">
                  <div>
                    <h2>{adminPodForm.id ? 'Edit POD snapshot' : 'New POD snapshot'}</h2>
                    <p>Gunakan editor ini kalau mau koreksi snapshot POD langsung dari web.</p>
                  </div>
                  <div className="inline-buttons">
                    <Button color="primary" onPress={saveAdminPodEntry}>Save POD snapshot</Button>
                    <Button variant="bordered" onPress={() => setAdminPodForm(EMPTY_ADMIN_POD_FORM)}>Reset</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="settings-stack">
                    <div className="form-grid admin-db-grid">
                      <label className="field"><span>Snapshot id</span><input type="text" value={adminPodForm.id} onChange={(event) => setAdminPodForm((current) => ({ ...current, id: event.target.value }))} placeholder="auto kalau kosong" /></label>
                      <label className="field"><span>Day</span><input type="date" value={adminPodForm.day} onChange={(event) => setAdminPodForm((current) => ({ ...current, day: event.target.value }))} /></label>
                      <label className="field"><span>Timestamp</span><input type="datetime-local" value={adminPodForm.timestamp} onChange={(event) => setAdminPodForm((current) => ({ ...current, timestamp: event.target.value }))} /></label>
                      <label className="field"><span>Time label</span><input type="text" value={adminPodForm.time} onChange={(event) => setAdminPodForm((current) => ({ ...current, time: event.target.value }))} placeholder="13:34:22" /></label>
                      <label className="field"><span>Unit id</span><input type="text" value={adminPodForm.unitId} onChange={(event) => setAdminPodForm((current) => ({ ...current, unitId: event.target.value }))} placeholder="COL77" /></label>
                      <label className="field"><span>Unit label / Nopol</span><input type="text" value={adminPodForm.unitLabel} onChange={(event) => setAdminPodForm((current) => ({ ...current, unitLabel: event.target.value }))} placeholder="B 9749 SXW" /></label>
                      <label className="field"><span>Customer name</span><input type="text" value={adminPodForm.customerName} onChange={(event) => setAdminPodForm((current) => ({ ...current, customerName: event.target.value }))} placeholder="Astro" /></label>
                      <label className="field"><span>POD id</span><input type="text" value={adminPodForm.podId} onChange={(event) => setAdminPodForm((current) => ({ ...current, podId: event.target.value }))} placeholder="pod-1" /></label>
                      <label className="field"><span>POD name</span><input type="text" value={adminPodForm.podName} onChange={(event) => setAdminPodForm((current) => ({ ...current, podName: event.target.value }))} placeholder="Astro HUB CNR" /></label>
                      <label className="field"><span>Latitude</span><input type="number" step="any" value={adminPodForm.latitude} onChange={(event) => setAdminPodForm((current) => ({ ...current, latitude: event.target.value }))} /></label>
                      <label className="field"><span>Longitude</span><input type="number" step="any" value={adminPodForm.longitude} onChange={(event) => setAdminPodForm((current) => ({ ...current, longitude: event.target.value }))} /></label>
                      <label className="field"><span>Speed</span><input type="number" step="0.1" value={adminPodForm.speed} onChange={(event) => setAdminPodForm((current) => ({ ...current, speed: event.target.value }))} /></label>
                      <label className="field"><span>Distance meters</span><input type="number" step="0.1" value={adminPodForm.distanceMeters} onChange={(event) => setAdminPodForm((current) => ({ ...current, distanceMeters: event.target.value }))} /></label>
                      <label className="field admin-db-grid-span-2"><span>Location summary</span><input type="text" value={adminPodForm.locationSummary} onChange={(event) => setAdminPodForm((current) => ({ ...current, locationSummary: event.target.value }))} placeholder="Alamat singkat" /></label>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </> : null}

          {activePanel === 'stop' ? <>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Stop / idle explorer</h2><p>On-demand ke endpoint ReportStop supaya nggak spam semua unit sekaligus, tapi tetap usable buat investigasi.</p></div></CardHeader><CardContent><div className="form-grid form-grid-stop"><label className="field"><span>Unit</span><select value={`${stopForm.accountId}::${stopForm.unitId}`} onChange={(event) => { const [accountId, unitId] = event.target.value.split('::'); setStopForm((current) => ({ ...current, accountId: accountId || 'primary', unitId: unitId || '' })); }}>{fleetRows.map((row) => <option key={row.rowKey || `${row.accountId}-${row.id}`} value={`${row.accountId || 'primary'}::${row.id}`}>{accountName({ id: row.accountId, label: row.accountLabel })} | {row.id} | {row.label}</option>)}</select></label><label className="field"><span>Report type</span><select value={stopForm.reportType} onChange={(event) => setStopForm((current) => ({ ...current, reportType: event.target.value }))}><option value="1">Stop Engine Report</option><option value="2">Idle Engine Report</option><option value="3">Speed-based idle/stop Report</option></select></label><label className="field"><span>Min duration (min)</span><input type="number" min="0" value={stopForm.minDuration} onChange={(event) => setStopForm((current) => ({ ...current, minDuration: event.target.value }))} /></label><div className="field field-actions"><Button color="primary" onPress={loadStopReport}>Analyze stop / idle</Button><Button variant="bordered" onPress={exportStop}>Export stop CSV</Button></div></div></CardContent></Card>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Stop/idle result</h2><p>Latitude, longitude, durasi, average temp, dan link ke map.</p></div></CardHeader><CardContent>{stopReport ? <><div className="metric-strip"><div className="mini-metric"><span>Rows</span><strong>{stopReport.summary?.incidents ?? '-'}</strong></div><div className="mini-metric"><span>Total min</span><strong>{fmtNum(stopReport.summary?.totalMinutes, 1)}</strong></div><div className="mini-metric"><span>Longest</span><strong>{fmtNum(stopReport.summary?.longestMinutes, 1)}</strong></div><div className="mini-metric"><span>With lat/lng</span><strong>{stopReport.summary?.withLocation ?? '-'}</strong></div></div><div className="spacer-16" /><DataTable columns={['Start', 'End', 'Minutes', 'Distance', 'Avg temp', 'Location', 'Lat', 'Lng', 'Zone', 'Engine', 'Maps']} emptyMessage="Belum ada row stop/idle di range ini." rows={stopReport.rows.map((row) => [fmtDate(row.startTimestamp), fmtDate(row.endTimestamp), fmtNum(row.durationMinutes, 1), fmtNum(row.movementDistance, 1), fmtNum(row.avgTemp, 1), row.locationSummary || '-', fmtCoord(row.latitude), fmtCoord(row.longitude), row.zoneName || row.zoneBoundary || '-', row.engineDetected === 1 ? 'idle' : row.engineDetected === 0 ? 'stop' : '-', row.googleMapsUrl ? <Link href={row.googleMapsUrl} target="_blank">Open map</Link> : '-'])} /></> : <div className="empty-state">Klik Analyze stop / idle buat ambil report dari Solofleet.</div>}</CardContent></Card>
          </> : null}
        </div>

        
      </main>
      
      {astroDiagnosticsOpen ? <div className="auth-modal-backdrop" onClick={() => setAstroDiagnosticsOpen(false)}><Card className="auth-modal-card diagnostic-modal-card" onClick={(event) => event.stopPropagation()}><CardHeader className="panel-card-header"><div><p className="eyebrow local-eyebrow">Astro Diagnostics</p><h2>Tanggal yang tidak complete</h2><p>Lihat tanggal yang gagal dan requirement yang belum terpenuhi.</p></div><div className="inline-buttons"><Button variant="bordered" onPress={() => setAstroDiagnosticsOpen(false)}>Close</Button></div></CardHeader><CardContent><DataTable pagination={{ initialRowsPerPage: 10, rowsPerPageOptions: [10, 20, 50] }} columns={['Service date', 'Rit', 'Nopol', 'Status', 'Requirement not met']} rows={astroDiagnosticRows} emptyMessage="Belum ada tanggal error untuk report ini." /></CardContent></Card></div> : null}

      {expandedFleetRow ? <div className="fleet-detail-modal-backdrop" onClick={() => setExpandedFleetRowKey('')}>
        <Card className="fleet-detail-modal-card" onClick={(event) => event.stopPropagation()}>
          <CardHeader className="panel-card-header">
            <div>
              <p className="eyebrow local-eyebrow">Fleet live graphic</p>
              <h2>{expandedFleetRow.id} | {expandedFleetRow.label}</h2>
              <p>{expandedFleetRow.accountLabel || expandedFleetRow.accountId || '-'} | {expandedFleetRow.locationSummary || 'No location'}</p>
            </div>
            <div className="inline-buttons">
              <Button variant="bordered" onPress={() => setExpandedFleetRowKey('')}>Close</Button>
            </div>
          </CardHeader>
          <CardContent>
            <FleetExpandedDetails
              row={expandedFleetRow}
              detail={activeDetailRow && unitRowKey(activeDetailRow) === unitRowKey(expandedFleetRow) ? unitDetail : { records: [] }}
              busy={activeDetailRow && unitRowKey(activeDetailRow) === unitRowKey(expandedFleetRow) ? detailBusy : false}
              rangeLabel={`${range.startDate} to ${range.endDate}`}
              onOpenTempErrors={() => {
                openUnit(expandedFleetRow.accountId || 'primary', expandedFleetRow.id, 'temp-errors');
                setExpandedFleetRowKey('');
              }}
              onSeeHistorical={() => {
                openUnit(expandedFleetRow.accountId || 'primary', expandedFleetRow.id, 'historical');
                setExpandedFleetRowKey('');
              }}
            />
          </CardContent>
        </Card>
      </div> : null}
      
      <footer className="status-bar">
        <div className="status-left">
          <div className="status-indicator">
            <span className={`status-dot ${status?.runtime?.isPolling ? 'active' : ''}`}></span>
            <span>Polling {status?.runtime?.isPolling ? 'ON' : 'OFF'}</span>
          </div>
          <span>Next: {fmtDate(status?.runtime?.nextRunAt)}</span>
        </div>
        <div className="status-right">
          <span>Snapshot: {fmtDate(status?.runtime?.lastSnapshotAt)}</span>
          {status?.runtime?.lastSnapshotError && <span className="text-danger" style={{color: 'var(--danger)'}}>Err: {status.runtime.lastSnapshotError}</span>}
        </div>
      </footer>

      {busyOverlay}

      {banner.message && (
        <div className="toast-container">
          <div className={`toast ${banner.tone === 'error' ? 'toast-error' : banner.tone === 'success' ? 'toast-success' : 'toast-info'}`}>
            {banner.tone === 'error' ? <ShieldAlert size={16} /> : <Box size={16} />}
            <span>{banner.message}</span>
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
      <SummaryMetric label="Customer setpoint" value={row.targetTempMin !== null || row.targetTempMax !== null ? `${fmtNum(row.targetTempMin)} to ${fmtNum(row.targetTempMax)}` : 'Not set'} danger={rowHasSetpointIssue(row)} />
      <SummaryMetric label="Status" value={row.liveSensorFaultLabel || row.setpointLabel || (rowHasSensorError(row) ? state.label : 'Normal')} danger={rowHasSetpointIssue(row) || rowHasSensorError(row)} />
      <SummaryMetric label="GPS" value={row.errGps || 'OK'} danger={Boolean(row.errGps) || rowHasGpsLate(row)} />
    </div>
    <UnitRouteMap row={row} records={routeRecords} busy={busy} rangeLabel={rangeLabel} />
    <TemperatureChart records={routeRecords} busy={busy} title="Temperature trend" description="Historical Solofleet dari unit yang sedang kamu buka. Hover line buat lihat suhu dan waktu, lalu pakai zoom controls kalau mau fokus ke window tertentu." compact />
  </div>;
}

function UnitRouteMap({ row, records, busy, rangeLabel }) {
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const containerRef = useRef(null);
  const [showRoute, setShowRoute] = useState(true);
  const trackPoints = useMemo(() => {
    const next = [];
    let previousKey = '';
    for (const record of (records || []).slice().sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0))) {
      const latitude = Number(record?.latitude);
      const longitude = Number(record?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        continue;
      }
      const key = `${latitude.toFixed(6)}:${longitude.toFixed(6)}`;
      if (key === previousKey) {
        continue;
      }
      previousKey = key;
      next.push({
        latitude,
        longitude,
        timestamp: record.timestamp || null,
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
      timestamp: row?.lastUpdatedAt || null,
      locationSummary: row?.locationSummary || '',
    };
  }, [row?.latitude, row?.longitude, row?.lastUpdatedAt, row?.locationSummary]);
  const buildPopupHtml = (title, point) => [
    `<strong>${title}</strong>`,
    point?.timestamp ? fmtDate(point.timestamp) : '-',
    point?.locationSummary || 'No location',
    `${fmtCoord(point?.latitude)}, ${fmtCoord(point?.longitude)}`,
  ].filter(Boolean).join('<br/>');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return undefined;
    }
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    }).setView([row?.latitude || -6.2, row?.longitude || 106.8], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;
    window.setTimeout(() => map.invalidateSize(), 80);
    return () => {
      layer.clearLayers();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [row?.latitude, row?.longitude]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) {
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
      L.polyline(latLngs, {
        color: '#ff7a2f',
        weight: 4,
        opacity: 0.92,
      }).addTo(layer);
    }

    if (trackPoints.length) {
      const startPoint = trackPoints[0];
      bounds.push([startPoint.latitude, startPoint.longitude]);
      L.circleMarker([startPoint.latitude, startPoint.longitude], {
        radius: 6,
        weight: 2,
        color: '#0f172a',
        fillColor: '#34d399',
        fillOpacity: 1,
      }).bindTooltip('Start point').bindPopup(buildPopupHtml('Start point', startPoint)).addTo(layer);

      const endPoint = trackPoints[trackPoints.length - 1];
      bounds.push([endPoint.latitude, endPoint.longitude]);
      L.circleMarker([endPoint.latitude, endPoint.longitude], {
        radius: 7,
        weight: 2,
        color: '#0f172a',
        fillColor: currentMatchesLastTrack ? '#38bdf8' : '#fb923c',
        fillOpacity: 1,
      }).bindTooltip(currentMatchesLastTrack ? 'Current live position' : 'Last history point').bindPopup(buildPopupHtml(currentMatchesLastTrack ? 'Current live position' : 'Last history point', endPoint)).addTo(layer);
    }

    if (currentPoint && !currentMatchesLastTrack) {
      bounds.push([currentPoint.latitude, currentPoint.longitude]);
      L.circleMarker([currentPoint.latitude, currentPoint.longitude], {
        radius: 8,
        weight: 2,
        color: '#0f172a',
        fillColor: '#38bdf8',
        fillOpacity: 1,
      }).bindTooltip('Current live position').bindPopup(buildPopupHtml('Current live position', currentPoint)).addTo(layer);
    }

    if (currentPoint) {
      map.setView([currentPoint.latitude, currentPoint.longitude], 15);
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
    }
    window.setTimeout(() => map.invalidateSize(), 50);
  }, [trackPoints, currentPoint, showRoute]);

  const routePointCount = trackPoints.length;
  const hasMapData = routePointCount > 0 || Boolean(currentPoint);

  return <div className="unit-map-shell unit-map-shell-dark">
    <div className="unit-map-head">
      <div>
        <strong>Route history map</strong>
        <span>{rangeLabel ? `Track mengikuti date range ${rangeLabel}` : 'Track mengikuti historical data yang sedang ditarik.'}</span>
      </div>
      <div className="unit-map-actions">
        <Button variant="bordered" onPress={() => setShowRoute((current) => !current)}>{showRoute ? 'Hide route' : 'Show route'}</Button>
      </div>
      <div className="chip-row unit-map-chip-row">
        <Chip variant="flat">{routePointCount ? `${routePointCount} titik route` : 'Belum ada titik route'}</Chip>
        <Chip variant="flat">OSM dark mode</Chip>
        <Chip variant="flat">Start / current / end marker</Chip>
      </div>
    </div>
    <div className="unit-map-frame">
      <div ref={containerRef} className="unit-map-canvas" />
      {busy ? <div className="unit-map-overlay">Loading route map...</div> : null}
      {!busy && !hasMapData ? <div className="unit-map-overlay">Belum ada koordinat historis untuk digambar di map.</div> : null}
    </div>
  </div>;
}

function TemperatureChart({ records, busy, title, description, compact = false }) {
  const chartId = useId().replace(/:/g, '');
  const fullSeries = useMemo(() => (records || [])
    .filter((record) => record.temp1 !== null || record.temp2 !== null)
    .slice()
    .sort((left, right) => (left.timestamp || 0) - (right.timestamp || 0))
    .slice(), [records]);
  const [zoomRange, setZoomRange] = useState({ start: 0, end: 0 });
  const [hoverIndex, setHoverIndex] = useState(null);
  const [dragState, setDragState] = useState(null);

  useEffect(() => {
    setZoomRange({ start: 0, end: Math.max(0, fullSeries.length - 1) });
    setHoverIndex(null);
    setDragState(null);
  }, [fullSeries.length, fullSeries[0]?.timestamp, fullSeries[fullSeries.length - 1]?.timestamp]);

  if (busy) return <div className="chart-empty">Loading chart...</div>;
  if (!fullSeries.length) return <div className="chart-empty">Belum ada historical temperature yang cukup buat digambar.</div>;

  const totalPoints = fullSeries.length;
  const rangeStart = Math.max(0, Math.min(zoomRange.start, totalPoints - 1));
  const rangeEnd = Math.max(rangeStart, Math.min(zoomRange.end, totalPoints - 1));
  const series = fullSeries.slice(rangeStart, rangeEnd + 1);
  const width = 860;
  const height = compact ? 240 : 320;
  const padding = { top: 20, right: 20, bottom: 34, left: 44 };
  const temps = series.flatMap((record) => [record.temp1, record.temp2]).filter((value) => value !== null && value !== undefined);
  const rawMin = Math.min(...temps);
  const rawMax = Math.max(...temps);
  const pad = Math.max(1, (rawMax - rawMin) * 0.18 || 1);
  const minY = rawMin - pad;
  const maxY = rawMax + pad;
  const timeStart = series[0].timestamp;
  const timeEnd = series[series.length - 1].timestamp;
  const xFor = (timestamp) => timeStart === timeEnd ? padding.left : padding.left + ((timestamp - timeStart) / (timeEnd - timeStart)) * (width - padding.left - padding.right);
  const yFor = (value) => value === null || value === undefined ? null : height - padding.bottom - ((value - minY) / (maxY - minY || 1)) * (height - padding.top - padding.bottom);
  const buildPath = (field) => series.reduce((path, point) => {
    const y = yFor(point[field]);
    if (y === null) return path;
    const x = xFor(point.timestamp);
    return `${path}${path ? ' L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }, '');
  const temp1Path = buildPath('temp1');
  const temp2Path = buildPath('temp2');
  const guideValues = [minY, (minY + maxY) / 2, maxY];
  const timeGuides = [timeStart, timeStart + (timeEnd - timeStart) / 2, timeEnd];
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
    <div className="chart-stage">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Temperature trend chart" onMouseDown={handlePointerDown} onMouseMove={handlePointerMove} onMouseUp={handlePointerUp} onMouseLeave={handlePointerLeave}>
        <defs>
          <linearGradient id={`fillTemp1-${chartId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F97316" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#F97316" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id={`fillTemp2-${chartId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#A855F7" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#A855F7" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="12" fill="rgba(14,20,32,0.6)" />
        {guideValues.map((value, index) => {
          const y = yFor(value);
          return <g key={`guide-${index}`}><line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="rgba(255, 255, 255, 0.08)" strokeDasharray="6 8" /><text x="8" y={y + 4} fontSize="12" fill="rgba(255, 255, 255, 0.4)">{Number(value).toFixed(1)}</text></g>;
        })}
        {timeGuides.map((value, index) => {
          const x = xFor(value);
          return <g key={`time-${index}`}><line x1={x} x2={x} y1={padding.top} y2={height - padding.bottom} stroke="rgba(255, 255, 255, 0.04)" /><text x={x} y={height - 10} fontSize="12" textAnchor={index === 0 ? 'start' : index === timeGuides.length - 1 ? 'end' : 'middle'} fill="rgba(255, 255, 255, 0.4)">{fmtClock(value)}</text></g>;
        })}
        {temp1Path ? <path d={`${temp1Path} L ${xFor(timeEnd)} ${height - padding.bottom} L ${xFor(timeStart)} ${height - padding.bottom} Z`} fill={`url(#fillTemp1-${chartId})`} /> : null}
        {temp1Path ? <path d={temp1Path} fill="none" stroke="#F97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {temp2Path ? <path d={`${temp2Path} L ${xFor(timeEnd)} ${height - padding.bottom} L ${xFor(timeStart)} ${height - padding.bottom} Z`} fill={`url(#fillTemp2-${chartId})`} /> : null}
        {temp2Path ? <path d={temp2Path} fill="none" stroke="#A855F7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {dragState && selectionWidth > 0 ? <rect x={selectionStart} y={padding.top} width={selectionWidth} height={height - padding.top - padding.bottom} fill="rgba(249,115,22,0.14)" stroke="rgba(249,115,22,0.62)" strokeDasharray="6 6" rx="8" /> : null}
        {hoveredPoint ? <g>
          <line x1={hoveredPoint.x} x2={hoveredPoint.x} y1={padding.top} y2={height - padding.bottom} stroke="rgba(255,255,255,0.28)" strokeDasharray="4 6" />
          {hoveredPoint.temp1Y !== null ? <circle cx={hoveredPoint.x} cy={hoveredPoint.temp1Y} r="4.5" fill="#F97316" stroke="#0b1220" strokeWidth="2" /> : null}
          {hoveredPoint.temp2Y !== null ? <circle cx={hoveredPoint.x} cy={hoveredPoint.temp2Y} r="4.5" fill="#A855F7" stroke="#0b1220" strokeWidth="2" /> : null}
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
}

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
    ? options.filter((option) => String(option.label || '').toLowerCase().includes(normalizedQuery) || String(option.value || '').toLowerCase().includes(normalizedQuery))
    : options;

  const pickOption = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
  };

  return <label className="field searchable-field" ref={wrapperRef}><span>{label}</span><button type="button" className={`searchable-trigger ${open ? 'is-open' : ''}`} onClick={() => setOpen((current) => !current)}><span className={`searchable-trigger-text ${selectedOption ? '' : 'is-placeholder'}`}>{selectedOption?.label || placeholder}</span><span className="searchable-trigger-icon">v</span></button>{open ? <div className="searchable-dropdown"><div className="searchable-dropdown-search"><Search size={14} /><input ref={searchInputRef} type="text" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} /></div><div className="searchable-dropdown-list">{filteredOptions.length ? filteredOptions.map((option) => <button key={`${label}-${option.value || 'empty'}`} type="button" className={`searchable-option ${option.value === value ? 'is-selected' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => pickOption(option.value)}>{option.label}</button>) : <div className="searchable-empty">No match found</div>}</div></div> : null}</label>;
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
  })}</tbody></table>{pagination ? <div className="table-pagination"><div className="table-pagination-meta"><span>Rows per page</span><select value={rowsPerPage} onChange={(event) => {
    const nextRowsPerPage = Number(event.target.value || initialRowsPerPage);
    setRowsPerPage(nextRowsPerPage);
    setPage(1);
  }}>{rowsPerPageOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></div><div className="table-pagination-meta">Page {page} of {totalPages}</div><div className="table-pagination-controls"><button type="button" className="table-page-button" onClick={() => setPage(1)} disabled={page <= 1}>{'<<'}</button><button type="button" className="table-page-button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>{'<'}</button><button type="button" className="table-page-button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>{'>'}</button><button type="button" className="table-page-button" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>{'>>'}</button></div></div> : null}</div>;
}









































































































