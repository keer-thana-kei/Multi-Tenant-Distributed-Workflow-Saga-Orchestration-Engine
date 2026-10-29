import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import './MonitoringDashboard.css';

const DEFAULT_API_URL = import.meta.env.VITE_MONITORING_API_URL || 'http://localhost:4000';
const DEFAULT_WS_URL = import.meta.env.VITE_MONITORING_WS_URL || 'ws://localhost:4000/?apiKey=dev-monitoring-key-change-me';
const DEFAULT_API_KEY = import.meta.env.VITE_MONITORING_API_KEY || 'dev-monitoring-key-change-me';

export function MonitoringDashboard({
  apiUrl = DEFAULT_API_URL,
  wsUrl = DEFAULT_WS_URL,
  apiKey = DEFAULT_API_KEY,
}) {
  // ── State ─────────────────────────────────────────────────────────────
  const [transportStatus, setTransportStatus] = useState('disconnected'); // 'connected' | 'reconnecting' | 'disconnected'
  const [reconnectCount, setReconnectCount] = useState(0);
  const [isStale, setIsStale] = useState(false);
  const [overallHealth, setOverallHealth] = useState('unknown');
  const [services, setServices] = useState([
    { name: 'api', status: 'unknown', detail: 'Awaiting telemetry...' },
    { name: 'mongodb', status: 'unknown', detail: 'Awaiting telemetry...' },
    { name: 'workers', status: 'unknown', detail: 'Awaiting telemetry...' },
    { name: 'mongodb-dns', status: 'unknown', detail: 'Awaiting telemetry...' },
  ]);
  const [metrics, setMetrics] = useState({
    workflows: { global: { pending: 0, running: 0, success: 0, failed: 0 } },
    system: { cpu: { usagePercent: 0 }, memory: { usagePercent: 0 } },
  });
  const [compensationFailures, setCompensationFailures] = useState(0);
  const [events, setEvents] = useState([]);
  const [lastHealthTime, setLastHealthTime] = useState(null);
  const [lastDataTime, setLastDataTime] = useState(null);
  const [lastSeq, setLastSeq] = useState(0);

  // Filters
  const [selectedService, setSelectedService] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('');

  // Refs for socket & reconnect
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const lastSeqRef = useRef(-1);

  // ── Helper: Format timestamp ──────────────────────────────────────────
  const formatTimestamp = (isoStr) => {
    if (!isoStr) return '--';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    } catch {
      return isoStr;
    }
  };

  // ── Initial Fetch via HTTP ───────────────────────────────────────────
  const fetchInitialStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/status`, {
        headers: { 'X-Monitoring-Key': apiKey },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.overall) setOverallHealth(data.overall);
      if (Array.isArray(data.services)) setServices(data.services);
      if (Array.isArray(data.health)) setServices(data.health);
      if (data.metrics) setMetrics(data.metrics);
      if (data.checkedAt) setLastHealthTime(data.checkedAt);
    } catch (err) {
      console.warn('Initial status fetch failed, relying on WebSocket:', err.message);
    }
  }, [apiUrl, apiKey]);

  // ── Incoming WebSocket Message Dispatcher ─────────────────────────────
  const handleIncomingMessage = useCallback((msg) => {
    if (!msg || typeof msg !== 'object') return;

    const ts = msg.ts || new Date().toISOString();
    setLastDataTime(ts);

    // Monotonic sequence tracking
    if (typeof msg.seq === 'number') {
      if (msg.seq > 0 && msg.seq <= lastSeqRef.current) {
        return; // Ignore out-of-order duplicates
      }
      if (msg.seq > 0) {
        lastSeqRef.current = msg.seq;
        setLastSeq(msg.seq);
      }
    }

    switch (msg.type) {
      case 'SNAPSHOT':
        if (msg.payload) {
          lastSeqRef.current = 0;
          setLastSeq(0);
          if (msg.payload.overall) setOverallHealth(msg.payload.overall);
          if (Array.isArray(msg.payload.services)) setServices(msg.payload.services);
          if (Array.isArray(msg.payload.health)) setServices(msg.payload.health);
          if (msg.payload.metrics) setMetrics(msg.payload.metrics);
          if (msg.payload.checkedAt) setLastHealthTime(msg.payload.checkedAt);
        }
        break;

      case 'SYSTEM_HEALTH':
        setLastHealthTime(ts);
        if (Array.isArray(msg.payload?.services)) {
          setServices(msg.payload.services);
          const hasDown = msg.payload.services.some((s) => s.status === 'down');
          const hasDegraded = msg.payload.services.some((s) => s.status === 'degraded');
          setOverallHealth(hasDown ? 'down' : hasDegraded ? 'degraded' : 'healthy');
        }
        break;

      case 'METRICS_UPDATE':
        if (msg.payload) {
          setMetrics((prev) => ({
            ...prev,
            ...msg.payload,
          }));
        }
        break;

      case 'WORKER_AVAILABILITY':
        if (msg.payload?.status) {
          setServices((prev) =>
            prev.map((s) =>
              s.name === 'workers'
                ? { ...s, status: msg.payload.status, detail: msg.payload.detail, latencyMs: msg.payload.latencyMs }
                : s
            )
          );
        }
        break;

      case 'QUEUE_BACKLOG':
        if (typeof msg.payload?.pending === 'number') {
          setMetrics((prev) => ({
            ...prev,
            workflows: {
              ...prev.workflows,
              global: {
                ...(prev.workflows?.global || {}),
                pending: msg.payload.pending,
                running: msg.payload.running ?? prev.workflows?.global?.running ?? 0,
              },
            },
          }));
        }
        break;

      case 'WORKFLOW_COMPENSATION_FAILED':
        setCompensationFailures((prev) => prev + 1);
        break;

      default:
        break;
    }

    // Append to timeline events (capped at 200)
    setEvents((prev) => [msg, ...prev].slice(0, 200));
  }, []);

  // ── WebSocket Connection Management ───────────────────────────────────
  const connect = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
    }

    setTransportStatus('reconnecting');

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setTransportStatus('connected');
        setIsStale(false);
        reconnectAttemptsRef.current = 0;
        setReconnectCount(0);
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          handleIncomingMessage(parsed);
        } catch (err) {
          console.warn('Malformed frame received:', err);
        }
      };

      socket.onclose = () => {
        onDisconnect();
      };

      socket.onerror = () => {
        onDisconnect();
      };
    } catch {
      onDisconnect();
    }
  }, [wsUrl, handleIncomingMessage]);

  const onDisconnect = useCallback(() => {
    setTransportStatus('disconnected');
    setIsStale(true);

    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectAttemptsRef.current += 1;
    setReconnectCount(reconnectAttemptsRef.current);

    // Exponential backoff with random jitter (1s - 15s)
    const baseDelay = Math.min(1000 * Math.pow(1.5, reconnectAttemptsRef.current), 15000);
    const jitter = Math.random() * 500;
    const delay = Math.floor(baseDelay + jitter);

    reconnectTimerRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    fetchInitialStatus();
    connect();

    return () => {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [fetchInitialStatus, connect]);

  // ── Filtered Events Memo ──────────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    const qTenant = tenantFilter.trim().toLowerCase();
    return events.filter((ev) => {
      if (selectedType !== 'all' && ev.type !== selectedType) return false;
      if (qTenant && (!ev.tenantId || !ev.tenantId.toLowerCase().includes(qTenant))) return false;
      return true;
    });
  }, [events, selectedType, tenantFilter]);

  // ── Filtered Services Memo ────────────────────────────────────────────
  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      if (selectedService !== 'all' && s.name !== selectedService) return false;
      if (selectedStatus !== 'all' && s.status !== selectedStatus) return false;
      return true;
    });
  }, [services, selectedService, selectedStatus]);

  // Status Style Helpers
  const getDotClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'healthy':
        return 'dot-healthy';
      case 'degraded':
        return 'dot-degraded';
      case 'down':
        return 'dot-down';
      default:
        return 'dot-unknown';
    }
  };

  const getStatusTextClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'healthy':
        return 'status-text-healthy';
      case 'degraded':
        return 'status-text-degraded';
      case 'down':
        return 'status-text-down';
      default:
        return 'status-text-unknown';
    }
  };

  const g = metrics.workflows?.global || metrics.workflows || {};
  const cpuPercent = metrics.system?.cpu?.usagePercent;
  const memPercent = metrics.system?.memory?.usagePercent;

  return (
    <div className="monitoring-container" role="main" aria-label="Monitoring Dashboard">
      {/* Stale Warning Banner */}
      {isStale && (
        <div className="stale-banner" role="alert" aria-live="assertive">
          <span className="status-dot dot-degraded" aria-hidden="true" />
          <span>
            Transport disconnected. Showing cached telemetry data. Reconnection in progress
            {reconnectCount > 0 ? ` (attempt #${reconnectCount})` : ''}...
          </span>
        </div>
      )}

      {/* Header */}
      <header className="monitoring-header">
        <div className="monitoring-title-wrap">
          <h1 className="monitoring-h1">
            <span className={`status-dot ${getDotClass(overallHealth)}`} aria-hidden="true" />
            Saga Orchestration Monitoring
          </h1>
          <div className="card-subtitle">
            Real-time system health, workflow saga telemetry, and infrastructure observability
          </div>
        </div>
        <div className="monitoring-meta">
          <div role="status" aria-label={`Transport status: ${transportStatus}`}>
            WebSocket:{' '}
            <span className={`transport-pill transport-${transportStatus}`}>
              {transportStatus === 'reconnecting'
                ? `Reconnecting (${reconnectCount})...`
                : transportStatus}
            </span>
          </div>
          <div>
            System Health:{' '}
            <span className={`service-status-text ${getStatusTextClass(overallHealth)}`}>
              {overallHealth.toUpperCase()}
            </span>
          </div>
        </div>
      </header>

      {/* Services Grid */}
      <section aria-labelledby="sec-services">
        <div className="section-title" id="sec-services">
          Monitored Services &amp; Dependency Health
        </div>
        <div className="services-grid">
          {filteredServices.map((svc) => (
            <div
              key={svc.name}
              className="service-card"
              role="region"
              aria-label={`${svc.name} service status: ${svc.status || 'unknown'}`}
            >
              <div className="service-header">
                <div className="service-name">
                  <span className={`status-dot ${getDotClass(svc.status)}`} aria-hidden="true" />
                  {svc.name}
                </div>
                <span className={`service-status-text ${getStatusTextClass(svc.status)}`}>
                  {svc.status || 'UNKNOWN'}
                </span>
              </div>
              <div className="service-detail">
                {svc.latencyMs !== undefined ? `${svc.latencyMs}ms` : ''}
                {svc.detail ? ` — ${svc.detail}` : (svc.latencyMs ? '' : 'No telemetry detail')}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Metric Cards Grid */}
      <section aria-labelledby="sec-telemetry">
        <div className="section-title" id="sec-telemetry">
          Workflow Engine Metrics &amp; System Telemetry
        </div>
        <div className="grid-metrics">
          <div className="card" aria-label="Workflow Queue Depth">
            <div className="card-title">Pending Workflows (Queue Depth)</div>
            <div className="card-value">
              {g.pending ?? '--'}
              {isStale && <span className="stale-tag"> (stale)</span>}
            </div>
            <div className="card-subtitle">Awaiting executor</div>
          </div>

          <div className="card" aria-label="Active Running Workflows">
            <div className="card-title">Active Running Sagas</div>
            <div className="card-value" style={{ color: '#60a5fa' }}>
              {g.running ?? '--'}
              {isStale && <span className="stale-tag"> (stale)</span>}
            </div>
            <div className="card-subtitle">Currently executing</div>
          </div>

          <div className="card" aria-label="Completed Workflows">
            <div className="card-title">Completed Workflows</div>
            <div className="card-value" style={{ color: 'var(--status-healthy)' }}>
              {g.success ?? '--'}
              {isStale && <span className="stale-tag"> (stale)</span>}
            </div>
            <div className="card-subtitle">Saga success</div>
          </div>

          <div className="card" aria-label="Failed Workflows">
            <div className="card-title">Failed Workflows</div>
            <div className="card-value" style={{ color: 'var(--status-down)' }}>
              {g.failed ?? '--'}
              {isStale && <span className="stale-tag"> (stale)</span>}
            </div>
            <div className="card-subtitle">Failed / Compensated</div>
          </div>

          <div className="card" aria-label="Saga Compensation Failures">
            <div className="card-title">Compensation Failures</div>
            <div className="card-value" style={{ color: '#f87171' }}>
              {compensationFailures}
              {isStale && <span className="stale-tag"> (stale)</span>}
            </div>
            <div className="card-subtitle">Critical rollback errors</div>
          </div>

          <div className="card" aria-label="Host CPU Usage">
            <div className="card-title">Host CPU Usage</div>
            <div className="card-value">
              {cpuPercent !== undefined ? `${cpuPercent}%` : '--%'}
              {isStale && <span className="stale-tag"> (stale)</span>}
            </div>
            <div className="card-subtitle">System load</div>
          </div>

          <div className="card" aria-label="Host Memory Usage">
            <div className="card-title">Host Memory Usage</div>
            <div className="card-value">
              {memPercent !== undefined ? `${memPercent}%` : '--%'}
              {isStale && <span className="stale-tag"> (stale)</span>}
            </div>
            <div className="card-subtitle">RAM utilization</div>
          </div>

          <div className="card" aria-label="Runtime Environment">
            <div className="card-title">Environment &amp; Runtime</div>
            <div className="card-value" style={{ fontSize: '1.1rem' }}>
              Node.js Host
            </div>
            <div className="card-subtitle">Observable runtime</div>
          </div>
        </div>
      </section>

      {/* Filter Controls */}
      <section className="filter-bar" aria-label="Timeline and Service Filters">
        <div className="filter-group">
          <label htmlFor="serviceSelect">Service:</label>
          <select
            id="serviceSelect"
            className="filter-select"
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
          >
            <option value="all">All Services</option>
            <option value="api">Backend API</option>
            <option value="mongodb">MongoDB</option>
            <option value="workers">Workers</option>
            <option value="mongodb-dns">MongoDB DNS</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="statusSelect">Status:</label>
          <select
            id="statusSelect"
            className="filter-select"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="healthy">Healthy</option>
            <option value="degraded">Degraded</option>
            <option value="down">Down</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="typeSelect">Event Type:</label>
          <select
            id="typeSelect"
            className="filter-select"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
          >
            <option value="all">All Events</option>
            <option value="WORKFLOW_STARTED">WORKFLOW_STARTED</option>
            <option value="WORKFLOW_STEP_SUCCESS">WORKFLOW_STEP_SUCCESS</option>
            <option value="WORKFLOW_STEP_FAILED">WORKFLOW_STEP_FAILED</option>
            <option value="WORKFLOW_STEP_RETRY">WORKFLOW_STEP_RETRY</option>
            <option value="WORKFLOW_COMPENSATING">WORKFLOW_COMPENSATING</option>
            <option value="WORKFLOW_COMPENSATION_FAILED">WORKFLOW_COMPENSATION_FAILED</option>
            <option value="WORKFLOW_COMPLETED">WORKFLOW_COMPLETED</option>
            <option value="SYSTEM_HEALTH">SYSTEM_HEALTH</option>
            <option value="ALERT_FIRED">ALERT_FIRED</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="tenantInput">Tenant:</label>
          <input
            id="tenantInput"
            type="text"
            className="filter-input"
            placeholder="Filter companyId..."
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
          />
        </div>
      </section>

      {/* Events Timeline */}
      <section className="timeline-container" aria-label="Recent Events Timeline">
        <div className="timeline-header">
          <span>Recent Saga Lifecycle &amp; Infrastructure Events</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {filteredEvents.length} events
          </span>
        </div>
        <table className="timeline-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Severity</th>
              <th>Tenant Scope</th>
              <th>Entity / Details</th>
              <th>Seq</th>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}
                >
                  Waiting for live telemetry events...
                </td>
              </tr>
            ) : (
              filteredEvents.slice(0, 50).map((ev, idx) => {
                const p = ev.payload || {};
                let badgeClass = 'badge-info';
                if (ev.severity === 'warn') badgeClass = 'badge-warn';
                if (ev.severity === 'error' || ev.severity === 'critical') badgeClass = 'badge-error';

                const details = p.stepName
                  ? `Step: ${p.stepName} (${p.stepStatus || ''})`
                  : p.workflowName
                  ? `Workflow: ${p.workflowName} (${p.status || ''})`
                  : p.message || JSON.stringify(p);

                return (
                  <tr key={ev.seq ? `seq-${ev.seq}` : `ev-${idx}`}>
                    <td style={{ color: 'var(--text-muted)' }}>{formatTimestamp(ev.ts)}</td>
                    <td>
                      <span className={`event-type-badge ${badgeClass}`}>{ev.type}</span>
                    </td>
                    <td style={{ textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 600 }}>
                      {ev.severity || 'info'}
                    </td>
                    <td>
                      {ev.tenantId ? (
                        <span style={{ color: '#60a5fa' }}>{ev.tenantId}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>system-wide</span>
                      )}
                    </td>
                    <td>{details}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{ev.seq ?? '--'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {/* Footer */}
      <footer className="monitoring-footer">
        <div>
          Last Successful Health Check:{' '}
          <span style={{ color: 'var(--text-main)' }}>{formatTimestamp(lastHealthTime)}</span>
        </div>
        <div>
          Last Data Update:{' '}
          <span style={{ color: 'var(--text-main)' }}>{formatTimestamp(lastDataTime)}</span>
        </div>
        <div>
          Server Sync: Monotonic Sequence{' '}
          <span style={{ color: 'var(--text-main)' }}>{lastSeq}</span>
        </div>
      </footer>
    </div>
  );
}

export default MonitoringDashboard;
