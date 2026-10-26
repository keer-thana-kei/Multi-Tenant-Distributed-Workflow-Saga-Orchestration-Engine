'use strict';

/**
 * Express HTTP Metrics Middleware.
 *
 * Tracks request count and duration histograms for Prometheus.
 * Normalizes route patterns to guarantee bounded label cardinality.
 */

const { defaultRegistry } = require('../metrics/prometheus');

/**
 * Normalize paths to bounded route patterns to avoid high cardinality.
 * E.g., /metrics/company-123 -> /metrics/:tenantId
 *       /api/workflows/65f1234567890abcdef12345 -> /api/workflows/:id
 */
function normalizeRoute(path) {
  if (!path || path === '/') return '/';

  // Strip query string
  const cleanPath = path.split('?')[0];

  return cleanPath
    // Hex objectIds or UUIDs -> :id
    .replace(/\/[a-f0-9]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    // /metrics/<tenant> -> /metrics/:tenantId
    .replace(/^\/metrics\/[^/]+$/, '/metrics/:tenantId')
    // /health/<service> -> /health/:service
    .replace(/^\/health\/[^/]+$/, '/health/:service')
    // Numeric IDs
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

function createHttpMetricsMiddleware(registry = defaultRegistry) {
  return function httpMetricsMiddleware(req, res, next) {
    const start = process.hrtime();

    res.on('finish', () => {
      const diff = process.hrtime(start);
      const durationSeconds = diff[0] + diff[1] / 1e9;

      const method = req.method ? req.method.toUpperCase() : 'UNKNOWN';
      const route = normalizeRoute(req.baseUrl ? req.baseUrl + (req.route?.path || req.path) : req.path);
      const statusCode = String(res.statusCode || 500);

      const labels = {
        method,
        route,
        status_code: statusCode,
      };

      registry.httpRequestsTotal.inc(labels);
      registry.httpRequestDurationSeconds.observe(labels, durationSeconds);
    });

    next();
  };
}

module.exports = {
  createHttpMetricsMiddleware,
  normalizeRoute,
};
