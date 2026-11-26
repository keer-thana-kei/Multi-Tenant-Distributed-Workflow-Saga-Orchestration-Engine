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

  // Enforce strict tenant isolation for non-admin callers
  if (req.auth && req.auth.method === 'jwt' && req.auth.payload?.role !== 'admin') {
    const callerTenant = req.auth.payload?.companyId || req.auth.payload?.tenantId;
    if (!callerTenant) {
      return res.status(403).json({ error: 'Forbidden: No tenant associated with token' });
    }
    const tenantMetrics = (metrics.workflows?.tenants || []).find(
      (t) => String(t.companyId) === String(callerTenant)
    ) || { companyId: callerTenant, total: 0, pending: 0, running: 0, success: 0, failed: 0 };

    return res.json({
      collectedAt: metrics.collectedAt,
      system: metrics.system,
      workflows: {
        tenants: [tenantMetrics],
        global: tenantMetrics,
      },
    });
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

  if (!tenantId || !tenantId.trim()) {
    return res.status(400).json({ error: 'companyId/tenantId is required' });
  }

  // Tenant isolation check (admin API-key callers bypass this)
  if (req.auth && req.auth.method === 'jwt') {
    const callerTenant = req.auth.payload?.companyId || req.auth.payload?.tenantId;
    const requestedTenant = req.headers['x-tenant-id'] || tenantId;
    if (req.auth.payload?.role !== 'admin') {
      if (!callerTenant || String(callerTenant) !== String(tenantId) || String(requestedTenant) !== String(tenantId)) {
        return res.status(403).json({ error: 'Unauthorized: Cross-tenant access forbidden' });
      }
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
