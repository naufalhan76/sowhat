import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, ChevronDown } from 'lucide-react';
import { Action, Spinner, EmptyState } from '../index.js';

function formatDuration(minutes) {
  if (!minutes || !Number.isFinite(minutes)) return '-';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

function formatDistance(km) {
  if (!km || !Number.isFinite(km)) return '-';
  return `${km.toFixed(1)} km`;
}

function formatTempRange(min, max) {
  if (min === null || min === undefined || max === null || max === undefined) return '-';
  return `${min}°C - ${max}°C`;
}

function today(offset = 0) {
  const date = new Date(Date.now() + (offset * 24 * 60 * 60 * 1000));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year || ''}-${lookup.month || ''}-${lookup.day || ''}`;
}

export function MasterDataPage() {
  const [filters, setFilters] = useState({
    from: today(-7),
    to: today(0),
    customer: '',
    driver: '',
    plate: '',
  });
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sortColumn, setSortColumn] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [customerOptions, setCustomerOptions] = useState([]);
  const [driverOptions, setDriverOptions] = useState([]);
  const [plateOptions, setPlateOptions] = useState([]);

  useEffect(() => {
    fetchData();
  }, [filters, page, sortColumn, sortDirection]);

  useEffect(() => {
    fetchFilterOptions();
  }, []);

  async function fetchFilterOptions() {
    try {
      const [customersRes, driversRes, platesRes] = await Promise.all([
        fetch('/api/tms/master-data/customers').then(r => r.ok ? r.json() : []),
        fetch('/api/tms/master-data/drivers').then(r => r.ok ? r.json() : []),
        fetch('/api/tms/master-data/plates').then(r => r.ok ? r.json() : []),
      ]);
      setCustomerOptions(customersRes || []);
      setDriverOptions(driversRes || []);
      setPlateOptions(platesRes || []);
    } catch (err) {
      console.error('Failed to fetch filter options:', err);
    }
  }

  async function fetchData() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: filters.from,
        to: filters.to,
        page: String(page),
        limit: '50',
        sortBy: sortColumn,
        sortDir: sortDirection,
      });
      if (filters.customer) params.set('customer', filters.customer);
      if (filters.driver) params.set('driver', filters.driver);
      if (filters.plate) params.set('plate', filters.plate);

      const [listRes, summaryRes] = await Promise.all([
        fetch(`/api/tms/master-data?${params}`).then(r => r.ok ? r.json() : { rows: [], total: 0 }),
        fetch(`/api/tms/master-data/summary?${params}`).then(r => r.ok ? r.json() : null),
      ]);

      setRows(listRes.rows || []);
      setTotalPages(Math.ceil((listRes.total || 0) / 50));
      setSummary(summaryRes);
    } catch (err) {
      console.error('Failed to fetch master data:', err);
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  function handleFilterChange(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function handleSort(column) {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
    setPage(1);
  }

  function handleRowClick(row) {
    console.log('Row clicked:', row.joId);
  }

  async function handleExportCSV() {
    try {
      const params = new URLSearchParams({
        from: filters.from,
        to: filters.to,
      });
      if (filters.customer) params.set('customer', filters.customer);
      if (filters.driver) params.set('driver', filters.driver);
      if (filters.plate) params.set('plate', filters.plate);

      const res = await fetch(`/api/tms/master-data/export?${params}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `master-data-${filters.from}-${filters.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  }

  const stats = summary ? [
    { label: 'Total JO', value: summary.totalJo || 0 },
    { label: 'On-time Rate', value: summary.ontimeRate ? `${summary.ontimeRate.toFixed(1)}%` : '-' },
    { label: 'Temp Compliance', value: summary.tempCompliance ? `${summary.tempCompliance.toFixed(1)}%` : '-' },
    { label: 'Avg Duration', value: formatDuration(summary.avgDuration) },
    { label: 'Avg Distance', value: formatDistance(summary.avgDistance) },
    { label: 'Incidents', value: summary.incidents || 0 },
  ] : [];

  return (
    <div className="master-data-page">
      {/* Filter bar */}
      <div className="master-data-filters">
        <div className="master-data-filter-group">
          <label className="master-data-filter-label">From</label>
          <input
            type="date"
            className="master-data-filter-input"
            value={filters.from}
            onChange={(e) => handleFilterChange('from', e.target.value)}
          />
        </div>
        <div className="master-data-filter-group">
          <label className="master-data-filter-label">To</label>
          <input
            type="date"
            className="master-data-filter-input"
            value={filters.to}
            onChange={(e) => handleFilterChange('to', e.target.value)}
          />
        </div>
        <div className="master-data-filter-group">
          <label className="master-data-filter-label">Customer</label>
          <select
            className="master-data-filter-select"
            value={filters.customer}
            onChange={(e) => handleFilterChange('customer', e.target.value)}
          >
            <option value="">All customers</option>
            {customerOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
        <div className="master-data-filter-group">
          <label className="master-data-filter-label">Driver</label>
          <select
            className="master-data-filter-select"
            value={filters.driver}
            onChange={(e) => handleFilterChange('driver', e.target.value)}
          >
            <option value="">All drivers</option>
            {driverOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
        <div className="master-data-filter-group">
          <label className="master-data-filter-label">Plate</label>
          <select
            className="master-data-filter-select"
            value={filters.plate}
            onChange={(e) => handleFilterChange('plate', e.target.value)}
          >
            <option value="">All plates</option>
            {plateOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
        <Action variant="secondary" onClick={fetchData} disabled={loading}>
          <RefreshCw size={14} />
          Refresh
        </Action>
      </div>

      {/* Dashboard cards */}
      {loading && !summary ? (
        <div className="master-data-stats-loading">
          <Spinner size="sm" />
        </div>
      ) : (
        <div className="master-data-stats">
          {stats.map((stat, i) => (
            <div key={i} className="master-data-stat-card">
              <p className="master-data-stat-label">{stat.label}</p>
              <p className="master-data-stat-value">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Data table */}
      <div className="master-data-table-container">
        {loading ? (
          <div className="master-data-table-loading">
            <Spinner size="md" />
            <p>Loading data...</p>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No data found"
            description="Try adjusting your filters or date range"
          />
        ) : (
          <>
            <table className="master-data-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('joNumber')}>
                    JO Number {sortColumn === 'joNumber' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('date')}>
                    Date {sortColumn === 'date' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('customer')}>
                    Customer {sortColumn === 'customer' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('plate')}>
                    Plate {sortColumn === 'plate' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('driver')}>
                    Driver {sortColumn === 'driver' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>Route</th>
                  <th onClick={() => handleSort('stopCount')}>
                    Stops {sortColumn === 'stopCount' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('duration')}>
                    Duration {sortColumn === 'duration' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('distance')}>
                    Distance {sortColumn === 'distance' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>Temp Range</th>
                  <th>Temp Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} onClick={() => handleRowClick(row)} className="master-data-table-row">
                    <td className="master-data-table-cell-mono">{row.joNumber || '-'}</td>
                    <td>{row.date || '-'}</td>
                    <td>{row.customer || '-'}</td>
                    <td className="master-data-table-cell-mono">{row.plate || '-'}</td>
                    <td>{row.driver || '-'}</td>
                    <td className="master-data-table-cell-route">{row.route || '-'}</td>
                    <td className="master-data-table-cell-mono">{row.stopCount || 0}</td>
                    <td className="master-data-table-cell-mono">{formatDuration(row.duration)}</td>
                    <td className="master-data-table-cell-mono">{formatDistance(row.distance)}</td>
                    <td className="master-data-table-cell-mono">{formatTempRange(row.tempMin, row.tempMax)}</td>
                    <td>
                      <span className={`master-data-temp-badge master-data-temp-badge-${row.tempStatus === 'compliant' ? 'success' : 'danger'}`}>
                        {row.tempStatus === 'compliant' ? 'Compliant' : 'Breach'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="master-data-pagination">
                <Action
                  variant="secondary"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Action>
                <span className="master-data-pagination-info">
                  Page {page} of {totalPages}
                </span>
                <Action
                  variant="secondary"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                </Action>
              </div>
            )}
          </>
        )}
      </div>

      {/* Export button */}
      <div className="master-data-footer">
        <Action variant="secondary" onClick={handleExportCSV} disabled={loading || rows.length === 0}>
          <Download size={14} />
          Export CSV
        </Action>
      </div>
    </div>
  );
}
