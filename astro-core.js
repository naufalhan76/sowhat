const MIN_VALID_STAY_MS = 3 * 60 * 1000;
const GEOFENCE_MIN_VALID_STAY_MS = Number(process.env.GEOFENCE_MIN_VALID_STAY_MS || (5 * 60 * 1000));
const SOLOFLEET_UTC_OFFSET_MINUTES = Number(process.env.SOLOFLEET_UTC_OFFSET_MINUTES || 420);
const EXPORT_TIMEZONE = String(process.env.ASTRO_EXPORT_TIMEZONE || process.env.APP_TIMEZONE || 'Asia/Bangkok').trim() || 'Asia/Bangkok';
const ASTRO_SPECIAL_WH_TEMP_THRESHOLD = Number(process.env.ASTRO_SPECIAL_WH_TEMP_THRESHOLD || 15);
const GEOFENCE_LOCATION_TYPES = ['WH', 'POD', 'POOL', 'POL', 'REST', 'PELABUHAN'];

function toSolofleetLocalDate(timestamp) {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return new Date(numeric + (SOLOFLEET_UTC_OFFSET_MINUTES * 60 * 1000));
}

function formatDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: EXPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: lookup.day || '',
    month: lookup.month || '',
    year: lookup.year || '',
    hour: lookup.hour || '',
    minute: lookup.minute || '',
  };
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

function splitCsvish(value) {
  return String(value || '')
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value, prefix) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || `${prefix}-${Date.now()}`;
}

function normalizeTimeWindow(value, fallbackStart, fallbackEnd) {
  const source = value && typeof value === 'object' ? value : {};
  const start = String(source.start || fallbackStart || '').trim();
  const end = String(source.end || fallbackEnd || '').trim();
  if (!isValidTimeText(start) || !isValidTimeText(end)) {
    return null;
  }
  return {
    start,
    end,
    enabled: source.enabled === undefined ? true : Boolean(source.enabled),
  };
}

function isValidTimeText(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ''));
}

function timeTextToMinutes(value) {
  if (!isValidTimeText(value)) {
    return null;
  }
  const [hour, minute] = String(value).split(':').map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function normalizeOptionalTimeText(value) {
  const text = String(value || '').trim();
  return isValidTimeText(text) ? text : '';
}

function normalizePodTimeSlaArray(value, podCount) {
  const count = Math.max(0, Number(podCount || 0));
  const source = Array.isArray(value) ? value : splitCsvish(value);
  const normalized = source.slice(0, count).map((item) => normalizeOptionalTimeText(item));
  while (normalized.length < count) {
    normalized.push('');
  }
  return normalized;
}

function normalizeAstroLocation(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const name = String(value.name || value.locationName || value.id || '').trim();
  if (!name) {
    return null;
  }

  const latitude = toNumber(value.latitude ?? value.lat);
  const longitude = toNumber(value.longitude ?? value.lng ?? value.longtitude);
  if (latitude === null || longitude === null) {
    return null;
  }

  const type = String(value.type || value.locationType || 'POD').trim().toUpperCase();
  if (!GEOFENCE_LOCATION_TYPES.includes(type)) {
    return null;
  }

  const scopeMode = String(value.scopeMode || ((value.scopeAccountIds || value.scopeCustomers || value.scopeCustomerNames) ? 'hybrid' : 'global')).trim().toLowerCase();
  const normalizedScopeMode = ['global', 'account', 'customer', 'hybrid'].includes(scopeMode) ? scopeMode : 'global';

  return {
    id: String(value.id || slugify(name, 'astro-location')).trim(),
    name,
    latitude,
    longitude,
    radiusMeters: Math.max(20, toNumber(value.radiusMeters ?? value.radius ?? 150) || 150),
    type,
    scopeMode: normalizedScopeMode,
    scopeAccountIds: splitCsvish(value.scopeAccountIds).map((item) => String(item || '').trim()).filter(Boolean),
    scopeCustomerNames: splitCsvish(value.scopeCustomerNames ?? value.scopeCustomers).map((item) => String(item || '').trim()).filter(Boolean),
    isActive: value.isActive === undefined ? true : Boolean(value.isActive),
    notes: String(value.notes || '').trim(),
  };
}

function normalizeAstroRoute(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const unitId = String(value.unitId || value.nopol || value.plate || '').trim().toUpperCase();
  if (!unitId) {
    return null;
  }

  const rit1Window = normalizeTimeWindow(value.rit1, '05:00', '14:59');
  const rit2Window = normalizeTimeWindow(value.rit2, '', '');
  const accountId = String(value.accountId || 'primary').trim() || 'primary';
  const whLocationId = String(value.whLocationId || '').trim();
  const poolLocationId = String(value.poolLocationId || '').trim();
  const podSequence = (Array.isArray(value.podSequence) ? value.podSequence : splitCsvish(value.podSequence))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const routeSignature = [
    whLocationId,
    poolLocationId || 'no-pool',
    podSequence.join('-') || 'no-pod',
  ].join('--');

  const whArrivalTempMinSla = toNumber(value.whArrivalTempMinSla ?? value.whTempMinSla ?? value.whArrivalTempMin ?? '');
  const whArrivalTempMaxSla = toNumber(value.whArrivalTempMaxSla ?? value.whTempMaxSla ?? value.whArrivalTempMax ?? '');
  const rit1WhArrivalTimeSla = normalizeOptionalTimeText(value.rit1?.whArrivalTimeSla ?? value.rit1WhArrivalTimeSla ?? value.rit1WhSla ?? '');
  const rit2WhArrivalTimeSla = normalizeOptionalTimeText(value.rit2?.whArrivalTimeSla ?? value.rit2WhArrivalTimeSla ?? value.rit2WhSla ?? '');
  const rit1PodArrivalTimeSlas = normalizePodTimeSlaArray(value.rit1?.podArrivalTimeSlas ?? value.rit1PodArrivalTimeSlas ?? '', podSequence.length);
  const rit2PodArrivalTimeSlas = normalizePodTimeSlaArray(value.rit2?.podArrivalTimeSlas ?? value.rit2PodArrivalTimeSlas ?? '', podSequence.length);

  return {
    id: String(value.id || `${normalizeUnitKey(accountId)}-${slugify(unitId, 'astro-route')}-${slugify(routeSignature, 'path')}`).trim(),
    accountId,
    unitId,
    customerName: String(value.customerName || 'Astro').trim() || 'Astro',
    whLocationId,
    poolLocationId,
    podSequence,
    rit1: rit1Window ? {
      ...rit1Window,
      whArrivalTimeSla: rit1WhArrivalTimeSla,
      podArrivalTimeSlas: rit1PodArrivalTimeSlas,
    } : null,
    rit2: rit2Window ? {
      ...rit2Window,
      whArrivalTimeSla: rit2WhArrivalTimeSla,
      podArrivalTimeSlas: rit2PodArrivalTimeSlas,
    } : null,
    whArrivalTempMinSla,
    whArrivalTempMaxSla,
    isActive: value.isActive === undefined ? true : Boolean(value.isActive),
    notes: String(value.notes || '').trim(),
  };
}

function parseAstroLocationCsv(csvText) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  const errors = [];

  lines.forEach((line, index) => {
    const parts = line.split(',').map((item) => item.trim());
    if (index === 0 && /nama tempat/i.test(parts[0] || '')) {
      return;
    }
    const location = normalizeAstroLocation({
      name: parts[0],
      latitude: parts[1],
      longitude: parts[2],
      radiusMeters: parts[3],
      type: parts[4],
      scopeMode: parts[5] || 'global',
      scopeAccountIds: parts[6] || '',
      scopeCustomerNames: parts[7] || '',
    });
    if (!location) {
      errors.push(`Row ${index + 1} invalid. Format wajib: Nama Tempat, Latitude, Longitude, Radius, Type, Scope Mode (opsional), Account Scope (opsional), Customer Scope (opsional).`);
      return;
    }
    rows.push(location);
  });

  return { rows, errors };
}

function parseBooleanish(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'active'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'inactive'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function resolveLocationReference(reference, locations, expectedType) {
  const target = String(reference || '').trim();
  if (!target) {
    return '';
  }
  const expected = expectedType ? String(expectedType).trim().toUpperCase() : '';
  const normalized = target.toLowerCase();
  const candidates = (locations || []).filter((location) => {
    if (!location) return false;
    if (expected && String(location.type || '').toUpperCase() !== expected) return false;
    return true;
  });
  const exactId = candidates.find((location) => String(location.id || '').trim().toLowerCase() === normalized);
  if (exactId) return exactId.id;
  const exactName = candidates.find((location) => String(location.name || '').trim().toLowerCase() === normalized);
  if (exactName) return exactName.id;
  return '';
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseAstroRouteCsv(csvText, locations) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  const errors = [];

  const headerAliases = {
    accountid: 'accountId',
    account: 'accountId',
    nopol: 'unitId',
    unitid: 'unitId',
    unit: 'unitId',
    customer: 'customerName',
    wh: 'whLocationId',
    warehouse: 'whLocationId',
    pool: 'poolLocationId',
    rit1start: 'rit1Start',
    rit1end: 'rit1End',
    rit2enabled: 'rit2Enabled',
    rit2start: 'rit2Start',
    rit2end: 'rit2End',
    active: 'isActive',
    notes: 'notes',
    wharrivaltempminsla: 'whArrivalTempMinSla',
    wharrivaltempmin: 'whArrivalTempMinSla',
    wharrivaltempmaxsla: 'whArrivalTempMaxSla',
    wharrivaltempmax: 'whArrivalTempMaxSla',
    rit1wharrivaltimesla: 'rit1WhArrivalTimeSla',
    rit2wharrivaltimesla: 'rit2WhArrivalTimeSla',
  };
  for (let index = 1; index <= 5; index += 1) {
    headerAliases[`pod${index}`] = `pod${index}`;
    headerAliases[`rit1pod${index}sla`] = `rit1Pod${index}ArrivalTimeSla`;
    headerAliases[`rit1pod${index}arrivaltimesla`] = `rit1Pod${index}ArrivalTimeSla`;
    headerAliases[`rit2pod${index}sla`] = `rit2Pod${index}ArrivalTimeSla`;
    headerAliases[`rit2pod${index}arrivaltimesla`] = `rit2Pod${index}ArrivalTimeSla`;
  }

  let headerMap = null;
  if (lines.length) {
    const firstParts = parseCsvLine(lines[0]);
    const mapped = {};
    firstParts.forEach((part, index) => {
      const normalized = String(part || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
      const key = headerAliases[normalized];
      if (key && mapped[key] === undefined) {
        mapped[key] = index;
      }
    });
    if (mapped.accountId !== undefined || mapped.unitId !== undefined || mapped.whLocationId !== undefined) {
      headerMap = mapped;
    }
  }

  lines.forEach((line, index) => {
    const parts = parseCsvLine(line);
    if (headerMap && index === 0) {
      return;
    }
    if (!headerMap && index === 0 && /account\s*id/i.test(parts[0] || '')) {
      return;
    }

    let routeInput;
    if (headerMap) {
      const podSequence = [];
      const rit1PodArrivalTimeSlas = [];
      const rit2PodArrivalTimeSlas = [];
      for (let podIndex = 1; podIndex <= 5; podIndex += 1) {
        const podReference = parts[headerMap[`pod${podIndex}`]] || '';
        const resolvedPod = resolveLocationReference(podReference, locations, 'POD');
        if (resolvedPod) {
          podSequence.push(resolvedPod);
        }
        rit1PodArrivalTimeSlas.push(parts[headerMap[`rit1Pod${podIndex}ArrivalTimeSla`]] || '');
        rit2PodArrivalTimeSlas.push(parts[headerMap[`rit2Pod${podIndex}ArrivalTimeSla`]] || '');
      }
      const rit2Enabled = parseBooleanish(parts[headerMap.rit2Enabled], false);
      routeInput = {
        accountId: parts[headerMap.accountId] || 'primary',
        unitId: parts[headerMap.unitId],
        customerName: parts[headerMap.customerName] || 'Astro',
        whLocationId: resolveLocationReference(parts[headerMap.whLocationId], locations, 'WH'),
        poolLocationId: resolveLocationReference(parts[headerMap.poolLocationId], locations, 'POOL'),
        podSequence,
        rit1: {
          start: parts[headerMap.rit1Start] || '05:00',
          end: parts[headerMap.rit1End] || '14:59',
          enabled: true,
          whArrivalTimeSla: parts[headerMap.rit1WhArrivalTimeSla] || '',
          podArrivalTimeSlas: rit1PodArrivalTimeSlas,
        },
        rit2: rit2Enabled ? {
          start: parts[headerMap.rit2Start] || '19:00',
          end: parts[headerMap.rit2End] || '06:00',
          enabled: true,
          whArrivalTimeSla: parts[headerMap.rit2WhArrivalTimeSla] || '',
          podArrivalTimeSlas: rit2PodArrivalTimeSlas,
        } : null,
        whArrivalTempMinSla: parts[headerMap.whArrivalTempMinSla] || '',
        whArrivalTempMaxSla: parts[headerMap.whArrivalTempMaxSla] || '',
        isActive: parseBooleanish(parts[headerMap.isActive], true),
        notes: parts[headerMap.notes] || '',
      };
    } else {
      const podValues = parts.slice(5, Math.max(5, parts.length - 7));
      routeInput = {
        accountId: parts[0] || 'primary',
        unitId: parts[1],
        customerName: parts[2] || 'Astro',
        whLocationId: resolveLocationReference(parts[3], locations, 'WH'),
        poolLocationId: resolveLocationReference(parts[4], locations, 'POOL'),
        podSequence: podValues.map((value) => resolveLocationReference(value, locations, 'POD')).filter(Boolean),
        rit1: { start: parts[parts.length - 7] || '05:00', end: parts[parts.length - 6] || '14:59', enabled: true },
        rit2: parseBooleanish(parts[parts.length - 5], false) ? { start: parts[parts.length - 4] || '19:00', end: parts[parts.length - 3] || '06:00', enabled: true } : null,
        isActive: parseBooleanish(parts[parts.length - 2], true),
        notes: parts[parts.length - 1] || '',
      };
    }

    const route = normalizeAstroRoute(routeInput);
    if (!route || !route.unitId || !route.whLocationId) {
      errors.push('Row ' + (index + 1) + ' invalid. Format wajib: Account ID, Nopol, Customer, WH, POOL, POD1..PODN, Rit1 Start, Rit1 End, Rit2 Enabled, Rit2 Start, Rit2 End, Active, Notes. KPI SLA columns optional.');
      return;
    }
    rows.push(route);
  });

  return { rows, errors };
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

function buildLocationMap(locations) {
  const map = new Map();
  for (const location of locations || []) {
    if (location && location.id) {
      map.set(location.id, location);
    }
  }
  return map;
}

function routeLocationIds(route) {
  return [route.whLocationId, route.poolLocationId, ...(route.podSequence || [])].filter(Boolean);
}

function routeMatchesRow(route, row) {
  return normalizeUnitKey(route.unitId) === normalizeUnitKey(row.id) && String(route.accountId || 'primary') === String(row.accountId || 'primary');
}

function findCurrentAstroLocation(row, route, locationMap) {
  if (row.latitude === null || row.longitude === null) {
    return null;
  }
  const matches = [];
  for (const locationId of routeLocationIds(route)) {
    const location = locationMap.get(locationId);
    if (!location || !location.isActive) {
      continue;
    }
    const distance = distanceMeters(row.latitude, row.longitude, location.latitude, location.longitude);
    if (distance <= location.radiusMeters) {
      matches.push({
        ...location,
        distanceMeters: distance,
      });
    }
  }
  matches.sort((left, right) => left.distanceMeters - right.distanceMeters);
  return matches[0] || null;
}

function annotateFleetRowsWithAstro(fleetRows, routes, locations) {
  const locationMap = buildLocationMap(locations);
  return (fleetRows || []).map((row) => {
    const route = (routes || []).find((candidate) => candidate.isActive !== false && routeMatchesRow(candidate, row)) || null;
    if (!route) {
      return row;
    }
    const currentLocation = findCurrentAstroLocation(row, route, locationMap);
    return {
      ...row,
      astroRouteId: route.id,
      astroCustomerName: route.customerName || 'Astro',
      astroWhName: locationMap.get(route.whLocationId)?.name || '',
      astroCurrentLocation: currentLocation ? currentLocation.name : '',
      astroCurrentLocationType: currentLocation ? currentLocation.type : '',
      astroCurrentDistanceMeters: currentLocation ? Number(currentLocation.distanceMeters.toFixed(1)) : null,
      astroActive: true,
      astroStatusLabel: currentLocation ? `${currentLocation.type} ${currentLocation.name}` : 'En route Astro',
    };
  });
}

function probeTemperature(record) {
  const values = [toNumber(record.temp1), toNumber(record.temp2)].filter((value) => value !== null);
  if (!values.length) {
    return null;
  }
  return Math.min(...values);
}

function buildVisitEvents(records, location) {
  const events = [];
  let segment = null;

  function finalizeSegment() {
    if (!segment) {
      return;
    }
    const durationMs = (segment.lastTimestamp || 0) - (segment.enteredAt || 0);
    if (durationMs >= MIN_VALID_STAY_MS) {
      events.push({
        locationId: location.id,
        locationName: location.name,
        locationType: location.type,
        eta: segment.enteredAt,
        etd: segment.lastTimestamp,
        durationMinutes: Number((durationMs / 60000).toFixed(2)),
        arrivalTemp: segment.minTemp,
        departureTemp: segment.lastTemp,
        pointCount: segment.pointCount,
      });
    }
    segment = null;
  }

  for (const record of records || []) {
    const latitude = toNumber(record.latitude);
    const longitude = toNumber(record.longitude);
    if (latitude === null || longitude === null || !record.timestamp) {
      finalizeSegment();
      continue;
    }
    const distance = distanceMeters(latitude, longitude, location.latitude, location.longitude);
    const inside = distance <= location.radiusMeters;
    if (!inside) {
      finalizeSegment();
      continue;
    }

    const probeTemp = probeTemperature(record);
    if (!segment) {
      segment = {
        enteredAt: record.timestamp,
        lastTimestamp: record.timestamp,
        minTemp: probeTemp,
        lastTemp: probeTemp,
        pointCount: 1,
      };
      continue;
    }

    segment.lastTimestamp = record.timestamp;
    segment.pointCount += 1;
    segment.lastTemp = probeTemp;
    if (probeTemp !== null) {
      segment.minTemp = segment.minTemp === null ? probeTemp : Math.min(segment.minTemp, probeTemp);
    }
  }

  finalizeSegment();
  return events;
}

function normalizeScopeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function locationMatchesScope(location, context) {
  if (!location) {
    return false;
  }
  const accountKeys = (location.scopeAccountIds || []).map(normalizeScopeKey).filter(Boolean);
  const customerKeys = (location.scopeCustomerNames || []).map(normalizeScopeKey).filter(Boolean);
  const accountKey = normalizeScopeKey(context?.accountId || 'primary');
  const customerKey = normalizeScopeKey(context?.customerName || '');

  const accountMatches = !accountKeys.length || accountKeys.includes(accountKey);
  const customerMatches = !customerKeys.length || (customerKey && customerKeys.includes(customerKey));
  return accountMatches && customerMatches;
}

function findNearestGeofenceMatch(point, locations, context) {
  const latitude = toNumber(point?.latitude);
  const longitude = toNumber(point?.longitude);
  if (latitude === null || longitude === null) {
    return null;
  }

  const matches = [];
  for (const location of locations || []) {
    if (!location || location.isActive === false || !locationMatchesScope(location, context)) {
      continue;
    }
    const distance = distanceMeters(latitude, longitude, location.latitude, location.longitude);
    if (distance <= location.radiusMeters) {
      matches.push({
        ...location,
        distanceMeters: distance,
      });
    }
  }

  matches.sort((left, right) => left.distanceMeters - right.distanceMeters);
  return matches[0] || null;
}

function formatGeofenceStatusLabel(location) {
  if (!location) {
    return '';
  }
  return `Sampai ${location.type} ${location.name}`;
}

function buildGeofenceEvents(records, locations, context, minimumStayMs = GEOFENCE_MIN_VALID_STAY_MS) {
  const sortedRecords = [...(records || [])]
    .filter((record) => record && Number(record.timestamp))
    .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));
  const events = [];
  let segment = null;

  function finalizeSegment() {
    if (!segment) {
      return;
    }
    const durationMs = (segment.lastTimestamp || 0) - (segment.enteredAt || 0);
    if (durationMs >= minimumStayMs) {
      events.push({
        locationId: segment.location.id,
        locationName: segment.location.name,
        locationType: segment.location.type,
        enteredAt: segment.enteredAt,
        leftAt: segment.lastTimestamp,
        durationMinutes: Number((durationMs / 60000).toFixed(2)),
        distanceMeters: Number((segment.lastDistance ?? segment.firstDistance ?? 0).toFixed(1)),
        statusLabel: formatGeofenceStatusLabel(segment.location),
      });
    }
    segment = null;
  }

  for (const record of sortedRecords) {
    const matchedLocation = findNearestGeofenceMatch(record, locations, context);
    if (!matchedLocation) {
      finalizeSegment();
      continue;
    }

    if (!segment || segment.location.id !== matchedLocation.id) {
      finalizeSegment();
      segment = {
        location: matchedLocation,
        enteredAt: Number(record.timestamp || 0),
        lastTimestamp: Number(record.timestamp || 0),
        firstDistance: matchedLocation.distanceMeters,
        lastDistance: matchedLocation.distanceMeters,
      };
      continue;
    }

    segment.lastTimestamp = Number(record.timestamp || 0);
    segment.lastDistance = matchedLocation.distanceMeters;
  }

  finalizeSegment();
  return events;
}

function findCurrentGeofencePresence(records, locations, context, minimumStayMs = GEOFENCE_MIN_VALID_STAY_MS) {
  const sortedRecords = [...(records || [])]
    .filter((record) => record && Number(record.timestamp))
    .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));
  if (!sortedRecords.length) {
    return null;
  }

  const latestTimestamp = Number(sortedRecords[sortedRecords.length - 1].timestamp || 0);
  const recentRecords = sortedRecords.filter((record) => Number(record.timestamp || 0) >= latestTimestamp - Math.max(minimumStayMs * 3, 30 * 60 * 1000));
  const events = buildGeofenceEvents(recentRecords, locations, context, minimumStayMs);
  if (!events.length) {
    return null;
  }
  const latestEvent = events[events.length - 1];
  if (latestEvent.leftAt !== latestTimestamp) {
    return null;
  }
  return latestEvent;
}

function isSpecialAstroWhTemperatureFallback(location) {
  if (!location || String(location.type || '').toUpperCase() !== 'WH') {
    return false;
  }
  const normalized = `${location.id || ''} ${location.name || ''}`.trim().toLowerCase();
  return normalized.includes('cibinong') || /\bcbn\b/.test(normalized);
}

function buildSpecialWhTemperatureFallbackVisits(route, location, records, existingVisits) {
  if (!route || !location || !isSpecialAstroWhTemperatureFallback(location)) {
    return [];
  }

  const existingKeys = new Set((existingVisits || [])
    .filter((visit) => visit && visit.locationId === route.whLocationId)
    .map((visit) => {
      const info = inferRitInfo(visit.etd || visit.eta, route);
      return info ? `${info.serviceDate}|${info.key}` : '';
    })
    .filter(Boolean));

  const fallbackByKey = new Map();
  const sortedRecords = [...(records || [])]
    .filter((record) => record && Number(record.timestamp))
    .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));

  for (const record of sortedRecords) {
    const probeTemp = probeTemperature(record);
    if (probeTemp === null || probeTemp > ASTRO_SPECIAL_WH_TEMP_THRESHOLD) {
      continue;
    }

    const ritInfo = inferRitInfo(record.timestamp, route);
    if (!ritInfo) {
      continue;
    }

    const key = `${ritInfo.serviceDate}|${ritInfo.key}`;
    if (existingKeys.has(key) || fallbackByKey.has(key)) {
      continue;
    }

    fallbackByKey.set(key, {
      locationId: location.id,
      locationName: location.name,
      locationType: location.type,
      eta: record.timestamp,
      etd: record.timestamp,
      durationMinutes: 0,
      arrivalTemp: probeTemp,
      departureTemp: probeTemp,
      pointCount: 1,
      inferredBy: 'temperature-threshold',
    });
  }

  return [...fallbackByKey.values()];
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

function shiftDay(dayText, deltaDays) {
  const match = String(dayText || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return '';
  }
  const [, year, month, day] = match;
  const utcTimestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0)
    - (SOLOFLEET_UTC_OFFSET_MINUTES * 60 * 1000)
    + (deltaDays * 24 * 60 * 60 * 1000);
  return formatLocalDay(utcTimestamp);
}

function inferRitInfo(timestamp, route) {
  const windows = [
    { key: 'rit1', label: 'Rit 1', window: route.rit1 },
    { key: 'rit2', label: 'Rit 2', window: route.rit2 },
  ].filter((entry) => entry.window && entry.window.enabled !== false);

  const date = toSolofleetLocalDate(timestamp);
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const localDay = formatLocalDay(timestamp);

  for (const entry of windows) {
    const startMinutes = timeTextToMinutes(entry.window.start);
    const endMinutes = timeTextToMinutes(entry.window.end);
    if (startMinutes === null || endMinutes === null) {
      continue;
    }

    if (startMinutes <= endMinutes) {
      if (minutes >= startMinutes && minutes <= endMinutes) {
        return {
          key: entry.key,
          label: entry.label,
          serviceDate: localDay,
          start: entry.window.start,
          end: entry.window.end,
        };
      }
      continue;
    }

    if (minutes >= startMinutes) {
      return {
        key: entry.key,
        label: entry.label,
        serviceDate: localDay,
        start: entry.window.start,
        end: entry.window.end,
      };
    }

    if (minutes <= endMinutes) {
      return {
        key: entry.key,
        label: entry.label,
        serviceDate: shiftDay(localDay, -1),
        start: entry.window.start,
        end: entry.window.end,
      };
    }
  }

  return null;
}

function resolveVisitWindowRecords(records, visit, route, ritInfo) {
  return [...(records || [])]
    .filter((record) => {
      const timestamp = Number(record?.timestamp || 0);
      if (!timestamp || timestamp < visit.eta || timestamp > visit.etd) {
        return false;
      }
      const info = inferRitInfo(timestamp, route);
      return Boolean(info && info.key === ritInfo.key && info.serviceDate === ritInfo.serviceDate);
    })
    .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0));
}

function resolveWhVisitTiming(route, location, visit, records, ritInfo) {
  if (!visit || !ritInfo) {
    return {
      eta: visit?.eta || null,
      arrivalTemp: visit?.arrivalTemp ?? null,
    };
  }

  const windowRecords = resolveVisitWindowRecords(records, visit, route, ritInfo);
  if (!windowRecords.length) {
    return {
      eta: visit.eta,
      arrivalTemp: visit.arrivalTemp,
    };
  }

  const minWindowTemp = windowRecords.reduce((lowest, record) => {
    const probeTemp = probeTemperature(record);
    if (probeTemp === null) {
      return lowest;
    }
    if (lowest === null) {
      return probeTemp;
    }
    return Math.min(lowest, probeTemp);
  }, null);
  const arrivalTemp = minWindowTemp ?? visit.arrivalTemp ?? null;

  if (isSpecialAstroWhTemperatureFallback(location)) {
    const tempThresholdRecord = windowRecords.find((record) => {
      const probeTemp = probeTemperature(record);
      return probeTemp !== null && probeTemp <= ASTRO_SPECIAL_WH_TEMP_THRESHOLD;
    });
    if (tempThresholdRecord) {
      return {
        eta: tempThresholdRecord.timestamp,
        arrivalTemp,
      };
    }
  }

  const firstWindowRecord = windowRecords[0];
  return {
    eta: firstWindowRecord.timestamp,
    arrivalTemp,
  };
}

function buildRouteReportRows(route, locations, records) {
  const locationMap = buildLocationMap(locations);
  const relevantLocations = routeLocationIds(route)
    .map((locationId) => locationMap.get(locationId))
    .filter(Boolean)
    .filter((location) => location.isActive !== false);
  let visits = relevantLocations.flatMap((location) => buildVisitEvents(records, location));
  const whLocation = locationMap.get(route.whLocationId);
  if (whLocation) {
    visits = visits.concat(buildSpecialWhTemperatureFallbackVisits(route, whLocation, records, visits));
  }
  visits.sort((left, right) => left.eta - right.eta || left.etd - right.etd);
  const whVisits = visits.filter((visit) => visit.locationId === route.whLocationId);
  const validWindowWhVisits = whVisits.filter((visit) => inferRitInfo(visit.etd || visit.eta, route));

  const rows = [];
  const consumedUntilByKey = new Map();

  for (const visit of validWindowWhVisits) {
    const whName = locationMap.get(route.whLocationId)?.name || 'WH';
    const ritAnchorTimestamp = visit.etd || visit.eta;
    const ritInfo = inferRitInfo(ritAnchorTimestamp, route);
    const effectiveWh = resolveWhVisitTiming(route, whLocation, visit, records, ritInfo);
    const consumptionKey = ritInfo
      ? `${ritInfo.serviceDate}|${ritInfo.key}`
      : `outside|${formatLocalDay(visit.eta)}`;
    const consumedUntil = consumedUntilByKey.get(consumptionKey) || 0;
    if ((effectiveWh.eta || visit.eta) < consumedUntil) {
      continue;
    }

    const returnWh = visits.find((candidate) => candidate.locationId === route.whLocationId && candidate.eta > visit.etd);
    if (!returnWh) {
      rows.push({
        routeId: route.id,
        accountId: route.accountId || 'primary',
        unitId: route.unitId,
        customer: route.customerName || 'Astro',
        serviceDate: ritInfo.serviceDate,
        rit: ritInfo.label,
        ritKey: ritInfo.key,
        status: 'awaiting_return_wh',
        reason: 'Route already started from WH, but there is no return-to-WH event yet in the selected range.',
        whName,
        whEta: effectiveWh.eta || visit.eta,
        whArrivalTemp: effectiveWh.arrivalTemp ?? visit.arrivalTemp,
        whEtd: visit.etd,
        whDepartureTemp: visit.departureTemp,
        returnWhEta: null,
        returnWhEtd: null,
        poolName: '',
        poolEta: null,
        poolArrivalTemp: null,
        poolEtd: null,
        poolDepartureTemp: null,
        pods: [],
      });
      consumedUntilByKey.set(consumptionKey, visit.etd);
      continue;
    }

    const pods = [];
    let cursor = visit.etd;
    let missingPodId = '';
    for (const podId of route.podSequence || []) {
      const podVisit = visits.find((candidate) => candidate.locationId === podId && candidate.eta >= cursor && candidate.eta <= returnWh.eta);
      if (!podVisit) {
        missingPodId = podId;
        break;
      }
      pods.push(podVisit);
      cursor = podVisit.etd;
    }

    if (missingPodId) {
      rows.push({
        routeId: route.id,
        accountId: route.accountId || 'primary',
        unitId: route.unitId,
        customer: route.customerName || 'Astro',
        serviceDate: ritInfo.serviceDate,
        rit: ritInfo.label,
        ritKey: ritInfo.key,
        status: 'missing_pod',
        reason: 'POD sequence not complete before unit returns to WH.',
        missingPodName: locationMap.get(missingPodId)?.name || missingPodId,
        whName,
        whEta: effectiveWh.eta || visit.eta,
        whArrivalTemp: effectiveWh.arrivalTemp ?? visit.arrivalTemp,
        whEtd: visit.etd,
        whDepartureTemp: visit.departureTemp,
        returnWhEta: returnWh.eta,
        returnWhEtd: returnWh.etd,
        poolName: '',
        poolEta: null,
        poolArrivalTemp: null,
        poolEtd: null,
        poolDepartureTemp: null,
        pods: pods.map((podVisit, index) => ({
          index: index + 1,
          name: podVisit.locationName,
          eta: podVisit.eta,
          arrivalTemp: podVisit.arrivalTemp,
          etd: podVisit.etd,
          departureTemp: podVisit.departureTemp,
        })),
      });
      consumedUntilByKey.set(consumptionKey, returnWh.etd);
      continue;
    }

    const poolVisit = route.poolLocationId
      ? visits.find((candidate) => candidate.locationId === route.poolLocationId && candidate.eta >= visit.etd && candidate.eta <= returnWh.eta)
      : null;

    rows.push({
      routeId: route.id,
      accountId: route.accountId || 'primary',
      unitId: route.unitId,
      customer: route.customerName || 'Astro',
      serviceDate: ritInfo.serviceDate,
      rit: ritInfo.label,
      ritKey: ritInfo.key,
      status: 'complete',
      reason: '',
      whName,
      whEta: effectiveWh.eta || visit.eta,
      whArrivalTemp: effectiveWh.arrivalTemp ?? visit.arrivalTemp,
      whEtd: visit.etd,
      whDepartureTemp: visit.departureTemp,
      returnWhEta: returnWh.eta,
      returnWhEtd: returnWh.etd,
      poolName: poolVisit?.locationName || '',
      poolEta: poolVisit?.eta || null,
      poolArrivalTemp: poolVisit?.arrivalTemp ?? null,
      poolEtd: poolVisit?.etd || null,
      poolDepartureTemp: poolVisit?.departureTemp ?? null,
      pods: pods.map((podVisit, index) => ({
        index: index + 1,
        name: podVisit.locationName,
        eta: podVisit.eta,
        arrivalTemp: podVisit.arrivalTemp,
        etd: podVisit.etd,
        departureTemp: podVisit.departureTemp,
      })),
    });
    consumedUntilByKey.set(consumptionKey, returnWh.etd);
  }

  if (!rows.length && whVisits.length) {
    const firstVisit = whVisits[0];
    rows.push({
      routeId: route.id,
      accountId: route.accountId || 'primary',
      unitId: route.unitId,
      customer: route.customerName || 'Astro',
      serviceDate: formatLocalDay(firstVisit.eta),
      rit: '-',
      ritKey: '',
      status: 'outside_window',
      reason: 'WH departure from radius does not match any configured rit window.',
      whName: locationMap.get(route.whLocationId)?.name || 'WH',
      whEta: firstVisit.eta,
      whArrivalTemp: firstVisit.arrivalTemp,
      whEtd: firstVisit.etd,
      whDepartureTemp: firstVisit.departureTemp,
      returnWhEta: null,
      returnWhEtd: null,
      poolName: '',
      poolEta: null,
      poolArrivalTemp: null,
      poolEtd: null,
      poolDepartureTemp: null,
      pods: [],
    });
  }

  return rows;
}

function buildAstroColumns(rows, options = {}) {
  const globalMaxPods = Number(options.globalMaxPods || 0);
  const maxPods = Math.max(0, globalMaxPods, ...((rows || []).map((row) => Math.max((row.pods || []).length, Number(row.expectedPodCount || 0)))));
  const columns = [
    { key: 'serviceDate', label: 'Service date' },
    { key: 'rit', label: 'Rit' },
    { key: 'accountLabel', label: 'Account' },
    { key: 'customer', label: 'Customer' },
    { key: 'unitId', label: 'Nopol' },
    { key: 'whName', label: 'WH' },
    { key: 'whEta', label: 'WH ETA' },
    { key: 'whArrivalTemp', label: 'WH arrival temp' },
    { key: 'whEtd', label: 'WH ETD' },
    { key: 'whDepartureTemp', label: 'WH departure temp' },
  ];

  for (let index = 0; index < maxPods; index += 1) {
    const order = index + 1;
    columns.push(
      { key: `pod${order}Name`, label: `POD ${order}` },
      { key: `pod${order}Eta`, label: `POD ${order} ETA` },
      { key: `pod${order}ArrivalTemp`, label: `POD ${order} arrival temp` },
      { key: `pod${order}Etd`, label: `POD ${order} ETD` },
      { key: `pod${order}DepartureTemp`, label: `POD ${order} departure temp` },
    );
  }

  columns.push(
    { key: 'poolName', label: 'Pool' },
    { key: 'poolEta', label: 'Pool ETA' },
    { key: 'poolDepartureTemp', label: 'Pool departure temp' },
    { key: 'status', label: 'Status' },
  );

  return { columns, maxPods };
}

function formatExcelDate(dateVal) {
  if (!dateVal) return '';
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return '';
  const parts = formatDateParts(date);
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

function formatStayDuration(dateStart, dateEnd) {
  if (!dateStart || !dateEnd) return '';
  const start = new Date(dateStart);
  const end = new Date(dateEnd);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return '';
  const totalMinutes = Math.round(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function flattenAstroRow(row, options) {
  const maxPods = options && options.maxPods ? options.maxPods : (row.pods || []).length;
  const next = {
    service_date: row.serviceDate,
    rit: row.rit,
    account_id: row.accountId,
    account_label: row.accountLabel || row.accountId,
    customer: row.customer,
    nopol: row.unitLabel || row.unitId,
    wh_name: row.whName,
    wh_eta: formatExcelDate(row.whEta),
    wh_arrival_temp: row.whArrivalTemp ?? '',
    wh_etd: formatExcelDate(row.whEtd),
    wh_departure_temp: row.whDepartureTemp ?? '',
    wh_stay: formatStayDuration(row.whEta, row.whEtd),
    wh_arrival_time_sla: row.kpi?.whArrivalTime?.sla || '',
    wh_arrival_time_kpi: row.kpi?.whArrivalTime?.status || '',
    wh_arrival_temp_min_sla: row.kpi?.whArrivalTemp?.min ?? '',
    wh_arrival_temp_max_sla: row.kpi?.whArrivalTemp?.max ?? '',
    wh_arrival_temp_kpi: row.kpi?.whArrivalTemp?.status || '',
  };
  for (let index = 0; index < maxPods; index += 1) {
    const pod = row.pods[index] || null;
    const podKpi = row.kpi?.podArrivalTimes?.[index] || null;
    const order = index + 1;
    next[`pod${order}_name`] = pod?.name || '';
    next[`pod${order}_eta`] = formatExcelDate(pod?.eta);
    next[`pod${order}_arrival_temp`] = pod?.arrivalTemp ?? '';
    next[`pod${order}_etd`] = formatExcelDate(pod?.etd);
    next[`pod${order}_departure_temp`] = pod?.departureTemp ?? '';
    next[`pod${order}_stay`] = formatStayDuration(pod?.eta, pod?.etd);
    next[`pod${order}_arrival_time_sla`] = podKpi?.sla || '';
    next[`pod${order}_arrival_time_kpi`] = podKpi?.status || '';
  }
  next.pool_name = row.poolName || '';
  next.pool_eta = formatExcelDate(row.poolEta);
  next.pool_departure_temp = row.poolDepartureTemp ?? '';
  next.pool_stay = formatStayDuration(row.poolEta, row.poolEtd);
  next.status = row.status || 'complete';
  next.overall_kpi = row.kpi?.overallStatus || '';
  next.overall_kpi_label = row.kpi?.overallLabel || '';
  return next;
}

module.exports = {
  MIN_VALID_STAY_MS,
  GEOFENCE_MIN_VALID_STAY_MS,
  normalizeAstroLocation,
  normalizeAstroRoute,
  parseAstroLocationCsv,
  parseAstroRouteCsv,
  annotateFleetRowsWithAstro,
  buildGeofenceEvents,
  findCurrentGeofencePresence,
  formatGeofenceStatusLabel,
  findNearestGeofenceMatch,
  locationMatchesScope,
  buildRouteReportRows,
  buildAstroColumns,
  flattenAstroRow,
  buildLocationMap,
};





