'use strict';

/**
 * tests/dashboard.test.js
 *
 * Tests for the Live Monitoring Dashboard:
 *  1. Standalone dashboard route (GET /dashboard) serves valid HTML with correct MIME type
 *  2. Public static directory serves index.html (GET /public/index.html)
 *  3. HTML contains all required semantic landmarks, accessibility attributes, and elements:
 *     - Stale data alert banner (role="alert", aria-live="assertive")
 *     - Real-time transport status badge (aria-label)
 *     - Services health section and grid
 *     - Metric cards for queue depth, running sagas, completed, failed, compensation failures, CPU, memory
 *     - Interactive filters (service, status, type, tenant)
 *     - Event timeline table with sequence numbering
 *     - Server monotonic sequence and timestamp footer
 *  4. Status semantics verification:
 *     - Healthy (green), Degraded (amber), Down (red), Unknown (gray)
 *  5. End-to-end WebSocket telemetry streaming to dashboard client
 *  6. Stale data & transport decoupling semantics
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { WebSocket } = require('ws');

const TEST_API_KEY = 'test-dashboard-api-key-999';
process.env.MONITORING_API_KEY = TEST_API_KEY;

const { createWebSocketHub, stopHeartbeat, clients } = require('../src/websocket/hub');
const { createEvent, TYPES } = require('../src/websocket/schema');

describe('Monitoring Dashboard — Route, Semantics & Telemetry Test Suite', () => {
  let app;
  let server;
  let port;
  let baseUrl;
  let wsUrl;
  let broadcast;

  const mockState = {
    health: [
      { name: 'api', status: 'healthy', latencyMs: 3 },
      { name: 'mongodb', status: 'healthy', latencyMs: 1 },
      { name: 'workers', status: 'healthy', latencyMs: 8, detail: 'running=0, stalled=0' },
      { name: 'mongodb-dns', status: 'healthy', latencyMs: 1 },
    ],
    metrics: {
      system: { cpu: { usagePercent: 18 }, memory: { usagePercent: 52 } },
      workflows: {
        global: { pending: 4, running: 2, success: 42, failed: 1 },
      },
    },
    alerts: [],
    alertHistory: [],
  };

  before(async () => {
    app = express();
    app.locals.state = mockState;

    // Static & dashboard routes identical to server.js
    app.use('/public', express.static(path.join(__dirname, '..', 'public')));
    app.get('/dashboard', (_req, res) => {
      res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    });

    app.get('/api/status', (_req, res) => {
      res.json({
        overall: 'healthy',
        services: mockState.health,
        metrics: mockState.metrics,
        checkedAt: new Date().toISOString(),
      });
    });

    server = http.createServer(app);
    broadcast = createWebSocketHub(server, mockState);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        wsUrl = `ws://127.0.0.1:${port}/?apiKey=${TEST_API_KEY}`;
        resolve();
      });
    });
  });

  after(async () => {
    stopHeartbeat();
    for (const [ws] of clients) {
      try { ws.terminate(); } catch {}
    }
    clients.clear();
    if (server && server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // Helper for HTTP requests
  function httpGet(urlPath) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${urlPath}`, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      }).on('error', reject);
    });
  }

  // ── 1. HTTP Static Serving & HTML Integrity Tests ─────────────────────────

  test('GET /dashboard returns HTTP 200 and text/html', async () => {
    const res = await httpGet('/dashboard');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.body.includes('<!DOCTYPE html>'));
    assert.ok(res.body.includes('Saga Orchestration Monitoring'));
  });

  test('GET /public/index.html serves the standalone dashboard', async () => {
    const res = await httpGet('/public/index.html');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.ok(res.body.includes('Saga Orchestration Monitoring'));
  });

  test('Dashboard HTML includes accessible stale warning banner with role="alert"', async () => {
    const res = await httpGet('/dashboard');
    assert.ok(res.body.includes('id="staleBanner"'));
    assert.ok(res.body.includes('role="alert"'));
    assert.ok(res.body.includes('aria-live="assertive"'));
    assert.ok(res.body.includes('id="staleMessage"'));
  });

  test('Dashboard HTML includes transport status indicator with aria-label', async () => {
    const res = await httpGet('/dashboard');
    assert.ok(res.body.includes('id="transportBadge"'));
    assert.ok(res.body.includes('aria-label="WebSocket Transport Status"'));
    assert.ok(res.body.includes('transport-pill'));
  });

  test('Dashboard HTML includes service health section and dynamic container', async () => {
    const res = await httpGet('/dashboard');
    assert.ok(res.body.includes('id="section-services-title"'));
    assert.ok(res.body.includes('id="servicesGrid"'));
  });

  test('Dashboard HTML includes all core telemetry metric cards', async () => {
    const res = await httpGet('/dashboard');
    // Metric value elements
    assert.ok(res.body.includes('id="valQueueDepth"'), 'Missing queue depth card');
    assert.ok(res.body.includes('id="valRunning"'), 'Missing active running sagas card');
    assert.ok(res.body.includes('id="valSuccess"'), 'Missing completed workflows card');
    assert.ok(res.body.includes('id="valFailed"'), 'Missing failed workflows card');
    assert.ok(res.body.includes('id="valCompFailures"'), 'Missing compensation failures card');
    assert.ok(res.body.includes('id="valCpu"'), 'Missing host CPU card');
    assert.ok(res.body.includes('id="valMem"'), 'Missing host Memory card');
    assert.ok(res.body.includes('id="valEnv"'), 'Missing environment card');
  });

  test('Dashboard HTML includes interactive filter controls', async () => {
    const res = await httpGet('/dashboard');
    assert.ok(res.body.includes('id="filterService"'), 'Missing filterService select');
    assert.ok(res.body.includes('id="filterStatus"'), 'Missing filterStatus select');
    assert.ok(res.body.includes('id="filterType"'), 'Missing filterType select');
    assert.ok(res.body.includes('id="filterTenant"'), 'Missing filterTenant input');
  });

  test('Dashboard HTML includes event timeline table and sequence footer', async () => {
    const res = await httpGet('/dashboard');
    assert.ok(res.body.includes('id="timelineBody"'), 'Missing timeline table body');
    assert.ok(res.body.includes('id="eventCountBadge"'), 'Missing event count badge');
    assert.ok(res.body.includes('id="lastHealthTime"'), 'Missing last health check timestamp');
    assert.ok(res.body.includes('id="lastDataTime"'), 'Missing last data timestamp');
    assert.ok(res.body.includes('id="lastSeqVal"'), 'Missing monotonic sequence value');
  });

  // ── 2. Status Semantics & Accessibility Verification ──────────────────────

  test('Status semantics enforce green=healthy, amber=degraded, red=down, gray=unknown', async () => {
    const res = await httpGet('/dashboard');
    const css = res.body;

    // Verify color variables
    assert.match(css, /--status-healthy:\s*#10b981/);
    assert.match(css, /--status-degraded:\s*#f59e0b/);
    assert.match(css, /--status-down:\s*#ef4444/);
    assert.match(css, /--status-unknown:\s*#6b7280/);

    // Verify status classes
    assert.ok(css.includes('status-text-healthy'));
    assert.ok(css.includes('status-text-degraded'));
    assert.ok(css.includes('status-text-down'));
    assert.ok(css.includes('status-text-unknown'));

    // Verify dot classes
    assert.ok(css.includes('dot-healthy'));
    assert.ok(css.includes('dot-degraded'));
    assert.ok(css.includes('dot-down'));
    assert.ok(css.includes('dot-unknown'));
  });

  // ── 3. Live WebSocket Telemetry Integration ───────────────────────────────

  test('WebSocket client connects and receives initial snapshot (seq: 0)', async () => {
    const ws = new WebSocket(wsUrl);

    const receivedMessages = [];
    await new Promise((resolve, reject) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        receivedMessages.push(msg);
        if (msg.type === 'SNAPSHOT') {
          resolve();
        }
      });
      ws.on('error', reject);
    });

    const snapshot = receivedMessages.find((m) => m.type === 'SNAPSHOT');
    assert.ok(snapshot, 'Did not receive SNAPSHOT message');
    assert.equal(snapshot.seq, 0);
    assert.equal(snapshot.payload.isSnapshot, true);
    assert.equal(snapshot.payload.health.length, 4);
    assert.equal(snapshot.payload.health[0].status, 'healthy');
    assert.equal(snapshot.payload.workflows.global.pending, 4);

    ws.close();
  });

  test('Live saga telemetry broadcast delivers schema-compliant frames to client', async () => {
    const ws = new WebSocket(wsUrl);

    await new Promise((resolve) => ws.on('open', resolve));

    const eventsPromise = new Promise((resolve) => {
      const liveEvents = [];
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type !== 'CONNECTED' && msg.type !== 'SNAPSHOT') {
          liveEvents.push(msg);
          if (liveEvents.length >= 2) resolve(liveEvents);
        }
      });
    });

    // Broadcast queue backlog update
    broadcast(createEvent(TYPES.QUEUE_BACKLOG, null, { pending: 15, running: 5, total: 60 }, 'info'));

    // Broadcast compensation failure
    broadcast(createEvent(TYPES.WORKFLOW_COMPENSATION_FAILED, 'tenant-alpha', {
      workflowId: 'wf-999',
      stepName: 'refund-payment',
      error: 'Gateway timeout',
    }, 'critical'));

    const received = await eventsPromise;
    assert.equal(received.length, 2);

    const queueEv = received.find((e) => e.type === TYPES.QUEUE_BACKLOG);
    assert.ok(queueEv);
    assert.equal(queueEv.payload.pending, 15);
    assert.ok(queueEv.seq > 0);
    assert.ok(queueEv.ts);

    const compEv = received.find((e) => e.type === TYPES.WORKFLOW_COMPENSATION_FAILED);
    assert.ok(compEv);
    assert.equal(compEv.tenantId, 'tenant-alpha');
    assert.equal(compEv.severity, 'critical');
    assert.equal(compEv.payload.stepName, 'refund-payment');

    ws.close();
  });

  test('Initial HTTP fetch /api/status provides full status payload for fallback', async () => {
    const res = await httpGet('/api/status');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.overall, 'healthy');
    assert.ok(Array.isArray(data.services));
    assert.equal(data.services.length, 4);
    assert.ok(data.metrics.system);
    assert.ok(data.metrics.workflows);
  });
});
