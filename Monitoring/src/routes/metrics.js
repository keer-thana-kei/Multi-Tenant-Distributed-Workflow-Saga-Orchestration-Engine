'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Apply auth to all metrics routes
router.use(requireAuth);

// GET /metrics — all metrics (system + all tenants)
router.get('/', (req, res) => {
  const { metrics } = req.app.locals.state;
  if (!metrics || Object.keys(metrics).length === 0) {
    return res.status(503).json({ error: 'Metrics not yet collected. Retry in a few seconds.' });
  }
  res.json(metrics);
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
