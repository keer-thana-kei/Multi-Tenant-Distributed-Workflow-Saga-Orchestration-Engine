'use strict';
/**
 * WebSocket integration test — uses Node built-in test runner.
 * Run ONLY when monitoring server is already running on port 4000:
 *   node --test tests/websocket.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

const WS_URL = `ws://localhost:${process.env.PORT || 4000}`;
const TIMEOUT_MS = 8000;

/**
 * Wait for the first matching message type from a WebSocket connection.
 * Resolves with the parsed message, rejects after TIMEOUT_MS.
 */
function waitForMessage(ws, matchType = null, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for WebSocket message (type: ${matchType || 'any'})`));
    }, timeoutMs);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!matchType || msg.type === matchType) {
          clearTimeout(timer);
          resolve(msg);
        }
      } catch {
        // ignore non-JSON frames
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('WebSocket hub — integration tests (server must be running)', () => {
  test('client can connect to ws://localhost:4000', (t, done) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => {
      assert.equal(ws.readyState, WebSocket.OPEN);
      ws.close();
      done();
    });
    ws.on('error', (err) => {
      done(new Error(`WebSocket connection failed: ${err.message}. Is the monitoring server running on port 4000?`));
    });
  });

  test('receives CONNECTED message on initial connect', async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise((res, rej) => {
      ws.on('open', res);
      ws.on('error', rej);
    });

    const msg = await waitForMessage(ws, 'CONNECTED', 5000);
    assert.equal(msg.type, 'CONNECTED');
    assert.ok(msg.ts, 'should have ts field');
    ws.close();
  });

  test('receives HEALTH_UPDATE within 40 seconds of connecting', async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise((res, rej) => {
      ws.on('open', res);
      ws.on('error', rej);
    });

    // Health update is sent on every monitoring cycle (default 30s) or immediately on first run
    const msg = await waitForMessage(ws, 'HEALTH_UPDATE', 40000);
    assert.equal(msg.type, 'HEALTH_UPDATE');
    assert.ok(Array.isArray(msg.data), 'HEALTH_UPDATE.data should be an array of service results');
    assert.ok(msg.data.length > 0, 'should have at least one service in health update');

    // Validate each service entry shape
    for (const svc of msg.data) {
      assert.ok('name' in svc, `service missing name: ${JSON.stringify(svc)}`);
      assert.ok('status' in svc, `service missing status: ${JSON.stringify(svc)}`);
      assert.ok(['healthy', 'degraded', 'down'].includes(svc.status), `unexpected status: ${svc.status}`);
    }
    ws.close();
  });

  test('receives METRICS_UPDATE within 40 seconds of connecting', async () => {
    const ws = new WebSocket(WS_URL);
    await new Promise((res, rej) => {
      ws.on('open', res);
      ws.on('error', rej);
    });
    const msg = await waitForMessage(ws, 'METRICS_UPDATE', 40000);
    assert.equal(msg.type, 'METRICS_UPDATE');
    assert.ok(msg.data, 'METRICS_UPDATE should have data');
    assert.ok('system' in msg.data, 'metrics should include system');
    ws.close();
  });
});
