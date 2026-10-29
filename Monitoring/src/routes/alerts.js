'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /alerts — currently active alerts (open, used by dashboards)
router.get('/', (req, res) => {
  const { alerts } = req.app.locals.state;
  res.json({
    count: alerts.length,
    alerts: alerts || [],
  });
});

// GET /alerts/history — last 100 fired alerts (requires auth)
router.get('/history', requireAuth, (req, res) => {
  const { alertHistory } = req.app.locals.state;
  res.json({
    count: (alertHistory || []).length,
    history: alertHistory || [],
  });
});

module.exports = router;
