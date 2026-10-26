'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { defaultRegistry } = require('../metrics/prometheus');
const { clients } = require('../websocket/hub');

const router = express.Router();

// Apply auth to all metrics routes
router.use(requireAuth);

/**
 * Helper to determine if the client expects Prometheus text exposition format.
 */
function isPrometheusRequest(req) {
  if (req.query.format === 'prometheus') return true;
  if (req.query.format === 'json') return false;

  const accept = req.headers['accept'] || '';
  const userAgent = req.headers['user-agent'] || '';

  if (accept.includes('text/plain') || accept.includes('application/openmetrics-text')) {
    return true;
  }
  if (userAgent.startsWith('Prometheus')) {
    return true;
  }
  return false;
}

// GET /metrics — serves Prometheus text format or JSON based on client request
router.get('/', (req, res) => {
  const { state } = req.app.locals;

  // 1. Prometheus Scrape Request
  if (isPrometheusRequest(req)) {
    if (state) {
      defaultRegistry.updateFromState(state, clients ? clients.size : 0);
    }
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return res.send(defaultRegistry.toPrometheus());
  }

  // 2. Existing JSON API compatibility
  const metrics = state ? state.metrics : null;
  if (!metrics || Object.keys(metrics).length === 0) {
    return res.status(503).json({ error: 'Metrics not yet collected. Retry in a few seconds.' });
  }
  return res.json(metrics);
});

// GET /metrics/prometheus — explicit endpoint guaranteed to return Prometheus text
router.get('/prometheus', (req, res) => {
  const { state } = req.app.locals;
  if (state) {
    defaultRegistry.updateFromState(state, clients ? clients.size : 0);
  }
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return res.send(defaultRegistry.toPrometheus());
});

// GET /metrics/:tenantId — workflow metrics for a single tenant (companyId).
// Enforcement: caller must either use MONITORING_API_KEY (admin bypass)
// OR pass X-Tenant-ID header matching the requested tenantId.
router.get('/:tenantId', (req, res) => {
  const { metrics } = req.app.locals.state;
  const tenantId = req.params.tenantId;

  // Tenant isolation check (admin API-key callers bypass this)
  if (req.auth && req.auth.method === 'jwt') {
    const requestedTenant = req.headers['x-tenant-id'];
    if (!requestedTenant) {
      return res.status(403).json({ error: 'Missing X-Tenant-ID header.' });
    }
    if (requestedTenant !== tenantId) {
      return res.status(403).json({ error: 'X-Tenant-ID does not match requested tenant.' });
    }
  }

  if (!metrics || !metrics.workflows) {
    return res.status(503).json({ error: 'Metrics not yet collected.' });
  }

  const tenant = (metrics.workflows.tenants || []).find(
    (t) => t.companyId === tenantId
  );

  if (!tenant) {
    return res.status(404).json({
      error: `Tenant '${tenantId}' not found in metrics.`,
    });
  }

  res.json({
    companyId: tenant.companyId,
    workflows: tenant,
    system: metrics.system,
    collectedAt: metrics.collectedAt,
  });
});

module.exports = router;
