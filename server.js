const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const core = require('./web/report-core.js');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const WEB_ROOT = fs.existsSync(path.join(__dirname, 'web-dist'))
  ? path.join(__dirname, 'web-dist')
  : path.join(__dirname, 'web');
const DATA_ROOT = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_ROOT, 'config.json');
const STATE_FILE = path.join(DATA_ROOT, 'state.json');

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
  linkedAccounts: [],
  activeAccountId: 'primary',
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

  const timestamp = Date.parse(value);
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
  merged.linkedAccounts = Array.isArray(merged.linkedAccounts)
    ? merged.linkedAccounts.map(normalizeLinkedAccount).filter(Boolean)
    : [];
  merged.activeAccountId = String(merged.activeAccountId || 'primary').trim() || 'primary';

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
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(DEFAULT_STATE, null, 2));
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
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function saveConfig() {
  saveJsonFile(CONFIG_FILE, config);
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

function saveState() {
  saveJsonFile(STATE_FILE, serializeStateForDisk());
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

function formatLocalDay(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalTime(timestamp) {
  const date = new Date(timestamp);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(function (value) {
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
    return `${snapshot.day}|${snapshot.accountId || accountConfig.id}|${snapshot.unitId}`;
  }));

  for (const [unitId, unitState] of Object.entries(accountState.units)) {
    const analysis = unitState.analysis || buildAnalysisFromRecords(unitState);
    for (const incident of analysis.incidents) {
      const day = formatLocalDay(incident.startTimestamp);
      const key = `${day}|${accountConfig.id}|${unitId}`;
      if (existingKeys.has(key)) {
        continue;
      }

      const record = findRecordForIncident(unitState, incident);
      const snapshot = accountState.fleet.vehicles[normalizeUnitKey(unitId)] || null;
      accountState.dailySnapshots.push({
        id: key,
        accountId: accountConfig.id,
        accountLabel: accountConfig.label,
        day,
        errorTimestamp: incident.startTimestamp,
        errorTime: formatLocalTime(incident.startTimestamp),
        unitId,
        unitLabel: unitState.label,
        vehicle: unitState.vehicle || unitState.label || unitId,
        type: incident.type,
        label: incident.label,
        durationMinutes: incident.durationMinutes,
        temp1: record ? record.temp1 : null,
        temp2: record ? record.temp2 : null,
        speed: record ? record.speed : null,
        latitude: snapshot?.latitude ?? null,
        longitude: snapshot?.longitude ?? null,
        locationSummary: snapshot?.locationSummary || '',
        zoneName: snapshot?.zoneName || '',
      });
      existingKeys.add(key);
    }
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

function initializeStorage() {
  ensureDataFiles();
  config = normalizeConfig(loadJsonFile(CONFIG_FILE, DEFAULT_CONFIG));
  state = normalizeState(loadJsonFile(STATE_FILE, DEFAULT_STATE));
  syncUnitsWithConfig();
  recomputeAllAnalyses();
  for (const accountConfig of getAllAccountConfigs()) {
    const accountState = ensureAccountState(accountConfig.id);
    captureDailyErrorSnapshots(accountConfig, accountState);
    capturePodSnapshots(accountConfig, accountState, buildFleetRows(accountConfig, accountState, Date.now(), buildLiveAlerts(accountConfig, accountState, Date.now())));
  }
  state.runtime.isPolling = false;
  state.runtime.nextRunAt = null;
  saveState();
}

function send(res, statusCode, content, contentType) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(content);
}

function sendJson(res, statusCode, payload) {
  res.__apiErrorMessage = payload && payload.error ? String(payload.error) : '';
  send(res, statusCode, JSON.stringify(payload, null, 2), 'application/json; charset=utf-8');
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
    activeAccountId: config.activeAccountId,
    accounts: getAllAccountConfigs().map(function (account) {
      return {
        id: account.id,
        label: account.label,
        authEmail: account.authEmail,
        hasSessionCookie: Boolean(account.sessionCookie),
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
    Email: email,
    Password: password,
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

  const resolvedEmail = String(email || '').trim();
  const requestedAccountId = String(loginOptions.accountId || '').trim();
  const linkedAccountLabel = String(loginOptions.label || resolvedEmail || requestedAccountId || 'Linked account').trim();

  if (requestedAccountId && requestedAccountId !== 'primary') {
    const linkedAccounts = Array.isArray(config.linkedAccounts) ? [...config.linkedAccounts] : [];
    const nextAccount = normalizeLinkedAccount({
      id: requestedAccountId,
      label: linkedAccountLabel,
      authEmail: resolvedEmail,
      sessionCookie: mergedCookie,
      vehicleRoleId: '',
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

function buildStatusPayload() {
  const now = Date.now();
  const accountSummaries = [];
  const fleetRows = [];
  const liveAlerts = [];
  const podSnapshots = [];

  for (const accountConfig of getAllAccountConfigs()) {
    const accountState = ensureAccountState(accountConfig.id);
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

  fleetRows.sort(function (left, right) {
    return String(left.accountLabel || left.accountId).localeCompare(String(right.accountLabel || right.accountId))
      || String(left.label || left.id).localeCompare(String(right.label || right.id));
  });
  liveAlerts.sort(function (left, right) {
    return (right.endTimestamp || 0) - (left.endTimestamp || 0);
  });
  podSnapshots.sort(function (left, right) {
    return (right.timestamp || 0) - (left.timestamp || 0);
  });

  return {
    now,
    config: sanitizeConfigForClient(),
    runtime: {
      ...state.runtime,
      pollInFlight,
      unitCount: fleetRows.length,
      liveAlertCount: liveAlerts.length,
      accountCount: getAllAccountConfigs().length,
    },
    accounts: accountSummaries,
    overview: buildOverview(fleetRows, liveAlerts),
    autoFilterCards: [
      {
        id: 'temp-error',
        label: 'Temp error',
        count: fleetRows.filter(function (row) { return row.hasLiveSensorFault; }).length,
        description: 'Unit yang live temp sensor-nya sedang 0',
      },
      {
        id: 'setpoint',
        label: 'Setpoint mismatch',
        count: fleetRows.filter(function (row) { return row.outsideSetpoint; }).length,
        description: 'Suhu live di luar min/max customer',
      },
      {
        id: 'gps-late',
        label: 'GPS late > 30 min',
        count: fleetRows.filter(function (row) { return row.minutesSinceUpdate !== null && row.minutesSinceUpdate > 30; }).length,
        description: 'Update GPS telat lebih dari 30 menit',
      },
    ],
    fleet: {
      fetchedAt: state.runtime.lastSnapshotAt,
      lastError: state.runtime.lastSnapshotError,
      rows: fleetRows,
    },
    liveAlerts,
    podSnapshots,
    units: fleetRows,
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
  for (const [unitId, unitState] of Object.entries(accountState.units)) {
    const analysis = unitState.analysis || buildAnalysisFromRecords(unitState);
    for (const incident of analysis.incidents) {
      if (incident.endTimestamp < now - freshnessMs) {
        continue;
      }
      liveAlerts.push({
        ...incident,
        accountId: accountConfig.id,
        accountLabel: accountConfig.label,
        unitId,
        unitLabel: unitState.label,
        rowKey: `${accountConfig.id}::${unitId}`,
        isCurrent: true,
      });
    }
  }

  liveAlerts.sort(function (left, right) {
    return right.endTimestamp - left.endTimestamp;
  });

  return liveAlerts;
}

function parseDateRange(searchParams) {
  const startValue = searchParams.get('startDate') || searchParams.get('start');
  const endValue = searchParams.get('endDate') || searchParams.get('end');
  return {
    rangeStartMs: core.parseDateInputStart(startValue),
    rangeEndMs: core.parseDateInputEnd(endValue),
  };
}

function buildReportPayload(searchParams) {
  const range = parseDateRange(searchParams);
  const incidents = [];
  const snapshotRows = [];
  const podRows = [];

  for (const accountConfig of getAllAccountConfigs()) {
    const accountState = ensureAccountState(accountConfig.id);
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
    snapshotRows.push(...buildDailySnapshotRows(accountState, range.rangeStartMs, range.rangeEndMs));
    podRows.push(...buildPodSnapshotRows(accountState, range.rangeStartMs, range.rangeEndMs));
  }

  const summary = core.summarizeIncidents(incidents, range.rangeStartMs, range.rangeEndMs);
  const compileByUnitDayMap = new Map();

  for (const incident of summary.alerts || []) {
    const incidentDay = formatLocalDay(incident.clippedStart || incident.startTimestamp || Date.now());
    const compileKey = `${incidentDay}|${incident.accountId || 'primary'}|${incident.unitId || incident.vehicle}`;
    if (!compileByUnitDayMap.has(compileKey)) {
      compileByUnitDayMap.set(compileKey, {
        day: incidentDay,
        accountId: incident.accountId || 'primary',
        accountLabel: incident.accountLabel || incident.accountId || 'primary',
        unitId: incident.unitId || incident.vehicle,
        unitLabel: incident.unitLabel || incident.vehicle,
        vehicle: incident.unitLabel || incident.vehicle,
        incidents: 0,
        temp1Incidents: 0,
        temp2Incidents: 0,
        bothIncidents: 0,
        totalMinutes: 0,
        longestMinutes: 0,
      });
    }

    const compileRow = compileByUnitDayMap.get(compileKey);
    compileRow.incidents += 1;
    compileRow.totalMinutes += Number(incident.clippedDurationMinutes || incident.durationMinutes || 0);
    compileRow.longestMinutes = Math.max(
      compileRow.longestMinutes,
      Number(incident.clippedDurationMinutes || incident.durationMinutes || 0),
    );

    if (incident.type === 'temp1') {
      compileRow.temp1Incidents += 1;
    } else if (incident.type === 'temp2') {
      compileRow.temp2Incidents += 1;
    } else if (incident.type === 'temp1+temp2') {
      compileRow.bothIncidents += 1;
    }
  }

  const compileByUnitDay = [...compileByUnitDayMap.values()].map(function (row) {
    return {
      ...row,
      totalMinutes: Number(row.totalMinutes.toFixed(2)),
      longestMinutes: Number(row.longestMinutes.toFixed(2)),
    };
  }).sort(function (left, right) {
    return right.day.localeCompare(left.day)
      || String(left.accountLabel || left.accountId).localeCompare(String(right.accountLabel || right.accountId))
      || String(left.vehicle || left.unitId).localeCompare(String(right.vehicle || right.unitId));
  });

  snapshotRows.sort(function (left, right) { return (right.errorTimestamp || 0) - (left.errorTimestamp || 0); });
  podRows.sort(function (left, right) { return (right.timestamp || 0) - (left.timestamp || 0); });
  return {
    now: Date.now(),
    rangeStartMs: range.rangeStartMs,
    rangeEndMs: range.rangeEndMs,
    ...summary,
    compileByUnitDay,
    rawAlerts: summary.alerts,
    dailySnapshots: snapshotRows,
    podSnapshots: podRows,
    alerts: snapshotRows,
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
    const timestamp = Date.parse(
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

async function fetchUnitHistory(accountConfig, unitId, rangeStartMs, rangeEndMs) {
  const endpointUrl = new URL(config.endpointPath, config.solofleetBaseUrl);
  const refererUrl = new URL(config.refererPath, config.solofleetBaseUrl);
  const body = {
    ddl: unitId,
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

    if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const email = String(body.email || '').trim();
      const password = String(body.password || '');
      if (!email || !password) {
        throw new Error('Email and password are required.');
      }
      const configPayload = await loginToSolofleet(email, password, body.rememberMe !== false, {
        accountId: body.accountId,
        label: body.label,
      });
      sendJson(res, 200, {
        ok: true,
        config: configPayload,
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
      });
    }
    return true;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    sendJson(res, 200, {
      ok: true,
      config: logoutFromSolofleet((await readRequestBody(req)).accountId),
    });
    return true;
  }
  if (pathname === '/api/config' && method === 'GET') {
    sendJson(res, 200, sanitizeConfigForClient());
    return true;
  }

  if (pathname === '/api/config' && method === 'POST') {
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
      sendJson(res, 500, {
        ok: false,
        error: error.message,
      });
    }
    return true;
  }

  if (pathname === '/api/status' && method === 'GET') {
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

    sendJson(res, 200, buildStatusPayload());
    return true;
  }

  if (pathname === '/api/report' && method === 'GET') {
    sendJson(res, 200, buildReportPayload(url.searchParams));
    return true;
  }

  if (pathname === '/api/monitor' && method === 'GET') {
    sendJson(res, 200, buildApiMonitorPayload());
    return true;
  }

  if (pathname === '/api/report/pod' && method === 'GET') {
    const range = parseDateRange(url.searchParams);
    const rows = getAllAccountConfigs().flatMap(function (account) {
      return buildPodSnapshotRows(ensureAccountState(account.id), range.rangeStartMs, range.rangeEndMs);
    }).sort(function (left, right) {
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
      const accountConfig = getAccountConfigById(accountId);
      if (!accountConfig) {
        throw new Error(`Account not found: ${accountId}`);
      }
      const result = await fetchStopReport(accountConfig, unitId, {
        rangeStartMs: range.rangeStartMs,
        rangeEndMs: range.rangeEndMs,
        reportType: url.searchParams.get('reportType') || '3',
        minDurationMinutes: url.searchParams.get('minDuration') || '0',
        processLive: url.searchParams.get('processLive') || '1',
        withTrack: url.searchParams.get('withTrack') || 'withtrack',
      });

      sendJson(res, 200, {
        ok: true,
        accountId,
        ...result,
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
      });
    }
    return true;
  }

    if (pathname === '/api/unit-history' && method === 'GET') {
    try {
      const unitId = String(url.searchParams.get('unitId') || '').trim();
      const accountId = String(url.searchParams.get('accountId') || config.activeAccountId || 'primary').trim();
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
      const history = await fetchUnitHistory(accountConfig, unitId, range.rangeStartMs, range.rangeEndMs);
      sendJson(res, 200, {
        ok: true,
        accountId,
        unit: detail.unit,
        snapshot: detail.snapshot,
        incidents: detail.incidents,
        records: history.records,
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
      });
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
      sendJson(res, 404, {
        ok: false,
        error: error.message,
      });
    }
    return true;
  }

  if (pathname === '/api/poll/run' && method === 'POST') {
    try {
      const result = await runPollCycle('manual');
      sendJson(res, 200, {
        ok: true,
        result,
        status: buildStatusPayload(),
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        status: buildStatusPayload(),
      });
    }
    return true;
  }

  if (pathname === '/api/poll/start' && method === 'POST') {
    try {
      await startPolling();
      sendJson(res, 200, {
        ok: true,
        status: buildStatusPayload(),
      });
    } catch (error) {
      state.runtime.isPolling = false;
      state.runtime.nextRunAt = null;
      config.autoStart = false;
      saveConfig();
      saveState();
      sendJson(res, 500, {
        ok: false,
        error: error.message,
        status: buildStatusPayload(),
      });
    }
    return true;
  }

  if (pathname === '/api/poll/stop' && method === 'POST') {
    stopPolling();
    sendJson(res, 200, {
      ok: true,
      status: buildStatusPayload(),
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

initializeStorage();

async function requestHandler(req, res) {
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
    sendJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

module.exports = {
  requestHandler,
  initializeStorage,
};

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, HOST, function () {
    console.log(`Solofleet auto monitor running at http://${HOST}:${PORT}`);
    if (config.autoStart) {
      startPolling().catch(function (error) {
        state.runtime.lastRunMessage = error.message;
        state.runtime.isPolling = false;
        state.runtime.nextRunAt = null;
        config.autoStart = false;
        saveConfig();
        saveState();
      });
    }
  });
}















