import React, { useState, useEffect } from 'react';
import { ArrowLeft, Clock, Route, Truck, User, MapPin, Thermometer, AlertTriangle } from 'lucide-react';
import { Action, Spinner, EmptyState, Pill } from '../index.js';

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

function formatTemp(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}°`;
}

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('id-ID', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

function getStatusColor(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed') return 'success';
  if (normalized === 'in_progress') return 'primary';
  if (normalized === 'cancelled') return 'default';
  return 'default';
}

function getStatusLabel(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed') return 'Completed';
  if (normalized === 'in_progress') return 'In Progress';
  if (normalized === 'cancelled') return 'Cancelled';
  return status || '-';
}

export function MasterDataDetailPage({ joId, onBack }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [jo, setJo] = useState(null);
  const [stops, setStops] = useState([]);

  useEffect(() => {
    if (!joId) {
      setError('No JO ID provided');
      setLoading(false);
      return;
    }
    fetchDetail();
  }, [joId]);

  async function fetchDetail() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tms/master-data/detail?joId=${encodeURIComponent(joId)}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch detail: ${res.status}`);
      }
      const data = await res.json();
      if (!data.ok) {
        throw new Error('Invalid response from server');
      }
      setJo(data.jo);
      setStops(data.stops || []);
    } catch (err) {
      console.error('Failed to fetch JO detail:', err);
      setError(err.message || 'Failed to load JO detail');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="master-data-detail-page">
        <div className="master-data-detail-loading">
          <Spinner size="lg" />
          <p>Loading JO detail...</p>
        </div>
      </div>
    );
  }

  if (error || !jo) {
    return (
      <div className="master-data-detail-page">
        <div className="master-data-detail-header">
          <Action variant="ghost" onClick={onBack}>
            <ArrowLeft size={20} />
            Back to Master Data
          </Action>
        </div>
        <EmptyState
          icon={AlertTriangle}
          title="Failed to load JO"
          message={error || 'JO not found'}
        />
      </div>
    );
  }

  const efficiency = jo.route_efficiency !== null && jo.route_efficiency !== undefined
    ? `${(jo.route_efficiency * 100).toFixed(1)}%`
    : '-';

  const incidentCodes = Array.isArray(jo.incident_codes)
    ? jo.incident_codes
    : (jo.incident_codes ? String(jo.incident_codes).split(',').map(s => s.trim()) : []);

  return (
    <div className="master-data-detail-page">
      <div className="master-data-detail-header">
        <Action variant="ghost" onClick={onBack}>
          <ArrowLeft size={20} />
          Back to Master Data
        </Action>
      </div>

      <div className="master-data-detail-content">
        {/* Header Section */}
        <div className="master-data-detail-title-section">
          <div className="master-data-detail-title-row">
            <h1 className="master-data-detail-title">{jo.jo_id}</h1>
            <Pill color={getStatusColor(jo.status)}>{getStatusLabel(jo.status)}</Pill>
          </div>
          <div className="master-data-detail-meta">
            <div className="master-data-detail-meta-item">
              <User size={16} />
              <span>{jo.customer_name || '-'}</span>
            </div>
            <div className="master-data-detail-meta-item">
              <Truck size={16} />
              <span>{jo.plate || '-'}</span>
            </div>
            <div className="master-data-detail-meta-item">
              <User size={16} />
              <span>{jo.driver_1_name || '-'}{jo.driver_2_name ? ` / ${jo.driver_2_name}` : ''}</span>
            </div>
          </div>
        </div>

        {/* Route Summary */}
        <div className="master-data-detail-route-summary">
          <MapPin size={20} className="master-data-detail-route-icon" />
          <div className="master-data-detail-route-text">
            <span className="master-data-detail-route-origin">{jo.origin_name || '-'}</span>
            <ArrowLeft size={16} className="master-data-detail-route-arrow" />
            <span className="master-data-detail-route-destination">{jo.destination_name || '-'}</span>
          </div>
        </div>

        {/* Metrics Cards */}
        <div className="master-data-detail-metrics">
          <div className="master-data-detail-metric-card">
            <div className="master-data-detail-metric-label">Duration</div>
            <div className="master-data-detail-metric-value">{formatDuration(jo.total_duration_min)}</div>
            <div className="master-data-detail-metric-sub">
              {formatDateTime(jo.trip_start_at)} - {formatDateTime(jo.trip_end_at)}
            </div>
          </div>

          <div className="master-data-detail-metric-card">
            <div className="master-data-detail-metric-label">Distance</div>
            <div className="master-data-detail-metric-value">{formatDistance(jo.actual_distance_km)}</div>
            <div className="master-data-detail-metric-sub">
              Planned: {formatDistance(jo.planned_distance_km)}
            </div>
          </div>

          <div className="master-data-detail-metric-card">
            <div className="master-data-detail-metric-label">Efficiency</div>
            <div className="master-data-detail-metric-value">{efficiency}</div>
            <div className="master-data-detail-metric-sub">
              {jo.stop_count || 0} stops
            </div>
          </div>

          <div className="master-data-detail-metric-card">
            <div className="master-data-detail-metric-label">Speed Violations</div>
            <div className="master-data-detail-metric-value">{jo.speed_violation_count || 0}</div>
            <div className="master-data-detail-metric-sub">
              Idle: {formatDuration(jo.total_idle_min)}
            </div>
          </div>
        </div>

        {/* Temperature Section */}
        <div className="master-data-detail-section">
          <h2 className="master-data-detail-section-title">
            <Thermometer size={20} />
            Temperature
          </h2>
          <div className="master-data-detail-temp-grid">
            <div className="master-data-detail-temp-item">
              <div className="master-data-detail-temp-label">Min</div>
              <div className="master-data-detail-temp-value">{formatTemp(jo.temp_min)}</div>
            </div>
            <div className="master-data-detail-temp-item">
              <div className="master-data-detail-temp-label">Max</div>
              <div className="master-data-detail-temp-value">{formatTemp(jo.temp_max)}</div>
            </div>
            <div className="master-data-detail-temp-item">
              <div className="master-data-detail-temp-label">Avg</div>
              <div className="master-data-detail-temp-value">{formatTemp(jo.temp_avg)}</div>
            </div>
            <div className="master-data-detail-temp-item">
              <div className="master-data-detail-temp-label">Breaches</div>
              <div className="master-data-detail-temp-value">
                {jo.breach_count || 0}
                {jo.breach_total_min ? ` (${formatDuration(jo.breach_total_min)})` : ''}
              </div>
            </div>
            <div className="master-data-detail-temp-item">
              <div className="master-data-detail-temp-label">Compliant</div>
              <div className="master-data-detail-temp-value">
                <Pill color={jo.temp_compliant ? 'success' : 'danger'}>
                  {jo.temp_compliant ? 'Yes' : 'No'}
                </Pill>
              </div>
            </div>
          </div>
        </div>

        {/* Incidents Section */}
        {(jo.incident_count > 0 || incidentCodes.length > 0) && (
          <div className="master-data-detail-section">
            <h2 className="master-data-detail-section-title">
              <AlertTriangle size={20} />
              Incidents ({jo.incident_count || 0})
            </h2>
            {incidentCodes.length > 0 && (
              <div className="master-data-detail-incident-codes">
                {incidentCodes.map((code, idx) => (
                  <Pill key={idx} color="warning">{code}</Pill>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stops Table */}
        <div className="master-data-detail-section">
          <h2 className="master-data-detail-section-title">
            <Route size={20} />
            Stops ({stops.length})
          </h2>
          {stops.length === 0 ? (
            <EmptyState
              icon={Route}
              title="No stops recorded"
              message="This JO has no stop data"
            />
          ) : (
            <div className="master-data-detail-table-wrapper">
              <table className="master-data-detail-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Type</th>
                    <th>Location</th>
                    <th>Arrival</th>
                    <th>Departure</th>
                    <th>Dwell</th>
                    <th>Distance</th>
                    <th>Temp</th>
                    <th>On Time</th>
                  </tr>
                </thead>
                <tbody>
                  {stops.map((stop, idx) => {
                    const onTime = stop.on_time;
                    const onTimeColor = onTime === true ? 'success' : onTime === false ? 'danger' : 'default';
                    const onTimeLabel = onTime === true ? 'On Time' : onTime === false ? 'Late' : '-';

                    return (
                      <tr key={idx}>
                        <td>{stop.stop_idx + 1}</td>
                        <td>{stop.stop_type || '-'}</td>
                        <td>
                          <div className="master-data-detail-stop-location">
                            <div className="master-data-detail-stop-label">{stop.stop_label || '-'}</div>
                            {stop.address_name && (
                              <div className="master-data-detail-stop-address">{stop.address_name}</div>
                            )}
                          </div>
                        </td>
                        <td>{formatDateTime(stop.geofence_arrival_at)}</td>
                        <td>{formatDateTime(stop.geofence_departure_at)}</td>
                        <td>{formatDuration(stop.dwell_time_min)}</td>
                        <td>{formatDistance(stop.leg_distance_km)}</td>
                        <td>
                          {stop.leg_temp_min !== null && stop.leg_temp_max !== null
                            ? `${formatTemp(stop.leg_temp_min)} - ${formatTemp(stop.leg_temp_max)}`
                            : '-'}
                        </td>
                        <td>
                          <Pill color={onTimeColor}>{onTimeLabel}</Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
