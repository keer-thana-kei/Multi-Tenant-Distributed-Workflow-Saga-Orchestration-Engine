'use strict';

/**
 * Prometheus Metrics Registry for Workflow Saga Engine & Monitoring Service.
 *
 * Implements Prometheus exposition format specification (v0.0.4):
 *  - Metric types: Counter, Gauge, Histogram
 *  - Cardinality safety: Enforces bounded label names and values
 *  - Strict exclusion of workflow IDs, user IDs, request IDs, or arbitrary tenant IDs
 *  - Thread-safe in-memory aggregation
 */

// ── Cardinality Guard ─────────────────────────────────────────────────────────
// Denylist unbounded label keys that cause high cardinality in Prometheus
const DISALLOWED_LABEL_KEYS = /^(workflow_?id|request_?id|user_?id|trace_?id|span_?id|email|token|secret)$/i;

function sanitizeLabels(labels = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(labels)) {
    if (DISALLOWED_LABEL_KEYS.test(k)) {
      continue; // Drop unbounded labels
    }
    // Convert to snake_case alphanumeric identifier
    const safeKey = k.replace(/[^a-zA-Z0-9_]/g, '_');
    const safeVal = String(v).slice(0, 100).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    safe[safeKey] = safeVal;
  }
  return safe;
}

function formatLabelString(labels) {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return '{' + entries.map(([k, v]) => `${k}="${v}"`).join(',') + '}';
}

// ── Metric Classes ────────────────────────────────────────────────────────────

class Counter {
  constructor(name, help, labelNames = []) {
    this.name = name;
    this.help = help;
    this.type = 'counter';
    this.labelNames = labelNames;
    this.values = new Map(); // labelString -> number
  }

  inc(labels = {}, value = 1) {
    if (value < 0) throw new Error('Counter can only be incremented by non-negative values');
    const safe = sanitizeLabels(labels);
    const key = formatLabelString(safe);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  reset() {
    this.values.clear();
  }

  get(labels = {}) {
    const key = formatLabelString(sanitizeLabels(labels));
    return this.values.get(key) || 0;
  }

  toPrometheus() {
    let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} counter\n`;
    if (this.values.size === 0) {
      out += `${this.name} 0\n`;
      return out;
    }
    for (const [labelStr, val] of this.values) {
      out += `${this.name}${labelStr} ${val}\n`;
    }
    return out;
  }
}

class Gauge {
  constructor(name, help, labelNames = []) {
    this.name = name;
    this.help = help;
    this.type = 'gauge';
    this.labelNames = labelNames;
    this.values = new Map(); // labelString -> number
  }

  set(labels = {}, value) {
    if (typeof labels === 'number') {
      value = labels;
      labels = {};
    }
    const safe = sanitizeLabels(labels);
    const key = formatLabelString(safe);
    this.values.set(key, Number(value));
  }

  inc(labels = {}, value = 1) {
    if (typeof labels === 'number') {
      value = labels;
      labels = {};
    }
    const safe = sanitizeLabels(labels);
    const key = formatLabelString(safe);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  dec(labels = {}, value = 1) {
    if (typeof labels === 'number') {
      value = labels;
      labels = {};
    }
    this.inc(labels, -value);
  }

  get(labels = {}) {
    const key = formatLabelString(sanitizeLabels(labels));
    return this.values.get(key) ?? 0;
  }

  reset() {
    this.values.clear();
  }

  toPrometheus() {
    let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} gauge\n`;
    if (this.values.size === 0) {
      out += `${this.name} 0\n`;
      return out;
    }
    for (const [labelStr, val] of this.values) {
      out += `${this.name}${labelStr} ${val}\n`;
    }
    return out;
  }
}

class Histogram {
  constructor(name, help, options = {}) {
    this.name = name;
    this.help = help;
    this.type = 'histogram';
    this.buckets = (options.buckets || [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]).sort((a, b) => a - b);
    this.labelNames = options.labelNames || [];
    // Map<labelKey, { sum: number, count: number, buckets: Map<number, number> }>
    this.series = new Map();
  }

  observe(labels = {}, value) {
    if (typeof labels === 'number') {
      value = labels;
      labels = {};
    }
    if (value === undefined || isNaN(value)) return;

    const safe = sanitizeLabels(labels);
    const labelKey = formatLabelString(safe);

    if (!this.series.has(labelKey)) {
      const bMap = new Map();
      this.buckets.forEach((b) => bMap.set(b, 0));
      this.series.set(labelKey, { sum: 0, count: 0, buckets: bMap, labels: safe });
    }

    const s = this.series.get(labelKey);
    s.sum += value;
    s.count += 1;

    for (const b of this.buckets) {
      if (value <= b) {
        s.buckets.set(b, s.buckets.get(b) + 1);
      }
    }
  }

  reset() {
    this.series.clear();
  }

  toPrometheus() {
    let out = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} histogram\n`;
    if (this.series.size === 0) {
      this.buckets.forEach((b) => {
        out += `${this.name}_bucket{le="${b}"} 0\n`;
      });
      out += `${this.name}_bucket{le="+Inf"} 0\n`;
      out += `${this.name}_sum 0\n`;
      out += `${this.name}_count 0\n`;
      return out;
    }

    for (const [_, s] of this.series) {
      let cumulative = 0;
      for (const b of this.buckets) {
        cumulative = s.buckets.get(b);
        const lStr = formatLabelString({ ...s.labels, le: String(b) });
        out += `${this.name}_bucket${lStr} ${cumulative}\n`;
      }
      const infLStr = formatLabelString({ ...s.labels, le: '+Inf' });
      out += `${this.name}_bucket${infLStr} ${s.count}\n`;
      const sumLStr = formatLabelString(s.labels);
      out += `${this.name}_sum${sumLStr} ${parseFloat(s.sum.toFixed(6))}\n`;
      out += `${this.name}_count${sumLStr} ${s.count}\n`;
    }
    return out;
  }
}

// ── Registry & Metric Definitions ─────────────────────────────────────────────

class Registry {
  constructor() {
    this.metrics = new Map();
    this.initStandardMetrics();
  }

  register(metric) {
    this.metrics.set(metric.name, metric);
    return metric;
  }

  getMetric(name) {
    return this.metrics.get(name);
  }

  initStandardMetrics() {
    // 1. HTTP metrics (bounded labels: method, route, status_code)
    this.httpRequestsTotal = this.register(
      new Counter(
        'http_requests_total',
        'Total number of HTTP requests handled',
        ['method', 'route', 'status_code']
      )
    );

    this.httpRequestDurationSeconds = this.register(
      new Histogram(
        'http_request_duration_seconds',
        'HTTP request latency duration in seconds',
        {
          buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
          labelNames: ['method', 'route', 'status_code'],
        }
      )
    );

    // 2. Workflow saga lifecycle totals (bounded labels: status)
    this.workflowLifecycleTotal = this.register(
      new Counter(
        'workflow_lifecycle_total',
        'Total number of workflow state transitions',
        ['status']
      )
    );

    // 3. Workflow execution duration (bounded labels: status)
    this.workflowExecutionDurationSeconds = this.register(
      new Histogram(
        'workflow_execution_duration_seconds',
        'Duration of workflow execution in seconds',
        {
          buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
          labelNames: ['status'],
        }
      )
    );

    // 4. Step retries
    this.workflowStepRetriesTotal = this.register(
      new Counter(
        'workflow_step_retries_total',
        'Total number of step execution retry attempts'
      )
    );

    // 5. Saga compensation attempts & failures
    this.workflowCompensationAttemptsTotal = this.register(
      new Counter(
        'workflow_compensation_attempts_total',
        'Total number of saga compensation/rollback routines initiated'
      )
    );

    this.workflowCompensationFailuresTotal = this.register(
      new Counter(
        'workflow_compensation_failures_total',
        'Total number of saga compensation/rollback routines that failed'
      )
    );

    // 6. Worker availability (1=healthy, 0.5=degraded, 0=down)
    this.workerAvailabilityStatus = this.register(
      new Gauge(
        'worker_availability_status',
        'Worker availability status (1=healthy, 0.5=degraded, 0=down)'
      )
    );

    // 7. Workflow queue depth (pending workflows awaiting execution)
    this.workflowQueueDepth = this.register(
      new Gauge(
        'workflow_queue_depth',
        'Number of pending workflows currently queued for execution'
      )
    );

    // 8. Health check failures
    this.healthCheckFailuresTotal = this.register(
      new Counter(
        'health_check_failures_total',
        'Total number of failed health checks by service',
        ['service']
      )
    );

    // 9. Database connection status (1=connected, 0=disconnected)
    this.databaseConnectionStatus = this.register(
      new Gauge(
        'database_connection_status',
        'MongoDB connection state (1=connected, 0=disconnected)'
      )
    );

    // 10. WebSocket connections & delivery failures
    this.websocketActiveConnections = this.register(
      new Gauge(
        'websocket_active_connections',
        'Number of active WebSocket dashboard connections'
      )
    );

    this.websocketDeliveryFailuresTotal = this.register(
      new Counter(
        'websocket_delivery_failures_total',
        'Total number of WebSocket event delivery failures'
      )
    );

    // 11. System resource utilization
    this.systemCpuUsagePercent = this.register(
      new Gauge(
        'system_cpu_usage_percent',
        'Current system CPU load percentage (0-100)'
      )
    );

    this.systemMemoryUsagePercent = this.register(
      new Gauge(
        'system_memory_usage_percent',
        'Current system memory utilization percentage (0-100)'
      )
    );

    this.systemMemoryUsedBytes = this.register(
      new Gauge(
        'system_memory_used_bytes',
        'Current system memory used in bytes'
      )
    );

    this.systemMemoryTotalBytes = this.register(
      new Gauge(
        'system_memory_total_bytes',
        'Total system memory in bytes'
      )
    );

    // 12. Stale metrics timestamp (for stale metrics alerting)
    this.workflowMetricsLastCollectedSeconds = this.register(
      new Gauge(
        'workflow_metrics_last_collected_timestamp_seconds',
        'Unix timestamp in seconds when workflow metrics were last successfully collected'
      )
    );

    // 13. Process uptime
    this.processUptimeSeconds = this.register(
      new Gauge(
        'process_uptime_seconds',
        'Uptime of the monitoring process in seconds'
      )
    );
  }

  updateFromState(state = {}, clientsCount = 0) {
    // Process uptime
    this.processUptimeSeconds.set(Math.floor(process.uptime()));

    // WebSocket active connections
    this.websocketActiveConnections.set(clientsCount);

    // Update system metrics if present
    if (state.metrics?.system) {
      const sys = state.metrics.system;
      if (typeof sys.cpu?.usagePercent === 'number') {
        this.systemCpuUsagePercent.set(sys.cpu.usagePercent);
      }
      if (typeof sys.memory?.usagePercent === 'number') {
        this.systemMemoryUsagePercent.set(sys.memory.usagePercent);
      }
      if (typeof sys.memory?.usedBytes === 'number') {
        this.systemMemoryUsedBytes.set(sys.memory.usedBytes);
      }
      if (typeof sys.memory?.totalBytes === 'number') {
        this.systemMemoryTotalBytes.set(sys.memory.totalBytes);
      }
    }

    // Update workflow queue depth
    if (state.metrics?.workflows?.global) {
      const g = state.metrics.workflows.global;
      if (typeof g.pending === 'number') {
        this.workflowQueueDepth.set(g.pending);
      }
      this.workflowMetricsLastCollectedSeconds.set(Math.floor(Date.now() / 1000));
    }

    // Update health & worker availability
    if (Array.isArray(state.health)) {
      const workerSvc = state.health.find((s) => s.name === 'workers');
      if (workerSvc) {
        if (workerSvc.status === 'healthy') this.workerAvailabilityStatus.set(1);
        else if (workerSvc.status === 'degraded') this.workerAvailabilityStatus.set(0.5);
        else this.workerAvailabilityStatus.set(0);
      }

      const dbSvc = state.health.find((s) => s.name === 'mongodb');
      if (dbSvc) {
        this.databaseConnectionStatus.set(dbSvc.status === 'healthy' ? 1 : 0);
      }

      state.health.forEach((s) => {
        if (s.status === 'down') {
          this.healthCheckFailuresTotal.inc({ service: s.name });
        }
      });
    }
  }

  toPrometheus() {
    let output = '';
    for (const metric of this.metrics.values()) {
      output += metric.toPrometheus() + '\n';
    }
    return output.trimEnd() + '\n';
  }

  resetAll() {
    for (const metric of this.metrics.values()) {
      metric.reset();
    }
  }
}

// Global registry singleton
const defaultRegistry = new Registry();

module.exports = {
  Counter,
  Gauge,
  Histogram,
  Registry,
  defaultRegistry,
  sanitizeLabels,
  formatLabelString,
};
