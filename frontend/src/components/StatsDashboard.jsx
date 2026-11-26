import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './StatsDashboard.css';

const DEFAULT_API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const DEFAULT_API_KEY = '';

export default function StatsDashboard() {
  // Credentials & Configuration
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [apiKey, setApiKey] = useState(DEFAULT_API_KEY);
  const [showKey, setShowKey] = useState(false);

  // Filters
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [datePreset, setDatePreset] = useState('30d');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  // Data States
  const [summary, setSummary] = useState(null);
  const [failures, setFailures] = useState(null);
  const [latency, setLatency] = useState(null);
  const [quota, setQuota] = useState(null);
  const [deadLetters, setDeadLetters] = useState(null);

  // Loading & Error States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // Heatmap hover tooltip state
  const [tooltip, setTooltip] = useState(null);

  // ── Helper: Format Numbers ──────────────────────────────────────────────
  const formatNum = (n) => (typeof n === 'number' ? n.toLocaleString() : '--');

  // ── Date Preset Handler ─────────────────────────────────────────────────
  const handlePresetChange = (preset) => {
    setDatePreset(preset);
    const now = new Date();
    const endStr = now.toISOString().split('T')[0];
    setEndDate(endStr);

    if (preset === '7d') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setStartDate(start.toISOString().split('T')[0]);
    } else if (preset === '30d') {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setStartDate(start.toISOString().split('T')[0]);
    } else if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    }
  };

  // ── Headers builder ─────────────────────────────────────────────────────
  const getHeaders = useCallback(() => {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['x-api-key'] = apiKey.trim();
    }
    return headers;
  }, [apiKey]);

  // ── Fetch Companies for Authenticated Tenant ─────────────────────────────
  const fetchCompanies = useCallback(async () => {
    if (!apiKey) return;
    try {
      const res = await fetch(`${apiUrl}/api/stats/companies`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setCompanies(json.data);
          if (json.data.length > 0 && !selectedCompanyId) {
            setSelectedCompanyId(json.data[0].id);
          }
        }
      }
    } catch (err) {
      console.warn('Could not load company list:', err.message);
    }
  }, [apiUrl, apiKey, getHeaders, selectedCompanyId]);

  // ── Fetch All Statistics ────────────────────────────────────────────────
  const fetchAllStats = useCallback(async () => {
    if (!apiKey) {
      setError('Please provide a valid x-api-key to authenticate.');
      return;
    }

    setLoading(true);
    setError(null);

    const queryParams = new URLSearchParams();
    if (selectedCompanyId) queryParams.set('companyId', selectedCompanyId);
    if (startDate) queryParams.set('startDate', startDate);
    if (endDate) queryParams.set('endDate', endDate);

    const qStr = queryParams.toString() ? `?${queryParams.toString()}` : '';

    try {
      const [sumRes, failRes, latRes, quoRes, dlRes] = await Promise.all([
        fetch(`${apiUrl}/api/stats/summary${qStr}`, { headers: getHeaders() }),
        fetch(`${apiUrl}/api/stats/failures${qStr}`, { headers: getHeaders() }),
        fetch(`${apiUrl}/api/stats/latency${qStr}`, { headers: getHeaders() }),
        fetch(`${apiUrl}/api/stats/quota${selectedCompanyId ? `?companyId=${selectedCompanyId}` : ''}`, {
          headers: getHeaders(),
        }),
        fetch(`${apiUrl}/api/stats/deadletters${selectedCompanyId ? `?companyId=${selectedCompanyId}` : ''}`, {
          headers: getHeaders(),
        }),
      ]);

      if (sumRes.status === 401 || failRes.status === 401) {
        throw new Error('Authentication failed (401). Invalid or missing API key.');
      }
      if (sumRes.status === 403 || failRes.status === 403) {
        throw new Error('Access denied (403). Requested company does not belong to authenticated tenant.');
      }

      const [sumJson, failJson, latJson, quoJson, dlJson] = await Promise.all([
        sumRes.json(),
        failRes.json(),
        latRes.json(),
        quoRes.json(),
        dlRes.json(),
      ]);

      if (!sumJson.success) throw new Error(sumJson.message || 'Failed to fetch summary stats');
      if (!failJson.success) throw new Error(failJson.message || 'Failed to fetch failure stats');
      if (!latJson.success) throw new Error(latJson.message || 'Failed to fetch latency stats');
      if (!quoJson.success) throw new Error(quoJson.message || 'Failed to fetch quota stats');

      setSummary(sumJson.data);
      setFailures(failJson.data);
      setLatency(latJson.data);
      setQuota(quoJson.data);
      if (dlJson.success) setDeadLetters(dlJson.data);
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, apiKey, selectedCompanyId, startDate, endDate, getHeaders]);

  // Initial load
  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  useEffect(() => {
    fetchAllStats();
  }, [fetchAllStats]);

  // ── Render Helpers for SVG Charts ────────────────────────────────────────

  // 1. Success vs Failed Donut Chart
  const renderStatusDonut = () => {
    if (!summary || summary.total === 0) {
      return <div className="stats-empty">No execution status data recorded for this period.</div>;
    }

    const { success = 0, failed = 0, running = 0, pending = 0, total = 0 } = summary;
    const slices = [
      { label: 'Success', value: success, color: '#10b981' },
      { label: 'Failed / Compensated', value: failed, color: '#ef4444' },
      { label: 'Running', value: running, color: '#3b82f6' },
      { label: 'Pending', value: pending, color: '#6b7280' },
    ].filter((s) => s.value > 0);

    const size = 200;
    const strokeWidth = 28;
    const radius = (size - strokeWidth) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;

    let accumulatedAngle = 0;

    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="stats-chart-svg">
            <g transform={`rotate(-90 ${center} ${center})`}>
              {slices.map((slice, i) => {
                const strokeDasharray = `${(slice.value / total) * circumference} ${circumference}`;
                const strokeDashoffset = -accumulatedAngle;
                accumulatedAngle += (slice.value / total) * circumference;

                return (
                  <circle
                    key={i}
                    cx={center}
                    cy={center}
                    r={radius}
                    fill="transparent"
                    stroke={slice.color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDasharray}
                    strokeDashoffset={strokeDashoffset}
                  />
                );
              })}
            </g>
            <text x={center} y={center - 4} textAnchor="middle" className="donut-center-value">
              {summary.successRate}%
            </text>
            <text x={center} y={center + 18} textAnchor="middle" className="donut-center-label">
              Success Rate
            </text>
          </svg>
        </div>
        <div className="chart-legend">
          {slices.map((slice, i) => (
            <div key={i} className="legend-item">
              <span className="legend-swatch" style={{ background: slice.color }} />
              <span>
                {slice.label}: <strong>{slice.value}</strong> ({((slice.value / total) * 100).toFixed(1)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // 2. Failure Heatmap (7 Days × 24 Hours)
  const renderHeatmap = () => {
    if (!failures || !failures.failureHeatmap) {
      return <div className="stats-empty">No failure heatmap data available.</div>;
    }

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hours = Array.from({ length: 24 }, (_, i) => i);

    // Map heatmap list into a matrix
    const matrix = {};
    let maxCount = 1;
    failures.failureHeatmap.forEach((item) => {
      const key = `${item.dayOfWeek}-${item.hour}`;
      matrix[key] = item.count;
      if (item.count > maxCount) maxCount = item.count;
    });

    const cellWidth = 26;
    const cellHeight = 22;
    const labelWidth = 40;
    const topHeaderHeight = 24;
    const svgWidth = labelWidth + 24 * cellWidth + 20;
    const svgHeight = topHeaderHeight + 7 * cellHeight + 10;

    const getColor = (count) => {
      if (!count || count === 0) return '#1e293b';
      const intensity = Math.min(1, count / maxCount);
      if (intensity < 0.25) return '#7f1d1d';
      if (intensity < 0.5) return '#b91c1c';
      if (intensity < 0.75) return '#dc2626';
      return '#ef4444';
    };

    return (
      <div className="heatmap-wrapper">
        <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="stats-chart-svg">
          {/* Hour labels on top */}
          {hours.map((h) => (
            <text
              key={`h-${h}`}
              x={labelWidth + h * cellWidth + cellWidth / 2}
              y={14}
              fontSize="10"
              fill="#94a3b8"
              textAnchor="middle"
            >
              {h}h
            </text>
          ))}

          {/* Days on left and grid cells */}
          {days.map((dayName, dIdx) => {
            const dayOfWeek = dIdx + 1; // Mongo $dayOfWeek: 1 = Sun, 7 = Sat
            const y = topHeaderHeight + dIdx * cellHeight;

            return (
              <g key={`d-${dIdx}`}>
                <text x={labelWidth - 8} y={y + 15} fontSize="11" fill="#94a3b8" textAnchor="end">
                  {dayName}
                </text>
                {hours.map((h) => {
                  const count = matrix[`${dayOfWeek}-${h}`] || 0;
                  const x = labelWidth + h * cellWidth;

                  return (
                    <rect
                      key={`cell-${dIdx}-${h}`}
                      x={x}
                      y={y}
                      width={cellWidth - 2}
                      height={cellHeight - 2}
                      fill={getColor(count)}
                      className="heatmap-cell"
                      onMouseEnter={(e) => {
                        const rect = e.target.getBoundingClientRect();
                        setTooltip({
                          x: rect.left + window.scrollX,
                          y: rect.top + window.scrollY - 30,
                          text: `${dayName} at ${h}:00 — ${count} failure${count === 1 ? '' : 's'}`,
                        });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>

        {tooltip && (
          <div
            className="heatmap-tooltip"
            style={{
              position: 'fixed',
              left: tooltip.x,
              top: tooltip.y,
            }}
          >
            {tooltip.text}
          </div>
        )}

        <div className="chart-legend" style={{ marginTop: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Frequency:</span>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#1e293b' }} />
            <span>0</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#7f1d1d' }} />
            <span>Low</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#dc2626' }} />
            <span>Medium</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#ef4444' }} />
            <span>High ({maxCount})</span>
          </div>
        </div>
      </div>
    );
  };

  // 3. Execution Latency Trend Line Chart
  const renderLatencyChart = () => {
    if (!latency || !latency.latencyTrend || latency.latencyTrend.length === 0) {
      return <div className="stats-empty">No completed execution latency data recorded.</div>;
    }

    const data = latency.latencyTrend;
    const width = 600;
    const height = 220;
    const padX = 50;
    const padY = 30;

    const maxVal = Math.max(...data.map((d) => d.avgMs), 100);
    const minVal = 0;

    const points = data.map((d, i) => {
      const x = padX + (i / Math.max(data.length - 1, 1)) * (width - 2 * padX);
      const y = height - padY - ((d.avgMs - minVal) / (maxVal - minVal)) * (height - 2 * padY);
      return { x, y, ...d };
    });

    const pathD = points.reduce((acc, pt, i) => (i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`), '');

    return (
      <div>
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="stats-chart-svg">
          {/* Horizontal grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
            const y = height - padY - ratio * (height - 2 * padY);
            const val = Math.round(minVal + ratio * (maxVal - minVal));
            return (
              <g key={idx}>
                <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="#334155" strokeDasharray="3 3" />
                <text x={padX - 8} y={y + 4} fontSize="10" fill="#94a3b8" textAnchor="end">
                  {val >= 1000 ? `${(val / 1000).toFixed(1)}s` : `${val}ms`}
                </text>
              </g>
            );
          })}

          {/* Area fill */}
          {points.length > 1 && (
            <path
              d={`${pathD} L ${points[points.length - 1].x} ${height - padY} L ${points[0].x} ${height - padY} Z`}
              fill="rgba(59, 130, 246, 0.15)"
            />
          )}

          {/* Line */}
          <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2.5" />

          {/* Data Points */}
          {points.map((pt, i) => (
            <g key={i}>
              <circle cx={pt.x} cy={pt.y} r="4" fill="#3b82f6" stroke="#0f172a" strokeWidth="2" />
              <text x={pt.x} y={height - 10} fontSize="10" fill="#94a3b8" textAnchor="middle">
                {pt.date.slice(5)}
              </text>
            </g>
          ))}
        </svg>

        <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '0.5rem', fontSize: '0.85rem' }}>
          <div>
            Avg Latency: <strong style={{ color: '#60a5fa' }}>{latency.avgDuration}ms</strong>
          </div>
          <div>
            Min Latency: <strong style={{ color: '#10b981' }}>{latency.minDuration}ms</strong>
          </div>
          <div>
            Max Latency: <strong style={{ color: '#f59e0b' }}>{latency.maxDuration}ms</strong>
          </div>
        </div>
      </div>
    );
  };

  // 4. Execution Duration Distribution Bar Chart
  const renderDistributionChart = () => {
    if (!latency || !latency.durationDistribution || latency.durationDistribution.length === 0) {
      return <div className="stats-empty">No duration distribution data.</div>;
    }

    const dist = latency.durationDistribution;
    const maxCount = Math.max(...dist.map((d) => d.count), 1);
    const width = 500;
    const height = 180;
    const barWidth = 45;
    const gap = (width - 80 - dist.length * barWidth) / Math.max(dist.length - 1, 1);

    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="stats-chart-svg">
        {dist.map((item, i) => {
          const barHeight = (item.count / maxCount) * (height - 60);
          const x = 50 + i * (barWidth + gap);
          const y = height - 30 - barHeight;

          return (
            <g key={i}>
              <rect x={x} y={y} width={barWidth} height={barHeight} fill="#3b82f6" rx="4" />
              <text x={x + barWidth / 2} y={y - 6} fontSize="11" fill="#f8fafc" textAnchor="middle" fontWeight="600">
                {item.count}
              </text>
              <text x={x + barWidth / 2} y={height - 10} fontSize="10" fill="#94a3b8" textAnchor="middle">
                {item.bucket}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  // 5. Step Retry & Attempt Analytics
  const renderStepRetryStats = () => {
    if (!failures || !failures.stepRetryStats || failures.stepRetryStats.length === 0) {
      return <div className="stats-empty">No steps required retries in this execution window.</div>;
    }

    const retries = failures.stepRetryStats;
    const maxRetries = Math.max(...retries.map((r) => r.totalRetries), 1);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {retries.map((step, idx) => {
          const pct = Math.round((step.totalRetries / maxRetries) * 100);
          return (
            <div key={idx} style={{ background: 'var(--bg-base)', padding: '0.75rem', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#f8fafc' }}>{step.stepName}</span>
                <span style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: 600 }}>
                  {step.totalRetries} retries ({step.count} executions)
                </span>
              </div>
              <div className="rate-bar-track">
                <div className="rate-bar-fill" style={{ width: `${pct}%`, background: '#f59e0b' }} />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '0.35rem',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                }}
              >
                <span>Max Attempts: {step.maxAttempts}</span>
                <span>Avg Attempts: {step.avgAttempts}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // 6. Quota Utilization Radial Gauge / Progress
  const renderQuotaUtilization = () => {
    if (!quota) {
      return <div className="stats-empty">No quota metrics available.</div>;
    }

    const {
      tenantName = 'Default Tenant',
      totalQuota = 60,
      usedQuota = 0,
      remainingQuota = 60,
      quotaUtilization = 0,
      totalExecutions = 0,
    } = quota;

    const size = 180;
    const strokeWidth = 20;
    const radius = (size - strokeWidth) / 2;
    const center = size / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = Math.min(100, quotaUtilization);
    const strokeDashoffset = circumference - (progress / 100) * circumference;

    const gaugeColor = progress >= 100 ? '#ef4444' : progress >= 80 ? '#f59e0b' : '#10b981';

    return (
      <div className="quota-grid">
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <g transform={`rotate(-90 ${center} ${center})`}>
              <circle
                cx={center}
                cy={center}
                r={radius}
                fill="transparent"
                stroke="var(--bg-base)"
                strokeWidth={strokeWidth}
              />
              <circle
                cx={center}
                cy={center}
                r={radius}
                fill="transparent"
                stroke={gaugeColor}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.5s ease' }}
              />
            </g>
            <text x={center} y={center - 4} textAnchor="middle" className="donut-center-value">
              {quotaUtilization}%
            </text>
            <text x={center} y={center + 18} textAnchor="middle" className="donut-center-label">
              Utilized
            </text>
          </svg>
        </div>

        <div className="quota-details">
          <div className="quota-detail-row">
            <span className="quota-label">Tenant Name:</span>
            <span className="quota-value">{tenantName}</span>
          </div>
          <div className="quota-detail-row">
            <span className="quota-label">Rate Limit Quota:</span>
            <span className="quota-value">{totalQuota} runs / min</span>
          </div>
          <div className="quota-detail-row">
            <span className="quota-label">Used This Minute:</span>
            <span className="quota-value" style={{ color: gaugeColor }}>
              {usedQuota} runs
            </span>
          </div>
          <div className="quota-detail-row">
            <span className="quota-label">Remaining Quota:</span>
            <span className="quota-value">{remainingQuota} runs</span>
          </div>
          <div className="quota-detail-row">
            <span className="quota-label">Lifetime Executions:</span>
            <span className="quota-value">{formatNum(totalExecutions)}</span>
          </div>

          {quota.quotaStatus === 'exceeded' || progress >= 100 ? (
            <div style={{ marginTop: '0.75rem', padding: '0.4rem 0.75rem', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontWeight: 600, fontSize: '0.8rem', textAlign: 'center' }}>
              🚨 100% Quota Exceeded Alert — Rate Limiting Active
            </div>
          ) : quota.quotaStatus === 'warning' || progress >= 80 ? (
            <div style={{ marginTop: '0.75rem', padding: '0.4rem 0.75rem', borderRadius: '6px', background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', fontWeight: 600, fontSize: '0.8rem', textAlign: 'center' }}>
              ⚠️ 80% Quota Warning Threshold Reached
            </div>
          ) : (
            <div style={{ marginTop: '0.75rem', padding: '0.4rem 0.75rem', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', fontWeight: 600, fontSize: '0.8rem', textAlign: 'center' }}>
              ✅ Quota Normal (&lt;80%)
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="stats-container" role="main" aria-label="Monitoring Analytics Dashboard">
      {/* ── Header ── */}
      <header className="stats-header">
        <div>
          <h1 className="stats-title">
            <span className="status-dot dot-healthy" aria-hidden="true" />
            Tenant Monitoring Analytics Dashboard
          </h1>
          <p className="stats-subtitle">
            Multi-tenant saga orchestration performance, failure distribution, and quota observability
          </p>
        </div>

        {lastRefreshed && (
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Last Refreshed: <span style={{ color: 'var(--text-main)' }}>{lastRefreshed}</span>
          </div>
        )}
      </header>

      {/* ── Authentication & API Key Bar ── */}
      <section className="api-key-bar" aria-label="Tenant Credentials Bar">
        <label htmlFor="apiKeyInput">Tenant API Key (x-api-key):</label>
        <input
          id="apiKeyInput"
          type={showKey ? 'text' : 'password'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Enter wf_... API Key"
        />
        <button type="button" className="api-key-toggle" onClick={() => setShowKey(!showKey)}>
          {showKey ? 'Hide' : 'Show'}
        </button>

        <label htmlFor="apiUrlInput" style={{ marginLeft: '0.5rem' }}>
          Backend API:
        </label>
        <input
          id="apiUrlInput"
          type="text"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          style={{ width: '180px' }}
        />
      </section>

      {/* ── Error Banner ── */}
      {error && (
        <div className="stats-error" role="alert">
          <span style={{ fontWeight: 'bold' }}>⚠️ Error:</span> {error}
        </div>
      )}

      {/* ── Filters Bar ── */}
      <section className="stats-filter-bar" aria-label="Dashboard Filters">
        {/* Company Selector (strictly restricted to authenticated tenant) */}
        <div className="stats-filter-group">
          <label htmlFor="companySelect">Company Scope:</label>
          <select
            id="companySelect"
            className="stats-filter-input"
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
          >
            {companies.length > 0 ? (
              companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id.slice(-6)})
                </option>
              ))
            ) : (
              <option value="">Authenticated Tenant Company</option>
            )}
          </select>
        </div>

        {/* Date Presets */}
        <div className="stats-filter-group">
          <label>Date Range:</label>
          <button
            type="button"
            className="api-key-toggle"
            style={{
              background: datePreset === '7d' ? 'var(--accent-blue)' : 'transparent',
              color: datePreset === '7d' ? '#fff' : 'var(--text-muted)',
            }}
            onClick={() => handlePresetChange('7d')}
          >
            Last 7 Days
          </button>
          <button
            type="button"
            className="api-key-toggle"
            style={{
              background: datePreset === '30d' ? 'var(--accent-blue)' : 'transparent',
              color: datePreset === '30d' ? '#fff' : 'var(--text-muted)',
            }}
            onClick={() => handlePresetChange('30d')}
          >
            Last 30 Days
          </button>
          <button
            type="button"
            className="api-key-toggle"
            style={{
              background: datePreset === 'all' ? 'var(--accent-blue)' : 'transparent',
              color: datePreset === 'all' ? '#fff' : 'var(--text-muted)',
            }}
            onClick={() => handlePresetChange('all')}
          >
            All Time
          </button>
        </div>

        {/* Custom Start & End Dates */}
        <div className="stats-filter-group">
          <label htmlFor="startDate">From:</label>
          <input
            id="startDate"
            type="date"
            className="stats-filter-input"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setDatePreset('custom');
            }}
          />
        </div>

        <div className="stats-filter-group">
          <label htmlFor="endDate">To:</label>
          <input
            id="endDate"
            type="date"
            className="stats-filter-input"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setDatePreset('custom');
            }}
          />
        </div>

        <button
          type="button"
          className="stats-refresh-btn"
          onClick={fetchAllStats}
          disabled={loading}
          aria-label="Refresh Statistics"
        >
          {loading ? 'Refreshing...' : '↻ Apply & Refresh'}
        </button>
      </section>

      {/* ── Loading Indicator ── */}
      {loading && !summary && (
        <div className="stats-loading">
          <div className="stats-spinner" />
          <span>Loading telemetry analytics...</span>
        </div>
      )}

      {/* ── Summary Statistic Cards ── */}
      <section aria-labelledby="summary-cards-title">
        <div className="stats-section-title" id="summary-cards-title">
          Execution Lifecycle Summary
        </div>
        <div className="stats-summary-grid">
          <div className="stats-card">
            <div className="stats-card-title">Total Executions</div>
            <div className="stats-card-value">{formatNum(summary?.total)}</div>
            <div className="stats-card-subtitle">All triggered workflow runs</div>
          </div>

          <div className="stats-card">
            <div className="stats-card-title">Successful Executions</div>
            <div className="stats-card-value" style={{ color: 'var(--status-healthy)' }}>
              {formatNum(summary?.success)}
            </div>
            <div className="rate-bar-track">
              <div
                className="rate-bar-fill"
                style={{ width: `${summary?.successRate || 0}%`, background: 'var(--status-healthy)' }}
              />
            </div>
            <div className="stats-card-subtitle">{summary?.successRate || 0}% success rate</div>
          </div>

          <div className="stats-card">
            <div className="stats-card-title">Failed / Compensated</div>
            <div className="stats-card-value" style={{ color: 'var(--status-down)' }}>
              {formatNum(summary?.failed)}
            </div>
            <div className="rate-bar-track">
              <div
                className="rate-bar-fill"
                style={{ width: `${summary?.failureRate || 0}%`, background: 'var(--status-down)' }}
              />
            </div>
            <div className="stats-card-subtitle">{summary?.failureRate || 0}% failure rate</div>
          </div>

          <div className="stats-card">
            <div className="stats-card-title">Active Running Sagas</div>
            <div className="stats-card-value" style={{ color: 'var(--accent-blue)' }}>
              {formatNum(summary?.running)}
            </div>
            <div className="stats-card-subtitle">In-flight orchestrations</div>
          </div>

          <div className="stats-card">
            <div className="stats-card-title">Average Latency</div>
            <div className="stats-card-value" style={{ color: '#a78bfa' }}>
              {latency ? `${formatNum(latency.avgDuration)}ms` : '--'}
            </div>
            <div className="stats-card-subtitle">Completed runs duration</div>
          </div>

          <div className="stats-card">
            <div className="stats-card-title">Quota Utilization</div>
            <div className="stats-card-value" style={{ color: quota && (quota.quotaUtilization >= 100 ? '#ef4444' : quota.quotaUtilization >= 80 ? '#f59e0b' : '#38bdf8') }}>
              {quota ? `${quota.quotaUtilization}%` : '--'}
            </div>
            <div className="stats-card-subtitle">
              {quota ? (quota.quotaUtilization >= 100 ? '🚨 100% Exceeded' : quota.quotaUtilization >= 80 ? '⚠️ 80% Warning' : `${quota.usedQuota} / ${quota.totalQuota} rpm`) : 'Rate limit'}
            </div>
          </div>

          <div className="stats-card">
            <div className="stats-card-title">Dead Letters</div>
            <div className="stats-card-value" style={{ color: deadLetters && deadLetters.open > 0 ? '#ef4444' : '#10b981' }}>
              {deadLetters ? formatNum(deadLetters.open) : '--'}
            </div>
            <div className="stats-card-subtitle">
              {deadLetters ? `${deadLetters.total} total (${deadLetters.replayed} replayed, ${deadLetters.discarded} discarded)` : 'Unresolved failures'}
            </div>
          </div>
        </div>
      </section>

      {/* ── Top Charts Row: Success vs Failed & Quota ── */}
      <div className="stats-charts-grid">
        <section className="stats-section" aria-labelledby="status-ratio-title">
          <div className="stats-section-title" id="status-ratio-title">
            Execution Status Distribution
          </div>
          {renderStatusDonut()}
        </section>

        <section className="stats-section" aria-labelledby="quota-section-title">
          <div className="stats-section-title" id="quota-section-title">
            Tenant Quota &amp; Rate Limit Observability
          </div>
          {renderQuotaUtilization()}
        </section>
      </div>

      {/* ── Middle Charts Row: Latency Line Chart & Duration Distribution ── */}
      <div className="stats-charts-grid">
        <section className="stats-section" aria-labelledby="latency-chart-title">
          <div className="stats-section-title" id="latency-chart-title">
            Execution Latency Trend (Over Time)
          </div>
          {renderLatencyChart()}
        </section>

        <section className="stats-section" aria-labelledby="duration-dist-title">
          <div className="stats-section-title" id="duration-dist-title">
            Execution Duration Distribution
          </div>
          {renderDistributionChart()}
        </section>
      </div>

      {/* ── Bottom Row: Failure Heatmap & Step Retries ── */}
      <div className="stats-charts-grid">
        <section className="stats-section" aria-labelledby="heatmap-title">
          <div className="stats-section-title" id="heatmap-title">
            Failure Incident Heatmap (Day of Week × Hour of Day)
          </div>
          {renderHeatmap()}
        </section>

        <section className="stats-section" aria-labelledby="step-retries-title">
          <div className="stats-section-title" id="step-retries-title">
            Step Retry &amp; Attempt Analytics
          </div>
          {renderStepRetryStats()}
        </section>
      </div>

      {/* ── Dead Letter Queue Details ── */}
      <div className="stats-charts-grid">
        <section className="stats-section" aria-labelledby="deadletter-title" style={{ gridColumn: '1 / -1' }}>
          <div className="stats-section-title" id="deadletter-title">
            Dead Letter Queue
          </div>
          {!deadLetters || deadLetters.total === 0 ? (
            <div className="stats-empty">No dead-letter entries recorded for this tenant.</div>
          ) : (
            <div>
              {/* Summary badges */}
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <div style={{ padding: '0.5rem 1rem', borderRadius: '8px', background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 600 }}>
                  Open: {deadLetters.open}
                </div>
                <div style={{ padding: '0.5rem 1rem', borderRadius: '8px', background: 'rgba(16,185,129,0.15)', color: '#10b981', fontWeight: 600 }}>
                  Replayed: {deadLetters.replayed}
                </div>
                <div style={{ padding: '0.5rem 1rem', borderRadius: '8px', background: 'rgba(107,114,128,0.15)', color: '#6b7280', fontWeight: 600 }}>
                  Discarded: {deadLetters.discarded}
                </div>
              </div>

              {/* Failure reasons breakdown */}
              {deadLetters.byReason && deadLetters.byReason.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Open Entries by Reason:</div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {deadLetters.byReason.map((r, i) => (
                      <div key={i} style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', background: 'var(--bg-base)', fontSize: '0.85rem' }}>
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>{r.reason}</span>: {r.count}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent open entries table */}
              {deadLetters.recentOpen && deadLetters.recentOpen.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Recent Open Entries:</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #334155' }}>
                          <th style={{ textAlign: 'left', padding: '0.5rem', color: '#94a3b8' }}>Step</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem', color: '#94a3b8' }}>Reason</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem', color: '#94a3b8' }}>Error</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem', color: '#94a3b8' }}>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deadLetters.recentOpen.map((entry, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                            <td style={{ padding: '0.5rem', color: '#f8fafc', fontWeight: 600 }}>{entry.stepName}</td>
                            <td style={{ padding: '0.5rem', color: '#f59e0b' }}>{entry.reason}</td>
                            <td style={{ padding: '0.5rem', color: '#94a3b8', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {entry.error || '—'}
                            </td>
                            <td style={{ padding: '0.5rem', color: '#94a3b8' }}>
                              {new Date(entry.createdAt).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
