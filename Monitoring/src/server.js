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
const broadcast = createWebSocketHub(server);

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

    // 4. Broadcast via WebSocket
    broadcast({ type: 'HEALTH_UPDATE', data: health, ts: Date.now() });
    broadcast({ type: 'METRICS_UPDATE', data: metrics, ts: Date.now() });
    if (fired.length) {
      fired.forEach((alert) => broadcast({ type: 'ALERT_FIRED', data: alert, ts: Date.now() }));
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
