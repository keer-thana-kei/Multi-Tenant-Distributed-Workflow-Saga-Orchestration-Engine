'use strict';

const express = require('express');

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

  res.json({
    overall,
    checkedAt: new Date().toISOString(),
    health: health || [],
    metrics: metrics || {},
    activeAlerts: alerts || [],
  });
});

module.exports = router;
