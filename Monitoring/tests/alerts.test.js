'use strict';
/**
 * Alert engine unit tests — uses Node built-in test runner.
 * Run: node --test tests/alerts.test.js
 *
 * Tests state-change detection (no spam), threshold evaluation, and alert clearing.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { evaluateAlerts } = require('../src/alerts/engine');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeHealth(overrides = {}) {
  const defaults = {
    api: { name: 'api', status: 'healthy', latencyMs: 10, detail: 'HTTP 200' },
    mongodb: { name: 'mongodb', status: 'healthy', latencyMs: 5, detail: 'readyState=1' },
    workers: { name: 'workers', status: 'healthy', latencyMs: 3, detail: 'running=0, stalled=0' },
    'mongodb-dns': { name: 'mongodb-dns', status: 'healthy', latencyMs: 4, detail: 'resolved' },
  };
  const merged = { ...defaults, ...overrides };
  return Object.values(merged);
}

function makeMetrics(overrides = {}) {
  return {
    system: {
      cpu: { usagePercent: 10, coreCount: 4 },
      memory: { usagePercent: 40, totalBytes: 8e9, usedBytes: 3.2e9, freeBytes: 4.8e9 },
    },
    workflows: {
      tenants: [],
      global: { total: 10, pending: 0, running: 0, success: 10, failed: 0 },
      recentFailureRate: 0,
    },
    ...overrides,
  };
}

// ── No alerts when everything is healthy ──────────────────────────────────
describe('evaluateAlerts — all healthy', () => {
  test('produces no active alerts when system is healthy', () => {
    const { active, fired } = evaluateAlerts(makeHealth(), makeMetrics(), []);
    assert.equal(active.length, 0);
    assert.equal(fired.length, 0);
  });
});

// ── API_DOWN alert ────────────────────────────────────────────────────────
describe('API_DOWN alert', () => {
  test('fires when API status is down', () => {
    const health = makeHealth({ api: { name: 'api', status: 'down', latencyMs: 5000, detail: 'timeout' } });
    const { active, fired } = evaluateAlerts(health, makeMetrics(), []);
    const alert = active.find((a) => a.key === 'API_DOWN');
    assert.ok(alert, 'API_DOWN alert should be active');
    assert.equal(fired.find((a) => a.key === 'API_DOWN')?.key, 'API_DOWN');
  });

  test('does NOT re-fire if API_DOWN was already active', () => {
    const health = makeHealth({ api: { name: 'api', status: 'down', latencyMs: 5000, detail: 'timeout' } });
    // Simulate already-active alert
    const existing = [{ key: 'API_DOWN', severity: 'critical', message: '...', firedAt: new Date().toISOString() }];
    const { active, fired } = evaluateAlerts(health, makeMetrics(), existing);
    const alert = active.find((a) => a.key === 'API_DOWN');
    assert.ok(alert, 'API_DOWN should remain active');
    assert.equal(fired.length, 0, 'should NOT re-fire existing alert');
  });

  test('clears when API recovers', () => {
    const healthyHealth = makeHealth(); // all healthy
    const existing = [{ key: 'API_DOWN', severity: 'critical', message: '...', firedAt: new Date().toISOString() }];
    const { active } = evaluateAlerts(healthyHealth, makeMetrics(), existing);
    assert.ok(!active.find((a) => a.key === 'API_DOWN'), 'API_DOWN should be cleared');
  });
});

// ── HIGH_CPU alert ────────────────────────────────────────────────────────
describe('HIGH_CPU alert', () => {
  test('fires when CPU exceeds threshold (default 80%)', () => {
    const metrics = makeMetrics({ system: { cpu: { usagePercent: 95, coreCount: 4 }, memory: { usagePercent: 40 } } });
    const { active } = evaluateAlerts(makeHealth(), metrics, []);
    assert.ok(active.find((a) => a.key === 'HIGH_CPU'), 'HIGH_CPU should fire at 95%');
  });

  test('does not fire when CPU is below threshold', () => {
    const metrics = makeMetrics({ system: { cpu: { usagePercent: 50, coreCount: 4 }, memory: { usagePercent: 40 } } });
    const { active } = evaluateAlerts(makeHealth(), metrics, []);
    assert.ok(!active.find((a) => a.key === 'HIGH_CPU'), 'HIGH_CPU should not fire at 50%');
  });
});

// ── HIGH_MEMORY alert ─────────────────────────────────────────────────────
describe('HIGH_MEMORY alert', () => {
  test('fires when memory exceeds threshold (default 85%)', () => {
    const metrics = makeMetrics({ system: { cpu: { usagePercent: 10, coreCount: 4 }, memory: { usagePercent: 90 } } });
    const { active } = evaluateAlerts(makeHealth(), metrics, []);
    assert.ok(active.find((a) => a.key === 'HIGH_MEMORY'), 'HIGH_MEMORY should fire at 90%');
  });
});

// ── WORKFLOW_FAILURE_SPIKE ────────────────────────────────────────────────
describe('WORKFLOW_FAILURE_SPIKE alert', () => {
  test('fires when recent failure rate exceeds threshold (default 30%)', () => {
    const metrics = makeMetrics();
    metrics.workflows.recentFailureRate = 45;
    const { active } = evaluateAlerts(makeHealth(), metrics, []);
    assert.ok(active.find((a) => a.key === 'WORKFLOW_FAILURE_SPIKE'));
  });

  test('does not fire when failure rate is below threshold', () => {
    const metrics = makeMetrics();
    metrics.workflows.recentFailureRate = 10;
    const { active } = evaluateAlerts(makeHealth(), metrics, []);
    assert.ok(!active.find((a) => a.key === 'WORKFLOW_FAILURE_SPIKE'));
  });
});

// ── DB_DOWN + multiple simultaneous alerts ────────────────────────────────
describe('Multiple simultaneous alerts', () => {
  test('can fire multiple alerts at once', () => {
    const health = makeHealth({
      api: { name: 'api', status: 'down', latencyMs: 5000, detail: 'timeout' },
      mongodb: { name: 'mongodb', status: 'down', latencyMs: 0, detail: 'readyState=0' },
    });
    const metrics = makeMetrics({ system: { cpu: { usagePercent: 90, coreCount: 4 }, memory: { usagePercent: 40 } } });
    const { active } = evaluateAlerts(health, metrics, []);
    assert.ok(active.find((a) => a.key === 'API_DOWN'), 'API_DOWN');
    assert.ok(active.find((a) => a.key === 'DB_DOWN'), 'DB_DOWN');
    assert.ok(active.find((a) => a.key === 'HIGH_CPU'), 'HIGH_CPU');
  });
});

// ── Alert shape validation ────────────────────────────────────────────────
describe('Alert result shape', () => {
  test('fired alert has required fields', () => {
    const health = makeHealth({ api: { name: 'api', status: 'down', latencyMs: 0, detail: 'x' } });
    const { fired } = evaluateAlerts(health, makeMetrics(), []);
    const alert = fired[0];
    assert.ok(alert, 'should have at least one fired alert');
    assert.ok('key' in alert, 'missing key');
    assert.ok('severity' in alert, 'missing severity');
    assert.ok('message' in alert, 'missing message');
    assert.ok('firedAt' in alert, 'missing firedAt');
  });
});
