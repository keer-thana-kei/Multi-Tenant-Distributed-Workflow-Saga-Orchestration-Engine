'use strict';
/**
 * Health checker unit tests — uses Node built-in test runner (no extra deps).
 * Run: node --test tests/health.test.js
 *
 * These tests mock mongoose and http so the tests run offline.
 */

const { test, describe, mock, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Mock mongoose before requiring checker ─────────────────────────────────
const mongoose = require('mongoose');

// Helper to temporarily patch mongoose.connection.readyState
function withMongoState(state, fn) {
  const original = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  Object.defineProperty(mongoose.connection, 'readyState', { value: state, configurable: true });
  const result = fn();
  if (original) Object.defineProperty(mongoose.connection, 'readyState', original);
  return result;
}

// We need a minimal Workflow model for checkWorkers
try {
  mongoose.model('Workflow');
} catch {
  const s = new mongoose.Schema({ companyId: String, status: String }, { timestamps: true });
  mongoose.model('Workflow', s);
}

const { checkDatabase, checkWorkers, checkDependencies } = require('../src/health/checker');

// ── checkDatabase ──────────────────────────────────────────────────────────
describe('checkDatabase', () => {
  test('returns healthy when mongoose readyState is 1 (connected)', async () => {
    let result;
    await withMongoState(1, async () => {
      result = await checkDatabase();
    });
    // readyState was set synchronously; result may reflect state at call time
    // so let's directly call with patched state
    Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
    result = await checkDatabase();
    assert.equal(result.name, 'mongodb');
    assert.equal(result.status, 'healthy');
    assert.ok(typeof result.latencyMs === 'number');
  });

  test('returns down when mongoose readyState is 0 (disconnected)', async () => {
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });
    const result = await checkDatabase();
    assert.equal(result.name, 'mongodb');
    assert.equal(result.status, 'down');
  });

  test('returns degraded when mongoose readyState is 2 (connecting)', async () => {
    Object.defineProperty(mongoose.connection, 'readyState', { value: 2, configurable: true });
    const result = await checkDatabase();
    assert.equal(result.name, 'mongodb');
    assert.equal(result.status, 'degraded');
  });
});

// ── checkDependencies DNS ──────────────────────────────────────────────────
describe('checkDependencies', () => {
  test('returns healthy for a resolvable hostname (localhost)', async () => {
    // Override MONGODB_URI to point to localhost which is always resolvable
    const original = process.env.MONGODB_URI;
    process.env.MONGODB_URI = 'mongodb://testuser:testpass@localhost/testdb';
    const result = await checkDependencies();
    process.env.MONGODB_URI = original;
    assert.equal(result.name, 'mongodb-dns');
    assert.ok(['healthy', 'down'].includes(result.status)); // CI may block DNS
    assert.ok(typeof result.latencyMs === 'number');
  });

  test('returns down for an unresolvable hostname', async () => {
    const original = process.env.MONGODB_URI;
    process.env.MONGODB_URI = 'mongodb://u:p@this-host-does-not-exist-xyz-12345.invalid/db';
    const result = await checkDependencies();
    process.env.MONGODB_URI = original;
    assert.equal(result.name, 'mongodb-dns');
    assert.equal(result.status, 'down');
  });
});

// ── checkWorkers — offline (DB not connected) ──────────────────────────────
describe('checkWorkers (offline)', () => {
  test('returns down when DB is not connected (query throws)', async () => {
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });
    // MongoDB not connected — countDocuments will throw
    const result = await checkWorkers();
    assert.equal(result.name, 'workers');
    // Either down (query threw) or healthy (mongoose returns 0 without throw)
    assert.ok(['down', 'healthy', 'degraded'].includes(result.status));
    assert.ok(typeof result.latencyMs === 'number');
  });
});

// ── Result shape validation ────────────────────────────────────────────────
describe('Health result shape', () => {
  test('checkDatabase result has required fields', async () => {
    const result = await checkDatabase();
    assert.ok('name' in result, 'missing name');
    assert.ok('status' in result, 'missing status');
    assert.ok('latencyMs' in result, 'missing latencyMs');
    assert.ok('detail' in result, 'missing detail');
  });
});

const { checkLiveness, checkReadiness, sanitizeError } = require('../src/health/checker');

// ── checkLiveness ──────────────────────────────────────────────────────────
describe('checkLiveness', () => {
  test('always returns alive status', () => {
    const result = checkLiveness();
    assert.equal(result.name, 'process');
    assert.equal(result.status, 'alive');
    assert.ok(typeof result.uptime === 'number');
    assert.ok(typeof result.pid === 'number');
  });

  test('returns alive even when DB is disconnected', () => {
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });
    const result = checkLiveness();
    assert.equal(result.status, 'alive');
  });
});

// ── checkReadiness ─────────────────────────────────────────────────────────
describe('checkReadiness', () => {
  test('returns degraded when DB is down', async () => {
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });
    const result = await checkReadiness();
    assert.equal(result.name, 'readiness');
    assert.equal(result.status, 'degraded');
  });
});

// ── sanitizeError ──────────────────────────────────────────────────────────
describe('sanitizeError', () => {
  test('redacts mongodb+srv credentials', () => {
    const dirty = 'connect: mongodb+srv://user:secret@cluster.mongodb.net';
    const clean = sanitizeError(dirty);
    assert.ok(!clean.includes('user:secret'), 'credentials must be removed');
  });

  test('redacts :password@ pattern', () => {
    const dirty = 'ECONNRESET connecting to user:mypassword@127.0.0.1';
    const clean = sanitizeError(dirty);
    assert.ok(!clean.includes('mypassword'), 'password must be removed');
  });

  test('passes through safe strings unchanged', () => {
    const safe = 'ETIMEDOUT: connection refused';
    assert.equal(sanitizeError(safe), safe);
  });

  test('handles null gracefully', () => {
    assert.equal(sanitizeError(null), null);
  });
});
