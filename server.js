require('dotenv').config();
const http = require('http');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
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

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
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
let pollInFlight = false;
const API_MONITOR_LIMIT = 250;
const apiMonitorLog = [];
const WEB_AUTH_COOKIE_NAME = 'solofleet_web_session';
const WEB_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
let postgresPool = null;
const SOLOFLEET_UTC_OFFSET_MINUTES = Number(process.env.SOLOFLEET_UTC_OFFSET_MINUTES || 420);
const LOGIN_RATE_LIMIT_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || (15 * 60 * 1000));
const WEB_LOGIN_RATE_LIMIT_MAX = Number(process.env.WEB_LOGIN_RATE_LIMIT_MAX || 10);
const SOLOFLEET_LOGIN_RATE_LIMIT_MAX = Number(process.env.SOLOFLEET_LOGIN_RATE_LIMIT_MAX || 8);

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

function normalizeUnitKey(value) {
  return String(value || '').trim().toLowerCase();
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
  return { id, label };
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

async function saveConfig() {
  if (getPostgresConfig().enabled) {
    try {
      await postgresUpsertJsonSetting('app_settings', 'config_data', config);
      return;
    } catch (error) {
      console.error('Failed to save config to PostgreSQL:', error.message);
    }
  }
  if (!getSupabaseWebAuthConfig().enabled) {
    saveJsonFile(CONFIG_FILE, config);
    return;
  }
  try {
    await supabaseRestRequest('POST', 'app_settings', {
      headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
      body: [{ id: 'default', config_data: config, updated_at: new Date().toISOString() }],
    });
  } catch (error) {
    console.error('Failed to save config to Supabase:', error.message);
    saveJsonFile(CONFIG_FILE, config);
  }
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

  const response = await fetch(`${runtime.url}/rest/v1/${resource}`, {
    method,
    headers,
    body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
  });
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
    return String(parsed.host || '').trim().toLowerCase() === expectedHost;
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
  const payload = serializeStateForDisk();
  if (getPostgresConfig().enabled) {
    try {
      await postgresUpsertJsonSetting('app_state', 'state_data', payload);
      return;
    } catch (error) {
      console.error('Failed to save state to PostgreSQL:', error.message);
    }
  }
  if (!getSupabaseWebAuthConfig().enabled) {
    saveJsonFile(STATE_FILE, payload);
    return;
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

    const type = detectLiveSensorFaultType(snapshot.temp1, snapshot.temp2, snapshot.errSensor || '');
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
  const repairedAstroRoutes = validateAstroRoutes(config.astroRoutes || [], config.astroLocations || []);
  const astroRoutesChanged = JSON.stringify(repairedAstroRoutes) !== JSON.stringify(config.astroRoutes || []);
  if (astroRoutesChanged) {
    config = normalizeConfig({
      ...config,
      astroRoutes: repairedAstroRoutes,
    });
  }


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
  
  state.runtime.isPolling = false;
  state.runtime.nextRunAt = null;

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
  
  isStorageInitialized = true;
}

const storageInitializationPromise = initializeStorage();

const RESPONSE_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join('; '),
};

function send(res, statusCode, content, contentType, extraHeaders) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
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

function detectLiveSensorFaultType(temp1, temp2) {
  const sensor1Zero = toNumber(temp1) === 0;
  const sensor2Zero = toNumber(temp2) === 0;

  if (sensor1Zero && sensor2Zero) {
    return 'temp1+temp2';
  }
  if (sensor1Zero) {
    return 'temp1';
  }
  if (sensor2Zero) {
    return 'temp2';
  }
  return null;
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
    const liveSensorFaultType = detectLiveSensorFaultType(vehicleSnapshot?.temp1 ?? null, vehicleSnapshot?.temp2 ?? null);
    const customerProfile = findCustomerProfileForUnit(accountConfig, unit.id);
    const setpoint = evaluateSetpointStatus(
      customerProfile,
      vehicleSnapshot?.temp1 ?? null,
      vehicleSnapshot?.temp2 ?? null,
      Boolean(liveSensorFaultType),
    );

    return {
      accountId: accountConfig.id,
      accountLabel: accountConfig.label,
      rowKey: `${accountConfig.id}::${unit.id}`,
      id: unit.id,
      unitKey: normalizeUnitKey(unit.id),
      label: unit.label,
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
      sourceStart: analysis.sourceStart,
      sourceEnd: analysis.sourceEnd,
      lastRecordAt: lastRecord ? lastRecord.timestamp : null,
    };
  }).sort(function (left, right) {
    return left.label.localeCompare(right.label);
  });
}

function buildOverview(fleetRows, liveAlerts) {
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
    return row.isMoving;
  }).length;
  const setpointMismatchUnits = fleetRows.filter(function (row) {
    return row.outsideSetpoint;
  }).length;
  const gpsLate30Units = fleetRows.filter(function (row) {
    return row.minutesSinceUpdate !== null && row.minutesSinceUpdate > 30;
  }).length;

  return {
    monitoredUnits: fleetRows.length,
    liveAlerts: liveAlerts.length,
    criticalAlerts: liveAlerts.filter(function (incident) {
      return incident.type === 'temp1+temp2';
    }).length,
    movingUnits,
    staleUnits,
    sensorFlagUnits,
    gpsFlagUnits,
    setpointMismatchUnits,
    gpsLate30Units,
    locationReadyUnits: fleetRows.filter(function (row) {
      return row.latitude !== null && row.longitude !== null;
    }).length,
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
    overview: buildOverview(astroAnnotatedRows, liveAlerts),
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
      snapshotAnalytics = buildSnapshotReportAggregatesFromCompactRows(supabaseRows);
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
    });
  }
  return postgresPool;
}

async function postgresQuery(queryText, params) {
  const pool = getPostgresPool();
  if (!pool) {
    throw new Error('PostgreSQL is not configured.');
  }
  return pool.query(queryText, params || []);
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

    create index if not exists idx_daily_temp_rollups_day on daily_temp_rollups(day desc);
    create index if not exists idx_daily_temp_rollups_unit_id on daily_temp_rollups(unit_id);
    create index if not exists idx_daily_temp_rollups_account_id on daily_temp_rollups(account_id);
    create index if not exists idx_pod_snapshots_day on pod_snapshots(day desc);
    create index if not exists idx_pod_snapshots_unit_id on pod_snapshots(unit_id);
    create index if not exists idx_dashboard_web_users_username on dashboard_web_users(username);
    create index if not exists idx_login_rate_limits_reset_at on login_rate_limits(reset_at);
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

async function postgresUpsertRows(tableName, rows, columns, conflictColumns, options) {
  if (!rows.length) {
    return 0;
  }
  await ensurePostgresSchema();
  const settings = options && typeof options === 'object' ? options : {};
  const params = [];
  const valueRows = rows.map(function (row, rowIndex) {
    const placeholders = columns.map(function (_column, columnIndex) {
      params.push(row[columns[columnIndex]]);
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

function validateAstroRoutes(routes, locations) {
  const accountIds = new Set(getAllAccountConfigs().map(function (account) { return account.id; }));
  const locationMap = new Map((locations || []).map(function (location) { return [location.id, location]; }));
  const seen = new Set();

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
    const routeKey = normalized.accountId + '::' + normalized.unitId;
    if (seen.has(routeKey)) {
      throw new Error('Astro route duplicate untuk unit ' + normalized.unitId + ' di account ' + normalized.accountId);
    }
    seen.add(routeKey);
    return normalized;
  });
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

async function buildAstroReportPayload(searchParams) {
  const range = parseDateRange(searchParams);
  if (range.rangeStartMs === null || range.rangeEndMs === null) {
    throw new Error('startDate and endDate are required for Astro report.');
  }

  const startDate = searchParams.get('startDate') || searchParams.get('start') || formatLocalDay(range.rangeStartMs);
  const endDate = searchParams.get('endDate') || searchParams.get('end') || formatLocalDay(range.rangeEndMs);
  const accountId = String(searchParams.get('accountId') || 'all').trim() || 'all';
  const unitId = String(searchParams.get('unitId') || '').trim().toUpperCase();
  const activeRoutes = (config.astroRoutes || []).filter(function (route) {
    if (route.isActive === false) {
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

  for (const route of activeRoutes) {
    const accountConfig = getAccountConfigById(route.accountId || 'primary');
    if (!accountConfig) {
      warnings.push('Account Astro route tidak ditemukan untuk ' + route.unitId + '.');
      continue;
    }
    if (!accountConfig.sessionCookie) {
      warnings.push('Session Solofleet belum ada untuk ' + (accountConfig.label || accountConfig.id) + '.');
      continue;
    }

    try {
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
      const routeRows = buildAstroDisplayRows(route, accountConfig, unitLabel, routeDiagnostics, startDate, endDate);
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
  const flatRows = rows.map(function (row) {
    return astroCore.flattenAstroRow(row, { maxPods: columnMeta.maxPods });
  });

  return {
    ok: true,
    rangeStartMs: range.rangeStartMs,
    rangeEndMs: range.rangeEndMs,
    filters: {
      accountId,
      unitId,
      startDate,
      endDate,
    },
    columns: columnMeta.columns,
    rows,
    flatRows,
    warnings,
    diagnostics,
    summary: {
      configuredRoutes: activeRoutes.length,
      rows: rows.length,
      maxPods: columnMeta.maxPods,
      accounts: new Set(rows.map(function (row) { return row.accountId; })).size,
      units: new Set(rows.map(function (row) { return row.accountId + '::' + row.unitId; })).size,
      warnings: warnings.length,
      partialRows: diagnostics.length,
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
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
  }
  if (/<!doctype html|<html/i.test(text)) {
    throw new Error('Solofleet returned HTML instead of JSON. Session cookie may be expired.');
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
    });
  }, delayMs);
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
      const nextRoutes = validateAstroRoutes(config.astroRoutes || [], nextLocations);
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
      const nextRoutes = validateAstroRoutes(Array.isArray(body.routes) ? body.routes : [], nextLocations);
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
      const nextRoutes = validateAstroRoutes(config.astroRoutes || [], mergedLocations);
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
      const nextRoutes = validateAstroRoutes(mergedRoutes, nextLocations);
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
      sendJson(res, 200, {
        ok: true,
        accountId,
        unit: detail.unit,
        snapshot: detail.snapshot,
        incidents: detail.incidents,
        records,
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

    if (method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
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
      send(res, 200, content, contentType);
    });
  });
}

async function requestHandler(req, res) {
  await storageInitializationPromise;
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const startedAt = Date.now();
  const method = req.method || 'GET';
  const pathName = url.pathname || '/';

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
  server.listen(PORT, HOST, async function () {
    console.log(`Solofleet auto monitor running at http://${HOST}:${PORT}`);
    try {
      await storageInitializationPromise;
      if (config && config.autoStart) {
        startPolling().catch(function (error) {
          state.runtime.lastRunMessage = error.message;
          state.runtime.isPolling = false;
          state.runtime.nextRunAt = null;
          config.autoStart = false;
          saveConfig();
          saveState();
        });
      }
    } catch (e) {
      console.error('Failed to initialize storage on startup:', e);
    }
  });
}































