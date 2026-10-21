'use strict';

const express = require('express');

const router = express.Router();

// GET /alerts — currently active alerts
router.get('/', (req, res) => {
  const { alerts } = req.app.locals.state;
  res.json({
    count: alerts.length,
    alerts: alerts || [],
  });
});

// GET /alerts/history — last 100 fired alerts
router.get('/history', (req, res) => {
  const { alertHistory } = req.app.locals.state;
  res.json({
    count: (alertHistory || []).length,
    history: alertHistory || [],
  });
});

module.exports = router;
