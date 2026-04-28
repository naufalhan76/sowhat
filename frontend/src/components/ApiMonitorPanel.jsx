import React, { useState, useEffect, useMemo } from 'react';
import { Activity, AlertCircle, Clock3, Zap } from 'lucide-react';

const PAGE_SIZE = 10;
const SLOW_THRESHOLD_MS = 1500;

function clampPage(page, totalPages) {
  return Math.min(Math.max(page, 0), Math.max(totalPages - 1, 0));
}

function formatAge(now) {
  if (!now) return 'Last updated never';
  const seconds = Math.max(0, Math.round((Date.now() - Number(now)) / 1000));
  if (seconds < 60) return `Last updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Last updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Last updated ${hours}h ago`;
}

function safeNum(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function methodTone(method) {
  const normalized = String(method || '').toUpperCase();
  if (normalized === 'GET') return 'sf-chip-success';
  if (normalized === 'POST' || normalized === 'PUT' || normalized === 'PATCH') return 'sf-chip-warning';
  if (normalized === 'DELETE') return 'sf-chip-danger';
  return 'sf-chip-default';
}

function statusTone(statusCode) {
  const status = safeNum(statusCode, 0);
  if (!status) return 'sf-chip-default';
  if (status >= 500) return 'sf-chip-danger';
  if (status >= 400) return 'sf-chip-warning';
  return 'sf-chip-success';
}

function MethodChip({ method }) {
  const value = String(method || '-').toUpperCase();
  return <span className={`sf-chip ${methodTone(value)}`}>{value}</span>;
}

function StatusChip({ statusCode }) {
  const value = statusCode ?? '-';
  return <span className={`sf-chip ${statusTone(statusCode)}`}>{value}</span>;
}

function Pagination({ page, totalPages, totalRows, onPageChange }) {
  if (totalRows <= PAGE_SIZE) return null;
  return (
    <div className="inline-buttons" style={{ justifyContent: 'space-between', marginTop: 10 }}>
      <span className="subtle-line">Page {page + 1} of {totalPages}</span>
      <div className="inline-buttons">
        <button type="button" className="sf-chip sf-chip-default" onClick={() => onPageChange(page - 1)} disabled={page <= 0}>Prev</button>
        <button type="button" className="sf-chip sf-chip-default" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages - 1}>Next</button>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = 'default', icon: Icon }) {
  const color = tone === 'danger' ? 'var(--danger, #f87171)' : tone === 'warning' ? 'var(--warning, #fbbf24)' : 'inherit';
  return (
    <div className="mini-metric">
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{Icon ? <Icon size={14} strokeWidth={1.8} /> : null}{label}</span>
      <strong style={{ color, fontFeatureSettings: "'tnum'" }}>{value}</strong>
    </div>
  );
}

export function ApiMonitorPanel({ apiMonitor, fmtDate, fmtNum }) {
  const [endpointPage, setEndpointPage] = useState(0);
  const [recentPage, setRecentPage] = useState(0);
  const [lastUpdatedText, setLastUpdatedText] = useState(() => formatAge(apiMonitor?.now));

  const endpointRows = useMemo(() => apiMonitor?.endpointSummary || [], [apiMonitor]);
  const recentRows = useMemo(() => apiMonitor?.recent || [], [apiMonitor]);
  const hasData = Boolean(apiMonitor && (endpointRows.length || recentRows.length || safeNum(apiMonitor?.totals?.requests) > 0));

  const endpointTotalPages = Math.max(1, Math.ceil(endpointRows.length / PAGE_SIZE));
  const recentTotalPages = Math.max(1, Math.ceil(recentRows.length / PAGE_SIZE));
  const visibleEndpointRows = endpointRows.slice(endpointPage * PAGE_SIZE, endpointPage * PAGE_SIZE + PAGE_SIZE);
  const visibleRecentRows = recentRows.slice(recentPage * PAGE_SIZE, recentPage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    setEndpointPage((current) => clampPage(current, endpointTotalPages));
  }, [endpointTotalPages]);

  useEffect(() => {
    setRecentPage((current) => clampPage(current, recentTotalPages));
  }, [recentTotalPages]);

  useEffect(() => {
    setLastUpdatedText(formatAge(apiMonitor?.now));
    const timer = window.setInterval(() => setLastUpdatedText(formatAge(apiMonitor?.now)), 1000);
    return () => window.clearInterval(timer);
  }, [apiMonitor?.now]);

  const totals = apiMonitor?.totals || {};

  if (!hasData) {
    return (
      <div className="surface">
        <div className="surface-head">
          <div>
            <h2>API Monitor</h2>
            <p>Trace ringan untuk lihat endpoint Solofleet API yang ditarik oleh backend, error, dan duration.</p>
          </div>
        </div>
        <div className="surface-body">
          <div className="empty-state">API monitor data will appear once backend starts polling.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="surface">
        <div className="surface-head">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              API Monitor
              <span aria-label="Live data" title="Live data" style={{ width: 8, height: 8, borderRadius: 999, background: '#10B981', display: 'inline-block', animation: 'apiMonitorPulse 1.8s ease infinite' }} />
            </h2>
            <p>Trace ringan untuk lihat endpoint Solofleet API yang ditarik oleh backend, error, dan duration.</p>
          </div>
          <div className="subtle-line cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{lastUpdatedText}</div>
        </div>
        <div className="surface-body">
          <div className="metric-strip">
            <Metric label="Requests" value={fmtNum ? fmtNum(totals.requests ?? 0, 0) : (totals.requests ?? 0)} icon={Activity} />
            <Metric label="Errors" value={fmtNum ? fmtNum(totals.errors ?? 0, 0) : (totals.errors ?? 0)} tone={safeNum(totals.errors) > 0 ? 'danger' : 'default'} icon={AlertCircle} />
            <Metric label="Slow" value={fmtNum ? fmtNum(totals.slowRequests ?? 0, 0) : (totals.slowRequests ?? 0)} tone={safeNum(totals.slowRequests) > 0 ? 'warning' : 'default'} icon={Clock3} />
            <Metric label="Endpoints" value={fmtNum ? fmtNum(totals.uniqueEndpoints ?? 0, 0) : (totals.uniqueEndpoints ?? 0)} icon={Zap} />
          </div>
        </div>
      </div>

      <div className="api-monitor-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="surface">
          <div className="surface-head">
            <div>
              <h2>Endpoint summary</h2>
              <p>Hit count, error count, dan average duration per endpoint.</p>
            </div>
            <div className="subtle-line cell-mono">{endpointRows.length} endpoints</div>
          </div>
          <div className="surface-body">
            {endpointRows.length ? <>
              <table className="data-table">
                <thead><tr><th>Method</th><th>Path</th><th>Hits</th><th>Errors</th><th>Avg ms</th><th>Last status</th><th>Last at</th><th>Last error</th></tr></thead>
                <tbody>{visibleEndpointRows.map((row) => {
                  const key = row.key || `${row.method}-${row.path}`;
                  const errors = safeNum(row.errorCount);
                  const avg = safeNum(row.avgDurationMs);
                  return (
                    <tr key={key}>
                      <td><MethodChip method={row.method} /></td>
                      <td><div>{row.path || '-'}</div></td>
                      <td className="cell-mono" style={{ fontFeatureSettings: "'tnum'" }}>{fmtNum ? fmtNum(row.hits ?? 0, 0) : (row.hits ?? 0)}</td>
                      <td className="cell-mono" style={{ color: errors > 0 ? 'var(--danger, #f87171)' : 'inherit', fontFeatureSettings: "'tnum'" }}>{fmtNum ? fmtNum(errors, 0) : errors}</td>
                      <td className="cell-mono" style={{ color: avg > SLOW_THRESHOLD_MS ? 'var(--warning, #fbbf24)' : 'inherit', fontFeatureSettings: "'tnum'" }}>{fmtNum ? fmtNum(avg, 1) : avg}</td>
                      <td><StatusChip statusCode={row.lastStatusCode} /></td>
                      <td className="cell-mono">{fmtDate ? fmtDate(row.lastAt) : (row.lastAt || '-')}</td>
                      <td>{row.lastError || '-'}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <Pagination page={endpointPage} totalPages={endpointTotalPages} totalRows={endpointRows.length} onPageChange={(next) => setEndpointPage(clampPage(next, endpointTotalPages))} />
            </> : <div className="empty-state">Belum ada traffic API tercatat.</div>}
          </div>
        </div>

        <div className="surface">
          <div className="surface-head">
            <div>
              <h2>Recent requests</h2>
              <p>Request data terbaru ke Solofleet beserta status HTTP-nya.</p>
            </div>
            <div className="subtle-line cell-mono">{recentRows.length} requests</div>
          </div>
          <div className="surface-body">
            {recentRows.length ? <>
              <table className="data-table">
                <thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th><th>Error</th></tr></thead>
                <tbody>{visibleRecentRows.map((row, index) => {
                  const status = safeNum(row.statusCode);
                  const duration = safeNum(row.durationMs);
                  const isError = status >= 400 || Boolean(row.error);
                  const path = `${row.path || '-'}${row.query || ''}`;
                  return (
                    <tr key={`${row.timestamp || 'request'}-${row.method || ''}-${row.path || ''}-${index}`} style={isError ? { background: 'rgba(248, 113, 113, 0.08)' } : undefined}>
                      <td className="cell-mono">{fmtDate ? fmtDate(row.timestamp) : (row.timestamp || '-')}</td>
                      <td><MethodChip method={row.method} /></td>
                      <td>{path}</td>
                      <td><StatusChip statusCode={row.statusCode} /></td>
                      <td className="cell-mono" style={{ color: duration >= SLOW_THRESHOLD_MS ? 'var(--warning, #fbbf24)' : 'inherit', fontFeatureSettings: "'tnum'" }}>{fmtNum ? fmtNum(duration, 0) : duration} ms</td>
                      <td style={{ color: isError ? 'var(--danger, #f87171)' : 'inherit' }}>{row.error || '-'}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <Pagination page={recentPage} totalPages={recentTotalPages} totalRows={recentRows.length} onPageChange={(next) => setRecentPage(clampPage(next, recentTotalPages))} />
            </> : <div className="empty-state">Belum ada recent request.</div>}
          </div>
        </div>
      </div>
      <style>{`@keyframes apiMonitorPulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } } @media (max-width: 959px) { .api-monitor-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
