'use strict';

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cron = require('node-cron');
const dotenv = require('dotenv');
const path = require('path');

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

// ── In-memory state shared across modules ──────────────────────────────────
const state = {
  health: [],
  metrics: {},
  alerts: [],
  alertHistory: [],
};

// ── Express app ────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
    console.error('[Monitor] Cycle error:', err.message);
  }
}

// ── Start ──────────────────────────────────────────────────────────────────
async function start() {
  // Connect to MongoDB
  if (!MONGODB_URI) {
    console.error('[Monitor] MONGODB_URI is not set in .env');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[Monitor] MongoDB connected');
  } catch (err) {
    console.error('[Monitor] MongoDB connection failed:', err.message);
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`[Monitor] HTTP server listening on http://localhost:${PORT}`);
    console.log(`[Monitor] WebSocket server ready at ws://localhost:${PORT}`);
  });

  // Run once immediately, then on schedule
  await runMonitoringCycle();
  cron.schedule(`*/${HEALTH_CHECK_INTERVAL} * * * * *`, runMonitoringCycle);
  console.log(`[Monitor] Health checks scheduled every ${HEALTH_CHECK_INTERVAL}s`);
}

start();

module.exports = { app, server, state }; // exported for tests
