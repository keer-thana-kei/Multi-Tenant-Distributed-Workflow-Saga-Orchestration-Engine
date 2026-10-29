'use strict';

/**
 * Versioned event schema for the Monitoring WebSocket feed.
 * All events follow the envelope: { v, type, ts, seq, severity, tenantId, payload }
 *
 * Severity levels: 'info' | 'warn' | 'error' | 'critical'
 * tenantId: null means the event is system-wide (sent to all authenticated clients).
 */

// ── Event type constants ─────────────────────────────────────────────────────
const TYPES = {
  // Saga lifecycle (sourced from MongoDB change streams or saga adapter)
  WORKFLOW_STARTED:            'WORKFLOW_STARTED',
  WORKFLOW_STEP_RUNNING:       'WORKFLOW_STEP_RUNNING',
  WORKFLOW_STEP_SUCCESS:       'WORKFLOW_STEP_SUCCESS',
  WORKFLOW_STEP_FAILED:        'WORKFLOW_STEP_FAILED',
  WORKFLOW_STEP_RETRY:         'WORKFLOW_STEP_RETRY',
  WORKFLOW_STEP_RETRY_SUCCESS: 'WORKFLOW_STEP_RETRY_SUCCESS',
  WORKFLOW_COMPENSATING:       'WORKFLOW_COMPENSATING',
  WORKFLOW_COMPENSATION_FAILED:'WORKFLOW_COMPENSATION_FAILED',
  WORKFLOW_FAILED:             'WORKFLOW_FAILED',
  WORKFLOW_COMPLETED:          'WORKFLOW_COMPLETED',

  // System & infrastructure events (published only when obtained from actual services)
  SNAPSHOT:                    'SNAPSHOT',            // Full tenant state on first connect
  CONNECTED:                   'CONNECTED',           // Connection handshake acknowledgment
  SYSTEM_HEALTH:               'SYSTEM_HEALTH',       // Health check cycle result
  METRICS_UPDATE:              'METRICS_UPDATE',      // Metrics collection cycle result
  ALERT_FIRED:                 'ALERT_FIRED',         // Alert rule condition triggered
  WORKER_AVAILABILITY:         'WORKER_AVAILABILITY', // Real worker availability / stall status
  QUEUE_BACKLOG:               'QUEUE_BACKLOG',       // Real pending workflow queue depth
  DEPENDENCY_HEALTH:           'DEPENDENCY_HEALTH',   // External dependency status (DB, DNS, API)
};

// Monotonic global sequence counter — clients use this for deduplication & gap detection
let _seq = 0;
function nextSeq() { return ++_seq; }
function resetSeqForTesting(val = 0) { _seq = val; }

/**
 * Strip fields from payload that must never leave the server:
 *   - step.url (internal service endpoints)
 *   - any field named password, token, secret, key, credential, connectionString, auth
 */
function sanitizePayload(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const BLOCKED_KEYS = /^(password|token|secret|key|apikey|credential|url|connectionstring|authorization|auth|cookie)$/i;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizePayload(item));
  }

  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (BLOCKED_KEYS.test(k)) continue;
    if (typeof v === 'string') {
      // Redact mongodb+srv and credentials if embedded in error strings
      result[k] = v
        .replace(/mongodb(?:\+srv)?:\/\/[^@]+@/gi, '[REDACTED_MONGODB]')
        .replace(/:[^:@\/\s]+@/gi, ':[REDACTED_CREDENTIAL]@');
    } else if (Array.isArray(v)) {
      result[k] = v.map((item) => sanitizePayload(item));
    } else if (v && typeof v === 'object' && !(v instanceof Date)) {
      result[k] = sanitizePayload(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Create a validated, schema-compliant event envelope.
 * @param {string}      type       One of TYPES values
 * @param {string|null} tenantId   companyId or null for system-wide events
 * @param {object}      payload    Safe data (no secrets, URLs, credentials)
 * @param {string}      [severity] 'info' | 'warn' | 'error' | 'critical'
 */
function createEvent(type, tenantId, payload, severity = 'info') {
  return {
    v:        '1',
    type,
    ts:       new Date().toISOString(),
    seq:      nextSeq(),
    severity,
    tenantId: tenantId ? String(tenantId) : null,
    payload:  sanitizePayload(payload),
  };
}

module.exports = {
  TYPES,
  createEvent,
  sanitizePayload,
  nextSeq,
  resetSeqForTesting,
};
