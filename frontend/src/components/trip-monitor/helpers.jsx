/**
 * Trip Monitor shared helpers, constants, and formatters.
 * Extracted from App.jsx to avoid circular imports between trip-monitor sub-components.
 */

import {
  AlertTriangle, Clock3, MapPinOff, PackageSearch, Route, ShieldAlert, Thermometer,
  Truck, Navigation, Flag, Box,
} from 'lucide-react';

// ── Constants ──────────────────────────────────────────────────────────────────

export const TMS_INCIDENT_META = {
  'gps-error': { label: 'GPS error', tone: 'danger' },
  'temp-error': { label: 'Temp error', tone: 'danger' },
  'temp-out-of-range': { label: 'Temp out of range', tone: 'danger' },
  'late-origin': { label: 'Late load', tone: 'warning' },
  'late-destination': { label: 'Late destination', tone: 'warning' },
  'geofence-origin': { label: 'Miss load geofence', tone: 'info' },
  'geofence-destination': { label: 'Miss destination geofence', tone: 'info' },
  'long-stop': { label: 'Long stop', tone: 'warning' },
};

export const TMS_BOARD_COLUMNS = [
  { key: 'critical', label: 'Critical' },
  { key: 'warning', label: 'Warning' },
  { key: 'normal', label: 'Normal' },
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'no-job-order', label: 'No JO' },
];

export const TMS_INCIDENT_LEGEND_CODES = [
  'gps-error', 'temp-error', 'temp-out-of-range',
  'late-origin', 'late-destination', 'long-stop',
  'geofence-origin', 'geofence-destination',
];

export const SHIPPING_STEP_ICONS = {
  'otw-load': Truck,
  'sampai-load': PackageSearch,
  'menuju-unload': Navigation,
  'sampai-unload': Flag,
  'selesai': Box,
};

export const TMS_SEVERITY_META = {
  critical: { label: 'Critical', tone: 'danger' },
  warning: { label: 'Warning', tone: 'warning' },
  normal: { label: 'Normal', tone: 'success' },
  unmatched: { label: 'Unmatched', tone: 'info' },
  'no-job-order': { label: 'No JO', tone: 'default' },
};

export const TMS_SHIPPING_STATUS_META = {
  'otw-load': { label: 'OTW LOAD' },
  'sampai-load': { label: 'SAMPAI LOAD' },
  'menuju-unload': { label: 'MENUJU UNLOAD' },
  'sampai-unload': { label: 'SAMPAI UNLOAD' },
  selesai: { label: 'SELESAI' },
};

export const KANBAN_COLUMNS = [
  { key: 'critical', label: 'Critical', match: (severity) => severity === 'critical' },
  { key: 'warning', label: 'Warning', match: (severity) => severity === 'warning' },
  { key: 'normal', label: 'Normal', match: (severity) => severity === 'normal' || severity === 'unmatched' || severity === 'no-job-order' || !severity },
];

// ── Label helpers ──────────────────────────────────────────────────────────────

export function tmsIncidentLabel(value) {
  return TMS_INCIDENT_META[String(value || '').toLowerCase()]?.label || value || '-';
}

export function tmsSeverityLabel(value) {
  return TMS_SEVERITY_META[String(value || '').toLowerCase()]?.label || 'Normal';
}

export function tmsSeverityTone(value) {
  return TMS_SEVERITY_META[String(value || '').toLowerCase()]?.tone || 'default';
}

export function tmsShippingStatusLabel(value) {
  return TMS_SHIPPING_STATUS_META[String(value || '').toLowerCase()]?.label || value || '-';
}

export function dedupeTripMonitorIncidentCodes(codes) {
  return [...new Set((codes || []).map((code) => String(code || '').trim()).filter(Boolean))];
}

export function tripMonitorIncidentHistoryStatusLabel(value) {
  return String(value || '').toLowerCase() === 'resolved' ? 'Resolved' : 'Active';
}

export function tripMonitorIncidentHistoryStatusTone(value) {
  return String(value || '').toLowerCase() === 'resolved' ? 'success' : 'warning';
}

export function buildTripMonitorIncidentHistoryLocationLabel(item) {
  const first = String(item?.firstLocationSummary || '').trim();
  const last = String(item?.lastLocationSummary || '').trim();
  const resolved = String(item?.resolvedLocationSummary || '').trim();
  if (String(item?.status || '').toLowerCase() === 'resolved') {
    const primary = first || last || resolved || '-';
    const secondary = resolved ? `Resolved: ${resolved}` : (last ? `Last: ${last}` : '');
    return secondary && secondary !== primary ? `${primary} · ${secondary}` : primary;
  }
  const primary = first || last || '-';
  const secondary = last ? `Last: ${last}` : '';
  return secondary && secondary !== primary ? `${primary} · ${secondary}` : primary;
}

export function buildTripMonitorIncidentHistoryDescription(item) {
  const primary = String(
    (String(item?.status || '').toLowerCase() === 'resolved'
      ? (item?.detailClose || item?.detailOpen)
      : item?.detailOpen) || '-',
  ).trim() || '-';
  const secondary = String(item?.detailOpen || '').trim();
  if (String(item?.status || '').toLowerCase() === 'resolved' && secondary && secondary !== primary) {
    return `${primary} · Opened: ${secondary}`;
  }
  return primary;
}

export function formatTripMonitorStatusTime(value) {
  if (!value) return '-';
  try {
    const d = new Date(value);
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(/\./g, ':');
  } catch {
    return '--:--';
  }
}

export function normalizeTemperatureRange(minValue, maxValue) {
  const numericValues = [minValue, maxValue]
    .map((value) => value === null || value === undefined || value === '' ? null : Number(value))
    .filter((value) => Number.isFinite(value));
  if (!numericValues.length) return { min: null, max: null };
  return { min: Math.min(...numericValues), max: Math.max(...numericValues) };
}

export function pickFirstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

export function normalizeTmsDriverAssign(driverAssign) {
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
    value.driver_name, value.driverName, value.employee_name, value.employeeName,
    value.full_name, value.fullName, value.user_full_name, value.userFullName,
    value.driver_label, value.driverLabel, value.employee_label, value.employeeLabel,
    value.employee_full_name, value.employeeFullName,
    value.nama, value.nama_driver, value.driver, value.employee, value.name, value.label, value.title,
  ];
  const idCandidates = [
    value.driver_id, value.driverId, value.employee_id, value.employeeId,
    value.crew_id, value.crewId, value.user_id, value.userId, value.name,
  ];
  nameCandidates.forEach((candidate) => { const text = String(candidate || '').trim(); if (text) bucket.names.push(text); });
  idCandidates.forEach((candidate) => { const text = String(candidate || '').trim(); if (text) bucket.ids.push(text); });
  Object.entries(value).forEach(([key, nested]) => {
    if (nested === null || nested === undefined) return;
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (['idx', 'index', 'doctype', 'owner', 'modified_by', 'creation', 'modified', 'parent', 'parentfield', 'parenttype', 'assignment_status', 'driver_status', 'job_offer_status', 'status'].includes(normalizedKey)) return;
    if (typeof nested === 'object') collectNestedDriverTexts(nested, bucket, visited, depth + 1);
  });
}

export function extractTmsDriverName(driver) {
  if (!driver) return '-';
  if (typeof driver === 'string') return driver.trim() || '-';
  const bucket = { names: [], ids: [] };
  collectNestedDriverTexts(driver, bucket, new Set());
  return pickFirstText(...bucket.names, ...bucket.ids) || '-';
}

export function extractTmsDriverPhone(driver) {
  if (!driver || typeof driver !== 'object') return null;
  // Try common phone field names from TMS/Frappe
  const phoneCandidates = [
    driver.contact_no, driver.contactNo,
    driver.cell_phone_number, driver.cellPhoneNumber,
    driver.no_hp, driver.noHp,
    driver.phone, driver.mobile, driver.mobile_no, driver.mobileNo,
    driver.contact_phone, driver.contactPhone,
    driver.hp, driver.telepon, driver.no_telepon,
  ];
  for (const candidate of phoneCandidates) {
    const text = String(candidate || '').trim();
    if (text && /^\+?\d[\d\s\-]{6,}$/.test(text)) return text.replace(/[\s\-]/g, '');
  }
  return null;
}

export function formatTripMonitorRangeLabel(range) {
  if (!range?.startDate || !range?.endDate) return '-';
  return `${range.startDate} to ${range.endDate}`;
}

export function tripMonitorStopKey(stop, fallbackIndex) {
  if (!stop) return null;
  const idx = Number(stop.idx);
  const taskType = String(stop.taskType || stop.type || stop.task_type || '').trim().toLowerCase();
  if (Number.isFinite(idx) && idx > 0) return `${taskType || 'stop'}:${idx}`;
  const lat = Number(stop.latitude);
  const lng = Number(stop.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${taskType || 'stop'}:${lat.toFixed(5)}:${lng.toFixed(5)}`;
  return `${taskType || 'stop'}:fallback:${fallbackIndex ?? 0}`;
}

// ── Icon resolver ──────────────────────────────────────────────────────────────

export function tmsIncidentIcon(code, size = 13) {
  switch (code) {
    case 'gps-error': return <Route size={size} />;
    case 'temp-error': return <ShieldAlert size={size} />;
    case 'temp-out-of-range': return <Thermometer size={size} />;
    case 'long-stop': return <Clock3 size={size} />;
    case 'late-origin':
    case 'late-destination': return <AlertTriangle size={size} />;
    case 'geofence-origin':
    case 'geofence-destination': return <MapPinOff size={size} />;
    default: return <PackageSearch size={size} />;
  }
}
