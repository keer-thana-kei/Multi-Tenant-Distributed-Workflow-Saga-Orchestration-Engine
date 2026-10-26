'use strict';

const express = require('express');
const { runHealthChecks, checkLiveness, checkReadiness } = require('../health/checker');

const router = express.Router();

// GET /health — full health of all services
router.get('/', async (req, res) => {
  const state = req.app.locals.state;

  // If we have a recent cached result, return it
  if (state.health && state.health.length > 0) {
    const overall = state.health.every((h) => h.status === 'healthy') ? 'healthy' : 'degraded';
    return res.json({
      overall,
      services: state.health,
      checkedAt: new Date().toISOString(),
    });
  }

  // Otherwise run on-demand
  try {
    const health = await runHealthChecks();
    const overall = health.every((h) => h.status === 'healthy') ? 'healthy' : 'degraded';
    res.json({ overall, services: health, checkedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Liveness endpoint – always returns alive
router.get('/live', (req, res) => {
  const result = checkLiveness();
  res.json(result);
});

// Readiness endpoint – checks DB and API health
router.get('/ready', async (req, res) => {
  try {
    const result = await checkReadiness();
    const statusCode = result.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /health/:service — single service health
router.get('/:service', (req, res) => {
  const state = req.app.locals.state;
  const name = req.params.service.toLowerCase();
  const service = (state.health || []).find((h) => h.name === name);

  if (!service) {
    return res.status(404).json({ error: `Service '${name}' not found. Available: api, mongodb, workers, mongodb-dns` });
  }

  res.json(service);
});

module.exports = router;
