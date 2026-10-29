'use strict';

const CPU_THRESHOLD = parseInt(process.env.CPU_ALERT_THRESHOLD || '80', 10);
const MEM_THRESHOLD = parseInt(process.env.MEMORY_ALERT_THRESHOLD || '85', 10);
const FAILURE_RATE_THRESHOLD = parseInt(process.env.FAILURE_RATE_THRESHOLD || '30', 10);
const WORKER_STALL_MINUTES = parseInt(process.env.WORKER_STALL_MINUTES || '10', 10);

/**
 * Alert rules. Each rule produces an alert object or null.
 * State-change detection: an alert is only "fired" when its key transitions
 * from absent to present in the active set.
 */
const RULES = [
  {
    key: 'API_DOWN',
    severity: 'critical',
    evaluate(health, _metrics) {
      const api = health.find((h) => h.name === 'api');
      if (api && api.status === 'down') {
        return { key: 'API_DOWN', severity: 'critical', message: `Backend API is unreachable (${api.detail})` };
      }
      return null;
    },
  },
  {
    key: 'DB_DOWN',
    severity: 'critical',
    evaluate(health, _metrics) {
      const db = health.find((h) => h.name === 'mongodb');
      if (db && db.status === 'down') {
        return { key: 'DB_DOWN', severity: 'critical', message: 'MongoDB is disconnected' };
      }
      return null;
    },
  },
  {
    key: 'HIGH_CPU',
    severity: 'warning',
    evaluate(_health, metrics) {
      const cpu = metrics?.system?.cpu;
      if (cpu && cpu.usagePercent > CPU_THRESHOLD) {
        return {
          key: 'HIGH_CPU',
          severity: 'warning',
          message: `CPU usage is ${cpu.usagePercent}% (threshold: ${CPU_THRESHOLD}%)`,
        };
      }
      return null;
    },
  },
  {
    key: 'HIGH_MEMORY',
    severity: 'warning',
    evaluate(_health, metrics) {
      const mem = metrics?.system?.memory;
      if (mem && mem.usagePercent > MEM_THRESHOLD) {
        return {
          key: 'HIGH_MEMORY',
          severity: 'warning',
          message: `Memory usage is ${mem.usagePercent}% (threshold: ${MEM_THRESHOLD}%)`,
        };
      }
      return null;
    },
  },
  {
    key: 'WORKFLOW_FAILURE_SPIKE',
    severity: 'critical',
    evaluate(_health, metrics) {
      const rate = metrics?.workflows?.recentFailureRate;
      if (rate !== undefined && rate > FAILURE_RATE_THRESHOLD) {
        return {
          key: 'WORKFLOW_FAILURE_SPIKE',
          severity: 'critical',
          message: `Workflow failure rate is ${rate}% in the last 60 min (threshold: ${FAILURE_RATE_THRESHOLD}%)`,
        };
      }
      return null;
    },
  },
  {
    key: 'WORKER_STALLED',
    severity: 'warning',
    evaluate(health, _metrics) {
      const worker = health.find((h) => h.name === 'workers');
      if (worker && worker.status === 'degraded') {
        return {
          key: 'WORKER_STALLED',
          severity: 'warning',
          message: `Worker stall detected: workflows stuck in 'running' for >${WORKER_STALL_MINUTES} min. Detail: ${worker.detail}`,
        };
      }
      return null;
    },
  },
];

/**
 * Evaluate alert rules against the latest health & metrics snapshots.
 *
 * @param {Array}  health       - Output of runHealthChecks()
 * @param {Object} metrics      - Output of collectMetrics()
 * @param {Array}  currentAlerts - Currently active alerts
 * @returns {{ active: Alert[], fired: Alert[] }}
 *   active = full list of currently triggered alerts
 *   fired  = newly triggered alerts (state changes only, to avoid spam)
 */
function evaluateAlerts(health = [], metrics = {}, currentAlerts = []) {
  const currentKeys = new Set(currentAlerts.map((a) => a.key));
  const active = [];
  const fired = [];
  const now = new Date().toISOString();

  for (const rule of RULES) {
    const alert = rule.evaluate(health, metrics);
    if (alert) {
      const enriched = { ...alert, firedAt: now };
      active.push(enriched);
      // Only mark as "newly fired" if it wasn't already active
      if (!currentKeys.has(alert.key)) {
        fired.push(enriched);
        console.warn(`[Alert] FIRED: ${alert.key} — ${alert.message}`);
      }
    }
    // When key disappears from active, it auto-clears (not in `active` list)
  }

  // Log cleared alerts
  for (const prev of currentAlerts) {
    if (!active.find((a) => a.key === prev.key)) {
      console.info(`[Alert] CLEARED: ${prev.key}`);
    }
  }

  return { active, fired };
}

module.exports = { evaluateAlerts, RULES };
