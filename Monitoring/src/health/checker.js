'use strict';

const mongoose = require('mongoose');
const http = require('http');
const url = require('url');
const { getWorkflowModel } = require('../metrics/collector');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

/**
 * Perform an HTTP GET and return { ok, statusCode, latencyMs }.
 */
function httpGet(targetUrl) {
  return new Promise((resolve) => {
    const start = Date.now();
    const parsed = url.parse(targetUrl);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.path || '/',
      method: 'GET',
      timeout: parseInt(process.env.DEPENDENCY_TIMEOUT_MS || '4000'),
    };

    const req = http.request(options, (res) => {
      res.resume(); // drain body
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, statusCode: res.statusCode, latencyMs: Date.now() - start });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0, latencyMs: Date.now() - start, error: 'timeout' });
    });

    req.on('error', (err) => {
      resolve({ ok: false, statusCode: 0, latencyMs: Date.now() - start, error: err.message });
    });

    req.end();
  });
}

/**
 * Check MongoDB connection state.
 */
async function checkDatabase() {
  const start = Date.now();
  const state = mongoose.connection.readyState;
  // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  const statusMap = { 0: 'down', 1: 'healthy', 2: 'degraded', 3: 'degraded' };
  const status = statusMap[state] || 'down';
  return {
    name: 'mongodb',
    status,
    latencyMs: Date.now() - start,
    detail: `readyState=${state}`,
  };
}

/**
 * Check the backend API health.
 */
  async function checkApi() {
    const result = await httpGet(`${BACKEND_URL}/health`);
    return {
      name: 'api',
      status: result.ok ? 'healthy' : 'down',
      latencyMs: result.latencyMs,
      detail: result.error || `HTTP ${result.statusCode}`,
    };
  }

  // Liveness check – always reports alive for the process itself
  function checkLiveness() {
    return {
      name: 'process',
      status: 'alive',
      uptime: process.uptime(),
      pid: process.pid,
    };
  }

  // Readiness check – ensures both DB and API are healthy
  async function checkReadiness() {
    const [db, api] = await Promise.all([checkDatabase(), checkApi()]);
    const overallStatus = db.status === 'healthy' && api.status === 'healthy' ? 'healthy' : 'degraded';
    return {
      name: 'readiness',
      status: overallStatus,
      details: { db: db.status, api: api.status },
    };
  }

  // Sanitize error messages to remove credentials
  function sanitizeError(msg) {
    if (typeof msg !== 'string') return msg;
    return msg
      .replace(/mongodb\+srv:\/\/[^@]+@/gi, '[REDACTED_MONGODB]')
      .replace(/:[^:@\/]{8,}@/gi, ':[REDACTED_PASSWORD]@');
  }

/**
 * Check workers by inspecting recent workflow activity.
 * A worker is considered "stalled" if a workflow has been in `running` state
 * for more than WORKER_STALL_MINUTES.
 */
async function checkWorkers() {
  const start = Date.now();
  const STALL_MINUTES = parseInt(process.env.WORKER_STALL_MINUTES || '10', 10);

  try {
    const Workflow = getWorkflowModel();
    const stalledCutoff = new Date(Date.now() - STALL_MINUTES * 60 * 1000);
    const stalledCount = await Workflow.countDocuments({
      status: 'running',
      updatedAt: { $lt: stalledCutoff },
    });

    const runningCount = await Workflow.countDocuments({ status: 'running' });

    return {
      name: 'workers',
      status: stalledCount > 0 ? 'degraded' : 'healthy',
      latencyMs: Date.now() - start,
      detail: `running=${runningCount}, stalled_>${STALL_MINUTES}min=${stalledCount}`,
    };
  } catch (err) {
    return {
      name: 'workers',
      status: 'down',
      latencyMs: Date.now() - start,
      detail: err.message,
    };
  }
}

/**
 * Check MongoDB Atlas DNS resolution as a dependency check.
 * Uses the dns module to resolve the cluster hostname.
 */
async function checkDependencies() {
  const start = Date.now();
  const dns = require('dns').promises;

  const mongoUri = process.env.MONGODB_URI || '';
  let hostname = 'unknown';

  try {
    // extract hostname from mongodb+srv://... URI
    const match = mongoUri.match(/mongodb(?:\+srv)?:\/\/[^@]+@([^/]+)/);
    if (match) hostname = match[1];

    await dns.lookup(hostname);
    return {
      name: 'mongodb-dns',
      status: 'healthy',
      latencyMs: Date.now() - start,
      detail: `resolved ${hostname}`,
    };
  } catch (err) {
    return {
      name: 'mongodb-dns',
      status: 'down',
      latencyMs: Date.now() - start,
      detail: `failed to resolve ${hostname}: ${err.message}`,
    };
  }
}

/**
 * Run all health checks and return array of results.
 */
async function runHealthChecks() {
  const results = await Promise.allSettled([
    checkApi(),
    checkDatabase(),
    checkWorkers(),
    checkDependencies(),
  ]);

  return results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : { name: 'unknown', status: 'down', latencyMs: 0, detail: r.reason?.message }
  );
}

// Export everything including individual checkers for unit tests
module.exports = {
  runHealthChecks,
  checkApi,
  checkDatabase,
  checkWorkers,
  checkDependencies,
  checkLiveness,
  checkReadiness,
  sanitizeError,
};
