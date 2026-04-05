(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SolofleetReportCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeKey(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
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

  function isZeroValue(value) {
    const numeric = toNumber(value);
    return numeric !== null && numeric === 0;
  }

  function parsePossiblyDoubleEncodedJson(text) {
    let current = text.trim();

    for (let index = 0; index < 3; index += 1) {
      if (typeof current !== 'string') {
        return current;
      }
      current = JSON.parse(current);
    }

    return current;
  }

  function extractRecords(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error('Payload is not an array or object.');
    }

    const preferredKeys = ['detail', 'data', 'rows', 'result', 'results', 'items'];
    for (const key of preferredKeys) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
    }

    for (const value of Object.values(payload)) {
      if (Array.isArray(value)) {
        return value;
      }
    }

    throw new Error('Could not find an array of records.');
  }

  function extractContext(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }

    const vehicleInfo = payload.vehicleinfo && typeof payload.vehicleinfo === 'object'
      ? payload.vehicleinfo
      : null;

    return {
      vehicle: vehicleInfo?.vehicleid ?? vehicleInfo?.alias ?? null,
      alias: vehicleInfo?.alias ?? null,
      temp1Serial: vehicleInfo?.temp1serial ?? null,
      temp2Serial: vehicleInfo?.temp2serial ?? null,
    };
  }

  function toTimestamp(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  function median(values) {
    if (!values.length) {
      return null;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  function collectKeyStats(records) {
    const stats = new Map();

    for (const record of records) {
      if (!record || typeof record !== 'object') {
        continue;
      }

      for (const [key, value] of Object.entries(record)) {
        if (!stats.has(key)) {
          stats.set(key, { key, normalized: normalizeKey(key), populated: 0 });
        }
        if (value !== null && value !== undefined && value !== '') {
          stats.get(key).populated += 1;
        }
      }
    }

    return [...stats.values()];
  }

  function chooseField(stats, candidates) {
    const normalizedCandidates = candidates.map(normalizeKey);
    let best = null;

    for (const stat of stats) {
      const candidateIndex = normalizedCandidates.indexOf(stat.normalized);
      if (candidateIndex === -1) {
        continue;
      }

      if (
        !best ||
        candidateIndex < best.candidateIndex ||
        (candidateIndex === best.candidateIndex && stat.populated > best.populated)
      ) {
        best = { key: stat.key, populated: stat.populated, candidateIndex };
      }
    }

    return best ? best.key : null;
  }

  function resolveFields(records) {
    const stats = collectKeyStats(records);
    const fields = {
      time: chooseField(stats, ['gpstime', 'gpsdatetime', 'datetime', 'timestamp', 'time']),
      vehicle: chooseField(stats, ['vehicleid', 'vehicle', 'vehiclename', 'plate', 'alias']),
      speed: chooseField(stats, ['spd', 'speed', 'gpsspeed', 'groundspeed']),
      temp1: chooseField(stats, ['vtemp1', 'virtualtemp1', 'virtualtemperature1', 'temp1']),
      temp2: chooseField(stats, ['vtemp2', 'virtualtemp2', 'virtualtemperature2', 'temp2']),
    };

    if (!fields.time) {
      throw new Error('Could not detect timestamp field.');
    }

    if (!fields.temp1 && !fields.temp2) {
      throw new Error('Could not detect temp fields.');
    }

    return fields;
  }

  function prepareRecords(records, fields, context) {
    const prepared = [];

    for (const record of records) {
      if (!record || typeof record !== 'object') {
        continue;
      }

      const timestamp = toTimestamp(record[fields.time]);
      if (timestamp === null) {
        continue;
      }

      prepared.push({
        timestamp,
        vehicle: (fields.vehicle ? record[fields.vehicle] : null) ?? context.vehicle ?? context.alias ?? 'Unknown Unit',
        speed: fields.speed ? toNumber(record[fields.speed]) : null,
        temp1: fields.temp1 ? record[fields.temp1] : null,
        temp2: fields.temp2 ? record[fields.temp2] : null,
      });
    }

    prepared.sort(function (left, right) {
      return left.timestamp - right.timestamp;
    });

    return prepared;
  }

  function inferMaxGapMs(preparedRecords, explicitGapMinutes) {
    if (explicitGapMinutes !== null && explicitGapMinutes !== undefined && explicitGapMinutes !== '') {
      const numeric = Number(explicitGapMinutes);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric * 60 * 1000;
      }
    }

    const gaps = [];
    for (let index = 1; index < preparedRecords.length; index += 1) {
      const gap = preparedRecords[index].timestamp - preparedRecords[index - 1].timestamp;
      if (gap > 0 && gap <= 60 * 60 * 1000) {
        gaps.push(gap);
      }
    }

    const typicalGap = median(gaps) ?? 2 * 60 * 1000;
    return Math.max(5 * 60 * 1000, typicalGap * 2.5);
  }

  function incidentTypeForRecord(record) {
    const zeroTemp1 = isZeroValue(record.temp1);
    const zeroTemp2 = isZeroValue(record.temp2);

    if (zeroTemp1 && zeroTemp2) {
      return 'temp1+temp2';
    }

    if (zeroTemp1) {
      return 'temp1';
    }

    if (zeroTemp2) {
      return 'temp2';
    }

    return null;
  }

  function labelForType(type) {
    if (type === 'temp1+temp2') {
      return 'Temp1 + Temp2 Error';
    }

    if (type === 'temp1') {
      return 'Temp1 Error';
    }

    if (type === 'temp2') {
      return 'Temp2 Error';
    }

    return type;
  }

  function severityForType(type) {
    return type === 'temp1+temp2' ? 'critical' : 'warning';
  }

  function updateRange(active, record) {
    const temp1 = toNumber(record.temp1);
    const temp2 = toNumber(record.temp2);

    if (temp1 !== null) {
      active.temp1Min = active.temp1Min === null ? temp1 : Math.min(active.temp1Min, temp1);
      active.temp1Max = active.temp1Max === null ? temp1 : Math.max(active.temp1Max, temp1);
    }

    if (temp2 !== null) {
      active.temp2Min = active.temp2Min === null ? temp2 : Math.min(active.temp2Min, temp2);
      active.temp2Max = active.temp2Max === null ? temp2 : Math.max(active.temp2Max, temp2);
    }

    if (record.speed !== null) {
      active.minSpeed = active.minSpeed === null ? record.speed : Math.min(active.minSpeed, record.speed);
      active.maxSpeed = active.maxSpeed === null ? record.speed : Math.max(active.maxSpeed, record.speed);
      if (record.speed > 0) {
        active.movingSamples += 1;
      }
    }
  }

  function finalizeIncident(active, minDurationMs, gapMs) {
    if (!active) {
      return null;
    }

    const durationMs = active.endTimestamp - active.startTimestamp;
    let requiredMinDurationMs = minDurationMs;

    if (active.type === 'temp1' || active.type === 'temp2' || active.type === 'temp1+temp2') {
      requiredMinDurationMs = Math.max(requiredMinDurationMs, 30 * 60 * 1000);
      if (active.sampleCount < 8) {
        return null;
      }
    }

    if (durationMs < requiredMinDurationMs) {
      return null;
    }

    return {
      id: `${active.vehicle}|${active.type}|${active.startTimestamp}|${active.endTimestamp}`,
      vehicle: active.vehicle,
      type: active.type,
      label: labelForType(active.type),
      severity: severityForType(active.type),
      startTimestamp: active.startTimestamp,
      endTimestamp: active.endTimestamp,
      durationMs,
      durationMinutes: Number((durationMs / 60000).toFixed(2)),
      sampleCount: active.sampleCount,
      movingSamples: active.movingSamples,
      minSpeed: active.minSpeed,
      maxSpeed: active.maxSpeed,
      temp1Min: active.temp1Min,
      temp1Max: active.temp1Max,
      temp2Min: active.temp2Min,
      temp2Max: active.temp2Max,
      gapMinutes: Number((gapMs / 60000).toFixed(2)),
    };
  }

  function buildIncidents(preparedRecords, options) {
    const incidents = [];
    const minDurationMs = Number(options.minDurationMinutes ?? 5) * 60 * 1000;
    const gapMs = inferMaxGapMs(preparedRecords, options.maxGapMinutes);
    let active = null;
    let previousTimestamp = null;

    for (const record of preparedRecords) {
      const incidentType = incidentTypeForRecord(record);

      if (active && previousTimestamp !== null && record.timestamp - previousTimestamp > gapMs) {
        const finalized = finalizeIncident(active, minDurationMs, gapMs);
        if (finalized) {
          incidents.push(finalized);
        }
        active = null;
      }

      if (!incidentType) {
        if (active) {
          const finalized = finalizeIncident(active, minDurationMs, gapMs);
          if (finalized) {
            incidents.push(finalized);
          }
          active = null;
        }
        previousTimestamp = record.timestamp;
        continue;
      }

      if (!active || active.type !== incidentType) {
        if (active) {
          const finalized = finalizeIncident(active, minDurationMs, gapMs);
          if (finalized) {
            incidents.push(finalized);
          }
        }

        active = {
          type: incidentType,
          vehicle: record.vehicle,
          startTimestamp: record.timestamp,
          endTimestamp: record.timestamp,
          sampleCount: 1,
          movingSamples: 0,
          minSpeed: null,
          maxSpeed: null,
          temp1Min: null,
          temp1Max: null,
          temp2Min: null,
          temp2Max: null,
        };

        updateRange(active, record);
      } else {
        active.endTimestamp = record.timestamp;
        active.sampleCount += 1;
        updateRange(active, record);
      }

      previousTimestamp = record.timestamp;
    }

    if (active) {
      const finalized = finalizeIncident(active, minDurationMs, gapMs);
      if (finalized) {
        incidents.push(finalized);
      }
    }

    return {
      incidents,
      gapMs,
    };
  }

  function analyzePayload(payload, options) {
    const records = extractRecords(payload);
    const context = extractContext(payload);
    const fields = resolveFields(records);
    const preparedRecords = prepareRecords(records, fields, context);

    if (!preparedRecords.length) {
      throw new Error('No usable records were found after parsing.');
    }

    const built = buildIncidents(preparedRecords, options ?? {});
    return {
      vehicle: context.vehicle ?? context.alias ?? preparedRecords[0].vehicle,
      alias: context.alias ?? context.vehicle ?? preparedRecords[0].vehicle,
      recordsCount: preparedRecords.length,
      fields,
      gapMs: built.gapMs,
      sourceStart: preparedRecords[0].timestamp,
      sourceEnd: preparedRecords[preparedRecords.length - 1].timestamp,
      incidents: built.incidents,
    };
  }

  function parseDateInputStart(value) {
    if (!value) {
      return null;
    }
    return new Date(`${value}T00:00:00`).getTime();
  }

  function parseDateInputEnd(value) {
    if (!value) {
      return null;
    }
    return new Date(`${value}T23:59:59.999`).getTime();
  }

  function clipIncident(incident, rangeStartMs, rangeEndMs) {
    const start = rangeStartMs === null ? incident.startTimestamp : Math.max(incident.startTimestamp, rangeStartMs);
    const end = rangeEndMs === null ? incident.endTimestamp : Math.min(incident.endTimestamp, rangeEndMs);

    if (start > end) {
      return null;
    }

    const durationMs = end - start;
    if (durationMs < 0) {
      return null;
    }

    return {
      ...incident,
      clippedStart: start,
      clippedEnd: end,
      clippedDurationMs: durationMs,
      clippedDurationMinutes: Number((durationMs / 60000).toFixed(2)),
    };
  }

  function toDayKey(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function endOfDay(timestamp) {
    const date = new Date(timestamp);
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  }

  function splitIncidentByDay(incident, rangeStartMs, rangeEndMs) {
    const clipped = clipIncident(incident, rangeStartMs, rangeEndMs);
    if (!clipped) {
      return [];
    }

    const segments = [];
    let currentStart = clipped.clippedStart;

    while (currentStart <= clipped.clippedEnd) {
      const segmentEnd = Math.min(endOfDay(currentStart), clipped.clippedEnd);
      const durationMs = segmentEnd - currentStart;
      segments.push({
        ...clipped,
        day: toDayKey(currentStart),
        segmentStart: currentStart,
        segmentEnd,
        segmentDurationMs: durationMs,
        segmentDurationMinutes: Number((durationMs / 60000).toFixed(2)),
      });
      currentStart = segmentEnd + 1;
    }

    return segments;
  }

  function summarizeIncidents(incidents, rangeStartMs, rangeEndMs) {
    const filtered = incidents
      .map(function (incident) {
        return clipIncident(incident, rangeStartMs, rangeEndMs);
      })
      .filter(Boolean)
      .sort(function (left, right) {
        return left.clippedStart - right.clippedStart;
      });

    const dailyUnits = new Map();
    const dailyTotals = new Map();

    for (const incident of filtered) {
      for (const segment of splitIncidentByDay(incident, rangeStartMs, rangeEndMs)) {
        const unitKey = `${segment.day}|${segment.vehicle}`;
        if (!dailyUnits.has(unitKey)) {
          dailyUnits.set(unitKey, {
            day: segment.day,
            vehicle: segment.vehicle,
            incidents: 0,
            temp1Incidents: 0,
            temp2Incidents: 0,
            bothIncidents: 0,
            totalMinutes: 0,
            longestMinutes: 0,
          });
        }

        const unitRow = dailyUnits.get(unitKey);
        unitRow.incidents += 1;
        unitRow.totalMinutes += segment.segmentDurationMinutes;
        unitRow.longestMinutes = Math.max(unitRow.longestMinutes, segment.segmentDurationMinutes);
        if (segment.type === 'temp1') {
          unitRow.temp1Incidents += 1;
        } else if (segment.type === 'temp2') {
          unitRow.temp2Incidents += 1;
        } else if (segment.type === 'temp1+temp2') {
          unitRow.bothIncidents += 1;
        }

        if (!dailyTotals.has(segment.day)) {
          dailyTotals.set(segment.day, {
            day: segment.day,
            units: new Set(),
            incidents: 0,
            totalMinutes: 0,
            criticalIncidents: 0,
          });
        }

        const totalRow = dailyTotals.get(segment.day);
        totalRow.units.add(segment.vehicle);
        totalRow.incidents += 1;
        totalRow.totalMinutes += segment.segmentDurationMinutes;
        if (segment.type === 'temp1+temp2') {
          totalRow.criticalIncidents += 1;
        }
      }
    }

    return {
      alerts: filtered,
      compileByUnitDay: [...dailyUnits.values()]
        .map(function (row) {
          return {
            ...row,
            totalMinutes: Number(row.totalMinutes.toFixed(2)),
            longestMinutes: Number(row.longestMinutes.toFixed(2)),
          };
        })
        .sort(function (left, right) {
          return right.day.localeCompare(left.day) || left.vehicle.localeCompare(right.vehicle);
        }),
      dailyTotals: [...dailyTotals.values()]
        .map(function (row) {
          return {
            day: row.day,
            units: row.units.size,
            incidents: row.incidents,
            totalMinutes: Number(row.totalMinutes.toFixed(2)),
            criticalIncidents: row.criticalIncidents,
          };
        })
        .sort(function (left, right) {
          return right.day.localeCompare(left.day);
        }),
    };
  }

  return {
    parsePossiblyDoubleEncodedJson,
    analyzePayload,
    summarizeIncidents,
    parseDateInputStart,
    parseDateInputEnd,
    toDayKey,
  };
});
