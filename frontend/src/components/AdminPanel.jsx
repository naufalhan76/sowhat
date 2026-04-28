import React, { useState, useEffect, useMemo } from 'react';
import { Database, Edit3, Plus, Shield, Trash2, Users } from 'lucide-react';

const ROW_OPTIONS = [10, 20, 50];
const ICON_SIZE = 15;

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function displayValue(value, fallback = '-') {
  return value === undefined || value === null || value === '' ? fallback : value;
}

function numericStyle() {
  return { fontFeatureSettings: "'tnum'" };
}

function ActionButton({ children, variant = 'secondary', icon: Icon, className = '', ...props }) {
  return (
    <button type="button" className={`action action-sm action-${variant}${className ? ` ${className}` : ''}`} {...props}>
      {Icon ? <Icon size={ICON_SIZE} strokeWidth={1.75} aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

function Surface({ title, description, icon: Icon, actions, children }) {
  return (
    <section className="surface">
      <div className="surface-head">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
          {Icon ? <Icon size={18} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--primary)', marginTop: 2, flex: '0 0 auto' }} /> : null}
          <div style={{ minWidth: 0 }}>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="inline-buttons">{actions}</div> : null}
      </div>
      <div className="surface-body surface-body-padded">{children}</div>
    </section>
  );
}

function Pagination({ page, totalPages, rowsPerPage, rowsPerPageOptions, onPageChange, onRowsPerPageChange }) {
  return (
    <div className="table-pagination">
      <div className="table-pagination-meta">
        <span>Rows per page</span>
        <select
          aria-label="Rows per page"
          value={rowsPerPage}
          onChange={(event) => onRowsPerPageChange(Number(event.target.value || 10))}
        >
          {rowsPerPageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
      <div className="table-pagination-meta" style={numericStyle()}>Page {page} of {totalPages}</div>
      <div className="table-pagination-controls">
        <button type="button" className="table-page-button" aria-label="Previous page" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>Prev</button>
        <button type="button" className="table-page-button" aria-label="Next page" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>Next</button>
      </div>
    </div>
  );
}

function DataTable({ columns, rows, emptyMessage, tableKey }) {
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [tableKey, rows.length, rowsPerPage]);

  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const visibleRows = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return rows.slice(start, start + rowsPerPage);
  }, [page, rows, rowsPerPage]);

  if (!rows.length) return <div className="empty-state">{emptyMessage}</div>;

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {visibleRows.map((row, rowIndex) => (
            <tr key={row.key || `${tableKey}-${rowIndex}-${page}`}>
              {row.cells.map((cell, cellIndex) => <td key={`${row.key || rowIndex}-${cellIndex}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination
        page={page}
        totalPages={totalPages}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={ROW_OPTIONS}
        onRowsPerPageChange={setRowsPerPage}
        onPageChange={(nextPage) => setPage(Math.max(1, Math.min(totalPages, nextPage)))}
      />
    </div>
  );
}

function Metric({ label, value, numeric = false }) {
  return (
    <div className="mini-metric">
      <span>{label}</span>
      <strong style={numeric ? numericStyle() : undefined}>{displayValue(value)}</strong>
    </div>
  );
}

function Field({ label, name, value, onChange, type = 'text', as = 'input', options, placeholder, min, step, className = '' }) {
  const commonProps = {
    name,
    value: value ?? '',
    onChange: (event) => onChange(name, event.target.value),
    placeholder,
  };

  return (
    <label className={`field${className ? ` ${className}` : ''}`}>
      <span>{label}</span>
      {as === 'select' ? (
        <select {...commonProps}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : (
        <input {...commonProps} type={type} min={min} step={step} />
      )}
    </label>
  );
}

function InlineCheckbox({ checked, onChange, label }) {
  return (
    <label className="field checkbox-field">
      <input type="checkbox" checked={!!checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function updateForm(setter, name, value) {
  setter((current) => ({ ...current, [name]: value }));
}

const rollupFields = [
  { name: 'id', label: 'Rollup id', placeholder: 'auto if empty' },
  { name: 'day', label: 'Day', type: 'date' },
  { name: 'accountId', label: 'Account id', placeholder: 'primary' },
  { name: 'accountLabel', label: 'Account label', placeholder: 'Account display name' },
  { name: 'unitId', label: 'Unit id', placeholder: 'COL77' },
  { name: 'unitLabel', label: 'Unit label', placeholder: 'B 9749 SXW' },
  { name: 'vehicle', label: 'Vehicle', placeholder: 'Vehicle label' },
  { name: 'type', label: 'Type', as: 'select', options: [{ value: 'temp1', label: 'temp1' }, { value: 'temp2', label: 'temp2' }, { value: 'temp1+temp2', label: 'temp1+temp2' }] },
  { name: 'label', label: 'Label', placeholder: 'TEMP1 ERROR' },
  { name: 'incidents', label: 'Incidents', type: 'number', min: '0' },
  { name: 'temp1Incidents', label: 'Temp1 incidents', type: 'number', min: '0' },
  { name: 'temp2Incidents', label: 'Temp2 incidents', type: 'number', min: '0' },
  { name: 'bothIncidents', label: 'Both incidents', type: 'number', min: '0' },
  { name: 'firstStartTimestamp', label: 'First start', type: 'datetime-local' },
  { name: 'lastEndTimestamp', label: 'Last end', type: 'datetime-local' },
  { name: 'durationMinutes', label: 'Duration minutes', type: 'number', step: '0.1' },
  { name: 'totalMinutes', label: 'Total minutes', type: 'number', step: '0.1' },
  { name: 'longestMinutes', label: 'Longest minutes', type: 'number', step: '0.1' },
  { name: 'temp1Min', label: 'Temp1 min', type: 'number', step: '0.1' },
  { name: 'temp1Max', label: 'Temp1 max', type: 'number', step: '0.1' },
  { name: 'temp2Min', label: 'Temp2 min', type: 'number', step: '0.1' },
  { name: 'temp2Max', label: 'Temp2 max', type: 'number', step: '0.1' },
  { name: 'minSpeed', label: 'Min speed', type: 'number', step: '0.1' },
  { name: 'maxSpeed', label: 'Max speed', type: 'number', step: '0.1' },
  { name: 'latitude', label: 'Latitude', type: 'number', step: 'any' },
  { name: 'longitude', label: 'Longitude', type: 'number', step: 'any' },
  { name: 'locationSummary', label: 'Location summary', placeholder: 'Street, district, city', className: 'admin-db-grid-span-2' },
  { name: 'zoneName', label: 'Zone', placeholder: 'Zone name' },
];

const podFields = [
  { name: 'id', label: 'Snapshot id', placeholder: 'auto if empty' },
  { name: 'day', label: 'Day', type: 'date' },
  { name: 'timestamp', label: 'Timestamp', type: 'datetime-local' },
  { name: 'time', label: 'Time label', placeholder: '13:34:22' },
  { name: 'unitId', label: 'Unit id', placeholder: 'COL77' },
  { name: 'unitLabel', label: 'Unit label', placeholder: 'B 9749 SXW' },
  { name: 'customerName', label: 'Customer name', placeholder: 'Astro' },
  { name: 'podId', label: 'POD id', placeholder: 'pod-1' },
  { name: 'podName', label: 'POD name', placeholder: 'Astro HUB CNR' },
  { name: 'latitude', label: 'Latitude', type: 'number', step: 'any' },
  { name: 'longitude', label: 'Longitude', type: 'number', step: 'any' },
  { name: 'speed', label: 'Speed', type: 'number', step: '0.1' },
  { name: 'distanceMeters', label: 'Distance meters', type: 'number', step: '0.1' },
  { name: 'locationSummary', label: 'Location summary', placeholder: 'Short address', className: 'admin-db-grid-span-2' },
];

export function AdminPanel({
  webSessionUser,
  webUsers,
  webUserForm,
  setWebUserForm,
  onSaveWebUser,
  onDeleteWebUser,
  EMPTY_WEB_USER_FORM,
  adminStorageProvider,
  adminTempRollups,
  adminPodSnapshots,
  adminRollupForm,
  setAdminRollupForm,
  adminPodForm,
  setAdminPodForm,
  EMPTY_ADMIN_ROLLUP_FORM,
  EMPTY_ADMIN_POD_FORM,
  onSaveRollup,
  onDeleteRollup,
  onSavePod,
  onDeletePod,
  onRefreshDb,
  fmtDate,
  fmtNum,
}) {
  const users = safeList(webUsers);
  const rollups = safeList(adminTempRollups);
  const pods = safeList(adminPodSnapshots);
  const formatDate = fmtDate || displayValue;
  const formatNum = fmtNum || displayValue;

  const adminGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 14 };
  const denseGridStyle = { gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 };

  const userRows = useMemo(() => users.map((user) => ({
    key: user.id || user.username,
    cells: [
      <strong>{displayValue(user.username)}</strong>,
      displayValue(user.displayName),
      displayValue(user.role || 'admin'),
      <span className={user.isActive !== false ? 'sf-chip-success' : 'sf-chip-muted'}>{user.isActive !== false ? 'Active' : 'Disabled'}</span>,
      <span style={numericStyle()}>{formatDate(user.updatedAt)}</span>,
      <div className="inline-buttons">
        <ActionButton icon={Edit3} onClick={() => setWebUserForm({ id: user.id, username: user.username || '', displayName: user.displayName || '', password: '', role: user.role || 'admin', isActive: user.isActive !== false })}>Edit</ActionButton>
        <ActionButton variant="danger" icon={Trash2} onClick={() => onDeleteWebUser?.(user.id)}>Delete</ActionButton>
      </div>,
    ],
  })), [formatDate, onDeleteWebUser, setWebUserForm, users]);

  const rollupRows = useMemo(() => rollups.map((row) => ({
    key: row.id || `${row.day}-${row.unitId}-${row.type}`,
    cells: [
      <span style={numericStyle()}>{displayValue(row.day)}</span>,
      displayValue(row.accountLabel || row.accountId),
      <div><strong>{displayValue(row.unitId || row.unitLabel || row.vehicle)}</strong><div className="subtle-line">{displayValue(row.unitLabel || row.vehicle)}</div></div>,
      displayValue(row.label || row.type),
      <span style={numericStyle()}>{formatNum(row.incidents ?? 0)}</span>,
      <div><span style={numericStyle()}>{formatDate(row.firstStartTimestamp)}</span><div className="subtle-line" style={numericStyle()}>{formatDate(row.lastEndTimestamp)}</div></div>,
      <div className="inline-buttons">
        <ActionButton icon={Edit3} onClick={() => setAdminRollupForm({ ...EMPTY_ADMIN_ROLLUP_FORM, ...row })}>Edit</ActionButton>
        <ActionButton variant="danger" icon={Trash2} onClick={() => onDeleteRollup?.(row.id)}>Delete</ActionButton>
      </div>,
    ],
  })), [EMPTY_ADMIN_ROLLUP_FORM, formatDate, formatNum, onDeleteRollup, rollups, setAdminRollupForm]);

  const podRows = useMemo(() => pods.map((row) => ({
    key: row.id || `${row.day}-${row.unitId}-${row.podId}-${row.timestamp}`,
    cells: [
      <span style={numericStyle()}>{displayValue(row.day)}</span>,
      <span style={numericStyle()}>{displayValue(row.time || formatDate(row.timestamp))}</span>,
      <div><strong>{displayValue(row.unitLabel || row.unitId)}</strong><div className="subtle-line">{displayValue(row.unitId)}</div></div>,
      <div><strong>{displayValue(row.podName || row.podId)}</strong><div className="subtle-line">{displayValue(row.podId)}</div></div>,
      <span style={numericStyle()}>{displayValue(row.distanceMeters)}</span>,
      displayValue(row.locationSummary),
      <div className="inline-buttons">
        <ActionButton icon={Edit3} onClick={() => setAdminPodForm({ ...EMPTY_ADMIN_POD_FORM, ...row })}>Edit</ActionButton>
        <ActionButton variant="danger" icon={Trash2} onClick={() => onDeletePod?.(row.id)}>Delete</ActionButton>
      </div>,
    ],
  })), [EMPTY_ADMIN_POD_FORM, formatDate, onDeletePod, pods, setAdminPodForm]);

  return (
    <div className="settings-stack">
      <Surface
        title="Profile overview"
        description="Web dashboard session and admin data footprint."
        icon={Shield}
        actions={<ActionButton icon={Plus} onClick={() => setWebUserForm(EMPTY_WEB_USER_FORM)}>New user</ActionButton>}
      >
        <div className="metric-strip">
          <Metric label="Signed in as" value={webSessionUser?.displayName || webSessionUser?.username} />
          <Metric label="Role" value={webSessionUser?.role} />
          <Metric label="Stored users" value={users.length} numeric />
          <Metric label="Storage provider" value={adminStorageProvider || 'local-bootstrap'} />
          <Metric label="Temp rollups" value={rollups.length} numeric />
          <Metric label="POD snapshots" value={pods.length} numeric />
        </div>
      </Surface>

      <div style={adminGridStyle}>
        <Surface title="Web users" description="Create, edit, and disable dashboard-only accounts." icon={Users}>
          <DataTable tableKey="web-users" columns={['Username', 'Display', 'Role', 'Status', 'Updated', 'Actions']} rows={userRows} emptyMessage="No web users have been stored yet." />
        </Surface>

        <Surface
          title={webUserForm?.id ? 'Edit web user' : 'Create web user'}
          description="Leave password blank when only changing profile details."
          actions={<ActionButton variant="primary" icon={Shield} onClick={onSaveWebUser}>Save user</ActionButton>}
        >
          <div className="settings-stack">
            <Field label="Username" name="username" value={webUserForm?.username} onChange={(name, value) => updateForm(setWebUserForm, name, value)} placeholder="admin" />
            <Field label="Display name" name="displayName" value={webUserForm?.displayName} onChange={(name, value) => updateForm(setWebUserForm, name, value)} placeholder="Administrator" />
            <Field label="Password" name="password" type="password" value={webUserForm?.password} onChange={(name, value) => updateForm(setWebUserForm, name, value)} placeholder={webUserForm?.id ? 'Leave blank to keep current password' : 'New password'} />
            <Field label="Role" name="role" as="select" value={webUserForm?.role || 'admin'} onChange={(name, value) => updateForm(setWebUserForm, name, value)} options={[{ value: 'admin', label: 'Admin' }, { value: 'viewer', label: 'Viewer' }]} />
            <InlineCheckbox label="Active" checked={webUserForm?.isActive} onChange={(checked) => setWebUserForm((current) => ({ ...current, isActive: checked }))} />
          </div>
        </Surface>
      </div>

      <Surface
        title="Database tools"
        description="Review PostgreSQL-backed admin tables and refresh the in-memory view."
        icon={Database}
        actions={<ActionButton icon={Database} onClick={onRefreshDb}>Refresh DB</ActionButton>}
      >
        <div className="metric-strip">
          <Metric label="Provider" value={adminStorageProvider} />
          <Metric label="Rollup rows" value={rollups.length} numeric />
          <Metric label="POD rows" value={pods.length} numeric />
        </div>
      </Surface>

      <div style={adminGridStyle}>
        <Surface title="Temp rollups" description="Daily temperature error rollups used by operations reporting." icon={Database}>
          <DataTable tableKey="temp-rollups" columns={['Day', 'Account', 'Unit', 'Type', 'Incidents', 'Window', 'Actions']} rows={rollupRows} emptyMessage="No temp rollups are stored in PostgreSQL yet." />
        </Surface>

        <Surface
          title={adminRollupForm?.id ? 'Edit temp rollup' : 'New temp rollup'}
          description="Maintain rollup fields with compact, typed inputs."
          actions={<><ActionButton variant="primary" icon={Database} onClick={onSaveRollup}>Save rollup</ActionButton><ActionButton onClick={() => setAdminRollupForm(EMPTY_ADMIN_ROLLUP_FORM)}>Reset</ActionButton></>}
        >
          <div className="form-grid admin-db-grid" style={denseGridStyle}>
            {rollupFields.map((field) => (
              <Field key={field.name} {...field} value={adminRollupForm?.[field.name]} onChange={(name, value) => updateForm(setAdminRollupForm, name, value)} />
            ))}
          </div>
        </Surface>
      </div>

      <div style={adminGridStyle}>
        <Surface title="POD snapshots" description="Saved proof-of-delivery geofence snapshots from PostgreSQL." icon={Database}>
          <DataTable tableKey="pod-snapshots" columns={['Day', 'Time', 'Unit', 'POD', 'Distance', 'Location', 'Actions']} rows={podRows} emptyMessage="No POD snapshots are stored in PostgreSQL yet." />
        </Surface>

        <Surface
          title={adminPodForm?.id ? 'Edit POD snapshot' : 'New POD snapshot'}
          description="Add or correct POD snapshot records used for location review."
          actions={<><ActionButton variant="primary" icon={Database} onClick={onSavePod}>Save POD snapshot</ActionButton><ActionButton onClick={() => setAdminPodForm(EMPTY_ADMIN_POD_FORM)}>Reset</ActionButton></>}
        >
          <div className="form-grid admin-db-grid" style={denseGridStyle}>
            {podFields.map((field) => (
              <Field key={field.name} {...field} value={adminPodForm?.[field.name]} onChange={(name, value) => updateForm(setAdminPodForm, name, value)} />
            ))}
          </div>
        </Surface>
      </div>
    </div>
  );
}

export default AdminPanel;
