const jwt = require('jsonwebtoken');
const logger = require('../logger');

const JWT_SECRET = process.env.JWT_SECRET;
const MONITORING_API_KEY = process.env.MONITORING_API_KEY;

function unauthorized(res, message = 'Unauthorized') {
  logger.warn('Auth failure', { message });
  return res.status(401).json({ message });
}

function forbidden(res, message = 'Forbidden') {
  logger.warn('Auth forbidden', { message });
  return res.status(403).json({ message });
}

function verifyJwt(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    logger.debug('JWT verification failed', { error: err.message });
    return null;
  }
}

/**
 * Authentication middleware for Monitoring service.
 * Accepts either:
 *   - Bearer JWT in Authorization header (verified with JWT_SECRET)
 *   - X-Monitoring-Key header matching MONITORING_API_KEY
 * If neither is provided, responds 401.
 * If provided but invalid, responds 403.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const apiKeyHeader = req.headers['x-monitoring-key'];

  // No credentials
  if (!authHeader && !apiKeyHeader) {
    return unauthorized(res, 'Missing authentication credentials');
  }

  // API key takes precedence if present
  if (apiKeyHeader) {
    if (MONITORING_API_KEY && apiKeyHeader === MONITORING_API_KEY) {
      // Attach a flag indicating admin key usage
      req.auth = { method: 'apiKey' };
      return next();
    }
    return forbidden(res, 'Invalid Monitoring API Key');
  }

  // JWT flow
  if (!authHeader) return unauthorized(res, 'Missing Authorization header');
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return unauthorized(res, 'Malformed Authorization header');
  }
  const token = parts[1];
  const payload = verifyJwt(token);
  if (!payload) return forbidden(res, 'Invalid JWT');
  // Attach payload for downstream use
  req.auth = { method: 'jwt', payload };
  return next();
}

module.exports = { requireAuth };
