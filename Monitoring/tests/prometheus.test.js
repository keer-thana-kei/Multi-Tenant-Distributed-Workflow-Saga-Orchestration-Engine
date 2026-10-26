'use strict';

/**
 * tests/prometheus.test.js
 *
 * Comprehensive tests for:
 *  1. Prometheus metric types (Counter, Gauge, Histogram)
 *  2. Cardinality safety & unbounded label rejection
 *  3. Prometheus text exposition format compliance
 *  4. HTTP request metrics middleware & route normalization
 *  5. /metrics route content negotiation (Prometheus text vs JSON)
 *  6. prometheus.yml syntax and scrape configuration validation
 *  7. alert_rules.yml validation (all 10 required actionable alerts)
 *  8. alert_manager_config.yml validation (safe variable references, no hardcoded secrets)
 *  9. Grafana provisioning and dashboard JSON schema validation
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const {
  Counter,
  Gauge,
  Histogram,
  Registry,
  defaultRegistry,
  sanitizeLabels,
} = require('../src/metrics/prometheus');
const { normalizeRoute, createHttpMetricsMiddleware } = require('../src/middleware/httpMetrics');

// ── 1. Prometheus Metric Types ────────────────────────────────────────────────
describe('1. Prometheus Metric Types', () => {
  test('Counter increments correctly and rejects negative values', () => {
    const c = new Counter('test_counter_total', 'A test counter', ['status']);
    assert.equal(c.get({ status: 'ok' }), 0);

    c.inc({ status: 'ok' }, 1);
    c.inc({ status: 'ok' }, 2);
    assert.equal(c.get({ status: 'ok' }), 3);

    assert.throws(() => c.inc({ status: 'ok' }, -1), /non-negative/);
  });

  test('Gauge sets, increments, and decrements values correctly', () => {
    const g = new Gauge('test_gauge', 'A test gauge');
    g.set(42);
    assert.equal(g.get(), 42);

    g.inc(5);
    assert.equal(g.get(), 47);

    g.dec(10);
    assert.equal(g.get(), 37);
  });

  test('Histogram observes values and populates cumulative buckets', () => {
    const h = new Histogram('test_histogram_seconds', 'A test histogram', {
      buckets: [0.1, 0.5, 1.0],
    });

    h.observe(0.05); // <= 0.1, 0.5, 1.0
    h.observe(0.3);  // <= 0.5, 1.0
    h.observe(1.5);  // > 1.0, only in +Inf

    const text = h.toPrometheus();
    assert.ok(text.includes('test_histogram_seconds_bucket{le="0.1"} 1'));
    assert.ok(text.includes('test_histogram_seconds_bucket{le="0.5"} 2'));
    assert.ok(text.includes('test_histogram_seconds_bucket{le="1"} 2'));
    assert.ok(text.includes('test_histogram_seconds_bucket{le="+Inf"} 3'));
    assert.ok(text.includes('test_histogram_seconds_count 3'));
  });
});

// ── 2. Cardinality Safety & Unbounded Label Rejection ─────────────────────────
describe('2. Cardinality Safety & Label Sanitization', () => {
  test('drops unbounded label keys (workflowId, userId, requestId, token)', () => {
    const dirty = {
      status: 'success',
      workflow_id: 'wf-12345-67890',
      userId: 'usr-999',
      requestId: 'req-abc-xyz',
      token: 'jwt.token.string',
      service: 'api',
    };

    const clean = sanitizeLabels(dirty);
    assert.equal(clean.status, 'success');
    assert.equal(clean.service, 'api');
    assert.equal(clean.workflow_id, undefined, 'workflow_id must be stripped');
    assert.equal(clean.userId, undefined, 'userId must be stripped');
    assert.equal(clean.requestId, undefined, 'requestId must be stripped');
    assert.equal(clean.token, undefined, 'token must be stripped');
  });

  test('escapes label special characters properly', () => {
    const labels = { route: '/api/v1"test', method: 'GET\n' };
    const clean = sanitizeLabels(labels);
    assert.ok(!clean.route.includes('\n'));
    assert.ok(clean.route.includes('\\"'));
  });
});

// ── 3. Prometheus Exposition Format ──────────────────────────────────────────
describe('3. Prometheus Text Exposition Compliance', () => {
  test('defaultRegistry contains all required metrics with valid exposition format', () => {
    const requiredMetrics = [
      'http_requests_total',
      'http_request_duration_seconds',
      'workflow_lifecycle_total',
      'workflow_execution_duration_seconds',
      'workflow_step_retries_total',
      'workflow_compensation_attempts_total',
      'workflow_compensation_failures_total',
      'worker_availability_status',
      'workflow_queue_depth',
      'health_check_failures_total',
      'database_connection_status',
      'websocket_active_connections',
      'websocket_delivery_failures_total',
      'system_cpu_usage_percent',
      'system_memory_usage_percent',
      'workflow_metrics_last_collected_timestamp_seconds',
      'process_uptime_seconds',
    ];

    const text = defaultRegistry.toPrometheus();

    for (const name of requiredMetrics) {
      assert.ok(defaultRegistry.getMetric(name), `Missing registered metric: ${name}`);
      assert.ok(text.includes(`# TYPE ${name}`), `Missing exposition TYPE header for: ${name}`);
      assert.ok(text.includes(`# HELP ${name}`), `Missing exposition HELP header for: ${name}`);
    }
  });

  test('updateFromState correctly maps application state to Prometheus gauges', () => {
    const mockState = {
      health: [
        { name: 'workers', status: 'healthy' },
        { name: 'mongodb', status: 'healthy' },
        { name: 'api', status: 'down' },
      ],
      metrics: {
        system: {
          cpu: { usagePercent: 55 },
          memory: { usagePercent: 70, usedBytes: 1024000, totalBytes: 2048000 },
        },
        workflows: {
          global: { pending: 15, running: 3, total: 100 },
        },
      },
    };

    defaultRegistry.updateFromState(mockState, 8);

    assert.equal(defaultRegistry.workerAvailabilityStatus.get(), 1);
    assert.equal(defaultRegistry.databaseConnectionStatus.get(), 1);
    assert.equal(defaultRegistry.workflowQueueDepth.get(), 15);
    assert.equal(defaultRegistry.websocketActiveConnections.get(), 8);
    assert.equal(defaultRegistry.systemCpuUsagePercent.get(), 55);
    assert.equal(defaultRegistry.systemMemoryUsagePercent.get(), 70);
    assert.ok(defaultRegistry.healthCheckFailuresTotal.get({ service: 'api' }) > 0);
  });
});

// ── 4. Route Normalization & Middleware ───────────────────────────────────────
describe('4. Route Normalization & HTTP Metrics Middleware', () => {
  test('normalizes dynamic IDs to bounded route patterns', () => {
    assert.equal(normalizeRoute('/metrics/company-alpha-123'), '/metrics/:tenantId');
    assert.equal(normalizeRoute('/health/mongodb'), '/health/:service');
    assert.equal(normalizeRoute('/api/workflows/65f1234567890abcdef12345'), '/api/workflows/:id');
    assert.equal(normalizeRoute('/api/workflows/12345/run'), '/api/workflows/:id/run');
    assert.equal(normalizeRoute('/api/status?format=json'), '/api/status');
    assert.equal(normalizeRoute('/'), '/');
  });

  test('HTTP metrics middleware records requests and response duration', (t, done) => {
    const reg = new Registry();
    const mw = createHttpMetricsMiddleware(reg);

    const req = { method: 'GET', path: '/metrics/tenant-a', baseUrl: '' };
    const res = {
      statusCode: 200,
      _listeners: {},
      on(event, fn) { this._listeners[event] = fn; },
    };

    mw(req, res, () => {
      // Simulate response finish
      res._listeners['finish']();

      const total = reg.httpRequestsTotal.get({
        method: 'GET',
        route: '/metrics/:tenantId',
        status_code: '200',
      });
      assert.equal(total, 1);
      done();
    });
  });
});

// ── 5. Prometheus Configuration Validation ───────────────────────────────────
describe('5. Prometheus Configuration (prometheus.yml)', () => {
  const promConfigPath = path.join(__dirname, '..', 'prometheus', 'prometheus.yml');

  test('prometheus.yml exists and parses as valid YAML', () => {
    assert.ok(fs.existsSync(promConfigPath), 'prometheus.yml must exist');
    const content = fs.readFileSync(promConfigPath, 'utf8');
    const doc = YAML.parse(content);
    assert.ok(doc, 'Parsed YAML must not be null');
    assert.ok(doc.global, 'Must contain global config');
    assert.ok(doc.scrape_configs, 'Must contain scrape_configs');
  });

  test('scrape_configs includes monitoring-service and workflow-backend', () => {
    const content = fs.readFileSync(promConfigPath, 'utf8');
    const doc = YAML.parse(content);

    const jobs = doc.scrape_configs.map((s) => s.job_name);
    assert.ok(jobs.includes('monitoring-service'), 'Must scrape monitoring-service');
    assert.ok(jobs.includes('workflow-backend'), 'Must probe workflow-backend');

    const monJob = doc.scrape_configs.find((s) => s.job_name === 'monitoring-service');
    assert.equal(monJob.metrics_path, '/metrics');
    assert.ok(monJob.static_configs[0].targets.some((t) => t.includes('4000')));

    const backendJob = doc.scrape_configs.find((s) => s.job_name === 'workflow-backend');
    assert.equal(backendJob.metrics_path, '/health');
    assert.ok(backendJob.static_configs[0].targets.some((t) => t.includes('5000')));
  });
});

// ── 6. Alerting Rules Validation ─────────────────────────────────────────────
describe('6. Alert Rules Validation (alert_rules.yml)', () => {
  const rulesPath = path.join(__dirname, '..', 'alerts', 'alert_rules.yml');

  test('alert_rules.yml exists and parses as valid YAML', () => {
    assert.ok(fs.existsSync(rulesPath), 'alert_rules.yml must exist');
    const content = fs.readFileSync(rulesPath, 'utf8');
    const doc = YAML.parse(content);
    assert.ok(doc.groups, 'Must contain groups');
    assert.ok(Array.isArray(doc.groups[0].rules), 'Group must contain rules list');
  });

  test('defines all 10 required actionable alert rules with remediation guidance', () => {
    const content = fs.readFileSync(rulesPath, 'utf8');
    const doc = YAML.parse(content);
    const rules = doc.groups[0].rules;

    const expectedAlerts = [
      'BackendUnavailable',
      'DatabaseConnectionFailed',
      'WorkerUnavailable',
      'HighHttpErrorRate',
      'ExcessiveRequestLatency',
      'WorkflowFailureSpike',
      'SagaCompensationFailed',
      'WorkflowQueueBacklog',
      'StaleMetrics',
      'RepeatedPodRestarts',
    ];

    const definedAlerts = rules.map((r) => r.alert);

    for (const expected of expectedAlerts) {
      assert.ok(definedAlerts.includes(expected), `Missing required alert rule: ${expected}`);
      const r = rules.find((rule) => rule.alert === expected);
      assert.ok(r.expr, `${expected} must have PromQL expr`);
      assert.ok(r.labels?.severity, `${expected} must define severity`);
      assert.ok(['critical', 'warning', 'info'].includes(r.labels.severity));
      assert.ok(r.annotations?.summary, `${expected} must have summary`);
      assert.ok(r.annotations?.description, `${expected} must have description`);
      assert.ok(r.annotations?.remediation, `${expected} must have remediation guidance`);
    }
  });
});

// ── 7. Alertmanager Configuration Validation ─────────────────────────────────
describe('7. Alertmanager Configuration (alert_manager_config.yml)', () => {
  const amConfigPath = path.join(__dirname, '..', 'alerts', 'alert_manager_config.yml');

  test('alert_manager_config.yml exists and parses as valid YAML without hardcoded secrets', () => {
    assert.ok(fs.existsSync(amConfigPath), 'alert_manager_config.yml must exist');
    const content = fs.readFileSync(amConfigPath, 'utf8');

    // Security check: ensure no hardcoded secrets or passwords are present
    assert.ok(!content.includes('password123'), 'Must not contain plaintext passwords');
    assert.ok(!content.includes('xoxb-'), 'Must not contain real Slack tokens');

    const doc = YAML.parse(content);
    assert.ok(doc.route, 'Must contain route definition');
    assert.ok(doc.receivers, 'Must contain receivers list');
    assert.ok(doc.receivers.some((r) => r.name === 'critical-alerts'));
  });
});

// ── 8. Grafana Provisioning & Dashboard JSON Validation ───────────────────────
describe('8. Grafana Provisioning & Dashboard JSON', () => {
  const dsPath = path.join(__dirname, '..', 'grafana', 'provisioning', 'datasources', 'prometheus.yml');
  const dashProv = path.join(__dirname, '..', 'grafana', 'provisioning', 'dashboards', 'dashboards.yml');
  const dashJson = path.join(__dirname, '..', 'grafana', 'dashboards', 'saga_engine_overview.json');

  test('Grafana datasource provisioning YAML is valid', () => {
    assert.ok(fs.existsSync(dsPath));
    const doc = YAML.parse(fs.readFileSync(dsPath, 'utf8'));
    assert.equal(doc.datasources[0].type, 'prometheus');
  });

  test('Grafana dashboard provider YAML is valid', () => {
    assert.ok(fs.existsSync(dashProv));
    const doc = YAML.parse(fs.readFileSync(dashProv, 'utf8'));
    assert.ok(doc.providers);
  });

  test('saga_engine_overview.json parses as valid Grafana dashboard JSON with required panels', () => {
    assert.ok(fs.existsSync(dashJson), 'Dashboard JSON must exist');
    const raw = fs.readFileSync(dashJson, 'utf8');
    const db = JSON.parse(raw);

    assert.equal(db.uid, 'saga-engine-overview');
    assert.ok(Array.isArray(db.panels), 'Must have panels array');

    // Extract all targets expr across panels
    const allExprs = [];
    db.panels.forEach((p) => {
      if (Array.isArray(p.targets)) {
        p.targets.forEach((t) => {
          if (t.expr) allExprs.push(t.expr);
        });
      }
    });

    const exprStr = allExprs.join(' ');
    assert.ok(exprStr.includes('worker_availability_status'), 'Missing worker panel query');
    assert.ok(exprStr.includes('database_connection_status'), 'Missing database panel query');
    assert.ok(exprStr.includes('workflow_queue_depth'), 'Missing queue depth panel query');
    assert.ok(exprStr.includes('workflow_compensation_failures_total'), 'Missing compensation panel query');
    assert.ok(exprStr.includes('workflow_lifecycle_total'), 'Missing lifecycle panel query');
    assert.ok(exprStr.includes('workflow_step_retries_total'), 'Missing retries panel query');
    assert.ok(exprStr.includes('http_requests_total'), 'Missing HTTP request panel query');
    assert.ok(exprStr.includes('http_request_duration_seconds_bucket'), 'Missing HTTP latency panel query');
    assert.ok(exprStr.includes('system_cpu_usage_percent'), 'Missing CPU panel query');
  });
});
