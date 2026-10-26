'use strict';

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cron = require('node-cron');
const dotenv = require('dotenv');
const path = require('path');
const logger = require('./logger');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Load sub-systems
const { createWebSocketHub } = require('./websocket/hub');
const { createEvent, TYPES } = require('./websocket/schema');
const { runHealthChecks } = require('./health/checker');
const { collectMetrics } = require('./metrics/collector');
const { evaluateAlerts } = require('./alerts/engine');

// Routes
const healthRoutes = require('./routes/health');
const metricsRoutes = require('./routes/metrics');
const alertsRoutes = require('./routes/alerts');
const statusRoutes = require('./routes/status');

const PORT = parseInt(process.env.PORT || '4000', 10);
const MONGODB_URI = process.env.MONGODB_URI;
const HEALTH_CHECK_INTERVAL = parseInt(process.env.HEALTH_CHECK_INTERVAL || '30', 10);

// Startup security warning if no auth secrets configured
if (!process.env.JWT_SECRET && !process.env.MONITORING_API_KEY) {
  logger.warn('SECURITY: Neither JWT_SECRET nor MONITORING_API_KEY is set — sensitive routes are UNPROTECTED.');
}

// ── In-memory state shared across modules ──────────────────────────────────
const state = {
  health: [],
  metrics: {},
  alerts: [],
  alertHistory: [],
};

// ── Express app ────────────────────────────────────────────────────────────
const app = express();
// Body size limit guards against large-payload DoS
app.use(express.json({ limit: '64kb' }));

// CORS — expose custom headers to browser clients
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Monitoring-Key, X-Tenant-ID');
  next();
});

// Attach shared state so routes can read it
app.locals.state = state;

// Routes
app.use('/health', healthRoutes);
app.use('/metrics', metricsRoutes);
app.use('/alerts', alertsRoutes);
app.use('/api/status', statusRoutes);

app.get('/', (_req, res) => {
  res.json({ service: 'monitoring', status: 'running', port: PORT });
});

// ── HTTP + WS server ───────────────────────────────────────────────────────
const server = http.createServer(app);
const broadcast = createWebSocketHub(server, state);

// ── Polling loop ───────────────────────────────────────────────────────────
async function runMonitoringCycle() {
  try {
    // 1. Health
    const health = await runHealthChecks();
    state.health = health;

    // 2. Metrics
    const metrics = await collectMetrics();
    state.metrics = metrics;

    // 3. Alerts
    const { active, fired } = evaluateAlerts(health, metrics, state.alerts);
    state.alerts = active;
    if (fired.length) {
      state.alertHistory = [...fired, ...state.alertHistory].slice(0, 100);
    }

    // 4. Broadcast via WebSocket (schema-wrapped)
    broadcast(createEvent(TYPES.SYSTEM_HEALTH, null, { services: health }, 'info'));
    broadcast(createEvent(TYPES.METRICS_UPDATE, null, { system: metrics.system, workflows: metrics.workflows }, 'info'));

    // Worker availability event (only when obtained from health check)
    const workerSvc = (health || []).find((s) => s.name === 'workers');
    if (workerSvc) {
      broadcast(createEvent(TYPES.WORKER_AVAILABILITY, null, {
        status: workerSvc.status,
        detail: workerSvc.detail,
        latencyMs: workerSvc.latencyMs,
      }, workerSvc.status === 'healthy' ? 'info' : 'warn'));
    }

    // Queue backlog event (only when obtained from real workflow metrics)
    if (metrics.workflows && typeof metrics.workflows.global?.pending === 'number') {
      const pendingCount = metrics.workflows.global.pending;
      broadcast(createEvent(TYPES.QUEUE_BACKLOG, null, {
        pending: pendingCount,
        running: metrics.workflows.global.running,
        total: metrics.workflows.global.total,
      }, pendingCount > 50 ? 'warn' : 'info'));
    }

    // Dependency health event (only when obtained from health checks)
    const depSvcs = (health || []).filter((s) => ['mongodb', 'mongodb-dns', 'api'].includes(s.name));
    if (depSvcs.length > 0) {
      const hasDown = depSvcs.some((s) => s.status === 'down');
      broadcast(createEvent(TYPES.DEPENDENCY_HEALTH, null, { dependencies: depSvcs }, hasDown ? 'error' : 'info'));
    }

    if (fired.length) {
      fired.forEach((alert) =>
        broadcast(createEvent(TYPES.ALERT_FIRED, null, { alert }, alert.severity || 'warn'))
      );
    }
  } catch (err) {
    logger.error('Monitor cycle error', { error: err.message });
  }
}

// ── Start ──────────────────────────────────────────────────────────────────
async function start() {
  if (!MONGODB_URI) {
    logger.error('MONGODB_URI is not set in .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI);
    logger.info('MongoDB connected');
  } catch (err) {
    logger.error('MongoDB connection failed', { error: err.message });
    process.exit(1);
  }

  server.listen(PORT, () => {
    logger.info('HTTP server listening', { url: `http://localhost:${PORT}` });
    logger.info('WebSocket server ready', { url: `ws://localhost:${PORT}` });
  });

  // Run once immediately, then on schedule
  await runMonitoringCycle();
  cron.schedule(`*/${HEALTH_CHECK_INTERVAL} * * * * *`, runMonitoringCycle);
  logger.info('Health checks scheduled', { intervalSeconds: HEALTH_CHECK_INTERVAL });
}

start();

module.exports = { app, server, state }; // exported for tests
