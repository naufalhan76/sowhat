
import React, { startTransition, useEffect, useMemo, useState, useDeferredValue } from 'react';
import { Button, Card, CardContent, CardHeader, Chip, Link, Spinner } from '@heroui/react';
import logoUrl from './assets/sowhat-logo.svg';

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

const today = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

const api = async (url, options = {}) => {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const payload = await response.json().catch(() => ({ ok: false, error: 'Invalid server response.' }));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
};
const fmtDate = (value) => value ? new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '-';
const fmtNum = (value, digits = 1) => value === null || value === undefined || value === '' ? '-' : Number(value).toFixed(digits);
const fmtCoord = (value) => value === null || value === undefined || value === '' ? '-' : Number(value).toFixed(6);
const fmtClock = (value) => value ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '-';
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
  const [loaded, setLoaded] = useState(false);
  const [activePanel, setActivePanel] = useState('overview');
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [selectedUnitAccountId, setSelectedUnitAccountId] = useState('primary');
  const [activeAccountId, setActiveAccountId] = useState('primary');
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const [range, setRange] = useState({ startDate: today(-6), endDate: today(0) });
  const [stopForm, setStopForm] = useState({ accountId: 'primary', unitId: '', reportType: '3', minDuration: '0' });
  const [loginForm, setLoginForm] = useState({ email: '', password: '', rememberMe: true, label: '' });
  const [showLoginScreen, setShowLoginScreen] = useState(true);
  const fleetRows = status?.fleet?.rows || [];
  const availableAccounts = status?.config?.accounts || [];
  
  const connectedAccounts = useMemo(() => availableAccounts.filter((account) => account.hasSessionCookie), [availableAccounts]);
  const currentAccount = useMemo(() => availableAccounts.find((account) => account.id === activeAccountId) || availableAccounts[0] || null, [availableAccounts, activeAccountId]);
  const prioritizedFleet = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    let filtered = fleetRows;
    if (quickFilter === 'temp-error') filtered = filtered.filter((row) => rowHasSensorError(row));
    if (quickFilter === 'setpoint') filtered = filtered.filter((row) => rowHasSetpointIssue(row));
    if (quickFilter === 'gps-late') filtered = filtered.filter((row) => rowHasGpsLate(row));
    if (q) {
      filtered = filtered.filter((row) => [row.accountLabel, row.id, row.label, row.alias, row.group, row.locationSummary, row.zoneName, row.customerName, row.setpointLabel, row.errSensor, row.errGps].some((value) => String(value || '').toLowerCase().includes(q)));
    }
    return sortFleetRows(filtered);
  }, [deferredSearch, fleetRows, quickFilter]);
  const selectedFleetRow = useMemo(() => fleetRows.find((row) => row.id === selectedUnitId && row.accountId === selectedUnitAccountId) || prioritizedFleet[0] || fleetRows[0] || null, [fleetRows, prioritizedFleet, selectedUnitId, selectedUnitAccountId]);
  const errorRows = useMemo(() => [...(report?.dailySnapshots || [])].sort((left, right) => (right.errorTimestamp || 0) - (left.errorTimestamp || 0)), [report]);
  const podRows = useMemo(() => [...(report?.podSnapshots || [])].sort((left, right) => (right.timestamp || 0) - (left.timestamp || 0)), [report]);
  const errorOverview = useMemo(() => buildErrorOverview(errorRows), [errorRows]);
  const errorUnitsSummary = useMemo(() => [...(report?.compileByUnitDay || [])].sort((left, right) => (right.incidents || 0) - (left.incidents || 0)), [report]);
  const autoFilterCards = status?.autoFilterCards || [];
  
  const isAuthenticated = connectedAccounts.length > 0;

  useEffect(() => {
    loadDashboard(true, true).catch((error) => setBanner({ tone: 'error', message: error.message }));
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
    if (!selectedFleetRow) return;
    if (!['fleet', 'temp-errors', 'historical'].includes(activePanel)) return;
    loadUnitDetail(selectedFleetRow.accountId || 'primary', selectedFleetRow.id, true).catch(() => {});
  }, [activePanel, selectedFleetRow?.id, range.startDate, range.endDate]);
  const loadDashboard = async (syncConfig = false, quiet = false) => {
    if (!quiet) setBusy(true);
    const query = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
    const [nextStatus, nextReport] = await Promise.all([api('/api/status'), api(`/api/report?${query.toString()}`)]);
    startTransition(() => {
      const nextActiveAccountId = nextStatus.config?.activeAccountId || 'primary';
      setStatus(nextStatus);
      setReport(nextReport);
      setApiMonitor(nextMonitor);
      if (syncConfig || !loaded) {
        setActiveAccountId(nextActiveAccountId);
        setForm(formFromConfig(nextStatus.config, nextActiveAccountId));
        setLoaded(true);
      }
      if ((nextStatus.config?.accounts || []).some((account) => account.hasSessionCookie)) {
        setShowLoginScreen(false);
      }
      if (!stopForm.unitId && nextStatus.fleet?.rows?.length) {
        setStopForm((current) => ({ ...current, accountId: nextStatus.fleet.rows[0].accountId || 'primary', unitId: nextStatus.fleet.rows[0].id }));
      }
      if (!quiet) setBanner({ tone: 'success', message: 'Dashboard refreshed.' });
    });
    if (!quiet) setBusy(false);
  };

  const loadUnitDetail = async (accountId, unitId, quiet = false) => {
    if (!unitId) return;
    if (!quiet) setDetailBusy(true);
    try {
      const query = new URLSearchParams({ accountId: accountId || 'primary', unitId, startDate: range.startDate, endDate: range.endDate });
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
    setBusy(true);
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
      setBusy(false);
    }
  };
  const loginWithSolofleet = async (mode = 'primary') => {
    setBusy(true);
    try {
      const accountId = mode === 'linked' ? makeAccountId(loginForm.label || loginForm.email) : 'primary';
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ ...loginForm, accountId, label: loginForm.label || loginForm.email }),
      });
      startTransition(() => {
        const nextActive = mode === 'linked' ? accountId : 'primary';
        setActiveAccountId(nextActive);
        setForm(formFromConfig(result.config, nextActive));
        setLoginForm((current) => ({ ...current, password: '' }));
        setBanner({ tone: 'success', message: mode === 'linked' ? 'Linked account added.' : 'Logged in to Solofleet.' });
        setShowLoginScreen(false);
        setAuthModal({ open: false, message: '' });
      });
      await loadDashboard(true, true);
    } catch (error) {
      setAuthModal({ open: true, message: error.message || 'Solofleet login failed. Check email/password.' });
      setBanner({ tone: 'error', message: error.message || 'Login failed.' });
    } finally {
      setBusy(false);
    }
  };

  const logoutAccount = async (accountId = activeAccountId) => {
    setBusy(true);
    try {
      const result = await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ accountId }) });
      startTransition(() => {
        const nextActive = result.config.activeAccountId || 'primary';
        const stillConnected = (result.config.accounts || []).some((account) => account.hasSessionCookie);
        setActiveAccountId(nextActive);
        setForm(formFromConfig(result.config, nextActive));
        setUnitDetail(null);
        setReport(null);
        setStopReport(null);
        setBanner({ tone: 'success', message: accountId === 'primary' ? 'Primary account logged out.' : 'Linked account removed.' });
        setShowLoginScreen(!stillConnected);
      });
      await loadDashboard(true, true).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const logoutFromLocal = async () => logoutAccount(activeAccountId);
  const discoverUnits = async () => {
    await saveConfig(true);
    setBusy(true);
    try {
      const result = await api('/api/discover/units', { method: 'POST', body: JSON.stringify({ accountId: activeAccountId }) });
      startTransition(() => {
        setForm(formFromConfig(result.config, activeAccountId));
        setBanner({ tone: 'success', message: `Discovered ${result.units.length} units from Solofleet.` });
      });
      await loadDashboard(false, true);
    } finally {
      setBusy(false);
    }
  };

  const runPollNow = async () => {
    setBusy(true);
    try {
      await api('/api/poll/run', { method: 'POST', body: JSON.stringify({}) });
      await loadDashboard(false, true);
      setBanner({ tone: 'success', message: 'Manual polling finished.' });
    } finally {
      setBusy(false);
    }
  };

  const togglePolling = async () => {
    if (!status?.runtime) return;
    setBusy(true);
    try {
      await api(status.runtime.isPolling ? '/api/poll/stop' : '/api/poll/start', { method: 'POST', body: JSON.stringify({}) });
      await loadDashboard(false, true);
      setBanner({ tone: 'success', message: status.runtime.isPolling ? 'Auto polling stopped.' : 'Auto polling started.' });
    } finally {
      setBusy(false);
    }
  };

  const loadStopReport = async () => {
    if (!stopForm.unitId) return;
    setBusy(true);
    try {
      const query = new URLSearchParams({ accountId: stopForm.accountId || 'primary', unitId: stopForm.unitId, startDate: range.startDate, endDate: range.endDate, reportType: stopForm.reportType, minDuration: stopForm.minDuration, withTrack: 'withtrack' });
      const payload = await api(`/api/report/stop?${query.toString()}`);
      setStopReport(payload);
      setBanner({ tone: 'success', message: `Loaded ${payload.rows.length} stop/idle rows.` });
    } finally {
      setBusy(false);
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
  const exportFleet = () => csv('solofleet-fleet-live.csv', prioritizedFleet.map((row) => ({ account_id: row.accountId, account_label: row.accountLabel, unit_id: row.id, label: row.label, alias: row.alias, group_name: row.group, speed: row.speed, live_temp1: row.liveTemp1, live_temp2: row.liveTemp2, temp_gap: row.liveTempDelta, sensor_error: row.errSensor, gps_error: row.errGps, location: row.locationSummary, zone_name: row.zoneName, latitude: row.latitude, longitude: row.longitude, last_updated_at: row.lastUpdatedAt })));
  const exportAlerts = () => csv('solofleet-temp-alerts.csv', errorRows.map((row) => ({ account_id: row.accountId, account_label: row.accountLabel, error_date: row.day, error_time: row.errorTime, unit_id: row.unitId, unit_label: row.unitLabel, type: row.label, temp1: row.temp1, temp2: row.temp2, speed: row.speed, latitude: row.latitude, longitude: row.longitude, location: row.locationSummary })));
  const exportStop = () => csv('solofleet-stop-idle.csv', (stopReport?.rows || []).map((row) => ({ account_id: stopForm.accountId, account_label: accountName(availableAccounts.find((account) => account.id === stopForm.accountId)), unit_id: row.unitId, alias: row.alias, start_time: row.startTimestamp ? new Date(row.startTimestamp).toISOString() : '', end_time: row.endTimestamp ? new Date(row.endTimestamp).toISOString() : '', duration_minutes: row.durationMinutes, movement_distance_km: row.movementDistance, avg_temp: row.avgTemp, location: row.locationSummary, latitude: row.latitude, longitude: row.longitude, zone_name: row.zoneName, google_maps_url: row.googleMapsUrl })));
  const exportHistory = () => csv('solofleet-history.csv', (unitDetail?.records || []).map((row) => ({ account_id: selectedFleetRow?.accountId || selectedUnitAccountId, account_label: selectedFleetRow?.accountLabel || accountName(currentAccount), unit_id: selectedFleetRow?.id || selectedUnitId, timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : '', speed: row.speed, temp1: row.temp1, temp2: row.temp2 })));
  const exportPods = () => csv('solofleet-pod-snapshots.csv', podRows.map((row) => ({ account_id: row.accountId, account_label: row.accountLabel, day: row.day, time: row.time, unit_id: row.unitId, unit_label: row.unitLabel, customer_name: row.customerName, pod_name: row.podName, distance_meters: row.distanceMeters, speed: row.speed, latitude: row.latitude, longitude: row.longitude, location: row.locationSummary })));

  if (loaded && (showLoginScreen || !isAuthenticated)) {
    return <div className="login-shell">
      <div className="login-backdrop" />
      <Card className="login-card">
        <CardHeader className="panel-card-header">
          <div>
            <div className="brand-lockup brand-lockup-login">
              <img src={logoUrl} alt="SoWhat?" className="brand-logo" />
              <div>
                <p className="eyebrow local-eyebrow">SoWhat?</p>
                <h2>Login with your Solofleet account</h2>
                <p>Fleet intelligence yang lebih rapi, lebih tajam, dan nggak bikin operasional tenggelam di noise.</p>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="settings-stack">
            {banner.message ? <div className={`banner banner-${banner.tone}`}><span>{banner.message}</span>{busy ? <Spinner size="sm" /> : null}</div> : null}
            <label className="field"><span>Email</span><input type="email" value={loginForm.email} onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))} placeholder="nama@company.com" /></label>
            <label className="field"><span>Password</span><input type="password" value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password Solofleet" /></label>
            <label className="field checkbox-field"><input type="checkbox" checked={loginForm.rememberMe} onChange={(event) => setLoginForm((current) => ({ ...current, rememberMe: event.target.checked }))} /><span>Remember me</span></label>
            <div className="inline-buttons">
              <Button color="primary" onPress={() => loginWithSolofleet('primary')}>Login</Button>
              {isAuthenticated ? <Button variant="bordered" onPress={() => setShowLoginScreen(false)}>Continue existing session</Button> : null}
            </div>
          </div>
        </CardContent>
      </Card>
      {authModal.open ? <div className="auth-modal-backdrop">
        <Card className="auth-modal-card">
          <CardHeader className="panel-card-header">
            <div>
              <p className="eyebrow local-eyebrow">Login Error</p>
              <h2>Sign in gagal</h2>
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
    <div className="app-shell">
      <header className="hero-strip">
        <div>
          <div className="brand-lockup">
            <img src={logoUrl} alt="SoWhat?" className="brand-logo" />
            <div>
              <p className="eyebrow">SoWhat?</p>
              <h1>Fleet Intelligence, Minus the Noise.</h1>
              <p className="hero-copy">Dashboard operasional premium untuk monitor suhu, lokasi, stop-idle, dan anomaly lintas akun Solofleet tanpa ribet pindah session.</p>
            </div>
          </div>
        </div>
        <div className="hero-actions">
          <Button color="primary" onPress={() => loadDashboard(false, false)}>Refresh report</Button>
          <Button variant="bordered" onPress={runPollNow}>Poll now</Button>
          <Button variant="bordered" onPress={togglePolling}>{status?.runtime?.isPolling ? 'Stop auto polling' : 'Start auto polling'}</Button>
        </div>
      </header>

      {banner.message ? <div className={`banner banner-${banner.tone}`}><span>{banner.message}</span>{busy ? <Spinner size="sm" /> : null}</div> : null}

      <section className="top-controls">
        <label className="control-group"><span>Report start</span><input type="date" value={range.startDate} onChange={(event) => setRange((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label className="control-group"><span>Report end</span><input type="date" value={range.endDate} onChange={(event) => setRange((current) => ({ ...current, endDate: event.target.value }))} /></label>
        <label className="control-group grow"><span>Fleet search</span><input type="text" placeholder="Cari account, unit, alias, group, lokasi, error" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className="control-inline-actions"><Button variant="bordered" onPress={exportFleet}>Export live CSV</Button><Button variant="bordered" onPress={exportAlerts}>Export alerts CSV</Button></div>
      </section>
      <section className="ops-card-grid">
        <button type="button" className={quickFilter === 'all' ? 'filter-card filter-card-active' : 'filter-card'} onClick={() => setQuickFilter('all')}><span>All fleet</span><strong>All</strong><small>Tampilkan semua unit setelah search dan sorting prioritas.</small></button>
        {autoFilterCards.map((card) => <button type="button" key={card.id} className={quickFilter === card.id ? 'filter-card filter-card-active' : 'filter-card'} onClick={() => setQuickFilter(card.id)}><span>{card.label}</span><strong>{card.count}</strong><small>{card.description}</small></button>)}
      </section>

      <section className="metric-grid">
        {[
          ['Monitored units', status?.overview?.monitoredUnits, 'Unit aktif di config'],
          ['Live temp alerts', status?.overview?.liveAlerts, 'Alert yang masih dianggap current'],
          ['Critical alerts', status?.overview?.criticalAlerts, 'Temp1 + Temp2 sama-sama error'],
          ['Moving units', status?.overview?.movingUnits, 'Speed lebih dari 0 di snapshot live'],
          ['Stale feeds', status?.overview?.staleUnits, 'Update terakhir lebih dari 15 menit'],
          ['Location ready', status?.overview?.locationReadyUnits, 'Sudah punya lat/lng untuk export'],
        ].map(([label, value, note]) => <Card key={label} className="metric-card"><CardContent><p className="metric-label">{label}</p><div className="metric-value">{value ?? '-'}</div><p className="metric-note">{note}</p></CardContent></Card>)}
      </section>

      <section className={sidebarCollapsed ? "main-grid main-grid-collapsed" : "main-grid"}>
        <div className="main-column">
          <nav className="panel-nav">
            {['overview', 'fleet', 'historical', 'temp-errors', 'pod', 'stop', 'api-monitor', 'config'].map((name) => <button type="button" key={name} className={activePanel === name ? 'panel-button panel-button-active' : 'panel-button'} onClick={() => setActivePanel(name)}>{name === 'fleet' ? 'fleet live' : name === 'stop' ? 'stop/idle explorer' : name === 'temp-errors' ? 'temp errors' : name === 'api-monitor' ? 'api monitor' : name}</button>)}
          </nav>

          {activePanel === 'overview' ? <>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Live temperature alerts</h2><p>Alert yang masih relevan dari histori poll lokal.</p></div></CardHeader><CardContent><DataTable columns={['Severity', 'Account', 'Unit', 'Start', 'End', 'Minutes', 'Speed', 'Temp range']} emptyMessage="Belum ada live temp alert." rows={(status?.liveAlerts || []).map((row) => [<Chip color={row.type === 'temp1+temp2' ? 'danger' : 'warning'} variant="flat">{row.label}</Chip>, row.accountLabel || row.accountId || '-', <div><strong>{row.unitLabel || row.vehicle}</strong><div className="subtle-line">{row.vehicle}</div></div>, fmtDate(row.startTimestamp), fmtDate(row.endTimestamp), fmtNum(row.durationMinutes, 1), `${fmtNum(row.minSpeed, 0)} - ${fmtNum(row.maxSpeed, 0)}`, `T1 ${fmtNum(row.temp1Min)} to ${fmtNum(row.temp1Max)} | T2 ${fmtNum(row.temp2Min)} to ${fmtNum(row.temp2Max)}`])} /></CardContent></Card>
            <div className="split-panels">
              <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Compile per day</h2><p>Ringkasan incident temp per unit per hari.</p></div></CardHeader><CardContent><DataTable columns={['Day', 'Account', 'Unit', 'Incidents', 'Temp1', 'Temp2', 'Both', 'Total min', 'Longest']} emptyMessage="Belum ada compile row di range ini." rows={(report?.compileByUnitDay || []).map((row) => [row.day, row.accountLabel || '-', row.vehicle, row.incidents, row.temp1Incidents, row.temp2Incidents, row.bothIncidents, fmtNum(row.totalMinutes, 1), fmtNum(row.longestMinutes, 1)])} /></CardContent></Card>
              <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Daily totals</h2><p>Quick scan buat lihat hari yang paling bermasalah.</p></div></CardHeader><CardContent><DataTable columns={['Day', 'Units', 'Incidents', 'Critical', 'Total min']} emptyMessage="Belum ada daily totals di range ini." rows={(report?.dailyTotals || []).map((row) => [row.day, row.units, row.incidents, row.criticalIncidents, fmtNum(row.totalMinutes, 1)])} /></CardContent></Card>
            </div>
          </> : null}
          {activePanel === 'fleet' ? <>
            <Card className="panel-card fleet-focus-card">
              <CardHeader className="panel-card-header">
                <div>
                  <h2>Fleet live + temperature graph</h2>
                  <p>Grafik suhu unit terpilih dari historical Solofleet sesuai date range. Klik row di tabel buat pindah chart.</p>
                </div>
                <div className="inline-buttons">
                  {selectedFleetRow?.latitude !== null && selectedFleetRow?.longitude !== null ? <Link href={`https://www.google.com/maps?q=${selectedFleetRow.latitude},${selectedFleetRow.longitude}`} target="_blank">Open map</Link> : null}
                  {selectedFleetRow ? <Button variant="bordered" onPress={() => openUnit(selectedFleetRow.accountId || 'primary', selectedFleetRow.id, 'temp-errors')}>Open temp errors</Button> : null}
                </div>
              </CardHeader>
              <CardContent>
                {selectedFleetRow ? <>
                  <div className="fleet-focus-head">
                    <div>
                      <p className="eyebrow local-eyebrow">Selected unit</p>
                      <h3>{selectedFleetRow.id} | {selectedFleetRow.label}</h3>
                      <p className="focus-copy">{selectedFleetRow.locationSummary || '-'}{selectedFleetRow.zoneName ? ` | ${selectedFleetRow.zoneName}` : ''}</p>
                      <div className="chip-row">
                        <Chip color={health(selectedFleetRow).tone} variant="flat">{health(selectedFleetRow).label}</Chip>
                        <Chip variant="flat">{selectedFleetRow.customerName || selectedFleetRow.group || 'No customer'}</Chip>
                        <Chip variant="flat">Updated {fmtAgo(selectedFleetRow.minutesSinceUpdate)}</Chip>
                        {selectedFleetRow.matchedPodSite ? <Chip color="success" variant="flat">POD {selectedFleetRow.matchedPodSite.name}</Chip> : null}
                      </div>
                    </div>
                    <div className="unit-summary-grid">
                      <SummaryMetric label="Temp 1" value={fmtNum(selectedFleetRow.liveTemp1)} danger={selectedFleetRow.liveSensorFaultType === 'temp1' || selectedFleetRow.liveSensorFaultType === 'temp1+temp2'} />
                      <SummaryMetric label="Temp 2" value={fmtNum(selectedFleetRow.liveTemp2)} danger={selectedFleetRow.liveSensorFaultType === 'temp2' || selectedFleetRow.liveSensorFaultType === 'temp1+temp2'} />
                      <SummaryMetric label="Gap" value={fmtNum(selectedFleetRow.liveTempDelta)} />
                      <SummaryMetric label="Speed" value={fmtNum(selectedFleetRow.speed, 0)} />
                      <SummaryMetric label="Customer setpoint" value={selectedFleetRow.targetTempMin !== null || selectedFleetRow.targetTempMax !== null ? `${fmtNum(selectedFleetRow.targetTempMin)} to ${fmtNum(selectedFleetRow.targetTempMax)}` : 'Not set'} danger={rowHasSetpointIssue(selectedFleetRow)} /><SummaryMetric label="Status" value={selectedFleetRow.liveSensorFaultLabel || selectedFleetRow.setpointLabel || (rowHasSensorError(selectedFleetRow) ? health(selectedFleetRow).label : 'Normal')} danger={rowHasSetpointIssue(selectedFleetRow) || rowHasSensorError(selectedFleetRow)} />
                      <SummaryMetric label="GPS" value={selectedFleetRow.errGps || 'OK'} danger={Boolean(selectedFleetRow.errGps) || rowHasGpsLate(selectedFleetRow)} />
                    </div>
                  </div>
                  <TemperatureChart records={unitDetail?.records || []} busy={detailBusy} title="Temperature trend" description="Line chart temp1 vs temp2 dari historical Solofleet sesuai date range." />
                </> : <div className="empty-state">Belum ada unit yang bisa dipilih.</div>}
              </CardContent>
            </Card>

            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Fleet live snapshot</h2><p>Unit temp error otomatis merah dan naik ke atas. Setpoint mismatch dan GPS telat juga langsung kelihatan.</p></div></CardHeader><CardContent><DataTable columns={['Health', 'Account', 'Unit', 'Customer', 'Setpoint', 'Location', 'Speed', 'Temp 1', 'Temp 2', 'Gap', 'Errors', 'Updated', 'Maps']} emptyMessage="Belum ada fleet snapshot. Save config lalu jalankan Poll now." rows={prioritizedFleet.map((row) => { const state = health(row); return [<Chip color={state.tone} variant="flat">{state.label}</Chip>, row.accountLabel || row.accountId || '-', <div><strong>{row.id}</strong><div className="subtle-line">{row.label}</div><div className="subtle-line">{row.alias}</div></div>, <div><div>{row.customerName || row.group || '-'}</div><div className="subtle-line">{row.group || 'No group'}</div></div>, <div><div>{row.targetTempMin !== null || row.targetTempMax !== null ? `${fmtNum(row.targetTempMin)} to ${fmtNum(row.targetTempMax)}` : '-'}</div><div className="subtle-line">{row.setpointLabel || 'No rule'}</div></div>, <div><div>{row.locationSummary || '-'}</div><div className="subtle-line">{row.zoneName || 'No zone'}</div><div className="subtle-line">{fmtCoord(row.latitude)}, {fmtCoord(row.longitude)}</div></div>, fmtNum(row.speed, 0), fmtNum(row.liveTemp1), fmtNum(row.liveTemp2), row.liveTempDelta !== null ? <Chip color={row.liveTempDelta >= 5 ? 'warning' : 'default'} variant="flat">{fmtNum(row.liveTempDelta)}</Chip> : '-', <div><div>{row.liveSensorFaultLabel || (row.recentAlertsCount ? `${row.recentAlertsCount} recent alert(s)` : row.errSensor || 'Sensor OK')}</div><div className="subtle-line">{row.errGps || 'GPS OK'}</div></div>, <div><div>{fmtDate(row.lastUpdatedAt)}</div><div className="subtle-line">{fmtAgo(row.minutesSinceUpdate)}</div></div>, row.latitude !== null && row.longitude !== null ? <Link href={`https://www.google.com/maps?q=${row.latitude},${row.longitude}`} target="_blank">Open map</Link> : '-']; })} getRowProps={(row, rowIndex) => ({ key: prioritizedFleet[rowIndex]?.rowKey || `fleet-${rowIndex}`, className: rowPriority(prioritizedFleet[rowIndex]) >= 5 ? 'data-row data-row-danger' : rowPriority(prioritizedFleet[rowIndex]) >= 3 ? 'data-row data-row-warning' : 'data-row', onClick: () => openUnit(prioritizedFleet[rowIndex].accountId || 'primary', prioritizedFleet[rowIndex].id, 'fleet') })} /></CardContent></Card>
          </> : null}
          {activePanel === 'temp-errors' ? <>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Dedicated temp error page</h2><p>Tarik semua incident error suhu by date range, lengkap dengan lokasi, lat/lng, dan durasi.</p></div><div className="inline-buttons"><Button variant="bordered" onPress={exportAlerts}>Export temp error CSV</Button></div></CardHeader><CardContent><div className="metric-strip"><div className="mini-metric"><span>Alerts</span><strong>{errorOverview.alerts}</strong></div><div className="mini-metric"><span>Affected units</span><strong>{errorOverview.affectedUnits}</strong></div><div className="mini-metric"><span>Critical</span><strong>{errorOverview.criticalAlerts}</strong></div><div className="mini-metric"><span>Total min</span><strong>{fmtNum(errorOverview.totalMinutes, 1)}</strong></div></div></CardContent></Card>
            <div className="split-panels split-panels-tall">
              <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Temp error incidents</h2><p>Klik row buat buka unit itu di chart detail.</p></div></CardHeader><CardContent><DataTable columns={['Tanggal', 'Jam', 'Account', 'Severity', 'Nopol', 'Temp 1', 'Temp 2', 'Speed']} emptyMessage="Belum ada temp error snapshot di range ini." rows={errorRows.map((row) => [row.day, row.errorTime, row.accountLabel || row.accountId || '-', <Chip color={row.type === 'temp1+temp2' ? 'danger' : 'warning'} variant="flat">{row.label}</Chip>, <div><strong>{row.unitId}</strong><div className="subtle-line">{row.unitLabel}</div></div>, fmtNum(row.temp1), fmtNum(row.temp2), fmtNum(row.speed, 0)])} getRowProps={(row, rowIndex) => ({ key: `${errorRows[rowIndex]?.accountId || 'account'}-${errorRows[rowIndex]?.unitId || 'alert'}-${rowIndex}`, className: errorRows[rowIndex]?.type === 'temp1+temp2' ? 'data-row data-row-danger' : 'data-row data-row-warning', onClick: () => openUnit(errorRows[rowIndex].accountId || 'primary', errorRows[rowIndex].unitId, 'temp-errors') })} /></CardContent></Card>
              <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Selected unit chart</h2><p>Trend suhu unit yang dipilih dari panel error.</p></div></CardHeader><CardContent>{selectedFleetRow ? <><div className="focus-side-meta"><strong>{selectedFleetRow.id} | {selectedFleetRow.label}</strong><div className="subtle-line">{selectedFleetRow.accountLabel || selectedFleetRow.accountId}</div><div className="subtle-line">{selectedFleetRow.locationSummary || '-'}</div></div><TemperatureChart records={unitDetail?.records || []} busy={detailBusy} title="Sensor trend" description="Cocok buat lihat apakah temp1 dan temp2 mulai jomplang sebelum error." compact /></> : <div className="empty-state">Klik salah satu incident buat lihat chart unit.</div>}</CardContent></Card>
            </div>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Unit compile by day</h2><p>Summary unit yang paling sering error pada range yang dipilih.</p></div></CardHeader><CardContent><DataTable columns={['Day', 'Account', 'Unit', 'Incidents', 'Temp1', 'Temp2', 'Both', 'Total min', 'Longest']} emptyMessage="Belum ada compile error by day di range ini." rows={errorUnitsSummary.map((row) => [row.day, row.accountLabel || '-', row.vehicle, row.incidents, row.temp1Incidents, row.temp2Incidents, row.bothIncidents, fmtNum(row.totalMinutes, 1), fmtNum(row.longestMinutes, 1)])} /></CardContent></Card>
          </> : null}

          {activePanel === 'historical' ? <>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Historical temperature</h2><p>Versi yang lebih enak dari tempchart. Pilih unit, lihat chart dan tabel raw history pada date range yang dipilih.</p></div><div className="inline-buttons"><Button variant="bordered" onPress={exportHistory}>Export history CSV</Button></div></CardHeader><CardContent>{selectedFleetRow ? <><div className="focus-side-meta"><strong>{selectedFleetRow.id} | {selectedFleetRow.label}</strong><div className="subtle-line">{selectedFleetRow.accountLabel || selectedFleetRow.accountId}</div><div className="subtle-line">{selectedFleetRow.customerName || 'No customer profile'}</div></div><TemperatureChart records={unitDetail?.records || []} busy={detailBusy} title="Historical temperature chart" description="Tarik langsung dari historical Solofleet sesuai range." /><div className="spacer-16" /><DataTable columns={['Timestamp', 'Speed', 'Temp 1', 'Temp 2']} emptyMessage="Belum ada historical rows untuk unit ini." rows={(unitDetail?.records || []).slice(-120).reverse().map((row) => [fmtDate(row.timestamp), fmtNum(row.speed, 0), fmtNum(row.temp1), fmtNum(row.temp2)])} /></> : <div className="empty-state">Pilih unit dulu dari fleet live atau search.</div>}</CardContent></Card>
          </> : null}

          {activePanel === 'pod' ? <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>POD auto capture</h2><p>Snapshot harian kalau unit masuk radius POD dengan speed rendah. Lokasi POD bisa kamu atur sendiri.</p></div><div className="inline-buttons"><Button variant="bordered" onPress={exportPods}>Export POD CSV</Button></div></CardHeader><CardContent><DataTable columns={['Day', 'Time', 'Account', 'Unit', 'Customer', 'POD', 'Distance', 'Speed', 'Location']} emptyMessage="Belum ada POD capture di range ini." rows={podRows.map((row) => [row.day, row.time, row.accountLabel || row.accountId || '-', <div><strong>{row.unitId}</strong><div className="subtle-line">{row.unitLabel}</div></div>, row.customerName || '-', row.podName, `${fmtNum(row.distanceMeters, 0)} m`, fmtNum(row.speed, 0), row.locationSummary || '-'])} /></CardContent></Card> : null}

          {activePanel === 'api-monitor' ? <>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>API Monitor</h2><p>Trace ringan untuk lihat endpoint backend yang aktif, error, dan paling lambat.</p></div></CardHeader><CardContent><div className="metric-strip"><div className="mini-metric"><span>Requests</span><strong>{apiMonitor?.totals?.requests ?? 0}</strong></div><div className="mini-metric"><span>Errors</span><strong>{apiMonitor?.totals?.errors ?? 0}</strong></div><div className="mini-metric"><span>Slow</span><strong>{apiMonitor?.totals?.slowRequests ?? 0}</strong></div><div className="mini-metric"><span>Endpoints</span><strong>{apiMonitor?.totals?.uniqueEndpoints ?? 0}</strong></div></div></CardContent></Card>
            <div className="split-panels split-panels-tall">
              <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Endpoint summary</h2><p>Hit count, error count, dan average duration per endpoint.</p></div></CardHeader><CardContent><DataTable columns={['Method', 'Path', 'Hits', 'Errors', 'Avg ms', 'Last status', 'Last at', 'Last error']} emptyMessage="Belum ada traffic API tercatat." rows={(apiMonitor?.endpointSummary || []).map((row) => [row.method, row.path, row.hits, row.errorCount, fmtNum(row.avgDurationMs, 1), row.lastStatusCode ?? '-', fmtDate(row.lastAt), row.lastError || '-'])} /></CardContent></Card>
              <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Recent requests</h2><p>Request API terbaru yang masuk ke backend lokal.</p></div></CardHeader><CardContent><DataTable columns={['Time', 'Method', 'Path', 'Status', 'Duration', 'Error']} emptyMessage="Belum ada recent request." rows={(apiMonitor?.recent || []).slice(0, 60).map((row) => [fmtDate(row.timestamp), row.method, `${row.path}${row.query || ''}`, row.statusCode, `${fmtNum(row.durationMs, 0)} ms`, row.error || '-'])} /></CardContent></Card>
            </div>
          </> : null}
          {activePanel === 'config' ? <>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Customer grouping + setpoint</h2><p>Format: <code>Customer|min|max|COL89,COL90</code></p></div><div className="inline-buttons"><Button color="primary" onPress={() => saveConfig(false)}>Save config</Button></div></CardHeader><CardContent><label className="field"><span>Customer profiles</span><textarea rows="8" value={form.customerProfilesText} onChange={(event) => setForm((current) => ({ ...current, customerProfilesText: event.target.value }))} /></label></CardContent></Card>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>POD config</h2><p>Format: <code>POD|lat|lng|radiusMeter|maxSpeed|customer|COL89,COL90</code></p></div></CardHeader><CardContent><label className="field"><span>POD sites</span><textarea rows="8" value={form.podSitesText} onChange={(event) => setForm((current) => ({ ...current, podSitesText: event.target.value }))} /></label></CardContent></Card>
          </> : null}

          {activePanel === 'stop' ? <>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Stop / idle explorer</h2><p>On-demand ke endpoint ReportStop supaya nggak spam semua unit sekaligus, tapi tetap usable buat investigasi.</p></div></CardHeader><CardContent><div className="form-grid form-grid-stop"><label className="field"><span>Unit</span><select value={`${stopForm.accountId}::${stopForm.unitId}`} onChange={(event) => { const [accountId, unitId] = event.target.value.split('::'); setStopForm((current) => ({ ...current, accountId: accountId || 'primary', unitId: unitId || '' })); }}>{fleetRows.map((row) => <option key={row.rowKey || `${row.accountId}-${row.id}`} value={`${row.accountId || 'primary'}::${row.id}`}>{accountName({ id: row.accountId, label: row.accountLabel })} | {row.id} | {row.label}</option>)}</select></label><label className="field"><span>Report type</span><select value={stopForm.reportType} onChange={(event) => setStopForm((current) => ({ ...current, reportType: event.target.value }))}><option value="1">Stop Engine Report</option><option value="2">Idle Engine Report</option><option value="3">Speed-based idle/stop Report</option></select></label><label className="field"><span>Min duration (min)</span><input type="number" min="0" value={stopForm.minDuration} onChange={(event) => setStopForm((current) => ({ ...current, minDuration: event.target.value }))} /></label><div className="field field-actions"><Button color="primary" onPress={loadStopReport}>Analyze stop / idle</Button><Button variant="bordered" onPress={exportStop}>Export stop CSV</Button></div></div></CardContent></Card>
            <Card className="panel-card"><CardHeader className="panel-card-header"><div><h2>Stop/idle result</h2><p>Latitude, longitude, durasi, average temp, dan link ke map.</p></div></CardHeader><CardContent>{stopReport ? <><div className="metric-strip"><div className="mini-metric"><span>Rows</span><strong>{stopReport.summary?.incidents ?? '-'}</strong></div><div className="mini-metric"><span>Total min</span><strong>{fmtNum(stopReport.summary?.totalMinutes, 1)}</strong></div><div className="mini-metric"><span>Longest</span><strong>{fmtNum(stopReport.summary?.longestMinutes, 1)}</strong></div><div className="mini-metric"><span>With lat/lng</span><strong>{stopReport.summary?.withLocation ?? '-'}</strong></div></div><div className="spacer-16" /><DataTable columns={['Start', 'End', 'Minutes', 'Distance', 'Avg temp', 'Location', 'Lat', 'Lng', 'Zone', 'Engine', 'Maps']} emptyMessage="Belum ada row stop/idle di range ini." rows={stopReport.rows.map((row) => [fmtDate(row.startTimestamp), fmtDate(row.endTimestamp), fmtNum(row.durationMinutes, 1), fmtNum(row.movementDistance, 1), fmtNum(row.avgTemp, 1), row.locationSummary || '-', fmtCoord(row.latitude), fmtCoord(row.longitude), row.zoneName || row.zoneBoundary || '-', row.engineDetected === 1 ? 'idle' : row.engineDetected === 0 ? 'stop' : '-', row.googleMapsUrl ? <Link href={row.googleMapsUrl} target="_blank">Open map</Link> : '-'])} /></> : <div className="empty-state">Klik Analyze stop / idle buat ambil report dari Solofleet.</div>}</CardContent></Card>
          </> : null}
        </div>

        <aside className={sidebarCollapsed ? "side-column side-column-collapsed" : "side-column"}><Card className="panel-card sidebar-card"><CardContent><div className="sidebar-header"><div><p className="eyebrow local-eyebrow">Navigation</p><strong>SoWhat? Menu</strong></div><button type="button" className="sidebar-collapse-button" onClick={() => setSidebarCollapsed((current) => !current)}>{sidebarCollapsed ? '>' : '<'}</button></div><nav className={sidebarCollapsed ? "sidebar-nav sidebar-nav-collapsed" : "sidebar-nav"}>{['overview', 'fleet', 'historical', 'temp-errors', 'pod', 'stop', 'api-monitor', 'config'].map((name) => <button type="button" key={`sidebar-${name}`} className={activePanel === name ? "panel-button panel-button-active sidebar-nav-button" : "panel-button sidebar-nav-button"} onClick={() => setActivePanel(name)}>{sidebarCollapsed ? name.charAt(0).toUpperCase() : name === 'fleet' ? 'fleet live' : name === 'stop' ? 'stop/idle explorer' : name === 'temp-errors' ? 'temp errors' : name === 'api-monitor' ? 'api monitor' : name}</button>)}</nav></CardContent></Card>
          <Card className="panel-card settings-card"><CardHeader className="panel-card-header"><div><h2>Settings</h2><p>Session, multi-account management, auto polling, discovery unit, dan parameter histori temp.</p></div></CardHeader><CardContent><div className="settings-stack"><label className="field"><span>Active account config</span><select value={activeAccountId} onChange={(event) => switchAccount(event.target.value)}>{availableAccounts.map((account) => <option key={account.id} value={account.id}>{accountName(account)}{account.id === 'primary' ? ' (primary)' : ''}</option>)}</select></label><div className="account-stack">{availableAccounts.map((account) => <div key={account.id} className={account.id === activeAccountId ? 'account-item account-item-active' : 'account-item'}><div className="account-item-head"><div><strong>{accountName(account)}</strong><div className="subtle-line">{account.authEmail || 'Belum login'}</div></div><div className="chip-row"><Chip variant="flat" color={account.id === 'primary' ? 'primary' : 'default'}>{account.id === 'primary' ? 'Primary' : 'Linked'}</Chip>{account.hasSessionCookie ? <Chip variant="flat" color="success">Ready</Chip> : <Chip variant="flat">No session</Chip>}</div></div><div className="inline-buttons"><Button color="primary" variant={account.id === activeAccountId ? 'solid' : 'bordered'} onPress={() => switchAccount(account.id)}>{account.id === activeAccountId ? 'Editing this account' : 'Edit config'}</Button>{account.id !== 'primary' ? <Button variant="light" onPress={() => logoutAccount(account.id)}>Remove account</Button> : null}</div></div>)}</div><div className="divider-line" /><div className="settings-subgroup"><div><h3>Add linked account</h3><p className="subtle-line">Pakai akun vendor atau partner tanpa logout akun utama.</p></div><label className="field"><span>Label akun</span><input type="text" value={loginForm.label} onChange={(event) => setLoginForm((current) => ({ ...current, label: event.target.value }))} placeholder="Vendor A / Customer B" /></label><label className="field"><span>Email akun linked</span><input type="email" value={loginForm.email} onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))} placeholder="vendor@company.com" /></label><label className="field"><span>Password akun linked</span><input type="password" value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password Solofleet" /></label><label className="field checkbox-field"><input type="checkbox" checked={loginForm.rememberMe} onChange={(event) => setLoginForm((current) => ({ ...current, rememberMe: event.target.checked }))} /><span>Remember me</span></label><div className="inline-buttons"><Button color="primary" onPress={() => loginWithSolofleet('linked')}>Add linked account</Button><Button variant="bordered" onPress={() => setLoginForm((current) => ({ ...current, password: '' }))}>Clear password</Button></div></div><label className="field"><span>Session cookie</span><textarea rows="5" placeholder="Paste Cookie header dari Solofleet untuk akun yang sedang diedit" value={form.sessionCookie} onChange={(event) => setForm((current) => ({ ...current, sessionCookie: event.target.value }))} /></label><div className="auth-note">Editing {accountName(currentAccount)}{currentAccount?.authEmail ? ` | ${currentAccount.authEmail}` : ''}</div><div className="inline-buttons"><Button color="primary" onPress={() => saveConfig(false)}>Save config</Button><Button variant="bordered" onPress={discoverUnits}>Auto discover units</Button><Button variant="light" onPress={logoutFromLocal}>{activeAccountId === 'primary' ? 'Logout primary' : 'Remove linked account'}</Button></div><label className="field"><span>Units (`ddl|label`)</span><textarea rows="7" value={form.unitsText} onChange={(event) => setForm((current) => ({ ...current, unitsText: event.target.value }))} /></label><div className="form-grid compact-grid"><label className="field"><span>Poll interval</span><input type="number" value={form.pollIntervalSeconds} onChange={(event) => setForm((current) => ({ ...current, pollIntervalSeconds: event.target.value }))} /></label><label className="field"><span>Lookback min</span><input type="number" value={form.requestLookbackMinutes} onChange={(event) => setForm((current) => ({ ...current, requestLookbackMinutes: event.target.value }))} /></label><label className="field"><span>Request interval</span><input type="number" value={form.requestIntervalSeconds} onChange={(event) => setForm((current) => ({ ...current, requestIntervalSeconds: event.target.value }))} /></label><label className="field"><span>Min alert min</span><input type="number" value={form.minDurationMinutes} onChange={(event) => setForm((current) => ({ ...current, minDurationMinutes: event.target.value }))} /></label></div><div className="runtime-card"><div><h3>Runtime</h3><p>{status?.runtime?.lastRunMessage || 'Idle'}</p></div><ul className="runtime-list"><li>Polling: {status?.runtime?.isPolling ? 'ON' : 'OFF'}</li><li>Accounts connected: {connectedAccounts.length}</li><li>Last poll: {fmtDate(status?.runtime?.lastRunFinishedAt)}</li><li>Next poll: {fmtDate(status?.runtime?.nextRunAt)}</li><li>Snapshot: {fmtDate(status?.runtime?.lastSnapshotAt)}</li><li>Snapshot error: {status?.runtime?.lastSnapshotError || 'None'}</li></ul></div></div></CardContent></Card>
        </aside>
      </section>
    </div>
  );
}
function SummaryMetric({ label, value, danger = false }) {
  return <div className={danger ? 'mini-metric mini-metric-danger' : 'mini-metric'}><span>{label}</span><strong>{value}</strong></div>;
}

function TemperatureChart({ records, busy, title, description, compact = false }) {
  const series = useMemo(() => (records || []).filter((record) => record.temp1 !== null || record.temp2 !== null).slice(-120), [records]);

  if (busy) return <div className="chart-empty">Loading chart...</div>;
  if (!series.length) return <div className="chart-empty">Belum ada historical temperature yang cukup buat digambar.</div>;

  const width = 860;
  const height = compact ? 220 : 280;
  const padding = { top: 20, right: 20, bottom: 34, left: 40 };
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

  return <div className={compact ? 'chart-shell chart-shell-compact' : 'chart-shell'}>
    <div className="chart-meta">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="chart-legend">
        <span><i className="legend-dot legend-dot-temp1" /> Temp 1</span>
        <span><i className="legend-dot legend-dot-temp2" /> Temp 2</span>
      </div>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Temperature trend chart">
      <rect x="0" y="0" width={width} height={height} rx="20" fill="rgba(255,255,255,0.62)" />
      {guideValues.map((value, index) => {
        const y = yFor(value);
        return <g key={`guide-${index}`}><line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="rgba(64, 120, 214, 0.18)" strokeDasharray="6 8" /><text x="8" y={y + 4} fontSize="12" fill="rgba(77, 102, 152, 0.9)">{Number(value).toFixed(1)}</text></g>;
      })}
      {timeGuides.map((value, index) => {
        const x = xFor(value);
        return <g key={`time-${index}`}><line x1={x} x2={x} y1={padding.top} y2={height - padding.bottom} stroke="rgba(64, 120, 214, 0.08)" /><text x={x} y={height - 10} fontSize="12" textAnchor={index === 0 ? 'start' : index === timeGuides.length - 1 ? 'end' : 'middle'} fill="rgba(77, 102, 152, 0.9)">{fmtClock(value)}</text></g>;
      })}
      <path d={temp1Path} fill="none" stroke="#2563eb" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d={temp2Path} fill="none" stroke="#0ea5e9" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>;
}

function DataTable({ columns, rows, emptyMessage, getRowProps }) {
  if (!rows.length) return <div className="empty-state">{emptyMessage}</div>;
  return <div className="table-shell"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => {
    const rowProps = getRowProps ? getRowProps(row, rowIndex) : {};
    const { key, className, ...restRowProps } = rowProps || {};
    return <tr key={key || `row-${rowIndex}`} className={className || ''} {...restRowProps}>{row.map((cell, cellIndex) => <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>;
  })}</tbody></table></div>;
}








































































