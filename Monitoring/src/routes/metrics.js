'use strict';

const express = require('express');

const router = express.Router();

// GET /metrics — all metrics (system + all tenants)
router.get('/', (req, res) => {
  const { metrics } = req.app.locals.state;
  if (!metrics || Object.keys(metrics).length === 0) {
    return res.status(503).json({ error: 'Metrics not yet collected. Retry in a few seconds.' });
  }
  res.json(metrics);
});

// GET /metrics/:tenantId — workflow metrics for a single tenant (companyId)
router.get('/:tenantId', (req, res) => {
  const { metrics } = req.app.locals.state;
  const tenantId = req.params.tenantId;

  if (!metrics || !metrics.workflows) {
    return res.status(503).json({ error: 'Metrics not yet collected.' });
  }

  const tenant = (metrics.workflows.tenants || []).find(
    (t) => t.companyId === tenantId
  );

  if (!tenant) {
    return res.status(404).json({
      error: `Tenant '${tenantId}' not found in metrics.`,
      availableTenants: (metrics.workflows.tenants || []).map((t) => t.companyId),
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
