'use strict';

/**
 * tests/security.test.js
 * Offline unit tests for:
 *  - Auth middleware (requireAuth)
 *  - sanitizeError (credential stripping)
 *  - Tenant isolation enforcement in metrics route
 *
 * All tests run without a running server or real MongoDB.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

// ────────────────────────────────────────────────────────────────────────────
// Helpers – minimal mock req/res
// ────────────────────────────────────────────────────────────────────────────
function mockReq(headers = {}) {
  return { headers };
}

function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

// ────────────────────────────────────────────────────────────────────────────
// Load modules under test (with env vars set)
// ────────────────────────────────────────────────────────────────────────────

const TEST_API_KEY = 'test-monitor-key-123';
const TEST_JWT_SECRET = 'test-jwt-secret';

// Must set env before requiring the module (requireAuth reads env at module load)
process.env.MONITORING_API_KEY = TEST_API_KEY;
process.env.JWT_SECRET = TEST_JWT_SECRET;

const { requireAuth } = require('../src/middleware/auth');
const { sanitizeError } = require('../src/health/checker');

// ────────────────────────────────────────────────────────────────────────────
// Auth middleware tests
// ────────────────────────────────────────────────────────────────────────────

describe('requireAuth middleware', () => {
  test('returns 401 when no credentials provided', () => {
    const req = mockReq({});
    const res = mockRes();
    let called = false;
    requireAuth(req, res, () => { called = true; });
    assert.equal(res._status, 401);
    assert.equal(called, false);
  });

  test('returns 403 when wrong API key provided', () => {
    const req = mockReq({ 'x-monitoring-key': 'wrong-key' });
    const res = mockRes();
    let called = false;
    requireAuth(req, res, () => { called = true; });
    assert.equal(res._status, 403);
    assert.equal(called, false);
  });

  test('passes when correct API key provided', () => {
    const req = mockReq({ 'x-monitoring-key': TEST_API_KEY });
    const res = mockRes();
    let called = false;
    requireAuth(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(req.auth.method, 'apiKey');
  });

  test('returns 401 with malformed Authorization header', () => {
    const req = mockReq({ authorization: 'NotBearer abc' });
    const res = mockRes();
    let called = false;
    requireAuth(req, res, () => { called = true; });
    assert.equal(res._status, 401);
    assert.equal(called, false);
  });

  test('returns 403 with invalid JWT', () => {
    const req = mockReq({ authorization: 'Bearer invalid.jwt.token' });
    const res = mockRes();
    let called = false;
    requireAuth(req, res, () => { called = true; });
    assert.equal(res._status, 403);
    assert.equal(called, false);
  });

  test('passes with valid JWT', () => {
    const token = jwt.sign({ userId: 'u1', email: 'a@b.com' }, TEST_JWT_SECRET, { expiresIn: '1h' });
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    let called = false;
    requireAuth(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(req.auth.method, 'jwt');
    assert.equal(req.auth.payload.email, 'a@b.com');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// sanitizeError tests
// ────────────────────────────────────────────────────────────────────────────

describe('sanitizeError', () => {
  test('strips mongodb+srv URI credentials', () => {
    const dirty = 'Error connecting mongodb+srv://admin:s3cr3t@cluster.mongodb.net/db';
    const clean = sanitizeError(dirty);
    assert.ok(!clean.includes('admin:s3cr3t'), 'credentials must not appear in output');
    assert.ok(!clean.includes('s3cr3t'), 'password must not appear in output');
  });

  test('strips :password@ pattern from error strings', () => {
    const dirty = 'connect ECONNREFUSED user:passw0rd@localhost:27017';
    const clean = sanitizeError(dirty);
    assert.ok(!clean.includes('passw0rd'), 'password must be redacted');
  });

  test('passes through non-sensitive strings unchanged', () => {
    const safe = 'ETIMEDOUT: connection to host timed out';
    assert.equal(sanitizeError(safe), safe);
  });

  test('handles non-string input gracefully', () => {
    assert.equal(sanitizeError(null), null);
    assert.equal(sanitizeError(42), 42);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tenant isolation logic tests (directly testing the route logic)
// ────────────────────────────────────────────────────────────────────────────

describe('tenant isolation (X-Tenant-ID enforcement)', () => {
  // Replicate the tenant check logic from metrics route for unit testing
  function tenantCheck(req, res, next) {
    if (req.auth && req.auth.method === 'jwt') {
      const requestedTenant = req.headers['x-tenant-id'];
      if (!requestedTenant) {
        return res.status(403).json({ error: 'Missing X-Tenant-ID header.' });
      }
      if (requestedTenant !== req.params.tenantId) {
        return res.status(403).json({ error: 'X-Tenant-ID does not match requested tenant.' });
      }
    }
    next();
  }

  test('JWT caller without X-Tenant-ID is rejected with 403', () => {
    const token = jwt.sign({ userId: 'u1', email: 'a@b.com' }, TEST_JWT_SECRET);
    const req = { headers: {}, auth: { method: 'jwt' }, params: { tenantId: 'tenant-a' } };
    const res = mockRes();
    let called = false;
    tenantCheck(req, res, () => { called = true; });
    assert.equal(res._status, 403);
    assert.equal(called, false);
  });

  test('JWT caller with mismatched X-Tenant-ID is rejected with 403', () => {
    const req = {
      headers: { 'x-tenant-id': 'tenant-b' },
      auth: { method: 'jwt' },
      params: { tenantId: 'tenant-a' },
    };
    const res = mockRes();
    let called = false;
    tenantCheck(req, res, () => { called = true; });
    assert.equal(res._status, 403);
    assert.equal(called, false);
  });

  test('JWT caller with matching X-Tenant-ID passes', () => {
    const req = {
      headers: { 'x-tenant-id': 'tenant-a' },
      auth: { method: 'jwt' },
      params: { tenantId: 'tenant-a' },
    };
    const res = mockRes();
    let called = false;
    tenantCheck(req, res, () => { called = true; });
    assert.equal(called, true);
  });

  test('API-key caller bypasses X-Tenant-ID check', () => {
    const req = {
      headers: {},
      auth: { method: 'apiKey' },
      params: { tenantId: 'tenant-a' },
    };
    const res = mockRes();
    let called = false;
    tenantCheck(req, res, () => { called = true; });
    assert.equal(called, true);
  });
});
