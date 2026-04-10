require('dotenv').config();
const http = require('http');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('node:zlib');
const { Pool } = require('pg');
const { URL } = require('url');
const core = require('./web/report-core.js');
const astroCore = require('./astro-core.js');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const WEB_ROOT = fs.existsSync(path.join(__dirname, 'web-dist'))
  ? path.join(__dirname, 'web-dist')
  : path.join(__dirname, 'web');
const DATA_ROOT = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_ROOT, 'config.json');
const STATE_FILE = path.join(DATA_ROOT, 'state.json');
const LOGIN_RATE_LIMITS_FILE = path.join(DATA_ROOT, 'login-rate-limits.json');
const REMOTE_RESET_LOGS_FILE = path.join(DATA_ROOT, 'remote-reset-logs.json');

const DEFAULT_REMOTE_RESET_AUTOMATION = {
  enabled: false,
  intervalHours: 3,
  selectedAccountIds: [],
  tempErrorOnly: true,
  maxUnitsPerRun: 10,
  requestSpacingSeconds: 3,
  onlyWhenPollingActive: true,
};

const DEFAULT_TMS_CONFIG = {
  tenantLabel: 'Primary TMS',
  baseUrl: '',
  username: '',
  password: '',
  sessionCookie: '',
  csrfToken: '',
  autoSync: true,
  syncIntervalMinutes: 15,
  geofenceRadiusMeters: 300,
  longStopMinutes: 45,
  appStagnantMinutes: 60,
};
const TRIP_MONITOR_LONG_STOP_MINUTES = 180;
const TRIP_MONITOR_LONG_STOP_RADIUS_METERS = 150;
const TRIP_MONITOR_IDLE_SPEED_THRESHOLD_KPH = 1;
const TRIP_MONITOR_TEMP_ABOVE_MAX_MINUTES = 20;
const TRIP_MONITOR_STATUS_RADIUS_METERS = 1000;
const TMS_ADDRESS_CACHE_RESOLVED_TTL_MS = 24 * 60 * 60 * 1000;
const TMS_ADDRESS_CACHE_MISSING_TTL_MS = 6 * 60 * 60 * 1000;
const TRIP_MONITOR_TEMP_TOLERANCE = 0.3;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const DEFAULT_CONFIG = {
  solofleetBaseUrl: 'https://www.solofleet.com',
  endpointPath: '/ReportTemperatureChart/getVehicleDetailDefrostJson',
  historicalEndpointPath: '/ReportDailyDetail/getVehicleDetailJsonWithoutZoneCalcFilterevery1minCalc',
  refererPath: '/ReportTemperatureChart',
  vehiclePagePath: '/Vehicle',
  discoveryEndpointPath: '/Vehicle/vehiclelivewithoutzonetripNewModelCondense',
  vehicleRoleId: '',
  authEmail: '',
  sessionCookie: '',
  pollIntervalSeconds: 60,
  requestLookbackMinutes: 30,
  requestIntervalSeconds: 120,
  historyRetentionDays: 7,
  minDurationMinutes: 5,
  maxGapMinutes: null,
  archiveType: 'liveserver',
  tempProfile: '-1',
  temperatureProcessing: '',
  autoStart: false,
  units: [],
  customerProfiles: [],
  podSites: [],
  astroLocations: [],
  astroRoutes: [],
  linkedAccounts: [],
  activeAccountId: 'primary',
  webSessionSecret: '',
  remoteResetAutomation: DEFAULT_REMOTE_RESET_AUTOMATION,
  tms: DEFAULT_TMS_CONFIG,
};

const DEFAULT_STATE = {
  runtime: {
    isPolling: false,
    lastRunStartedAt: null,
    lastRunFinishedAt: null,
    lastRunDurationMs: null,
    lastRunMessage: 'Idle',
    nextRunAt: null,
    lastSnapshotAt: null,
    lastSnapshotError: null,
  },
  fleet: {
    fetchedAt: null,
    lastError: null,
    vehicles: {},
  },
  units: {},
  dailySnapshots: [],
  podSnapshots: [],
  linkedAccounts: {},
};

let config = null;
let state = null;
let pollTimer = null;
let remoteResetTimer = null;
let pollInFlight = false;
let remoteResetInFlight = false;
let astroSyncTimer = null;
let tmsSyncTimer = null;
let isFirstTmsSyncSchedule = true;
const ASTRO_SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000;
const ASTRO_SNAPSHOT_LOG_LIMIT = 100;
const astroSnapshotLogs = [];
const TMS_SYNC_LOG_LIMIT = 100;
const tmsSyncLogs = [];
const API_MONITOR_LIMIT = 250;
const apiMonitorLog = [];
const WEB_AUTH_COOKIE_NAME = 'solofleet_web_session';
const WEB_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
let postgresPool = null;
let saveConfigInFlight = null;
let saveConfigPending = false;
let saveStateInFlight = null;
let saveStatePending = false;
const SOLOFLEET_UTC_OFFSET_MINUTES = Number(process.env.SOLOFLEET_UTC_OFFSET_MINUTES || 420);
const LOGIN_RATE_LIMIT_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || (15 * 60 * 1000));
const WEB_LOGIN_RATE_LIMIT_MAX = Number(process.env.WEB_LOGIN_RATE_LIMIT_MAX || 10);
const SOLOFLEET_LOGIN_RATE_LIMIT_MAX = Number(process.env.SOLOFLEET_LOGIN_RATE_LIMIT_MAX || 8);
const REMOTE_RESET_DEFAULT_LOG_LIMIT = 20;
const SUPABASE_REQUEST_TIMEOUT_MS = Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS || 5000);
const POSTGRES_CONNECT_TIMEOUT_MS = Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS || 5000);
const POSTGRES_QUERY_TIMEOUT_MS = Number(process.env.POSTGRES_QUERY_TIMEOUT_MS || 8000);
const TMS_REQUEST_TIMEOUT_MS = Number(process.env.TMS_REQUEST_TIMEOUT_MS || 20000);
const UNIT_CATEGORY_LABELS = {
  oncall: 'OnCall',
  'dedicated-astro': 'Dedicated Astro',
  'dedicated-havi': 'Dedicated HAVI',
  uncategorized: 'Uncategorized',
};
function fleetRowHasSensorError(row) {
  return Boolean(row && row.hasLiveSensorFault);
}

function fleetRowIsCriticalError(row) {
  return row && row.liveSensorFaultType === 'temp1+temp2';
}

function fleetRowHasSetpointIssue(row) {
  return Boolean(row && row.outsideSetpoint);
}

function fleetRowHasGpsLate(row) {
  return row && row.minutesSinceUpdate !== null && row.minutesSinceUpdate > 30;
}

function rowPriority(row) {
  if (fleetRowIsCriticalError(row)) return 6;
  if (fleetRowHasSensorError(row)) return 5;
  if (fleetRowHasSetpointIssue(row)) return 4;
  if (fleetRowHasGpsLate(row)) return 3;
  if (row && row.errGps) return 2;
  if (row && row.isMoving) return 1;
  return 0;
}

const remoteResetRuntime = {
  nextRunAt: null,
  lastRunStartedAt: null,
  lastRunFinishedAt: null,
  lastRunSummary: null,
  lastRunMessage: 'Idle',
};

function recordApiMonitorEvent(entry) {
  apiMonitorLog.push(entry);
  if (apiMonitorLog.length > API_MONITOR_LIMIT) {
    apiMonitorLog.splice(0, apiMonitorLog.length - API_MONITOR_LIMIT);
  }
}

function buildApiMonitorPayload() {
  const endpointMap = new Map();
  const recent = [...apiMonitorLog].slice().reverse();
  for (const entry of recent) {
    const key = `${entry.method} ${entry.path}`;
    if (!endpointMap.has(key)) {
      endpointMap.set(key, {
        key,
        method: entry.method,
        path: entry.path,
        hits: 0,
        errorCount: 0,
        avgDurationMs: 0,
        lastStatusCode: null,
        lastError: '',
        lastAt: null,
      });
    }
    const row = endpointMap.get(key);
    row.hits += 1;
    row.avgDurationMs += Number(entry.durationMs || 0);
    row.lastStatusCode = entry.statusCode;
    row.lastError = entry.error || row.lastError;
    row.lastAt = entry.timestamp;
    if (Number(entry.statusCode || 0) >= 400) {
      row.errorCount += 1;
    }
  }

  const endpointSummary = [...endpointMap.values()].map(function (row) {
    return {
      ...row,
      avgDurationMs: row.hits ? Number((row.avgDurationMs / row.hits).toFixed(1)) : 0,
    };
  }).sort(function (left, right) {
    return right.hits - left.hits || String(left.path).localeCompare(String(right.path));
  });

  return {
    ok: true,
    now: Date.now(),
    recent,
    endpointSummary,
    totals: {
      requests: recent.length,
      errors: recent.filter(function (entry) { return Number(entry.statusCode || 0) >= 400; }).length,
      slowRequests: recent.filter(function (entry) { return Number(entry.durationMs || 0) >= 1500; }).length,
      uniqueEndpoints: endpointSummary.length,
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTemperatureRange(minValue, maxValue) {
  const numericValues = [toNumber(minValue), toNumber(maxValue)].filter(Number.isFinite);
  if (!numericValues.length) {
    return { min: null, max: null };
  }
  return {
    min: Math.min(...numericValues),
    max: Math.max(...numericValues),
  };
}

function normalizeUnitKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUnitCategory(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return 'uncategorized';
  }

  if (raw === 'oncall' || raw === 'on-call' || raw === 'on call') {
    return 'oncall';
  }
  if (
    raw === 'dedicated-astro'
    || raw === 'dedicated astro'
    || raw === 'astro'
    || raw === 'dedicatedastro'
  ) {
    return 'dedicated-astro';
  }
  if (
    raw === 'dedicated-havi'
    || raw === 'dedicated havi'
    || raw === 'havi'
    || raw === 'dedicatedhavi'
  ) {
    return 'dedicated-havi';
  }
  if (
    raw === 'uncategorized'
    || raw === 'unassigned'
    || raw === 'unknown'
    || raw === 'belum-diset'
    || raw === 'belum diset'
  ) {
    return 'uncategorized';
  }

  return 'uncategorized';
}

function toTimestampMaybe(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const localMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (localMatch && !/(Z|[+\-]\d{2}:?\d{2})$/i.test(text)) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = localMatch;
    const utcTimestamp = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) - (SOLOFLEET_UTC_OFFSET_MINUTES * 60 * 1000);
    return Number.isFinite(utcTimestamp) ? utcTimestamp : null;
  }

  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function buildLocationSummary(parts) {
  return parts
    .map(function (value) { return String(value || '').trim(); })
    .filter(Boolean)
    .filter(function (value, index, values) { return values.indexOf(value) === index; })
    .join(', ');
}

function normalizeFleetVehicle(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const unitId = String(value.vehicleid ?? value.ddl ?? value.value ?? '').trim();
  if (!unitId) {
    return null;
  }

  const latitude = toNumber(value.y ?? value.lat ?? value.latitude);
  const longitude = toNumber(value.x ?? value.lng ?? value.longtitude ?? value.longitude);
  const temp1 = toNumber(value.vtemp1 ?? value.temp1 ?? value.t1);
  const temp2 = toNumber(value.vtemp2 ?? value.temp2 ?? value.t2);
  const speed = toNumber(value.spd ?? value.speed);
  const lastUpdated = value.lastupdated || value.gpstime || value.datetime || null;
  const lastUpdatedMs = toTimestampMaybe(lastUpdated);

  return {
    unitKey: normalizeUnitKey(unitId),
    unitId,
    alias: String(value.alias || value.vehiclealias || unitId).trim() || unitId,
    group: String(value.vgp || value.vehiclegroup || '').trim(),
    deviceId: String(value.deviceid || '').trim(),
    latitude,
    longitude,
    speed,
    temp1,
    temp2,
    tempDelta: temp1 !== null && temp2 !== null ? Math.abs(temp1 - temp2) : null,
    locationSummary: buildLocationSummary([
      value.stn,
      value.subd,
      value.dnm,
      value.City || value.city,
      value.Province || value.province,
    ]),
    zoneName: String(value.zonename || value.currentzonename || '').trim(),
    errGps: String(value.err_gps || '').trim(),
    errSensor: String(value.err_sns || '').trim(),
    todayKm: toNumber(value.todaykm),
    powerSupply: toNumber(value.powersupply),
    batteryVoltage: toNumber(value.battvoltage),
    door: String(value.door || '').trim(),
    course: toNumber(value.course),
    iconType: String(value.icontype || '').trim(),
    lastUpdated,
    lastUpdatedMs,
    raw: value,
  };
}

function normalizeUnit(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const id = String(value.id ?? value.ddl ?? '').trim();
  if (!id) {
    return null;
  }

  const label = String(value.label ?? value.name ?? value.alias ?? id).trim() || id;
  const category = normalizeUnitCategory(value.category);
  return {
    id,
    label,
    category,
    categoryLabel: UNIT_CATEGORY_LABELS[category] || UNIT_CATEGORY_LABELS.uncategorized,
  };
}

function splitCsvish(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map(function (item) { return item.trim(); })
    .filter(Boolean);
}

function normalizeCustomerProfile(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const name = String(value.name || value.customerName || value.id || '').trim();
  if (!name) {
    return null;
  }

  return {
    id: String(value.id || name).trim(),
    name,
    tempMin: toNumber(value.tempMin ?? value.minTemp ?? value.min),
    tempMax: toNumber(value.tempMax ?? value.maxTemp ?? value.max),
    unitIds: Array.isArray(value.unitIds)
      ? value.unitIds.map(function (item) { return String(item || '').trim(); }).filter(Boolean)
      : splitCsvish(value.unitIds),
    notes: String(value.notes || '').trim(),
  };
}

function normalizePodSite(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const name = String(value.name || value.podName || value.id || '').trim();
  if (!name) {
    return null;
  }

  const latitude = toNumber(value.latitude ?? value.lat);
  const longitude = toNumber(value.longitude ?? value.lng ?? value.longtitude);
  if (latitude === null || longitude === null) {
    return null;
  }

  return {
    id: String(value.id || name).trim(),
    name,
    customerId: String(value.customerId || value.customerName || '').trim(),
    latitude,
    longitude,
    radiusMeters: Math.max(20, toNumber(value.radiusMeters ?? value.radius ?? 150) || 150),
    maxSpeedKph: Math.max(0, toNumber(value.maxSpeedKph ?? value.maxSpeed ?? 5) || 5),
    unitIds: Array.isArray(value.unitIds)
      ? value.unitIds.map(function (item) { return String(item || '').trim(); }).filter(Boolean)
      : splitCsvish(value.unitIds),
    notes: String(value.notes || '').trim(),
  };
}

function normalizeLinkedAccount(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const id = String(value.id || value.accountId || value.authEmail || '').trim();
  if (!id) {
    return null;
  }

  return {
    id,
    label: String(value.label || value.name || value.authEmail || id).trim() || id,
    authEmail: String(value.authEmail || '').trim(),
    sessionCookie: String(value.sessionCookie || '').trim(),
    vehicleRoleId: String(value.vehicleRoleId || '').trim(),
    units: Array.isArray(value.units) ? value.units.map(normalizeUnit).filter(Boolean) : [],
    customerProfiles: Array.isArray(value.customerProfiles) ? value.customerProfiles.map(normalizeCustomerProfile).filter(Boolean) : [],
    podSites: Array.isArray(value.podSites) ? value.podSites.map(normalizePodSite).filter(Boolean) : [],
  };
}


function normalizeWebUser(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const username = String(value.username || '').trim().toLowerCase();
  if (!username) {
    return null;
  }

  const createdAt = String(value.createdAt || value.created_at || new Date().toISOString()).trim() || new Date().toISOString();
  const updatedAt = String(value.updatedAt || value.updated_at || createdAt).trim() || createdAt;

  return {
    id: String(value.id || username).trim() || username,
    username,
    displayName: String(value.displayName || value.display_name || username).trim() || username,
    passwordHash: String(value.passwordHash || value.password_hash || '').trim(),
    role: String(value.role || 'admin').trim() || 'admin',
    isActive: value.isActive === undefined ? (value.is_active !== undefined ? Boolean(value.is_active) : true) : Boolean(value.isActive),
    createdAt,
    updatedAt,
  };
}

function normalizeRemoteResetAutomation(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    enabled: Boolean(source.enabled),
    intervalHours: 3,
    selectedAccountIds: Array.isArray(source.selectedAccountIds)
      ? [...new Set(source.selectedAccountIds.map(function (item) { return String(item || '').trim() || null; }).filter(Boolean))]
      : [],
    tempErrorOnly: true,
    maxUnitsPerRun: 10,
    requestSpacingSeconds: 3,
    onlyWhenPollingActive: true,
  };
}

function normalizeTmsConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    tenantLabel: String(source.tenantLabel || DEFAULT_TMS_CONFIG.tenantLabel).trim() || DEFAULT_TMS_CONFIG.tenantLabel,
    baseUrl: String(source.baseUrl || '').trim().replace(/\/+$/, ''),
    username: String(source.username || '').trim(),
    password: String(source.password || '').trim(),
    sessionCookie: String(source.sessionCookie || '').trim(),
    csrfToken: String(source.csrfToken || '').trim(),
    autoSync: source.autoSync === undefined ? Boolean(DEFAULT_TMS_CONFIG.autoSync) : Boolean(source.autoSync),
    syncIntervalMinutes: Math.max(5, Number(source.syncIntervalMinutes || DEFAULT_TMS_CONFIG.syncIntervalMinutes)),
    geofenceRadiusMeters: Math.max(50, Number(source.geofenceRadiusMeters || DEFAULT_TMS_CONFIG.geofenceRadiusMeters)),
    longStopMinutes: Math.max(5, Number(source.longStopMinutes || DEFAULT_TMS_CONFIG.longStopMinutes)),
    appStagnantMinutes: Math.max(5, Number(source.appStagnantMinutes || DEFAULT_TMS_CONFIG.appStagnantMinutes)),
  };
}

function normalizeConfig(raw) {
  const merged = {
    ...clone(DEFAULT_CONFIG),
    ...(raw && typeof raw === 'object' ? raw : {}),
  };

  merged.solofleetBaseUrl = String(merged.solofleetBaseUrl || DEFAULT_CONFIG.solofleetBaseUrl).replace(/\/+$/, '');
  merged.endpointPath = String(merged.endpointPath || DEFAULT_CONFIG.endpointPath);
  merged.refererPath = String(merged.refererPath || DEFAULT_CONFIG.refererPath);
  merged.vehiclePagePath = String(merged.vehiclePagePath || DEFAULT_CONFIG.vehiclePagePath);
  merged.discoveryEndpointPath = String(merged.discoveryEndpointPath || DEFAULT_CONFIG.discoveryEndpointPath);
  merged.vehicleRoleId = String(merged.vehicleRoleId || '');
  merged.authEmail = String(merged.authEmail || '');
  merged.sessionCookie = String(merged.sessionCookie || '');
  merged.pollIntervalSeconds = Math.max(15, Number(merged.pollIntervalSeconds || DEFAULT_CONFIG.pollIntervalSeconds));
  merged.requestLookbackMinutes = Math.max(10, Number(merged.requestLookbackMinutes || DEFAULT_CONFIG.requestLookbackMinutes));
  merged.requestIntervalSeconds = Math.max(30, Number(merged.requestIntervalSeconds || DEFAULT_CONFIG.requestIntervalSeconds));
  merged.historyRetentionDays = Math.max(1, Number(merged.historyRetentionDays || DEFAULT_CONFIG.historyRetentionDays));
  merged.minDurationMinutes = Math.max(1, Number(merged.minDurationMinutes || DEFAULT_CONFIG.minDurationMinutes));
  merged.maxGapMinutes = merged.maxGapMinutes === null || merged.maxGapMinutes === undefined || merged.maxGapMinutes === ''
    ? null
    : Math.max(1, Number(merged.maxGapMinutes));
  merged.archiveType = String(merged.archiveType || DEFAULT_CONFIG.archiveType);
  merged.tempProfile = String(merged.tempProfile || DEFAULT_CONFIG.tempProfile);
  merged.temperatureProcessing = String(merged.temperatureProcessing || DEFAULT_CONFIG.temperatureProcessing);
  merged.autoStart = Boolean(merged.autoStart);
  merged.units = Array.isArray(merged.units)
    ? merged.units.map(normalizeUnit).filter(Boolean)
    : [];
  merged.customerProfiles = Array.isArray(merged.customerProfiles)
    ? merged.customerProfiles.map(normalizeCustomerProfile).filter(Boolean)
    : [];
  merged.podSites = Array.isArray(merged.podSites)
    ? merged.podSites.map(normalizePodSite).filter(Boolean)
    : [];
  merged.astroLocations = Array.isArray(merged.astroLocations)
    ? merged.astroLocations.map(astroCore.normalizeAstroLocation).filter(Boolean)
    : [];
  merged.astroRoutes = Array.isArray(merged.astroRoutes)
    ? merged.astroRoutes.map(astroCore.normalizeAstroRoute).filter(Boolean)
    : [];
  merged.linkedAccounts = Array.isArray(merged.linkedAccounts)
    ? merged.linkedAccounts.map(normalizeLinkedAccount).filter(Boolean)
    : [];
  merged.activeAccountId = String(merged.activeAccountId || 'primary').trim() || 'primary';
  merged.webSessionSecret = String(merged.webSessionSecret || '').trim();
  merged.remoteResetAutomation = normalizeRemoteResetAutomation(merged.remoteResetAutomation);
  merged.tms = normalizeTmsConfig(merged.tms);
  merged.webUsers = Array.isArray(merged.webUsers)
    ? merged.webUsers.map(normalizeWebUser).filter(Boolean)
    : [];

  return merged;
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const timestamp = Number(record.timestamp);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return {
    timestamp,
    vehicle: String(record.vehicle || 'Unknown Unit'),
    speed: toNumber(record.speed),
    temp1: toNumber(record.temp1),
    temp2: toNumber(record.temp2),
    latitude: toNumber(record.latitude),
    longitude: toNumber(record.longitude),
    locationSummary: String(record.locationSummary || ''),
    zoneName: String(record.zoneName || ''),
    powerSupply: toNumber(record.powerSupply),
    errSensor: String(record.errSensor || ''),
  };
}

function normalizeUnitState(unitId, value) {
  const source = value && typeof value === 'object' ? value : {};
  const records = Array.isArray(source.records)
    ? source.records.map(normalizeRecord).filter(Boolean).sort(function (left, right) {
      return left.timestamp - right.timestamp;
    })
    : [];

  return {
    unitId,
    label: String(source.label || unitId),
    vehicle: String(source.vehicle || source.label || unitId),
    lastFetchStartedAt: source.lastFetchStartedAt || null,
    lastFetchCompletedAt: source.lastFetchCompletedAt || null,
    lastSuccessAt: source.lastSuccessAt || null,
    lastError: source.lastError || null,
    records,
    analysis: null,
  };
}

function createEmptyAccountState() {
  return {
    runtime: clone(DEFAULT_STATE.runtime),
    fleet: {
      fetchedAt: null,
      lastError: null,
      vehicles: {},
    },
    units: {},
    dailySnapshots: [],
    podSnapshots: [],
  };
}

function normalizeState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const runtime = source.runtime && typeof source.runtime === 'object' ? source.runtime : {};
  const fleetSource = source.fleet && typeof source.fleet === 'object' ? source.fleet : {};
  const fleetVehiclesSource = fleetSource.vehicles && typeof fleetSource.vehicles === 'object' ? fleetSource.vehicles : {};
  const unitsSource = source.units && typeof source.units === 'object' ? source.units : {};
  const fleetVehicles = {};
  const units = {};
  const dailySnapshots = Array.isArray(source.dailySnapshots) ? source.dailySnapshots.filter(function (item) { return item && typeof item === 'object'; }) : [];
  const podSnapshots = Array.isArray(source.podSnapshots) ? source.podSnapshots.filter(function (item) { return item && typeof item === 'object'; }) : [];
  const linkedAccountsSource = source.linkedAccounts && typeof source.linkedAccounts === 'object' ? source.linkedAccounts : {};
  const linkedAccounts = {};

  for (const [unitKey, vehicleValue] of Object.entries(fleetVehiclesSource)) {
    const normalized = normalizeFleetVehicle(vehicleValue);
    if (normalized) {
      fleetVehicles[unitKey] = normalized;
    }
  }

  for (const [unitId, unitValue] of Object.entries(unitsSource)) {
    units[unitId] = normalizeUnitState(unitId, unitValue);
  }

  for (const [accountId, accountValue] of Object.entries(linkedAccountsSource)) {
    linkedAccounts[accountId] = normalizeState(accountValue);
  }

  return {
    runtime: {
      isPolling: Boolean(runtime.isPolling),
      lastRunStartedAt: runtime.lastRunStartedAt || null,
      lastRunFinishedAt: runtime.lastRunFinishedAt || null,
      lastRunDurationMs: runtime.lastRunDurationMs || null,
      lastRunMessage: runtime.lastRunMessage || DEFAULT_STATE.runtime.lastRunMessage,
      nextRunAt: runtime.nextRunAt || null,
      lastSnapshotAt: runtime.lastSnapshotAt || null,
      lastSnapshotError: runtime.lastSnapshotError || null,
    },
    fleet: {
      fetchedAt: fleetSource.fetchedAt || null,
      lastError: fleetSource.lastError || null,
      vehicles: fleetVehicles,
    },
    units,
    dailySnapshots,
    podSnapshots,
    linkedAccounts,
  };
}

function ensureDataFiles() {
  try {
    fs.mkdirSync(DATA_ROOT, { recursive: true });
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    }
    if (!fs.existsSync(STATE_FILE)) {
      fs.writeFileSync(STATE_FILE, JSON.stringify(DEFAULT_STATE, null, 2));
    }
    if (!fs.existsSync(LOGIN_RATE_LIMITS_FILE)) {
      fs.writeFileSync(LOGIN_RATE_LIMITS_FILE, JSON.stringify({}, null, 2));
    }
    if (!fs.existsSync(REMOTE_RESET_LOGS_FILE)) {
      fs.writeFileSync(REMOTE_RESET_LOGS_FILE, JSON.stringify([], null, 2));
    }
  } catch (error) {
    console.error('Failed to ensure local data files:', error.message);
  }
}

function loadJsonFile(filePath, fallbackValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return clone(fallbackValue);
  }
}

function saveJsonFile(filePath, value) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  } catch (error) {
    console.error('Failed to write local json file', filePath, error.message);
  }
}

function loadLocalRemoteResetLogs() {
  const rows = loadJsonFile(REMOTE_RESET_LOGS_FILE, []);
  return Array.isArray(rows) ? rows.filter(function (row) { return row && typeof row === 'object'; }) : [];
}

function saveLocalRemoteResetLogs(rows) {
  const normalizedRows = Array.isArray(rows) ? rows.filter(function (row) { return row && typeof row === 'object'; }) : [];
  saveJsonFile(REMOTE_RESET_LOGS_FILE, normalizedRows.slice(0, 1000));
}

async function saveConfig() {
  saveConfigPending = true;
  if (saveConfigInFlight) {
    return saveConfigInFlight;
  }
  saveConfigInFlight = (async function flushConfigSaveQueue() {
    while (saveConfigPending) {
      saveConfigPending = false;
      const configSnapshot = JSON.parse(JSON.stringify(config || {}));
      if (getPostgresConfig().enabled) {
        try {
          await postgresUpsertJsonSetting('app_settings', 'config_data', configSnapshot);
          continue;
        } catch (error) {
          console.error('Failed to save config to PostgreSQL:', error.message);
        }
      }
      if (!getSupabaseWebAuthConfig().enabled) {
        saveJsonFile(CONFIG_FILE, configSnapshot);
        continue;
      }
      try {
        await supabaseRestRequest('POST', 'app_settings', {
          headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
          body: [{ id: 'default', config_data: configSnapshot, updated_at: new Date().toISOString() }],
        });
      } catch (error) {
        console.error('Failed to save config to Supabase:', error.message);
        saveJsonFile(CONFIG_FILE, configSnapshot);
      }
    }
  })().finally(function () {
    saveConfigInFlight = null;
  });
  return saveConfigInFlight;
}

function getPostgresConfig() {
  const connectionString = String(
    process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRES_CONNECTION_STRING
    || config?.postgresUrl
    || '',
  ).trim();
  return {
    connectionString,
    enabled: Boolean(connectionString),
  };
}

function getSupabaseWebAuthConfig() {
  const url = String(process.env.SUPABASE_URL || config?.supabaseUrl || '').trim().replace(/\/+$/, '');
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || config?.supabaseServiceRoleKey || '').trim();
  return {
    url,
    serviceRoleKey,
    enabled: Boolean(url && serviceRoleKey),
  };
}

function sanitizeWebUserForClient(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: Boolean(user.isActive),
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

function buildWebAuthConfigForClient(sessionUser) {
  return {
    sessionUser: sessionUser ? sanitizeWebUserForClient(sessionUser) : null,
  };
}

function hashPassword(password, existingSalt) {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const digest = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `scrypt:${salt}:${digest}`;
}

function verifyPassword(password, passwordHash) {
  const value = String(passwordHash || '');
  if (!value.startsWith('scrypt:')) {
    return false;
  }

  const parts = value.split(':');
  if (parts.length !== 3) {
    return false;
  }

  const expected = hashPassword(password, parts[1]);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(value));
}

async function supabaseRestRequest(method, resource, options) {
  const runtime = getSupabaseWebAuthConfig();
  if (!runtime.enabled) {
    throw new Error('Supabase web auth is not configured.');
  }

  const requestOptions = options && typeof options === 'object' ? options : {};
  const headers = {
    apikey: runtime.serviceRoleKey,
    Authorization: `Bearer ${runtime.serviceRoleKey}`,
    'Content-Type': 'application/json',
    ...(requestOptions.headers || {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(function () {
    controller.abort(new Error('Supabase request timeout'));
  }, Math.max(1000, SUPABASE_REQUEST_TIMEOUT_MS));

  let response;
  try {
    response = await fetch(`${runtime.url}/rest/v1/${resource}`, {
      method,
      headers,
      body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error && (error.name === 'AbortError' || /timeout/i.test(String(error.message || '')))) {
      throw new Error(`Supabase web auth request timed out after ${Math.max(1000, SUPABASE_REQUEST_TIMEOUT_MS)}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase web auth request failed. HTTP ${response.status}: ${text.slice(0, 180)}`);
  }
  return text ? JSON.parse(text) : [];
}

async function supabaseFetchAll(resource, pageSize) {
  const limit = Math.max(100, Number(pageSize || 1000));
  const rows = [];
  let offset = 0;

  while (true) {
    const separator = resource.includes('?') ? '&' : '?';
    const page = await supabaseRestRequest('GET', `${resource}${separator}limit=${limit}&offset=${offset}`);
    if (!Array.isArray(page) || !page.length) {
      break;
    }
    rows.push(...page);
    if (page.length < limit) {
      break;
    }
    offset += page.length;
  }

  return rows;
}
function mapSupabaseWebUser(record) {
  return normalizeWebUser({
    id: record.id,
    username: record.username,
    displayName: record.display_name,
    passwordHash: record.password_hash,
    role: record.role,
    isActive: record.is_active,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
}

async function listWebUsers() {
  if (getPostgresConfig().enabled) {
    try {
      const result = await postgresQuery(
        `select id, username, display_name, password_hash, role, is_active, created_at, updated_at
         from dashboard_web_users
         order by username asc`,
      );
      return result.rows.map(mapSupabaseWebUser).filter(Boolean);
    } catch (error) {
      return (config.webUsers || []).map(normalizeWebUser).filter(Boolean).sort(function (left, right) {
        return left.username.localeCompare(right.username);
      });
    }
  }

  if (!getSupabaseWebAuthConfig().enabled) {
    return (config.webUsers || []).map(normalizeWebUser).filter(Boolean).sort(function (left, right) {
      return left.username.localeCompare(right.username);
    });
  }

  try {
    const rows = await supabaseRestRequest('GET', 'dashboard_web_users?select=id,username,display_name,password_hash,role,is_active,created_at,updated_at&order=username.asc');
    return rows.map(mapSupabaseWebUser).filter(Boolean);
  } catch (error) {
    return (config.webUsers || []).map(normalizeWebUser).filter(Boolean).sort(function (left, right) {
      return left.username.localeCompare(right.username);
    });
  }
}

async function findWebUserById(userId) {
  const resolvedId = String(userId || '').trim();
  if (!resolvedId) {
    return null;
  }

  if (getPostgresConfig().enabled) {
    const result = await postgresQuery(
      `select id, username, display_name, password_hash, role, is_active, created_at, updated_at
       from dashboard_web_users
       where id = $1
       limit 1`,
      [resolvedId],
    );
    return result.rows.length ? mapSupabaseWebUser(result.rows[0]) : null;
  }

  if (!getSupabaseWebAuthConfig().enabled) {
    return (config.webUsers || []).map(normalizeWebUser).filter(Boolean).find(function (user) {
      return user.id === resolvedId;
    }) || null;
  }

  const rows = await supabaseRestRequest('GET', `dashboard_web_users?select=id,username,display_name,password_hash,role,is_active,created_at,updated_at&id=eq.${encodeURIComponent(resolvedId)}&limit=1`);
  return rows.length ? mapSupabaseWebUser(rows[0]) : null;
}

async function findWebUserByUsername(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (getPostgresConfig().enabled) {
    const result = await postgresQuery(
      `select id, username, display_name, password_hash, role, is_active, created_at, updated_at
       from dashboard_web_users
       where username = $1
       limit 1`,
      [normalized],
    );
    return result.rows.length ? mapSupabaseWebUser(result.rows[0]) : null;
  }

  if (!getSupabaseWebAuthConfig().enabled) {
    return (config.webUsers || []).map(normalizeWebUser).filter(Boolean).find(function (user) {
      return user.username === normalized;
    }) || null;
  }

  const rows = await supabaseRestRequest('GET', `dashboard_web_users?select=id,username,display_name,password_hash,role,is_active,created_at,updated_at&username=eq.${encodeURIComponent(normalized)}&limit=1`);
  return rows.length ? mapSupabaseWebUser(rows[0]) : null;
}

async function countOtherActiveAdmins(excludedUserId) {
  const users = await listWebUsers();
  return users.filter(function (user) {
    return user.id !== excludedUserId && user.role === 'admin' && user.isActive;
  }).length;
}

async function saveWebUser(input) {
  const source = input && typeof input === 'object' ? input : {};
  const now = new Date().toISOString();
  const username = String(source.username || '').trim().toLowerCase();
  const displayName = String(source.displayName || source.display_name || username).trim() || username;
  const role = String(source.role || 'admin').trim() || 'admin';
  const isActive = source.isActive === undefined ? true : Boolean(source.isActive);
  if (!username) {
    throw new Error('Username is required.');
  }

  const existing = source.id
    ? (await listWebUsers()).find(function (user) { return user.id === source.id; }) || null
    : await findWebUserByUsername(username);

  const passwordHash = source.password
    ? hashPassword(source.password)
    : (existing ? existing.passwordHash : '');
  if (!passwordHash) {
    throw new Error('Password is required for a new web user.');
  }

  if (existing && existing.role === 'admin' && existing.isActive && (role !== 'admin' || !isActive)) {
    const otherActiveAdmins = await countOtherActiveAdmins(existing.id);
    if (otherActiveAdmins === 0) {
      throw new Error('Tidak bisa menurunkan atau menonaktifkan admin terakhir.');
    }
  }

  const nextUser = normalizeWebUser({
    id: source.id || (existing && existing.id) || `${username}-${Date.now()}` ,
    username,
    displayName,
    passwordHash,
    role,
    isActive,
    createdAt: (existing && existing.createdAt) || now,
    updatedAt: now,
  });

  if (getPostgresConfig().enabled) {
    await postgresQuery(
      `insert into dashboard_web_users
        (id, username, display_name, password_hash, role, is_active, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update
       set username = excluded.username,
           display_name = excluded.display_name,
           password_hash = excluded.password_hash,
           role = excluded.role,
           is_active = excluded.is_active,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
      [
        nextUser.id,
        nextUser.username,
        nextUser.displayName,
        nextUser.passwordHash,
        nextUser.role,
        nextUser.isActive,
        nextUser.createdAt,
        nextUser.updatedAt,
      ],
    );
    return nextUser;
  }

  if (!getSupabaseWebAuthConfig().enabled) {
    const users = (config.webUsers || []).map(normalizeWebUser).filter(Boolean);
    const index = users.findIndex(function (user) {
      return user.id === nextUser.id || user.username === nextUser.username;
    });
    if (index >= 0) {
      users[index] = nextUser;
    } else {
      users.push(nextUser);
    }
    config.webUsers = users.sort(function (left, right) {
      return left.username.localeCompare(right.username);
    });
    config = normalizeConfig(config);
    saveConfig();
    return nextUser;
  }

  const rows = await supabaseRestRequest('POST', 'dashboard_web_users', {
    headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
    body: [{
      id: nextUser.id,
      username: nextUser.username,
      display_name: nextUser.displayName,
      password_hash: nextUser.passwordHash,
      role: nextUser.role,
      is_active: nextUser.isActive,
      created_at: nextUser.createdAt,
      updated_at: nextUser.updatedAt,
    }],
  });
  return rows.length ? mapSupabaseWebUser(rows[0]) : nextUser;
}

async function deleteWebUser(userId) {
  const resolvedId = String(userId || '').trim();
  if (!resolvedId) {
    throw new Error('User id is required.');
  }

  const existing = await findWebUserById(resolvedId);
  if (!existing) {
    return true;
  }
  if (existing.role === 'admin' && existing.isActive) {
    const otherActiveAdmins = await countOtherActiveAdmins(existing.id);
    if (otherActiveAdmins === 0) {
      throw new Error('Tidak bisa menghapus admin terakhir.');
    }
  }

  if (getPostgresConfig().enabled) {
    await postgresQuery('delete from dashboard_web_users where id = $1', [resolvedId]);
    return true;
  }

  if (!getSupabaseWebAuthConfig().enabled) {
    config.webUsers = (config.webUsers || []).map(normalizeWebUser).filter(Boolean).filter(function (user) {
      return user.id !== resolvedId;
    });
    config = normalizeConfig(config);
    saveConfig();
    return true;
  }

  await supabaseRestRequest('DELETE', `dashboard_web_users?id=eq.${encodeURIComponent(resolvedId)}`, {
    headers: { Prefer: 'return=minimal' },
  });
  return true;
}
function parseCookieHeader(cookieHeader) {
  const cookies = {};
  for (const part of String(cookieHeader || '').split(/;\s*/)) {
    if (!part || !part.includes('=')) {
      continue;
    }
    const separator = part.indexOf('=');
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) {
      cookies[key] = value;
    }
  }
  return cookies;
}

function getClientIp(req) {
  const forwardedFor = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const cfIp = String(req?.headers?.['cf-connecting-ip'] || '').trim();
  return cfIp || forwardedFor || String(req?.socket?.remoteAddress || '').trim() || 'unknown';
}

function buildLoginRateLimitKey(req, scope, identifier) {
  return [
    String(scope || 'login').trim().toLowerCase(),
    getClientIp(req),
    String(identifier || '').trim().toLowerCase() || 'anonymous',
  ].join(':');
}

function getWebSessionSecret() {
  return String(
    process.env.WEB_SESSION_SECRET
    || process.env.SESSION_SECRET
    || config?.webSessionSecret
    || ''
  ).trim();
}

function encodeBase64Url(value) {
  return Buffer.from(String(value || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function signWebSessionPayload(encodedPayload) {
  const secret = getWebSessionSecret();
  if (!secret) {
    throw new Error('Web session secret is not configured.');
  }
  return crypto.createHmac('sha256', secret).update(String(encodedPayload || '')).digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildWebSessionToken(user) {
  const now = Date.now();
  const payload = {
    sub: user.id,
    usr: user.username,
    role: user.role,
    iat: now,
    exp: now + (WEB_SESSION_MAX_AGE_SECONDS * 1000),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  return encodedPayload + '.' + signWebSessionPayload(encodedPayload);
}

function parseVerifiedWebSessionToken(token) {
  const value = String(token || '').trim();
  if (!value || !value.includes('.')) {
    return null;
  }
  const parts = value.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const expectedSignature = signWebSessionPayload(parts[0]);
  const actualBuffer = Buffer.from(parts[1]);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[0]));
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const expiresAt = Number(payload.exp || 0);
    if (!expiresAt || Date.now() >= expiresAt) {
      return null;
    }
    return payload;
  } catch (error) {
    return null;
  }
}

function loadLocalLoginRateLimits() {
  const source = loadJsonFile(LOGIN_RATE_LIMITS_FILE, {});
  return source && typeof source === 'object' ? source : {};
}

function saveLocalLoginRateLimits(entries) {
  saveJsonFile(LOGIN_RATE_LIMITS_FILE, entries && typeof entries === 'object' ? entries : {});
}

function pruneExpiredLoginRateLimits(entries, now) {
  const nextEntries = {};
  for (const [entryKey, entryValue] of Object.entries(entries || {})) {
    if (!entryValue || typeof entryValue !== 'object') {
      continue;
    }
    const resetAt = Number(entryValue.resetAt || 0);
    if (resetAt > now) {
      nextEntries[entryKey] = {
        count: Math.max(0, Number(entryValue.count || 0)),
        resetAt,
      };
    }
  }
  return nextEntries;
}

async function consumeLoginRateLimit(key, limit, windowMs, metadata) {
  const now = Date.now();
  const resolvedLimit = Math.max(1, Number(limit || 1));
  const resolvedWindowMs = Math.max(1000, Number(windowMs || LOGIN_RATE_LIMIT_WINDOW_MS));
  const details = metadata && typeof metadata === 'object' ? metadata : {};
  const retryAfterSeconds = Math.ceil(resolvedWindowMs / 1000);

  if (getPostgresConfig().enabled) {
    await ensurePostgresSchema();
    const existing = await postgresQuery(
      'select count, extract(epoch from reset_at) * 1000 as reset_at_ms from login_rate_limits where key = $1 limit 1',
      [key],
    );
    const row = existing.rows[0] || null;
    const resetAtMs = row ? Number(row.reset_at_ms || 0) : 0;
    if (!row || now >= resetAtMs) {
      await postgresQuery(
        `insert into login_rate_limits (key, scope, ip_address, identifier, count, reset_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, now(), now())
         on conflict (key) do update
         set scope = excluded.scope,
             ip_address = excluded.ip_address,
             identifier = excluded.identifier,
             count = excluded.count,
             reset_at = excluded.reset_at,
             updated_at = now()`,
        [key, details.scope || 'login', details.ipAddress || null, details.identifier || null, 1, new Date(now + resolvedWindowMs).toISOString()],
      );
      return { allowed: true, remaining: Math.max(0, resolvedLimit - 1), retryAfterSeconds };
    }

    const nextCount = Math.max(0, Number(row.count || 0)) + 1;
    await postgresQuery('update login_rate_limits set count = $2, updated_at = now() where key = $1', [key, nextCount]);
    if (nextCount > resolvedLimit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, resolvedLimit - nextCount),
      retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
    };
  }

  const entries = pruneExpiredLoginRateLimits(loadLocalLoginRateLimits(), now);
  const current = entries[key];
  if (!current) {
    entries[key] = { count: 1, resetAt: now + resolvedWindowMs };
    saveLocalLoginRateLimits(entries);
    return { allowed: true, remaining: Math.max(0, resolvedLimit - 1), retryAfterSeconds };
  }

  current.count = Math.max(0, Number(current.count || 0)) + 1;
  entries[key] = current;
  saveLocalLoginRateLimits(entries);
  if (current.count > resolvedLimit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, resolvedLimit - current.count),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

async function clearLoginRateLimit(key) {
  if (!key) {
    return;
  }

  if (getPostgresConfig().enabled) {
    await ensurePostgresSchema();
    await postgresQuery('delete from login_rate_limits where key = $1', [key]);
    return;
  }

  const entries = pruneExpiredLoginRateLimits(loadLocalLoginRateLimits(), Date.now());
  if (entries[key]) {
    delete entries[key];
    saveLocalLoginRateLimits(entries);
  }
}

function shouldUseSecureCookies(req) {
  const explicit = String(process.env.COOKIE_SECURE || '').trim().toLowerCase();
  if (explicit === 'false' || explicit === '0' || explicit === 'no') {
    return false;
  }
  if (explicit === 'true' || explicit === '1' || explicit === 'yes') {
    return true;
  }

  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').trim().toLowerCase();
  const cfVisitor = String(req?.headers?.['cf-visitor'] || '').trim().toLowerCase();
  return forwardedProto === 'https'
    || cfVisitor.includes('"scheme":"https"')
    || Boolean(req?.socket?.encrypted)
    || String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function isLocalHostValue(hostValue) {
  const normalized = String(hostValue || '').trim().toLowerCase().split(':')[0];
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function matchesRequestHost(req, candidateUrl) {
  const expectedHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').trim().toLowerCase();
  if (!expectedHost) {
    return false;
  }
  try {
    const parsed = new URL(candidateUrl);
    const candidateHost = String(parsed.host || '').trim().toLowerCase();
    if (candidateHost === expectedHost) {
      return true;
    }
    if (isLocalHostValue(expectedHost) && isLocalHostValue(candidateHost)) {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function isTrustedApiMutationRequest(req) {
  const origin = String(req?.headers?.origin || '').trim();
  const referer = String(req?.headers?.referer || '').trim();
  const secFetchSite = String(req?.headers?.['sec-fetch-site'] || '').trim().toLowerCase();
  const requestHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').trim();

  if (origin) {
    return matchesRequestHost(req, origin);
  }
  if (referer) {
    return matchesRequestHost(req, referer);
  }
  if (secFetchSite) {
    return secFetchSite === 'same-origin' || secFetchSite === 'none';
  }
  return isLocalHostValue(requestHost);
}

function requireTrustedApiMutation(req, res) {
  if (isTrustedApiMutationRequest(req)) {
    return true;
  }
  sendJson(res, 403, {
    ok: false,
    error: 'Cross-site request rejected.',
  });
  return false;
}

async function getWebSession(req) {
  const cookies = parseCookieHeader((req && req.headers && req.headers.cookie) || '');
  const token = cookies[WEB_AUTH_COOKIE_NAME];
  const payload = parseVerifiedWebSessionToken(token);
  if (!payload || !payload.sub) {
    return null;
  }

  const user = await findWebUserById(payload.sub);
  if (!user || !user.isActive) {
    return null;
  }

  return {
    token,
    createdAt: Number(payload.iat || Date.now()),
    expiresAt: Number(payload.exp || 0),
    user: sanitizeWebUserForClient(user),
  };
}

function createWebSessionCookie(req, user) {
  const token = buildWebSessionToken(user);
  const attributes = [
    WEB_AUTH_COOKIE_NAME + '=' + token,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=' + WEB_SESSION_MAX_AGE_SECONDS,
  ];
  if (shouldUseSecureCookies(req)) {
    attributes.push('Secure');
  }
  return attributes.join('; ');
}

function destroyWebSession(_req) {
}

function expiredWebSessionCookie(req) {
  const attributes = [
    WEB_AUTH_COOKIE_NAME + '=',
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (shouldUseSecureCookies(req)) {
    attributes.push('Secure');
  }
  return attributes.join('; ');
}

function buildPublicStatusPayload() {
  return {
    now: Date.now(),
    runtime: {
      isPolling: false,
      lastRunStartedAt: null,
      lastRunFinishedAt: null,
      lastRunDurationMs: null,
      lastRunMessage: 'Login required',
      nextRunAt: null,
      lastSnapshotAt: null,
      lastSnapshotError: null,
      pollInFlight: false,
      unitCount: 0,
      liveAlertCount: 0,
      accountCount: 0,
    },
    accounts: [],
    overview: {
      totalUnits: 0,
      onlineUnits: 0,
      liveAlerts: 0,
      criticalAlerts: 0,
    },
    autoFilterCards: [],
    fleet: {
      fetchedAt: null,
      lastError: null,
      rows: [],
    },
    liveAlerts: [],
    podSnapshots: [],
    units: [],
    webAuth: buildWebAuthConfigForClient(null),
  };
}

async function requireWebSession(req, res) {
  const session = await getWebSession(req);
  if (!session) {
    sendJson(res, 401, {
      ok: false,
      error: 'Login dashboard required.',
      webAuth: buildWebAuthConfigForClient(null),
    });
    return null;
  }
  return session;
}

async function requireAdminSession(req, res) {
  const session = await requireWebSession(req, res);
  if (!session) {
    return null;
  }
  if (session.user.role !== 'admin') {
    sendJson(res, 403, {
      ok: false,
      error: 'Admin access required.',
      webAuth: buildWebAuthConfigForClient(session.user),
    });
    return null;
  }
  return session;
}
function serializeAccountStateForDisk(accountState) {
  const fleetVehicles = {};
  const units = {};
  const dailySnapshots = Array.isArray(accountState.dailySnapshots) ? accountState.dailySnapshots.filter(function (item) { return item && typeof item === 'object'; }) : [];
  const podSnapshots = Array.isArray(accountState.podSnapshots) ? accountState.podSnapshots.filter(function (item) { return item && typeof item === 'object'; }) : [];

  for (const [unitKey, vehicle] of Object.entries(accountState.fleet.vehicles || {})) {
    fleetVehicles[unitKey] = vehicle;
  }

  for (const [unitId, unitState] of Object.entries(accountState.units)) {
    units[unitId] = {
      unitId,
      label: unitState.label,
      vehicle: unitState.vehicle,
      lastFetchStartedAt: unitState.lastFetchStartedAt,
      lastFetchCompletedAt: unitState.lastFetchCompletedAt,
      lastSuccessAt: unitState.lastSuccessAt,
      lastError: unitState.lastError,
      records: unitState.records,
    };
  }

  return {
    runtime: accountState.runtime,
    fleet: {
      fetchedAt: accountState.fleet.fetchedAt,
      lastError: accountState.fleet.lastError,
      vehicles: fleetVehicles,
    },
    units,
    dailySnapshots,
    podSnapshots,
  };
}

function serializeStateForDisk() {
  const payload = serializeAccountStateForDisk(state);
  const linkedAccounts = {};
  for (const [accountId, accountState] of Object.entries(state.linkedAccounts || {})) {
    linkedAccounts[accountId] = serializeAccountStateForDisk(accountState);
  }
  payload.linkedAccounts = linkedAccounts;
  return payload;
}

async function saveState() {
  saveStatePending = true;
  if (saveStateInFlight) {
    return saveStateInFlight;
  }
  saveStateInFlight = (async function flushStateSaveQueue() {
    while (saveStatePending) {
      saveStatePending = false;
      const payload = serializeStateForDisk();
      if (getPostgresConfig().enabled) {
        try {
          await postgresUpsertJsonSetting('app_state', 'state_data', payload);
          continue;
        } catch (error) {
          console.error('Failed to save state to PostgreSQL:', error.message);
        }
      }
      if (!getSupabaseWebAuthConfig().enabled) {
        saveJsonFile(STATE_FILE, payload);
        continue;
      }
      try {
        await supabaseRestRequest('POST', 'app_state', {
          headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
          body: [{ id: 'default', state_data: payload, updated_at: new Date().toISOString() }],
        });
      } catch (error) {
        console.error('Failed to save state to Supabase:', error.message);
        saveJsonFile(STATE_FILE, payload);
      }
    }
  })().finally(function () {
    saveStateInFlight = null;
  });
  return saveStateInFlight;
}

function buildPrimaryAccountConfig() {
  return {
    id: 'primary',
    label: String(config.authEmail || 'Primary account'),
    authEmail: config.authEmail,
    sessionCookie: config.sessionCookie,
    vehicleRoleId: config.vehicleRoleId,
    units: config.units,
    customerProfiles: config.customerProfiles,
    podSites: config.podSites,
  };
}

function getAllAccountConfigs() {
  return [buildPrimaryAccountConfig(), ...(config.linkedAccounts || [])];
}

function getAccountConfigById(accountId) {
  if (!accountId || accountId === 'primary') {
    return buildPrimaryAccountConfig();
  }
  return (config.linkedAccounts || []).find(function (account) {
    return account.id === accountId;
  }) || null;
}

function ensureAccountState(accountId) {
  if (!accountId || accountId === 'primary') {
    return state;
  }
  if (!state.linkedAccounts[accountId]) {
    state.linkedAccounts[accountId] = createEmptyAccountState();
  }
  return state.linkedAccounts[accountId];
}

function toSolofleetLocalDate(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return new Date(numeric + (SOLOFLEET_UTC_OFFSET_MINUTES * 60 * 1000));
}

function formatLocalDay(timestamp) {
  const date = toSolofleetLocalDate(timestamp);
  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalTime(timestamp) {
  const date = toSolofleetLocalDate(timestamp);
  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }
  return [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()].map(function (value) {
    return String(value).padStart(2, '0');
  }).join(':');
}

function findRecordForIncident(unitState, incident) {
  const records = unitState.records || [];
  for (const record of records) {
    if (record.timestamp >= incident.startTimestamp) {
      return record;
    }
  }
  return records.length ? records[records.length - 1] : null;
}

function captureDailyErrorSnapshots(accountConfig, accountState) {
  const existingKeys = new Set((accountState.dailySnapshots || []).map(function (snapshot) {
    return snapshot.id;
  }));

  const pushSnapshot = function (unitId, unitLabel, vehicle, incident, record, snapshot) {
    const day = formatLocalDay(incident.startTimestamp);
    const key = day + '|' + accountConfig.id + '|' + unitId + '|' + incident.type + '|' + incident.startTimestamp;
    if (existingKeys.has(key)) {
      return;
    }

    accountState.dailySnapshots.push({
      id: key,
      accountId: accountConfig.id,
      accountLabel: accountConfig.label,
      day,
      errorTimestamp: incident.startTimestamp,
      errorTime: formatLocalTime(incident.startTimestamp),
      startTimestamp: incident.startTimestamp,
      endTimestamp: incident.endTimestamp,
      unitId,
      unitLabel,
      vehicle,
      type: incident.type,
      label: incident.label,
      durationMinutes: incident.durationMinutes,
      temp1: record ? record.temp1 : incident.temp1 ?? null,
      temp2: record ? record.temp2 : incident.temp2 ?? null,
      speed: record ? record.speed : incident.speed ?? null,
      latitude: snapshot?.latitude ?? incident.latitude ?? null,
      longitude: snapshot?.longitude ?? incident.longitude ?? null,
      locationSummary: snapshot?.locationSummary || incident.locationSummary || '',
      zoneName: snapshot?.zoneName || incident.zoneName || '',
    });
    existingKeys.add(key);
  };

  for (const [unitId, unitState] of Object.entries(accountState.units)) {
    const analysis = unitState.analysis || buildAnalysisFromRecords(unitState);
    for (const incident of analysis.incidents) {
      const record = findRecordForIncident(unitState, incident);
      const snapshot = accountState.fleet.vehicles[normalizeUnitKey(unitId)] || null;
      pushSnapshot(unitId, unitState.label, unitState.vehicle || unitState.label || unitId, incident, record, snapshot);
    }
  }

  for (const incident of buildCurrentFleetSensorAlerts(accountConfig, accountState, Date.now())) {
    const snapshot = accountState.fleet.vehicles[normalizeUnitKey(incident.unitId)] || null;
    pushSnapshot(incident.unitId, incident.unitLabel, incident.vehicle, incident, null, snapshot);
  }

  accountState.dailySnapshots.sort(function (left, right) {
    return (right.errorTimestamp || 0) - (left.errorTimestamp || 0);
  });
}

function buildDailySnapshotRows(accountState, rangeStartMs, rangeEndMs) {
  return (accountState.dailySnapshots || []).filter(function (snapshot) {
    if (rangeStartMs !== null && snapshot.errorTimestamp < rangeStartMs) {
      return false;
    }
    if (rangeEndMs !== null && snapshot.errorTimestamp > rangeEndMs) {
      return false;
    }
    return true;
  });
}

function syncFleetSnapshotRecords(accountConfig, accountState, now) {
  const resolvedNow = Number.isFinite(now) ? now : Date.now();

  for (const unit of accountConfig.units || []) {
    const snapshot = accountState.fleet.vehicles[normalizeUnitKey(unit.id)] || null;
    if (!snapshot) {
      continue;
    }

    const timestamp = snapshot.lastUpdatedMs ?? resolvedNow;
    if (!Number.isFinite(timestamp)) {
      continue;
    }

    const unitState = accountState.units[unit.id] || normalizeUnitState(unit.id, { label: unit.label, vehicle: unit.label });
    accountState.units[unit.id] = unitState;
    unitState.label = unit.label;
    unitState.vehicle = snapshot.alias || snapshot.unitId || unitState.vehicle || unit.label || unit.id;
    unitState.records = mergeRecords(unitState.records, [{
      timestamp,
      vehicle: snapshot.unitId || unitState.vehicle || unit.label || unit.id,
      speed: snapshot.speed,
      temp1: snapshot.temp1,
      temp2: snapshot.temp2,
      latitude: snapshot.latitude ?? null,
      longitude: snapshot.longitude ?? null,
      locationSummary: snapshot.locationSummary || '',
      zoneName: snapshot.zoneName || '',
      powerSupply: snapshot.powerSupply ?? null,
      errSensor: snapshot.errSensor || '',
    }], resolvedNow);
    unitState.analysis = buildAnalysisFromRecords(unitState);
  }
}

function buildCachedUnitHistory(accountState, unitId, rangeStartMs, rangeEndMs) {
  const unitState = accountState.units[unitId] || null;
  if (!unitState) {
    return [];
  }

  return (unitState.records || []).filter(function (record) {
    if (rangeStartMs !== null && record.timestamp < rangeStartMs) {
      return false;
    }
    if (rangeEndMs !== null && record.timestamp > rangeEndMs) {
      return false;
    }
    return true;
  });
}

function mergeHistoryRecords(primaryRecords, fallbackRecords) {
  const merged = new Map();

  for (const record of fallbackRecords || []) {
    merged.set(record.timestamp, record);
  }

  for (const record of primaryRecords || []) {
    const existing = merged.get(record.timestamp) || {};
    merged.set(record.timestamp, {
      ...existing,
      ...record,
      vehicle: record.vehicle || existing.vehicle || 'Unknown Unit',
      speed: record.speed ?? existing.speed ?? null,
      temp1: record.temp1 ?? existing.temp1 ?? null,
      temp2: record.temp2 ?? existing.temp2 ?? null,
      errSensor: record.errSensor ?? existing.errSensor ?? '',
    });
  }

  return [...merged.values()].sort(function (left, right) {
    return left.timestamp - right.timestamp;
  });
}

function buildCurrentFleetSensorAlerts(accountConfig, accountState, now) {
  const alerts = [];
  const estimatedDurationMs = Math.max(
    Number(config.minDurationMinutes || 5) * 60 * 1000,
    Number(config.requestIntervalSeconds || 60) * 1000,
  );

  for (const unit of accountConfig.units || []) {
    const snapshot = accountState.fleet.vehicles[normalizeUnitKey(unit.id)] || null;
    if (!snapshot) {
      continue;
    }

    const unitState = accountState.units[unit.id] || normalizeUnitState(unit.id, { label: unit.label });
    const type = detectLiveSensorFaultType(unitState, snapshot, now, {
      requiredDurationMinutes: 30,
      minimumSamples: 2,
    });
    if (!type) {
      continue;
    }

    const endTimestamp = snapshot.lastUpdatedMs ?? now;
    const startTimestamp = endTimestamp - estimatedDurationMs;
    alerts.push({
      id: 'live|' + accountConfig.id + '|' + unit.id + '|' + type + '|' + endTimestamp,
      vehicle: snapshot.unitId || unit.label || unit.id,
      type,
      label: sensorFaultLabel(type),
      severity: type === 'temp1+temp2' ? 'critical' : 'warning',
      startTimestamp,
      endTimestamp,
      durationMs: estimatedDurationMs,
      durationMinutes: Number((estimatedDurationMs / 60000).toFixed(2)),
      sampleCount: 1,
      movingSamples: (snapshot.speed ?? 0) > 0 ? 1 : 0,
      minSpeed: snapshot.speed ?? null,
      maxSpeed: snapshot.speed ?? null,
      temp1Min: snapshot.temp1 ?? null,
      temp1Max: snapshot.temp1 ?? null,
      temp2Min: snapshot.temp2 ?? null,
      temp2Max: snapshot.temp2 ?? null,
      gapMinutes: Number((estimatedDurationMs / 60000).toFixed(2)),
      accountId: accountConfig.id,
      accountLabel: accountConfig.label,
      unitId: unit.id,
      unitLabel: unit.label,
      rowKey: accountConfig.id + '::' + unit.id,
      isCurrent: true,
      latitude: snapshot.latitude ?? null,
      longitude: snapshot.longitude ?? null,
      locationSummary: snapshot.locationSummary || '',
      zoneName: snapshot.zoneName || '',
      speed: snapshot.speed ?? null,
      temp1: snapshot.temp1 ?? null,
      temp2: snapshot.temp2 ?? null,
    });
  }

  return alerts;
}

function annotateFleetRowsWithPods(accountConfig, fleetRows) {
  const rows = Array.isArray(fleetRows) ? fleetRows : [];
  for (const row of rows) {
    row.matchedPodSite = findMatchingPodSite(accountConfig, row);
  }
  return rows;
}

function capturePodSnapshots(accountConfig, accountState, fleetRows) {
  const rows = annotateFleetRowsWithPods(accountConfig, fleetRows);
  const existingKeys = new Set((accountState.podSnapshots || []).map(function (snapshot) {
    return snapshot.id;
  }));

  for (const row of rows) {
    const matchedPodSite = row.matchedPodSite;
    if (!matchedPodSite) {
      continue;
    }

    const lastUpdatedMs = toTimestampMaybe(row.lastUpdatedAt) || Date.now();
    const day = formatLocalDay(lastUpdatedMs);
    const id = `${day}|${row.id}|${matchedPodSite.id}`;
    if (existingKeys.has(id)) {
      continue;
    }

    accountState.podSnapshots.push({
      id,
      accountId: accountConfig.id,
      accountLabel: accountConfig.label,
      day,
      timestamp: lastUpdatedMs,
      time: formatLocalTime(lastUpdatedMs),
      unitId: row.id,
      unitLabel: row.label,
      customerName: row.customerName || matchedPodSite.customerId || '',
      podId: matchedPodSite.id,
      podName: matchedPodSite.name,
      latitude: row.latitude,
      longitude: row.longitude,
      speed: row.speed,
      distanceMeters: Number(matchedPodSite.distanceMeters.toFixed(1)),
      locationSummary: row.locationSummary || '',
    });
    existingKeys.add(id);
  }

  accountState.podSnapshots.sort(function (left, right) {
    return (right.timestamp || 0) - (left.timestamp || 0);
  });
}

function buildPodSnapshotRows(accountState, rangeStartMs, rangeEndMs) {
  return (accountState.podSnapshots || []).filter(function (snapshot) {
    if (rangeStartMs !== null && snapshot.timestamp < rangeStartMs) {
      return false;
    }
    if (rangeEndMs !== null && snapshot.timestamp > rangeEndMs) {
      return false;
    }
    return true;
  });
}

function buildAnalysisFromRecords(unitState) {
  if (!unitState.records.length) {
    return {
      vehicle: unitState.vehicle || unitState.label || unitState.unitId,
      alias: unitState.label || unitState.vehicle || unitState.unitId,
      recordsCount: 0,
      gapMs: (config.maxGapMinutes || config.requestIntervalSeconds / 60 || 5) * 60 * 1000,
      sourceStart: null,
      sourceEnd: null,
      incidents: [],
      fields: {
        time: 'timestamp',
        vehicle: 'vehicle',
        speed: 'speed',
        temp1: 'temp1',
        temp2: 'temp2',
      },
    };
  }

  const payload = unitState.records.map(function (record) {
    return {
      timestamp: new Date(record.timestamp).toISOString(),
      vehicle: record.vehicle || unitState.vehicle || unitState.label || unitState.unitId,
      speed: record.speed,
      temp1: record.temp1,
      temp2: record.temp2,
    };
  });

  try {
    const analyzed = core.analyzePayload(payload, {
      minDurationMinutes: config.minDurationMinutes,
      maxGapMinutes: config.maxGapMinutes,
    });
    analyzed.vehicle = unitState.vehicle || analyzed.vehicle;
    analyzed.alias = unitState.label || analyzed.alias;
    return analyzed;
  } catch (error) {
    return {
      vehicle: unitState.vehicle || unitState.label || unitState.unitId,
      alias: unitState.label || unitState.vehicle || unitState.unitId,
      recordsCount: unitState.records.length,
      gapMs: (config.maxGapMinutes || config.requestIntervalSeconds / 60 || 5) * 60 * 1000,
      sourceStart: unitState.records[0].timestamp,
      sourceEnd: unitState.records[unitState.records.length - 1].timestamp,
      incidents: [],
      fields: {
        time: 'timestamp',
        vehicle: 'vehicle',
        speed: 'speed',
        temp1: 'temp1',
        temp2: 'temp2',
      },
      error: error.message,
    };
  }
}

function syncUnitsWithConfig() {
  const validAccountIds = new Set(getAllAccountConfigs().map(function (account) { return account.id; }));
  for (const accountId of Object.keys(state.linkedAccounts || {})) {
    if (!validAccountIds.has(accountId)) {
      delete state.linkedAccounts[accountId];
    }
  }

  for (const accountConfig of getAllAccountConfigs()) {
    const accountState = ensureAccountState(accountConfig.id);
    const nextUnits = {};

    for (const unit of accountConfig.units) {
      const existing = accountState.units[unit.id] || normalizeUnitState(unit.id, { label: unit.label, vehicle: unit.label });
      existing.label = unit.label;
      existing.unitId = unit.id;
      if (!existing.vehicle || existing.vehicle === existing.unitId) {
        existing.vehicle = unit.label;
      }
      nextUnits[unit.id] = existing;
    }

    accountState.units = nextUnits;
  }
}

function recomputeAllAnalyses() {
  for (const accountConfig of getAllAccountConfigs()) {
    const accountState = ensureAccountState(accountConfig.id);
    for (const unitState of Object.values(accountState.units)) {
      unitState.analysis = buildAnalysisFromRecords(unitState);
    }
  }
}

let isStorageInitialized = false;

async function initializeStorage() {
  if (isStorageInitialized) return;
  ensureDataFiles();
  let rawConfig = loadJsonFile(CONFIG_FILE, DEFAULT_CONFIG);
  let rawState = loadJsonFile(STATE_FILE, DEFAULT_STATE);
  let postgresHasConfig = false;
  let postgresHasState = false;
  let supabaseHasConfig = false;
  let supabaseHasState = false;

  if (getPostgresConfig().enabled) {
    try {
      await ensurePostgresSchema();
      const postgresConfig = await postgresLoadJsonSetting('app_settings', 'config_data');
      if (postgresConfig) {
        rawConfig = postgresConfig;
        postgresHasConfig = true;
      }
      const postgresState = await postgresLoadJsonSetting('app_state', 'state_data');
      if (postgresState) {
        rawState = postgresState;
        postgresHasState = true;
      }
    } catch (error) {
      console.error('Failed to load storage from PostgreSQL:', error.message);
    }
  }

  if ((!postgresHasConfig || !postgresHasState) && getSupabaseWebAuthConfig().enabled) {
    try {
      if (!postgresHasConfig) {
        const configRows = await supabaseRestRequest('GET', `app_settings?id=eq.default&limit=1`);
        if (configRows && configRows.length > 0 && configRows[0].config_data) {
          rawConfig = configRows[0].config_data;
          supabaseHasConfig = true;
        }
      }
      if (!postgresHasState) {
        const stateRows = await supabaseRestRequest('GET', `app_state?id=eq.default&limit=1`);
        if (stateRows && stateRows.length > 0 && stateRows[0].state_data) {
          rawState = stateRows[0].state_data;
          supabaseHasState = true;
        }
      }
    } catch (e) {
      console.error('Failed to load storage from Supabase:', e.message);
    }
  }

  config = normalizeConfig(rawConfig);
  let configChanged = false;
  if (!getWebSessionSecret()) {
    config = normalizeConfig({
      ...config,
      webSessionSecret: crypto.randomBytes(32).toString('hex'),
    });
    configChanged = true;
  }
  state = normalizeState(rawState);
  syncUnitsWithConfig();
  recomputeAllAnalyses();
  const astroRouteRepair = sanitizeAstroRoutesForStartup(config.astroRoutes || [], config.astroLocations || []);
  const repairedAstroRoutes = astroRouteRepair.routes;
  const astroRoutesChanged = JSON.stringify(repairedAstroRoutes) !== JSON.stringify(config.astroRoutes || []);
  if (astroRouteRepair.dropped.length) {
    astroRouteRepair.dropped.forEach(function (entry) {
      console.error(`Dropping invalid Astro route during startup: ${entry.accountId || 'unknown-account'} | ${entry.unitId || entry.routeId || 'unknown-route'} | ${entry.reason}`);
    });
  }
  if (astroRoutesChanged) {
    config = normalizeConfig({
      ...config,
      astroRoutes: repairedAstroRoutes,
    });
  }

  state.runtime.isPolling = false;
  state.runtime.nextRunAt = null;
  isStorageInitialized = true;

  if (getPostgresConfig().enabled) {
    await migrateSupabaseDataToPostgres();
  }
  
  const migrationTasks = [];
  if (astroRoutesChanged || configChanged) {
    migrationTasks.push(saveConfig());
  }
  for (const accountConfig of getAllAccountConfigs()) {
    const accountState = ensureAccountState(accountConfig.id);
    captureDailyErrorSnapshots(accountConfig, accountState);
    capturePodSnapshots(accountConfig, accountState, buildFleetRows(accountConfig, accountState, Date.now(), buildLiveAlerts(accountConfig, accountState, Date.now())));
    
    if (getPostgresConfig().enabled || getSupabaseWebAuthConfig().enabled) {
      if (accountState.dailySnapshots && accountState.dailySnapshots.length > 0) {
        migrationTasks.push(upsertDailyTempSnapshotsToSupabase(accountConfig, accountState));
      }
      if (accountState.podSnapshots && accountState.podSnapshots.length > 0) {
        migrationTasks.push(upsertPodSnapshotsToSupabase(accountConfig, accountState));
      }
    }
  }
  
  try {
    if (getPostgresConfig().enabled) {
      const postgresUsers = await postgresQuery('select count(*)::int as count from dashboard_web_users');
      if (!postgresUsers.rows[0] || !postgresUsers.rows[0].count) {
        migrationTasks.push(migrateWebUsersToPostgres(config.webUsers || []));
      }
      if (!postgresHasConfig) {
        console.log('Migrating config to PostgreSQL...');
        migrationTasks.push(saveConfig());
      }
      if (!postgresHasState) {
        console.log('Migrating state to PostgreSQL...');
        migrationTasks.push(saveState());
      }

      if (migrationTasks.length > 0) {
        await Promise.allSettled(migrationTasks);
        console.log('Completed auto-migration of local/Supabase data to PostgreSQL.');
      } else {
        await saveState();
      }
    } else if (getSupabaseWebAuthConfig().enabled) {
      if (!supabaseHasConfig) {
        console.log('Migrating local config to Supabase...');
        migrationTasks.push(saveConfig());
      }
      if (!supabaseHasState) {
        console.log('Migrating local state to Supabase...');
        migrationTasks.push(saveState());
      }
      
      if (migrationTasks.length > 0) {
        await Promise.allSettled(migrationTasks);
        console.log('Completed auto-migration of local data to Supabase.');
      } else {
        await saveState(); 
      }
    } else {
      saveState();
    }
  } catch (error) {
    console.error('Background storage migration failed:', error.message);
  }
}

const storageInitializationPromise = initializeStorage();

async function waitForStorageInitialization(timeoutMs) {
  if (isStorageInitialized) {
    return true;
  }
  try {
    const completed = await Promise.race([
      storageInitializationPromise.then(function () { return true; }).catch(function () { return false; }),
      new Promise(function (resolve) {
        setTimeout(function () { resolve(false); }, Math.max(0, Number(timeoutMs) || 0));
      }),
    ]);
    return Boolean(completed) && isStorageInitialized;
  } catch (error) {
    console.error('Storage initialization wait failed:', error.message);
    return false;
  }
}

const RESPONSE_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-DNS-Prefetch-Control': 'off',
  'Origin-Agent-Cluster': '?1',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://static.cloudflareinsights.com https://cloudflareinsights.com",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join('; '),
};

const STATIC_IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const STATIC_DEFAULT_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=3600';
const STATIC_ENTRY_CACHE_CONTROL = 'no-cache';

function isCompressibleContentType(contentType) {
  const normalized = String(contentType || '').toLowerCase();
  return normalized.startsWith('text/')
    || normalized.includes('javascript')
    || normalized.includes('json')
    || normalized.includes('svg')
    || normalized.includes('manifest');
}

function buildStaticCacheControl(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  if (normalized.endsWith('/index.html') || normalized.endsWith('/sw.js') || normalized.endsWith('/manifest.webmanifest')) {
    return STATIC_ENTRY_CACHE_CONTROL;
  }
  if (normalized.includes('/assets/')) {
    return STATIC_IMMUTABLE_CACHE_CONTROL;
  }
  return STATIC_DEFAULT_CACHE_CONTROL;
}

function buildWeakEtag(stats) {
  return `W/"${Number(stats.size || 0).toString(16)}-${Math.trunc(Number(stats.mtimeMs || 0)).toString(16)}"`;
}

function compressStaticContent(req, content, contentType) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''));
  if (!isCompressibleContentType(contentType) || buffer.length < 1024) {
    return { content: buffer, encoding: '' };
  }
  const acceptEncoding = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (acceptEncoding.includes('br')) {
    return {
      content: zlib.brotliCompressSync(buffer, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
        },
      }),
      encoding: 'br',
    };
  }
  if (acceptEncoding.includes('gzip')) {
    return {
      content: zlib.gzipSync(buffer, { level: 6 }),
      encoding: 'gzip',
    };
  }
  return { content: buffer, encoding: '' };
}

function send(res, statusCode, content, contentType, extraHeaders) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, private',
    ...RESPONSE_SECURITY_HEADERS,
    ...(extraHeaders || {}),
  });
  res.end(content);
}

function sendJson(res, statusCode, payload, extraHeaders) {
  res.__apiErrorMessage = payload && payload.error ? String(payload.error) : '';
  send(res, statusCode, JSON.stringify(payload, null, 2), 'application/json; charset=utf-8', extraHeaders);
}

function isSafePublicErrorMessage(message) {
  const value = String(message || '').trim();
  if (!value || value.length > 220 || /[<>]/.test(value)) {
    return false;
  }
  return !/(<!doctype|<html|cloudflare|upstream request timeout|object reference not set|supabase|typeerror|referenceerror|syntaxerror|rangeerror|fetch failed|econn|enotfound|etimedout|session cookie is empty|returned html instead of json|http 5\d{2})/i.test(value);
}

function getPublicErrorMessage(error, fallbackMessage) {
  const fallback = String(fallbackMessage || 'Aksi gagal diproses.').trim() || 'Aksi gagal diproses.';
  const candidate = String(error?.publicMessage || error?.message || '').trim();
  return isSafePublicErrorMessage(candidate) ? candidate : fallback;
}

function getPublicErrorStatus(error, fallbackStatusCode) {
  const explicitStatus = Number(error?.statusCode);
  if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus < 600) {
    return explicitStatus;
  }
  if (isSafePublicErrorMessage(error?.publicMessage || error?.message)) {
    return fallbackStatusCode >= 500 ? 400 : fallbackStatusCode;
  }
  return fallbackStatusCode;
}

function sendApiError(res, error, fallbackMessage, fallbackStatusCode = 500) {
  sendJson(res, getPublicErrorStatus(error, fallbackStatusCode), {
    ok: false,
    error: getPublicErrorMessage(error, fallbackMessage),
  });
}

function safePathFromUrl(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0]);
  const relativePath = cleanPath === '/' ? '/index.html' : cleanPath;
  const normalized = path.normalize(relativePath).replace(/^(\.\.[\\/])+/, '');
  return path.join(WEB_ROOT, normalized);
}

function readRequestBody(req) {
  return new Promise(function (resolve, reject) {
    let body = '';

    req.on('data', function (chunk) {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });

    req.on('end', function () {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', reject);
  });
}

function maskCookie(cookie) {
  const trimmed = String(cookie || '').trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= 16) {
    return `${trimmed.slice(0, 4)}...${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 10)}...${trimmed.slice(-8)}`;
}

function findCustomerProfileForUnit(accountConfig, unitId) {
  const normalized = normalizeUnitKey(unitId);
  return ((accountConfig && accountConfig.customerProfiles) || []).find(function (profile) {
    return (profile.unitIds || []).some(function (candidate) {
      return normalizeUnitKey(candidate) === normalized;
    });
  }) || null;
}

function evaluateSetpointStatus(customerProfile, temp1, temp2, hasSensorAlert) {
  if (!customerProfile || hasSensorAlert) {
    return {
      status: 'unconfigured',
      label: customerProfile ? 'Skip because sensor error' : 'No customer setpoint',
      outOfRange: false,
      offenders: [],
    };
  }

  const hasMin = customerProfile.tempMin !== null;
  const hasMax = customerProfile.tempMax !== null;
  if (!hasMin && !hasMax) {
    return {
      status: 'unconfigured',
      label: 'No customer setpoint',
      outOfRange: false,
      offenders: [],
    };
  }

  const offenders = [];
  const tolerance = 0.3;
  const values = [
    { key: 'temp1', value: temp1, label: 'Temp 1' },
    { key: 'temp2', value: temp2, label: 'Temp 2' },
  ];

  for (const entry of values) {
    const numeric = toNumber(entry.value);
    if (numeric === null || numeric === 0) {
      continue;
    }
    if (hasMin && numeric < customerProfile.tempMin - tolerance) {
      offenders.push(`${entry.label} below min`);
      continue;
    }
    if (hasMax && numeric > customerProfile.tempMax + tolerance) {
      offenders.push(`${entry.label} above max`);
    }
  }

  return {
    status: offenders.length ? 'outside' : 'within',
    label: offenders.length ? offenders.join(', ') : 'Within setpoint',
    outOfRange: offenders.length > 0,
    offenders,
  };
}

function toRadians(value) {
  return value * (Math.PI / 180);
}

function distanceMeters(fromLat, fromLng, toLat, toLng) {
  const earthRadius = 6371000;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat))
    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findMatchingPodSite(accountConfig, row) {
  if (row.latitude === null || row.longitude === null) {
    return null;
  }

  const normalizedUnitId = normalizeUnitKey(row.id);
  const matches = [];
  for (const podSite of ((accountConfig && accountConfig.podSites) || [])) {
    if (podSite.unitIds.length && !podSite.unitIds.some(function (candidate) {
      return normalizeUnitKey(candidate) === normalizedUnitId;
    })) {
      continue;
    }

    const distance = distanceMeters(row.latitude, row.longitude, podSite.latitude, podSite.longitude);
    if (distance > podSite.radiusMeters) {
      continue;
    }
    if (row.speed !== null && row.speed > podSite.maxSpeedKph) {
      continue;
    }

    matches.push({
      ...podSite,
      distanceMeters: distance,
    });
  }

  matches.sort(function (left, right) {
    return left.distanceMeters - right.distanceMeters;
  });
  return matches[0] || null;
}

function sanitizeConfigForClient() {
  return {
    solofleetBaseUrl: config.solofleetBaseUrl,
    endpointPath: config.endpointPath,
    refererPath: config.refererPath,
    vehiclePagePath: config.vehiclePagePath,
    discoveryEndpointPath: config.discoveryEndpointPath,
    vehicleRoleId: config.vehicleRoleId,
    authEmail: config.authEmail,
    hasSessionCookie: Boolean(config.sessionCookie),
    hasVerifiedSession: Boolean(config.sessionCookie && config.vehicleRoleId),
    sessionCookiePreview: maskCookie(config.sessionCookie),
    pollIntervalSeconds: config.pollIntervalSeconds,
    requestLookbackMinutes: config.requestLookbackMinutes,
    requestIntervalSeconds: config.requestIntervalSeconds,
    historyRetentionDays: config.historyRetentionDays,
    minDurationMinutes: config.minDurationMinutes,
    maxGapMinutes: config.maxGapMinutes,
    archiveType: config.archiveType,
    tempProfile: config.tempProfile,
    temperatureProcessing: config.temperatureProcessing,
    autoStart: config.autoStart,
    units: config.units,
    customerProfiles: config.customerProfiles,
    podSites: config.podSites,
    astroLocations: config.astroLocations,
    astroRoutes: config.astroRoutes,
    remoteResetAutomation: config.remoteResetAutomation,
    tms: {
      tenantLabel: config.tms?.tenantLabel || DEFAULT_TMS_CONFIG.tenantLabel,
      baseUrl: config.tms?.baseUrl || '',
      username: config.tms?.username || '',
      hasPassword: Boolean(config.tms?.password),
      hasSessionCookie: Boolean(config.tms?.sessionCookie),
      hasVerifiedSession: Boolean(config.tms?.sessionCookie && config.tms?.csrfToken),
      sessionCookiePreview: maskCookie(config.tms?.sessionCookie || ''),
      csrfTokenPreview: maskCookie(config.tms?.csrfToken || ''),
      autoSync: Boolean(config.tms?.autoSync),
      syncIntervalMinutes: Number(config.tms?.syncIntervalMinutes || DEFAULT_TMS_CONFIG.syncIntervalMinutes),
      geofenceRadiusMeters: Number(config.tms?.geofenceRadiusMeters || DEFAULT_TMS_CONFIG.geofenceRadiusMeters),
      longStopMinutes: Number(config.tms?.longStopMinutes || DEFAULT_TMS_CONFIG.longStopMinutes),
      appStagnantMinutes: Number(config.tms?.appStagnantMinutes || DEFAULT_TMS_CONFIG.appStagnantMinutes),
    },
    activeAccountId: config.activeAccountId,
    accounts: getAllAccountConfigs().map(function (account) {
      return {
        id: account.id,
        label: account.label,
        authEmail: account.authEmail,
        hasSessionCookie: Boolean(account.sessionCookie),
        hasVerifiedSession: Boolean(account.sessionCookie && account.vehicleRoleId),
        sessionCookiePreview: maskCookie(account.sessionCookie),
        vehicleRoleId: account.vehicleRoleId || '',
        units: account.units || [],
        customerProfiles: account.customerProfiles || [],
        podSites: account.podSites || [],
      };
    }),
  };
}

function getRemoteResetAutomationConfig() {
  return normalizeRemoteResetAutomation(config?.remoteResetAutomation);
}

function buildRemoteResetStatusPayload() {
  const automation = getRemoteResetAutomationConfig();
  return {
    enabled: automation.enabled,
    intervalHours: automation.intervalHours,
    selectedAccountIds: automation.selectedAccountIds,
    tempErrorOnly: automation.tempErrorOnly,
    maxUnitsPerRun: automation.maxUnitsPerRun,
    requestSpacingSeconds: automation.requestSpacingSeconds,
    onlyWhenPollingActive: automation.onlyWhenPollingActive,
    nextRunAt: remoteResetRuntime.nextRunAt,
    lastRunAt: remoteResetRuntime.lastRunFinishedAt || remoteResetRuntime.lastRunStartedAt,
    lastRunStartedAt: remoteResetRuntime.lastRunStartedAt,
    lastRunFinishedAt: remoteResetRuntime.lastRunFinishedAt,
    lastRunSummary: remoteResetRuntime.lastRunSummary,
    lastRunMessage: remoteResetRuntime.lastRunMessage,
    inFlight: remoteResetInFlight,
  };
}

function parseHttpStatusCode(value) {
  const match = String(value || '').match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

function clipResponseExcerpt(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 280);
}

function waitMs(durationMs) {
  return new Promise(function (resolve) {
    setTimeout(resolve, Math.max(0, Number(durationMs) || 0));
  });
}

function buildRemoteResetRunWindow(now, intervalHours) {
  const intervalMs = Math.max(1, Number(intervalHours || 3)) * 60 * 60 * 1000;
  const startMs = Math.floor(now / intervalMs) * intervalMs;
  return {
    intervalMs,
    startMs,
    endMs: startMs + intervalMs,
  };
}

async function listRemoteResetLogs(limit) {
  const resolvedLimit = Math.max(1, Math.min(200, Number(limit || REMOTE_RESET_DEFAULT_LOG_LIMIT)));
  if (getPostgresConfig().enabled) {
    await ensurePostgresSchema();
    const result = await postgresQuery(
      `select id, triggered_at, account_id, account_label, unit_id, unit_label, error_type, command,
              status, http_status, response_excerpt, reason
       from remote_reset_logs
       order by triggered_at desc
       limit $1`,
      [resolvedLimit],
    );
    return result.rows.map(function (row) {
      return {
        id: String(row.id || ''),
        triggeredAt: row.triggered_at ? new Date(row.triggered_at).toISOString() : null,
        accountId: String(row.account_id || 'primary'),
        accountLabel: String(row.account_label || row.account_id || 'primary'),
        unitId: String(row.unit_id || ''),
        unitLabel: String(row.unit_label || row.unit_id || ''),
        errorType: String(row.error_type || ''),
        command: String(row.command || 'cpureset'),
        status: String(row.status || 'unknown'),
        httpStatus: row.http_status === null || row.http_status === undefined ? null : Number(row.http_status),
        responseExcerpt: String(row.response_excerpt || ''),
        reason: String(row.reason || ''),
      };
    });
  }

  return loadLocalRemoteResetLogs()
    .sort(function (left, right) {
      return (toTimestampMaybe(right.triggeredAt) || 0) - (toTimestampMaybe(left.triggeredAt) || 0);
    })
    .slice(0, resolvedLimit);
}

async function appendRemoteResetLog(entry) {
  const nowIso = new Date().toISOString();
  const row = {
    id: String(entry.id || crypto.randomUUID()),
    triggeredAt: entry.triggeredAt || nowIso,
    accountId: String(entry.accountId || 'primary'),
    accountLabel: String(entry.accountLabel || resolveAccountLabel(entry.accountId || 'primary')),
    unitId: String(entry.unitId || ''),
    unitLabel: String(entry.unitLabel || entry.unitId || ''),
    errorType: String(entry.errorType || ''),
    command: String(entry.command || 'cpureset'),
    status: String(entry.status || 'unknown'),
    httpStatus: entry.httpStatus === null || entry.httpStatus === undefined ? null : Number(entry.httpStatus),
    responseExcerpt: clipResponseExcerpt(entry.responseExcerpt),
    reason: String(entry.reason || ''),
  };

  if (getPostgresConfig().enabled) {
    await ensurePostgresSchema();
    await postgresUpsertRows(
      'remote_reset_logs',
      [{
        id: row.id,
        triggered_at: row.triggeredAt,
        account_id: row.accountId,
        account_label: row.accountLabel,
        unit_id: row.unitId,
        unit_label: row.unitLabel,
        error_type: row.errorType,
        command: row.command,
        status: row.status,
        http_status: row.httpStatus,
        response_excerpt: row.responseExcerpt,
        reason: row.reason,
      }],
      ['id', 'triggered_at', 'account_id', 'account_label', 'unit_id', 'unit_label', 'error_type', 'command', 'status', 'http_status', 'response_excerpt', 'reason'],
      ['id'],
    );
    return row;
  }

  const rows = loadLocalRemoteResetLogs();
  rows.unshift(row);
  saveLocalRemoteResetLogs(rows);
  return row;
}

async function listRemoteResetAttemptedKeysForWindow(windowStartMs, windowEndMs) {
  if (getPostgresConfig().enabled) {
    await ensurePostgresSchema();
    const result = await postgresQuery(
      `select account_id, unit_id
       from remote_reset_logs
       where triggered_at >= $1 and triggered_at < $2`,
      [new Date(windowStartMs).toISOString(), new Date(windowEndMs).toISOString()],
    );
    return new Set(result.rows.map(function (row) {
      return `${String(row.account_id || 'primary')}::${String(row.unit_id || '')}`;
    }));
  }

  return new Set(loadLocalRemoteResetLogs().filter(function (row) {
    const timestamp = toTimestampMaybe(row.triggeredAt);
    return timestamp !== null && timestamp >= windowStartMs && timestamp < windowEndMs;
  }).map(function (row) {
    return `${String(row.accountId || 'primary')}::${String(row.unitId || '')}`;
  }));
}

function getRemoteResetSelectedAccounts() {
  const automation = getRemoteResetAutomationConfig();
  if (!automation.enabled) {
    return [];
  }
  return automation.selectedAccountIds
    .map(function (accountId) { return getAccountConfigById(accountId); })
    .filter(function (account) { return account && account.sessionCookie; });
}

function buildRemoteResetCandidates(now) {
  const automation = getRemoteResetAutomationConfig();
  const candidates = [];
  for (const accountConfig of getRemoteResetSelectedAccounts()) {
    const accountState = ensureAccountState(accountConfig.id);
    syncFleetSnapshotRecords(accountConfig, accountState, now);
    const alerts = buildLiveAlerts(accountConfig, accountState, now)
      .filter(function (alert) {
        return alert.isCurrent !== false
          && ['temp1', 'temp2', 'temp1+temp2'].includes(String(alert.type || '').trim());
      });
    const unitsById = new Map((accountConfig.units || []).map(function (unit) {
      return [String(unit.id || '').trim().toUpperCase(), unit];
    }));
    const byUnit = new Map();
    for (const alert of alerts) {
      const unitId = String(alert.unitId || '').trim();
      if (!unitId) {
        continue;
      }
      const existing = byUnit.get(unitId);
      if (!existing || (existing.type !== 'temp1+temp2' && alert.type === 'temp1+temp2') || ((alert.endTimestamp || 0) > (existing.endTimestamp || 0))) {
        const unitConfig = unitsById.get(unitId.toUpperCase());
        byUnit.set(unitId, {
          accountId: accountConfig.id,
          accountLabel: accountConfig.label || accountConfig.authEmail || accountConfig.id,
          unitId,
          unitLabel: alert.unitLabel || unitConfig?.label || alert.vehicle || unitId,
          errorType: alert.type,
          endTimestamp: alert.endTimestamp || 0,
        });
      }
    }
    candidates.push(...byUnit.values());
  }

  candidates.sort(function (left, right) {
    const severityLeft = left.errorType === 'temp1+temp2' ? 2 : 1;
    const severityRight = right.errorType === 'temp1+temp2' ? 2 : 1;
    return severityRight - severityLeft
      || (right.endTimestamp || 0) - (left.endTimestamp || 0)
      || String(left.accountLabel || left.accountId).localeCompare(String(right.accountLabel || right.accountId))
      || String(left.unitLabel || left.unitId).localeCompare(String(right.unitLabel || right.unitId));
  });
  return candidates;
}

async function sendSolofleetRemoteCommand(accountConfig, unitId, command) {
  const baseUrl = new URL(accountConfig.solofleetBaseUrl || config.solofleetBaseUrl);
  const endpointUrl = new URL('/SupportSendCommand/sendcommandtoVehicleSingle', baseUrl);
  const refererUrl = new URL(accountConfig.vehiclePagePath || config.vehiclePagePath || '/Vehicle', baseUrl);
  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: accountConfig.sessionCookie,
      Referer: refererUrl.toString(),
    },
    body: JSON.stringify({
      vehicleid: String(unitId || '').trim(),
      deviceid: null,
      command: String(command || 'cpureset').trim() || 'cpureset',
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
    error.statusCode = response.status;
    throw error;
  }
  return {
    statusCode: response.status,
    text,
  };
}

function clearRemoteResetSchedule() {
  clearTimeout(remoteResetTimer);
  remoteResetTimer = null;
  remoteResetRuntime.nextRunAt = null;
}

function scheduleNextRemoteReset() {
  clearRemoteResetSchedule();
  const automation = getRemoteResetAutomationConfig();
  if (!automation.enabled || !state.runtime.isPolling || automation.onlyWhenPollingActive && !state.runtime.isPolling || !getRemoteResetSelectedAccounts().length) {
    return;
  }

  const windowInfo = buildRemoteResetRunWindow(Date.now(), automation.intervalHours);
  const nextRunMs = windowInfo.endMs;
  const delayMs = Math.max(1000, nextRunMs - Date.now());
  remoteResetRuntime.nextRunAt = new Date(nextRunMs).toISOString();
  remoteResetTimer = setTimeout(function () {
    runRemoteResetCycle('scheduled').catch(function (error) {
      remoteResetRuntime.lastRunMessage = error.message;
      scheduleNextRemoteReset();
    });
  }, delayMs);
}

async function runRemoteResetCycle(trigger) {
  const automation = getRemoteResetAutomationConfig();
  if (!automation.enabled) {
    remoteResetRuntime.lastRunMessage = 'Automation disabled.';
    clearRemoteResetSchedule();
    return { attempted: 0, success: 0, failed: 0, skipped: 0 };
  }
  if (automation.onlyWhenPollingActive && !state.runtime.isPolling) {
    remoteResetRuntime.lastRunMessage = 'Polling is off. Remote reset skipped.';
    clearRemoteResetSchedule();
    return { attempted: 0, success: 0, failed: 0, skipped: 0 };
  }
  if (remoteResetInFlight) {
    return {
      attempted: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      reason: 'Remote reset already in progress.',
    };
  }

  const now = Date.now();
  const selectedAccounts = getRemoteResetSelectedAccounts();
  if (!selectedAccounts.length) {
    remoteResetRuntime.lastRunMessage = 'No selected account with valid Solofleet session.';
    clearRemoteResetSchedule();
    return { attempted: 0, success: 0, failed: 0, skipped: 0 };
  }

  const windowInfo = buildRemoteResetRunWindow(now, automation.intervalHours);
  const attemptedKeys = await listRemoteResetAttemptedKeysForWindow(windowInfo.startMs, windowInfo.endMs);
  const candidates = buildRemoteResetCandidates(now)
    .filter(function (candidate) {
      return !attemptedKeys.has(`${candidate.accountId}::${candidate.unitId}`);
    })
    .slice(0, automation.maxUnitsPerRun);

  remoteResetInFlight = true;
  remoteResetRuntime.lastRunStartedAt = new Date(now).toISOString();
  remoteResetRuntime.lastRunFinishedAt = null;
  remoteResetRuntime.lastRunSummary = null;
  remoteResetRuntime.lastRunMessage = `Running ${trigger} remote reset for ${candidates.length} unit(s).`;

  let attempted = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;

  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const accountConfig = getAccountConfigById(candidate.accountId);
      if (!accountConfig || !accountConfig.sessionCookie) {
        skipped += 1;
        await appendRemoteResetLog({
          accountId: candidate.accountId,
          accountLabel: candidate.accountLabel,
          unitId: candidate.unitId,
          unitLabel: candidate.unitLabel,
          errorType: candidate.errorType,
          command: 'cpureset',
          status: 'skipped',
          reason: 'Missing Solofleet session cookie.',
        });
        continue;
      }

      attempted += 1;
      try {
        const result = await sendSolofleetRemoteCommand(accountConfig, candidate.unitId, 'cpureset');
        success += 1;
        await appendRemoteResetLog({
          accountId: candidate.accountId,
          accountLabel: candidate.accountLabel,
          unitId: candidate.unitId,
          unitLabel: candidate.unitLabel,
          errorType: candidate.errorType,
          command: 'cpureset',
          status: 'success',
          httpStatus: result.statusCode,
          responseExcerpt: result.text,
        });
      } catch (error) {
        failed += 1;
        await appendRemoteResetLog({
          accountId: candidate.accountId,
          accountLabel: candidate.accountLabel,
          unitId: candidate.unitId,
          unitLabel: candidate.unitLabel,
          errorType: candidate.errorType,
          command: 'cpureset',
          status: 'failed',
          httpStatus: Number.isInteger(error?.statusCode) ? error.statusCode : parseHttpStatusCode(error?.message),
          responseExcerpt: error?.message || '',
          reason: getPublicErrorMessage(error, 'Remote reset failed.'),
        });
      }

      if (index < candidates.length - 1) {
        await waitMs(automation.requestSpacingSeconds * 1000);
      }
    }
  } finally {
    remoteResetInFlight = false;
    remoteResetRuntime.lastRunFinishedAt = new Date().toISOString();
    remoteResetRuntime.lastRunSummary = {
      attempted,
      success,
      failed,
      skipped,
      trigger: trigger || 'scheduled',
      accountCount: selectedAccounts.length,
    };
    remoteResetRuntime.lastRunMessage = attempted
      ? `Remote reset selesai: ${success} sukses, ${failed} gagal, ${skipped} skip.`
      : 'No live temp-error units eligible for remote reset.';
    if (state.runtime.isPolling) {
      scheduleNextRemoteReset();
    } else {
      clearRemoteResetSchedule();
    }
  }

  return remoteResetRuntime.lastRunSummary;
}

function detectLiveSensorFaultType(unitState, snapshot, now, options) {
  if (!snapshot) return null;
  const requiredDurationMinutes = Math.max(1, Number(options?.requiredDurationMinutes || 30));
  const requiredDurationMs = requiredDurationMinutes * 60 * 1000;
  const minimumSamples = Math.max(2, Number(options?.minimumSamples || 2));

  function isFaultTemperatureValue(value) {
    if (value === null || value === undefined || value === '') {
      return true;
    }
    return toNumber(value) === 0;
  }

  function checkSensor(sensorKey) {
    if (!isFaultTemperatureValue(snapshot[sensorKey])) return false;

    // We need a continuous streak of fault values for the configured window.
    const currentMs = snapshot.lastUpdatedMs || now;
    const cutoff = currentMs - requiredDurationMs;
    const records = unitState?.records || [];

    if (records.length === 0) return false;

    let sampleCount = 1;
    let earliestStreakTime = currentMs;

    // Evaluate backwards
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i];
      if (record.timestamp >= currentMs) continue;

      if (!isFaultTemperatureValue(record[sensorKey])) {
        break;
      }

      sampleCount++;
      earliestStreakTime = record.timestamp;

      if (earliestStreakTime <= cutoff) {
        break;
      }
    }

    const duration = currentMs - earliestStreakTime;
    return duration >= requiredDurationMs && sampleCount >= minimumSamples;
  }

  const sensor1Fault = checkSensor('temp1');
  const sensor2Fault = checkSensor('temp2');

  if (sensor1Fault && sensor2Fault) {
    return 'temp1+temp2';
  }
  if (sensor1Fault) {
    return 'temp1';
  }
  if (sensor2Fault) {
    return 'temp2';
  }
  return null;
}

function buildRealtimeRecordSeries(unitState, snapshot, now) {
  const currentMs = snapshot?.lastUpdatedMs || now;
  const records = Array.isArray(unitState?.records)
    ? unitState.records
      .filter(function (record) {
        return record && Number.isFinite(Number(record.timestamp || 0)) && Number(record.timestamp) <= currentMs;
      })
      .map(function (record) { return ({ ...record }); })
    : [];

  if (snapshot && Number.isFinite(currentMs)) {
    const synthetic = {
      timestamp: currentMs,
      vehicle: snapshot.unitId || unitState?.vehicle || unitState?.label || unitState?.unitId || 'Unknown Unit',
      speed: snapshot.speed ?? null,
      temp1: snapshot.temp1 ?? null,
      temp2: snapshot.temp2 ?? null,
      latitude: snapshot.latitude ?? null,
      longitude: snapshot.longitude ?? null,
      locationSummary: snapshot.locationSummary || '',
      zoneName: snapshot.zoneName || '',
      powerSupply: snapshot.powerSupply ?? null,
      errSensor: snapshot.errSensor || '',
    };
    const existingIndex = records.findIndex(function (record) { return record.timestamp === currentMs; });
    if (existingIndex >= 0) {
      records[existingIndex] = { ...records[existingIndex], ...synthetic };
    } else {
      records.push(synthetic);
    }
  }

  records.sort(function (left, right) { return left.timestamp - right.timestamp; });
  return { currentMs, records };
}

function isIdleRealtimeRecord(record) {
  const speed = toNumber(record?.speed);
  return speed === null ? true : speed <= TRIP_MONITOR_IDLE_SPEED_THRESHOLD_KPH;
}

function isSameRealtimeStopLocation(record, reference, radiusMeters = TRIP_MONITOR_LONG_STOP_RADIUS_METERS) {
  const leftLat = toNumber(record?.latitude);
  const leftLng = toNumber(record?.longitude);
  const rightLat = toNumber(reference?.latitude);
  const rightLng = toNumber(reference?.longitude);
  if ([leftLat, leftLng, rightLat, rightLng].every(Number.isFinite)) {
    return distanceMeters(leftLat, leftLng, rightLat, rightLng) <= radiusMeters;
  }

  const leftLabel = String(record?.zoneName || record?.locationSummary || '').trim().toLowerCase();
  const rightLabel = String(reference?.zoneName || reference?.locationSummary || '').trim().toLowerCase();
  if (leftLabel && rightLabel) {
    return leftLabel === rightLabel;
  }

  return true;
}

function detectTripMonitorTempOutOfRange(unitState, snapshot, tempRange, now, options) {
  const resolvedMax = toNumber(tempRange?.max);
  const resolvedMin = toNumber(tempRange?.min);
  if ((resolvedMax === null && resolvedMin === null) || !snapshot) return null;

  const requiredDurationMinutes = Math.max(1, Number(options?.requiredDurationMinutes || TRIP_MONITOR_TEMP_ABOVE_MAX_MINUTES));
  const requiredDurationMs = requiredDurationMinutes * 60 * 1000;
  const minimumSamples = Math.max(2, Number(options?.minimumSamples || 2));
  const tolerance = Number(options?.tolerance ?? TRIP_MONITOR_TEMP_TOLERANCE);
  const { currentMs, records } = buildRealtimeRecordSeries(unitState, snapshot, now);
  if (!records.length) return null;

  const isOutOfRange = function (record) {
    const temp1 = toNumber(record?.temp1);
    const temp2 = toNumber(record?.temp2);
    if (temp1 === null && temp2 === null) return null;

    let overMax = false;
    let underMin = false;

    if (temp1 !== null) {
      if (resolvedMax !== null && temp1 > resolvedMax + tolerance) overMax = true;
      if (resolvedMin !== null && temp1 < resolvedMin - tolerance) underMin = true;
    }
    if (temp2 !== null) {
      if (resolvedMax !== null && temp2 > resolvedMax + tolerance) overMax = true;
      if (resolvedMin !== null && temp2 < resolvedMin - tolerance) underMin = true;
    }

    return overMax || underMin;
  };

  if (isOutOfRange(records[records.length - 1]) !== true) {
    return null;
  }

  const cutoff = currentMs - requiredDurationMs;
  let sampleCount = 1;
  let earliestStreakTime = currentMs;

  for (let i = records.length - 2; i >= 0; i--) {
    const record = records[i];
    const state = isOutOfRange(record);
    if (state === null) {
      continue;
    }
    if (!state) {
      break;
    }
    sampleCount += 1;
    earliestStreakTime = record.timestamp;
  }

  const durationMs = currentMs - earliestStreakTime;
  
  // Tolerate up to 3 mins difference because fresh server restarts 
  // with a 30-min lookback fetch will inherently yield ~28-29 mins of data width
  if (durationMs < (requiredDurationMs - 180000) || sampleCount < minimumSamples) {
    return null;
  }

  return {
    startTimestamp: earliestStreakTime,
    endTimestamp: currentMs,
    durationMinutes: Number((durationMs / 60000).toFixed(1)),
    thresholdMax: resolvedMax,
    thresholdMin: resolvedMin,
  };
}

function detectRealtimeLongStop(unitState, snapshot, now, options) {
  if (!snapshot) return null;
  const { currentMs, records } = buildRealtimeRecordSeries(unitState, snapshot, now);
  if (!records.length) return null;

  const latestRecord = records[records.length - 1];
  if (!isIdleRealtimeRecord(latestRecord)) {
    return null;
  }

  const requiredDurationMinutes = Math.max(1, Number(options?.requiredDurationMinutes || TRIP_MONITOR_LONG_STOP_MINUTES));
  const requiredDurationMs = requiredDurationMinutes * 60 * 1000;
  const cutoff = currentMs - requiredDurationMs;
  let earliestStreakTime = currentMs;

  for (let i = records.length - 2; i >= 0; i--) {
    const record = records[i];
    if (!isIdleRealtimeRecord(record)) {
      break;
    }
    if (!isSameRealtimeStopLocation(record, latestRecord, Number(options?.radiusMeters || TRIP_MONITOR_LONG_STOP_RADIUS_METERS))) {
      break;
    }
    earliestStreakTime = record.timestamp;
    if (earliestStreakTime <= cutoff) {
      break;
    }
  }

  const durationMs = currentMs - earliestStreakTime;
  if (durationMs < requiredDurationMs) {
    return null;
  }

  return {
    startTimestamp: earliestStreakTime,
    endTimestamp: currentMs,
    durationMinutes: Number((durationMs / 60000).toFixed(1)),
    locationSummary: latestRecord.locationSummary || snapshot.locationSummary || '',
    zoneName: latestRecord.zoneName || snapshot.zoneName || '',
  };
}

function sensorFaultLabel(type) {
  if (type === 'temp1+temp2') {
    return 'Temp1 + Temp2 Error';
  }
  if (type === 'temp1') {
    return 'Temp1 Error';
  }
  if (type === 'temp2') {
    return 'Temp2 Error';
  }
  return '';
}

function buildFleetRows(accountConfig, accountState, now, liveAlerts) {
  return accountConfig.units.map(function (unit) {
    const unitState = accountState.units[unit.id] || normalizeUnitState(unit.id, { label: unit.label });
    const analysis = unitState.analysis || buildAnalysisFromRecords(unitState);
    const lastRecord = unitState.records.length ? unitState.records[unitState.records.length - 1] : null;
    const vehicleSnapshot = accountState.fleet.vehicles[normalizeUnitKey(unit.id)] || null;
    const lastUpdatedMs = vehicleSnapshot?.lastUpdatedMs ?? null;
    const minutesSinceUpdate = lastUpdatedMs === null ? null : (now - lastUpdatedMs) / 60000;
    const recentAlerts = liveAlerts.filter(function (incident) {
      return incident.unitId === unit.id;
    });
    const liveSensorFaultType = detectLiveSensorFaultType(unitState, vehicleSnapshot, now, {
      requiredDurationMinutes: 5,
      minimumSamples: 2,
    });
    const customerProfile = findCustomerProfileForUnit(accountConfig, unit.id);
    const setpoint = evaluateSetpointStatus(
      customerProfile,
      vehicleSnapshot?.temp1 ?? null,
      vehicleSnapshot?.temp2 ?? null,
      Boolean(liveSensorFaultType),
    );
    const geofenceContext = {
      accountId: accountConfig.id,
      customerName: customerProfile?.name || '',
    };
    const geofencePresence = astroCore.findCurrentGeofencePresence(
      unitState.records || [],
      config.astroLocations || [],
      geofenceContext,
    );
    const fallbackGeofenceStatus = (vehicleSnapshot?.speed ?? lastRecord?.speed ?? 0) > 0 ? 'En route' : 'Idle';

    return {
      accountId: accountConfig.id,
      accountLabel: accountConfig.label,
      rowKey: `${accountConfig.id}::${unit.id}`,
      id: unit.id,
      unitKey: normalizeUnitKey(unit.id),
      label: unit.label,
      unitCategory: normalizeUnitCategory(unit.category),
      unitCategoryLabel: unit.categoryLabel || UNIT_CATEGORY_LABELS[normalizeUnitCategory(unit.category)] || UNIT_CATEGORY_LABELS.uncategorized,
      vehicle: unitState.vehicle || vehicleSnapshot?.unitId || unit.label || unit.id,
      alias: vehicleSnapshot?.alias || unit.label,
      group: vehicleSnapshot?.group || '',
      deviceId: vehicleSnapshot?.deviceId || '',
      latitude: vehicleSnapshot?.latitude ?? null,
      longitude: vehicleSnapshot?.longitude ?? null,
      locationSummary: vehicleSnapshot?.locationSummary || '',
      zoneName: vehicleSnapshot?.zoneName || '',
      speed: vehicleSnapshot?.speed ?? lastRecord?.speed ?? null,
      liveTemp1: vehicleSnapshot?.temp1 ?? null,
      liveTemp2: vehicleSnapshot?.temp2 ?? null,
      liveTempDelta: vehicleSnapshot?.tempDelta ?? null,
      todayKm: vehicleSnapshot?.todayKm ?? null,
      powerSupply: vehicleSnapshot?.powerSupply ?? null,
      batteryVoltage: vehicleSnapshot?.batteryVoltage ?? null,
      errGps: vehicleSnapshot?.errGps || '',
      errSensor: vehicleSnapshot?.errSensor || '',
      customerId: customerProfile?.id || '',
      customerName: customerProfile?.name || '',
      targetTempMin: customerProfile?.tempMin ?? null,
      targetTempMax: customerProfile?.tempMax ?? null,
      setpointStatus: setpoint.status,
      setpointLabel: setpoint.label,
      outsideSetpoint: setpoint.outOfRange,
      hasLiveSensorFault: Boolean(liveSensorFaultType),
      liveSensorFaultType,
      liveSensorFaultLabel: sensorFaultLabel(liveSensorFaultType),
      door: vehicleSnapshot?.door || '',
      lastUpdatedAt: vehicleSnapshot?.lastUpdated || null,
      hasLiveSnapshot: Boolean(vehicleSnapshot && lastUpdatedMs !== null),
      minutesSinceUpdate,
      isMoving: (vehicleSnapshot?.speed ?? 0) > 0,
      lastFetchStartedAt: unitState.lastFetchStartedAt,
      lastFetchCompletedAt: unitState.lastFetchCompletedAt,
      lastSuccessAt: unitState.lastSuccessAt,
      lastError: unitState.lastError,
      recordsCount: unitState.records.length,
      incidentsCount: analysis.incidents.length,
      currentAlertsCount: recentAlerts.length,
      currentAlertTypes: recentAlerts.map(function (incident) {
        return incident.type;
      }),
      recentAlertsCount: recentAlerts.length,
      recentAlertTypes: recentAlerts.map(function (incident) {
        return incident.type;
      }),
      matchedPodSite: null,
      geofenceActive: Boolean(geofencePresence),
      geofenceLocationId: geofencePresence?.locationId || '',
      geofenceLocationName: geofencePresence?.locationName || '',
      geofenceLocationType: geofencePresence?.locationType || '',
      geofenceStatusLabel: geofencePresence?.statusLabel || fallbackGeofenceStatus,
      geofenceMatchedAt: geofencePresence?.enteredAt || null,
      geofenceDurationMinutes: geofencePresence?.durationMinutes ?? null,
      sourceStart: analysis.sourceStart,
      sourceEnd: analysis.sourceEnd,
      lastRecordAt: lastRecord ? lastRecord.timestamp : null,
    };
  }).sort(function (left, right) {
    return left.label.localeCompare(right.label);
  });
}

function buildGeofenceContext(accountConfig, customerProfile) {
  return {
    accountId: accountConfig?.id || 'primary',
    customerName: customerProfile?.name || '',
  };
}

function buildRecordGeofenceLabel(record, geofenceEvents) {
  const timestamp = Number(record?.timestamp || 0);
  if (timestamp) {
    const matchedEvent = (geofenceEvents || []).find(function (event) {
      return timestamp >= Number(event.enteredAt || 0) && timestamp <= Number(event.leftAt || 0);
    });
    if (matchedEvent) {
      return {
        geofenceStatusLabel: matchedEvent.statusLabel || astroCore.formatGeofenceStatusLabel({
          type: matchedEvent.locationType,
          name: matchedEvent.locationName,
        }),
        geofenceLocationName: matchedEvent.locationName || '',
        geofenceLocationType: matchedEvent.locationType || '',
      };
    }
  }

  return {
    geofenceStatusLabel: (Number(record?.speed || 0) > 0) ? 'En route' : 'Idle',
    geofenceLocationName: '',
    geofenceLocationType: '',
  };
}

function annotateHistoryRecordsWithGeofence(records, geofenceEvents) {
  return (records || []).map(function (record) {
    return {
      ...record,
      ...buildRecordGeofenceLabel(record, geofenceEvents),
    };
  });
}

function buildPercentValue(count, total) {
  if (!Number.isFinite(Number(count)) || !Number.isFinite(Number(total)) || Number(total) <= 0) {
    return 0;
  }
  return Number(((Number(count) / Number(total)) * 100).toFixed(1));
}

function buildOverview(fleetRows, liveAlerts, accountSummaries) {
  const staleUnits = fleetRows.filter(function (row) {
    return row.minutesSinceUpdate !== null && row.minutesSinceUpdate > 15;
  }).length;
  const sensorFlagUnits = fleetRows.filter(function (row) {
    return row.hasLiveSensorFault || Boolean(row.errSensor);
  }).length;
  const gpsFlagUnits = fleetRows.filter(function (row) {
    return Boolean(row.errGps);
  }).length;
  const movingUnits = fleetRows.filter(function (row) {
    return row.hasLiveSnapshot && row.isMoving;
  }).length;
  const idleUnits = fleetRows.filter(function (row) {
    return row.hasLiveSnapshot && !row.isMoving;
  }).length;
  const setpointMismatchUnits = fleetRows.filter(function (row) {
    return row.outsideSetpoint;
  }).length;
  const gpsLate30Units = fleetRows.filter(function (row) {
    return row.minutesSinceUpdate !== null && row.minutesSinceUpdate > 30;
  }).length;

  const accountStats = (accountSummaries || []).map(function (account) {
    const accountRows = fleetRows.filter(function (row) {
      return String(row.accountId || 'primary') === String(account.id || 'primary');
    });
    const totalConfiguredUnits = Math.max(Number(account.unitCount || 0), accountRows.length);
    const tempErrorUnits = accountRows.filter(function (row) {
      return row.hasLiveSensorFault;
    }).length;
    const movingAccountUnits = accountRows.filter(function (row) {
      return row.hasLiveSnapshot && row.isMoving;
    }).length;
    const idleAccountUnits = accountRows.filter(function (row) {
      return row.hasLiveSnapshot && !row.isMoving;
    }).length;
    const noLiveUnits = Math.max(0, totalConfiguredUnits - movingAccountUnits - idleAccountUnits);
    return {
      id: account.id,
      label: account.label || account.id,
      totalConfiguredUnits,
      tempErrorUnits,
      movingUnits: movingAccountUnits,
      idleUnits: idleAccountUnits,
      noLiveUnits,
      tempErrorRate: buildPercentValue(tempErrorUnits, totalConfiguredUnits),
      movingRate: buildPercentValue(movingAccountUnits, totalConfiguredUnits),
      idleRate: buildPercentValue(idleAccountUnits, totalConfiguredUnits),
    };
  });

  return {
    monitoredUnits: fleetRows.length,
    liveAlerts: liveAlerts.length,
    criticalAlerts: liveAlerts.filter(function (incident) {
      return incident.type === 'temp1+temp2';
    }).length,
    movingUnits,
    idleUnits,
    staleUnits,
    sensorFlagUnits,
    gpsFlagUnits,
    setpointMismatchUnits,
    gpsLate30Units,
    locationReadyUnits: fleetRows.filter(function (row) {
      return row.latitude !== null && row.longitude !== null;
    }).length,
    accounts: accountStats,
  };
}

function extractVerificationToken(html) {
  const matched = String(html || '').match(/name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"/i);
  return matched ? matched[1] : null;
}

function buildCookieHeader(setCookieHeaders) {
  return (setCookieHeaders || [])
    .map(function (cookieValue) { return String(cookieValue || '').split(';')[0].trim(); })
    .filter(Boolean)
    .join('; ');
}

function mergeCookieHeaders() {
  const jar = new Map();
  for (const cookieGroup of arguments) {
    for (const cookieValue of String(cookieGroup || '').split(/;\s*/)) {
      const trimmed = cookieValue.trim();
      if (!trimmed || !trimmed.includes('=')) {
        continue;
      }
      const separator = trimmed.indexOf('=');
      jar.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
    }
  }
  return [...jar.entries()].map(function ([name, value]) {
    return `${name}=${value}`;
  }).join('; ');
}

function normalizePlateKey(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeAddressKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function plateTextHasCameraSuffix(value) {
  return /\bCAMERA\b/i.test(String(value || '').trim());
}

function collectPlateCandidates() {
  const candidates = new Set();
  const texts = Array.prototype.slice.call(arguments);
  for (const rawValue of texts) {
    const text = String(rawValue || '').toUpperCase().trim();
    if (!text) {
      continue;
    }
    const compact = normalizePlateKey(text);
    if (compact.length >= 5) {
      candidates.add(compact);
    }
    const matches = text.match(/\b([A-Z]{1,2})\s*[-/]?\s*(\d{1,4})\s*[-/]?\s*([A-Z]{1,3})\b/g) || [];
    for (const match of matches) {
      const normalized = normalizePlateKey(match);
      if (normalized.length >= 5) {
        candidates.add(normalized);
      }
    }
  }
  return [...candidates];
}

function fleetRowIsCameraUnit(row) {
  if (!row || typeof row !== 'object') return false;
  return [row.label, row.alias, row.vehicle].some(plateTextHasCameraSuffix);
}

function shouldPreferFleetPlateRow(candidateRow, currentRow) {
  if (!currentRow) return true;
  const candidateIsCamera = fleetRowIsCameraUnit(candidateRow);
  const currentIsCamera = fleetRowIsCameraUnit(currentRow);
  if (candidateIsCamera !== currentIsCamera) {
    return !candidateIsCamera;
  }
  return rowPriority(candidateRow) > rowPriority(currentRow);
}

function extractTmsCsrfToken(html) {
  const text = String(html || '');
  const patterns = [
    /csrf_token["']?\s*[:=]\s*["']([^"']+)["']/i,
    /frappe\.csrf_token\s*=\s*["']([^"']+)["']/i,
    /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return String(match[1]).trim();
    }
  }
  return '';
}

function getTmsConfig() {
  return normalizeTmsConfig(config?.tms);
}

function hasTmsCredentials(tmsConfig) {
  const runtime = normalizeTmsConfig(tmsConfig || config?.tms);
  return Boolean(runtime.baseUrl && runtime.username && runtime.password);
}

function pushTmsSyncLog(entry) {
  const row = {
    id: String(entry.id || `tms-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    syncedAt: entry.syncedAt || new Date().toISOString(),
    status: String(entry.status || 'info'),
    fetchedCount: Number(entry.fetchedCount || 0),
    matchedCount: Number(entry.matchedCount || 0),
    unmatchedCount: Number(entry.unmatchedCount || 0),
    criticalCount: Number(entry.criticalCount || 0),
    warningCount: Number(entry.warningCount || 0),
    normalCount: Number(entry.normalCount || 0),
    noJobOrderCount: Number(entry.noJobOrderCount || 0),
    message: String(entry.message || '').trim(),
    details: entry.details && typeof entry.details === 'object' ? entry.details : {},
  };
  tmsSyncLogs.push(row);
  if (tmsSyncLogs.length > TMS_SYNC_LOG_LIMIT) {
    tmsSyncLogs.splice(0, tmsSyncLogs.length - TMS_SYNC_LOG_LIMIT);
  }
  return row;
}

function parseTmsSyncLogRow(row) {
  return {
    id: String(row.id || ''),
    syncedAt: row.synced_at || row.syncedAt || null,
    status: String(row.status || 'info'),
    fetchedCount: Number(row.fetched_count || row.fetchedCount || 0),
    matchedCount: Number(row.matched_count || row.matchedCount || 0),
    unmatchedCount: Number(row.unmatched_count || row.unmatchedCount || 0),
    criticalCount: Number(row.critical_count || row.criticalCount || 0),
    warningCount: Number(row.warning_count || row.warningCount || 0),
    normalCount: Number(row.normal_count || row.normalCount || 0),
    noJobOrderCount: Number(row.no_job_order_count || row.noJobOrderCount || 0),
    message: String(row.message || ''),
    details: row.details && typeof row.details === 'object' ? row.details : {},
  };
}

async function appendTmsSyncLog(entry) {
  const logRow = pushTmsSyncLog(entry);
  if (!getPostgresConfig().enabled) {
    return logRow;
  }
  await postgresUpsertRows(
    'tms_sync_logs',
    [{
      id: logRow.id,
      synced_at: logRow.syncedAt,
      status: logRow.status,
      fetched_count: logRow.fetchedCount,
      matched_count: logRow.matchedCount,
      unmatched_count: logRow.unmatchedCount,
      critical_count: logRow.criticalCount,
      warning_count: logRow.warningCount,
      normal_count: logRow.normalCount,
      no_job_order_count: logRow.noJobOrderCount,
      message: logRow.message,
      details: JSON.stringify(logRow.details || {}),
    }],
    ['id', 'synced_at', 'status', 'fetched_count', 'matched_count', 'unmatched_count', 'critical_count', 'warning_count', 'normal_count', 'no_job_order_count', 'message', 'details'],
    ['id'],
    { touchUpdatedAt: false },
  );
  return logRow;
}

async function listTmsSyncLogs(limit = 20) {
  const resolvedLimit = Math.max(1, Math.min(100, Number(limit || 20)));
  if (!getPostgresConfig().enabled) {
    return [...tmsSyncLogs].slice().reverse().slice(0, resolvedLimit);
  }
  const result = await postgresQuery(
    `select id, synced_at, status, fetched_count, matched_count, unmatched_count, critical_count, warning_count, normal_count, no_job_order_count, message, details
     from tms_sync_logs
     order by synced_at desc
     limit $1`,
    [resolvedLimit],
  );
  return result.rows.map(parseTmsSyncLogRow);
}

async function fetchTmsText(urlValue, options) {
  const controller = new AbortController();
  const timeout = setTimeout(function () {
    controller.abort();
  }, TMS_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(urlValue, {
      method: options?.method || 'GET',
      headers: options?.headers || {},
      body: options?.body,
      redirect: options?.redirect || 'follow',
      signal: controller.signal,
    });
    const bodyText = await response.text();
    return { response, bodyText };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTmsJson(urlValue, options) {
  const { response, bodyText } = await fetchTmsText(urlValue, options);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!response.ok) {
    throw new Error(`TMS request failed. HTTP ${response.status}`);
  }
  if (contentType.includes('text/html') || /<html/i.test(bodyText)) {
    throw new Error('TMS session expired or redirected to login page.');
  }
  try {
    return { response, payload: JSON.parse(bodyText || '{}') };
  } catch (error) {
    throw new Error('Invalid JSON response from TMS.');
  }
}

function parseFrappeCountPayload(payload) {
  if (typeof payload?.message === 'number') return Number(payload.message || 0);
  if (typeof payload?.message?.count === 'number') return Number(payload.message.count || 0);
  if (typeof payload?.count === 'number') return Number(payload.count || 0);
  return 0;
}

function parseFrappeListRows(payload) {
  const source = payload?.message || payload || {};
  if (Array.isArray(source)) {
    return source;
  }
  if (Array.isArray(source.values)) {
    const keys = Array.isArray(source.keys) ? source.keys : [];
    return source.values.map(function (row) {
      if (!Array.isArray(row)) return row;
      const mapped = {};
      keys.forEach(function (key, index) {
        const cleanKey = String(key || '').replace(/`/g, '').split('.').pop();
        mapped[cleanKey] = row[index];
      });
      return mapped;
    });
  }
  if (Array.isArray(source.result)) {
    return source.result;
  }
  if (Array.isArray(source.data)) {
    return source.data;
  }
  return [];
}

function parseFrappeDocPayload(payload) {
  if (Array.isArray(payload?.docs) && payload.docs[0]) return payload.docs[0];
  if (Array.isArray(payload?.message?.docs) && payload.message.docs[0]) return payload.message.docs[0];
  if (payload?.docs && typeof payload.docs === 'object' && !Array.isArray(payload.docs)) return payload.docs;
  if (payload?.message && typeof payload.message === 'object' && !Array.isArray(payload.message)) return payload.message;
  return null;
}

async function loginToSolofleet(email, password, rememberMe, options) {
  const loginOptions = options && typeof options === 'object' ? options : {};
  const normalizedEmail = String(email || '').trim();
  const normalizedPassword = String(password || '');
  if (!normalizedEmail || !normalizedPassword) {
    throw new Error('Email dan password Solofleet wajib diisi.');
  }
  const loginUrl = new URL('/Account/Login', config.solofleetBaseUrl);
  const loginPageResponse = await fetch(loginUrl, {
    method: 'GET',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  const loginHtml = await loginPageResponse.text();
  if (!loginPageResponse.ok) {
    throw new Error(`Unable to open Solofleet login page. HTTP ${loginPageResponse.status}`);
  }

  const verificationToken = extractVerificationToken(loginHtml);
  if (!verificationToken) {
    throw new Error('Login token from Solofleet page was not found.');
  }

  const initialCookies = buildCookieHeader(loginPageResponse.headers.getSetCookie ? loginPageResponse.headers.getSetCookie() : []);
  const body = new URLSearchParams({
    __RequestVerificationToken: verificationToken,
    Email: normalizedEmail,
    Password: normalizedPassword,
    RememberMe: rememberMe ? 'true' : 'false',
  });

  const submitResponse = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'content-type': 'application/x-www-form-urlencoded',
      cookie: initialCookies,
      referer: String(loginUrl),
    },
    body: body.toString(),
  });
  const submitHtml = await submitResponse.text();
  const submitCookies = buildCookieHeader(submitResponse.headers.getSetCookie ? submitResponse.headers.getSetCookie() : []);
  const mergedCookie = mergeCookieHeaders(initialCookies, submitCookies);

  if (!mergedCookie || !/\.AspNet\.ApplicationCookie=/i.test(mergedCookie)) {
    if (/validation-summary-errors|The Email field is required|The Password field is required|Log in\./i.test(submitHtml)) {
      throw new Error('Solofleet login failed. Check email/password.');
    }
    throw new Error('Solofleet login did not return an application session cookie.');
  }

  const resolvedEmail = normalizedEmail;
  const requestedAccountId = String(loginOptions.accountId || '').trim();
  const linkedAccountLabel = String(loginOptions.label || resolvedEmail || requestedAccountId || 'Linked account').trim();
  let resolvedRoleId = '';
  try {
    const roleProbeConfig = normalizeLinkedAccount({
      id: requestedAccountId || 'primary',
      label: linkedAccountLabel,
      authEmail: resolvedEmail,
      sessionCookie: mergedCookie,
      vehicleRoleId: '',
    });
    resolvedRoleId = await resolveVehicleRoleId(roleProbeConfig);
  } catch (error) {
    throw new Error(error?.message || 'Solofleet login gagal diverifikasi. Coba cek ulang email/password.');
  }
  if (!resolvedRoleId) {
    throw new Error('Solofleet login gagal diverifikasi. Coba cek ulang email/password.');
  }

  if (requestedAccountId && requestedAccountId !== 'primary') {
    const linkedAccounts = Array.isArray(config.linkedAccounts) ? [...config.linkedAccounts] : [];
    const nextAccount = normalizeLinkedAccount({
      id: requestedAccountId,
      label: linkedAccountLabel,
      authEmail: resolvedEmail,
      sessionCookie: mergedCookie,
      vehicleRoleId: resolvedRoleId,
      units: [],
      customerProfiles: [],
      podSites: [],
    });
    const index = linkedAccounts.findIndex(function (account) { return account.id === requestedAccountId; });
    if (index >= 0) {
      linkedAccounts[index] = nextAccount;
    } else {
      linkedAccounts.push(nextAccount);
    }
    config.linkedAccounts = linkedAccounts;
    config.activeAccountId = requestedAccountId;
  } else {
    config.authEmail = resolvedEmail;
    config.sessionCookie = mergedCookie;
    config.vehicleRoleId = resolvedRoleId;
    config.activeAccountId = 'primary';
  }
  config = normalizeConfig(config);
  saveConfig();
  return sanitizeConfigForClient();
}

function logoutFromSolofleet(accountId) {
  const resolvedAccountId = String(accountId || 'primary').trim() || 'primary';
  if (resolvedAccountId === 'primary') {
    config.authEmail = '';
    config.sessionCookie = '';
    config.vehicleRoleId = '';
    config.activeAccountId = config.linkedAccounts.length ? config.linkedAccounts[0].id : 'primary';
    state.fleet = clone(DEFAULT_STATE.fleet);
    state.units = {};
    state.dailySnapshots = [];
    state.podSnapshots = [];
    state.runtime.lastSnapshotAt = null;
    state.runtime.lastSnapshotError = null;
  } else {
    config.linkedAccounts = (config.linkedAccounts || []).filter(function (account) {
      return account.id !== resolvedAccountId;
    });
    delete state.linkedAccounts[resolvedAccountId];
    if (config.activeAccountId === resolvedAccountId) {
      config.activeAccountId = 'primary';
    }
  }
  config = normalizeConfig(config);
  saveConfig();
  saveState();
  return sanitizeConfigForClient();
}

async function loginToTms(input) {
  const source = input && typeof input === 'object' ? input : {};
  const current = getTmsConfig();
  const nextConfig = normalizeTmsConfig({
    ...current,
    tenantLabel: source.tenantLabel ?? current.tenantLabel,
    baseUrl: source.baseUrl ?? current.baseUrl,
    username: source.username ?? current.username,
    password: source.password === undefined || source.password === null || source.password === ''
      ? current.password
      : source.password,
    autoSync: source.autoSync ?? current.autoSync,
    syncIntervalMinutes: source.syncIntervalMinutes ?? current.syncIntervalMinutes,
    geofenceRadiusMeters: source.geofenceRadiusMeters ?? current.geofenceRadiusMeters,
    longStopMinutes: source.longStopMinutes ?? current.longStopMinutes,
    appStagnantMinutes: source.appStagnantMinutes ?? current.appStagnantMinutes,
  });

  if (!nextConfig.baseUrl || !nextConfig.username || !nextConfig.password) {
    throw new Error('Base URL, username, dan password TMS wajib diisi.');
  }

  const loginPageUrl = new URL('/login?redirect-to=/', nextConfig.baseUrl);
  const loginPageResponse = await fetch(loginPageUrl, {
    method: 'GET',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  const loginPageHtml = await loginPageResponse.text();
  if (!loginPageResponse.ok) {
    throw new Error(`Unable to open TMS login page. HTTP ${loginPageResponse.status}`);
  }

  const initialCookies = buildCookieHeader(loginPageResponse.headers.getSetCookie ? loginPageResponse.headers.getSetCookie() : []);
  const loginBody = new URLSearchParams({
    cmd: 'login',
    usr: nextConfig.username,
    pwd: nextConfig.password,
    device: 'desktop',
  });
  const submitResponse = await fetch(new URL('/', nextConfig.baseUrl), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      cookie: initialCookies,
      referer: String(loginPageUrl),
      'x-frappe-csrf-token': 'None',
    },
    body: loginBody.toString(),
  });
  const submitText = await submitResponse.text();
  const submitCookies = buildCookieHeader(submitResponse.headers.getSetCookie ? submitResponse.headers.getSetCookie() : []);
  const mergedCookie = mergeCookieHeaders(initialCookies, submitCookies);
  if (!mergedCookie) {
    throw new Error(/Invalid Login|incorrect|failed/i.test(submitText)
      ? 'TMS login failed. Check username/password.'
      : 'TMS login did not return a session cookie.');
  }

  const appPageUrl = new URL('/app/job-order?start_actual_time_load=%5B%22Timespan%22%2C%22today%22%5D', nextConfig.baseUrl);
  const appPageResponse = await fetch(appPageUrl, {
    method: 'GET',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      cookie: mergedCookie,
      referer: String(loginPageUrl),
    },
  });
  const appPageHtml = await appPageResponse.text();
  if (!appPageResponse.ok) {
    throw new Error(`Unable to open TMS app page. HTTP ${appPageResponse.status}`);
  }
  const csrfToken = extractTmsCsrfToken(appPageHtml);
  if (!csrfToken) {
    throw new Error('TMS login succeeded but csrf token was not found.');
  }

  config = normalizeConfig({
    ...config,
    tms: {
      ...nextConfig,
      sessionCookie: mergedCookie,
      csrfToken,
    },
  });
  saveConfig();
  scheduleNextTmsSync();
  return sanitizeConfigForClient().tms;
}

function logoutFromTms() {
  config = normalizeConfig({
    ...config,
    tms: {
      ...config.tms,
      sessionCookie: '',
      csrfToken: '',
    },
  });
  saveConfig();
  scheduleNextTmsSync();
  return sanitizeConfigForClient().tms;
}

async function tmsRequest(pathname, options, allowRetry = true) {
  const runtime = getTmsConfig();
  if (!runtime.baseUrl) {
    throw new Error('TMS base URL is not configured.');
  }
  let effective = runtime;
  if (!effective.sessionCookie || !effective.csrfToken) {
    if (!hasTmsCredentials(effective)) {
      throw new Error('TMS session is not ready. Save credentials and connect first.');
    }
    await loginToTms(effective);
    effective = getTmsConfig();
  }

  const targetUrl = pathname instanceof URL ? pathname : new URL(pathname, effective.baseUrl);
  const method = String(options?.method || 'GET').toUpperCase();
  const headers = {
    accept: 'application/json,text/plain,*/*',
    cookie: effective.sessionCookie,
    referer: String(new URL('/app/job-order?start_actual_time_load=%5B%22Timespan%22%2C%22today%22%5D', effective.baseUrl)),
    'x-frappe-csrf-token': effective.csrfToken,
    ...(options?.headers || {}),
  };
  let body = options?.body;
  if (body instanceof URLSearchParams) {
    headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    body = body.toString();
  }

  try {
    return await fetchTmsJson(targetUrl, { method, headers, body });
  } catch (error) {
    if (allowRetry && /session expired|login page|HTTP 403|HTTP 401/i.test(String(error.message || '')) && hasTmsCredentials(effective)) {
      await loginToTms(effective);
      return tmsRequest(pathname, options, false);
    }
    throw error;
  }
}

const TMS_MONITOR_LOOKBACK_DAYS = 15;
const TMS_INCLUDED_JOB_ORDER_STATUSES = ['On Progress', 'Fully Pickup', 'Partial Delivered', 'Fully Delivered'];
const TMS_INCLUDED_JOB_ORDER_STATUS_KEYS = new Set(TMS_INCLUDED_JOB_ORDER_STATUSES.map(function (status) {
  return String(status || '').trim().toLowerCase();
}));

function buildTmsMonitorWindow(now) {
  const endMs = Number(now || Date.now());
  const startMs = endMs - ((TMS_MONITOR_LOOKBACK_DAYS - 1) * 24 * 60 * 60 * 1000);
  return {
    startDay: formatLocalDay(startMs),
    endDay: formatLocalDay(endMs),
    lookbackDays: TMS_MONITOR_LOOKBACK_DAYS,
  };
}

function buildTmsJobOrderFilters(window) {
  return [
    ['Job Order', 'job_order_status', 'in', TMS_INCLUDED_JOB_ORDER_STATUSES],
    ['Job Order', 'start_actual_time_load', '>=', `${window.startDay} 00:00:00`],
    ['Job Order', 'start_actual_time_load', '<=', `${window.endDay} 23:59:59`],
  ];
}

async function fetchTmsJobOrderCount(window) {
  const body = new URLSearchParams({
    doctype: 'Job Order',
    filters: JSON.stringify(buildTmsJobOrderFilters(window)),
    fields: JSON.stringify([]),
    distinct: 'false',
    limit: '1001',
  });
  const { payload } = await tmsRequest('/api/method/frappe.desk.reportview.get_count', {
    method: 'POST',
    body,
  });
  return parseFrappeCountPayload(payload);
}

async function fetchTmsJobOrderListPage(start, pageLength, window) {
  const body = new URLSearchParams({
    doctype: 'Job Order',
    fields: JSON.stringify([
      '`tabJob Order`.`name`',
      '`tabJob Order`.`job_order_status`',
      '`tabJob Order`.`fleet_type`',
      '`tabJob Order`.`plat_no`',
      '`tabJob Order`.`start_actual_time_load`',
      '`tabJob Order`.`actual_distance_km`',
      '`tabJob Order`.`customer`',
      '`tabJob Order`.`modified`',
    ]),
    filters: JSON.stringify(buildTmsJobOrderFilters(window)),
    order_by: '`tabJob Order`.`modified` DESC',
    start: String(start || 0),
    page_length: String(pageLength || 100),
    view: 'List',
    group_by: '`tabJob Order`.`name`',
    with_comment_count: 'true',
  });
  const { payload } = await tmsRequest('/api/method/frappe.desk.reportview.get', {
    method: 'POST',
    body,
  });
  return parseFrappeListRows(payload);
}

async function fetchTmsJobOrderList(window) {
  const total = await fetchTmsJobOrderCount(window);
  const pageLength = 100;
  const rows = [];
  for (let start = 0; start < Math.max(total, pageLength); start += pageLength) {
    const page = await fetchTmsJobOrderListPage(start, pageLength, window);
    rows.push(...page);
    if (page.length < pageLength) break;
  }
  return rows;
}

async function fetchTmsDocByName(doctype, name) {
  const encodedType = encodeURIComponent(String(doctype || '').trim());
  const encodedName = encodeURIComponent(String(name || '').trim());
  const { payload } = await tmsRequest(`/api/method/frappe.desk.form.load.getdoc?doctype=${encodedType}&name=${encodedName}&_=${Date.now()}`, {
    method: 'GET',
  });
  return parseFrappeDocPayload(payload);
}

async function fetchTmsJobOrderDoc(jobOrderId) {
  const doc = await fetchTmsDocByName('Job Order', jobOrderId);
  if (!doc) {
    throw new Error(`TMS detail JO ${jobOrderId} tidak ditemukan.`);
  }
  return doc;
}

async function fetchTmsAddressDoc(addressName) {
  return fetchTmsDocByName('Address', addressName);
}

function extractTmsAddressCoordinates(doc) {
  if (!doc || typeof doc !== 'object') {
    return { latitude: null, longitude: null };
  }
  const latitude = toNumber(
    doc.latitude
    ?? doc.lat
    ?? doc.custom_latitude
    ?? doc.custom_lat
    ?? doc.location_latitude
    ?? doc.custom_location_latitude
    ?? doc.map_latitude
    ?? doc.geo_latitude
  );
  const longitude = toNumber(
    doc.longitude
    ?? doc.lng
    ?? doc.longtitude
    ?? doc.custom_longitude
    ?? doc.custom_lng
    ?? doc.custom_longtitude
    ?? doc.location_longitude
    ?? doc.custom_location_longitude
    ?? doc.map_longitude
    ?? doc.geo_longitude
  );
  return { latitude, longitude };
}

function normalizeTmsAddressCacheRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const tenantLabel = String(row.tenant_label || row.tenantLabel || '').trim();
  const normalizedAddressKey = String(row.normalized_address_key || row.normalizedAddressKey || '').trim();
  const addressName = String(row.address_name || row.addressName || '').trim();
  const status = String(row.status || '').trim().toLowerCase() || 'missing';
  if (!tenantLabel || !normalizedAddressKey) {
    return null;
  }
  return {
    tenantLabel,
    normalizedAddressKey,
    addressName: addressName || normalizedAddressKey,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    sourceAddressId: String(row.source_address_id || row.sourceAddressId || '').trim(),
    status,
    fetchedAt: toTimestampMaybe(row.fetched_at || row.fetchedAt),
    lastSeenAt: toTimestampMaybe(row.last_seen_at || row.lastSeenAt),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  };
}

async function loadTmsAddressCacheEntries(tenantLabel, normalizedKeys) {
  if (!normalizedKeys.length || !getPostgresConfig().enabled) {
    return new Map();
  }
  await ensurePostgresSchema();
  const result = await postgresQuery(
    `select tenant_label, normalized_address_key, address_name, latitude, longitude, source_address_id, status, fetched_at, last_seen_at, metadata
       from tms_address_cache
      where tenant_label = $1 and normalized_address_key = any($2::text[])`,
    [String(tenantLabel || '').trim(), normalizedKeys],
  );
  const map = new Map();
  for (const row of (result.rows || [])) {
    const normalized = normalizeTmsAddressCacheRow(row);
    if (normalized) {
      map.set(normalized.normalizedAddressKey, normalized);
    }
  }
  return map;
}

async function upsertTmsAddressCacheEntries(entries) {
  if (!entries.length || !getPostgresConfig().enabled) {
    return 0;
  }
  return postgresUpsertRows(
    'tms_address_cache',
    entries.map(function (entry) {
      return {
        tenant_label: entry.tenantLabel,
        normalized_address_key: entry.normalizedAddressKey,
        address_name: entry.addressName,
        latitude: entry.latitude,
        longitude: entry.longitude,
        source_address_id: entry.sourceAddressId || null,
        status: entry.status || 'missing',
        fetched_at: entry.fetchedAt ? new Date(entry.fetchedAt).toISOString() : new Date().toISOString(),
        last_seen_at: entry.lastSeenAt ? new Date(entry.lastSeenAt).toISOString() : new Date().toISOString(),
        metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
        updated_at: new Date().toISOString(),
      };
    }),
    ['tenant_label', 'normalized_address_key', 'address_name', 'latitude', 'longitude', 'source_address_id', 'status', 'fetched_at', 'last_seen_at', 'metadata', 'updated_at'],
    ['tenant_label', 'normalized_address_key'],
    { touchUpdatedAt: false },
  );
}

function collectTmsAddressNamesFromDoc(doc) {
  const names = new Set();
  const taskList = Array.isArray(doc?.task_list) ? doc.task_list : [];
  const orderList = Array.isArray(doc?.order_list) ? doc.order_list : [];
  for (const task of taskList) {
    const taskAddress = String(task?.task_address || '').trim();
    if (taskAddress) {
      names.add(taskAddress);
    }
  }
  for (const order of orderList) {
    const loadLocation = String(order?.load_location || '').trim();
    const unloadLocation = String(order?.unload_location || '').trim();
    if (loadLocation) {
      names.add(loadLocation);
    }
    if (unloadLocation) {
      names.add(unloadLocation);
    }
  }
  return [...names];
}

async function resolveTmsAddressEntries(addressNames, tenantLabel) {
  const uniqueNames = [...new Set((addressNames || []).map(function (name) {
    return String(name || '').trim();
  }).filter(Boolean))];
  const uniqueByKey = new Map();
  uniqueNames.forEach(function (name) {
    const key = normalizeAddressKey(name);
    if (key && !uniqueByKey.has(key)) {
      uniqueByKey.set(key, name);
    }
  });
  const keys = [...uniqueByKey.keys()];
  if (!keys.length) {
    return { byKey: new Map(), stats: { total: 0, resolved: 0, missing: 0, refreshed: 0 } };
  }

  const now = Date.now();
  const existing = await loadTmsAddressCacheEntries(tenantLabel, keys);
  const nextByKey = new Map();
  const upsertRows = [];
  const stats = { total: keys.length, resolved: 0, missing: 0, refreshed: 0 };

  for (const [normalizedKey, rawName] of uniqueByKey.entries()) {
    const cached = existing.get(normalizedKey) || null;
    const fetchedAge = cached?.fetchedAt ? Math.max(0, now - cached.fetchedAt) : Number.POSITIVE_INFINITY;
    const cacheFresh = cached
      ? cached.status === 'resolved'
        ? fetchedAge < TMS_ADDRESS_CACHE_RESOLVED_TTL_MS
        : fetchedAge < TMS_ADDRESS_CACHE_MISSING_TTL_MS
      : false;
    if (cached && cacheFresh) {
      const cachedRow = {
        ...cached,
        addressName: cached.addressName || rawName,
        lastSeenAt: now,
      };
      nextByKey.set(normalizedKey, cachedRow);
      upsertRows.push(cachedRow);
      if (cachedRow.status === 'resolved' && cachedRow.latitude !== null && cachedRow.longitude !== null) {
        stats.resolved += 1;
      } else {
        stats.missing += 1;
      }
      continue;
    }

    let nextRow = {
      tenantLabel,
      normalizedAddressKey: normalizedKey,
      addressName: rawName,
      latitude: null,
      longitude: null,
      sourceAddressId: '',
      status: 'missing',
      fetchedAt: now,
      lastSeenAt: now,
      metadata: {
        rawName,
        normalizedAddressKey: normalizedKey,
      },
    };
    try {
      const doc = await fetchTmsAddressDoc(rawName);
      const coordinates = extractTmsAddressCoordinates(doc);
      nextRow = {
        ...nextRow,
        addressName: String(doc?.name || rawName).trim() || rawName,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        sourceAddressId: String(doc?.name || '').trim(),
        status: coordinates.latitude !== null && coordinates.longitude !== null ? 'resolved' : 'missing',
        metadata: {
          ...nextRow.metadata,
          sourceAddressId: String(doc?.name || '').trim(),
          fetchedFromDoc: Boolean(doc),
        },
      };
    } catch (error) {
      nextRow = {
        ...nextRow,
        metadata: {
          ...nextRow.metadata,
          error: String(error?.message || error || 'Address fetch failed'),
        },
      };
    }
    stats.refreshed += 1;
    if (nextRow.status === 'resolved' && nextRow.latitude !== null && nextRow.longitude !== null) {
      stats.resolved += 1;
    } else {
      stats.missing += 1;
    }
    nextByKey.set(normalizedKey, nextRow);
    upsertRows.push(nextRow);
  }

  await upsertTmsAddressCacheEntries(upsertRows);
  return { byKey: nextByKey, stats };
}

function resolveTmsAddressEntry(addressLookup, name) {
  const key = normalizeAddressKey(name);
  return key ? addressLookup.get(key) || null : null;
}

function buildResolvedTmsStops(taskList, orderList, addressLookup) {
  const resolvedTaskList = [];
  const stops = [];
  let unloadCounter = 0;

  for (const [taskIndex, task] of taskList.entries()) {
    const taskType = String(task?.task_type || '').trim().toLowerCase() === 'unload' ? 'unload' : 'load';
    const fallbackOrder = taskType === 'load'
      ? orderList.find(function (item) { return String(item?.load_location || '').trim(); }) || null
      : orderList[unloadCounter] || null;
    const taskAddress = String(task?.task_address || (taskType === 'load' ? fallbackOrder?.load_location : fallbackOrder?.unload_location) || '').trim();
    const addressEntry = resolveTmsAddressEntry(addressLookup, taskAddress);
    const directLatitude = toNumber(task?.latitude);
    const directLongitude = toNumber(task?.longitude);
    const latitude = directLatitude ?? addressEntry?.latitude ?? null;
    const longitude = directLongitude ?? addressEntry?.longitude ?? null;
    const coordinateSource = directLatitude !== null && directLongitude !== null
      ? 'task_list'
      : latitude !== null && longitude !== null
        ? 'address_cache'
        : 'unresolved';
    const stopLabel = taskType === 'load' ? 'LOAD' : `U${unloadCounter + 1}`;
    const stopName = taskType === 'load' ? 'Load' : `Unload ${unloadCounter + 1}`;
    const stop = {
      idx: stops.length + 1,
      taskIdx: Number(task?.idx || taskIndex + 1),
      taskType,
      label: stopLabel,
      name: stopName,
      taskAddress,
      normalizedAddressKey: normalizeAddressKey(taskAddress),
      latitude,
      longitude,
      coordinateSource,
      eta: toTimestampMaybe(task?.eta),
      etd: toTimestampMaybe(task?.etd),
      ata: toTimestampMaybe(task?.ata),
      atd: toTimestampMaybe(task?.atd),
    };
    stops.push(stop);
    resolvedTaskList.push({
      ...task,
      task_address: taskAddress,
      resolved_latitude: latitude,
      resolved_longitude: longitude,
      resolved_coordinate_source: coordinateSource,
      normalized_address_key: stop.normalizedAddressKey,
      stop_label: stopLabel,
      stop_name: stopName,
      stop_index: stop.idx,
    });
    if (taskType === 'unload') {
      unloadCounter += 1;
    }
  }

  return { taskList: resolvedTaskList, stops };
}

function getTmsTaskArrays(doc) {
  const taskList = Array.isArray(doc?.task_list) ? [...doc.task_list] : [];
  const workflowLines = Array.isArray(doc?.job_workflow_line) ? [...doc.job_workflow_line] : [];
  const driverAssign = Array.isArray(doc?.driver_assign) ? [...doc.driver_assign] : [];
  const orderList = Array.isArray(doc?.order_list) ? [...doc.order_list] : [];
  taskList.sort(function (left, right) { return Number(left.idx || 0) - Number(right.idx || 0); });
  workflowLines.sort(function (left, right) { return Number(left.idx || 0) - Number(right.idx || 0); });
  driverAssign.sort(function (left, right) { return Number((left && (left.idx ?? left.index)) || 0) - Number((right && (right.idx ?? right.index)) || 0); });
  orderList.sort(function (left, right) { return Number(left.idx || 0) - Number(right.idx || 0); });
  return { taskList, workflowLines, driverAssign, orderList };
}

function isTmsJobActive(doc) {
  const status = String(doc?.job_order_status || '').trim().toLowerCase();
  return status ? TMS_INCLUDED_JOB_ORDER_STATUS_KEYS.has(status) : false;
}

function buildTmsJobSnapshotFromDoc(doc, tenantLabel, addressLookup) {
  const { taskList, workflowLines, driverAssign, orderList } = getTmsTaskArrays(doc);
  const resolvedStops = buildResolvedTmsStops(taskList, orderList, addressLookup || new Map());
  const resolvedTaskList = resolvedStops.taskList;
  const stops = resolvedStops.stops;
  const loadTask = resolvedTaskList.find(function (task) { return String(task.task_type || '').toLowerCase() === 'load'; }) || resolvedTaskList[0] || null;
  const unloadTasks = resolvedTaskList.filter(function (task) { return String(task.task_type || '').toLowerCase() === 'unload'; });
  const destinationTask = unloadTasks[unloadTasks.length - 1] || resolvedTaskList[resolvedTaskList.length - 1] || null;
  const plateRaw = String(doc?.plat_no || '').trim();
  const normalizedPlate = normalizePlateKey(plateRaw);
  const plateCandidates = collectPlateCandidates(plateRaw);
  const startTimestamp = toTimestampMaybe(doc?.start_actual_time_load || loadTask?.eta || Date.now());
  const normalizedTempRange = normalizeTemperatureRange(
    doc?.custom_minimum_temperature,
    doc?.custom_maximum_temperature,
  );
  return {
    jobOrderId: String(doc?.name || '').trim(),
    day: formatLocalDay(startTimestamp || Date.now()),
    tenantLabel: tenantLabel || '',
    customerName: String(doc?.customer || '').trim(),
    normalizedPlate,
    plateCandidates,
    plateRaw,
    unitLabel: plateRaw,
    jobOrderStatus: String(doc?.job_order_status || '').trim(),
    workflowState: String(doc?.workflow_state || '').trim(),
    originName: String(loadTask?.task_address || doc?.homebase_location || '').trim(),
    destinationName: String(destinationTask?.task_address || doc?.finish_location || '').trim(),
    tempMin: normalizedTempRange.min,
    tempMax: normalizedTempRange.max,
    etaOrigin: toTimestampMaybe(loadTask?.eta || doc?.start_actual_time_load),
    etaDestination: toTimestampMaybe(destinationTask?.eta || doc?.finish_actual_time_unload),
    active: isTmsJobActive(doc),
    taskList: resolvedTaskList,
    orderList,
    workflowLines,
    driverAssign,
    stops,
    rawDoc: doc,
  };
}

function buildFleetPlateIndex(now) {
  const allRows = [];
  const allContexts = [];
  for (const accountConfig of getAllAccountConfigs()) {
    const accountState = ensureAccountState(accountConfig.id);
    syncFleetSnapshotRecords(accountConfig, accountState, now);
    const liveAlerts = buildLiveAlerts(accountConfig, accountState, now);
    const rows = annotateFleetRowsWithPods(accountConfig, buildFleetRows(accountConfig, accountState, now, liveAlerts));
    allRows.push(...rows);
    rows.forEach(function (row) {
      allContexts.push({
        row,
        unitState: accountState.units[row.id] || normalizeUnitState(row.id, { label: row.label, vehicle: row.alias || row.label }),
      });
    });
  }
  const byPlate = new Map();
  const byRowKey = new Map();
  for (const context of allContexts) {
    const row = context.row;
    byRowKey.set(row.rowKey, context);
    const keys = collectPlateCandidates(row.label, row.alias, row.vehicle, row.id);
    for (const key of keys) {
      if (shouldPreferFleetPlateRow(row, byPlate.get(key)?.row || null)) {
        byPlate.set(key, context);
      }
    }
  }
  return { allRows, allContexts, byPlate, byRowKey };
}

function findWorkflowStatus(workflowLines, taskName, pattern) {
  return workflowLines.find(function (line) {
    return (!taskName || String(line.task_address || '').trim() === taskName)
      && pattern.test(String(line.status_description || ''));
  }) || null;
}

function findWorkflowStopStatus(workflowLines, stop, pattern) {
  const normalizedTaskType = String(stop?.taskType || stop?.task_type || '').trim().toLowerCase();
  const normalizedAddress = normalizeAddressKey(stop?.taskAddress || stop?.task_address || '');
  return (workflowLines || []).find(function (line) {
    const lineTaskType = String(line?.task_type || '').trim().toLowerCase();
    const lineAddress = normalizeAddressKey(line?.task_address || '');
    return (!normalizedTaskType || lineTaskType === normalizedTaskType)
      && (!normalizedAddress || lineAddress === normalizedAddress)
      && pattern.test(String(line?.status_description || ''));
  }) || null;
}

function getTripMonitorSnapshotStops(snapshot) {
  if (Array.isArray(snapshot?.stops) && snapshot.stops.length) {
    return snapshot.stops.map(function (stop, index) {
      const taskType = String(stop?.taskType || stop?.task_type || '').trim().toLowerCase() === 'unload' ? 'unload' : 'load';
      return {
        idx: Number(stop?.idx || index + 1),
        taskIdx: Number(stop?.taskIdx || stop?.task_idx || stop?.idx || index + 1),
        taskType,
        label: String(stop?.label || (taskType === 'load' ? 'LOAD' : `U${index}`)).trim(),
        name: String(stop?.name || (taskType === 'load' ? 'Load' : `Unload ${index}`)).trim(),
        taskAddress: String(stop?.taskAddress || stop?.task_address || '').trim(),
        latitude: toNumber(stop?.latitude),
        longitude: toNumber(stop?.longitude),
        eta: toTimestampMaybe(stop?.eta),
        etd: toTimestampMaybe(stop?.etd),
        ata: toTimestampMaybe(stop?.ata),
        atd: toTimestampMaybe(stop?.atd),
      };
    }).sort(function (left, right) { return left.idx - right.idx; });
  }
  const taskList = Array.isArray(snapshot?.taskList) ? [...snapshot.taskList] : [];
  taskList.sort(function (left, right) { return Number(left?.idx || 0) - Number(right?.idx || 0); });
  let unloadCounter = 0;
  return taskList.map(function (task, index) {
    const taskType = String(task?.task_type || '').trim().toLowerCase() === 'unload' ? 'unload' : 'load';
    if (taskType === 'unload') {
      unloadCounter += 1;
    }
    return {
      idx: index + 1,
      taskIdx: Number(task?.idx || index + 1),
      taskType,
      label: taskType === 'load' ? 'LOAD' : `U${unloadCounter}`,
      name: taskType === 'load' ? 'Load' : `Unload ${unloadCounter}`,
      taskAddress: String(task?.task_address || '').trim(),
      latitude: toNumber(task?.resolved_latitude ?? task?.latitude),
      longitude: toNumber(task?.resolved_longitude ?? task?.longitude),
      eta: toTimestampMaybe(task?.eta),
      etd: toTimestampMaybe(task?.etd),
      ata: toTimestampMaybe(task?.ata),
      atd: toTimestampMaybe(task?.atd),
    };
  }).filter(function (stop) { return stop.taskAddress || stop.latitude !== null || stop.longitude !== null; });
}

function buildTripMonitorStopProgress(snapshot, fleetRow, options) {
  const stops = getTripMonitorSnapshotStops(snapshot);
  const workflowLines = Array.isArray(snapshot?.workflowLines) ? snapshot.workflowLines : [];
  const radius = Math.max(50, Number(options?.radiusMeters || DEFAULT_TMS_CONFIG.geofenceRadiusMeters));
  const now = Number(options?.now || Date.now());
  const liveLat = toNumber(fleetRow?.latitude);
  const liveLng = toNumber(fleetRow?.longitude);
  return stops.map(function (stop, index) {
    const arrivedLine = findWorkflowStopStatus(workflowLines, stop, /\btiba\b/i);
    const departedLine = findWorkflowStopStatus(workflowLines, stop, /\bberangkat\b/i);
    const startedLine = findWorkflowStopStatus(
      workflowLines,
      stop,
      stop.taskType === 'load' ? /\bmulai muat\b/i : /\bmulai bongkar\b/i,
    );
    const completedLine = findWorkflowStopStatus(
      workflowLines,
      stop,
      stop.taskType === 'load' ? /\bselesai muat\b/i : /\bselesai bongkar\b/i,
    );
    const arrivedAt = toTimestampMaybe(arrivedLine?.checked_time) ?? stop.ata ?? null;
    const departedAt = toTimestampMaybe(departedLine?.checked_time) ?? stop.atd ?? null;
    const startedAt = toTimestampMaybe(startedLine?.checked_time) ?? null;
    const completedAt = toTimestampMaybe(completedLine?.checked_time) ?? null;
    const distanceMeters = distanceMetersBetween(liveLat, liveLng, stop.latitude, stop.longitude);
    const insideRadius = distanceMeters !== null && distanceMeters <= radius;
    const inferredArrivedAt = arrivedAt ?? ((insideRadius && departedAt === null) ? now : null);
    const arrivalSource = arrivedAt !== null
      ? (arrivedLine ? 'workflow' : 'history')
      : (insideRadius && departedAt === null ? 'geofence' : null);
    const departedSource = departedAt !== null
      ? (departedLine ? 'workflow' : 'history')
      : null;
    const completedSource = completedAt !== null
      ? (completedLine ? 'workflow' : 'history')
      : null;
    const observable = stop.latitude !== null
      && stop.longitude !== null
      || arrivedAt !== null
      || departedAt !== null
      || startedAt !== null
      || completedAt !== null
      || stop.eta !== null
      || stop.etd !== null;
    return {
      index,
      stop,
      arrivedAt,
      arrivedSource: arrivalSource,
      inferredArrivedAt,
      departedAt,
      departedSource,
      startedAt,
      startedSource: startedAt !== null ? (startedLine ? 'workflow' : 'history') : null,
      completedAt,
      completedSource,
      distanceMeters,
      insideRadius,
      observable,
      isCurrentStop: insideRadius || (inferredArrivedAt !== null && departedAt === null && (distanceMeters === null || distanceMeters <= Math.max(1000, radius * 3))),
    };
  });
}

function buildTripMonitorShippingStatus(snapshot, fleetRow, tmsConfig, now) {
  const progress = buildTripMonitorStopProgress(snapshot, fleetRow, {
    radiusMeters: TRIP_MONITOR_STATUS_RADIUS_METERS,
    now,
  });
  const stepOrder = ['otw-load', 'sampai-load', 'menuju-unload', 'sampai-unload', 'selesai'];
  const stepMeta = {
    'otw-load': { label: 'OTW LOAD' },
    'sampai-load': { label: 'SAMPAI LOAD' },
    'menuju-unload': { label: 'MENUJU UNLOAD' },
    'sampai-unload': { label: 'SAMPAI UNLOAD' },
    selesai: { label: 'SELESAI' },
  };
  if (!progress.length) {
    return {
      key: 'otw-load',
      label: stepMeta['otw-load'].label,
      changedAt: null,
      source: 'default',
      detail: 'Stop TMS belum tersedia.',
      activeStopName: '',
      steps: stepOrder.map(function (key, index) {
        return {
          key,
          label: stepMeta[key].label,
          changedAt: null,
          source: null,
          locationName: '',
          completed: index === 0 ? false : false,
          active: index === 0,
        };
      }),
    };
  }

  const loadStop = progress[0] || null;
  const unloadEntries = progress.filter(function (entry) { return entry.stop.taskType === 'unload'; });
  const finalStop = unloadEntries[unloadEntries.length - 1] || progress[progress.length - 1] || null;
  const finalFinishedAt = finalStop?.departedAt ?? finalStop?.completedAt ?? null;
  const finalFinishedSource = finalStop?.departedAt !== null
    ? finalStop?.departedSource
    : finalStop?.completedAt !== null
      ? finalStop?.completedSource
      : null;
  const currentUnload = unloadEntries.find(function (entry) {
    return entry.isCurrentStop;
  }) || null;
  const lastDeparted = [...progress].reverse().find(function (entry) {
    return entry.departedAt !== null;
  }) || null;
  const lastUnloadArrived = [...unloadEntries].reverse().find(function (entry) {
    return entry.inferredArrivedAt !== null;
  }) || null;
  const transitTarget = lastDeparted
    ? progress.find(function (entry) { return entry.index > lastDeparted.index; }) || null
    : null;

  let currentKey = 'otw-load';
  let changedAt = null;
  let source = 'default';
  let detail = `Menuju ${loadStop?.stop?.name || 'lokasi load'}.`;
  let activeStopName = loadStop?.stop?.name || '';

  if (finalFinishedAt !== null) {
    currentKey = 'selesai';
    changedAt = finalFinishedAt;
    source = finalFinishedSource || 'history';
    detail = `Selesai di ${finalStop?.stop?.name || 'unload terakhir'}.`;
    activeStopName = finalStop?.stop?.name || '';
  } else if (!loadStop?.departedAt) {
    if (loadStop?.inferredArrivedAt !== null || loadStop?.startedAt !== null || loadStop?.completedAt !== null) {
      currentKey = 'sampai-load';
      changedAt = loadStop?.inferredArrivedAt ?? loadStop?.startedAt ?? loadStop?.completedAt ?? null;
      source = loadStop?.arrivedSource || loadStop?.startedSource || loadStop?.completedSource || 'geofence';
      detail = `Sudah sampai di ${loadStop?.stop?.name || 'lokasi load'}.`;
      activeStopName = loadStop?.stop?.name || '';
    }
  } else if (currentUnload) {
    currentKey = 'sampai-unload';
    changedAt = currentUnload.inferredArrivedAt ?? currentUnload.startedAt ?? currentUnload.completedAt ?? null;
    source = currentUnload.arrivedSource || currentUnload.startedSource || currentUnload.completedSource || 'geofence';
    detail = `Sudah sampai di ${currentUnload.stop?.name || 'lokasi unload'}.`;
    activeStopName = currentUnload.stop?.name || '';
  } else {
    currentKey = 'menuju-unload';
    changedAt = lastDeparted?.departedAt ?? loadStop?.departedAt ?? null;
    source = lastDeparted?.departedSource || loadStop?.departedSource || 'history';
    detail = `Dalam perjalanan ke ${transitTarget?.stop?.name || 'lokasi unload'}.`;
    activeStopName = transitTarget?.stop?.name || '';
  }

  const timelineChangedAt = {
    'otw-load': null,
    'sampai-load': loadStop?.inferredArrivedAt ?? loadStop?.startedAt ?? loadStop?.completedAt ?? null,
    'menuju-unload': lastDeparted?.departedAt ?? loadStop?.departedAt ?? null,
    'sampai-unload': lastUnloadArrived?.inferredArrivedAt ?? lastUnloadArrived?.startedAt ?? lastUnloadArrived?.completedAt ?? null,
    selesai: finalFinishedAt,
  };
  const timelineSource = {
    'otw-load': null,
    'sampai-load': loadStop?.arrivedSource || loadStop?.startedSource || loadStop?.completedSource || null,
    'menuju-unload': lastDeparted?.departedSource || loadStop?.departedSource || null,
    'sampai-unload': lastUnloadArrived?.arrivedSource || lastUnloadArrived?.startedSource || lastUnloadArrived?.completedSource || null,
    selesai: finalFinishedSource,
  };
  const timelineLocation = {
    'otw-load': loadStop?.stop?.name || '',
    'sampai-load': loadStop?.stop?.name || '',
    'menuju-unload': transitTarget?.stop?.name || lastUnloadArrived?.stop?.name || finalStop?.stop?.name || '',
    'sampai-unload': lastUnloadArrived?.stop?.name || finalStop?.stop?.name || '',
    selesai: finalStop?.stop?.name || '',
  };
  const activeIndex = Math.max(0, stepOrder.indexOf(currentKey));
  const steps = stepOrder.map(function (key, index) {
    return {
      key,
      label: stepMeta[key].label,
      changedAt: timelineChangedAt[key],
      source: timelineSource[key],
      locationName: timelineLocation[key],
      completed: index < activeIndex,
      active: index === activeIndex,
    };
  });

  return {
    key: currentKey,
    label: stepMeta[currentKey].label,
    changedAt,
    source,
    detail,
    activeStopName,
    steps,
  };
}

function evaluateTripMonitorTemperatureGate(snapshot, fleetRow, tmsConfig) {
  const progress = buildTripMonitorStopProgress(snapshot, fleetRow, {
    radiusMeters: Number(tmsConfig?.geofenceRadiusMeters || DEFAULT_TMS_CONFIG.geofenceRadiusMeters),
    now: Date.now(),
  });
  if (!progress.length) {
    return {
      isActive: false,
      phase: 'unknown',
      reason: 'Stop TMS belum tersedia.',
      lastCompletedStopIndex: 0,
      finalStopDeparted: false,
    };
  }

  const finalStop = progress[progress.length - 1] || null;
  if (finalStop?.departedAt) {
    return {
      isActive: false,
      phase: 'completed-final-unload',
      reason: `Sudah berangkat dari ${finalStop.stop.name}.`,
      lastCompletedStopIndex: finalStop.index + 1,
      finalStopDeparted: true,
    };
  }

  const loadStop = progress[0] || null;
  if (!loadStop?.departedAt) {
    return {
      isActive: false,
      phase: 'before-load-departure',
      reason: 'Belum berangkat dari lokasi load.',
      lastCompletedStopIndex: 0,
      finalStopDeparted: false,
    };
  }

  const currentObservedStop = progress.find(function (entry) {
    return entry.isCurrentStop;
  }) || null;
  if (currentObservedStop) {
    return {
      isActive: false,
      phase: 'at-unload',
      reason: `Sedang berada di ${currentObservedStop.stop.name}.`,
      lastCompletedStopIndex: currentObservedStop.index,
      finalStopDeparted: false,
    };
  }

  const lastDeparted = [...progress].reverse().find(function (entry) {
    return entry.departedAt !== null;
  }) || null;
  if (!lastDeparted) {
    return {
      isActive: false,
      phase: 'unknown',
      reason: 'Belum ada workflow departure yang bisa dipastikan.',
      lastCompletedStopIndex: 0,
      finalStopDeparted: false,
    };
  }
  if (lastDeparted.index >= progress.length - 1) {
    return {
      isActive: false,
      phase: 'completed-final-unload',
      reason: `Sudah berangkat dari ${lastDeparted.stop.name}.`,
      lastCompletedStopIndex: lastDeparted.index + 1,
      finalStopDeparted: true,
    };
  }

  const nextStop = progress[lastDeparted.index + 1] || null;
  if (!nextStop?.observable) {
    return {
      isActive: false,
      phase: 'unknown',
      reason: `Koordinat/indikator ${nextStop?.stop?.name || 'stop berikutnya'} belum cukup untuk gate temperature.`,
      lastCompletedStopIndex: lastDeparted.index + 1,
      finalStopDeparted: false,
    };
  }

  return {
    isActive: true,
    phase: 'in-transit-to-unload',
    reason: `Dalam perjalanan dari ${lastDeparted.stop.name} ke ${nextStop.stop.name}.`,
    lastCompletedStopIndex: lastDeparted.index + 1,
    finalStopDeparted: false,
  };
}

function distanceMetersBetween(leftLat, leftLng, rightLat, rightLng) {
  const a = toNumber(leftLat);
  const b = toNumber(leftLng);
  const c = toNumber(rightLat);
  const d = toNumber(rightLng);
  if (![a, b, c, d].every(Number.isFinite)) {
    return null;
  }
  const toRad = function (value) { return value * Math.PI / 180; };
  const earth = 6371000;
  const dLat = toRad(c - a);
  const dLng = toRad(d - b);
  const aa = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earth * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

function evaluateTmsIncidents(snapshot, fleetRow, unitState, tmsConfig, now) {
  const incidents = [];
  const radius = Number(tmsConfig?.geofenceRadiusMeters || DEFAULT_TMS_CONFIG.geofenceRadiusMeters);
  const { taskList, workflowLines } = snapshot;
  const temperatureGate = evaluateTripMonitorTemperatureGate(snapshot, fleetRow, tmsConfig);
  const normalizedTempRange = normalizeTemperatureRange(snapshot?.tempMin, snapshot?.tempMax);
  const loadTask = taskList.find(function (task) { return String(task.task_type || '').toLowerCase() === 'load'; }) || taskList[0] || null;
  const unloadTasks = taskList.filter(function (task) { return String(task.task_type || '').toLowerCase() === 'unload'; });
  const destinationTask = unloadTasks[unloadTasks.length - 1] || taskList[taskList.length - 1] || null;
  const loadArrivedLine = findWorkflowStatus(workflowLines, String(loadTask?.task_address || '').trim(), /tiba/i);
  const destinationArrivedLine = findWorkflowStatus(workflowLines, String(destinationTask?.task_address || '').trim(), /tiba/i);
  const destinationDoneLine = findWorkflowStatus(workflowLines, String(destinationTask?.task_address || '').trim(), /selesai bongkar/i);
  const latestWorkflow = [...workflowLines].sort(function (left, right) {
    return (toTimestampMaybe(right.checked_time) || 0) - (toTimestampMaybe(left.checked_time) || 0);
  })[0] || null;
  const liveLat = fleetRow?.latitude ?? null;
  const liveLng = fleetRow?.longitude ?? null;
  const originDistance = distanceMetersBetween(liveLat, liveLng, loadTask?.latitude, loadTask?.longitude);
  const destinationDistance = distanceMetersBetween(liveLat, liveLng, destinationTask?.latitude, destinationTask?.longitude);
  const originEta = snapshot.etaOrigin;
  const destinationEta = snapshot.etaDestination;
  const destinationEtaLateByMinutes = destinationEta && now > destinationEta ? Math.round((now - destinationEta) / 60000) : 0;
  const originEtaLateByMinutes = originEta && now > originEta ? Math.round((now - originEta) / 60000) : 0;

  if (fleetRow?.errGps) {
    incidents.push({ code: 'gps-error', label: 'GPS error', severity: 'critical', detail: String(fleetRow.errGps || 'GPS error') });
  }
  if (fleetRow?.hasLiveSensorFault) {
    incidents.push({ code: 'temp-error', label: 'Temp error', severity: 'critical', detail: String(fleetRow.liveSensorFaultLabel || 'Sensor temperature error') });
  }

  const tempOutOfRange = detectTripMonitorTempOutOfRange(
    unitState,
    fleetRow,
    normalizedTempRange,
    now,
    { requiredDurationMinutes: TRIP_MONITOR_TEMP_ABOVE_MAX_MINUTES, minimumSamples: 2 },
  );
  if (tempOutOfRange) {
    let detailStr = '';
    if (normalizedTempRange.min !== null && normalizedTempRange.max !== null) {
      detailStr = `Suhu box diluar batas ${formatTripMonitorMetric(normalizedTempRange.min, 1)} - ${formatTripMonitorMetric(normalizedTempRange.max, 1)} selama ${formatTripMonitorMetric(tempOutOfRange.durationMinutes, 1)} menit`;
    } else if (normalizedTempRange.max !== null) {
      detailStr = `Suhu box > ${formatTripMonitorMetric(normalizedTempRange.max, 1)} selama ${formatTripMonitorMetric(tempOutOfRange.durationMinutes, 1)} menit`;
    } else if (normalizedTempRange.min !== null) {
      detailStr = `Suhu box < ${formatTripMonitorMetric(normalizedTempRange.min, 1)} selama ${formatTripMonitorMetric(tempOutOfRange.durationMinutes, 1)} menit`;
    }

    incidents.push({
      code: 'temp-out-of-range',
      label: 'Temp out of range',
      severity: 'critical',
      detail: detailStr,
    });
  }
  if (snapshot.active && originEtaLateByMinutes > 15 && !loadArrivedLine) {
    incidents.push({ code: 'late-origin', label: 'Late to load', severity: 'warning', detail: `ETA load lewat ${originEtaLateByMinutes} menit` });
  }
  if (snapshot.active && destinationEtaLateByMinutes > 15 && !destinationArrivedLine && !destinationDoneLine) {
    incidents.push({ code: 'late-destination', label: 'Late to destination', severity: 'warning', detail: `ETA tujuan lewat ${destinationEtaLateByMinutes} menit` });
  }
  if (snapshot.active && originEtaLateByMinutes > 15 && !loadArrivedLine && originDistance !== null && originDistance > radius) {
    incidents.push({ code: 'geofence-origin', label: 'Missed load geofence', severity: 'warning', detail: `Jarak ${Math.round(originDistance)} m dari tempat muat` });
  }
  if (snapshot.active && destinationEtaLateByMinutes > 15 && !destinationArrivedLine && destinationDistance !== null && destinationDistance > radius) {
    incidents.push({ code: 'geofence-destination', label: 'Missed destination geofence', severity: 'warning', detail: `Jarak ${Math.round(destinationDistance)} m dari tujuan` });
  }
  const realtimeLongStop = snapshot.active
    ? detectRealtimeLongStop(unitState, fleetRow, now, {
      requiredDurationMinutes: TRIP_MONITOR_LONG_STOP_MINUTES,
      radiusMeters: TRIP_MONITOR_LONG_STOP_RADIUS_METERS,
    })
    : null;
  if (
    realtimeLongStop
    && (originDistance === null || originDistance > radius)
    && (destinationDistance === null || destinationDistance > radius)
  ) {
    incidents.push({
      code: 'long-stop',
      label: 'Long stop',
      severity: 'warning',
      detail: `Diam di titik yang sama >= ${formatTripMonitorMetric(realtimeLongStop.durationMinutes, 1)} menit`,
    });
  }

  return incidents;
}

function chooseHeadlineSnapshot(items, fleetRow, unitState, tmsConfig, now) {
  const scored = items.map(function (item) {
    const incidents = evaluateTmsIncidents(item, fleetRow, unitState, tmsConfig, now);
    const severityScore = incidents.some(function (incident) { return incident.severity === 'critical'; }) ? 2 : incidents.length ? 1 : 0;
    const etaScore = -(item.etaDestination || item.etaOrigin || 0);
    return { item, incidents, severityScore, etaScore };
  }).sort(function (left, right) {
    return right.severityScore - left.severityScore || right.etaScore - left.etaScore;
  });
  return scored[0] || null;
}

function formatTripMonitorMetric(value, decimals = 0) {
  const resolved = Number(value);
  if (!Number.isFinite(resolved)) {
    return '-';
  }
  return resolved.toFixed(decimals);
}

function resolveFleetContextForTripMonitor(source, fleetIndex) {
  if (!source || !fleetIndex) return null;
  const plateCandidates = Array.isArray(source.plateCandidates) && source.plateCandidates.length
    ? source.plateCandidates
    : collectPlateCandidates(
      source.plateRaw,
      source.unitLabel,
      source.unitId,
      source.normalizedPlate,
    );
  return plateCandidates.map(function (candidate) {
    return fleetIndex.byPlate.get(candidate);
  }).find(Boolean) || (source.normalizedPlate ? fleetIndex.byPlate.get(source.normalizedPlate) : null) || null;
}

function refreshTripMonitorStoredRow(row, fleetIndex, tmsConfig, now) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? { ...row.metadata } : {};
  const jobOrders = Array.isArray(metadata.jobOrders) ? metadata.jobOrders.filter(Boolean) : [];
  const referenceSnapshot = metadata.headlineJobOrder || jobOrders[0] || {
    plateRaw: row?.unitLabel || '',
    normalizedPlate: row?.normalizedPlate || '',
    plateCandidates: collectPlateCandidates(row?.unitLabel, row?.normalizedPlate),
    active: row?.severity !== 'no-job-order',
  };
  const fleetContext = resolveFleetContextForTripMonitor(referenceSnapshot, fleetIndex);
  const fleetRow = fleetContext?.row || null;

  if (!jobOrders.length) {
    const normalizedRowTempRange = normalizeTemperatureRange(row?.tempMin, row?.tempMax);
    return {
      ...row,
      unitKey: fleetRow ? `${fleetRow.accountId}::${fleetRow.id}` : row.unitKey,
      unitId: fleetRow?.id || row.unitId,
      unitLabel: fleetRow?.alias || fleetRow?.label || row.unitLabel,
      tempMin: normalizedRowTempRange.min,
      tempMax: normalizedRowTempRange.max,
      shippingStatusLabel: row?.shippingStatusLabel || '',
      shippingStatusChangedAt: row?.shippingStatusChangedAt || null,
      metadata: {
        ...metadata,
        shippingStatus: metadata.shippingStatus || null,
        fleetRow: fleetRow || metadata.fleetRow || null,
      },
    };
  }

  const activeItems = jobOrders.filter(function (item) { return item.active; });
  const inactiveItems = jobOrders.filter(function (item) { return !item.active; });
  const headline = chooseHeadlineSnapshot(
    activeItems.length ? activeItems : inactiveItems,
    fleetRow,
    fleetContext?.unitState || null,
    tmsConfig,
    now,
  );
  if (!headline) {
    return row;
  }

  const incidents = headline.incidents || [];
  const shippingStatus = buildTripMonitorShippingStatus(
    headline.item,
    fleetRow,
    tmsConfig,
    now,
  );
  const normalizedTempRange = normalizeTemperatureRange(headline.item.tempMin, headline.item.tempMax);
  let severity = 'normal';
  let boardStatus = 'normal';
  let unmatchedReason = '';
  if (!fleetRow) {
    severity = 'unmatched';
    boardStatus = 'unmatched';
    unmatchedReason = 'Nopol TMS tidak cocok dengan unit Solofleet yang terkonfigurasi.';
  } else if (!activeItems.length) {
    severity = 'no-job-order';
    boardStatus = 'no-job-order';
  } else if (incidents.some(function (incident) { return incident.severity === 'critical'; })) {
    severity = 'critical';
    boardStatus = 'critical';
  } else if (incidents.length) {
    severity = 'warning';
    boardStatus = 'warning';
  }

  const driver = (headline.item.driverAssign || [])[0] || null;
  return {
    ...row,
    unitKey: fleetRow ? `${fleetRow.accountId}::${fleetRow.id}` : (headline.item.normalizedPlate || row.unitKey),
    unitId: fleetRow?.id || row.unitId,
    unitLabel: fleetRow?.alias || fleetRow?.label || headline.item.plateRaw || headline.item.unitLabel || row.unitLabel,
    severity,
    boardStatus,
    jobOrderId: headline.item.jobOrderId || row.jobOrderId,
    jobOrderCount: jobOrders.length || row.jobOrderCount,
    originName: headline.item.originName || row.originName,
    destinationName: headline.item.destinationName || row.destinationName,
    tempMin: normalizedTempRange.min,
    tempMax: normalizedTempRange.max,
    etaOrigin: headline.item.etaOrigin ?? row.etaOrigin,
    etaDestination: headline.item.etaDestination ?? row.etaDestination,
    driverAppStatus: [driver?.assignment_status, driver?.driver_status, driver?.job_offer_status].filter(Boolean).join(' | ') || row.driverAppStatus,
    incidentCodes: summarizeIncidentCodes(incidents),
    incidentSummary: incidents.map(function (incident) { return incident.label; }).join(', '),
    shippingStatusLabel: shippingStatus.label,
    shippingStatusChangedAt: shippingStatus.changedAt,
    unmatchedReason,
    metadata: {
      ...metadata,
      incidents,
      shippingStatus,
      fleetRow: fleetRow || null,
      headlineJobOrder: headline.item,
      jobOrders,
    },
  };
}

function summarizeIncidentCodes(incidents) {
  return [...new Set((incidents || []).map(function (incident) { return incident.code; }).filter(Boolean))];
}

function severityRank(value) {
  switch (String(value || '').toLowerCase()) {
    case 'critical': return 5;
    case 'warning': return 4;
    case 'normal': return 3;
    case 'unmatched': return 2;
    case 'no-job-order': return 1;
    default: return 0;
  }
}

function buildTmsMonitorRows(jobSnapshots, fleetIndex, tmsConfig, now) {
  const groups = new Map();
  for (const snapshot of jobSnapshots) {
    const fleetContext = (snapshot.plateCandidates || []).map(function (candidate) {
      return fleetIndex.byPlate.get(candidate);
    }).find(Boolean) || (snapshot.normalizedPlate ? fleetIndex.byPlate.get(snapshot.normalizedPlate) : null);
    const fleetRow = fleetContext?.row || null;
    const groupKey = fleetRow ? `matched::${fleetRow.accountId}::${fleetRow.id}` : `unmatched::${snapshot.normalizedPlate || snapshot.jobOrderId}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { fleetContext, items: [] });
    }
    groups.get(groupKey).items.push(snapshot);
  }

  const rows = [];
  for (const [groupKey, group] of groups.entries()) {
    const activeItems = group.items.filter(function (item) { return item.active; });
    const inactiveItems = group.items.filter(function (item) { return !item.active; });
    const headline = chooseHeadlineSnapshot(
      activeItems.length ? activeItems : inactiveItems,
      group.fleetContext?.row || null,
      group.fleetContext?.unitState || null,
      tmsConfig,
      now,
    );
    if (!headline) {
      continue;
    }
    const incidents = headline.incidents || [];
    const shippingStatus = buildTripMonitorShippingStatus(
      headline.item,
      group.fleetContext?.row || null,
      tmsConfig,
      now,
    );
    let severity = 'normal';
    let boardStatus = 'normal';
    let unmatchedReason = '';
    if (!group.fleetContext?.row) {
      severity = 'unmatched';
      boardStatus = 'unmatched';
      unmatchedReason = 'Nopol TMS tidak cocok dengan unit Solofleet yang terkonfigurasi.';
    } else if (!activeItems.length) {
      severity = 'no-job-order';
      boardStatus = 'no-job-order';
    } else if (incidents.some(function (incident) { return incident.severity === 'critical'; })) {
      severity = 'critical';
      boardStatus = 'critical';
    } else if (incidents.length) {
      severity = 'warning';
      boardStatus = 'warning';
    }

    const driver = (headline.item.driverAssign || [])[0] || null;
    rows.push({
      rowId: `${headline.item.day}|${groupKey}`,
      day: headline.item.day,
      tenantLabel: headline.item.tenantLabel || '',
      customerName: headline.item.customerName || '',
      unitKey: group.fleetContext?.row ? `${group.fleetContext.row.accountId}::${group.fleetContext.row.id}` : (headline.item.normalizedPlate || groupKey),
      unitId: group.fleetContext?.row?.id || '',
      unitLabel: group.fleetContext?.row?.alias || group.fleetContext?.row?.label || headline.item.plateRaw || headline.item.unitLabel || '',
      normalizedPlate: headline.item.normalizedPlate || '',
      severity,
      boardStatus,
      jobOrderId: headline.item.jobOrderId,
      jobOrderCount: group.items.length,
      originName: headline.item.originName || '',
      destinationName: headline.item.destinationName || '',
      tempMin: headline.item.tempMin,
      tempMax: headline.item.tempMax,
      etaOrigin: headline.item.etaOrigin,
      etaDestination: headline.item.etaDestination,
      driverAppStatus: [driver?.assignment_status, driver?.driver_status, driver?.job_offer_status].filter(Boolean).join(' | ') || '',
      incidentCodes: summarizeIncidentCodes(incidents),
      incidentSummary: incidents.map(function (incident) { return incident.label; }).join(', '),
      shippingStatusLabel: shippingStatus.label,
      shippingStatusChangedAt: shippingStatus.changedAt,
      unmatchedReason,
      metadata: {
        incidents,
        shippingStatus,
        fleetRow: group.fleetContext?.row || null,
        headlineJobOrder: headline.item,
        jobOrders: group.items,
      },
    });
  }

  rows.sort(function (left, right) {
    return severityRank(right.severity) - severityRank(left.severity)
      || String(left.unitLabel || '').localeCompare(String(right.unitLabel || ''));
  });
  return rows;
}

async function replaceTmsJobSnapshots(day, jobSnapshots) {
  if (!getPostgresConfig().enabled) {
    return 0;
  }
  await postgresQuery('delete from tms_job_order_snapshots where day = $1', [day]);
  if (!jobSnapshots.length) {
    return 0;
  }
  return postgresUpsertRows(
    'tms_job_order_snapshots',
    jobSnapshots.map(function (snapshot) {
      return {
        job_order_id: snapshot.jobOrderId,
        day: snapshot.day,
        tenant_label: snapshot.tenantLabel,
        customer_name: snapshot.customerName,
        normalized_plate: snapshot.normalizedPlate,
        plate_raw: snapshot.plateRaw,
        unit_label: snapshot.unitLabel,
        job_order_status: snapshot.jobOrderStatus,
        workflow_state: snapshot.workflowState,
        origin_name: snapshot.originName,
        destination_name: snapshot.destinationName,
        temp_min: snapshot.tempMin,
        temp_max: snapshot.tempMax,
        eta_origin: snapshot.etaOrigin ? new Date(snapshot.etaOrigin).toISOString() : null,
        eta_destination: snapshot.etaDestination ? new Date(snapshot.etaDestination).toISOString() : null,
        active: snapshot.active,
        task_list: snapshot.taskList,
        workflow_lines: snapshot.workflowLines,
        driver_assign: snapshot.driverAssign,
        raw_doc: snapshot.rawDoc,
        updated_at: new Date().toISOString(),
      };
    }),
    ['job_order_id', 'day', 'tenant_label', 'customer_name', 'normalized_plate', 'plate_raw', 'unit_label', 'job_order_status', 'workflow_state', 'origin_name', 'destination_name', 'temp_min', 'temp_max', 'eta_origin', 'eta_destination', 'active', 'task_list', 'workflow_lines', 'driver_assign', 'raw_doc', 'updated_at'],
    ['job_order_id'],
    { touchUpdatedAt: false },
  );
}

async function replaceTmsMonitorRows(day, rows) {
  if (!getPostgresConfig().enabled) {
    return 0;
  }
  await postgresQuery('delete from tms_monitor_rows where day = $1', [day]);
  if (!rows.length) {
    return 0;
  }
  return postgresUpsertRows(
    'tms_monitor_rows',
    rows.map(function (row) {
      return {
        row_id: row.rowId,
        day: row.day,
        tenant_label: row.tenantLabel,
        customer_name: row.customerName,
        unit_key: row.unitKey,
        unit_id: row.unitId,
        unit_label: row.unitLabel,
        normalized_plate: row.normalizedPlate,
        severity: row.severity,
        board_status: row.boardStatus,
        job_order_id: row.jobOrderId,
        job_order_count: row.jobOrderCount,
        origin_name: row.originName,
        destination_name: row.destinationName,
        temp_min: row.tempMin,
        temp_max: row.tempMax,
        eta_origin: row.etaOrigin ? new Date(row.etaOrigin).toISOString() : null,
        eta_destination: row.etaDestination ? new Date(row.etaDestination).toISOString() : null,
        driver_app_status: row.driverAppStatus,
        incident_codes: row.incidentCodes,
        incident_summary: row.incidentSummary,
        unmatched_reason: row.unmatchedReason,
        metadata: row.metadata || {},
        updated_at: new Date().toISOString(),
      };
    }),
    ['row_id', 'day', 'tenant_label', 'customer_name', 'unit_key', 'unit_id', 'unit_label', 'normalized_plate', 'severity', 'board_status', 'job_order_id', 'job_order_count', 'origin_name', 'destination_name', 'temp_min', 'temp_max', 'eta_origin', 'eta_destination', 'driver_app_status', 'incident_codes', 'incident_summary', 'unmatched_reason', 'metadata', 'updated_at'],
    ['row_id'],
    { touchUpdatedAt: false },
  );
}

async function replaceTmsSnapshotWindow(window, jobSnapshots, rows) {
  if (!getPostgresConfig().enabled) {
    return { snapshotsSaved: 0, rowsSaved: 0 };
  }
  await postgresQuery('delete from tms_job_order_snapshots where day >= $1 and day <= $2', [window.startDay, window.endDay]);
  await postgresQuery('delete from tms_monitor_rows where day >= $1 and day <= $2', [window.startDay, window.endDay]);

  let snapshotsSaved = 0;
  let rowsSaved = 0;
  if (jobSnapshots.length) {
    snapshotsSaved = await postgresUpsertRows(
      'tms_job_order_snapshots',
      jobSnapshots.map(function (snapshot) {
        return {
          job_order_id: snapshot.jobOrderId,
          day: snapshot.day,
          tenant_label: snapshot.tenantLabel,
          customer_name: snapshot.customerName,
          normalized_plate: snapshot.normalizedPlate,
          plate_raw: snapshot.plateRaw,
          unit_label: snapshot.unitLabel,
          job_order_status: snapshot.jobOrderStatus,
          workflow_state: snapshot.workflowState,
          origin_name: snapshot.originName,
          destination_name: snapshot.destinationName,
          temp_min: snapshot.tempMin,
          temp_max: snapshot.tempMax,
          eta_origin: snapshot.etaOrigin ? new Date(snapshot.etaOrigin).toISOString() : null,
          eta_destination: snapshot.etaDestination ? new Date(snapshot.etaDestination).toISOString() : null,
          active: snapshot.active,
          task_list: snapshot.taskList,
          workflow_lines: snapshot.workflowLines,
          driver_assign: snapshot.driverAssign,
          raw_doc: snapshot.rawDoc,
          updated_at: new Date().toISOString(),
        };
      }),
      ['job_order_id', 'day', 'tenant_label', 'customer_name', 'normalized_plate', 'plate_raw', 'unit_label', 'job_order_status', 'workflow_state', 'origin_name', 'destination_name', 'temp_min', 'temp_max', 'eta_origin', 'eta_destination', 'active', 'task_list', 'workflow_lines', 'driver_assign', 'raw_doc', 'updated_at'],
      ['job_order_id'],
      { touchUpdatedAt: false },
    );
  }
  if (rows.length) {
    rowsSaved = await postgresUpsertRows(
      'tms_monitor_rows',
      rows.map(function (row) {
        return {
          row_id: row.rowId,
          day: row.day,
          tenant_label: row.tenantLabel,
          customer_name: row.customerName,
          unit_key: row.unitKey,
          unit_id: row.unitId,
          unit_label: row.unitLabel,
          normalized_plate: row.normalizedPlate,
          severity: row.severity,
          board_status: row.boardStatus,
          job_order_id: row.jobOrderId,
          job_order_count: row.jobOrderCount,
          origin_name: row.originName,
          destination_name: row.destinationName,
          temp_min: row.tempMin,
          temp_max: row.tempMax,
          eta_origin: row.etaOrigin ? new Date(row.etaOrigin).toISOString() : null,
          eta_destination: row.etaDestination ? new Date(row.etaDestination).toISOString() : null,
          driver_app_status: row.driverAppStatus,
          incident_codes: row.incidentCodes,
          incident_summary: row.incidentSummary,
          unmatched_reason: row.unmatchedReason,
          metadata: row.metadata || {},
          updated_at: new Date().toISOString(),
        };
      }),
      ['row_id', 'day', 'tenant_label', 'customer_name', 'unit_key', 'unit_id', 'unit_label', 'normalized_plate', 'severity', 'board_status', 'job_order_id', 'job_order_count', 'origin_name', 'destination_name', 'temp_min', 'temp_max', 'eta_origin', 'eta_destination', 'driver_app_status', 'incident_codes', 'incident_summary', 'unmatched_reason', 'metadata', 'updated_at'],
      ['row_id'],
      { touchUpdatedAt: false },
    );
  }
  return { snapshotsSaved, rowsSaved };
}

async function syncTmsMonitor(options) {
  const runtime = getTmsConfig();
  if (!runtime.baseUrl) {
    throw new Error('TMS belum dikonfigurasi.');
  }
  if (!getPostgresConfig().enabled) {
    throw new Error('PostgreSQL wajib aktif untuk TMS monitor.');
  }

  const now = Date.now();
  const window = buildTmsMonitorWindow(now);
  const listRows = await fetchTmsJobOrderList(window);
  const docs = [];
  for (const item of listRows) {
    const jobOrderId = String(item.name || item.job_order_id || '').trim();
    if (!jobOrderId) continue;
    docs.push(await fetchTmsJobOrderDoc(jobOrderId));
  }
  const addressNames = [...new Set(docs.flatMap(function (doc) {
    return collectTmsAddressNamesFromDoc(doc);
  }))];
  const resolvedAddresses = await resolveTmsAddressEntries(addressNames, runtime.tenantLabel);
  const jobSnapshots = docs.map(function (doc) {
    return buildTmsJobSnapshotFromDoc(doc, runtime.tenantLabel, resolvedAddresses.byKey);
  }).filter(function (snapshot) {
    return snapshot.day >= window.startDay && snapshot.day <= window.endDay;
  });
  const fleetIndex = buildFleetPlateIndex(now);
  const monitorRows = buildTmsMonitorRows(jobSnapshots, fleetIndex, runtime, now);
  const saveResult = await replaceTmsSnapshotWindow(window, jobSnapshots, monitorRows);

  const fetchedCount = jobSnapshots.length;
  const matchedCount = monitorRows.filter(function (row) { return row.severity !== 'unmatched'; }).length;
  const unmatchedCount = monitorRows.filter(function (row) { return row.severity === 'unmatched'; }).length;
  const criticalCount = monitorRows.filter(function (row) { return row.severity === 'critical'; }).length;
  const warningCount = monitorRows.filter(function (row) { return row.severity === 'warning'; }).length;
  const normalCount = monitorRows.filter(function (row) { return row.severity === 'normal'; }).length;
  const noJobOrderCount = monitorRows.filter(function (row) { return row.severity === 'no-job-order'; }).length;
  console.log(`[TMS] Sync ${window.startDay}..${window.endDay}: fetched ${fetchedCount} JO | matched ${matchedCount} | unmatched ${unmatchedCount} | critical ${criticalCount} | warning ${warningCount} | normal ${normalCount} | no-jo ${noJobOrderCount} | addr ok ${resolvedAddresses.stats.resolved} | addr miss ${resolvedAddresses.stats.missing}`);
  if (unmatchedCount > 0) {
    const unmatchedPreview = monitorRows
      .filter(function (row) { return row.severity === 'unmatched'; })
      .slice(0, 5)
      .map(function (row) { return row.unitLabel || row.normalizedPlate || row.jobOrderId || row.rowId; })
      .join(', ');
    console.warn(`[TMS] Unmatched preview ${window.endDay}: ${unmatchedPreview}`);
  }
  const logEntry = await appendTmsSyncLog({
    status: 'success',
    fetchedCount,
    matchedCount,
    unmatchedCount,
    criticalCount,
    warningCount,
    normalCount,
    noJobOrderCount,
    message: `TMS sync fetched ${fetchedCount} JO dalam window ${window.startDay} - ${window.endDay}.`,
    details: {
      day: window.endDay,
      windowStart: window.startDay,
      windowEnd: window.endDay,
      fetchedCount,
      snapshotsSaved: saveResult.snapshotsSaved || 0,
      rowsSaved: saveResult.rowsSaved || 0,
      customers: [...new Set(jobSnapshots.map(function (item) { return item.customerName; }).filter(Boolean))],
      statuses: TMS_INCLUDED_JOB_ORDER_STATUSES,
      addressResolvedCount: resolvedAddresses.stats.resolved,
      addressMissCount: resolvedAddresses.stats.missing,
      addressRefreshCount: resolvedAddresses.stats.refreshed,
    },
  });
  scheduleNextTmsSync();
  return { ok: true, day: window.endDay, windowStart: window.startDay, windowEnd: window.endDay, fetchedCount, rowsSaved: saveResult.rowsSaved || 0, log: logEntry };
}

function scheduleNextTmsSync() {
  if (tmsSyncTimer) {
    clearTimeout(tmsSyncTimer);
    tmsSyncTimer = null;
  }
  const runtime = getTmsConfig();
  if (!runtime.autoSync || !hasTmsCredentials(runtime)) {
    return;
  }
  const intervalMs = Math.max(5, Number(runtime.syncIntervalMinutes || DEFAULT_TMS_CONFIG.syncIntervalMinutes)) * 60 * 1000;
  const delayMs = isFirstTmsSyncSchedule ? Math.min(intervalMs, 15000) : intervalMs;
  isFirstTmsSyncSchedule = false;
  tmsSyncTimer = setTimeout(function () {
    syncTmsMonitor().catch(function (error) {
      appendTmsSyncLog({
        status: 'error',
        message: error?.message || 'TMS auto-sync gagal.',
        details: {},
      }).catch(function () {});
    }).finally(scheduleNextTmsSync);
  }, delayMs);
}

async function findLatestTmsMonitorDay() {
  const result = await postgresQuery(
    `select day::text as day
     from tms_monitor_rows
     order by day desc
     limit 1`,
    [],
  );
  return result.rows[0] ? String(result.rows[0].day || '') : '';
}

async function listTmsMonitorRows(searchParams) {
  const window = buildTmsMonitorWindow(Date.now());
  const now = Date.now();
  const fleetIndex = buildFleetPlateIndex(now);
  const tmsRuntime = getTmsConfig();
  const params = [window.startDay, window.endDay];
  let query = `select row_id, day::text as day, tenant_label, customer_name, unit_key, unit_id, unit_label, normalized_plate, severity, board_status, job_order_id, job_order_count, origin_name, destination_name, temp_min, temp_max, eta_origin, eta_destination, driver_app_status, incident_codes, incident_summary, unmatched_reason, metadata, updated_at from tms_monitor_rows where day >= $1 and day <= $2`;
  const customer = String(searchParams.get('customer') || '').trim();
  if (customer) {
    params.push(customer);
    query += ` and customer_name = $${params.length}`;
  }
  const severity = String(searchParams.get('severity') || '').trim();
  if (severity && severity !== 'all') {
    params.push(severity);
    query += ` and severity = $${params.length}`;
  }
  query += ` order by day desc, updated_at desc`;
  const result = await postgresQuery(query, params);
  return result.rows.map(function (row) {
    return refreshTripMonitorStoredRow({
      rowId: row.row_id,
      day: String(row.day || ''),
      tenantLabel: String(row.tenant_label || ''),
      customerName: String(row.customer_name || ''),
      unitKey: String(row.unit_key || ''),
      unitId: String(row.unit_id || ''),
      unitLabel: String(row.unit_label || ''),
      normalizedPlate: String(row.normalized_plate || ''),
      severity: String(row.severity || 'normal'),
      boardStatus: String(row.board_status || 'normal'),
      jobOrderId: String(row.job_order_id || ''),
      jobOrderCount: Number(row.job_order_count || 0),
      originName: String(row.origin_name || ''),
      destinationName: String(row.destination_name || ''),
      tempMin: toNumber(row.temp_min),
      tempMax: toNumber(row.temp_max),
      etaOrigin: row.eta_origin ? Date.parse(row.eta_origin) : null,
      etaDestination: row.eta_destination ? Date.parse(row.eta_destination) : null,
      driverAppStatus: String(row.driver_app_status || ''),
      incidentCodes: Array.isArray(row.incident_codes) ? row.incident_codes : [],
      incidentSummary: String(row.incident_summary || ''),
      unmatchedReason: String(row.unmatched_reason || ''),
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    }, fleetIndex, tmsRuntime, now);
  });
}

function buildTmsMonitorSummary(rows, logs, meta) {
  const summary = {
    total: rows.length,
    bySeverity: {
      critical: 0,
      warning: 0,
      normal: 0,
      unmatched: 0,
      'no-job-order': 0,
    },
    byIncident: {},
    customers: [...new Set(rows.map(function (row) { return row.customerName; }).filter(Boolean))].sort(),
    lastSync: logs[0] || null,
    windowStart: String(meta?.windowStart || ''),
    windowEnd: String(meta?.windowEnd || ''),
    autoSync: Boolean(meta?.autoSync),
    syncIntervalMinutes: Number(meta?.syncIntervalMinutes || 0),
  };
  for (const row of rows) {
    if (summary.bySeverity[row.severity] !== undefined) {
      summary.bySeverity[row.severity] += 1;
    }
    for (const code of row.incidentCodes || []) {
      summary.byIncident[code] = (summary.byIncident[code] || 0) + 1;
    }
  }
  return summary;
}

function buildStatusPayload(sessionUser) {
  const now = Date.now();
  const isAdminSession = sessionUser?.role === 'admin';
  const accountSummaries = [];
  const fleetRows = [];
  const liveAlerts = [];
  const podSnapshots = [];

  for (const accountConfig of getAllAccountConfigs()) {
    const accountState = ensureAccountState(accountConfig.id);
    syncFleetSnapshotRecords(accountConfig, accountState, now);
    captureDailyErrorSnapshots(accountConfig, accountState);
    const accountLiveAlerts = buildLiveAlerts(accountConfig, accountState, now);
    const accountFleetRows = annotateFleetRowsWithPods(accountConfig, buildFleetRows(accountConfig, accountState, now, accountLiveAlerts));
    const accountPodSnapshots = accountState.podSnapshots || [];

    fleetRows.push(...accountFleetRows);
    liveAlerts.push(...accountLiveAlerts);
    podSnapshots.push(...accountPodSnapshots);
    accountSummaries.push({
      id: accountConfig.id,
      label: accountConfig.label,
      authEmail: accountConfig.authEmail,
      unitCount: accountConfig.units.length,
      liveAlertCount: accountLiveAlerts.length,
      lastSnapshotAt: accountState.runtime.lastSnapshotAt,
      lastSnapshotError: accountState.runtime.lastSnapshotError,
      fleetFetchedAt: accountState.fleet.fetchedAt,
      hasSessionCookie: Boolean(accountConfig.sessionCookie),
    });
  }

  const astroAnnotatedRows = astroCore.annotateFleetRowsWithAstro(fleetRows, config.astroRoutes || [], config.astroLocations || []);

  astroAnnotatedRows.sort(function (left, right) {
    return String(left.accountLabel || left.accountId).localeCompare(String(right.accountLabel || right.accountId))
      || String(left.label || left.id).localeCompare(String(right.label || right.id));
  });
  liveAlerts.sort(function (left, right) {
    return (right.endTimestamp || 0) - (left.endTimestamp || 0);
  });
  podSnapshots.sort(function (left, right) {
    return (right.timestamp || 0) - (left.timestamp || 0);
  });

  const clientConfig = isAdminSession
    ? sanitizeConfigForClient()
    : {
        activeAccountId: config.activeAccountId,
        pollIntervalSeconds: config.pollIntervalSeconds,
        requestIntervalSeconds: config.requestIntervalSeconds,
        accounts: accountSummaries.map(function (account) {
          return {
            id: account.id,
            label: account.label,
            authEmail: account.authEmail,
            hasSessionCookie: account.hasSessionCookie,
            hasVerifiedSession: account.hasSessionCookie,
            sessionCookiePreview: null,
            vehicleRoleId: '',
            units: [],
            customerProfiles: [],
            podSites: [],
          };
        }),
        customerProfiles: [],
        podSites: [],
        astroLocations: [],
        astroRoutes: [],
      };

  return {
    now,
    config: clientConfig,
    runtime: {
      ...state.runtime,
      pollInFlight,
      unitCount: astroAnnotatedRows.length,
      liveAlertCount: liveAlerts.length,
      accountCount: getAllAccountConfigs().length,
    },
    accounts: accountSummaries,
    overview: buildOverview(astroAnnotatedRows, liveAlerts, accountSummaries),
    autoFilterCards: [
      {
        id: 'temp-error',
        label: 'Temp error',
        count: astroAnnotatedRows.filter(function (row) { return row.hasLiveSensorFault; }).length,
        description: 'Unit yang live temp sensor-nya sedang 0',
      },
      {
        id: 'setpoint',
        label: 'Setpoint mismatch',
        count: astroAnnotatedRows.filter(function (row) { return row.outsideSetpoint; }).length,
        description: 'Suhu live di luar min/max customer',
      },
      {
        id: 'gps-late',
        label: 'GPS late > 30 min',
        count: astroAnnotatedRows.filter(function (row) { return row.minutesSinceUpdate !== null && row.minutesSinceUpdate > 30; }).length,
        description: 'Update GPS telat lebih dari 30 menit',
      },
    ],
    fleet: {
      fetchedAt: state.runtime.lastSnapshotAt,
      lastError: state.runtime.lastSnapshotError,
      rows: astroAnnotatedRows,
    },
    liveAlerts,
    podSnapshots,
    units: astroAnnotatedRows,
    remoteReset: isAdminSession ? buildRemoteResetStatusPayload() : null,
    webAuth: buildWebAuthConfigForClient(sessionUser),
  };
}

function shouldRefreshFleetSnapshot(accountConfig, accountState, now) {
  if (!accountConfig.sessionCookie || pollInFlight) {
    return false;
  }

  const vehicles = accountState.fleet?.vehicles || {};
  const vehicleCount = Object.keys(vehicles).length;
  if (!vehicleCount) {
    return true;
  }

  const fetchedAtMs = toTimestampMaybe(accountState.fleet?.fetchedAt);
  if (fetchedAtMs === null) {
    return true;
  }

  const refreshAfterMs = Math.max(30 * 1000, config.pollIntervalSeconds * 1000);
  return now - fetchedAtMs >= refreshAfterMs;
}

function buildLiveAlerts(accountConfig, accountState, now) {
  const freshnessMs = Math.max(
    10 * 60 * 1000,
    config.pollIntervalSeconds * 3 * 1000,
    config.requestIntervalSeconds * 2 * 1000,
  );

  const liveAlerts = [];
  const seenKeys = new Set();
  for (const [unitId, unitState] of Object.entries(accountState.units)) {
    const analysis = unitState.analysis || buildAnalysisFromRecords(unitState);
    for (const incident of analysis.incidents) {
      if (incident.endTimestamp < now - freshnessMs) {
        continue;
      }
      const alert = {
        ...incident,
        accountId: accountConfig.id,
        accountLabel: accountConfig.label,
        unitId,
        unitLabel: unitState.label,
        rowKey: accountConfig.id + '::' + unitId,
        isCurrent: true,
      };
      liveAlerts.push(alert);
      seenKeys.add(unitId + '|' + incident.type);
    }
  }

  for (const alert of buildCurrentFleetSensorAlerts(accountConfig, accountState, now)) {
    const key = alert.unitId + '|' + alert.type;
    if (seenKeys.has(key)) {
      continue;
    }
    liveAlerts.push(alert);
  }

  liveAlerts.sort(function (left, right) {
    return right.endTimestamp - left.endTimestamp;
  });

  return liveAlerts;
}

function parseSolofleetDateInputStart(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0) - (SOLOFLEET_UTC_OFFSET_MINUTES * 60 * 1000);
}

function parseSolofleetDateInputEnd(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999) - (SOLOFLEET_UTC_OFFSET_MINUTES * 60 * 1000);
}

function parseDateRange(searchParams) {
  const startValue = searchParams.get('startDate') || searchParams.get('start');
  const endValue = searchParams.get('endDate') || searchParams.get('end');
  return {
    rangeStartMs: parseSolofleetDateInputStart(startValue),
    rangeEndMs: parseSolofleetDateInputEnd(endValue),
  };
}

function localEndOfDay(timestamp) {
  const date = toSolofleetLocalDate(timestamp);
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }
  date.setUTCHours(23, 59, 59, 999);
  return date.getTime() - (SOLOFLEET_UTC_OFFSET_MINUTES * 60 * 1000);
}

function clipIncidentToRange(incident, rangeStartMs, rangeEndMs) {
  const rawStart = incident.clippedStart ?? incident.startTimestamp ?? null;
  const rawEnd = incident.clippedEnd ?? incident.endTimestamp ?? rawStart;
  if (rawStart === null || rawEnd === null) {
    return null;
  }

  const start = rangeStartMs === null ? rawStart : Math.max(rawStart, rangeStartMs);
  const end = rangeEndMs === null ? rawEnd : Math.min(rawEnd, rangeEndMs);
  if (start > end) {
    return null;
  }

  return { start, end };
}

function buildTempErrorIncidents(alerts, rangeStartMs, rangeEndMs) {
  const rows = new Map();

  for (const incident of alerts || []) {
    const clipped = clipIncidentToRange(incident, rangeStartMs, rangeEndMs);
    if (!clipped) {
      continue;
    }

    let segmentStart = clipped.start;
    while (segmentStart <= clipped.end) {
      const segmentEnd = Math.min(localEndOfDay(segmentStart), clipped.end);
      const day = formatLocalDay(segmentStart);
      const key = `${day}|${incident.accountId || 'primary'}|${incident.unitId || incident.vehicle}`;
      if (!rows.has(key)) {
        rows.set(key, {
          day,
          accountId: incident.accountId || 'primary',
          accountLabel: incident.accountLabel || incident.accountId || 'primary',
          unitId: incident.unitId || incident.vehicle,
          unitLabel: incident.unitLabel || incident.vehicle,
          vehicle: incident.vehicle || incident.unitLabel || incident.unitId || '',
          incidents: 0,
          temp1Incidents: 0,
          temp2Incidents: 0,
          bothIncidents: 0,
          firstStartTimestamp: segmentStart,
          lastEndTimestamp: segmentEnd,
          totalMinutes: 0,
          longestMinutes: 0,
          temp1Min: null,
          temp1Max: null,
          temp2Min: null,
          temp2Max: null,
          minSpeed: null,
          maxSpeed: null,
          latitude: incident.latitude ?? null,
          longitude: incident.longitude ?? null,
          locationSummary: incident.locationSummary || '',
          zoneName: incident.zoneName || '',
        });
      }

      const row = rows.get(key);
      const segmentMinutes = Number(((segmentEnd - segmentStart) / 60000).toFixed(2));
      row.incidents += 1;
      row.firstStartTimestamp = Math.min(row.firstStartTimestamp, segmentStart);
      row.lastEndTimestamp = Math.max(row.lastEndTimestamp, segmentEnd);
      row.totalMinutes += segmentMinutes;
      row.longestMinutes = Math.max(row.longestMinutes, segmentMinutes);
      row.latitude = row.latitude ?? incident.latitude ?? null;
      row.longitude = row.longitude ?? incident.longitude ?? null;
      row.locationSummary = row.locationSummary || incident.locationSummary || '';
      row.zoneName = row.zoneName || incident.zoneName || '';
      if (incident.type === 'temp1') {
        row.temp1Incidents += 1;
      } else if (incident.type === 'temp2') {
        row.temp2Incidents += 1;
      } else if (incident.type === 'temp1+temp2') {
        row.bothIncidents += 1;
      }
      if (incident.temp1Min !== null && incident.temp1Min !== undefined) {
        row.temp1Min = row.temp1Min === null ? incident.temp1Min : Math.min(row.temp1Min, incident.temp1Min);
      }
      if (incident.temp1Max !== null && incident.temp1Max !== undefined) {
        row.temp1Max = row.temp1Max === null ? incident.temp1Max : Math.max(row.temp1Max, incident.temp1Max);
      }
      if (incident.temp2Min !== null && incident.temp2Min !== undefined) {
        row.temp2Min = row.temp2Min === null ? incident.temp2Min : Math.min(row.temp2Min, incident.temp2Min);
      }
      if (incident.temp2Max !== null && incident.temp2Max !== undefined) {
        row.temp2Max = row.temp2Max === null ? incident.temp2Max : Math.max(row.temp2Max, incident.temp2Max);
      }
      if (incident.minSpeed !== null && incident.minSpeed !== undefined) {
        row.minSpeed = row.minSpeed === null ? incident.minSpeed : Math.min(row.minSpeed, incident.minSpeed);
      }
      if (incident.maxSpeed !== null && incident.maxSpeed !== undefined) {
        row.maxSpeed = row.maxSpeed === null ? incident.maxSpeed : Math.max(row.maxSpeed, incident.maxSpeed);
      }
      segmentStart = segmentEnd + 1;
    }
  }

  return [...rows.values()].map(function (row) {
    const type = row.bothIncidents > 0 || (row.temp1Incidents > 0 && row.temp2Incidents > 0)
      ? 'temp1+temp2'
      : row.temp1Incidents > 0
        ? 'temp1'
        : 'temp2';
    return {
      ...row,
      type,
      label: sensorFaultLabel(type),
      startTime: formatLocalTime(row.firstStartTimestamp),
      endTime: formatLocalTime(row.lastEndTimestamp),
      durationMinutes: Number(row.totalMinutes.toFixed(2)),
      longestMinutes: Number(row.longestMinutes.toFixed(2)),
    };
  }).sort(function (left, right) {
    return (right.firstStartTimestamp || 0) - (left.firstStartTimestamp || 0)
      || String(left.accountLabel || left.accountId).localeCompare(String(right.accountLabel || right.accountId))
      || String(left.unitLabel || left.unitId).localeCompare(String(right.unitLabel || right.unitId));
  });
}
async function buildReportPayload(searchParams) {
  const range = parseDateRange(searchParams);
  const incidents = [];
  const localSnapshotRows = [];
  const podRows = [];

  for (const accountConfig of getAllAccountConfigs()) {
    const accountState = ensureAccountState(accountConfig.id);
    syncFleetSnapshotRecords(accountConfig, accountState, Date.now());
    captureDailyErrorSnapshots(accountConfig, accountState);
    try {
      await upsertDailyTempSnapshotsToSupabase(accountConfig, accountState);
      await upsertPodSnapshotsToSupabase(accountConfig, accountState);
    } catch (error) {
      accountState.runtime.lastSnapshotError = error.message;
    }
    incidents.push(...buildCurrentFleetSensorAlerts(accountConfig, accountState, Date.now()));
    incidents.push(...Object.entries(accountState.units).flatMap(function ([unitId, unitState]) {
      return (unitState.analysis ? unitState.analysis.incidents : []).map(function (incident) {
        const snapshot = accountState.fleet.vehicles[normalizeUnitKey(unitId)] || null;
        return {
          ...incident,
          accountId: accountConfig.id,
          accountLabel: accountConfig.label,
          unitId,
          unitLabel: unitState.label,
          latitude: snapshot?.latitude ?? null,
          longitude: snapshot?.longitude ?? null,
          locationSummary: snapshot?.locationSummary || '',
          zoneName: snapshot?.zoneName || '',
        };
      });
    }));
    localSnapshotRows.push(...buildDailySnapshotRows(accountState, range.rangeStartMs, range.rangeEndMs));
    podRows.push(...buildPodSnapshotRows(accountState, range.rangeStartMs, range.rangeEndMs));
  }

  const summary = core.summarizeIncidents(incidents, range.rangeStartMs, range.rangeEndMs);
  let snapshotRows = localSnapshotRows;
  let snapshotAnalytics = buildSnapshotReportAggregates(localSnapshotRows);
  try {
    const supabaseRows = await loadDailyTempSnapshotsFromSupabase(range.rangeStartMs, range.rangeEndMs);
    if (supabaseRows.length) {
      const mergedCompactRows = mergeCompactTempErrorRows(supabaseRows, snapshotAnalytics.tempErrorIncidents);
      snapshotAnalytics = buildSnapshotReportAggregatesFromCompactRows(mergedCompactRows);
      snapshotRows = snapshotAnalytics.tempErrorIncidents;
    }
    const supabasPodRows = await loadPodSnapshotsFromSupabase(range.rangeStartMs, range.rangeEndMs);
    if (supabasPodRows.length) {
      podRows.length = 0;
      podRows.push(...supabasPodRows);
    }
  } catch (error) {
    state.runtime.lastSnapshotError = error.message;
  }

  snapshotRows.sort(function (left, right) { return ((right.firstStartTimestamp || right.errorTimestamp || 0) - (left.firstStartTimestamp || left.errorTimestamp || 0)); });
  podRows.sort(function (left, right) { return (right.timestamp || 0) - (left.timestamp || 0); });
  return {
    now: Date.now(),
    rangeStartMs: range.rangeStartMs,
    rangeEndMs: range.rangeEndMs,
    ...summary,
    dailyTotals: snapshotAnalytics.dailyTotals,
    compileByDay: snapshotAnalytics.compileByDay,
    compileByUnitDay: snapshotAnalytics.compileByUnitDay,
    tempErrorIncidents: snapshotAnalytics.tempErrorIncidents,
    rawAlerts: snapshotRows,
    dailySnapshots: snapshotRows,
    podSnapshots: podRows,
    alerts: snapshotRows,
  };
}

function buildAstroConfigPayload() {
  const accountSummaries = getAllAccountConfigs().map(function (account) {
    return {
      id: account.id,
      label: account.label,
      authEmail: account.authEmail,
      hasSessionCookie: Boolean(account.sessionCookie),
      units: account.units || [],
    };
  });

  const routeUnits = accountSummaries.flatMap(function (account) {
    return (account.units || []).map(function (unit) {
      return {
        accountId: account.id,
        accountLabel: account.label,
        id: unit.id,
        label: unit.label,
      };
    });
  });

  return {
    ok: true,
    locations: config.astroLocations || [],
    routes: config.astroRoutes || [],
    accounts: accountSummaries,
    units: routeUnits,
  };
}

function validateAstroLocations(locations) {
  const seen = new Set();
  return (locations || []).map(function (item) {
    const normalized = astroCore.normalizeAstroLocation(item);
    if (!normalized) {
      throw new Error('Astro location invalid. Nama, latitude, longitude, radius, dan type wajib valid.');
    }
    if (seen.has(normalized.id)) {
      throw new Error('Astro location id duplicate: ' + normalized.id);
    }
    seen.add(normalized.id);
    return normalized;
  });
}

function resolveAccountLabel(accountId) {
  const account = getAllAccountConfigs().find(function (item) {
    return item.id === (accountId || 'primary');
  });
  return account?.label || account?.authEmail || accountId || 'primary';
}

function inferDailySnapshotEndTimestamp(snapshot) {
  const start = toTimestampMaybe(snapshot?.errorTimestamp);
  const durationMinutes = Number(snapshot?.durationMinutes || 0);
  if (start === null) {
    return null;
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return start;
  }
  return start + (durationMinutes * 60 * 1000);
}

function buildDailyTempCompactRows(accountConfig, accountState) {
  const sourceRows = Array.isArray(accountState?.dailySnapshots) ? accountState.dailySnapshots : [];
  if (!sourceRows.length) {
    return [];
  }

  const analytics = buildSnapshotReportAggregates(sourceRows);
  return (analytics.tempErrorIncidents || []).map(function (row) {
    return {
      id: row.day + '|' + (row.accountId || accountConfig.id || 'primary') + '|' + (row.unitId || row.vehicle || 'unit'),
      day: row.day,
      accountId: row.accountId || accountConfig.id || 'primary',
      accountLabel: row.accountLabel || accountConfig.label || accountConfig.id,
      unitId: row.unitId || row.vehicle,
      unitLabel: row.unitLabel || row.vehicle || row.unitId,
      vehicle: row.vehicle || row.unitLabel || row.unitId,
      type: row.type || 'temp1',
      label: row.label || sensorFaultLabel(row.type),
      incidents: Number(row.incidents || 0),
      temp1Incidents: Number(row.temp1Incidents || 0),
      temp2Incidents: Number(row.temp2Incidents || 0),
      bothIncidents: Number(row.bothIncidents || 0),
      firstStartTimestamp: row.firstStartTimestamp || null,
      lastEndTimestamp: row.lastEndTimestamp || null,
      durationMinutes: Number(row.durationMinutes || row.totalMinutes || 0),
      totalMinutes: Number(row.totalMinutes || 0),
      longestMinutes: Number(row.longestMinutes || 0),
      temp1Min: row.temp1Min ?? null,
      temp1Max: row.temp1Max ?? null,
      temp2Min: row.temp2Min ?? null,
      temp2Max: row.temp2Max ?? null,
      minSpeed: row.minSpeed ?? null,
      maxSpeed: row.maxSpeed ?? null,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      locationSummary: row.locationSummary || '',
      zoneName: row.zoneName || '',
    };
  });
}

async function migrateWebUsersToPostgres(users) {
  if (!getPostgresConfig().enabled) {
    return 0;
  }
  const normalizedUsers = (users || []).map(normalizeWebUser).filter(Boolean);
  if (!normalizedUsers.length) {
    return 0;
  }
  await ensurePostgresSchema();
  return postgresUpsertRows(
    'dashboard_web_users',
    normalizedUsers.map(function (user) {
      return {
        id: user.id,
        username: user.username,
        display_name: user.displayName,
        password_hash: user.passwordHash,
        role: user.role,
        is_active: user.isActive,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      };
    }),
    ['id', 'username', 'display_name', 'password_hash', 'role', 'is_active', 'created_at', 'updated_at'],
    ['id'],
    { touchUpdatedAt: true },
  );
}

async function countRowsInPostgres(tableName) {
  if (!getPostgresConfig().enabled) {
    return 0;
  }
  await ensurePostgresSchema();
  const result = await postgresQuery(`select count(*)::int as count from ${tableName}`);
  return result.rows[0] ? Number(result.rows[0].count || 0) : 0;
}

async function migrateSupabaseDataToPostgres() {
  if (!getPostgresConfig().enabled || !getSupabaseWebAuthConfig().enabled) {
    return;
  }

  try {
    if ((await countRowsInPostgres('dashboard_web_users')) === 0) {
      const users = await supabaseFetchAll('dashboard_web_users?select=id,username,display_name,password_hash,role,is_active,created_at,updated_at&order=username.asc', 500);
      await migrateWebUsersToPostgres(users.map(mapSupabaseWebUser));
    }

    if ((await countRowsInPostgres('pod_snapshots')) === 0) {
      const podRows = await supabaseFetchAll('pod_snapshots?select=id,day,snapshot_timestamp,snapshot_time,unit_id,unit_label,customer_name,pod_id,pod_name,latitude,longitude,speed,distance_meters,location_summary&order=day.desc', 1000);
      if (podRows.length) {
        await postgresUpsertRows(
          'pod_snapshots',
          podRows,
          [
            'id', 'day', 'snapshot_timestamp', 'snapshot_time', 'unit_id', 'unit_label',
            'customer_name', 'pod_id', 'pod_name', 'latitude', 'longitude',
            'speed', 'distance_meters', 'location_summary',
          ],
          ['id'],
        );
      }
    }

    if ((await countRowsInPostgres('daily_temp_rollups')) === 0) {
      const rollupRows = await supabaseFetchAll('daily_temp_rollups?select=id,day,account_id,account_label,unit_id,unit_label,vehicle,error_type,error_label,incidents,temp1_incidents,temp2_incidents,both_incidents,first_start_timestamp,last_end_timestamp,duration_minutes,total_minutes,longest_minutes,temp1_min,temp1_max,temp2_min,temp2_max,min_speed,max_speed,latitude,longitude,location_summary,zone_name&order=day.desc', 1000);
      if (rollupRows.length) {
        await postgresUpsertRows(
          'daily_temp_rollups',
          rollupRows,
          [
            'id', 'day', 'account_id', 'account_label', 'unit_id', 'unit_label', 'vehicle',
            'error_type', 'error_label', 'incidents', 'temp1_incidents', 'temp2_incidents',
            'both_incidents', 'first_start_timestamp', 'last_end_timestamp', 'duration_minutes',
            'total_minutes', 'longest_minutes', 'temp1_min', 'temp1_max', 'temp2_min', 'temp2_max',
            'min_speed', 'max_speed', 'latitude', 'longitude', 'location_summary', 'zone_name',
          ],
          ['id'],
          { touchUpdatedAt: true },
        );
      } else {
        const legacyRows = await supabaseFetchAll('daily_temp_snapshots?select=id,day,error_timestamp,error_time,account_id,account_label,unit_id,unit_label,vehicle,error_type,error_label,duration_minutes,temp1,temp2,speed,latitude,longitude,location_summary,zone_name&order=day.desc', 1000);
        if (legacyRows.length) {
          const compactRows = buildDailyTempCompactRows(
            { id: 'migration', label: 'migration' },
            { dailySnapshots: legacyRows.map(mapSupabaseDailySnapshotRecord) },
          );
          const mappedRows = compactRows.map(mapDailySnapshotToSupabaseRow);
          await postgresUpsertRows(
            'daily_temp_rollups',
            mappedRows,
            [
              'id', 'day', 'account_id', 'account_label', 'unit_id', 'unit_label', 'vehicle',
              'error_type', 'error_label', 'incidents', 'temp1_incidents', 'temp2_incidents',
              'both_incidents', 'first_start_timestamp', 'last_end_timestamp', 'duration_minutes',
              'total_minutes', 'longest_minutes', 'temp1_min', 'temp1_max', 'temp2_min', 'temp2_max',
              'min_speed', 'max_speed', 'latitude', 'longitude', 'location_summary', 'zone_name',
            ],
            ['id'],
            { touchUpdatedAt: true },
          );
        }
      }
    }
  } catch (error) {
    console.error('Failed to migrate Supabase data to PostgreSQL:', error.message);
  }
}

function mapDailySnapshotToSupabaseRow(snapshot) {
  return {
    id: snapshot.id,
    day: snapshot.day,
    account_id: snapshot.accountId || 'primary',
    account_label: snapshot.accountLabel || resolveAccountLabel(snapshot.accountId || 'primary'),
    unit_id: snapshot.unitId,
    unit_label: snapshot.unitLabel || snapshot.vehicle || snapshot.unitId,
    vehicle: snapshot.vehicle || snapshot.unitLabel || snapshot.unitId,
    error_type: snapshot.type,
    error_label: snapshot.label || sensorFaultLabel(snapshot.type),
    incidents: snapshot.incidents ?? 0,
    temp1_incidents: snapshot.temp1Incidents ?? 0,
    temp2_incidents: snapshot.temp2Incidents ?? 0,
    both_incidents: snapshot.bothIncidents ?? 0,
    first_start_timestamp: snapshot.firstStartTimestamp ? new Date(snapshot.firstStartTimestamp).toISOString() : null,
    last_end_timestamp: snapshot.lastEndTimestamp ? new Date(snapshot.lastEndTimestamp).toISOString() : null,
    duration_minutes: snapshot.durationMinutes ?? null,
    total_minutes: snapshot.totalMinutes ?? null,
    longest_minutes: snapshot.longestMinutes ?? null,
    temp1_min: snapshot.temp1Min ?? null,
    temp1_max: snapshot.temp1Max ?? null,
    temp2_min: snapshot.temp2Min ?? null,
    temp2_max: snapshot.temp2Max ?? null,
    min_speed: snapshot.minSpeed ?? null,
    max_speed: snapshot.maxSpeed ?? null,
    latitude: snapshot.latitude ?? null,
    longitude: snapshot.longitude ?? null,
    location_summary: snapshot.locationSummary || '',
    zone_name: snapshot.zoneName || '',
  };
}

function getStorageProvider() {
  if (getPostgresConfig().enabled) {
    return 'postgres';
  }
  if (getSupabaseWebAuthConfig().enabled) {
    return 'supabase';
  }
  return 'local-bootstrap';
}

function getPostgresPool() {
  const runtime = getPostgresConfig();
  if (!runtime.enabled) {
    return null;
  }
  if (!postgresPool) {
    postgresPool = new Pool({
      connectionString: runtime.connectionString,
      ssl: /supabase|render|railway|neon/i.test(runtime.connectionString) ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: Math.max(1000, POSTGRES_CONNECT_TIMEOUT_MS),
      query_timeout: Math.max(1000, POSTGRES_QUERY_TIMEOUT_MS),
      statement_timeout: Math.max(1000, POSTGRES_QUERY_TIMEOUT_MS),
      idleTimeoutMillis: 30000,
      keepAlive: true,
    });
  }
  return postgresPool;
}

async function postgresQuery(queryText, params) {
  const pool = getPostgresPool();
  if (!pool) {
    throw new Error('PostgreSQL is not configured.');
  }
  const safeParams = params || [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await pool.query(queryText, safeParams);
    } catch (error) {
      const retryable = error && (error.code === '40P01' || error.code === '40001');
      if (!retryable || attempt >= 2) {
        throw error;
      }
      const delayMs = 75 * (attempt + 1);
      console.warn(`[PostgreSQL] Retrying query after ${error.code} (${delayMs}ms delay)`);
      await new Promise(function (resolve) { setTimeout(resolve, delayMs); });
    }
  }
  throw new Error('PostgreSQL retry loop exited unexpectedly.');
}

async function ensurePostgresSchema() {
  if (!getPostgresConfig().enabled) {
    return;
  }

  await postgresQuery(`
    create table if not exists app_settings (
      id text primary key,
      config_data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );

    create table if not exists app_state (
      id text primary key,
      state_data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );

    create table if not exists dashboard_web_users (
      id text primary key,
      username text unique not null,
      display_name text not null,
      password_hash text not null,
      role text not null default 'admin',
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists login_rate_limits (
      key text primary key,
      scope text not null,
      ip_address text,
      identifier text,
      count integer not null default 0,
      reset_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists daily_temp_rollups (
      id text primary key,
      day date not null,
      account_id text,
      account_label text,
      unit_id text not null,
      unit_label text,
      vehicle text,
      error_type text,
      error_label text,
      incidents integer default 0,
      temp1_incidents integer default 0,
      temp2_incidents integer default 0,
      both_incidents integer default 0,
      first_start_timestamp timestamptz,
      last_end_timestamp timestamptz,
      duration_minutes numeric,
      total_minutes numeric,
      longest_minutes numeric,
      temp1_min numeric,
      temp1_max numeric,
      temp2_min numeric,
      temp2_max numeric,
      min_speed numeric,
      max_speed numeric,
      latitude numeric,
      longitude numeric,
      location_summary text,
      zone_name text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );

    create table if not exists pod_snapshots (
      id text primary key,
      day date not null,
      snapshot_timestamp timestamptz not null,
      snapshot_time text,
      unit_id text not null,
      unit_label text,
      customer_name text,
      pod_id text,
      pod_name text,
      latitude numeric,
      longitude numeric,
      speed numeric,
      distance_meters numeric,
      location_summary text,
      created_at timestamptz not null default now()
    );

    create table if not exists remote_reset_logs (
      id text primary key,
      triggered_at timestamptz not null,
      account_id text,
      account_label text,
      unit_id text not null,
      unit_label text,
      error_type text,
      command text not null default 'cpureset',
      status text not null,
      http_status integer,
      response_excerpt text,
      reason text,
      created_at timestamptz not null default now()
    );

    create index if not exists idx_daily_temp_rollups_day on daily_temp_rollups(day desc);
    create index if not exists idx_daily_temp_rollups_unit_id on daily_temp_rollups(unit_id);
    create index if not exists idx_daily_temp_rollups_account_id on daily_temp_rollups(account_id);
    create index if not exists idx_daily_temp_rollups_day_account_unit on daily_temp_rollups(day desc, account_id, unit_id);
    create index if not exists idx_pod_snapshots_day on pod_snapshots(day desc);
    create index if not exists idx_pod_snapshots_unit_id on pod_snapshots(unit_id);
    create index if not exists idx_pod_snapshots_timestamp on pod_snapshots(snapshot_timestamp desc);
    create index if not exists idx_dashboard_web_users_username on dashboard_web_users(username);
    create index if not exists idx_dashboard_web_users_role_active on dashboard_web_users(role, is_active);
    create index if not exists idx_login_rate_limits_reset_at on login_rate_limits(reset_at);
    create index if not exists idx_login_rate_limits_scope_reset on login_rate_limits(scope, reset_at);
    create index if not exists idx_remote_reset_logs_triggered_at on remote_reset_logs(triggered_at desc);
    create index if not exists idx_remote_reset_logs_account_unit_time on remote_reset_logs(account_id, unit_id, triggered_at desc);

    create table if not exists astro_route_snapshots (
      id text primary key,
      day date not null,
      account_id text,
      account_label text,
      unit_id text not null,
      unit_label text,
      customer_name text,
      route_id text,
      warehouse_name text,
      status text not null,
      reason text,
      wh_kpi text,
      pod_kpi text,
      wh_time_kpi text,
      wh_temp_kpi text,
      rit text,
      pod_count integer,
      pass_count integer,
      fail_count integer,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists idx_astro_route_snapshots_day on astro_route_snapshots(day desc);
    create index if not exists idx_astro_route_snapshots_unit on astro_route_snapshots(unit_id);
    create index if not exists idx_astro_route_snapshots_warehouse on astro_route_snapshots(warehouse_name);

    alter table astro_route_snapshots add column if not exists wh_time_kpi text;
    alter table astro_route_snapshots add column if not exists wh_temp_kpi text;

    create table if not exists tms_job_order_snapshots (
      job_order_id text primary key,
      day date not null,
      tenant_label text,
      customer_name text,
      normalized_plate text,
      plate_raw text,
      unit_label text,
      job_order_status text,
      workflow_state text,
      origin_name text,
      destination_name text,
      temp_min numeric,
      temp_max numeric,
      eta_origin timestamptz,
      eta_destination timestamptz,
      active boolean not null default true,
      task_list jsonb not null default '[]'::jsonb,
      workflow_lines jsonb not null default '[]'::jsonb,
      driver_assign jsonb not null default '[]'::jsonb,
      raw_doc jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );

    create table if not exists tms_monitor_rows (
      row_id text primary key,
      day date not null,
      tenant_label text,
      customer_name text,
      unit_key text not null,
      unit_id text,
      unit_label text,
      normalized_plate text,
      severity text not null,
      board_status text not null,
      job_order_id text,
      job_order_count integer not null default 1,
      origin_name text,
      destination_name text,
      temp_min numeric,
      temp_max numeric,
      eta_origin timestamptz,
      eta_destination timestamptz,
      driver_app_status text,
      incident_codes jsonb not null default '[]'::jsonb,
      incident_summary text,
      unmatched_reason text,
      metadata jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );

    create table if not exists tms_sync_logs (
      id text primary key,
      synced_at timestamptz not null,
      status text not null,
      fetched_count integer not null default 0,
      matched_count integer not null default 0,
      unmatched_count integer not null default 0,
      critical_count integer not null default 0,
      warning_count integer not null default 0,
      normal_count integer not null default 0,
      no_job_order_count integer not null default 0,
      message text,
      details jsonb not null default '{}'::jsonb
    );

    create table if not exists tms_address_cache (
      tenant_label text not null,
      normalized_address_key text not null,
      address_name text not null,
      latitude numeric,
      longitude numeric,
      source_address_id text,
      status text not null default 'missing',
      fetched_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      metadata jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      primary key (tenant_label, normalized_address_key)
    );

    create index if not exists idx_tms_job_order_snapshots_day on tms_job_order_snapshots(day desc);
    create index if not exists idx_tms_job_order_snapshots_plate on tms_job_order_snapshots(normalized_plate);
    create index if not exists idx_tms_monitor_rows_day on tms_monitor_rows(day desc);
    create index if not exists idx_tms_monitor_rows_severity on tms_monitor_rows(severity);
    create index if not exists idx_tms_monitor_rows_customer on tms_monitor_rows(customer_name);
    create index if not exists idx_tms_sync_logs_synced_at on tms_sync_logs(synced_at desc);
    create index if not exists idx_tms_address_cache_status on tms_address_cache(status);
    create index if not exists idx_tms_address_cache_seen on tms_address_cache(last_seen_at desc);
  `);
}

async function postgresUpsertJsonSetting(tableName, jsonColumn, value) {
  await ensurePostgresSchema();
  await postgresQuery(
    `insert into ${tableName} (id, ${jsonColumn}, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (id) do update
     set ${jsonColumn} = excluded.${jsonColumn},
         updated_at = now()`,
    ['default', JSON.stringify(value)],
  );
}

async function postgresLoadJsonSetting(tableName, jsonColumn) {
  await ensurePostgresSchema();
  const result = await postgresQuery(
    `select ${jsonColumn} from ${tableName} where id = $1 limit 1`,
    ['default'],
  );
  return result.rows.length ? result.rows[0][jsonColumn] : null;
}

function normalizePostgresValue(value) {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

async function postgresUpsertRows(tableName, rows, columns, conflictColumns, options) {
  if (!rows.length) {
    return 0;
  }
  await ensurePostgresSchema();
  const settings = options && typeof options === 'object' ? options : {};
  const params = [];
  const valueRows = rows.map(function (row, rowIndex) {
    const placeholders = columns.map(function (_column, columnIndex) {
      params.push(normalizePostgresValue(row[columns[columnIndex]]));
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });
    return `(${placeholders.join(', ')})`;
  });
  const assignments = columns
    .filter(function (column) { return !conflictColumns.includes(column); })
    .map(function (column) { return `${column} = excluded.${column}`; });
  if (settings.touchUpdatedAt) {
    assignments.push('updated_at = now()');
  }

  await postgresQuery(
    `insert into ${tableName} (${columns.join(', ')})
     values ${valueRows.join(', ')}
     on conflict (${conflictColumns.join(', ')}) do update
     set ${assignments.join(', ')}`,
    params,
  );
  return rows.length;
}

function mapSupabaseDailySnapshotRecord(record) {
  const legacyErrorTimestamp = Date.parse(record.error_timestamp || '');
  const firstStartTimestamp = Date.parse(record.first_start_timestamp || record.error_timestamp || '');
  const lastEndTimestamp = Date.parse(record.last_end_timestamp || '');
  const durationMinutes = Number(record.duration_minutes || record.total_minutes || 0);
  const safeLastEndTimestamp = Number.isFinite(lastEndTimestamp)
    ? lastEndTimestamp
    : Number.isFinite(firstStartTimestamp)
      ? firstStartTimestamp + (durationMinutes * 60 * 1000)
      : null;
  return {
    id: String(record.id || ''),
    day: String(record.day || '').slice(0, 10),
    accountId: String(record.account_id || record.accountId || 'primary'),
    accountLabel: String(record.account_label || record.accountLabel || resolveAccountLabel(record.account_id || record.accountId || 'primary')),
    unitId: String(record.unit_id || ''),
    unitLabel: String(record.unit_label || record.vehicle || record.unit_id || ''),
    vehicle: String(record.vehicle || record.unit_label || record.unit_id || ''),
    type: String(record.error_type || '').trim() || 'temp1',
    label: String(record.error_label || sensorFaultLabel(record.error_type) || ''),
    incidents: Number(record.incidents || 1),
    temp1Incidents: Number(record.temp1_incidents || (String(record.error_type || '') === 'temp1' ? 1 : 0)),
    temp2Incidents: Number(record.temp2_incidents || (String(record.error_type || '') === 'temp2' ? 1 : 0)),
    bothIncidents: Number(record.both_incidents || (String(record.error_type || '') === 'temp1+temp2' ? 1 : 0)),
    firstStartTimestamp: Number.isFinite(firstStartTimestamp) ? firstStartTimestamp : null,
    lastEndTimestamp: safeLastEndTimestamp,
    errorTimestamp: Number.isFinite(legacyErrorTimestamp) ? legacyErrorTimestamp : (Number.isFinite(firstStartTimestamp) ? firstStartTimestamp : null),
    durationMinutes,
    totalMinutes: Number(record.total_minutes || record.duration_minutes || 0),
    longestMinutes: Number(record.longest_minutes || record.duration_minutes || 0),
    temp1Min: toNumber(record.temp1_min ?? record.temp1),
    temp1Max: toNumber(record.temp1_max ?? record.temp1),
    temp2Min: toNumber(record.temp2_min ?? record.temp2),
    temp2Max: toNumber(record.temp2_max ?? record.temp2),
    minSpeed: toNumber(record.min_speed ?? record.speed),
    maxSpeed: toNumber(record.max_speed ?? record.speed),
    latitude: toNumber(record.latitude),
    longitude: toNumber(record.longitude),
    locationSummary: String(record.location_summary || ''),
    zoneName: String(record.zone_name || ''),
    startTime: Number.isFinite(firstStartTimestamp) ? formatLocalTime(firstStartTimestamp) : '-',
    endTime: Number.isFinite(lastEndTimestamp) ? formatLocalTime(lastEndTimestamp) : '-',
  };
}

async function upsertDailyTempSnapshotsToSupabase(accountConfig, accountState) {
  const compactRows = buildDailyTempCompactRows(accountConfig, accountState);
  if (!compactRows.length) {
    return 0;
  }

  const rows = compactRows.map(mapDailySnapshotToSupabaseRow).filter(function (row) {
    return row.id && row.day && row.unit_id;
  });
  if (!rows.length) {
    return 0;
  }

  if (getPostgresConfig().enabled) {
    return postgresUpsertRows(
      'daily_temp_rollups',
      rows,
      [
        'id', 'day', 'account_id', 'account_label', 'unit_id', 'unit_label', 'vehicle',
        'error_type', 'error_label', 'incidents', 'temp1_incidents', 'temp2_incidents',
        'both_incidents', 'first_start_timestamp', 'last_end_timestamp', 'duration_minutes',
        'total_minutes', 'longest_minutes', 'temp1_min', 'temp1_max', 'temp2_min', 'temp2_max',
        'min_speed', 'max_speed', 'latitude', 'longitude', 'location_summary', 'zone_name',
      ],
      ['id'],
      { touchUpdatedAt: true },
    );
  }

  const runtime = getSupabaseWebAuthConfig();
  if (!runtime.enabled) {
    return 0;
  }

  await supabaseRestRequest('POST', 'daily_temp_rollups', {
    headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
    body: rows,
  });
  return rows.length;
}

function mapPodSnapshotToSupabaseRow(snapshot) {
  return {
    id: snapshot.id,
    day: snapshot.day,
    snapshot_timestamp: new Date(snapshot.timestamp).toISOString(),
    snapshot_time: snapshot.time || formatLocalTime(snapshot.timestamp),
    unit_id: snapshot.unitId,
    unit_label: snapshot.unitLabel,
    customer_name: snapshot.customerName || '',
    pod_id: snapshot.podId,
    pod_name: snapshot.podName,
    latitude: snapshot.latitude ?? null,
    longitude: snapshot.longitude ?? null,
    speed: snapshot.speed ?? null,
    distance_meters: snapshot.distanceMeters ?? null,
    location_summary: snapshot.locationSummary || '',
  };
}

function mapSupabasePodSnapshotRecord(record) {
  const accountId = 'primary';
  const timestamp = Date.parse(record.snapshot_timestamp || '');
  return {
    id: String(record.id || ''),
    accountId,
    accountLabel: resolveAccountLabel(accountId),
    day: String(record.day || '').slice(0, 10),
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    time: String(record.snapshot_time || ''),
    unitId: String(record.unit_id || ''),
    unitLabel: String(record.unit_label || ''),
    customerName: String(record.customer_name || ''),
    podId: String(record.pod_id || ''),
    podName: String(record.pod_name || ''),
    latitude: toNumber(record.latitude),
    longitude: toNumber(record.longitude),
    speed: toNumber(record.speed),
    distanceMeters: toNumber(record.distance_meters),
    locationSummary: String(record.location_summary || ''),
  };
}

function normalizeAdminTempRollupInput(input) {
  const source = input && typeof input === 'object' ? input : {};
  const day = String(source.day || '').trim().slice(0, 10);
  const accountId = String(source.accountId || 'primary').trim() || 'primary';
  const unitId = String(source.unitId || '').trim();
  if (!day || !unitId) {
    throw new Error('Day dan unit id wajib diisi.');
  }

  const id = String(source.id || `${day}|${accountId}|${unitId}`).trim();
  const parseTimestamp = function (value) {
    const timestamp = toTimestampMaybe(value);
    return timestamp === null ? null : new Date(timestamp).toISOString();
  };

  return {
    id,
    day,
    account_id: accountId,
    account_label: String(source.accountLabel || resolveAccountLabel(accountId)).trim() || resolveAccountLabel(accountId),
    unit_id: unitId,
    unit_label: String(source.unitLabel || source.vehicle || unitId).trim() || unitId,
    vehicle: String(source.vehicle || source.unitLabel || unitId).trim() || unitId,
    error_type: String(source.type || source.errorType || 'temp1').trim() || 'temp1',
    error_label: String(source.label || source.errorLabel || sensorFaultLabel(source.type || source.errorType || 'temp1')).trim(),
    incidents: Math.max(0, Number(source.incidents || 0)),
    temp1_incidents: Math.max(0, Number(source.temp1Incidents || 0)),
    temp2_incidents: Math.max(0, Number(source.temp2Incidents || 0)),
    both_incidents: Math.max(0, Number(source.bothIncidents || 0)),
    first_start_timestamp: parseTimestamp(source.firstStartTimestamp),
    last_end_timestamp: parseTimestamp(source.lastEndTimestamp),
    duration_minutes: toNumber(source.durationMinutes),
    total_minutes: toNumber(source.totalMinutes),
    longest_minutes: toNumber(source.longestMinutes),
    temp1_min: toNumber(source.temp1Min),
    temp1_max: toNumber(source.temp1Max),
    temp2_min: toNumber(source.temp2Min),
    temp2_max: toNumber(source.temp2Max),
    min_speed: toNumber(source.minSpeed),
    max_speed: toNumber(source.maxSpeed),
    latitude: toNumber(source.latitude),
    longitude: toNumber(source.longitude),
    location_summary: String(source.locationSummary || '').trim(),
    zone_name: String(source.zoneName || '').trim(),
  };
}

function normalizeAdminPodSnapshotInput(input) {
  const source = input && typeof input === 'object' ? input : {};
  const day = String(source.day || '').trim().slice(0, 10);
  const unitId = String(source.unitId || '').trim();
  const podId = String(source.podId || '').trim();
  const snapshotTimestamp = toTimestampMaybe(source.timestamp || source.snapshotTimestamp);
  if (!day || !unitId || !podId || snapshotTimestamp === null) {
    throw new Error('Day, unit id, POD, dan timestamp wajib diisi.');
  }

  return {
    id: String(source.id || `${day}|${unitId}|${podId}|${snapshotTimestamp}`).trim(),
    day,
    snapshot_timestamp: new Date(snapshotTimestamp).toISOString(),
    snapshot_time: String(source.time || formatLocalTime(snapshotTimestamp)).trim() || formatLocalTime(snapshotTimestamp),
    unit_id: unitId,
    unit_label: String(source.unitLabel || unitId).trim() || unitId,
    customer_name: String(source.customerName || '').trim(),
    pod_id: podId,
    pod_name: String(source.podName || podId).trim() || podId,
    latitude: toNumber(source.latitude),
    longitude: toNumber(source.longitude),
    speed: toNumber(source.speed),
    distance_meters: toNumber(source.distanceMeters),
    location_summary: String(source.locationSummary || '').trim(),
  };
}

async function listAdminTempRollups(limit) {
  const resolvedLimit = Math.max(1, Math.min(1000, Number(limit || 250)));
  if (getPostgresConfig().enabled) {
    const result = await postgresQuery(
      `select id, day, account_id, account_label, unit_id, unit_label, vehicle, error_type, error_label,
              incidents, temp1_incidents, temp2_incidents, both_incidents, first_start_timestamp,
              last_end_timestamp, duration_minutes, total_minutes, longest_minutes, temp1_min, temp1_max,
              temp2_min, temp2_max, min_speed, max_speed, latitude, longitude, location_summary, zone_name
       from daily_temp_rollups
       order by day desc, first_start_timestamp desc nulls last
       limit $1`,
      [resolvedLimit],
    );
    return result.rows.map(mapSupabaseDailySnapshotRecord);
  }

  const rows = buildSnapshotReportAggregates(
    Object.values(getAllAccountConfigs()).flatMap(function () { return []; }),
  );
  return rows.tempErrorIncidents || [];
}

async function saveAdminTempRollup(input) {
  const row = normalizeAdminTempRollupInput(input);
  if (getPostgresConfig().enabled) {
    await postgresUpsertRows(
      'daily_temp_rollups',
      [row],
      [
        'id', 'day', 'account_id', 'account_label', 'unit_id', 'unit_label', 'vehicle',
        'error_type', 'error_label', 'incidents', 'temp1_incidents', 'temp2_incidents',
        'both_incidents', 'first_start_timestamp', 'last_end_timestamp', 'duration_minutes',
        'total_minutes', 'longest_minutes', 'temp1_min', 'temp1_max', 'temp2_min', 'temp2_max',
        'min_speed', 'max_speed', 'latitude', 'longitude', 'location_summary', 'zone_name',
      ],
      ['id'],
      { touchUpdatedAt: true },
    );
    const rows = await listAdminTempRollups(250);
    return rows;
  }
  throw new Error('Temp rollup editor saat ini hanya diaktifkan untuk PostgreSQL.');
}

async function deleteAdminTempRollup(id) {
  const resolvedId = String(id || '').trim();
  if (!resolvedId) {
    throw new Error('Rollup id wajib diisi.');
  }
  if (getPostgresConfig().enabled) {
    await postgresQuery('delete from daily_temp_rollups where id = $1', [resolvedId]);
    return listAdminTempRollups(250);
  }
  throw new Error('Temp rollup editor saat ini hanya diaktifkan untuk PostgreSQL.');
}

async function listAdminPodSnapshots(limit) {
  const resolvedLimit = Math.max(1, Math.min(1000, Number(limit || 250)));
  if (getPostgresConfig().enabled) {
    const result = await postgresQuery(
      `select id, day, snapshot_timestamp, snapshot_time, unit_id, unit_label, customer_name, pod_id, pod_name, latitude, longitude, speed, distance_meters, location_summary
       from pod_snapshots
       order by day desc, snapshot_timestamp desc
       limit $1`,
      [resolvedLimit],
    );
    return result.rows.map(mapSupabasePodSnapshotRecord);
  }
  return [];
}

async function saveAdminPodSnapshot(input) {
  const row = normalizeAdminPodSnapshotInput(input);
  if (getPostgresConfig().enabled) {
    await postgresUpsertRows(
      'pod_snapshots',
      [row],
      [
        'id', 'day', 'snapshot_timestamp', 'snapshot_time', 'unit_id', 'unit_label',
        'customer_name', 'pod_id', 'pod_name', 'latitude', 'longitude',
        'speed', 'distance_meters', 'location_summary',
      ],
      ['id'],
    );
    return listAdminPodSnapshots(250);
  }
  throw new Error('POD snapshot editor saat ini hanya diaktifkan untuk PostgreSQL.');
}

async function deleteAdminPodSnapshot(id) {
  const resolvedId = String(id || '').trim();
  if (!resolvedId) {
    throw new Error('POD snapshot id wajib diisi.');
  }
  if (getPostgresConfig().enabled) {
    await postgresQuery('delete from pod_snapshots where id = $1', [resolvedId]);
    return listAdminPodSnapshots(250);
  }
  throw new Error('POD snapshot editor saat ini hanya diaktifkan untuk PostgreSQL.');
}

async function upsertPodSnapshotsToSupabase(accountConfig, accountState) {
  const sourceRows = Array.isArray(accountState?.podSnapshots) ? accountState.podSnapshots : [];
  if (!sourceRows.length) {
    return 0;
  }

  const rows = sourceRows.map(mapPodSnapshotToSupabaseRow).filter(function (row) {
    return row.id && row.day && row.snapshot_timestamp && row.unit_id && row.pod_id;
  });
  if (!rows.length) {
    return 0;
  }

  if (getPostgresConfig().enabled) {
    return postgresUpsertRows(
      'pod_snapshots',
      rows,
      [
        'id', 'day', 'snapshot_timestamp', 'snapshot_time', 'unit_id', 'unit_label',
        'customer_name', 'pod_id', 'pod_name', 'latitude', 'longitude',
        'speed', 'distance_meters', 'location_summary',
      ],
      ['id'],
    );
  }

  const runtime = getSupabaseWebAuthConfig();
  if (!runtime.enabled) {
    return 0;
  }

  await supabaseRestRequest('POST', 'pod_snapshots', {
    headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
    body: rows,
  });
  return rows.length;
}

async function loadPodSnapshotsFromSupabase(rangeStartMs, rangeEndMs) {
  if (rangeStartMs === null || rangeEndMs === null) {
    return [];
  }

  const startDay = formatLocalDay(rangeStartMs);
  const endDay = formatLocalDay(rangeEndMs);
  if (getPostgresConfig().enabled) {
    const result = await postgresQuery(
      `select id, day, snapshot_timestamp, snapshot_time, unit_id, unit_label, customer_name, pod_id, pod_name, latitude, longitude, speed, distance_meters, location_summary
       from pod_snapshots
       where day >= $1 and day <= $2
       order by snapshot_timestamp desc
       limit 20000`,
      [startDay, endDay],
    );
    return result.rows.map(mapSupabasePodSnapshotRecord).filter(function (row) {
      return row.timestamp !== null;
    });
  }

  const runtime = getSupabaseWebAuthConfig();
  if (!runtime.enabled) {
    return [];
  }

  const rows = await supabaseRestRequest(
    'GET',
    `pod_snapshots?select=id,day,snapshot_timestamp,snapshot_time,unit_id,unit_label,customer_name,pod_id,pod_name,latitude,longitude,speed,distance_meters,location_summary&day=gte.${encodeURIComponent(startDay)}&day=lte.${encodeURIComponent(endDay)}&order=snapshot_timestamp.desc&limit=20000`,
  );
  return rows.map(mapSupabasePodSnapshotRecord).filter(function (row) {
    return row.timestamp !== null;
  });
}

async function loadDailyTempSnapshotsFromSupabase(rangeStartMs, rangeEndMs) {
  if (rangeStartMs === null || rangeEndMs === null) {
    return [];
  }

  const startDay = formatLocalDay(rangeStartMs);
  const endDay = formatLocalDay(rangeEndMs);
  if (getPostgresConfig().enabled) {
    const result = await postgresQuery(
      `select id, day, account_id, account_label, unit_id, unit_label, vehicle, error_type, error_label,
              incidents, temp1_incidents, temp2_incidents, both_incidents, first_start_timestamp,
              last_end_timestamp, duration_minutes, total_minutes, longest_minutes, temp1_min, temp1_max,
              temp2_min, temp2_max, min_speed, max_speed, latitude, longitude, location_summary, zone_name
       from daily_temp_rollups
       where day >= $1 and day <= $2
       order by day desc, first_start_timestamp desc nulls last
       limit 20000`,
      [startDay, endDay],
    );
    return result.rows.map(mapSupabaseDailySnapshotRecord);
  }

  const runtime = getSupabaseWebAuthConfig();
  if (!runtime.enabled) {
    return [];
  }

  const rows = await supabaseRestRequest(
    'GET',
    `daily_temp_rollups?select=id,day,account_id,account_label,unit_id,unit_label,vehicle,error_type,error_label,incidents,temp1_incidents,temp2_incidents,both_incidents,first_start_timestamp,last_end_timestamp,duration_minutes,total_minutes,longest_minutes,temp1_min,temp1_max,temp2_min,temp2_max,min_speed,max_speed,latitude,longitude,location_summary,zone_name&day=gte.${encodeURIComponent(startDay)}&day=lte.${encodeURIComponent(endDay)}&order=day.desc&limit=20000`,
  );
  return rows.map(mapSupabaseDailySnapshotRecord);
}

function buildTempErrorIncidentsFromSnapshotRows(snapshotRows) {
  const rows = new Map();

  for (const snapshot of snapshotRows || []) {
    const day = snapshot.day || formatLocalDay(snapshot.errorTimestamp || Date.now());
    const key = `${day}|${snapshot.accountId || 'primary'}|${snapshot.unitId || snapshot.vehicle}`;
    if (!rows.has(key)) {
      rows.set(key, {
        day,
        accountId: snapshot.accountId || 'primary',
        accountLabel: snapshot.accountLabel || resolveAccountLabel(snapshot.accountId || 'primary'),
        unitId: snapshot.unitId || snapshot.vehicle,
        unitLabel: snapshot.unitLabel || snapshot.vehicle,
        vehicle: snapshot.vehicle || snapshot.unitLabel || snapshot.unitId || '',
        incidents: 0,
        temp1Incidents: 0,
        temp2Incidents: 0,
        bothIncidents: 0,
        firstStartTimestamp: snapshot.startTimestamp ?? snapshot.errorTimestamp ?? null,
        lastEndTimestamp: inferDailySnapshotEndTimestamp(snapshot),
        totalMinutes: 0,
        longestMinutes: 0,
        temp1Min: null,
        temp1Max: null,
        temp2Min: null,
        temp2Max: null,
        minSpeed: null,
        maxSpeed: null,
        latitude: snapshot.latitude ?? null,
        longitude: snapshot.longitude ?? null,
        locationSummary: snapshot.locationSummary || '',
        zoneName: snapshot.zoneName || '',
      });
    }

    const row = rows.get(key);
    const durationMinutes = Number(snapshot.durationMinutes || 0);
    const endTimestamp = inferDailySnapshotEndTimestamp(snapshot);
    row.incidents += 1;
    if (snapshot.startTimestamp !== null && snapshot.startTimestamp !== undefined) {
      row.firstStartTimestamp = row.firstStartTimestamp === null
        ? snapshot.startTimestamp
        : Math.min(row.firstStartTimestamp, snapshot.startTimestamp);
    }
    if (endTimestamp !== null && endTimestamp !== undefined) {
      row.lastEndTimestamp = row.lastEndTimestamp === null
        ? endTimestamp
        : Math.max(row.lastEndTimestamp, endTimestamp);
    }
    row.totalMinutes += durationMinutes;
    row.longestMinutes = Math.max(row.longestMinutes, durationMinutes);
    if (snapshot.type === 'temp1') row.temp1Incidents += 1;
    if (snapshot.type === 'temp2') row.temp2Incidents += 1;
    if (snapshot.type === 'temp1+temp2') row.bothIncidents += 1;
    if (snapshot.temp1 !== null && snapshot.temp1 !== undefined) {
      row.temp1Min = row.temp1Min === null ? snapshot.temp1 : Math.min(row.temp1Min, snapshot.temp1);
      row.temp1Max = row.temp1Max === null ? snapshot.temp1 : Math.max(row.temp1Max, snapshot.temp1);
    }
    if (snapshot.temp2 !== null && snapshot.temp2 !== undefined) {
      row.temp2Min = row.temp2Min === null ? snapshot.temp2 : Math.min(row.temp2Min, snapshot.temp2);
      row.temp2Max = row.temp2Max === null ? snapshot.temp2 : Math.max(row.temp2Max, snapshot.temp2);
    }
    if (snapshot.speed !== null && snapshot.speed !== undefined) {
      row.minSpeed = row.minSpeed === null ? snapshot.speed : Math.min(row.minSpeed, snapshot.speed);
      row.maxSpeed = row.maxSpeed === null ? snapshot.speed : Math.max(row.maxSpeed, snapshot.speed);
    }
  }

  return [...rows.values()].map(function (row) {
    let type = 'temp1';
    if (row.bothIncidents > 0 || (row.temp1Incidents > 0 && row.temp2Incidents > 0)) {
      type = 'temp1+temp2';
    } else if (row.temp2Incidents > 0) {
      type = 'temp2';
    }
    return {
      ...row,
      type,
      label: sensorFaultLabel(type),
      durationMinutes: Number(row.totalMinutes.toFixed(2)),
      totalMinutes: Number(row.totalMinutes.toFixed(2)),
      longestMinutes: Number(row.longestMinutes.toFixed(2)),
      startTime: row.firstStartTimestamp ? formatLocalTime(row.firstStartTimestamp) : '-',
      endTime: row.lastEndTimestamp ? formatLocalTime(row.lastEndTimestamp) : '-',
    };
  }).sort(function (left, right) {
    return (right.firstStartTimestamp || 0) - (left.firstStartTimestamp || 0);
  });
}

function buildSnapshotReportAggregatesFromCompactRows(compactRows) {
  const tempErrorIncidents = [...(compactRows || [])].sort(function (left, right) {
    return (right.firstStartTimestamp || 0) - (left.firstStartTimestamp || 0);
  });

  const compileByUnitDay = tempErrorIncidents.map(function (row) {
    return {
      day: row.day,
      accountId: row.accountId,
      accountLabel: row.accountLabel,
      unitId: row.unitId,
      unitLabel: row.unitLabel,
      vehicle: row.vehicle,
      incidents: row.incidents,
      temp1Incidents: row.temp1Incidents,
      temp2Incidents: row.temp2Incidents,
      bothIncidents: row.bothIncidents,
      totalMinutes: Number(row.totalMinutes || 0),
      longestMinutes: Number(row.longestMinutes || 0),
    };
  }).sort(function (left, right) {
    return right.day.localeCompare(left.day)
      || String(left.accountLabel || left.accountId).localeCompare(String(right.accountLabel || right.accountId))
      || String(left.unitLabel || left.unitId).localeCompare(String(right.unitLabel || right.unitId));
  });

  const compileByDayMap = new Map();
  const dailyTotalsMap = new Map();
  for (const row of compileByUnitDay) {
    if (!compileByDayMap.has(row.day)) {
      compileByDayMap.set(row.day, {
        day: row.day,
        units: 0,
        temp1Units: 0,
        temp2Units: 0,
        bothUnits: 0,
        incidents: 0,
        totalMinutes: 0,
        longestMinutes: 0,
      });
    }
    const dailyCompile = compileByDayMap.get(row.day);
    dailyCompile.units += 1;
    if (row.temp1Incidents > 0) dailyCompile.temp1Units += 1;
    if (row.temp2Incidents > 0) dailyCompile.temp2Units += 1;
    if (row.bothIncidents > 0) dailyCompile.bothUnits += 1;
    dailyCompile.incidents += Number(row.incidents || 0);
    dailyCompile.totalMinutes += Number(row.totalMinutes || 0);
    dailyCompile.longestMinutes = Math.max(dailyCompile.longestMinutes, Number(row.longestMinutes || 0));

    if (!dailyTotalsMap.has(row.day)) {
      dailyTotalsMap.set(row.day, {
        day: row.day,
        units: 0,
        incidents: 0,
        criticalIncidents: 0,
        totalMinutes: 0,
      });
    }
    const dailyTotals = dailyTotalsMap.get(row.day);
    dailyTotals.units += 1;
    dailyTotals.incidents += Number(row.incidents || 0);
    dailyTotals.criticalIncidents += Number(row.bothIncidents || 0);
    dailyTotals.totalMinutes += Number(row.totalMinutes || 0);
  }

  const compileByDay = [...compileByDayMap.values()].map(function (row) {
    return {
      ...row,
      totalMinutes: Number(row.totalMinutes.toFixed(2)),
      longestMinutes: Number(row.longestMinutes.toFixed(2)),
    };
  }).sort(function (left, right) {
    return right.day.localeCompare(left.day);
  });

  const dailyTotals = [...dailyTotalsMap.values()].map(function (row) {
    return {
      ...row,
      totalMinutes: Number(row.totalMinutes.toFixed(2)),
    };
  }).sort(function (left, right) {
    return right.day.localeCompare(left.day);
  });

  return {
    tempErrorIncidents,
    compileByUnitDay,
    compileByDay,
    dailyTotals,
  };
}

function buildSnapshotReportAggregates(snapshotRows) {
  const tempErrorIncidents = buildTempErrorIncidentsFromSnapshotRows(snapshotRows);
  const compileByUnitDay = tempErrorIncidents.map(function (row) {
    return {
      day: row.day,
      accountId: row.accountId,
      accountLabel: row.accountLabel,
      unitId: row.unitId,
      unitLabel: row.unitLabel,
      vehicle: row.vehicle,
      incidents: row.incidents,
      temp1Incidents: row.temp1Incidents,
      temp2Incidents: row.temp2Incidents,
      bothIncidents: row.bothIncidents,
      totalMinutes: Number(row.totalMinutes || 0),
      longestMinutes: Number(row.longestMinutes || 0),
    };
  }).sort(function (left, right) {
    return right.day.localeCompare(left.day)
      || String(left.accountLabel || left.accountId).localeCompare(String(right.accountLabel || right.accountId))
      || String(left.unitLabel || left.unitId).localeCompare(String(right.unitLabel || right.unitId));
  });

  const compileByDayMap = new Map();
  const dailyTotalsMap = new Map();
  for (const row of compileByUnitDay) {
    if (!compileByDayMap.has(row.day)) {
      compileByDayMap.set(row.day, {
        day: row.day,
        units: 0,
        temp1Units: 0,
        temp2Units: 0,
        bothUnits: 0,
        incidents: 0,
        totalMinutes: 0,
        longestMinutes: 0,
      });
    }
    const dailyCompile = compileByDayMap.get(row.day);
    dailyCompile.units += 1;
    if (row.temp1Incidents > 0) dailyCompile.temp1Units += 1;
    if (row.temp2Incidents > 0) dailyCompile.temp2Units += 1;
    if (row.bothIncidents > 0) dailyCompile.bothUnits += 1;
    dailyCompile.incidents += Number(row.incidents || 0);
    dailyCompile.totalMinutes += Number(row.totalMinutes || 0);
    dailyCompile.longestMinutes = Math.max(dailyCompile.longestMinutes, Number(row.longestMinutes || 0));

    if (!dailyTotalsMap.has(row.day)) {
      dailyTotalsMap.set(row.day, {
        day: row.day,
        units: 0,
        incidents: 0,
        criticalIncidents: 0,
        totalMinutes: 0,
      });
    }
    const dailyTotals = dailyTotalsMap.get(row.day);
    dailyTotals.units += 1;
    dailyTotals.incidents += Number(row.incidents || 0);
    dailyTotals.criticalIncidents += Number(row.bothIncidents || 0);
    dailyTotals.totalMinutes += Number(row.totalMinutes || 0);
  }

  const compileByDay = [...compileByDayMap.values()].map(function (row) {
    return {
      ...row,
      totalMinutes: Number(row.totalMinutes.toFixed(2)),
      longestMinutes: Number(row.longestMinutes.toFixed(2)),
    };
  }).sort(function (left, right) {
    return right.day.localeCompare(left.day);
  });

  const dailyTotals = [...dailyTotalsMap.values()].map(function (row) {
    return {
      ...row,
      totalMinutes: Number(row.totalMinutes.toFixed(2)),
    };
  }).sort(function (left, right) {
    return right.day.localeCompare(left.day);
  });

  return {
    tempErrorIncidents,
    compileByUnitDay,
    compileByDay,
    dailyTotals,
  };
}

function compactTempErrorRowKey(row) {
  return [
    String(row?.day || '').trim(),
    String(row?.accountId || 'primary').trim(),
    String(row?.unitId || row?.vehicle || '').trim(),
  ].join('|');
}

function pickPreferredCompactTempErrorRow(currentRow, nextRow) {
  if (!currentRow) return nextRow;
  if (!nextRow) return currentRow;
  const currentEnd = Number(currentRow.lastEndTimestamp || currentRow.firstStartTimestamp || currentRow.errorTimestamp || 0);
  const nextEnd = Number(nextRow.lastEndTimestamp || nextRow.firstStartTimestamp || nextRow.errorTimestamp || 0);
  if (nextEnd !== currentEnd) return nextEnd > currentEnd ? nextRow : currentRow;
  const currentIncidents = Number(currentRow.incidents || 0);
  const nextIncidents = Number(nextRow.incidents || 0);
  if (nextIncidents !== currentIncidents) return nextIncidents > currentIncidents ? nextRow : currentRow;
  const currentDuration = Number(currentRow.totalMinutes || currentRow.durationMinutes || 0);
  const nextDuration = Number(nextRow.totalMinutes || nextRow.durationMinutes || 0);
  if (nextDuration !== currentDuration) return nextDuration > currentDuration ? nextRow : currentRow;
  const currentSeverity = (Number(currentRow.bothIncidents || 0) > 0 ? 3 : 0) + (Number(currentRow.temp2Incidents || 0) > 0 ? 1 : 0) + (Number(currentRow.temp1Incidents || 0) > 0 ? 1 : 0);
  const nextSeverity = (Number(nextRow.bothIncidents || 0) > 0 ? 3 : 0) + (Number(nextRow.temp2Incidents || 0) > 0 ? 1 : 0) + (Number(nextRow.temp1Incidents || 0) > 0 ? 1 : 0);
  if (nextSeverity !== currentSeverity) return nextSeverity > currentSeverity ? nextRow : currentRow;
  return nextRow;
}

function mergeCompactTempErrorRows(primaryRows, secondaryRows) {
  const merged = new Map();
  for (const row of primaryRows || []) {
    if (!row) continue;
    merged.set(compactTempErrorRowKey(row), row);
  }
  for (const row of secondaryRows || []) {
    if (!row) continue;
    const key = compactTempErrorRowKey(row);
    merged.set(key, pickPreferredCompactTempErrorRow(merged.get(key), row));
  }
  return [...merged.values()];
}

function resolveAstroAccountId(reference) {
  const target = String(reference || '').trim();
  if (!target) {
    return 'primary';
  }
  const normalized = target.toLowerCase();
  const accounts = getAllAccountConfigs();
  const matched = accounts.find(function (account) {
    return String(account.id || '').trim().toLowerCase() === normalized
      || String(account.label || '').trim().toLowerCase() === normalized
      || String(account.authEmail || '').trim().toLowerCase() === normalized;
  });
  if (matched) {
    return matched.id;
  }
  if (normalized === 'primary account') {
    return 'primary';
  }
  return '';
}

function validateAstroRoutes(routes, locations, options) {
  const accountIds = new Set(getAllAccountConfigs().map(function (account) { return account.id; }));
  const locationMap = new Map((locations || []).map(function (location) { return [location.id, location]; }));
  const seen = new Set();
  const requireWhTempRange = Boolean(options && options.requireWhTempRange);

  function astroRoutePathKey(route) {
    return [
      String(route.whLocationId || '').trim(),
      String(route.poolLocationId || '').trim() || 'no-pool',
      (route.podSequence || []).map(function (podId) { return String(podId || '').trim(); }).filter(Boolean).join('>') || 'no-pod',
    ].join('::');
  }

  return (routes || []).map(function (item) {
    const normalized = astroCore.normalizeAstroRoute(item);
    if (!normalized) {
      throw new Error('Astro route invalid. Account, nopol, WH, dan Rit 1 wajib diisi.');
    }
    const resolvedAccountId = resolveAstroAccountId(normalized.accountId);
    if (!resolvedAccountId || !accountIds.has(resolvedAccountId)) {
      throw new Error('Account Astro route tidak ditemukan: ' + normalized.accountId);
    }
    normalized.accountId = resolvedAccountId;
    const accountConfig = getAccountConfigById(resolvedAccountId);
    const resolvedUnitId = resolveAstroUnitId(accountConfig, normalized.unitId) || normalized.unitId;
    normalized.unitId = resolvedUnitId;
    if (!normalized.whLocationId) {
      throw new Error('WH location wajib diisi untuk unit ' + normalized.unitId);
    }
    const whLocation = locationMap.get(normalized.whLocationId);
    if (!whLocation || whLocation.type !== 'WH') {
      throw new Error('WH location tidak valid untuk unit ' + normalized.unitId);
    }
    if (normalized.poolLocationId) {
      const poolLocation = locationMap.get(normalized.poolLocationId);
      if (!poolLocation || poolLocation.type !== 'POOL') {
        throw new Error('POOL location tidak valid untuk unit ' + normalized.unitId);
      }
    }
    if ((normalized.podSequence || []).length > 5) {
      throw new Error('Maksimal 5 POD per rit untuk unit ' + normalized.unitId);
    }
    normalized.podSequence.forEach(function (podId) {
      const podLocation = locationMap.get(podId);
      if (!podLocation || podLocation.type !== 'POD') {
        throw new Error('POD location tidak valid untuk unit ' + normalized.unitId + ': ' + podId);
      }
    });
    if (!normalized.rit1) {
      throw new Error('Rit 1 wajib valid untuk unit ' + normalized.unitId);
    }
    const hasWhTempMin = normalized.whArrivalTempMinSla !== null && normalized.whArrivalTempMinSla !== undefined;
    const hasWhTempMax = normalized.whArrivalTempMaxSla !== null && normalized.whArrivalTempMaxSla !== undefined;
    if (requireWhTempRange) {
      if (!hasWhTempMin || !hasWhTempMax) {
        throw new Error('WH temp min/max SLA wajib diisi untuk unit ' + normalized.unitId);
      }
      if (Number(normalized.whArrivalTempMinSla) > Number(normalized.whArrivalTempMaxSla)) {
        throw new Error('WH temp min SLA tidak boleh lebih besar dari max SLA untuk unit ' + normalized.unitId);
      }
    }
    const routeKey = normalized.accountId + '::' + normalized.unitId + '::' + astroRoutePathKey(normalized);
    if (seen.has(routeKey)) {
      throw new Error('Rute Telah Ada');
    }
    seen.add(routeKey);
    return normalized;
  });
}

function sanitizeAstroRoutesForStartup(routes, locations) {
  const accepted = [];
  const dropped = [];

  for (const route of routes || []) {
    try {
      const validated = validateAstroRoutes([...accepted, route], locations);
      accepted.length = 0;
      accepted.push(...validated);
    } catch (error) {
      dropped.push({
        routeId: route?.id || '',
        unitId: route?.unitId || '',
        accountId: route?.accountId || '',
        reason: error.message,
      });
    }
  }

  return {
    routes: accepted,
    dropped,
  };
}

function csvEscape(value) {
  const textValue = String(value ?? '');
  return /[",\n]/.test(textValue) ? '"' + textValue.replace(/"/g, '""') + '"' : textValue;
}

function buildCsvText(rows) {
  if (!rows.length) {
    return '';
  }
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map(function (row) {
    return headers.map(function (header) {
      return csvEscape(row[header]);
    }).join(',');
  })].join('\n');
}

function resolveAstroUnitId(accountConfig, unitReference) {
  const target = String(unitReference || '').trim();
  if (!target) {
    return '';
  }
  const normalized = normalizeUnitKey(target);
  const accountState = ensureAccountState(accountConfig?.id || 'primary');
  const candidates = [
    ...((accountConfig?.units || []).map(function (unit) {
      return {
        id: String(unit.id || '').trim(),
        label: String(unit.label || unit.id || '').trim(),
        vehicle: '',
      };
    })),
    ...Object.entries(accountState?.units || {}).map(function ([id, unitState]) {
      return {
        id: String(id || '').trim(),
        label: String(unitState?.label || '').trim(),
        vehicle: String(unitState?.vehicle || '').trim(),
      };
    }),
  ].filter(function (unit) {
    return unit.id;
  });
  const matched = candidates.find(function (unit) {
    return normalizeUnitKey(unit.id) === normalized
      || normalizeUnitKey(unit.label) === normalized
      || normalizeUnitKey(unit.vehicle) === normalized;
  });
  return matched?.id || '';
}
function resolveAstroUnitLabel(accountConfig, unitId) {
  const normalizedId = normalizeUnitKey(unitId);
  const configuredUnit = (accountConfig?.units || []).find(function (unit) {
    return normalizeUnitKey(unit.id) === normalizedId;
  });
  if (configuredUnit?.label) {
    return configuredUnit.label;
  }

  const accountState = ensureAccountState(accountConfig?.id || 'primary');
  const unitState = accountState.units?.[unitId] || accountState.units?.[normalizedId] || null;
  if (unitState?.label) {
    return unitState.label;
  }

  const snapshot = accountState.fleet?.vehicles?.[normalizedId] || null;
  if (snapshot?.alias) {
    return snapshot.alias;
  }

  return String(unitId || '');
}

function buildDateRangeDays(startDay, endDay) {
  const days = [];
  let cursor = parseSolofleetDateInputStart(startDay);
  const end = parseSolofleetDateInputStart(endDay);
  if (cursor === null || end === null) {
    return days;
  }
  while (cursor <= end) {
    days.push(formatLocalDay(cursor));
    cursor += 24 * 60 * 60 * 1000;
  }
  return days;
}

function astroStatusPriority(status) {
  switch (String(status || '')) {
    case 'complete':
      return 5;
    case 'awaiting_return_wh':
      return 4;
    case 'missing_pod':
      return 3;
    case 'outside_window':
      return 2;
    case 'no_snapshot':
      return 1;
    default:
      return 0;
  }
}

function buildAstroDisplayRows(route, accountConfig, unitLabel, routeRows, startDate, endDate) {
  const whName = (config.astroLocations || []).find(function (location) {
    return location.id === route.whLocationId;
  })?.name || 'WH';
  const windows = [
    { key: 'rit1', label: 'Rit 1', enabled: Boolean(route.rit1) && route.rit1.enabled !== false },
    { key: 'rit2', label: 'Rit 2', enabled: Boolean(route.rit2) && route.rit2.enabled !== false },
  ].filter(function (entry) {
    return entry.enabled;
  });

  const bestByKey = new Map();
  for (const row of routeRows || []) {
    if (!row.ritKey || !row.serviceDate) {
      continue;
    }
    const key = `${row.serviceDate}|${row.ritKey}`;
    const current = bestByKey.get(key);
    if (!current || astroStatusPriority(row.status) > astroStatusPriority(current.status)) {
      bestByKey.set(key, {
        ...row,
        expectedPodCount: Math.max(Number(row.expectedPodCount || 0), (route.podSequence || []).length),
      });
    }
  }

  const displayRows = [];
  for (const day of buildDateRangeDays(startDate, endDate)) {
    for (const rit of windows) {
      const matched = bestByKey.get(`${day}|${rit.key}`);
      if (matched) {
        displayRows.push({
          ...matched,
          expectedPodCount: Math.max(Number(matched.expectedPodCount || 0), (route.podSequence || []).length),
        });
        continue;
      }

      displayRows.push({
        routeId: route.id,
        accountId: route.accountId || 'primary',
        accountLabel: accountConfig.label || accountConfig.id,
        unitId: route.unitId,
        unitLabel,
        customer: route.customerName || 'Astro',
        serviceDate: day,
        rit: rit.label,
        ritKey: rit.key,
        status: 'no_snapshot',
        reason: 'No WH/POD snapshot found for this rit in the selected range.',
        whName,
        whEta: null,
        whArrivalTemp: null,
        whEtd: null,
        whDepartureTemp: null,
        returnWhEta: null,
        returnWhEtd: null,
        poolName: '',
        poolEta: null,
        poolArrivalTemp: null,
        poolEtd: null,
        poolDepartureTemp: null,
        pods: [],
        expectedPodCount: (route.podSequence || []).length,
      });
    }
  }

  return displayRows;
}

function astroKpiStatusLabel(status) {
  if (status === 'pass') return 'Pass';
  if (status === 'fail') return 'Fail';
  return 'N/A';
}

function astroTimeTextToMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function buildAstroSlaTimestamp(serviceDate, timeText, ritWindow) {
  const dayMatch = String(serviceDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMinutes = astroTimeTextToMinutes(timeText);
  if (!dayMatch || timeMinutes === null) {
    return null;
  }
  const [, year, month, day] = dayMatch;
  const startMinutes = astroTimeTextToMinutes(ritWindow?.start);
  const endMinutes = astroTimeTextToMinutes(ritWindow?.end);
  const wrapsMidnight = startMinutes !== null && endMinutes !== null && endMinutes < startMinutes;
  const addDay = wrapsMidnight && timeMinutes <= endMinutes ? 1 : 0;
  const totalMinutes = timeMinutes + (addDay * 24 * 60);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), hour, minute, 0, 0) - (SOLOFLEET_UTC_OFFSET_MINUTES * 60 * 1000);
}

function evaluateAstroTimeKpi(actualTimestamp, serviceDate, slaText, ritWindow, rowStatus, name) {
  const normalizedSla = String(slaText || '').trim();
  if (!normalizedSla) {
    return {
      name: name || '',
      configured: false,
      eligible: false,
      status: 'na',
      label: astroKpiStatusLabel('na'),
      sla: '',
      actual: Number.isFinite(Number(actualTimestamp)) ? formatLocalTime(actualTimestamp) : '',
    };
  }
  const eligible = rowStatus !== 'no_snapshot';
  if (!eligible) {
    return {
      name: name || '',
      configured: true,
      eligible: false,
      status: 'na',
      label: astroKpiStatusLabel('na'),
      sla: normalizedSla,
      actual: '',
    };
  }
  const actualMs = Number(actualTimestamp);
  const deadlineMs = buildAstroSlaTimestamp(serviceDate, normalizedSla, ritWindow);
  const passed = Number.isFinite(actualMs) && Number.isFinite(deadlineMs) && actualMs <= deadlineMs;
  return {
    name: name || '',
    configured: true,
    eligible: true,
    status: passed ? 'pass' : 'fail',
    label: astroKpiStatusLabel(passed ? 'pass' : 'fail'),
    sla: normalizedSla,
    actual: Number.isFinite(actualMs) ? formatLocalTime(actualMs) : '',
    actualTimestamp: Number.isFinite(actualMs) ? actualMs : null,
    deadlineTimestamp: Number.isFinite(deadlineMs) ? deadlineMs : null,
  };
}

function evaluateAstroTempRangeKpi(actualTemp, minValue, maxValue, rowStatus) {
  const min = Number(minValue);
  const max = Number(maxValue);
  const hasMin = Number.isFinite(min);
  const hasMax = Number.isFinite(max);
  if (!hasMin && !hasMax) {
    return {
      configured: false,
      eligible: false,
      status: 'na',
      label: astroKpiStatusLabel('na'),
      min: null,
      max: null,
      actual: Number.isFinite(Number(actualTemp)) ? Number(actualTemp) : null,
    };
  }
  const eligible = rowStatus !== 'no_snapshot';
  const actual = Number(actualTemp);
  if (!eligible) {
    return {
      configured: true,
      eligible: false,
      status: 'na',
      label: astroKpiStatusLabel('na'),
      min: hasMin ? min : null,
      max: hasMax ? max : null,
      actual: Number.isFinite(actual) ? actual : null,
    };
  }
  const passed = Number.isFinite(actual)
    && (!hasMin || actual >= min)
    && (!hasMax || actual <= max);
  return {
    configured: true,
    eligible: true,
    status: passed ? 'pass' : 'fail',
    label: astroKpiStatusLabel(passed ? 'pass' : 'fail'),
    min: hasMin ? min : null,
    max: hasMax ? max : null,
    actual: Number.isFinite(actual) ? actual : null,
  };
}

function evaluateAstroKpiRow(route, row) {
  const ritConfig = row?.ritKey ? route?.[row.ritKey] : null;
  const whArrivalTime = evaluateAstroTimeKpi(row?.whEta, row?.serviceDate, ritConfig?.whArrivalTimeSla, ritConfig, row?.status, row?.whName || 'WH');
  const whArrivalTemp = evaluateAstroTempRangeKpi(row?.whArrivalTemp, route?.whArrivalTempMinSla, route?.whArrivalTempMaxSla, row?.status);
  const podArrivalTimes = (route?.podSequence || []).map(function (locationId, index) {
    const pod = row?.pods?.[index] || null;
    const podName = pod?.name || ((config.astroLocations || []).find(function (location) { return location.id === locationId; })?.name || `POD ${index + 1}`);
    return evaluateAstroTimeKpi(pod?.eta, row?.serviceDate, ritConfig?.podArrivalTimeSlas?.[index], ritConfig, row?.status, podName);
  });

  const hasAnyConfigured = whArrivalTime.configured || whArrivalTemp.configured || podArrivalTimes.some(function (entry) {
    return entry.configured;
  });
  const overallEligible = hasAnyConfigured && row?.status !== 'no_snapshot';
  const eligibleChecks = [whArrivalTime, whArrivalTemp, ...podArrivalTimes].filter(function (entry) {
    return entry.eligible;
  });
  const allPass = row?.status === 'complete' && eligibleChecks.every(function (entry) {
    return entry.status === 'pass';
  });
  const overallStatus = !overallEligible
    ? 'na'
    : allPass
      ? 'pass'
      : 'fail';

  return {
    hasAnyConfigured,
    overallEligible,
    overallStatus,
    overallLabel: astroKpiStatusLabel(overallStatus),
    whArrivalTime,
    whArrivalTemp,
    podArrivalTimes,
  };
}

function buildAstroKpiSummary(rows) {
  const summary = {
    eligibleRows: 0,
    passRows: 0,
    failRows: 0,
    naRows: 0,
    whArrivalTimeEligible: 0,
    whArrivalTimePass: 0,
    whArrivalTempEligible: 0,
    whArrivalTempPass: 0,
    podArrivalEligible: 0,
    podArrivalPass: 0,
    trend: [],
    byWarehouse: [],
  };
  const trendMap = new Map();
  const warehouseMap = new Map();

  function ensureWarehouseBucket(name) {
    if (!warehouseMap.has(name)) {
      warehouseMap.set(name, {
        warehouse: name,
        rows: 0,
        eligibleRows: 0,
        passRows: 0,
        failRows: 0,
        naRows: 0,
        whArrivalTimeEligible: 0,
        whArrivalTimePass: 0,
        whArrivalTempEligible: 0,
        whArrivalTempPass: 0,
        podArrivalEligible: 0,
        podArrivalPass: 0,
        trendMap: new Map(),
      });
    }
    return warehouseMap.get(name);
  }

  (rows || []).forEach(function (row) {
    const kpi = row?.kpi || null;
    if (!kpi) {
      return;
    }
    if (kpi.overallEligible) {
      summary.eligibleRows += 1;
      if (kpi.overallStatus === 'pass') {
        summary.passRows += 1;
      } else {
        summary.failRows += 1;
      }
    } else {
      summary.naRows += 1;
    }

    if (kpi.whArrivalTime?.eligible) {
      summary.whArrivalTimeEligible += 1;
      if (kpi.whArrivalTime.status === 'pass') summary.whArrivalTimePass += 1;
    }
    if (kpi.whArrivalTemp?.eligible) {
      summary.whArrivalTempEligible += 1;
      if (kpi.whArrivalTemp.status === 'pass') summary.whArrivalTempPass += 1;
    }
    (kpi.podArrivalTimes || []).forEach(function (entry) {
      if (entry?.eligible) {
        summary.podArrivalEligible += 1;
        if (entry.status === 'pass') summary.podArrivalPass += 1;
      }
    });

    const dayKey = String(row.serviceDate || '');
    if (!trendMap.has(dayKey)) {
      trendMap.set(dayKey, {
        day: dayKey,
        rows: 0,
        eligibleRows: 0,
        passRows: 0,
        failRows: 0,
        naRows: 0,
      });
    }
    const bucket = trendMap.get(dayKey);
    bucket.rows += 1;
    if (kpi.overallEligible) {
      bucket.eligibleRows += 1;
      if (kpi.overallStatus === 'pass') {
        bucket.passRows += 1;
      } else {
        bucket.failRows += 1;
      }
    } else {
      bucket.naRows += 1;
    }

    const warehouseName = String(row.whName || row.whLocationName || row.whLocationId || row.wh || 'Unknown WH').trim() || 'Unknown WH';
    const warehouseBucket = ensureWarehouseBucket(warehouseName);
    
    if (!warehouseBucket.trendMap.has(dayKey)) {
      warehouseBucket.trendMap.set(dayKey, {
        day: dayKey,
        whArrivalTimeEligible: 0,
        whArrivalTimePass: 0,
        whArrivalTempEligible: 0,
        whArrivalTempPass: 0,
        podArrivalEligible: 0,
        podArrivalPass: 0,
      });
    }
    const whDayBucket = warehouseBucket.trendMap.get(dayKey);

    warehouseBucket.rows += 1;
    if (kpi.overallEligible) {
      warehouseBucket.eligibleRows += 1;
      if (kpi.overallStatus === 'pass') {
        warehouseBucket.passRows += 1;
      } else {
        warehouseBucket.failRows += 1;
      }
    } else {
      warehouseBucket.naRows += 1;
    }
    if (kpi.whArrivalTime?.eligible) {
      warehouseBucket.whArrivalTimeEligible += 1;
      whDayBucket.whArrivalTimeEligible += 1;
      if (kpi.whArrivalTime.status === 'pass') {
        warehouseBucket.whArrivalTimePass += 1;
        whDayBucket.whArrivalTimePass += 1;
      }
    }
    if (kpi.whArrivalTemp?.eligible) {
      warehouseBucket.whArrivalTempEligible += 1;
      whDayBucket.whArrivalTempEligible += 1;
      if (kpi.whArrivalTemp.status === 'pass') {
        warehouseBucket.whArrivalTempPass += 1;
        whDayBucket.whArrivalTempPass += 1;
      }
    }
    (kpi.podArrivalTimes || []).forEach(function (entry) {
      if (entry?.eligible) {
        warehouseBucket.podArrivalEligible += 1;
        whDayBucket.podArrivalEligible += 1;
        if (entry.status === 'pass') {
          warehouseBucket.podArrivalPass += 1;
          whDayBucket.podArrivalPass += 1;
        }
      }
    });
  });

  summary.whArrivalTimeRate = buildPercentValue(summary.whArrivalTimePass, summary.whArrivalTimeEligible);
  summary.whArrivalTempRate = buildPercentValue(summary.whArrivalTempPass, summary.whArrivalTempEligible);
  summary.podArrivalRate = buildPercentValue(summary.podArrivalPass, summary.podArrivalEligible);
  summary.overallRate = buildPercentValue(summary.passRows, summary.eligibleRows);
  summary.trend = [...trendMap.values()]
    .sort(function (left, right) {
      return String(left.day).localeCompare(String(right.day));
    })
    .map(function (entry) {
      return {
        ...entry,
        passRate: buildPercentValue(entry.passRows, entry.eligibleRows),
      };
    });
  summary.byWarehouse = [...warehouseMap.values()]
    .map(function (entry) {
      const { trendMap, ...rest } = entry;
      const trend = [...trendMap.values()]
        .sort(function (left, right) {
          return String(left.day).localeCompare(String(right.day));
        })
        .map(function (t) {
          return {
            day: t.day,
            whArrivalTimeRate: buildPercentValue(t.whArrivalTimePass, t.whArrivalTimeEligible),
            whArrivalTempRate: buildPercentValue(t.whArrivalTempPass, t.whArrivalTempEligible),
            podArrivalRate: buildPercentValue(t.podArrivalPass, t.podArrivalEligible),
          };
        });
      return {
        ...rest,
        trend,
        overallRate: buildPercentValue(entry.passRows, entry.eligibleRows),
        whArrivalTimeRate: buildPercentValue(entry.whArrivalTimePass, entry.whArrivalTimeEligible),
        whArrivalTempRate: buildPercentValue(entry.whArrivalTempPass, entry.whArrivalTempEligible),
        podArrivalRate: buildPercentValue(entry.podArrivalPass, entry.podArrivalEligible),
      };
    })
    .sort(function (left, right) {
      return (right.eligibleRows || 0) - (left.eligibleRows || 0)
        || (right.passRows || 0) - (left.passRows || 0)
        || String(left.warehouse || '').localeCompare(String(right.warehouse || ''));
    });
  return summary;
}

async function buildAstroReportPayload(searchParams) {
  const range = parseDateRange(searchParams);
  if (range.rangeStartMs === null || range.rangeEndMs === null) {
    throw new Error('startDate and endDate are required for Astro report.');
  }

  const startDate = searchParams.get('startDate') || searchParams.get('start') || formatLocalDay(range.rangeStartMs);
  const endDate = searchParams.get('endDate') || searchParams.get('end') || formatLocalDay(range.rangeEndMs);
  const accountId = String(searchParams.get('accountId') || 'all').trim() || 'all';
  const routeId = String(searchParams.get('routeId') || '').trim();
  const unitId = String(searchParams.get('unitId') || '').trim().toUpperCase();
  const summaryOnly = String(searchParams.get('summaryOnly') || '').trim() === '1';
  const activeRoutes = (config.astroRoutes || []).filter(function (route) {
    if (routeId && String(route.id || '').trim() !== routeId) {
      return false;
    }
    if (!routeId && route.isActive === false) {
      return false;
    }
    if (accountId !== 'all' && String(route.accountId || 'primary') !== accountId) {
      return false;
    }
    if (unitId && String(route.unitId || '').trim().toUpperCase() !== unitId) {
      return false;
    }
    return true;
  });

  const rows = [];
  const warnings = [];
  const diagnostics = [];
  const paddedStart = range.rangeStartMs - (24 * 60 * 60 * 1000);
  const paddedEnd = range.rangeEndMs + (24 * 60 * 60 * 1000);

  const requestedFetchDelayMs = Number(searchParams.get('fetchDelayMs') || '');
  const ASTRO_FETCH_DELAY_MS = Number.isFinite(requestedFetchDelayMs) && requestedFetchDelayMs >= 0
    ? requestedFetchDelayMs
    : 10000; // default 10 detik jeda per nopol supaya vendor API ga crash
  let routeIndex = 0;

  for (const route of activeRoutes) {
    routeIndex++;
    const accountConfig = getAccountConfigById(route.accountId || 'primary');
    if (!accountConfig) {
      warnings.push('Account Astro route tidak ditemukan untuk ' + route.unitId + '.');
      continue;
    }
    if (!accountConfig.sessionCookie) {
      warnings.push('Session Solofleet belum ada untuk ' + (accountConfig.label || accountConfig.id) + '.');
      continue;
    }

    // Rate-limit: jeda 10 detik antar nopol (skip delay di nopol pertama)
    if (routeIndex > 1 && ASTRO_FETCH_DELAY_MS > 0) {
      console.log(`[AstroReport] Waiting ${ASTRO_FETCH_DELAY_MS / 1000}s before fetching ${route.unitId} (${routeIndex}/${activeRoutes.length})...`);
      await new Promise(resolve => setTimeout(resolve, ASTRO_FETCH_DELAY_MS));
    }

    try {
      console.log(`[AstroReport] Fetching ${route.unitId} (${routeIndex}/${activeRoutes.length})...`);
      const resolvedRouteUnitId = resolveAstroUnitId(accountConfig, route.unitId) || route.unitId;
      const history = await fetchUnitHistory(accountConfig, resolvedRouteUnitId, paddedStart, paddedEnd);
      const unitLabel = resolveAstroUnitLabel(accountConfig, resolvedRouteUnitId) || route.unitId;
      const routeDiagnostics = astroCore.buildRouteReportRows(route, config.astroLocations || [], history.records || [])
        .filter(function (row) {
          return row.serviceDate >= startDate && row.serviceDate <= endDate;
        })
        .map(function (row) {
          return {
            ...row,
            accountLabel: accountConfig.label || accountConfig.id,
            unitLabel,
          };
        });
      const routeRows = buildAstroDisplayRows(route, accountConfig, unitLabel, routeDiagnostics, startDate, endDate)
        .map(function (row) {
          return {
            ...row,
            kpi: evaluateAstroKpiRow(route, row),
          };
        });
      const completeServiceDates = new Set(routeDiagnostics.filter(function (row) {
        return row.status === 'complete';
      }).map(function (row) {
        return String(row.serviceDate || '');
      }).filter(Boolean));
      const incompleteRows = routeDiagnostics.filter(function (row) {
        if (row.status === 'complete') {
          return false;
        }
        if (row.status === 'outside_window' && completeServiceDates.has(String(row.serviceDate || ''))) {
          return false;
        }
        return true;
      });
      if (!routeDiagnostics.length) {
        warnings.push(route.unitId + ' (' + (accountConfig.label || accountConfig.id) + '): historical ada, tapi belum ketemu visit Astro yang valid di range ini.');
        diagnostics.push({
          serviceDate: '-',
          rit: '-',
          accountId: route.accountId || 'primary',
          accountLabel: accountConfig.label || accountConfig.id,
          unitId: route.unitId,
          unitLabel,
          status: 'no_valid_visit',
          reason: 'Historical ada, tapi belum ketemu visit Astro yang valid di range ini.',
          missingPodName: '',
        });
      }
      routeRows.filter(function (row) {
        return row.status === 'no_snapshot';
      }).forEach(function (row) {
        diagnostics.push({
          serviceDate: row.serviceDate || '-',
          rit: row.rit || '-',
          accountId: row.accountId || route.accountId || 'primary',
          accountLabel: accountConfig.label || accountConfig.id,
          unitId: row.unitId || route.unitId,
          unitLabel: row.unitLabel || unitLabel,
          status: row.status,
          reason: row.reason,
          missingPodName: '',
        });
      });
      incompleteRows.forEach(function (row) {
        const ritLabel = row.rit && row.rit !== '-' ? row.rit : 'No rit';
        const reason = row.status === 'missing_pod'
          ? (row.reason + ' Missing: ' + (row.missingPodName || '-'))
          : row.reason;
        diagnostics.push({
          serviceDate: row.serviceDate || '-',
          rit: ritLabel,
          accountId: row.accountId || route.accountId || 'primary',
          accountLabel: accountConfig.label || accountConfig.id,
          unitId: row.unitId || route.unitId,
          unitLabel: row.unitLabel || unitLabel,
          status: row.status || 'incomplete',
          reason: reason,
          missingPodName: row.missingPodName || '',
        });
      });
      incompleteRows.slice(0, 5).forEach(function (row) {
        const ritLabel = row.rit && row.rit !== '-' ? row.rit : 'No rit';
        const reason = row.status === 'missing_pod'
          ? (row.reason + ' Missing: ' + (row.missingPodName || '-'))
          : row.reason;
        warnings.push(row.unitId + ' (' + (accountConfig.label || accountConfig.id) + ') | ' + ritLabel + ' | ' + reason);
      });
      if (incompleteRows.length > 5) {
        warnings.push(route.unitId + ' (' + (accountConfig.label || accountConfig.id) + '): ' + (incompleteRows.length - 5) + ' diagnostic row(s) lain tidak ditampilkan.');
      }
      rows.push(...routeRows);
    } catch (error) {
      warnings.push(route.unitId + ' (' + (accountConfig.label || accountConfig.id) + '): ' + error.message);
      diagnostics.push({
        serviceDate: '-',
        rit: '-',
        accountId: route.accountId || 'primary',
        accountLabel: accountConfig.label || accountConfig.id,
        unitId: route.unitId,
        unitLabel: resolveAstroUnitLabel(accountConfig, route.unitId),
        status: 'request_error',
        reason: error.message,
        missingPodName: '',
      });
    }
  }

  rows.sort(function (left, right) {
    return String(right.serviceDate || '').localeCompare(String(left.serviceDate || ''))
      || String(left.rit || '').localeCompare(String(right.rit || ''))
      || String(left.accountLabel || left.accountId).localeCompare(String(right.accountLabel || right.accountId))
      || String(left.unitId || '').localeCompare(String(right.unitId || ''));
  });

  diagnostics.sort(function (left, right) {
    return String(right.serviceDate || '').localeCompare(String(left.serviceDate || ''))
      || String(left.unitId || '').localeCompare(String(right.unitId || ''))
      || String(left.rit || '').localeCompare(String(right.rit || ''));
  });

  const columnMeta = astroCore.buildAstroColumns(rows);
  const kpiSummary = buildAstroKpiSummary(rows);
  const flatRows = rows.map(function (row) {
    return astroCore.flattenAstroRow(row, { maxPods: columnMeta.maxPods });
  });
  const responseRows = summaryOnly ? [] : rows;
  const responseFlatRows = summaryOnly ? [] : flatRows;
  const responseDiagnostics = summaryOnly ? [] : diagnostics;

  return {
    ok: true,
    rangeStartMs: range.rangeStartMs,
    rangeEndMs: range.rangeEndMs,
    filters: {
      accountId,
      routeId,
      unitId,
      startDate,
      endDate,
      summaryOnly,
    },
    columns: columnMeta.columns,
    rows: responseRows,
    flatRows: responseFlatRows,
    warnings,
    diagnostics: responseDiagnostics,
    trend: kpiSummary.trend,
    summary: {
      configuredRoutes: activeRoutes.length,
      rows: rows.length,
      maxPods: columnMeta.maxPods,
      accounts: new Set(rows.map(function (row) { return row.accountId; })).size,
      units: new Set(rows.map(function (row) { return row.accountId + '::' + row.unitId; })).size,
      warnings: warnings.length,
      partialRows: diagnostics.length,
      kpi: kpiSummary,
    },
  };
}

function mergeRecords(existingRecords, incomingRecords, now) {
  const cutoff = now - config.historyRetentionDays * 24 * 60 * 60 * 1000;
  const merged = new Map();

  for (const record of existingRecords) {
    if (record.timestamp >= cutoff) {
      merged.set(record.timestamp, record);
    }
  }

  for (const record of incomingRecords) {
    if (record.timestamp >= cutoff) {
      merged.set(record.timestamp, record);
    }
  }

  return [...merged.values()].sort(function (left, right) {
    return left.timestamp - right.timestamp;
  });
}

function extractFetchedRecords(payload, unit) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.detail)
      ? payload.detail
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  const vehicleInfo = payload && typeof payload === 'object' && !Array.isArray(payload) && payload.vehicleinfo
    ? payload.vehicleinfo
    : {};

  const fallbackVehicle = String(vehicleInfo.vehicleid || vehicleInfo.alias || unit.label || unit.id);

  const records = source.map(function (row) {
    const timestamp = toTimestampMaybe(
      row.gpstime ||
      row.gpsdatetime ||
      row.datetime ||
      row.timestamp ||
      row.time ||
      '',
    );

    if (!Number.isFinite(timestamp)) {
      return null;
    }

    return {
      timestamp,
      vehicle: String(row.vehicleid || row.vehicle || fallbackVehicle),
      speed: toNumber(row.spd ?? row.speed ?? row.gpsspeed),
      temp1: toNumber(row.vtemp1 ?? row.virtualtemp1 ?? row.temp1),
      temp2: toNumber(row.vtemp2 ?? row.virtualtemp2 ?? row.temp2),
      latitude: toNumber(row.y ?? row.lat ?? row.latitude),
      longitude: toNumber(row.x ?? row.lng ?? row.longtitude ?? row.longitude),
      locationSummary: buildLocationSummary([
        row.stn,
        row.subd,
        row.dnm,
        row.city,
        row.province,
      ]),
      zoneName: String(row.zonename || '').trim(),
      powerSupply: toNumber(row.powersupply),
    };
  }).filter(Boolean);

  records.sort(function (left, right) {
    return left.timestamp - right.timestamp;
  });

  return {
    vehicle: fallbackVehicle,
    records,
  };
}

async function fetchUnitData(accountConfig, unit) {
  const endpointUrl = new URL(config.endpointPath, config.solofleetBaseUrl);
  const refererUrl = new URL(config.refererPath, config.solofleetBaseUrl);
  const now = Date.now();
  const body = {
    ddl: unit.id,
    startdatetime: new Date(now - config.requestLookbackMinutes * 60 * 1000).toISOString(),
    enddatetime: new Date(now).toISOString(),
    interval: config.requestIntervalSeconds,
    tempprofile: config.tempProfile,
    temperatureprocessing: config.temperatureProcessing,
    ArchiveType: config.archiveType,
  };

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'content-type': 'application/json; charset=UTF-8',
      referer: String(refererUrl),
      cookie: accountConfig.sessionCookie,
      'x-requested-with': 'XMLHttpRequest',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
  }

  if (/<!doctype html|<html/i.test(text)) {
    throw new Error('Solofleet returned HTML instead of JSON. Session cookie may be expired.');
  }

  const payload = core.parsePossiblyDoubleEncodedJson(text);
  return extractFetchedRecords(payload, unit);
}

async function fetchUnitHistoryChunk(accountConfig, unitId, rangeStartMs, rangeEndMs) {
  const endpointUrl = new URL(config.historicalEndpointPath || config.endpointPath, config.solofleetBaseUrl);
  const refererUrl = new URL(config.refererPath, config.solofleetBaseUrl);
  const body = {
    ddl: String(unitId || '').toLowerCase(),
    startdatetime: new Date(rangeStartMs).toISOString(),
    enddatetime: new Date(rangeEndMs).toISOString(),
    interval: config.requestIntervalSeconds,
    tempprofile: config.tempProfile,
    temperatureprocessing: config.temperatureProcessing,
    ArchiveType: config.archiveType,
  };

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'content-type': 'application/json; charset=UTF-8',
      referer: String(refererUrl),
      cookie: accountConfig.sessionCookie,
      'x-requested-with': 'XMLHttpRequest',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let cleanErrorText = text.slice(0, 130).replace(/[\r\n]+/g, ' ').trim();
  if (/<!doctype html|<html/i.test(text)) {
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      cleanErrorText = `External Server Error: ${titleMatch[1].trim()}`;
    } else {
      cleanErrorText = 'External Server returned HTML instead of JSON.';
    }
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${cleanErrorText}`);
  }
  if (/<!doctype html|<html/i.test(text)) {
    throw new Error(`Session cookie may be expired (HTML result): ${cleanErrorText}`);
  }

  const payload = core.parsePossiblyDoubleEncodedJson(text);
  return extractFetchedRecords(payload, { id: unitId, label: unitId });
}

async function fetchUnitHistory(accountConfig, unitId, rangeStartMs, rangeEndMs) {
  const safeStartMs = Number(rangeStartMs);
  const safeEndMs = Number(rangeEndMs);
  if (!Number.isFinite(safeStartMs) || !Number.isFinite(safeEndMs) || safeEndMs < safeStartMs) {
    return {
      vehicle: String(unitId || ''),
      records: [],
    };
  }

  const chunkMs = 5 * 24 * 60 * 60 * 1000;
  const mergedRecords = new Map();
  let resolvedVehicle = String(unitId || '');

  for (let chunkStart = safeStartMs; chunkStart <= safeEndMs; chunkStart += chunkMs) {
    const chunkEnd = Math.min(safeEndMs, chunkStart + chunkMs - 1);
    const history = await fetchUnitHistoryChunk(accountConfig, unitId, chunkStart, chunkEnd);
    if (history.vehicle) {
      resolvedVehicle = history.vehicle;
    }
    for (const record of history.records || []) {
      if (!record || !Number.isFinite(record.timestamp)) {
        continue;
      }
      mergedRecords.set(record.timestamp, record);
    }
  }

  return {
    vehicle: resolvedVehicle,
    records: [...mergedRecords.values()].sort(function (left, right) {
      return left.timestamp - right.timestamp;
    }),
  };
}

async function fetchStopReport(accountConfig, unitId, options) {
  const endpointUrl = new URL('/ReportStop/getVehicleStopReportJson', config.solofleetBaseUrl);
  const refererUrl = new URL('/ReportStop', config.solofleetBaseUrl);
  const body = {
    ddl: unitId,
    startdatetime: new Date(options.rangeStartMs).toISOString(),
    enddatetime: new Date(options.rangeEndMs).toISOString(),
    reporttype: String(options.reportType || '3'),
    minduration: String(options.minDurationMinutes || '0'),
    excludezoneid: options.excludeZoneId ?? '',
    processlive: String(options.processLive || '1'),
    withtrack: options.withTrack === 'withouttrack' ? 'withouttrack' : 'withtrack',
  };

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'content-type': 'application/json; charset=UTF-8',
      referer: String(refererUrl),
      cookie: accountConfig.sessionCookie,
      'x-requested-with': 'XMLHttpRequest',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
  }

  if (/<!doctype html|<html/i.test(text)) {
    throw new Error('Solofleet returned HTML instead of JSON. Session cookie may be expired.');
  }

  const payload = core.parsePossiblyDoubleEncodedJson(text);
  const detailGroups = Array.isArray(payload?.DetailPerAttribute) ? payload.DetailPerAttribute : [];
  const rows = detailGroups.flatMap(function (group) {
    const reportRows = Array.isArray(group.reportstoplist) ? group.reportstoplist : [];
    return reportRows.map(function (row) {
      const startTimestamp = toTimestampMaybe(row.groupedIP1offstart);
      const endTimestamp = toTimestampMaybe(row.groupedIP1offend);
      const durationSeconds = toNumber(row.groupedIP1offduration);
      const latitude = toNumber(row.latitude);
      const longitude = toNumber(row.longtitude ?? row.longitude);

      return {
        id: row.id ?? null,
        unitId: String(row.vehicleid || group.vehicleid || unitId),
        alias: String(row.vehiclealias || group.alias || '').trim(),
        locationSummary: String(row.groupedlocationplace || '').trim(),
        latitude,
        longitude,
        zoneName: String(row.zonename || '').trim(),
        zoneBoundary: String(row.zonenameboundary || '').trim(),
        startTimestamp,
        endTimestamp,
        durationSeconds,
        durationMinutes: durationSeconds === null ? null : durationSeconds / 60,
        movementDistance: toNumber(row.groupedmovementdistance),
        avgTemp: toNumber(row.groupedavgtemp),
        engineDetected: toNumber(row.groupedIP1detected),
        aux2Detected: toNumber(row.groupedIP2detected),
        aux3Detected: toNumber(row.groupedIP3detected),
        aux4Detected: toNumber(row.groupedIP4detected),
        tracePolyline: group.TRpolystring || null,
        googleMapsUrl: latitude !== null && longitude !== null
          ? `https://www.google.com/maps?q=${latitude},${longitude}`
          : null,
      };
    });
  });

  rows.sort(function (left, right) {
    return (right.startTimestamp || 0) - (left.startTimestamp || 0);
  });

  return {
    reportType: String(options.reportType || '3'),
    reportTypeLabel: stopReportTypeLabel(options.reportType || '3'),
    unitId,
    rows,
    summary: {
      incidents: rows.length,
      totalMinutes: rows.reduce(function (sum, row) {
        return sum + (row.durationMinutes || 0);
      }, 0),
      longestMinutes: rows.reduce(function (max, row) {
        return Math.max(max, row.durationMinutes || 0);
      }, 0),
      withLocation: rows.filter(function (row) {
        return row.latitude !== null && row.longitude !== null;
      }).length,
    },
  };
}

async function fetchSolofleetText(urlValue, options) {
  const response = await fetch(urlValue, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
  }

  return {
    text,
    finalUrl: response.url,
  };
}

function findRoleIdInHtml(html) {
  const patterns = [
    /["']roleid["']\s*[:=]\s*["']?(\d{1,12})["']?/i,
    /["']roleId["']\s*[:=]\s*["']?(\d{1,12})["']?/i,
    /\broleid\s*=\s*["']?(\d{1,12})["']?/i,
    /\broleId\s*=\s*["']?(\d{1,12})["']?/i,
  ];

  for (const pattern of patterns) {
    const matched = html.match(pattern);
    if (matched) {
      return matched[1];
    }
  }

  return null;
}

async function resolveVehicleRoleId(accountConfig) {
  if (accountConfig.vehicleRoleId) {
    return accountConfig.vehicleRoleId;
  }

  const vehiclePageUrl = new URL(config.vehiclePagePath, config.solofleetBaseUrl);
  const response = await fetchSolofleetText(vehiclePageUrl, {
    method: 'GET',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      cookie: accountConfig.sessionCookie,
      referer: config.solofleetBaseUrl,
    },
  });
  const html = response.text;

  if (/Account\/Login/i.test(html) || /Account\/Login/i.test(response.finalUrl || '')) {
    throw new Error('Vehicle page redirected to login. Session cookie may be expired.');
  }

  const roleId = findRoleIdInHtml(html);
  if (!roleId) {
    // HAR milik user menunjukkan roleid 3094 dipakai untuk discovery unit.
    return '3094';
  }

  return roleId;
}

function maybePushUnit(results, seen, idValue, labelValue) {
  const id = String(idValue || '').trim();
  if (!id) {
    return;
  }

  const normalizedId = id.toLowerCase();
  if (!/^col/i.test(id) && !/^olla$/i.test(id) && !/^\d{4,}$/.test(id)) {
    return;
  }

  if (seen.has(normalizedId)) {
    return;
  }

  const label = String(labelValue || id).trim() || id;
  seen.add(normalizedId);
  results.push({ id, label });
}

function discoverUnitsFromPayload(payload) {
  const results = [];
  const seen = new Set();
  const queue = [payload];

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    maybePushUnit(
      results,
      seen,
      current.ddl ?? current.DDL ?? current.value ?? current.selectorvalue ?? current.colid ?? current.vehicleid ?? current.vehicleId,
      current.alias ?? current.vehiclename ?? current.vehicleName ?? current.label ?? current.text ?? current.plate ?? current.description ?? current.vehicleid,
    );

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return results.sort(function (left, right) {
    return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
  });
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(text) {
  return decodeHtmlEntities(String(text || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function discoverUnitsFromHtml(html) {
  const results = [];
  const seen = new Set();
  const optionPattern = /<option[^>]*value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
  let matched = optionPattern.exec(html);

  while (matched) {
    maybePushUnit(results, seen, matched[1], stripHtml(matched[2]));
    matched = optionPattern.exec(html);
  }

  const objectPattern = /["'](?:value|ddl|colid)["']\s*:\s*["']([^"']+)["'][\s\S]{0,180}?["'](?:text|label|alias|vehicleid|description)["']\s*:\s*["']([^"']+)["']/gi;
  matched = objectPattern.exec(html);
  while (matched) {
    maybePushUnit(results, seen, matched[1], stripHtml(matched[2]));
    matched = objectPattern.exec(html);
  }

  return results.sort(function (left, right) {
    return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
  });
}

async function fetchDiscoveryPayload(accountConfig) {
  const roleId = await resolveVehicleRoleId(accountConfig);
  const discoveryUrl = new URL(config.discoveryEndpointPath, config.solofleetBaseUrl);
  const refererUrl = new URL(config.vehiclePagePath, config.solofleetBaseUrl);
  const response = await fetchSolofleetText(discoveryUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'content-type': 'application/json; charset=UTF-8',
      cookie: accountConfig.sessionCookie,
      origin: config.solofleetBaseUrl,
      referer: String(refererUrl),
      'x-requested-with': 'XMLHttpRequest',
    },
    body: JSON.stringify({
      type: 'json',
      roleid: roleId,
      source: 'web',
    }),
  });
  const text = response.text;

  if (/<!doctype html|<html/i.test(text)) {
    throw new Error('Discovery endpoint returned HTML instead of JSON.');
  }

  return {
    roleId,
    payload: core.parsePossiblyDoubleEncodedJson(text),
  };
}

function extractFleetVehiclesFromPayload(payload) {
  const vehicles = {};
  const queue = [payload];

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const normalized = normalizeFleetVehicle(current);
    if (normalized) {
      vehicles[normalized.unitKey] = normalized;
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return vehicles;
}

async function refreshFleetSnapshot(accountId) {
  const accountConfig = getAccountConfigById(accountId || 'primary');
  const accountState = ensureAccountState(accountId || 'primary');
  if (!accountConfig || !accountConfig.sessionCookie) {
    throw new Error('Session cookie is empty. Save a valid Solofleet cookie first.');
  }

  const discovery = await fetchDiscoveryPayload(accountConfig);
  const vehicles = extractFleetVehiclesFromPayload(discovery.payload);
  accountState.fleet = {
    fetchedAt: new Date().toISOString(),
    lastError: null,
    vehicles,
  };
  accountState.runtime.lastSnapshotAt = accountState.fleet.fetchedAt;
  accountState.runtime.lastSnapshotError = null;
  if ((accountId || 'primary') === 'primary') {
    config.vehicleRoleId = discovery.roleId;
  } else {
    const linkedAccount = getAccountConfigById(accountId);
    if (linkedAccount) {
      linkedAccount.vehicleRoleId = discovery.roleId;
    }
  }

  return {
    roleId: discovery.roleId,
    vehicles,
  };
}

function stopReportTypeLabel(reportType) {
  if (String(reportType) === '1') {
    return 'Stop Engine Report';
  }
  if (String(reportType) === '2') {
    return 'Idle Engine Report';
  }
  return 'Speed-based idle/stop Report';
}

async function discoverUnits(accountId) {
  const resolvedAccountId = accountId || config.activeAccountId || 'primary';
  const accountConfig = getAccountConfigById(resolvedAccountId);
  const accountState = ensureAccountState(resolvedAccountId);
  if (!accountConfig || !accountConfig.sessionCookie) {
    throw new Error('Session cookie is empty. Save a valid Solofleet cookie first.');
  }

  const discovery = await fetchDiscoveryPayload(accountConfig);
  accountState.fleet = {
    fetchedAt: new Date().toISOString(),
    lastError: null,
    vehicles: extractFleetVehiclesFromPayload(discovery.payload),
  };
  accountState.runtime.lastSnapshotAt = accountState.fleet.fetchedAt;
  accountState.runtime.lastSnapshotError = null;
  const roleId = discovery.roleId;
  let units = discoverUnitsFromPayload(discovery.payload);

  if (!units.length) {
    const reportPageUrl = new URL(config.refererPath, config.solofleetBaseUrl);
    const reportPageResponse = await fetchSolofleetText(reportPageUrl, {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        cookie: accountConfig.sessionCookie,
        referer: config.solofleetBaseUrl,
      },
    });

    if (!/Account\/Login/i.test(reportPageResponse.finalUrl || '')) {
      units = discoverUnitsFromHtml(reportPageResponse.text);
    }
  }

  if (!units.length) {
    units = Object.values(accountState.fleet.vehicles || {}).map(function (vehicle) {
      return normalizeUnit({
        id: vehicle.unitId,
        label: vehicle.alias || vehicle.unitId,
      });
    }).filter(Boolean).sort(function (left, right) {
      return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
    });
  }

  if (!units.length) {
    throw new Error('Belum berhasil baca daftar unit dari response discovery.');
  }

  const existingUnitMap = new Map((accountConfig.units || []).map(function (unit) {
    return [normalizeUnitKey(unit.id), normalizeUnitCategory(unit.category)];
  }));
  units = units.map(function (unit) {
    return normalizeUnit({
      ...unit,
      category: existingUnitMap.get(normalizeUnitKey(unit.id)) || unit.category || 'uncategorized',
    });
  }).filter(Boolean);

  if (resolvedAccountId === 'primary') {
    config.vehicleRoleId = roleId;
    config.units = units;
  } else {
    const linkedAccount = getAccountConfigById(resolvedAccountId);
    if (linkedAccount) {
      linkedAccount.vehicleRoleId = roleId;
      linkedAccount.units = units;
    }
  }
  config = normalizeConfig(config);
  syncUnitsWithConfig();
  recomputeAllAnalyses();
  saveConfig();
  saveState();

  return {
    roleId,
    units,
    dailySnapshots: accountState.dailySnapshots || [],
  };
}

async function pollSingleUnit(accountConfig, accountState, unit) {
  const unitState = accountState.units[unit.id] || normalizeUnitState(unit.id, { label: unit.label, vehicle: unit.label });
  accountState.units[unit.id] = unitState;
  unitState.label = unit.label;
  unitState.lastFetchStartedAt = new Date().toISOString();
  unitState.lastError = null;

  try {
    const fetched = await fetchUnitData(accountConfig, unit);
    const now = Date.now();
    unitState.vehicle = fetched.vehicle || unitState.vehicle || unit.label || unit.id;
    unitState.records = mergeRecords(unitState.records, fetched.records, now);
    unitState.lastFetchCompletedAt = new Date().toISOString();
    unitState.lastSuccessAt = unitState.lastFetchCompletedAt;
    unitState.analysis = buildAnalysisFromRecords(unitState);
  } catch (error) {
    unitState.lastFetchCompletedAt = new Date().toISOString();
    unitState.lastError = error.message;
    unitState.analysis = buildAnalysisFromRecords(unitState);
    throw error;
  }
}

function scheduleNextPoll() {
  clearTimeout(pollTimer);
  pollTimer = null;
  if (!state.runtime.isPolling) {
    state.runtime.nextRunAt = null;
    return;
  }

  const intervalMs = config.pollIntervalSeconds * 1000;
  const now = Date.now();
  const nextRunMs = Math.ceil(now / intervalMs) * intervalMs;
  const delayMs = Math.max(1000, nextRunMs - now);
  state.runtime.nextRunAt = new Date(now + delayMs).toISOString();
  pollTimer = setTimeout(function () {
    runPollCycle('scheduled').catch(function (error) {
      state.runtime.lastRunMessage = error.message;
      scheduleNextPoll();
      scheduleNextRemoteReset();
    });
  }, delayMs);
}

let astroSnapshotTimer = null;
let isFirstAstroSnapshot = true;

function scheduleNextAstroSnapshot() {
  clearTimeout(astroSnapshotTimer);
  astroSnapshotTimer = null;
  if (!state.runtime.isPolling) {
    return;
  }
  const intervalMs = 3 * 60 * 60 * 1000; // Every 3 hours
  const delayMs = isFirstAstroSnapshot ? 5000 : intervalMs; // Run after 5s on first boot
  astroSnapshotTimer = setTimeout(function () {
    const nowMs = Date.now();
    const startMs = isFirstAstroSnapshot ? nowMs - (4 * 24 * 60 * 60 * 1000) : nowMs - (24 * 60 * 60 * 1000);
    isFirstAstroSnapshot = false;
    syncAstroSnapshots(startMs, nowMs).catch((e) => console.error('[AstroSync]', e.message)).finally(scheduleNextAstroSnapshot);
  }, delayMs);
}

function pushAstroSnapshotLog(entry) {
  astroSnapshotLogs.unshift({ timestamp: Date.now(), ...entry });
  if (astroSnapshotLogs.length > ASTRO_SNAPSHOT_LOG_LIMIT) {
    astroSnapshotLogs.length = ASTRO_SNAPSHOT_LOG_LIMIT;
  }
}

async function syncAstroSnapshots(rangeStartMs, rangeEndMs, options) {
  const syncOptions = options || {};
  const skipExistingDays = syncOptions.skipExistingDays !== false;
  if (!getPostgresConfig().enabled) {
    pushAstroSnapshotLog({ type: 'astro-sync', result: 'skipped', message: 'Postgres not enabled', unitCount: 0, podCount: 0, startDate: '', endDate: '' });
    return { ok: false, message: 'Postgres not enabled' };
  }
  const isSnapshotEligibleRow = function (row) {
    return Number(row.pass_count || 0) > 0
      || row.status === 'request_error'
      || Number(row.fail_count || 0) > 0
      || Boolean(row.wh_time_kpi)
      || Boolean(row.wh_temp_kpi)
      || Boolean(row.pod_kpi);
  };
  const SNAPSHOT_FETCH_DELAY_MS = 20000;
  const activeRoutes = (config.astroRoutes || []).filter(function (route) {
    return route.isActive !== false;
  });
  const routesByAccountUnit = new Map();
  for (const route of activeRoutes) {
    const routeKey = `${route.accountId || 'primary'}::${String(route.unitId || '').trim().toUpperCase()}`;
    if (!routesByAccountUnit.has(routeKey)) {
      routesByAccountUnit.set(routeKey, []);
    }
    routesByAccountUnit.get(routeKey).push(route);
  }
  let effectiveStartMs = rangeStartMs;
  if (skipExistingDays) {
    const legacySnapshotResult = await postgresQuery(
      `select min(day)::text as earliest_day
       from astro_route_snapshots
       where not (
         id like '%::rit1'
         or id like '%::rit2'
         or id like '%::request_error'
         or id like '%::na'
       )`
    );
    const earliestLegacyDay = String(legacySnapshotResult.rows?.[0]?.earliest_day || '').trim();
    if (earliestLegacyDay) {
      const earliestLegacyMs = toTimestampMaybe(`${earliestLegacyDay}T00:00:00.000Z`);
      if (Number.isFinite(earliestLegacyMs)) {
        effectiveStartMs = Math.min(effectiveStartMs, earliestLegacyMs);
      }
    }
  }
  const startDay = new Date(formatLocalDay(effectiveStartMs) + 'T00:00:00Z');
  const endDay = new Date(formatLocalDay(rangeEndMs) + 'T00:00:00Z');
  const todayStr = formatLocalDay(Date.now());
  
  const insertRows = [];
  const seenSnapshotIds = new Set();
  const dayBreakdown = [];
  const pushSnapshotRow = function (row) {
    if (!row || !row.id || seenSnapshotIds.has(row.id)) {
      return;
    }
    seenSnapshotIds.add(row.id);
    insertRows.push(row);
  };
  
  // Iterate through each day in range
  for (let d = startDay.getTime(); d <= endDay.getTime(); d += 24 * 60 * 60 * 1000) {
    const dayStr = formatLocalDay(d);
    if (skipExistingDays && dayStr !== todayStr) {
      const existingSnapshotResult = await postgresQuery(
        `select
          count(*)::int as count,
          count(*) filter (
            where id like '%::rit1'
               or id like '%::rit2'
               or id like '%::request_error'
               or id like '%::na'
          )::int as modern_count
         from astro_route_snapshots
         where day = $1`,
        [dayStr]
      );
      const existingSnapshotCount = Number(existingSnapshotResult.rows?.[0]?.count || 0);
      const modernSnapshotCount = Number(existingSnapshotResult.rows?.[0]?.modern_count || 0);
      const hasLegacySnapshotRows = existingSnapshotCount > 0 && modernSnapshotCount < existingSnapshotCount;
      if (existingSnapshotCount > 0 && !hasLegacySnapshotRows) {
        dayBreakdown.push({
          day: dayStr,
          rows: 0,
          activeRows: 0,
          eligibleRows: 0,
          requestErrorRows: 0,
          whCaptured: 0,
          podCaptured: [],
          skipped: true,
          skippedReason: 'existing_snapshot',
          existingRows: existingSnapshotCount,
        });
        pushAstroSnapshotLog({
          type: 'astro-sync-day',
          result: 'skipped',
          message: `Snapshot ${dayStr}: skip, sudah ada ${existingSnapshotCount} row di PostgreSQL`,
          unitCount: 0,
          activeUnitCount: 0,
          eligibleUnitCount: 0,
          podCount: 0,
          rowCount: 0,
          activeRowCount: 0,
          eligibleRowCount: 0,
          startDate: dayStr,
          endDate: dayStr,
          dayBreakdown: [{
            day: dayStr,
            rows: 0,
            activeRows: 0,
            eligibleRows: 0,
            requestErrorRows: 0,
            whCaptured: 0,
            podCaptured: [],
            skipped: true,
            skippedReason: 'existing_snapshot',
            existingRows: existingSnapshotCount,
          }],
        });
        continue;
      }
      if (hasLegacySnapshotRows) {
        await postgresQuery('delete from astro_route_snapshots where day = $1', [dayStr]);
        pushAstroSnapshotLog({
          type: 'astro-sync-day',
          result: 'warning',
          message: `Snapshot ${dayStr}: hapus ${existingSnapshotCount} legacy row, rebuild dengan format baru`,
          unitCount: 0,
          activeUnitCount: 0,
          eligibleUnitCount: 0,
          podCount: 0,
          rowCount: existingSnapshotCount,
          activeRowCount: 0,
          eligibleRowCount: 0,
          startDate: dayStr,
          endDate: dayStr,
          dayBreakdown: [{
            day: dayStr,
            rows: 0,
            activeRows: 0,
            eligibleRows: 0,
            requestErrorRows: 0,
            whCaptured: 0,
            podCaptured: [],
            skipped: false,
            skippedReason: '',
            existingRows: existingSnapshotCount,
            rebuildingLegacy: true,
          }],
        });
      }
    }

    console.log(`[AstroSnapshot] Processing ${dayStr}...`);
    const searchParams = new URLSearchParams();
    searchParams.set('startDate', dayStr);
    searchParams.set('endDate', dayStr);
    searchParams.set('summaryOnly', '0');
    searchParams.set('fetchDelayMs', String(SNAPSHOT_FETCH_DELAY_MS));
    const payload = await buildAstroReportPayload(searchParams);
    const dayRows = (payload.rows || []).filter(function (row) {
      return String(row.serviceDate || '') === dayStr;
    });
    const dayDiagnostics = (payload.diagnostics || []).filter(function (entry) {
      return String(entry.serviceDate || '') === dayStr || String(entry.serviceDate || '') === '-';
    });

    const summary = {
      day: dayStr,
      rows: 0,
      activeRows: 0,
      eligibleRows: 0,
      requestErrorRows: 0,
      whCaptured: 0,
      podCaptured: [],
    };

    for (const row of dayRows) {
      const whTimeStatus = row.kpi?.whArrivalTime?.eligible ? row.kpi.whArrivalTime.status : null;
      const whTempStatus = row.kpi?.whArrivalTemp?.eligible ? row.kpi.whArrivalTemp.status : null;
      const podStatuses = (row.kpi?.podArrivalTimes || []).filter(function (entry) {
        return entry && entry.eligible && entry.status;
      }).map(function (entry) {
        return entry.status;
      });
      const whKpi = whTimeStatus === 'fail' || whTempStatus === 'fail'
        ? 'fail'
        : (whTimeStatus === 'pass' || whTempStatus === 'pass' ? 'pass' : null);
      const podKpi = podStatuses.includes('fail')
        ? 'fail'
        : (podStatuses.includes('pass') ? 'pass' : null);
      const overallStatus = row.kpi?.overallEligible ? (row.kpi?.overallStatus || null) : null;

      pushSnapshotRow({
        id: `${dayStr}::${row.accountId || 'primary'}::${row.unitId}::${row.routeId || 'unknown-route'}::${row.ritKey || row.rit || 'na'}`,
        day: dayStr,
        account_id: row.accountId || 'primary',
        account_label: row.accountLabel || row.accountId || 'primary',
        unit_id: row.unitId,
        unit_label: row.unitLabel || row.unitId,
        customer_name: row.customer || 'Astro',
        route_id: row.routeId || '',
        warehouse_name: row.whName || 'WH',
        status: row.status || 'no_snapshot',
        reason: row.reason || '',
        wh_kpi: whKpi,
        pod_kpi: podKpi,
        wh_time_kpi: whTimeStatus,
        wh_temp_kpi: whTempStatus,
        rit: row.rit || '-',
        pod_count: Array.isArray(row.pods) ? row.pods.length : 0,
        pass_count: overallStatus === 'pass' ? 1 : 0,
        fail_count: overallStatus === 'fail' ? 1 : 0,
      });

      summary.rows += 1;
      if (row.status && row.status !== 'no_snapshot') {
        summary.activeRows += 1;
      }
      if (row.kpi?.overallEligible) {
        summary.eligibleRows += 1;
      }
      if (row.whEta) {
        summary.whCaptured += 1;
      }
      (row.pods || []).forEach(function (pod, index) {
        if (pod?.eta) {
          summary.podCaptured[index] = (summary.podCaptured[index] || 0) + 1;
        }
      });
    }

    for (const entry of dayDiagnostics) {
      if (entry.status !== 'request_error') {
        continue;
      }
      const routeKey = `${entry.accountId || 'primary'}::${String(entry.unitId || '').trim().toUpperCase()}`;
      const matchingRoutes = routesByAccountUnit.get(routeKey) || [];
      for (const route of matchingRoutes) {
        const accountConfig = getAccountConfigById(route.accountId || 'primary');
        const unitLabel = resolveAstroUnitLabel(accountConfig, route.unitId) || route.unitId;
        const whName = (config.astroLocations || []).find(function (location) {
          return location.id === route.whLocationId;
        })?.name || 'WH';
        pushSnapshotRow({
          id: `${dayStr}::${route.accountId || 'primary'}::${route.unitId}::${route.id || 'unknown-route'}::request_error`,
          day: dayStr,
          account_id: route.accountId || 'primary',
          account_label: accountConfig?.label || route.accountId || 'primary',
          unit_id: route.unitId,
          unit_label: unitLabel,
          customer_name: route.customerName || 'Astro',
          route_id: route.id || '',
          warehouse_name: whName,
          status: 'request_error',
          reason: entry.reason || 'Request error',
          wh_kpi: null,
          pod_kpi: null,
          wh_time_kpi: null,
          wh_temp_kpi: null,
          rit: entry.rit || '-',
          pod_count: 0,
          pass_count: 0,
          fail_count: 1,
        });
        summary.requestErrorRows += 1;
      }
    }

    dayBreakdown.push(summary);
    pushAstroSnapshotLog({
      type: 'astro-sync-day',
      result: 'success',
      message: `Snapshot ${dayStr}: ${summary.activeRows} row aktif, ${summary.eligibleRows} eligible KPI, WH ${summary.whCaptured}, error ${summary.requestErrorRows}`,
      unitCount: new Set(dayRows.map(function (row) { return row.unitId; })).size,
      activeUnitCount: new Set(dayRows.filter(function (row) { return row.status && row.status !== 'no_snapshot'; }).map(function (row) { return row.unitId; })).size,
      eligibleUnitCount: new Set(dayRows.filter(function (row) { return row.kpi?.overallEligible; }).map(function (row) { return row.unitId; })).size,
      podCount: summary.podCaptured.reduce(function (sum, count) { return sum + (count || 0); }, 0),
      rowCount: summary.rows,
      activeRowCount: summary.activeRows,
      eligibleRowCount: summary.eligibleRows,
      startDate: dayStr,
      endDate: dayStr,
      dayBreakdown: [summary],
    });
  }
  
  const uniqueUnits = new Set(insertRows.map(r => r.unit_id));
  const activeRows = insertRows.filter(function (row) { return row.status && row.status !== 'no_snapshot' && row.status !== 'request_error'; });
  const eligibleRows = insertRows.filter(isSnapshotEligibleRow);
  const uniqueActiveUnits = new Set(activeRows.map(r => r.unit_id));
  const uniqueEligibleUnits = new Set(eligibleRows.map(r => r.unit_id));
  const totalPodCount = insertRows.reduce((sum, r) => sum + (r.pod_count || 0), 0);

  if (insertRows.length > 0) {
    try {
      await postgresUpsertRows(
        'astro_route_snapshots',
        insertRows,
        [
          'id', 'day', 'account_id', 'account_label', 'unit_id', 'unit_label', 'customer_name', 
          'route_id', 'warehouse_name', 'status', 'reason', 'wh_kpi', 'pod_kpi', 'wh_time_kpi', 'wh_temp_kpi', 'rit', 
          'pod_count', 'pass_count', 'fail_count'
        ],
        ['id'],
        { touchUpdatedAt: true }
      );
      pushAstroSnapshotLog({
        type: 'astro-sync',
        result: 'success',
        message: `Berhasil simpan ${insertRows.length} row snapshot, ${uniqueUnits.size} unit discan, ${uniqueEligibleUnits.size} unit eligible KPI, ${eligibleRows.length} row eligible`,
        unitCount: uniqueUnits.size,
        activeUnitCount: uniqueActiveUnits.size,
        eligibleUnitCount: uniqueEligibleUnits.size,
        podCount: totalPodCount,
        rowCount: insertRows.length,
        activeRowCount: activeRows.length,
        eligibleRowCount: eligibleRows.length,
        startDate: formatLocalDay(rangeStartMs),
        endDate: formatLocalDay(rangeEndMs),
        dayBreakdown,
      });
    } catch (error) {
      pushAstroSnapshotLog({
        type: 'astro-sync',
        result: 'error',
        message: error.message || 'Upsert failed',
        unitCount: uniqueUnits.size,
        activeUnitCount: uniqueActiveUnits.size,
        eligibleUnitCount: uniqueEligibleUnits.size,
        podCount: totalPodCount,
        rowCount: insertRows.length,
        activeRowCount: activeRows.length,
        eligibleRowCount: eligibleRows.length,
        startDate: formatLocalDay(rangeStartMs),
        endDate: formatLocalDay(rangeEndMs),
        dayBreakdown,
      });
      throw error;
    }
  } else {
    pushAstroSnapshotLog({
      type: 'astro-sync',
      result: 'success',
      message: 'Tidak ada data snapshot untuk di-sync',
      unitCount: 0,
      activeUnitCount: 0,
      eligibleUnitCount: 0,
      podCount: 0,
      rowCount: 0,
      activeRowCount: 0,
      eligibleRowCount: 0,
      startDate: formatLocalDay(rangeStartMs),
      endDate: formatLocalDay(rangeEndMs),
      dayBreakdown: [],
    });
  }
  state.runtime.lastSnapshotAt = new Date().toISOString();
  return {
    ok: true,
    snapshotsSaved: insertRows.length,
    unitCount: uniqueUnits.size,
    activeUnitCount: uniqueActiveUnits.size,
    eligibleUnitCount: uniqueEligibleUnits.size,
    podCount: totalPodCount,
    activeRowCount: activeRows.length,
    eligibleRowCount: eligibleRows.length,
    skippedDays: dayBreakdown.filter(function (entry) { return entry.skipped; }).length,
    processedDays: dayBreakdown.filter(function (entry) { return !entry.skipped; }).length,
    dayBreakdown,
  };
}

async function runPollCycle(trigger) {
  if (pollInFlight) {
    return { skipped: true, message: 'Polling already in progress.' };
  }

  const runnableAccounts = getAllAccountConfigs().filter(function (account) {
    return account.sessionCookie && account.units.length;
  });
  if (!runnableAccounts.length) {
    throw new Error('No logged-in account with configured units. Add at least one Solofleet account and discover units.');
  }

  pollInFlight = true;
  const startedAt = Date.now();
  state.runtime.lastRunStartedAt = new Date(startedAt).toISOString();
  const totalUnitCount = runnableAccounts.reduce(function (sum, account) {
    return sum + account.units.length;
  }, 0);
  state.runtime.lastRunMessage = `Running ${trigger} poll for ${totalUnitCount} unit(s) across ${runnableAccounts.length} account(s).`;
  saveState();

  const refreshSettled = await Promise.allSettled(runnableAccounts.map(function (account) {
    return refreshFleetSnapshot(account.id);
  }));
  for (let index = 0; index < runnableAccounts.length; index += 1) {
    if (refreshSettled[index].status === 'rejected') {
      const accountState = ensureAccountState(runnableAccounts[index].id);
      accountState.fleet.lastError = refreshSettled[index].reason.message;
      accountState.runtime.lastSnapshotError = refreshSettled[index].reason.message;
    }
  }

  const settled = await Promise.allSettled(runnableAccounts.flatMap(function (account) {
    const accountState = ensureAccountState(account.id);
    return account.units.map(function (unit) {
      return pollSingleUnit(account, accountState, unit);
    });
  }));

  const successCount = settled.filter(function (item) { return item.status === 'fulfilled'; }).length;
  const failureCount = settled.length - successCount;
  const finishedAt = Date.now();

  state.runtime.lastRunFinishedAt = new Date(finishedAt).toISOString();
  state.runtime.lastRunDurationMs = finishedAt - startedAt;
  state.runtime.lastRunMessage = failureCount
    ? `Polling selesai: ${successCount} sukses, ${failureCount} gagal.`
    : `Polling selesai: ${successCount} unit sukses.`;

  recomputeAllAnalyses();
  for (const account of runnableAccounts) {
    const accountState = ensureAccountState(account.id);
    captureDailyErrorSnapshots(account, accountState);
    capturePodSnapshots(account, accountState, buildFleetRows(account, accountState, Date.now(), buildLiveAlerts(account, accountState, Date.now())));
  }
  saveState();
  pollInFlight = false;

  if (state.runtime.isPolling) {
    scheduleNextPoll();
    scheduleNextRemoteReset();
    saveState();
  }

  return {
    successCount,
    failureCount,
  };
}

async function startPolling() {
  state.runtime.isPolling = true;
  config.autoStart = true;
  saveConfig();
  saveState();
  await runPollCycle('manual-start');
}

function stopPolling() {
  state.runtime.isPolling = false;
  state.runtime.nextRunAt = null;
  config.autoStart = false;
  clearTimeout(pollTimer);
  pollTimer = null;
  clearTimeout(astroSnapshotTimer);
  astroSnapshotTimer = null;
  clearRemoteResetSchedule();
  saveConfig();
  saveState();
}

function buildUnitDetailPayload(accountId, unitId) {
  const accountConfig = getAccountConfigById(accountId || 'primary');
  const accountState = ensureAccountState(accountId || 'primary');
  const normalizedId = normalizeUnitKey(unitId);
  const configuredUnit = (accountConfig.units || []).find(function (unit) {
    return normalizeUnitKey(unit.id) === normalizedId;
  });
  if (!configuredUnit) {
    throw new Error(`Unit not found: ${unitId}`);
  }

  const unitState = accountState.units[configuredUnit.id] || normalizeUnitState(configuredUnit.id, { label: configuredUnit.label });
  const analysis = unitState.analysis || buildAnalysisFromRecords(unitState);
  const snapshot = accountState.fleet.vehicles[normalizedId] || null;

  return {
    accountId: accountConfig.id,
    accountLabel: accountConfig.label,
    unit: configuredUnit,
    customerProfile: findCustomerProfileForUnit(accountConfig, configuredUnit.id),
    snapshot,
    records: unitState.records,
    incidents: analysis.incidents,
  };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || 'GET';

  if (pathname === '/api/web-auth/login' && method === 'POST') {
    if (!requireTrustedApiMutation(req, res)) {
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!username || !password) {
        throw new Error('Username and password are required.');
      }
      const rateLimitKey = buildLoginRateLimitKey(req, 'web-auth', username);
      const rateLimitResult = await consumeLoginRateLimit(rateLimitKey, WEB_LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW_MS);
      if (!rateLimitResult.allowed) {
        sendJson(res, 429, {
          ok: false,
          error: `Terlalu banyak percobaan login. Coba lagi dalam ${rateLimitResult.retryAfterSeconds} detik.`,
        }, {
          'Retry-After': String(rateLimitResult.retryAfterSeconds),
        });
        return true;
      }
      const user = await findWebUserByUsername(username);
      if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
        sendJson(res, 401, {
          ok: false,
          error: 'Username atau password salah.',
        });
        return true;
      }
      await clearLoginRateLimit(rateLimitKey);
      const cookie = createWebSessionCookie(req, user);
      sendJson(res, 200, {
        ok: true,
        user: sanitizeWebUserForClient(user),
        webAuth: buildWebAuthConfigForClient(user),
      }, {
        'Set-Cookie': cookie,
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/web-auth/logout' && method === 'POST') {
    if (!requireTrustedApiMutation(req, res)) {
      return true;
    }
    destroyWebSession(req);
    sendJson(res, 200, {
      ok: true,
      webAuth: buildWebAuthConfigForClient(null),
    }, {
      'Set-Cookie': expiredWebSessionCookie(req),
    });
    return true;
  }

  if (pathname === '/api/status' && method === 'GET') {
    const session = await getWebSession(req);
    if (!session) {
      sendJson(res, 200, buildPublicStatusPayload());
      return true;
    }

    const now = Date.now();
    for (const account of getAllAccountConfigs()) {
      const accountState = ensureAccountState(account.id);
      if (shouldRefreshFleetSnapshot(account, accountState, now)) {
        try {
          await refreshFleetSnapshot(account.id);
          capturePodSnapshots(account, accountState, buildFleetRows(account, accountState, now, buildLiveAlerts(account, accountState, now)));
          saveConfig();
          saveState();
        } catch (error) {
          accountState.fleet.lastError = error.message;
          accountState.runtime.lastSnapshotError = error.message;
          saveState();
        }
      }
    }

    sendJson(res, 200, buildStatusPayload(session.user));
    return true;
  }

  if (pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!requireTrustedApiMutation(req, res)) {
      return true;
    }
  }

  if (pathname.startsWith('/api/')) {
    const session = await requireWebSession(req, res);
    if (!session) {
      return true;
    }
  }

  if (pathname === '/api/admin/users' && method === 'GET') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const users = await listWebUsers();
      sendJson(res, 200, {
        ok: true,
        users: users.map(sanitizeWebUserForClient),
        webAuth: buildWebAuthConfigForClient(session.user),
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/admin/users' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const user = await saveWebUser(body);
      const users = await listWebUsers();
      sendJson(res, 200, {
        ok: true,
        user: sanitizeWebUserForClient(user),
        users: users.map(sanitizeWebUserForClient),
        webAuth: buildWebAuthConfigForClient(session.user),
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/admin/users' && method === 'DELETE') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const userId = String(url.searchParams.get('id') || '').trim();
      if (!userId) {
        throw new Error('User id is required.');
      }
      if (session.user.id === userId) {
        throw new Error('Akun yang sedang dipakai tidak bisa dihapus.');
      }
      await deleteWebUser(userId);
      const users = await listWebUsers();
      sendJson(res, 200, {
        ok: true,
        users: users.map(sanitizeWebUserForClient),
        webAuth: buildWebAuthConfigForClient(session.user),
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/admin/db' && method === 'GET') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const [rollups, podSnapshots] = await Promise.all([
        listAdminTempRollups(Number(url.searchParams.get('rollupLimit') || 250)),
        listAdminPodSnapshots(Number(url.searchParams.get('podLimit') || 250)),
      ]);
      sendJson(res, 200, {
        ok: true,
        storageProvider: getStorageProvider(),
        rollups,
        podSnapshots,
        summary: {
          rollups: rollups.length,
          podSnapshots: podSnapshots.length,
        },
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/admin/db/rollups' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const rollups = await saveAdminTempRollup(body);
      sendJson(res, 200, { ok: true, rollups, storageProvider: getStorageProvider() });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/admin/db/rollups' && method === 'DELETE') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const id = String(url.searchParams.get('id') || '').trim();
      const rollups = await deleteAdminTempRollup(id);
      sendJson(res, 200, { ok: true, rollups, storageProvider: getStorageProvider() });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/admin/db/pod-snapshots' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const podSnapshots = await saveAdminPodSnapshot(body);
      sendJson(res, 200, { ok: true, podSnapshots, storageProvider: getStorageProvider() });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/admin/db/pod-snapshots' && method === 'DELETE') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const id = String(url.searchParams.get('id') || '').trim();
      const podSnapshots = await deleteAdminPodSnapshot(id);
      sendJson(res, 200, { ok: true, podSnapshots, storageProvider: getStorageProvider() });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/admin/remote-reset/logs' && method === 'GET') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const logs = await listRemoteResetLogs(Number(url.searchParams.get('limit') || REMOTE_RESET_DEFAULT_LOG_LIMIT));
      sendJson(res, 200, {
        ok: true,
        logs,
        remoteReset: buildRemoteResetStatusPayload(),
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/admin/remote-reset/run' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const result = await runRemoteResetCycle('manual');
      const logs = await listRemoteResetLogs(REMOTE_RESET_DEFAULT_LOG_LIMIT);
      sendJson(res, 200, {
        ok: true,
        result,
        logs,
        remoteReset: buildRemoteResetStatusPayload(),
        status: buildStatusPayload(session.user),
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

    if (pathname === '/api/auth/login' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const email = String(body.email || '').trim();
      const password = String(body.password || '');
      if (!email || !password) {
        throw new Error('Email and password are required.');
      }
      const rateLimitKey = buildLoginRateLimitKey(req, 'solofleet-auth', email);
      const rateLimitResult = await consumeLoginRateLimit(rateLimitKey, SOLOFLEET_LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW_MS);
      if (!rateLimitResult.allowed) {
        sendJson(res, 429, {
          ok: false,
          error: `Terlalu banyak percobaan login Solofleet. Coba lagi dalam ${rateLimitResult.retryAfterSeconds} detik.`,
        }, {
          'Retry-After': String(rateLimitResult.retryAfterSeconds),
        });
        return true;
      }
      const configPayload = await loginToSolofleet(email, password, body.rememberMe !== false, {
        accountId: body.accountId,
        label: body.label,
      });
      await clearLoginRateLimit(rateLimitKey);
      sendJson(res, 200, {
        ok: true,
        config: configPayload,
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      config: logoutFromSolofleet((await readRequestBody(req)).accountId),
    });
    return true;
  }

  if (pathname === '/api/tms/config' && method === 'GET') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      config: sanitizeConfigForClient().tms,
    });
    return true;
  }

  if (pathname === '/api/tms/config' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const current = getTmsConfig();
      config = normalizeConfig({
        ...config,
        tms: {
          ...current,
          tenantLabel: body.tenantLabel ?? current.tenantLabel,
          baseUrl: body.baseUrl ?? current.baseUrl,
          username: body.username ?? current.username,
          password: body.password === undefined || body.password === null || body.password === ''
            ? current.password
            : body.password,
          autoSync: body.autoSync ?? current.autoSync,
          syncIntervalMinutes: body.syncIntervalMinutes ?? current.syncIntervalMinutes,
          geofenceRadiusMeters: body.geofenceRadiusMeters ?? current.geofenceRadiusMeters,
          longStopMinutes: body.longStopMinutes ?? current.longStopMinutes,
          appStagnantMinutes: body.appStagnantMinutes ?? current.appStagnantMinutes,
        },
      });
      saveConfig();
      scheduleNextTmsSync();
      sendJson(res, 200, {
        ok: true,
        config: sanitizeConfigForClient().tms,
      });
    } catch (error) {
      sendApiError(res, error, 'TMS config gagal disimpan.');
    }
    return true;
  }

  if (pathname === '/api/tms/auth/login' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const result = await loginToTms(body || {});
      sendJson(res, 200, {
        ok: true,
        config: result,
      });
    } catch (error) {
      sendApiError(res, error, 'TMS login gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/tms/auth/logout' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      config: logoutFromTms(),
    });
    return true;
  }

  if (pathname === '/api/tms/sync' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const result = await syncTmsMonitor();
      sendJson(res, 200, {
        ok: true,
        result,
      });
    } catch (error) {
      sendApiError(res, error, 'TMS sync gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/tms/logs' && method === 'GET') {
    const session = await requireWebSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const logs = await listTmsSyncLogs(Number(url.searchParams.get('limit') || 20));
      sendJson(res, 200, {
        ok: true,
        logs,
      });
    } catch (error) {
      sendApiError(res, error, 'TMS logs gagal diambil.');
    }
    return true;
  }

  if (pathname === '/api/tms/board' && method === 'GET') {
    const session = await requireWebSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const customer = String(url.searchParams.get('customer') || '').trim() || 'all';
      const severity = String(url.searchParams.get('severity') || '').trim() || 'all';
      const window = buildTmsMonitorWindow(Date.now());
      const rows = await listTmsMonitorRows(url.searchParams);
      const logs = await listTmsSyncLogs(1);
      const runtime = getTmsConfig();
      console.log(`[TMS] Board request by ${session.username || session.id || 'unknown-user'} | window ${window.startDay}..${window.endDay} | customer ${customer} | severity ${severity} | rows ${rows.length}`);
      sendJson(res, 200, {
        ok: true,
        rows,
        summary: buildTmsMonitorSummary(rows, logs, {
          windowStart: window.startDay,
          windowEnd: window.endDay,
          autoSync: runtime.autoSync,
          syncIntervalMinutes: runtime.syncIntervalMinutes,
        }),
      });
    } catch (error) {
      sendApiError(res, error, 'Trip Monitor gagal diambil.');
    }
    return true;
  }

  if (pathname === '/api/tms/board/detail' && method === 'GET') {
    const session = await requireWebSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const rowId = String(url.searchParams.get('rowId') || '').trim();
      if (!rowId) {
        throw new Error('rowId wajib diisi.');
      }
      const result = await postgresQuery('select row_id, day, tenant_label, customer_name, unit_key, unit_id, unit_label, normalized_plate, severity, board_status, job_order_id, job_order_count, origin_name, destination_name, temp_min, temp_max, eta_origin, eta_destination, driver_app_status, incident_codes, incident_summary, unmatched_reason, metadata from tms_monitor_rows where row_id = $1 limit 1', [rowId]);
      if (!result.rows[0]) {
        console.warn(`[TMS] Detail miss for row ${rowId}`);
        throw new Error('Trip monitor detail tidak ditemukan.');
      }
      const now = Date.now();
      const refreshed = refreshTripMonitorStoredRow({
        rowId: result.rows[0].row_id,
        day: String(result.rows[0].day || ''),
        tenantLabel: String(result.rows[0].tenant_label || ''),
        customerName: String(result.rows[0].customer_name || ''),
        unitKey: String(result.rows[0].unit_key || ''),
        unitId: String(result.rows[0].unit_id || ''),
        unitLabel: String(result.rows[0].unit_label || ''),
        normalizedPlate: String(result.rows[0].normalized_plate || ''),
        severity: String(result.rows[0].severity || 'normal'),
        boardStatus: String(result.rows[0].board_status || 'normal'),
        jobOrderId: String(result.rows[0].job_order_id || ''),
        jobOrderCount: Number(result.rows[0].job_order_count || 0),
        originName: String(result.rows[0].origin_name || ''),
        destinationName: String(result.rows[0].destination_name || ''),
        tempMin: toNumber(result.rows[0].temp_min),
        tempMax: toNumber(result.rows[0].temp_max),
        etaOrigin: result.rows[0].eta_origin ? Date.parse(result.rows[0].eta_origin) : null,
        etaDestination: result.rows[0].eta_destination ? Date.parse(result.rows[0].eta_destination) : null,
        driverAppStatus: String(result.rows[0].driver_app_status || ''),
        incidentCodes: Array.isArray(result.rows[0].incident_codes) ? result.rows[0].incident_codes : [],
        incidentSummary: String(result.rows[0].incident_summary || ''),
        unmatchedReason: String(result.rows[0].unmatched_reason || ''),
        metadata: result.rows[0].metadata && typeof result.rows[0].metadata === 'object' ? result.rows[0].metadata : {},
      }, buildFleetPlateIndex(now), getTmsConfig(), now);
      console.log(`[TMS] Detail request by ${session.username || session.id || 'unknown-user'} | row ${rowId} | unit ${refreshed.unitId || refreshed.unitLabel || '-'} | severity ${refreshed.severity || 'normal'}`);
      sendJson(res, 200, {
        ok: true,
        detail: {
          rowId: refreshed.rowId,
          day: refreshed.day,
        severity: refreshed.severity,
        boardStatus: refreshed.boardStatus,
        unitId: refreshed.unitId,
        unitLabel: refreshed.unitLabel,
        customerName: refreshed.customerName,
        shippingStatusLabel: refreshed.shippingStatusLabel || '',
        shippingStatusChangedAt: refreshed.shippingStatusChangedAt || null,
        metadata: refreshed.metadata || {},
      },
    });
    } catch (error) {
      sendApiError(res, error, 'Trip monitor detail gagal diambil.', 404);
    }
    return true;
  }

  if (pathname === '/api/astro/config' && method === 'GET') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    sendJson(res, 200, buildAstroConfigPayload());
    return true;
  }

  if (pathname === '/api/astro/config/locations' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const nextLocations = validateAstroLocations(Array.isArray(body.locations) ? body.locations : []);
      const nextRoutes = validateAstroRoutes(Array.isArray(body.routes) ? body.routes : (config.astroRoutes || []), nextLocations, { requireWhTempRange: false });
      config = normalizeConfig({
        ...config,
        astroLocations: nextLocations,
        astroRoutes: nextRoutes,
      });
      saveConfig();
      sendJson(res, 200, buildAstroConfigPayload());
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/astro/config/routes' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const nextLocations = validateAstroLocations(config.astroLocations || []);
      const nextRoutes = validateAstroRoutes(Array.isArray(body.routes) ? body.routes : [], nextLocations, { requireWhTempRange: true });
      config = normalizeConfig({
        ...config,
        astroLocations: nextLocations,
        astroRoutes: nextRoutes,
      });
      saveConfig();
      sendJson(res, 200, buildAstroConfigPayload());
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/astro/config/locations/import' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const parsed = astroCore.parseAstroLocationCsv(body.csvText || '');
      if (parsed.errors.length) {
        throw new Error(parsed.errors.join(' '));
      }
      const replaceMode = body.replace === true;
      const mergedLocations = replaceMode
        ? parsed.rows
        : validateAstroLocations([...(config.astroLocations || []).filter(function (location) {
            return !parsed.rows.some(function (incoming) { return incoming.id === location.id; });
          }), ...parsed.rows]);
      const nextRoutes = validateAstroRoutes(config.astroRoutes || [], mergedLocations, { requireWhTempRange: false });
      config = normalizeConfig({
        ...config,
        astroLocations: mergedLocations,
        astroRoutes: nextRoutes,
      });
      saveConfig();
      sendJson(res, 200, {
        ...buildAstroConfigPayload(),
        imported: parsed.rows.length,
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/astro/config/routes/import' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const nextLocations = validateAstroLocations(config.astroLocations || []);
      const parsed = astroCore.parseAstroRouteCsv(body.csvText || '', nextLocations);
      if (parsed.errors.length) {
        throw new Error(parsed.errors.join(' '));
      }
      const replaceMode = body.replace === true;
      const mergedRoutes = replaceMode
        ? parsed.rows
        : [...(config.astroRoutes || []).filter(function (route) {
            return !parsed.rows.some(function (incoming) {
              return String(incoming.accountId || 'primary') === String(route.accountId || 'primary')
                && String(incoming.unitId || '').toUpperCase() === String(route.unitId || '').toUpperCase();
            });
          }), ...parsed.rows];
      const nextRoutes = validateAstroRoutes(mergedRoutes, nextLocations, { requireWhTempRange: true });
      config = normalizeConfig({
        ...config,
        astroLocations: nextLocations,
        astroRoutes: nextRoutes,
      });
      saveConfig();
      sendJson(res, 200, {
        ...buildAstroConfigPayload(),
        imported: parsed.rows.length,
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/astro/report' && method === 'GET') {
    try {
      const payload = await buildAstroReportPayload(url.searchParams);
      sendJson(res, 200, payload);
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/astro/report/export' && method === 'GET') {
    try {
      const payload = await buildAstroReportPayload(url.searchParams);
      const csvText = buildCsvText(payload.flatRows || []);
      const startLabel = payload.filters?.startDate || 'start';
      const endLabel = payload.filters?.endDate || 'end';
      const unitLabel = payload.filters?.unitId || 'all-units';
      send(res, 200, csvText, 'text/csv; charset=utf-8', {
        'Content-Disposition': 'attachment; filename="Astro Report ' + startLabel + ' to ' + endLabel + ' ' + unitLabel + '.csv"',
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/astro/snapshots/logs' && method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      logs: astroSnapshotLogs,
      autoSync: {
        enabled: Boolean(astroSnapshotTimer),
        intervalHours: 3,
        lastSyncAt: state.runtime.lastSnapshotAt || null,
        isPolling: state.runtime.isPolling,
      },
    });
    return true;
  }

  if (pathname === '/api/astro/snapshots/sync' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) return true;
    try {
      const body = await readRequestBody(req);
      const startMs = toTimestampMaybe(body.startDate) || (Date.now() - 4 * 24 * 60 * 60 * 1000);
      const endMs = toTimestampMaybe(body.endDate) || Date.now();
      const result = await syncAstroSnapshots(startMs, endMs, {
        skipExistingDays: body.skipExistingDays !== false,
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendApiError(res, error, 'Sync gagal.');
    }
    return true;
  }

  if (pathname === '/api/astro/snapshots' && method === 'GET') {
    try {
      const range = parseDateRange(url.searchParams);
      const startDay = formatLocalDay(range.rangeStartMs || Date.now());
      const endDay = formatLocalDay(range.rangeEndMs || Date.now());
      const accountId = String(url.searchParams.get('accountId') || 'all').trim() || 'all';

      let rows = [];
      if (getPostgresConfig().enabled) {
          const params = [startDay, endDay];
          let query = `select * from astro_route_snapshots where day >= $1 and day <= $2`;
          if (accountId !== 'all') {
            query += ` and account_id = $3`;
            params.push(accountId);
          }
          const result = await postgresQuery(query, params);
          rows = result.rows || [];
      }
      
      for (const r of rows) {
          if (r.day && r.day instanceof Date) {
              r.day = formatLocalDay(r.day.getTime());
          } else if (r.day) {
              r.day = String(r.day);
          }
      }
      
      // Aggregate into byWarehouse format compatible with the dashboard UI
      const warehouseGroups = new Map();
      let totalPass = 0;
      let totalFail = 0;
      let totalEligible = 0;
      
      const prepareWH = (wh) => {
          if (!warehouseGroups.has(wh)) {
              warehouseGroups.set(wh, { 
                  warehouse: wh, 
                  trend: [], 
                  eligibleRows: 0, 
                  passRows: 0, 
                  failRows: 0, 
                  kpi: 0
              });
          }
          return warehouseGroups.get(wh);
      };
      
      const whTrendMap = new Map();
      const getWhTrendDay = (wh, day) => {
          const key = wh + '::' + day;
          if (!whTrendMap.has(key)) {
              whTrendMap.set(key, { 
                  day, 
                  warehouse: wh,
                  eligibleRows: 0, 
                  whArrivalTimePass: 0, 
                  whArrivalTimeEligible: 0,
                  whArrivalTempPass: 0,
                  whArrivalTempEligible: 0,
                  podArrivalPass: 0,
                  podArrivalEligible: 0
              });
          }
          return whTrendMap.get(key);
      };

      for (const r of rows) {
          const isEligible = Number(r.pass_count || 0) > 0
            || r.status === 'request_error'
            || Number(r.fail_count || 0) > 0
            || Boolean(r.wh_time_kpi)
            || Boolean(r.wh_temp_kpi)
            || Boolean(r.pod_kpi);
          const isPass = Number(r.pass_count || 0) > 0
            || (r.wh_kpi === 'pass' && (r.pod_kpi === 'pass' || r.pod_kpi === null));
          const isFail = r.status === 'request_error'
            || Number(r.fail_count || 0) > 0
            || r.wh_kpi === 'fail'
            || r.pod_kpi === 'fail';

          const w = prepareWH(r.warehouse_name);
          if (isEligible) {
              w.eligibleRows += 1;
              totalEligible += 1;
              if (isPass) {
                 w.passRows += 1;
                 totalPass += 1;
              } else if (isFail) {
                 w.failRows += 1;
                 totalFail += 1;
              }
          }
          w.kpi = w.eligibleRows > 0 ? (w.passRows / w.eligibleRows) * 100 : 0;
          
          if (isEligible) {
              const td = getWhTrendDay(r.warehouse_name, r.day);
              td.eligibleRows += 1;
              if (r.wh_time_kpi) {
                  td.whArrivalTimeEligible += 1;
                  if (r.wh_time_kpi === 'pass') td.whArrivalTimePass += 1;
              }
              if (r.wh_temp_kpi) {
                  td.whArrivalTempEligible += 1;
                  if (r.wh_temp_kpi === 'pass') td.whArrivalTempPass += 1;
              }
              if (r.pod_kpi) {
                  td.podArrivalEligible += 1;
                  if (r.pod_kpi === 'pass') td.podArrivalPass += 1;
              }
          }
      }
      
      for (const td of whTrendMap.values()) {
        const w = prepareWH(td.warehouse);
        w.trend.push({
            day: td.day,
            whArrivalTimeRate: td.whArrivalTimeEligible > 0 ? (td.whArrivalTimePass / td.whArrivalTimeEligible) * 100 : 0,
            whArrivalTempRate: td.whArrivalTempEligible > 0 ? (td.whArrivalTempPass / td.whArrivalTempEligible) * 100 : 0,
            podArrivalRate: td.podArrivalEligible > 0 ? (td.podArrivalPass / td.podArrivalEligible) * 100 : 0,
            eligibleRows: td.eligibleRows
        });
      }
      
      for (const w of warehouseGroups.values()) {
          w.trend.sort((a,b) => String(a.day || '').localeCompare(String(b.day || '')));
      }
      
      const byWarehouse = [...warehouseGroups.values()].sort((a,b) => b.eligibleRows - a.eligibleRows);
      
      // Also provide trend data grouped by day
      const trendMap = new Map();
      for (const r of rows) {
         const isEligible = Number(r.pass_count || 0) > 0
           || r.status === 'request_error'
           || Number(r.fail_count || 0) > 0
           || Boolean(r.wh_time_kpi)
           || Boolean(r.wh_temp_kpi)
           || Boolean(r.pod_kpi);
         if (!isEligible) continue;
         if (!trendMap.has(r.day)) trendMap.set(r.day, { day: r.day, passRows: 0, failRows: 0, eligibleRows: 0 });
         const td = trendMap.get(r.day);
         td.eligibleRows += 1;
         if (Number(r.pass_count || 0) > 0 || (r.wh_kpi === 'pass' && (r.pod_kpi === 'pass' || r.pod_kpi === null))) td.passRows += 1;
         else if (r.status === 'request_error' || Number(r.fail_count || 0) > 0 || r.wh_kpi === 'fail' || r.pod_kpi === 'fail') td.failRows += 1;
      }
      const trend = [...trendMap.values()].sort((a,b) => String(a.day || '').localeCompare(String(b.day || '')));
      
      sendJson(res, 200, {
          ok: true,
          overallRate: totalEligible > 0 ? (totalPass / totalEligible) * 100 : 0,
          kpi: {
             trend,
             byWarehouse
          },
          summary: { kpi: { trend, byWarehouse } },
          trend,
          rows: rows.map(r => ({ ...r, kpi_status: (r.wh_kpi === 'pass' && r.pod_kpi === 'pass') ? 'pass' : (r.wh_kpi === 'fail' || r.pod_kpi === 'fail' ? 'fail' : r.status) }))
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/config' && method === 'GET') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    sendJson(res, 200, sanitizeConfigForClient());
    return true;
  }

  if (pathname === '/api/config' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    const body = await readRequestBody(req);
    const targetAccountId = String(body.activeAccountId || config.activeAccountId || 'primary').trim() || 'primary';
    const nextConfig = {
      ...config,
      solofleetBaseUrl: body.solofleetBaseUrl ?? config.solofleetBaseUrl,
      endpointPath: body.endpointPath ?? config.endpointPath,
      refererPath: body.refererPath ?? config.refererPath,
      vehiclePagePath: body.vehiclePagePath ?? config.vehiclePagePath,
      discoveryEndpointPath: body.discoveryEndpointPath ?? config.discoveryEndpointPath,
      pollIntervalSeconds: body.pollIntervalSeconds ?? config.pollIntervalSeconds,
      requestLookbackMinutes: body.requestLookbackMinutes ?? config.requestLookbackMinutes,
      requestIntervalSeconds: body.requestIntervalSeconds ?? config.requestIntervalSeconds,
      historyRetentionDays: body.historyRetentionDays ?? config.historyRetentionDays,
      minDurationMinutes: body.minDurationMinutes ?? config.minDurationMinutes,
      maxGapMinutes: Object.prototype.hasOwnProperty.call(body, 'maxGapMinutes') ? body.maxGapMinutes : config.maxGapMinutes,
      archiveType: body.archiveType ?? config.archiveType,
      tempProfile: body.tempProfile ?? config.tempProfile,
      temperatureProcessing: body.temperatureProcessing ?? config.temperatureProcessing,
      autoStart: body.autoStart ?? config.autoStart,
      remoteResetAutomation: Object.prototype.hasOwnProperty.call(body, 'remoteResetAutomation') ? body.remoteResetAutomation : config.remoteResetAutomation,
      linkedAccounts: Array.isArray(body.linkedAccounts) ? body.linkedAccounts : config.linkedAccounts,
      activeAccountId: targetAccountId,
    };

    if (targetAccountId === 'primary') {
      nextConfig.vehicleRoleId = body.vehicleRoleId ?? config.vehicleRoleId;
      nextConfig.units = Array.isArray(body.units) ? body.units : config.units;
      nextConfig.customerProfiles = Array.isArray(body.customerProfiles) ? body.customerProfiles : config.customerProfiles;
      nextConfig.podSites = Array.isArray(body.podSites) ? body.podSites : config.podSites;
      if (Object.prototype.hasOwnProperty.call(body, 'sessionCookie')) {
        nextConfig.sessionCookie = String(body.sessionCookie || '');
      }
    } else {
      nextConfig.vehicleRoleId = config.vehicleRoleId;
      nextConfig.units = config.units;
      nextConfig.customerProfiles = config.customerProfiles;
      nextConfig.podSites = config.podSites;
      nextConfig.linkedAccounts = (config.linkedAccounts || []).map(function (account) {
        if (account.id !== targetAccountId) {
          return account;
        }
        return {
          ...account,
          vehicleRoleId: body.vehicleRoleId ?? account.vehicleRoleId,
          units: Array.isArray(body.units) ? body.units : account.units,
          customerProfiles: Array.isArray(body.customerProfiles) ? body.customerProfiles : account.customerProfiles,
          podSites: Array.isArray(body.podSites) ? body.podSites : account.podSites,
          sessionCookie: Object.prototype.hasOwnProperty.call(body, 'sessionCookie') ? String(body.sessionCookie || '') : account.sessionCookie,
        };
      });
    }

    config = normalizeConfig(nextConfig);
    syncUnitsWithConfig();
    recomputeAllAnalyses();
    saveConfig();
    saveState();

    if (state.runtime.isPolling) {
      scheduleNextPoll();
      scheduleNextRemoteReset();
    } else {
      clearRemoteResetSchedule();
    }

    sendJson(res, 200, {
      ok: true,
      config: sanitizeConfigForClient(),
    });
    return true;
  }

  if (pathname === '/api/discover/units' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const result = await discoverUnits(body.accountId || config.activeAccountId || 'primary');
      sendJson(res, 200, {
        ok: true,
        roleId: result.roleId,
        units: result.units,
        config: sanitizeConfigForClient(),
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/report' && method === 'GET') {
    sendJson(res, 200, await buildReportPayload(url.searchParams));
    return true;
  }

  if (pathname === '/api/monitor' && method === 'GET') {
    sendJson(res, 200, buildApiMonitorPayload());
    return true;
  }

  if (pathname === '/api/report/pod' && method === 'GET') {
    const range = parseDateRange(url.searchParams);
    let rows = [];
    try {
      const supabaseRows = await loadPodSnapshotsFromSupabase(range.rangeStartMs, range.rangeEndMs);
      if (supabaseRows.length) {
        rows = supabaseRows;
      }
    } catch (e) {}
    
    if (!rows.length) {
      rows = getAllAccountConfigs().flatMap(function (account) {
        return buildPodSnapshotRows(ensureAccountState(account.id), range.rangeStartMs, range.rangeEndMs);
      });
    }

    rows.sort(function (left, right) {
      return (right.timestamp || 0) - (left.timestamp || 0);
    });
    
    sendJson(res, 200, {
      ok: true,
      rows,
    });
    return true;
  }

  if (pathname === '/api/report/stop' && method === 'GET') {
    try {
      const unitId = String(url.searchParams.get('unitId') || '').trim();
      const accountId = String(url.searchParams.get('accountId') || config.activeAccountId || 'primary').trim();
      if (!unitId) {
        throw new Error('Query parameter unitId is required.');
      }
      const range = parseDateRange(url.searchParams);
      if (range.rangeStartMs === null || range.rangeEndMs === null) {
        throw new Error('startDate and endDate are required for stop report.');
      }
      const accountConfig = getAccountConfigById(accountId);
      if (!accountConfig) {
        throw new Error(`Account not found: ${accountId}`);
      }
      const payload = await fetchStopReport(accountConfig, unitId, {
        rangeStartMs: range.rangeStartMs,
        rangeEndMs: range.rangeEndMs,
        reportType: String(url.searchParams.get('reportType') || '3'),
        minDurationMinutes: Number(url.searchParams.get('minDuration') || config.minDurationMinutes || 0),
        withTrack: String(url.searchParams.get('withTrack') || 'withtrack'),
      });
      sendJson(res, 200, {
        ok: true,
        accountId,
        ...payload,
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }

  if (pathname === '/api/unit-history' && method === 'GET') {
    try {
      const unitId = String(url.searchParams.get('unitId') || '').trim();
      const accountId = String(url.searchParams.get('accountId') || config.activeAccountId || 'primary').trim();
      const source = String(url.searchParams.get('source') || 'merged').trim().toLowerCase();
      if (!unitId) {
        throw new Error('Query parameter unitId is required.');
      }
      const range = parseDateRange(url.searchParams);
      if (range.rangeStartMs === null || range.rangeEndMs === null) {
        throw new Error('startDate and endDate are required for unit history.');
      }
      const accountConfig = getAccountConfigById(accountId);
      if (!accountConfig) {
        throw new Error(`Account not found: ${accountId}`);
      }
      const detail = buildUnitDetailPayload(accountId, unitId);
      const accountState = ensureAccountState(accountId);
      syncFleetSnapshotRecords(accountConfig, accountState, Date.now());
      let historyRecords = [];
      let historyError = null;
      try {
        const history = await fetchUnitHistory(accountConfig, unitId, range.rangeStartMs, range.rangeEndMs);
        historyRecords = history.records;
      } catch (error) {
        historyError = error;
      }
      let records = historyRecords;
      if (source !== 'remote') {
        const cachedRecords = buildCachedUnitHistory(accountState, detail.unit.id, range.rangeStartMs, range.rangeEndMs);
        records = mergeHistoryRecords(historyRecords, cachedRecords);
      }
      if (!records.length && historyError) {
        throw historyError;
      }
      const geofenceEvents = astroCore.buildGeofenceEvents(
        records,
        config.astroLocations || [],
        buildGeofenceContext(accountConfig, detail.customerProfile),
      );
      const geofenceAnnotatedRecords = annotateHistoryRecordsWithGeofence(records, geofenceEvents);
      sendJson(res, 200, {
        ok: true,
        accountId,
        unit: detail.unit,
        snapshot: detail.snapshot,
        incidents: detail.incidents,
        customerProfile: detail.customerProfile,
        geofenceEvents,
        records: geofenceAnnotatedRecords,
      });
    } catch (error) {
      sendApiError(res, error, 'Aksi gagal diproses.');
    }
    return true;
  }
  if (pathname === '/api/unit-detail' && method === 'GET') {
    try {
      const unitId = String(url.searchParams.get('unitId') || '').trim();
      const accountId = String(url.searchParams.get('accountId') || config.activeAccountId || 'primary').trim();
      if (!unitId) {
        throw new Error('Query parameter unitId is required.');
      }
      sendJson(res, 200, {
        ok: true,
        ...buildUnitDetailPayload(accountId, unitId),
      });
    } catch (error) {
      sendApiError(res, error, 'Unit tidak ditemukan.', 404);
    }
    return true;
  }

  if (pathname === '/api/poll/run' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      const result = await runPollCycle('manual');
      sendJson(res, 200, {
        ok: true,
        result,
        status: buildStatusPayload(session.user),
      });
    } catch (error) {
      sendJson(res, getPublicErrorStatus(error, 500), {
        ok: false,
        error: getPublicErrorMessage(error, 'Aksi polling gagal diproses.'),
        status: buildStatusPayload(session.user),
      });
    }
    return true;
  }

  if (pathname === '/api/poll/start' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    try {
      await startPolling();
      sendJson(res, 200, {
        ok: true,
        status: buildStatusPayload(session.user),
      });
    } catch (error) {
      state.runtime.isPolling = false;
      state.runtime.nextRunAt = null;
      config.autoStart = false;
      saveConfig();
      saveState();
      sendJson(res, getPublicErrorStatus(error, 500), {
        ok: false,
        error: getPublicErrorMessage(error, 'Aksi polling gagal diproses.'),
        status: buildStatusPayload(session.user),
      });
    }
    return true;
  }

  if (pathname === '/api/poll/stop' && method === 'POST') {
    const session = await requireAdminSession(req, res);
    if (!session) {
      return true;
    }
    stopPolling();
    sendJson(res, 200, {
      ok: true,
      status: buildStatusPayload(session.user),
    });
    return true;
  }

  return false;
}

function handleStatic(req, res, url) {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
    return;
  }

  const filePath = safePathFromUrl(url.pathname || '/');
  if (!filePath.startsWith(WEB_ROOT)) {
    send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }

  fs.stat(filePath, function (statError, stats) {
    if (statError || !stats.isFile()) {
      send(res, 404, 'Not Found', 'text/plain; charset=utf-8');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const cacheControl = buildStaticCacheControl(filePath);
    const etag = buildWeakEtag(stats);

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, {
        'Cache-Control': cacheControl,
        ETag: etag,
        Vary: 'Accept-Encoding',
        ...RESPONSE_SECURITY_HEADERS,
      });
      res.end();
      return;
    }

    if (method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': String(stats.size || 0),
        'Cache-Control': cacheControl,
        ETag: etag,
        'Last-Modified': stats.mtime.toUTCString(),
        Vary: 'Accept-Encoding',
        ...RESPONSE_SECURITY_HEADERS,
      });
      res.end();
      return;
    }

    fs.readFile(filePath, function (readError, content) {
      if (readError) {
        send(res, 500, 'Internal Server Error', 'text/plain; charset=utf-8');
        return;
      }
      const compressed = compressStaticContent(req, content, contentType);
      send(res, 200, compressed.content, contentType, {
        'Cache-Control': cacheControl,
        ETag: etag,
        'Last-Modified': stats.mtime.toUTCString(),
        'Content-Length': String(compressed.content.length),
        Vary: 'Accept-Encoding',
        ...(compressed.encoding ? { 'Content-Encoding': compressed.encoding } : {}),
      });
    });
  });
}

async function requestHandler(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const startedAt = Date.now();
  const method = req.method || 'GET';
  const pathName = url.pathname || '/';

  if (!pathName.startsWith('/api/')) {
    handleStatic(req, res, url);
    return;
  }

  const storageWaitTimeoutMs = pathName === '/api/status'
    ? 2500
    : pathName === '/api/web-auth/login'
      ? 30000
      : 8000;
  const storageReady = await waitForStorageInitialization(storageWaitTimeoutMs);
  if (!storageReady) {
    if (pathName === '/api/status' && method === 'GET') {
      sendJson(res, 200, buildPublicStatusPayload(), {
        'X-App-Bootstrap': 'degraded',
      });
      return;
    }
    sendJson(res, 503, {
      ok: false,
      error: 'Storage initialization still in progress.',
      webAuth: buildWebAuthConfigForClient(null),
    });
    return;
  }

  res.once('finish', function () {
    if (!pathName.startsWith('/api/')) {
      return;
    }
    recordApiMonitorEvent({
      timestamp: new Date().toISOString(),
      method,
      path: pathName,
      query: url.search || '',
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      error: res.__apiErrorMessage || '',
    });
  });

  try {
    const handled = await handleApi(req, res, url);
    if (!handled) {
      handleStatic(req, res, url);
    }
  } catch (error) {
    console.error('[request]', method, pathName, error);
    sendApiError(res, error, 'Aksi gagal diproses.');
  }
}

module.exports = {
  requestHandler,
  initializeStorage,
};

if (require.main === module) {
  const server = http.createServer(requestHandler);

  // Timeout 30 menit untuk long-running Astro sync requests
  server.setTimeout(30 * 60 * 1000);
  server.keepAliveTimeout = 30 * 60 * 1000;

  server.listen(PORT, HOST, async function () {
    console.log(`Solofleet auto monitor running at http://${HOST}:${PORT}`);
    try {
      await storageInitializationPromise;
      scheduleNextTmsSync();
      if (config && config.autoStart) {
        startPolling().catch(function (error) {
          state.runtime.lastRunMessage = error.message;
          state.runtime.isPolling = false;
          state.runtime.nextRunAt = null;
          config.autoStart = false;
          saveConfig();
          saveState();
        });
        scheduleNextAstroSnapshot();
      }
    } catch (e) {
      console.error('Failed to initialize storage on startup:', e);
    }
  });
}








































