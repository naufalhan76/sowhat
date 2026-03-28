const fs = require('fs');
const path = require('path');

const DEFAULT_MIN_DURATION_MINUTES = 5;
const DEFAULT_MAX_GAP_MINUTES = null;

function printUsage() {
  console.log(`
Usage:
  node tools/solofleet-temp-report.js --input <file> [options]

Options:
  --input <file>                  Path to the raw JSON response file.
  --csv <file>                    Write findings to CSV.
  --min-duration-minutes <num>    Minimum zero duration to flag. Default: 5
  --max-gap-minutes <num>         Break streaks when the timestamp gap is larger.
  --time-field <name>             Override detected timestamp field.
  --vehicle-field <name>          Override detected vehicle field.
  --speed-field <name>            Override detected speed field.
  --temp1-field <name>            Override detected temp1 / virtual temp1 field.
  --temp2-field <name>            Override detected temp2 / virtual temp2 field.
  --help                          Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    input: null,
    csv: null,
    minDurationMinutes: DEFAULT_MIN_DURATION_MINUTES,
    maxGapMinutes: DEFAULT_MAX_GAP_MINUTES,
    overrides: {},
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    switch (token) {
      case '--help':
        args.help = true;
        break;
      case '--input':
        args.input = next;
        i += 1;
        break;
      case '--csv':
        args.csv = next;
        i += 1;
        break;
      case '--min-duration-minutes':
        args.minDurationMinutes = Number(next);
        i += 1;
        break;
      case '--max-gap-minutes':
        args.maxGapMinutes = Number(next);
        i += 1;
        break;
      case '--time-field':
        args.overrides.time = next;
        i += 1;
        break;
      case '--vehicle-field':
        args.overrides.vehicle = next;
        i += 1;
        break;
      case '--speed-field':
        args.overrides.speed = next;
        i += 1;
        break;
      case '--temp1-field':
        args.overrides.temp1 = next;
        i += 1;
        break;
      case '--temp2-field':
        args.overrides.temp2 = next;
        i += 1;
        break;
      default:
        if (token.startsWith('--')) {
          throw new Error(`Unknown option: ${token}`);
        }
        break;
    }
  }

  return args;
}

function normalizeKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parsePossiblyDoubleEncodedJson(text) {
  let current = text.trim();

  for (let i = 0; i < 3; i += 1) {
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

  throw new Error('Could not find an array of records in the payload.');
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
  };
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value).trim().replace(',', '.');
  if (normalized === '') {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isZeroValue(value) {
  const number = toNumber(value);
  return number !== null && number === 0;
}

function toTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function median(values) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
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

function chooseField(stats, candidates, override) {
  if (override) {
    return override;
  }

  const normalizedCandidates = candidates.map(normalizeKey);
  let best = null;

  for (const stat of stats) {
    const index = normalizedCandidates.indexOf(stat.normalized);
    if (index === -1) {
      continue;
    }

    const score = { candidateIndex: index, populated: stat.populated, key: stat.key };
    if (
      !best ||
      score.candidateIndex < best.candidateIndex ||
      (score.candidateIndex === best.candidateIndex && score.populated > best.populated) ||
      (score.candidateIndex === best.candidateIndex && score.populated === best.populated && score.key < best.key)
    ) {
      best = score;
    }
  }

  return best ? best.key : null;
}

function resolveFields(records, overrides) {
  const stats = collectKeyStats(records);

  const resolved = {
    time: chooseField(
      stats,
      ['gpstime', 'gpsdatetime', 'datetime', 'timestamp', 'time', 'devicetime', 'servertime'],
      overrides.time,
    ),
    vehicle: chooseField(
      stats,
      ['vehicleid', 'vehicle', 'vehiclename', 'plate', 'alias'],
      overrides.vehicle,
    ),
    speed: chooseField(
      stats,
      ['spd', 'speed', 'gpsspeed', 'groundspeed', 'knots'],
      overrides.speed,
    ),
    temp1: chooseField(
      stats,
      ['vtemp1', 'virtualtemp1', 'virtualtemperature1', 'temp1'],
      overrides.temp1,
    ),
    temp2: chooseField(
      stats,
      ['vtemp2', 'virtualtemp2', 'virtualtemperature2', 'temp2'],
      overrides.temp2,
    ),
  };

  if (!resolved.time) {
    throw new Error('Could not detect a timestamp field. Use --time-field to set it manually.');
  }

  if (!resolved.temp1 && !resolved.temp2) {
    const available = stats.map((item) => item.key).sort().join(', ');
    throw new Error(`Could not detect temp fields. Available keys: ${available}`);
  }

  return resolved;
}

function prepareRecords(records, fields, context = {}) {
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
      raw: record,
      timestamp,
      vehicle: (fields.vehicle ? record[fields.vehicle] : null) ?? context.vehicle ?? context.alias ?? null,
      speed: fields.speed ? toNumber(record[fields.speed]) : null,
      temp1: fields.temp1 ? record[fields.temp1] : null,
      temp2: fields.temp2 ? record[fields.temp2] : null,
    });
  }

  prepared.sort((a, b) => a.timestamp - b.timestamp);
  return prepared;
}

function inferMaxGapMs(preparedRecords, explicitMaxGapMinutes) {
  if (explicitMaxGapMinutes !== null && explicitMaxGapMinutes !== undefined && Number.isFinite(explicitMaxGapMinutes)) {
    return explicitMaxGapMinutes * 60 * 1000;
  }

  const gaps = [];
  for (let i = 1; i < preparedRecords.length; i += 1) {
    const gap = preparedRecords[i].timestamp - preparedRecords[i - 1].timestamp;
    if (gap > 0 && gap <= 60 * 60 * 1000) {
      gaps.push(gap);
    }
  }

  const typicalGap = median(gaps) ?? 2 * 60 * 1000;
  return Math.max(5 * 60 * 1000, typicalGap * 2.5);
}

function finalizeIncident(active, sensorLabel, sensorField, partnerLabel, minimumDurationMs) {
  if (!active) {
    return null;
  }

  const durationMs = active.lastTimestamp - active.startTimestamp;
  if (durationMs < minimumDurationMs) {
    return null;
  }

  return {
    sensor: sensorLabel,
    sensorField,
    vehicle: active.vehicle ?? '',
    startTime: new Date(active.startTimestamp).toISOString(),
    endTime: new Date(active.lastTimestamp).toISOString(),
    durationMinutes: Number((durationMs / 60000).toFixed(2)),
    sampleCount: active.sampleCount,
    movingSamples: active.movingSamples,
    minSpeed: active.minSpeed ?? '',
    maxSpeed: active.maxSpeed ?? '',
    partnerSensor: partnerLabel,
    partnerMin: active.partnerMin ?? '',
    partnerMax: active.partnerMax ?? '',
    diffMin: active.diffMin ?? '',
    diffMax: active.diffMax ?? '',
  };
}

function analyzeSensor(preparedRecords, tempProperty, partnerProperty, sensorLabel, sensorField, partnerLabel, minimumDurationMs, maxGapMs) {
  const findings = [];
  let active = null;
  let previousTimestamp = null;

  for (const record of preparedRecords) {
    const currentValue = record[tempProperty];
    const partnerValue = toNumber(record[partnerProperty]);
    const zero = isZeroValue(currentValue);

    if (active && previousTimestamp !== null && record.timestamp - previousTimestamp > maxGapMs) {
      const finding = finalizeIncident(active, sensorLabel, sensorField, partnerLabel, minimumDurationMs);
      if (finding) {
        findings.push(finding);
      }
      active = null;
    }

    if (zero) {
      if (!active) {
        active = {
          vehicle: record.vehicle,
          startTimestamp: record.timestamp,
          lastTimestamp: record.timestamp,
          sampleCount: 1,
          movingSamples: record.speed > 0 ? 1 : 0,
          minSpeed: record.speed,
          maxSpeed: record.speed,
          partnerMin: partnerValue,
          partnerMax: partnerValue,
          diffMin: partnerValue === null ? null : Math.abs(partnerValue),
          diffMax: partnerValue === null ? null : Math.abs(partnerValue),
        };
      } else {
        active.lastTimestamp = record.timestamp;
        active.sampleCount += 1;
        if (partnerValue !== null) {
          active.partnerMin = active.partnerMin === null ? partnerValue : Math.min(active.partnerMin, partnerValue);
          active.partnerMax = active.partnerMax === null ? partnerValue : Math.max(active.partnerMax, partnerValue);
          const diff = Math.abs(partnerValue);
          active.diffMin = active.diffMin === null ? diff : Math.min(active.diffMin, diff);
          active.diffMax = active.diffMax === null ? diff : Math.max(active.diffMax, diff);
        }

        if (record.speed !== null) {
          active.minSpeed = active.minSpeed === null ? record.speed : Math.min(active.minSpeed, record.speed);
          active.maxSpeed = active.maxSpeed === null ? record.speed : Math.max(active.maxSpeed, record.speed);
          if (record.speed > 0) {
            active.movingSamples += 1;
          }
        }
      }
    } else if (active) {
      const finding = finalizeIncident(active, sensorLabel, sensorField, partnerLabel, minimumDurationMs);
      if (finding) {
        findings.push(finding);
      }
      active = null;
    }

    previousTimestamp = record.timestamp;
  }

  const finding = finalizeIncident(active, sensorLabel, sensorField, partnerLabel, minimumDurationMs);
  if (finding) {
    findings.push(finding);
  }

  return findings;
}

function toCsv(rows) {
  const headers = [
    'sensor',
    'sensorField',
    'vehicle',
    'startTime',
    'endTime',
    'durationMinutes',
    'sampleCount',
    'movingSamples',
    'minSpeed',
    'maxSpeed',
    'partnerSensor',
    'partnerMin',
    'partnerMax',
    'diffMin',
    'diffMax',
  ];

  const escape = (value) => {
    const text = String(value ?? '');
    if (text.includes('"') || text.includes(',') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.input) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  if (!Number.isFinite(args.minDurationMinutes) || args.minDurationMinutes <= 0) {
    throw new Error('--min-duration-minutes must be a positive number.');
  }

  if (
    args.maxGapMinutes !== null &&
    args.maxGapMinutes !== undefined &&
    (!Number.isFinite(args.maxGapMinutes) || args.maxGapMinutes <= 0)
  ) {
    throw new Error('--max-gap-minutes must be a positive number.');
  }

  const absoluteInputPath = path.resolve(args.input);
  const rawText = fs.readFileSync(absoluteInputPath, 'utf8');
  const payload = parsePossiblyDoubleEncodedJson(rawText);
  const records = extractRecords(payload);
  const context = extractContext(payload);
  const fields = resolveFields(records, args.overrides);
  const preparedRecords = prepareRecords(records, fields, context);

  if (!preparedRecords.length) {
    throw new Error('No usable records were found after timestamp parsing.');
  }

  const minimumDurationMs = args.minDurationMinutes * 60 * 1000;
  const maxGapMs = inferMaxGapMs(preparedRecords, args.maxGapMinutes);

  const findings = [
    ...(fields.temp1
      ? analyzeSensor(preparedRecords, 'temp1', 'temp2', 'temp1', fields.temp1, fields.temp2 ?? '-', minimumDurationMs, maxGapMs)
      : []),
    ...(fields.temp2
      ? analyzeSensor(preparedRecords, 'temp2', 'temp1', 'temp2', fields.temp2, fields.temp1 ?? '-', minimumDurationMs, maxGapMs)
      : []),
  ].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

  console.log(`Input: ${absoluteInputPath}`);
  console.log(`Records analyzed: ${preparedRecords.length}`);
  console.log(
    `Resolved fields: time=${fields.time}, vehicle=${fields.vehicle ?? '-'}, speed=${fields.speed ?? '-'}, temp1=${fields.temp1 ?? '-'}, temp2=${fields.temp2 ?? '-'}`,
  );
  console.log(`Zero threshold: ${args.minDurationMinutes} minute(s)`);
  console.log(`Gap breaker: ${(maxGapMs / 60000).toFixed(2)} minute(s)`);

  if (!findings.length) {
    console.log('Findings: 0 incident(s)');
  } else {
    console.log(`Findings: ${findings.length} incident(s)`);
    console.table(findings);
  }

  if (args.csv) {
    const absoluteCsvPath = path.resolve(args.csv);
    fs.writeFileSync(absoluteCsvPath, toCsv(findings), 'utf8');
    console.log(`CSV written: ${absoluteCsvPath}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}







