import React, { useMemo, useRef, useState } from 'react';
import { Settings, ChevronUp, ChevronDown, Search, Plus, Trash2, Edit3, RefreshCw, Zap } from 'lucide-react';
import { Surface, SurfaceHeader, SurfaceBody, Action, Pill, Spinner } from './index.js';

const Button = ({ children, variant, color, onPress, onClick, className = '', ...props }) => {
  const resolvedVariant = variant === 'bordered' || variant === 'flat' ? 'secondary'
    : variant === 'light' ? 'ghost'
    : color === 'danger' || color === 'error' ? 'danger'
    : 'primary';

  return (
    <Action variant={resolvedVariant} className={className} onClick={onClick || onPress} {...props}>
      {children}
    </Action>
  );
};

const Card = React.forwardRef(function Card({ children, className = '', ...props }, ref) {
  return <Surface ref={ref} className={`sf-card-compat panel-card ${className}`.trim()} {...props}>{children}</Surface>;
});

const CardHeader = ({ children, className = '' }) => <SurfaceHeader className={`panel-card-header ${className}`.trim()}>{children}</SurfaceHeader>;
const CardContent = ({ children, className = '' }) => <SurfaceBody className={className}>{children}</SurfaceBody>;
const Chip = ({ children, color = 'default', className = '' }) => <Pill color={color} className={className}>{children}</Pill>;

function DataTable({ columns, rows, emptyMessage, className = '', shellClassName = '', pagination = null }) {
  const rowsPerPageOptions = pagination?.rowsPerPageOptions || [10, 20, 50];
  const initialRowsPerPage = pagination?.initialRowsPerPage || rowsPerPageOptions[0] || 10;
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage);
  const [page, setPage] = useState(1);
  const totalPages = pagination ? Math.max(1, Math.ceil(rows.length / rowsPerPage)) : 1;
  const safePage = Math.min(page, totalPages);
  const pageStart = pagination ? (safePage - 1) * rowsPerPage : 0;
  const visibleRows = pagination ? rows.slice(pageStart, pageStart + rowsPerPage) : rows;

  if (!rows.length) return <div className="empty-state">{emptyMessage}</div>;

  return (
    <div className={`table-shell${shellClassName ? ` ${shellClassName}` : ''}`}>
      <table className={`data-table${className ? ` ${className}` : ''}`}>
        <thead>
          <tr>{columns.map((column, index) => <th key={typeof column === 'string' ? column : column.key || index}>{typeof column === 'string' ? column : column.label}</th>)}</tr>
        </thead>
        <tbody>
          {visibleRows.map((row, rowIndex) => (
            <tr key={`row-${pageStart + rowIndex}`}>{row.map((cell, cellIndex) => <td key={`cell-${pageStart + rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {pagination ? (
        <div className="table-pagination">
          <div className="table-pagination-meta">
            <span>Rows per page</span>
            <select aria-label="Rows per page" value={rowsPerPage} onChange={(event) => { setRowsPerPage(Number(event.target.value || initialRowsPerPage)); setPage(1); }}>
              {rowsPerPageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div className="table-pagination-meta">Page {safePage} of {totalPages}</div>
          <div className="table-pagination-controls">
            <button type="button" className="table-page-button" aria-label="First page" onClick={() => setPage(1)} disabled={safePage <= 1}>{'<<'}</button>
            <button type="button" className="table-page-button" aria-label="Previous page" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1}>{'<'}</button>
            <button type="button" className="table-page-button" aria-label="Next page" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage >= totalPages}>{'>'}</button>
            <button type="button" className="table-page-button" aria-label="Last page" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}>{'>>'}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionCard({ title, description, open = true, setOpen, children, actions, icon, cardRef }) {
  const Icon = icon || Settings;
  return (
    <Card ref={cardRef}>
      <CardHeader>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="inline-buttons">
          {setOpen ? (
            <Button variant="bordered" className="section-chevron-button" onPress={() => setOpen((current) => !current)} aria-label={open ? `Collapse ${title}` : `Expand ${title}`}>
              {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </Button>
          ) : <Icon size={16} aria-hidden="true" />}
          {open ? actions : null}
        </div>
      </CardHeader>
      {open ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}

function SearchInput({ label, value, onChange, placeholder }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="search-box historical-search-box">
        <Search size={16} className="search-icon" />
        <input type="search" value={value || ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      </div>
    </label>
  );
}

function SelectFallback({ label, value, options = [], onChange, placeholder, disabled = false }) {
  // TODO: replace this fallback with the extracted SearchableSelect component from App.jsx.
  return (
    <label className="field searchable-field">
      <span>{label}</span>
      <select value={value || ''} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-label={label}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => <option key={`${label}-${option.value || 'empty'}`} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function accountLabel(account) {
  return account?.label || account?.authEmail || account?.id || 'primary';
}

function sessionLine(account) {
  if (account?.hasVerifiedSession) return 'verified session';
  if (account?.hasSessionCookie) return 'needs refresh';
  return 'disconnected';
}

export function ConfigPanel({
  availableAccounts = [],
  activeAccountId,
  currentAccount,
  onSwitchAccount,
  onDiscoverUnits,
  onLogoutAccount,
  onSaveConfig,
  linkedAccountSectionOpen,
  setLinkedAccountSectionOpen,
  accountLoginForm = {},
  setAccountLoginForm,
  onLoginLinkedAccount,
  unitCategorySectionOpen,
  setUnitCategorySectionOpen,
  configuredUnits = [],
  filteredConfiguredUnits = [],
  unitCategorySearch,
  setUnitCategorySearch,
  selectedUnitCategoryIds = [],
  onToggleUnitCategorySelection,
  onSelectVisibleUnits,
  onClearUnitSelection,
  unitCategoryBulkValue,
  setUnitCategoryBulkValue,
  onApplyBulkCategory,
  unitCategoryCsvText,
  setUnitCategoryCsvText,
  onImportUnitCategoryCsv,
  onLoadUnitCategoryCsvFile,
  onDownloadUnitCategoryTemplate,
  UNIT_CATEGORY_OPTIONS = [],
  normalizeUnitCategory = (value) => value || 'uncategorized',
  unitCategoryLabel = (value) => value || 'Uncategorized',
  unitCategoryTone = () => 'default',
  tmsConfigSectionOpen,
  setTmsConfigSectionOpen,
  tmsConfig,
  tmsForm = {},
  setTmsForm,
  tmsLogs = [],
  tmsLogsBusy,
  onLoadTmsLogs,
  onSaveTmsConfig,
  onLoginTms,
  onLogoutTms,
  onTriggerTmsSync,
  onOpenTripMonitor,
  remoteResetSectionOpen,
  setRemoteResetSectionOpen,
  remoteResetForm = {},
  setRemoteResetForm,
  remoteResetStatus,
  remoteResetLogs = [],
  onLoadRemoteResetLogs,
  onRunRemoteResetNow,
  onToggleRemoteResetAccount,
  astroLocationSectionOpen,
  setAstroLocationSectionOpen,
  astroLocationForm = {},
  setAstroLocationForm,
  EMPTY_ASTRO_LOCATION_FORM = {},
  astroLocations = [],
  astroFilteredLocationGroups = [],
  geofenceLocationCounts = {},
  selectedAstroLocationIds = [],
  onToggleAstroLocationSelection,
  onSelectVisibleAstroLocations,
  onClearAstroLocationSelection,
  onSaveAstroLocation,
  onEditAstroLocation,
  onDeleteAstroLocation,
  onDeleteAstroLocations,
  astroLocationSearch,
  setAstroLocationSearch,
  astroLocationExpanded = {},
  setAstroLocationExpanded,
  astroCsvText,
  setAstroCsvText,
  onLoadAstroCsvFile,
  onImportAstroLocations,
  ASTRO_LOCATION_SAMPLE_CSV = '',
  GEOFENCE_LOCATION_TYPES = [],
  GEOFENCE_LOCATION_LABELS = {},
  ASTRO_GROUP_PREVIEW_LIMIT = 6,
  fmtCoord,
  astroRouteSectionOpen,
  setAstroRouteSectionOpen,
  astroRouteForm = {},
  setAstroRouteForm,
  EMPTY_ASTRO_ROUTE_FORM = {},
  astroRoutes = [],
  astroFilteredRouteGroups = [],
  selectedAstroRouteIds = [],
  onToggleAstroRouteSelection,
  onSelectVisibleAstroRoutes,
  onClearAstroRouteSelection,
  onSaveAstroRoute,
  onEditAstroRoute,
  onDeleteAstroRoute,
  onDeleteAstroRoutes,
  astroRouteSearch,
  setAstroRouteSearch,
  astroRouteExpanded = {},
  setAstroRouteExpanded,
  astroRouteCsvText,
  setAstroRouteCsvText,
  onLoadAstroRouteCsvFile,
  onImportAstroRoutes,
  ASTRO_ROUTE_SAMPLE_CSV = '',
  ASTRO_ROUTE_MAX_PODS = 5,
  astroRouteAccountOptions = [],
  astroRouteFilteredUnitOptions = [],
  astroWhOptions = [],
  astroPoolOptions = [],
  astroPodOptions = [],
  astroUnitLabelByKey,
  onAddAstroRoutePod,
  onRemoveAstroRoutePod,
  onUpdateAstroRoutePod,
  onUpdateAstroRoutePodSla,
  createBlankAstroPodSlaArray = (count) => Array.from({ length: count }, () => ''),
  astroSnapshotConsoleSectionOpen,
  setAstroSnapshotConsoleSectionOpen,
  astroSnapshotAutoSync,
  astroSnapshotLogs = [],
  astroSnapshotLogsBusy,
  onLoadAstroSnapshotLogs,
  onTriggerAstroSnapshotSync,
  astroLocationCardRef,
  astroRouteCardRef,
  fmtDate = (value) => value || '-',
  fmtNum = (value) => value ?? '-',
  fmtCoord: fmtCoordFn,
  accountName,
}) {
  const panelRef = useRef(null);
  const formatCoord = fmtCoordFn || fmtCoord || ((value) => value ?? '-');
  const unitRows = useMemo(() => filteredConfiguredUnits.map((unit) => [
    <input type="checkbox" aria-label={`Select ${unit.label || unit.id}`} checked={selectedUnitCategoryIds.includes(unit.id)} onChange={() => onToggleUnitCategorySelection?.(unit.id)} />,
    <div><strong>{unit.id}</strong><div className="subtle-line">{unit.label || unit.id}</div></div>,
    <Chip color={unitCategoryTone(unit.category)}>{unitCategoryLabel(unit.category)}</Chip>,
    <select aria-label={`Category for ${unit.label || unit.id}`} value={normalizeUnitCategory(unit.category)} onChange={(event) => onToggleUnitCategorySelection?.(unit.id, event.target.value)}>
      {UNIT_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>,
  ]), [filteredConfiguredUnits, selectedUnitCategoryIds, UNIT_CATEGORY_OPTIONS, normalizeUnitCategory, unitCategoryLabel, unitCategoryTone, onToggleUnitCategorySelection]);

  const routeLocationName = (id) => astroLocations.find((location) => location.id === id)?.name || id || '-';
  const routeAccountCount = new Set(astroRoutes.map((route) => route.accountId || 'primary')).size;

  return (
    <div className="settings-stack" ref={panelRef}>
      <SectionCard
        title="Solofleet multi-account"
        description="Login Solofleet dipisah dari login web. Semua linked account diatur dari sini."
        actions={<Button color="primary" onPress={() => onSaveConfig?.(false)}>Save config</Button>}
      >
        <div className="settings-stack">
          <label className="field">
            <span>Active Solofleet account</span>
            <select value={activeAccountId || ''} onChange={(event) => onSwitchAccount?.(event.target.value)}>
              {availableAccounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
            </select>
          </label>
          <div className="account-config-list">
            {availableAccounts.map((account) => (
              <div key={account.id} className={`account-config-item ${activeAccountId === account.id ? 'account-config-item-active' : ''}`.trim()}>
                <div>
                  <strong>{accountLabel(account)}</strong>
                  <div className="subtle-line">{account.authEmail || 'No email saved'} | {sessionLine(account)}</div>
                  <div className="subtle-line">{account.units?.length || 0} unit configured</div>
                </div>
                <div className="inline-buttons">
                  <Button variant="bordered" onPress={() => onSwitchAccount?.(account.id)}>Use</Button>
                  <Button variant="bordered" onPress={() => onDiscoverUnits?.(account.id)}>Discover units</Button>
                  {account.id !== 'primary' ? <Button variant="light" onPress={() => onLogoutAccount?.(account.id)}>Remove</Button> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Unit category mapping"
        description="Set kategori unit untuk account aktif. Unit baru hasil discover default ke Uncategorized sampai dimapping manual."
        open={unitCategorySectionOpen}
        setOpen={setUnitCategorySectionOpen}
        actions={<><Button variant="bordered" onPress={onSelectVisibleUnits}>Select visible</Button><Button variant="bordered" onPress={onClearUnitSelection}>Clear selected</Button><Button color="primary" onPress={() => onSaveConfig?.(false)}>Save categories</Button></>}
      >
        <div className="settings-stack">
          <div className="subtle-line">Account aktif: <strong>{accountName ? accountName(currentAccount) : accountLabel(currentAccount)}</strong> | {configuredUnits.length} configured unit</div>
          <SearchInput label="Search configured units" value={unitCategorySearch} onChange={setUnitCategorySearch} placeholder="Cari unit id, label, atau category..." />
          <div className="inline-buttons" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
            <label className="field fleet-filter-field" style={{ minWidth: 220 }}>
              <span>Bulk set category</span>
              <select value={unitCategoryBulkValue || ''} onChange={(event) => setUnitCategoryBulkValue?.(event.target.value)}>
                {UNIT_CATEGORY_OPTIONS.map((option) => <option key={`bulk-${option.value}`} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <Button variant="bordered" onPress={onApplyBulkCategory}>Apply to selected ({selectedUnitCategoryIds.length})</Button>
          </div>
          <DataTable pagination={{ initialRowsPerPage: 10, rowsPerPageOptions: [10, 20, 50] }} columns={['Select', 'Unit ID', 'Current', 'Set category']} emptyMessage="Belum ada unit dikonfigurasi di account aktif. Klik Discover units dulu." rows={unitRows} />
          <div className="astro-sample-block">
            <div className="astro-sample-head"><strong>CSV bulk update</strong><div className="inline-buttons astro-sample-actions"><Button variant="bordered" onPress={() => setUnitCategoryCsvText?.(['label,category', 'B 9478 SXW,dedicated-astro', 'B 9769 SXW,oncall'].join('\n'))}>Use sample</Button><Button variant="bordered" onPress={onDownloadUnitCategoryTemplate}>Download template</Button></div></div>
            <pre className="astro-sample-pre">{'Recommended header:\nlabel,category\nB 9478 SXW,dedicated-astro\nB 9769 SXW,oncall\n\nTemplate download columns:\nlabel,unitId,category\n\nAlso supported:\nunitId,category\naccountId,label,category\naccountId,unitId,category\naccountId,unitId,label,category'}</pre>
          </div>
          <label className="field"><span>Bulk category CSV</span><textarea rows="6" value={unitCategoryCsvText || ''} onChange={(event) => setUnitCategoryCsvText?.(event.target.value)} placeholder="label,category" /></label>
          <div className="inline-buttons"><input type="file" accept=".csv,text/csv" aria-label="Upload unit category CSV" onChange={onLoadUnitCategoryCsvFile} /><Button variant="bordered" onPress={onImportUnitCategoryCsv}>Import CSV merge</Button></div>
          <div className="subtle-line">CSV category bisa pakai label / nopol atau unitId. Kategori tersimpan per account dan per unit.</div>
        </div>
      </SectionCard>

      <SectionCard
        title="Add / refresh linked account"
        description="Gunakan form ini untuk menambahkan account baru atau memperbarui sesi Solofleet yang sudah ada."
        open={linkedAccountSectionOpen}
        setOpen={setLinkedAccountSectionOpen}
        actions={<Button color="primary" onPress={onLoginLinkedAccount}>Add linked account</Button>}
      >
        <div className="form-grid account-login-grid">
          <label className="field"><span>Label</span><input type="text" value={accountLoginForm.label || ''} onChange={(event) => setAccountLoginForm?.((current) => ({ ...current, label: event.target.value }))} placeholder="Vendor / Client A" /></label>
          <label className="field"><span>Email</span><input type="email" value={accountLoginForm.email || ''} onChange={(event) => setAccountLoginForm?.((current) => ({ ...current, email: event.target.value }))} placeholder="nama@company.com" /></label>
          <label className="field"><span>Password</span><input type="password" value={accountLoginForm.password || ''} onChange={(event) => setAccountLoginForm?.((current) => ({ ...current, password: event.target.value }))} placeholder="Password Solofleet" /></label>
          <label className="field checkbox-field"><input type="checkbox" checked={Boolean(accountLoginForm.rememberMe)} onChange={(event) => setAccountLoginForm?.((current) => ({ ...current, rememberMe: event.target.checked }))} /><span>Remember me</span></label>
        </div>
      </SectionCard>

      <SectionCard
        title="TMS integration"
        description="Login akun TMS read-only untuk fetch JO aktif dan membangun Trip Monitor kanban."
        open={tmsConfigSectionOpen}
        setOpen={setTmsConfigSectionOpen}
        actions={<><Button variant="bordered" onPress={() => onLoadTmsLogs?.(false)}>{tmsLogsBusy ? <><Spinner size="sm" /> Logs</> : 'Refresh logs'}</Button><Button variant="bordered" onPress={onLogoutTms}>Logout TMS</Button><Button variant="bordered" onPress={onLoginTms}>Connect TMS</Button><Button color="primary" onPress={onSaveTmsConfig}>Save TMS config</Button></>}
      >
        <div className="settings-stack">
          <div className="subtle-line">{tmsConfig?.hasVerifiedSession ? 'Session verified' : tmsConfig?.hasSessionCookie ? 'Session ada tapi belum diverifikasi' : 'Belum ada session TMS'} | Cookie preview: {tmsConfig?.sessionCookiePreview || '-'} | Last sync: {tmsLogs[0]?.createdAt ? fmtDate(tmsLogs[0].createdAt) : 'Belum ada'}</div>
          <div className="form-grid astro-config-grid">
            <label className="field"><span>Tenant label</span><input type="text" value={tmsForm.tenantLabel || ''} onChange={(event) => setTmsForm?.((current) => ({ ...current, tenantLabel: event.target.value }))} placeholder="CargoShare TMS" /></label>
            <label className="field"><span>Base URL</span><input type="text" value={tmsForm.baseUrl || ''} onChange={(event) => setTmsForm?.((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://1903202401.cargoshare.id" /></label>
            <label className="field"><span>Username</span><input type="text" value={tmsForm.username || ''} onChange={(event) => setTmsForm?.((current) => ({ ...current, username: event.target.value }))} placeholder="TMS username" /></label>
            <label className="field"><span>Password</span><input type="password" value={tmsForm.password || ''} onChange={(event) => setTmsForm?.((current) => ({ ...current, password: event.target.value }))} placeholder={tmsConfig?.hasPassword ? 'Kosongkan untuk pakai password tersimpan' : 'TMS password'} /></label>
            <label className="field checkbox-field"><input type="checkbox" checked={Boolean(tmsForm.autoSync)} onChange={(event) => setTmsForm?.((current) => ({ ...current, autoSync: event.target.checked }))} /><span>Auto sync</span></label>
            {['syncIntervalMinutes', 'geofenceRadiusMeters', 'longStopMinutes', 'appStagnantMinutes'].map((key) => <label key={key} className="field"><span>{key === 'syncIntervalMinutes' ? 'Sync interval (min)' : key === 'geofenceRadiusMeters' ? 'Geofence radius (m)' : key === 'longStopMinutes' ? 'Long stop (min)' : 'App stagnant (min)'}</span><input type="number" min="5" value={tmsForm[key] || ''} onChange={(event) => setTmsForm?.((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
          </div>
          <div className="inline-buttons"><Button variant="bordered" onPress={onTriggerTmsSync}>Sync now</Button><Button variant="bordered" onPress={onOpenTripMonitor}>Open Trip Monitor</Button></div>
          <DataTable pagination={{ initialRowsPerPage: 5, rowsPerPageOptions: [5, 10, 20] }} columns={['Time', 'Status', 'Summary']} emptyMessage="Belum ada log sync TMS." rows={tmsLogs.map((log) => [fmtDate(log.createdAt), <Chip color={log.status === 'success' ? 'success' : log.status === 'error' ? 'danger' : 'default'}>{log.status || 'info'}</Chip>, <div><div>{log.summary || '-'}</div><div className="subtle-line">{log.message || '-'}</div></div>])} />
        </div>
      </SectionCard>

      <SectionCard
        title="Automated remote CPU reset"
        description="Kirim cpureset otomatis setiap 3 jam untuk unit live temp error, hanya pada account yang dipilih."
        open={remoteResetSectionOpen}
        setOpen={setRemoteResetSectionOpen}
        actions={<><Button variant="bordered" onPress={() => onLoadRemoteResetLogs?.(false)}>Refresh logs</Button><Button variant="bordered" onPress={onRunRemoteResetNow} disabled={!remoteResetForm.enabled}>Run reset now</Button><Button color="primary" onPress={() => onSaveConfig?.(false)}>Save reset settings</Button></>}
      >
        <div className="settings-stack">
          <label className="field checkbox-field"><input type="checkbox" checked={Boolean(remoteResetForm.enabled)} onChange={(event) => setRemoteResetForm?.((current) => ({ ...current, enabled: event.target.checked }))} /><span>Enable automated CPU reset</span></label>
          <div className="metric-strip admin-storage-strip"><div className="mini-metric"><span>Interval</span><strong>3 jam</strong></div><div className="mini-metric"><span>Target</span><strong>Temp error only</strong></div><div className="mini-metric"><span>Max / run</span><strong>10 unit</strong></div><div className="mini-metric"><span>Next run</span><strong>{fmtDate(remoteResetStatus?.nextRunAt) || '-'}</strong></div><div className="mini-metric"><span>Last run</span><strong>{fmtDate(remoteResetStatus?.lastRunAt) || '-'}</strong></div><div className="mini-metric"><span>Selected</span><strong>{(remoteResetForm.selectedAccountIds || []).length}</strong></div></div>
          <div className="settings-stack"><strong>Selected accounts</strong><div className="account-config-list">{availableAccounts.map((account) => { const checked = (remoteResetForm.selectedAccountIds || []).includes(account.id); return <div key={`remote-reset-${account.id}`} className={`account-config-item ${checked ? 'account-config-item-active' : ''}`.trim()}><div><strong>{accountLabel(account)}</strong><div className="subtle-line">{account.authEmail || 'No email saved'} | {sessionLine(account)}</div><div className="subtle-line">{account.units?.length || 0} unit configured</div></div><label className="checkbox-field"><input type="checkbox" checked={checked} onChange={() => onToggleRemoteResetAccount?.(account.id)} /><span>Use</span></label></div>; })}</div></div>
          <div className="subtle-line">Last summary: {remoteResetStatus?.lastRunMessage || 'Belum ada run remote reset.'}</div>
          <DataTable columns={['Time', 'Account', 'Unit', 'Error', 'Status', 'HTTP', 'Reason']} pagination={{ initialRowsPerPage: 5, rowsPerPageOptions: [5, 10, 20] }} emptyMessage="Belum ada remote reset log." rows={remoteResetLogs.map((row) => [fmtDate(row.triggeredAt), row.accountLabel || row.accountId || '-', <div><strong>{row.unitLabel || row.unitId || '-'}</strong><div className="subtle-line">{row.unitId || '-'}</div></div>, row.errorType || '-', row.status || '-', row.httpStatus ?? '-', row.reason || row.responseExcerpt || '-'])} />
        </div>
      </SectionCard>

      <SectionCard
        cardRef={astroLocationCardRef}
        title="Geofence locations"
        description="Kelola lokasi umum untuk Fleet Live dan Historical, termasuk WH, POD, POOL, POL, REST, dan PELABUHAN."
        open={astroLocationSectionOpen}
        setOpen={setAstroLocationSectionOpen}
        actions={<Button color="primary" onPress={onSaveAstroLocation}>{astroLocationForm.id ? 'Update geofence' : 'Save geofence'}</Button>}
      >
        <div className="settings-stack">
          <div className="form-grid astro-config-grid">
            <label className="field"><span>Location name</span><input type="text" value={astroLocationForm.name || ''} onChange={(event) => setAstroLocationForm?.((current) => ({ ...current, name: event.target.value }))} placeholder="Astro WH CBN" /></label>
            <label className="field"><span>Latitude</span><input type="number" step="any" value={astroLocationForm.latitude || ''} onChange={(event) => setAstroLocationForm?.((current) => ({ ...current, latitude: event.target.value }))} placeholder="-6.2" /></label>
            <label className="field"><span>Longitude</span><input type="number" step="any" value={astroLocationForm.longitude || ''} onChange={(event) => setAstroLocationForm?.((current) => ({ ...current, longitude: event.target.value }))} placeholder="106.8" /></label>
            <label className="field"><span>Radius (m)</span><input type="number" min="20" value={astroLocationForm.radiusMeters || ''} onChange={(event) => setAstroLocationForm?.((current) => ({ ...current, radiusMeters: event.target.value }))} /></label>
            <label className="field"><span>Type</span><select value={astroLocationForm.type || ''} onChange={(event) => setAstroLocationForm?.((current) => ({ ...current, type: event.target.value }))}>{GEOFENCE_LOCATION_TYPES.map((type) => <option key={type} value={type}>{GEOFENCE_LOCATION_LABELS[type] || type}</option>)}</select></label>
            <label className="field"><span>Scope</span><select value={astroLocationForm.scopeMode || 'global'} onChange={(event) => setAstroLocationForm?.((current) => ({ ...current, scopeMode: event.target.value }))}><option value="global">Global</option><option value="account">By account</option><option value="customer">By customer</option><option value="hybrid">Account + customer</option></select></label>
            <label className="field checkbox-field"><input type="checkbox" checked={astroLocationForm.isActive !== false} onChange={(event) => setAstroLocationForm?.((current) => ({ ...current, isActive: event.target.checked }))} /><span>Active</span></label>
          </div>
          <div className="form-grid astro-config-grid"><label className="field"><span>Account scope</span><input type="text" value={astroLocationForm.scopeAccountIds || ''} onChange={(event) => setAstroLocationForm?.((current) => ({ ...current, scopeAccountIds: event.target.value }))} placeholder="primary, vendor-mti" /></label><label className="field"><span>Customer scope</span><input type="text" value={astroLocationForm.scopeCustomerNames || ''} onChange={(event) => setAstroLocationForm?.((current) => ({ ...current, scopeCustomerNames: event.target.value }))} placeholder="Astro, Starbucks" /></label></div>
          <label className="field"><span>Notes</span><input type="text" value={astroLocationForm.notes || ''} onChange={(event) => setAstroLocationForm?.((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional note" /></label>
          <div className="inline-buttons"><Button variant="bordered" onPress={() => setAstroLocationForm?.(EMPTY_ASTRO_LOCATION_FORM)}>Reset form</Button></div>
          <div className="astro-sample-block"><div className="astro-sample-head"><strong>CSV sample</strong><div className="inline-buttons astro-sample-actions"><a className="sf-btn sf-btn-bordered" href="/astro-location-sample.csv" download>Download sample CSV</a><Button variant="bordered" onPress={() => setAstroCsvText?.(ASTRO_LOCATION_SAMPLE_CSV)}>Use sample</Button></div></div><pre className="astro-sample-pre">{ASTRO_LOCATION_SAMPLE_CSV}</pre></div>
          <label className="field"><span>Bulk CSV import</span><textarea rows="5" value={astroCsvText || ''} onChange={(event) => setAstroCsvText?.(event.target.value)} placeholder="Nama Tempat, Latitude, Longitude, Radius, Type, Scope Mode, Account Scope, Customer Scope" /></label>
          <div className="inline-buttons"><input type="file" accept=".csv,text/csv" aria-label="Upload location CSV" onChange={onLoadAstroCsvFile} /><Button variant="bordered" onPress={() => onImportAstroLocations?.(false)}>Import merge</Button><Button variant="light" onPress={() => onImportAstroLocations?.(true)}>Replace all</Button></div>
          <SearchInput label="Search saved locations" value={astroLocationSearch} onChange={setAstroLocationSearch} placeholder="Cari nama lokasi, type, scope, note..." />
          {astroFilteredLocationGroups.length ? <div className="astro-group-stack"><div className="astro-group-summary"><Chip>{astroLocations.length} lokasi</Chip>{GEOFENCE_LOCATION_TYPES.map((type) => <Chip key={type} color={type === 'WH' ? 'default' : type === 'POD' ? 'warning' : 'default'}>{type} {geofenceLocationCounts[type] || 0}</Chip>)}</div><div className="inline-buttons astro-bulk-actions"><Button variant="bordered" onPress={onSelectVisibleAstroLocations} disabled={!astroFilteredLocationGroups.length}>Select visible</Button><Button variant="bordered" onPress={onClearAstroLocationSelection} disabled={!selectedAstroLocationIds.length}>Clear selected</Button><Button variant="light" onPress={() => onDeleteAstroLocations?.(selectedAstroLocationIds)} disabled={!selectedAstroLocationIds.length}>Delete selected ({selectedAstroLocationIds.length})</Button></div>{astroFilteredLocationGroups.map((group) => { const expanded = astroLocationExpanded[group.key] === true; const visibleItems = expanded ? group.items : group.items.slice(0, ASTRO_GROUP_PREVIEW_LIMIT); return <div key={group.key} className="astro-group-card"><div className="astro-group-card-head"><div><strong>{group.title}</strong><span>{group.items.length} lokasi</span></div>{group.items.length > ASTRO_GROUP_PREVIEW_LIMIT ? <Button variant="bordered" onPress={() => setAstroLocationExpanded?.((current) => ({ ...current, [group.key]: !expanded }))}>{expanded ? 'Show less' : `Show all (${group.items.length})`}</Button> : null}</div><div className="astro-card-grid">{visibleItems.map((location) => <div key={location.id} className="astro-entity-card"><div className="astro-entity-card-head"><label className="astro-card-select"><input type="checkbox" aria-label={`Select ${location.name}`} checked={selectedAstroLocationIds.includes(location.id)} onChange={() => onToggleAstroLocationSelection?.(location.id)} /></label><div><strong>{location.name}</strong><span>{location.type} | {location.radiusMeters} m | {location.scopeMode || 'global'}</span></div><Chip color={location.isActive !== false ? 'success' : 'default'}>{location.isActive !== false ? 'Active' : 'Inactive'}</Chip></div><div className="astro-entity-card-body"><span>Lat {formatCoord(location.latitude)}</span><span>Lng {formatCoord(location.longitude)}</span></div><p className={location.notes ? 'astro-entity-note' : 'astro-entity-note astro-entity-note-muted'}>{location.notes || 'No note'}</p><p className="astro-entity-note astro-entity-note-muted">{(location.scopeAccountIds || []).length ? `Account: ${(location.scopeAccountIds || []).join(', ')}` : 'Account: all'} | {(location.scopeCustomerNames || []).length ? `Customer: ${(location.scopeCustomerNames || []).join(', ')}` : 'Customer: all'}</p><div className="inline-buttons astro-entity-actions"><Button variant="bordered" onPress={() => onEditAstroLocation?.(location)}><Edit3 size={14} /> Edit</Button><Button variant="light" onPress={() => onDeleteAstroLocation?.(location.id)}><Trash2 size={14} /> Delete</Button></div></div>)}</div></div>; })}</div> : <div className="empty-state">Belum ada geofence location yang cocok dengan pencarian.</div>}
        </div>
      </SectionCard>

      <SectionCard
        cardRef={astroRouteCardRef}
        title="Astro route config"
        description="Atur mapping unit Astro ke WH, POOL, urutan POD, window rit, dan KPI. WH temp min/max SLA wajib diisi."
        open={astroRouteSectionOpen}
        setOpen={setAstroRouteSectionOpen}
        actions={<Button color="primary" onPress={onSaveAstroRoute}>{astroRouteForm.id ? 'Update route' : 'Save route'}</Button>}
      >
        <div className="settings-stack">
          <div className="astro-route-form-section"><div className="astro-route-form-section-label">Route identity</div><div className="form-grid astro-config-grid"><SelectFallback label="Account" value={astroRouteForm.accountId} options={astroRouteAccountOptions} onChange={(nextValue) => setAstroRouteForm?.((current) => ({ ...current, accountId: nextValue || current.accountId, unitId: '' }))} placeholder="Search account..." /><SelectFallback label="Nopol" value={astroRouteForm.unitId} options={[{ value: '', label: 'Select unit' }, ...astroRouteFilteredUnitOptions]} onChange={(nextValue) => setAstroRouteForm?.((current) => ({ ...current, unitId: nextValue }))} placeholder="Search unit..." /><label className="field"><span>Customer</span><input type="text" value={astroRouteForm.customerName || ''} onChange={(event) => setAstroRouteForm?.((current) => ({ ...current, customerName: event.target.value }))} placeholder="Astro" /></label><SelectFallback label="WH" value={astroRouteForm.whLocationId} options={[{ value: '', label: 'Select WH' }, ...astroWhOptions]} onChange={(nextValue) => setAstroRouteForm?.((current) => ({ ...current, whLocationId: nextValue }))} placeholder="Search WH..." /><SelectFallback label="POOL" value={astroRouteForm.poolLocationId} options={astroPoolOptions} onChange={(nextValue) => setAstroRouteForm?.((current) => ({ ...current, poolLocationId: nextValue }))} placeholder="Search pool..." /><label className="field checkbox-field"><input type="checkbox" checked={astroRouteForm.isActive !== false} onChange={(event) => setAstroRouteForm?.((current) => ({ ...current, isActive: event.target.checked }))} /><span>Active</span></label></div></div>
          <div className="astro-route-form-section"><div className="astro-route-form-section-label">Rit 1 schedule &amp; SLA</div><div className="form-grid astro-config-grid"><label className="field"><span>Rit 1 start</span><input type="time" value={astroRouteForm.rit1Start || ''} onChange={(event) => setAstroRouteForm?.((current) => ({ ...current, rit1Start: event.target.value }))} /></label><label className="field"><span>Rit 1 end</span><input type="time" value={astroRouteForm.rit1End || ''} onChange={(event) => setAstroRouteForm?.((current) => ({ ...current, rit1End: event.target.value }))} /></label><label className="field"><span>Rit 1 WH SLA</span><input type="time" value={astroRouteForm.rit1WhArrivalTimeSla || ''} onChange={(event) => setAstroRouteForm?.((current) => ({ ...current, rit1WhArrivalTimeSla: event.target.value }))} /></label></div></div>
          <div className="astro-route-form-section"><div className="astro-route-form-section-label">Rit 2 schedule &amp; temp SLA</div><div className="form-grid astro-config-grid"><label className="field checkbox-field"><input type="checkbox" checked={Boolean(astroRouteForm.rit2Enabled)} onChange={(event) => setAstroRouteForm?.((current) => ({ ...current, rit2Enabled: event.target.checked }))} /><span>Enable rit 2</span></label><label className="field"><span>Rit 2 start</span><input type="time" value={astroRouteForm.rit2Start || ''} onChange={(event) => setAstroRouteForm?.((current) => ({ ...current, rit2Start: event.target.value }))} disabled={!astroRouteForm.rit2Enabled} /></label><label className="field"><span>Rit 2 end</span><input type="time" value={astroRouteForm.rit2End || ''} onChange={(event) => setAstroRouteForm?.((current) => ({ ...current, rit2End: event.target.value }))} disabled={!astroRouteForm.rit2Enabled} /></label><label className="field"><span>Rit 2 WH SLA</span><input type="time" value={astroRouteForm.rit2WhArrivalTimeSla || ''} onChange={(event) => setAstroRouteForm?.((current) => ({ ...current, rit2WhArrivalTimeSla: event.target.value }))} disabled={!astroRouteForm.rit2Enabled} /></label><label className="field"><span>WH temp min SLA *</span><input type="number" step="0.1" value={astroRouteForm.whArrivalTempMinSla || ''} onChange={(event) => setAstroRouteForm?.((current) => ({ ...current, whArrivalTempMinSla: event.target.value }))} required /></label><label className="field"><span>WH temp max SLA *</span><input type="number" step="0.1" value={astroRouteForm.whArrivalTempMaxSla || ''} onChange={(event) => setAstroRouteForm?.((current) => ({ ...current, whArrivalTempMaxSla: event.target.value }))} required /></label></div></div>
          <div className="astro-pod-list"><div className="astro-pod-list-head"><strong>POD sequence &amp; KPI</strong><div className="inline-buttons astro-sample-actions"><span className="subtle-line">Max {ASTRO_ROUTE_MAX_PODS} POD per rit</span><Button variant="bordered" onPress={onAddAstroRoutePod} disabled={(astroRouteForm.podSequence || []).length >= ASTRO_ROUTE_MAX_PODS}><Plus size={14} /> Add POD</Button></div></div>{(astroRouteForm.podSequence || ['']).map((podId, index) => <div key={index} className="astro-pod-row astro-pod-row-kpi"><div className="astro-pod-field astro-pod-field-main"><SelectFallback label={`POD ${index + 1}`} value={podId} options={astroPodOptions} onChange={(nextValue) => onUpdateAstroRoutePod?.(index, nextValue)} placeholder={`Search POD ${index + 1}...`} /></div><label className="field astro-pod-kpi-field"><span>Rit 1 POD SLA</span><input type="time" value={astroRouteForm.rit1PodArrivalTimeSlas?.[index] || ''} onChange={(event) => onUpdateAstroRoutePodSla?.('rit1', index, event.target.value)} /></label><label className="field astro-pod-kpi-field"><span>Rit 2 POD SLA</span><input type="time" value={astroRouteForm.rit2PodArrivalTimeSlas?.[index] || ''} onChange={(event) => onUpdateAstroRoutePodSla?.('rit2', index, event.target.value)} disabled={!astroRouteForm.rit2Enabled} /></label><Button variant="light" onPress={() => onRemoveAstroRoutePod?.(index)} disabled={(astroRouteForm.podSequence || []).length <= 1}>Remove</Button></div>)}</div>
          <label className="field"><span>Notes</span><input type="text" value={astroRouteForm.notes || ''} onChange={(event) => setAstroRouteForm?.((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional note" /></label>
          <div className="inline-buttons"><Button variant="bordered" onPress={() => setAstroRouteForm?.((current) => ({ ...EMPTY_ASTRO_ROUTE_FORM, accountId: current.accountId || 'primary', podSequence: [''], rit1PodArrivalTimeSlas: createBlankAstroPodSlaArray(1), rit2PodArrivalTimeSlas: createBlankAstroPodSlaArray(1) }))}>Reset route form</Button></div>
          <div className="astro-sample-block"><div className="astro-sample-head"><strong>Route CSV sample</strong><div className="inline-buttons astro-sample-actions"><a className="sf-btn sf-btn-bordered" href="/astro-route-sample.csv" download>Download route sample</a><Button variant="bordered" onPress={() => setAstroRouteCsvText?.(ASTRO_ROUTE_SAMPLE_CSV)}>Use sample</Button></div></div><pre className="astro-sample-pre">{ASTRO_ROUTE_SAMPLE_CSV}</pre></div>
          <label className="field"><span>Bulk route CSV import</span><textarea rows="6" value={astroRouteCsvText || ''} onChange={(event) => setAstroRouteCsvText?.(event.target.value)} placeholder="Account ID, Nopol, Customer, WH, POOL, POD1..POD5, SLA fields, Active, Notes" /></label>
          <div className="inline-buttons"><input type="file" accept=".csv,text/csv" aria-label="Upload route CSV" onChange={onLoadAstroRouteCsvFile} /><Button variant="bordered" onPress={() => onImportAstroRoutes?.(false)}>Import route merge</Button><Button variant="light" onPress={() => onImportAstroRoutes?.(true)}>Replace all routes</Button></div>
          <div className="subtle-line">Bulk route CSV fleksibel: SLA time boleh kosong, tapi WH temp min/max SLA wajib diisi.</div>
          <SearchInput label="Search saved routes" value={astroRouteSearch} onChange={setAstroRouteSearch} placeholder="Cari nopol, WH, POD, customer..." />
          {astroFilteredRouteGroups.length ? <div className="astro-group-stack"><div className="astro-group-summary"><Chip>{astroRoutes.length} route</Chip><Chip>Account {routeAccountCount}</Chip><Chip color="warning">Max POD {ASTRO_ROUTE_MAX_PODS}</Chip></div><div className="inline-buttons astro-bulk-actions"><Button variant="bordered" onPress={onSelectVisibleAstroRoutes} disabled={!astroFilteredRouteGroups.length}>Select visible</Button><Button variant="bordered" onPress={onClearAstroRouteSelection} disabled={!selectedAstroRouteIds.length}>Clear selected</Button><Button variant="light" onPress={() => onDeleteAstroRoutes?.(selectedAstroRouteIds)} disabled={!selectedAstroRouteIds.length}>Delete selected ({selectedAstroRouteIds.length})</Button></div>{astroFilteredRouteGroups.map((group) => { const expanded = astroRouteExpanded[group.key] === true; const visibleItems = expanded ? group.items : group.items.slice(0, ASTRO_GROUP_PREVIEW_LIMIT); return <div key={group.key} className="astro-group-card"><div className="astro-group-card-head"><div><strong>{group.title}</strong><span>{group.items.length} route</span></div>{group.items.length > ASTRO_GROUP_PREVIEW_LIMIT ? <Button variant="bordered" onPress={() => setAstroRouteExpanded?.((current) => ({ ...current, [group.key]: !expanded }))}>{expanded ? 'Show less' : `Show all (${group.items.length})`}</Button> : null}</div><div className="astro-card-grid astro-card-grid-routes">{visibleItems.map((route) => <div key={route.id} className="astro-entity-card astro-route-card"><div className="astro-entity-card-head"><label className="astro-card-select"><input type="checkbox" aria-label={`Select ${route.unitId}`} checked={selectedAstroRouteIds.includes(route.id)} onChange={() => onToggleAstroRouteSelection?.(route.id)} /></label><div><strong>{astroUnitLabelByKey?.get?.(`${route.accountId || 'primary'}::${route.unitId}`) || route.unitId}</strong><span>{route.customerName || 'Astro'} | {route.unitId}</span></div><Chip color={route.isActive !== false ? 'success' : 'default'}>{route.isActive !== false ? 'Active' : 'Inactive'}</Chip></div><div className="astro-route-meta"><span><strong>WH</strong>{routeLocationName(route.whLocationId)}</span><span><strong>POOL</strong>{routeLocationName(route.poolLocationId)}</span><span><strong>POD</strong>{(route.podSequence || []).map(routeLocationName).join(' -> ') || '-'}</span><span><strong>Rit 1</strong>{route.rit1 ? `${route.rit1.start} to ${route.rit1.end}` : '-'}</span><span><strong>Rit 1 KPI</strong>{route.rit1?.whArrivalTimeSla || 'No WH SLA'} | POD {(route.rit1?.podArrivalTimeSlas || []).filter(Boolean).length || 0}</span><span><strong>Rit 2</strong>{route.rit2 ? `${route.rit2.start} to ${route.rit2.end}` : 'Rit 1 only'}</span><span><strong>Rit 2 KPI</strong>{route.rit2?.whArrivalTimeSla || 'No WH SLA'} | POD {(route.rit2?.podArrivalTimeSlas || []).filter(Boolean).length || 0}</span><span><strong>WH temp KPI</strong>{route.whArrivalTempMinSla || route.whArrivalTempMaxSla ? `${route.whArrivalTempMinSla ?? '-'} to ${route.whArrivalTempMaxSla ?? '-'}` : 'No range'}</span></div><div className="inline-buttons astro-entity-actions"><Button variant="bordered" onPress={() => onEditAstroRoute?.(route)}><Edit3 size={14} /> Edit</Button><Button variant="light" onPress={() => onDeleteAstroRoute?.(route.id)}><Trash2 size={14} /> Delete</Button></div></div>)}</div></div>; })}</div> : <div className="empty-state">Belum ada Astro route yang cocok dengan pencarian.</div>}
        </div>
      </SectionCard>

      <SectionCard
        title="Astro Snapshot Console"
        description="Kelola snapshot KPI Astro ke PostgreSQL. Auto-sync berjalan setiap 3 jam saat polling aktif."
        open={astroSnapshotConsoleSectionOpen}
        setOpen={(updater) => setAstroSnapshotConsoleSectionOpen?.((current) => { const next = typeof updater === 'function' ? updater(current) : updater; if (next) onLoadAstroSnapshotLogs?.(true); return next; })}
        icon={RefreshCw}
        actions={<><Button variant="bordered" onPress={() => onLoadAstroSnapshotLogs?.(false)}><RefreshCw size={14} /> Refresh Logs</Button><Button color="primary" onPress={onTriggerAstroSnapshotSync}><Zap size={14} /> Sync Now</Button></>}
      >
        <div className="settings-stack">
          <div className="metric-strip admin-storage-strip"><div className="mini-metric"><span>Auto-sync</span><strong style={{ color: astroSnapshotAutoSync?.isPolling ? 'var(--success, #34d399)' : 'var(--text-muted)' }}>{astroSnapshotAutoSync?.isPolling ? 'Active' : 'Inactive'}</strong></div><div className="mini-metric"><span>Interval</span><strong>{astroSnapshotAutoSync?.intervalHours || 3} jam</strong></div><div className="mini-metric"><span>Last sync</span><strong>{astroSnapshotAutoSync?.lastSyncAt ? fmtDate(astroSnapshotAutoSync.lastSyncAt) : 'Belum pernah'}</strong></div><div className="mini-metric"><span>Log entries</span><strong>{fmtNum(astroSnapshotLogs.length)}</strong></div></div>
          {astroSnapshotLogsBusy ? <div className="overview-chart-empty">Memuat log...</div> : <DataTable pagination={{ initialRowsPerPage: 10, rowsPerPageOptions: [10, 20, 50] }} columns={['Waktu', 'Range', 'Units', 'Eligible', 'Rows', 'Status', 'Message']} emptyMessage="Belum ada snapshot log. Klik Sync Now untuk menjalankan snapshot pertama." rows={astroSnapshotLogs.map((log) => [fmtDate(log.timestamp), log.startDate && log.endDate ? `${log.startDate} -> ${log.endDate}` : '-', log.unitCount ?? '-', log.eligibleUnitCount ?? '-', log.rowCount ?? '-', <Chip color={log.result === 'success' ? 'success' : log.result === 'error' ? 'danger' : 'warning'}>{log.result || '-'}</Chip>, <div style={{ display: 'grid', gap: 6 }}><div>{log.message || '-'}</div>{Array.isArray(log.dayBreakdown) && log.dayBreakdown.length ? <div style={{ display: 'grid', gap: 4, fontSize: '0.8rem', color: 'var(--text-muted)' }}>{log.dayBreakdown.map((entry) => { const podParts = Array.isArray(entry.podCaptured) ? entry.podCaptured.map((count, index) => (count ? `POD${index + 1} ${count}` : '')).filter(Boolean) : []; return <div key={`${log.timestamp}-${entry.day}`}><strong style={{ color: 'var(--text-main)' }}>{entry.day}</strong>{` | active ${entry.activeRows || 0} | eligible ${entry.eligibleRows || 0} | WH ${entry.whCaptured || 0}`}{podParts.length ? ` | ${podParts.join(' | ')}` : ''}{entry.requestErrorRows ? ` | error ${entry.requestErrorRows}` : ''}</div>; })}</div> : null}</div>])} />}
        </div>
      </SectionCard>
    </div>
  );
}
