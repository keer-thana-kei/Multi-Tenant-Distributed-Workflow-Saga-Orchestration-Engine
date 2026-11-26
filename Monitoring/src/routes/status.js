'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();

// GET /api/status — combined dashboard payload used by the monitoring UI
router.get('/', (req, res) => {
  const { health, metrics, alerts } = req.app.locals.state;

  const overall =
    !health || health.length === 0
      ? 'unknown'
      : health.every((h) => h.status === 'healthy')
      ? 'healthy'
      : health.some((h) => h.status === 'down')
      ? 'down'
      : 'degraded';

  // Check auth credentials if provided
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-monitoring-key'];
  let callerRole = null;
  let callerTenant = null;

  if (apiKeyHeader && apiKeyHeader === process.env.MONITORING_API_KEY) {
    callerRole = 'admin';
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
      callerRole = payload.role;
      callerTenant = payload.companyId || payload.tenantId;
    } catch {}
  }

  // Strict tenant data isolation
  let sanitizedMetrics = {};
  if (metrics) {
    if (callerRole === 'admin') {
      // Full metrics for verified admin
      sanitizedMetrics = metrics;
    } else if (callerTenant) {
      // Filtered to caller's tenant only
      const tenantWorkflow = (metrics.workflows?.tenants || []).find(
        (t) => String(t.companyId) === String(callerTenant)
      ) || { companyId: callerTenant, total: 0, pending: 0, running: 0, success: 0, failed: 0 };
      sanitizedMetrics = {
        collectedAt: metrics.collectedAt,
        system: metrics.system,
        workflows: {
          tenants: [tenantWorkflow],
          global: tenantWorkflow,
        },
      };
    } else {
      // Unauthenticated: return system metrics only, NEVER leak individual tenant data
      sanitizedMetrics = {
        collectedAt: metrics.collectedAt,
        system: metrics.system,
        workflows: {
          global: metrics.workflows?.global || { total: 0, pending: 0, running: 0, success: 0, failed: 0 },
          tenants: [], // Zero cross-tenant data leakage to anonymous callers
        },
      };
    }
  }

  res.json({
    overall,
    checkedAt: new Date().toISOString(),
    services: health || [],
    health: health || [],
    metrics: sanitizedMetrics,
    activeAlerts: alerts || [],
  });
});

module.exports = router;
