'use strict';

/**
 * tests/websocket.test.js
 *
 * Comprehensive WebSocket Hub integration tests using a properly configured test server.
 * Tests cover:
 *   1. Multiple clients simultaneous connections & broadcasts
 *   2. Real saga event delivery & versioned schema compliance
 *   3. Clean disconnection & resource cleanup
 *   4. Reconnect behavior & fresh initial snapshot
 *   5. Malformed messages & oversized payloads handling
 *   6. Heartbeat timeout & dead client termination
 *   7. Unauthorized connections (missing/invalid credentials)
 *   8. Cross-tenant isolation & unauthorized subscription rejection
 *   9. Event-source failure recovery & fallback adapter delivery
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { WebSocket } = require('ws');
const jwt = require('jsonwebtoken');

const TEST_API_KEY = 'test-mon-key-ws-secret';
const TEST_JWT_SECRET = 'test-ws-jwt-secret-abc-123';

process.env.MONITORING_API_KEY = TEST_API_KEY;
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.ALLOWED_WS_ORIGINS = '*';
process.env.WS_MAX_CLIENTS = '50';
process.env.WS_HEARTBEAT_INTERVAL_MS = '60000';
process.env.WS_SLOW_CLIENT_BYTES = '1024';

const {
  createWebSocketHub,
  broadcast,
  deliverToTenant,
  checkHeartbeats,
  stopHeartbeat,
  clients,
} = require('../src/websocket/hub');
const { TYPES, createEvent, sanitizePayload } = require('../src/websocket/schema');
const sagaAdapter = require('../src/websocket/adapter');

describe('WebSocket Hub — Integration Test Suite', () => {
  let server;
  let port;
  let wsBaseUrl;

  const mockState = {
    health: [
      { name: 'api', status: 'healthy', latencyMs: 5 },
      { name: 'mongodb', status: 'healthy', latencyMs: 2 },
      { name: 'workers', status: 'healthy', latencyMs: 10, detail: 'running=0, stalled=0' },
    ],
    metrics: {
      system: { cpu: { usagePercent: 12 }, memory: { usagePercent: 45 } },
      workflows: {
        global: { total: 10, pending: 2, running: 1, success: 6, failed: 1 },
        tenants: [
          { companyId: 'tenant-alpha', total: 6, pending: 1, running: 1, success: 4, failed: 0 },
          { companyId: 'tenant-beta',  total: 4, pending: 1, running: 0, success: 2, failed: 1 },
        ],
      },
    },
    alerts: [],
  };

  function createToken(payload, expiresIn = '1h') {
    return jwt.sign(payload, TEST_JWT_SECRET, { expiresIn });
  }

  /**
   * Helper that creates a test client with a built-in message buffer.
   * Prevents race conditions where subsequent messages arrive before listeners are attached.
   */
  function createTestClient(headers = {}, query = '') {
    const targetUrl = `${wsBaseUrl}${query ? '?' + query : ''}`;
    const ws = new WebSocket(targetUrl, { headers });
    const messages = [];
    const waiters = [];
    let closeInfo = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        for (let i = 0; i < waiters.length; i++) {
          const { matchType, resolve, timer } = waiters[i];
          if (!matchType || msg.type === matchType) {
            clearTimeout(timer);
            waiters.splice(i, 1);
            resolve(msg);
            return;
          }
        }
        messages.push(msg);
      } catch {}
    });

    ws.on('close', (code, reason) => {
      closeInfo = { code, reason: reason ? reason.toString() : '' };
    });

    function ready() {
      return new Promise((resolve, reject) => {
        if (ws.readyState === WebSocket.OPEN) return resolve(ws);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
        ws.once('close', () => resolve(ws));
      });
    }

    function waitForType(matchType = null, timeoutMs = 4000) {
      const idx = messages.findIndex((m) => !matchType || m.type === matchType);
      if (idx !== -1) {
        return Promise.resolve(messages.splice(idx, 1)[0]);
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const wIdx = waiters.findIndex((w) => w.timer === timer);
          if (wIdx !== -1) waiters.splice(wIdx, 1);
          reject(new Error(`Timed out waiting for message type=${matchType || 'any'}`));
        }, timeoutMs);

        waiters.push({ matchType, resolve, timer });
      });
    }

    function waitForClose(timeoutMs = 4000) {
      if (closeInfo) return Promise.resolve(closeInfo);
      if (ws.readyState === WebSocket.CLOSED) {
        return Promise.resolve({ code: 1000, reason: '' });
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), timeoutMs);
        ws.once('close', (code, reason) => {
          clearTimeout(timer);
          resolve({ code, reason: reason ? reason.toString() : '' });
        });
      });
    }

    return { ws, ready, waitForType, waitForClose, messages };
  }

  before(async () => {
    const app = express();
    server = http.createServer(app);
    createWebSocketHub(server, mockState);

    await new Promise((res) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        wsBaseUrl = `ws://127.0.0.1:${port}`;
        res();
      });
    });
  });

  after(async () => {
    stopHeartbeat();
    for (const [ws] of clients) {
      try { ws.terminate(); } catch {}
    }
    clients.clear();
    if (server) {
      await new Promise((res) => server.close(res));
    }
  });

  // ── 1. Unauthorized connections ──
  describe('1. Unauthorized connections', () => {
    test('rejects connection without any credentials (close code 4003)', async () => {
      const client = createTestClient({});
      await client.ready();
      const close = await client.waitForClose();
      assert.equal(close.code, 4003);
      assert.match(close.reason, /Authentication required/i);
    });

    test('rejects connection with invalid API key (close code 4003)', async () => {
      const client = createTestClient({ 'x-monitoring-key': 'wrong-key' });
      await client.ready();
      const close = await client.waitForClose();
      assert.equal(close.code, 4003);
    });

    test('rejects connection with invalid JWT (close code 4003)', async () => {
      const client = createTestClient({ authorization: 'Bearer invalid.token.signature' });
      await client.ready();
      const close = await client.waitForClose();
      assert.equal(close.code, 4003);
    });
  });

  // ── 2. Authentication & Initial Snapshot ──
  describe('2. Authentication & authorized initial snapshot', () => {
    test('admin connects with X-Monitoring-Key and receives CONNECTED + SNAPSHOT (seq: 0)', async () => {
      const client = createTestClient({ 'x-monitoring-key': TEST_API_KEY });
      await client.ready();

      const connMsg = await client.waitForType('CONNECTED');
      assert.equal(connMsg.type, 'CONNECTED');
      assert.equal(connMsg.v, '1');
      assert.ok(connMsg.ts);

      const snapMsg = await client.waitForType('SNAPSHOT');
      assert.equal(snapMsg.type, 'SNAPSHOT');
      assert.equal(snapMsg.seq, 0, 'Initial snapshot must have seq: 0');
      assert.equal(snapMsg.payload.isSnapshot, true);
      assert.ok(Array.isArray(snapMsg.payload.health));
      assert.ok(snapMsg.payload.workflows.global, 'Admin snapshot should include global metrics');

      client.ws.close();
    });

    test('client connects with valid JWT in query string (?token=...)', async () => {
      const token = createToken({ userId: 'u1', companyId: 'tenant-alpha' });
      const client = createTestClient({}, `token=${token}`);
      await client.ready();

      const connMsg = await client.waitForType('CONNECTED');
      assert.equal(connMsg.type, 'CONNECTED');
      assert.equal(connMsg.tenantId, 'tenant-alpha');

      client.ws.close();
    });

    test('client connects with valid JWT via Authorization header', async () => {
      const token = createToken({ userId: 'u2', companyId: 'tenant-beta' });
      const client = createTestClient({ authorization: `Bearer ${token}` });
      await client.ready();

      const snapMsg = await client.waitForType('SNAPSHOT');
      assert.equal(snapMsg.tenantId, 'tenant-beta');
      assert.equal(snapMsg.payload.workflows.companyId, 'tenant-beta', 'Snapshot must be scoped to tenant');

      client.ws.close();
    });
  });

  // ── 3. Cross-tenant isolation ──
  describe('3. Cross-tenant isolation & subscription verification', () => {
    test('rejects tenant subscribing to another tenant feed (close code 4003)', async () => {
      const token = createToken({ userId: 'u1', companyId: 'tenant-alpha' });
      const client = createTestClient({ authorization: `Bearer ${token}` }, 'tenant=tenant-beta');
      await client.ready();
      const close = await client.waitForClose();
      assert.equal(close.code, 4003);
    });

    test('strict tenant isolation on event delivery', async () => {
      const tokenAlpha = createToken({ userId: 'uAlpha', companyId: 'tenant-alpha' });
      const tokenBeta  = createToken({ userId: 'uBeta',  companyId: 'tenant-beta' });

      const clientAlpha = createTestClient({ authorization: `Bearer ${tokenAlpha}` });
      const clientBeta  = createTestClient({ authorization: `Bearer ${tokenBeta}` });
      const clientAdmin = createTestClient({ 'x-monitoring-key': TEST_API_KEY });

      await Promise.all([clientAlpha.ready(), clientBeta.ready(), clientAdmin.ready()]);

      // Drain initial snapshots
      await Promise.all([
        clientAlpha.waitForType('SNAPSHOT'),
        clientBeta.waitForType('SNAPSHOT'),
        clientAdmin.waitForType('SNAPSHOT'),
      ]);

      // Deliver event for tenant-alpha
      const eventAlpha = createEvent(
        TYPES.WORKFLOW_STARTED,
        'tenant-alpha',
        { workflowId: 'wf-101', workflowName: 'Alpha Workflow', status: 'running' }
      );
      deliverToTenant('tenant-alpha', eventAlpha);

      // Alpha and Admin must receive eventAlpha
      const alphaReceived = await clientAlpha.waitForType(TYPES.WORKFLOW_STARTED);
      assert.equal(alphaReceived.payload.workflowId, 'wf-101');
      assert.equal(alphaReceived.tenantId, 'tenant-alpha');

      const adminReceived = await clientAdmin.waitForType(TYPES.WORKFLOW_STARTED);
      assert.equal(adminReceived.payload.workflowId, 'wf-101');

      // Beta must NOT receive tenant-alpha event
      let betaReceivedAlpha = false;
      try {
        await clientBeta.waitForType(TYPES.WORKFLOW_STARTED, 400);
        betaReceivedAlpha = true;
      } catch {
        betaReceivedAlpha = false;
      }
      assert.equal(betaReceivedAlpha, false, 'Tenant Beta must not receive Tenant Alpha events');

      clientAlpha.ws.close();
      clientBeta.ws.close();
      clientAdmin.ws.close();
    });
  });

  // ── 4. Multiple simultaneous clients ──
  describe('4. Multiple simultaneous clients & broadcasts', () => {
    test('multiple clients receive simultaneous system broadcast', async () => {
      const token1 = createToken({ userId: 'u1', companyId: 'tenant-alpha' });
      const token2 = createToken({ userId: 'u2', companyId: 'tenant-beta' });

      const client1 = createTestClient({ authorization: `Bearer ${token1}` });
      const client2 = createTestClient({ authorization: `Bearer ${token2}` });
      const clientAdmin = createTestClient({ 'x-monitoring-key': TEST_API_KEY });

      await Promise.all([client1.ready(), client2.ready(), clientAdmin.ready()]);
      await Promise.all([
        client1.waitForType('SNAPSHOT'),
        client2.waitForType('SNAPSHOT'),
        clientAdmin.waitForType('SNAPSHOT'),
      ]);

      // Broadcast system-wide health event
      const healthEvent = createEvent(
        TYPES.SYSTEM_HEALTH,
        null,
        { services: [{ name: 'mongodb', status: 'healthy' }] }
      );
      broadcast(healthEvent);

      const [msg1, msg2, msgAdmin] = await Promise.all([
        client1.waitForType(TYPES.SYSTEM_HEALTH),
        client2.waitForType(TYPES.SYSTEM_HEALTH),
        clientAdmin.waitForType(TYPES.SYSTEM_HEALTH),
      ]);

      assert.equal(msg1.type, TYPES.SYSTEM_HEALTH);
      assert.equal(msg2.type, TYPES.SYSTEM_HEALTH);
      assert.equal(msgAdmin.type, TYPES.SYSTEM_HEALTH);

      client1.ws.close();
      client2.ws.close();
      clientAdmin.ws.close();
    });
  });

  // ── 5. Real saga lifecycle events & deduplication ──
  describe('5. Real saga lifecycle event delivery & versioned schema compliance', () => {
    test('adapter publishes genuine lifecycle events with sanitized payload', async () => {
      const token = createToken({ userId: 'u1', companyId: 'tenant-alpha' });
      const client = createTestClient({ authorization: `Bearer ${token}` });
      await client.ready();
      await client.waitForType('SNAPSHOT');

      sagaAdapter.clearDedupCache();

      const wfDoc = {
        _id: 'wf-saga-001',
        workflowName: 'PaymentSaga',
        companyId: 'tenant-alpha',
        steps: [
          { name: 'ChargeCard', url: 'http://internal-pay:8080/charge', method: 'POST' },
          { name: 'ReserveInventory', url: 'http://internal-inv:8080/reserve', method: 'POST' },
        ],
      };

      // 1. Workflow Started
      sagaAdapter.notifyWorkflowStarted(wfDoc);
      const startMsg = await client.waitForType(TYPES.WORKFLOW_STARTED);
      assert.equal(startMsg.v, '1');
      assert.equal(startMsg.type, TYPES.WORKFLOW_STARTED);
      assert.equal(startMsg.severity, 'info');
      assert.equal(startMsg.payload.workflowId, 'wf-saga-001');
      assert.ok(startMsg.seq > 0);

      // 2. Step Running
      sagaAdapter.notifyStepRunning(wfDoc, 0);
      const stepRunMsg = await client.waitForType(TYPES.WORKFLOW_STEP_RUNNING);
      assert.equal(stepRunMsg.payload.stepIndex, 0);
      assert.equal(stepRunMsg.payload.stepName, 'ChargeCard');
      assert.equal(stepRunMsg.payload.url, undefined, 'Internal step URLs must be sanitized');

      // 3. Step Success
      sagaAdapter.notifyStepSuccess(wfDoc, 0);
      const stepSuccessMsg = await client.waitForType(TYPES.WORKFLOW_STEP_SUCCESS);
      assert.equal(stepSuccessMsg.payload.stepStatus, 'success');

      // 4. Step Retry
      sagaAdapter.notifyStepRetry(wfDoc, 1, 2, 3);
      const retryMsg = await client.waitForType(TYPES.WORKFLOW_STEP_RETRY);
      assert.equal(retryMsg.payload.attempt, 2);
      assert.equal(retryMsg.severity, 'warn');

      // 5. Compensating (Rollback)
      sagaAdapter.notifyCompensating(wfDoc, 0);
      const compMsg = await client.waitForType(TYPES.WORKFLOW_COMPENSATING);
      assert.equal(compMsg.payload.stepStatus, 'rolled back');
      assert.equal(compMsg.severity, 'warn');

      // 6. Compensation Failed
      sagaAdapter.notifyCompensationFailed(wfDoc, 0, new Error('Refund failed on card user:s3cr3t@gateway'));
      const compFailMsg = await client.waitForType(TYPES.WORKFLOW_COMPENSATION_FAILED);
      assert.equal(compFailMsg.severity, 'error');
      assert.ok(!compFailMsg.payload.error.includes('s3cr3t'), 'Credentials in error must be redacted');

      // 7. Workflow Failed
      sagaAdapter.notifyWorkflowFailed(wfDoc, new Error('PaymentSaga failed'));
      const wfFailMsg = await client.waitForType(TYPES.WORKFLOW_FAILED);
      assert.equal(wfFailMsg.type, TYPES.WORKFLOW_FAILED);
      assert.equal(wfFailMsg.severity, 'error');

      client.ws.close();
    });

    test('prevents duplicate lifecycle events within deduplication window', async () => {
      const token = createToken({ userId: 'u1', companyId: 'tenant-alpha' });
      const client = createTestClient({ authorization: `Bearer ${token}` });
      await client.ready();
      await client.waitForType('SNAPSHOT');

      sagaAdapter.clearDedupCache();

      const wfDoc = { _id: 'wf-dedup-99', workflowName: 'DedupTest', companyId: 'tenant-alpha' };

      // First call: passes and is sent
      const res1 = sagaAdapter.notifyWorkflowCompleted(wfDoc);
      assert.equal(res1, true);

      const received = await client.waitForType(TYPES.WORKFLOW_COMPLETED);
      assert.equal(received.payload.workflowId, 'wf-dedup-99');

      // Immediate duplicate call with same state: must be suppressed
      const res2 = sagaAdapter.notifyWorkflowCompleted(wfDoc);
      assert.equal(res2, false, 'Duplicate event must be suppressed');

      client.ws.close();
    });
  });

  // ── 6. Disconnection & Cleanup ──
  describe('6. Disconnection & clean resource cleanup', () => {
    test('closing client socket decreases registry count without leaks', async () => {
      const token = createToken({ userId: 'u-disc', companyId: 'tenant-disc' });
      const client = createTestClient({ authorization: `Bearer ${token}` });
      await client.ready();
      await client.waitForType('CONNECTED');

      // Locate this client's server-side socket
      let serverWs = null;
      for (const [ws, meta] of clients) {
        if (meta.tenantId === 'tenant-disc') {
          serverWs = ws;
          break;
        }
      }
      assert.ok(serverWs, 'Server socket must be registered in hub');
      assert.equal(clients.has(serverWs), true);

      client.ws.close();
      await client.waitForClose();
      await new Promise((res) => setTimeout(res, 50));

      assert.equal(clients.has(serverWs), false, 'Server registry must remove disconnected socket');
    });
  });

  // ── 7. Reconnect Behavior ──
  describe('7. Reconnect behavior & state recovery', () => {
    test('client reconnects and receives fresh initial SNAPSHOT with seq: 0', async () => {
      const token = createToken({ userId: 'u1', companyId: 'tenant-alpha' });

      // 1st connection
      const client1 = createTestClient({ authorization: `Bearer ${token}` });
      await client1.ready();
      const snap1 = await client1.waitForType('SNAPSHOT');
      assert.equal(snap1.seq, 0);
      client1.ws.close();

      await new Promise((res) => setTimeout(res, 100));

      // Reconnection
      const client2 = createTestClient({ authorization: `Bearer ${token}` }, 'lastSeq=45');
      await client2.ready();
      const conn2 = await client2.waitForType('CONNECTED');
      assert.equal(conn2.type, 'CONNECTED');

      const snap2 = await client2.waitForType('SNAPSHOT');
      assert.equal(snap2.seq, 0, 'Reconnected client receives fresh SNAPSHOT with seq: 0');
      assert.equal(snap2.payload.isSnapshot, true);

      client2.ws.close();
    });
  });

  // ── 8. Malformed Messages & Oversized Payloads ──
  describe('8. Malformed messages & oversized payloads', () => {
    test('server handles malformed text and oversized messages gracefully', async () => {
      const client = createTestClient({ 'x-monitoring-key': TEST_API_KEY });
      await client.ready();
      await client.waitForType('SNAPSHOT');

      // Send malformed non-JSON frame
      client.ws.send('INVALID_NON_JSON_FRAME {{{');

      // Send oversized frame (>512 bytes)
      const largePayload = 'A'.repeat(1024);
      client.ws.send(largePayload);

      // Give server tick to handle frames
      await new Promise((res) => setTimeout(res, 100));

      // Ensure connection is still healthy and receives subsequent broadcasts
      assert.equal(client.ws.readyState, WebSocket.OPEN);

      broadcast(createEvent(TYPES.ALERT_FIRED, null, { alert: { name: 'TEST_ALERT' } }));
      const alertMsg = await client.waitForType(TYPES.ALERT_FIRED);
      assert.equal(alertMsg.type, TYPES.ALERT_FIRED);

      client.ws.close();
    });
  });

  // ── 9. Heartbeat Timeout & Termination ──
  describe('9. Heartbeat timeout & dead client termination', () => {
    test('checkHeartbeats terminates client that does not respond to ping', async () => {
      const token = createToken({ userId: 'u-hb', companyId: 'tenant-hb' });
      const client = createTestClient({ authorization: `Bearer ${token}` });
      await client.ready();
      await client.waitForType('CONNECTED');

      // Locate this client's server-side socket
      let serverWs = null;
      for (const [socket, meta] of clients) {
        if (meta.tenantId === 'tenant-hb') {
          serverWs = socket;
          break;
        }
      }
      assert.ok(serverWs, 'Server socket must be registered');

      // Simulate failed ping/pong cycle: client missed pong
      serverWs.isAlive = false;

      // Heartbeat check: dead client must be terminated
      checkHeartbeats();

      await client.waitForClose();
      assert.equal(client.ws.readyState, WebSocket.CLOSED);
      assert.equal(clients.has(serverWs), false, 'Terminated socket must be removed from registry');
    });
  });

  // ── 10. Failure Recovery & Schema Sanitization ──
  describe('10. Recovery after event-source failure & change stream fallback', () => {
    test('adapter logs delivery failures without throwing or interrupting caller', () => {
      assert.doesNotThrow(() => {
        sagaAdapter.notifyWorkflowStarted({});
      });
    });

    test('payload sanitization removes sensitive credentials and internal endpoints', () => {
      const dirty = {
        workflowId: '123',
        token: 'jwt-super-secret',
        password: 'password123',
        apiKey: 'secret-key',
        steps: [
          { name: 'step1', url: 'http://internal.svc:8080/task' },
        ],
        errorMessage: 'Failed to connect mongodb+srv://admin:pass1234@cluster.mongodb.net/db',
      };

      const clean = sanitizePayload(dirty);
      assert.equal(clean.token, undefined);
      assert.equal(clean.password, undefined);
      assert.equal(clean.apiKey, undefined);
      assert.equal(clean.steps[0].url, undefined);
      assert.ok(!clean.errorMessage.includes('admin:pass1234'));
      assert.ok(clean.errorMessage.includes('[REDACTED_MONGODB]'));
    });
  });
});
