'use strict';

/**
 * Saga Lifecycle Event Adapter
 *
 * Provides a non-invasive bridge for publishing genuine saga lifecycle changes.
 * Can be invoked by the saga executor, model middleware, or test harnesses.
 *
 * Guarantees:
 *  - Delivery failures are logged and NEVER throw / interrupt saga execution.
 *  - Deduplicates consecutive identical state transitions.
 *  - Schema-compliant versioned envelopes with tenant isolation.
 */

const logger = require('../logger');
const { TYPES, createEvent } = require('./schema');

// Reference to delivery function (injected from hub.js to avoid circular dependencies)
let _deliverToTenant = null;

function setDeliverFn(fn) {
  _deliverToTenant = fn;
}

// ── In-Memory Deduplication Window ──────────────────────────────────────────
const DEDUP_WINDOW_MS = 10000; // 10-second deduplication cache
const recentEvents = new Map();

function isDuplicate(workflowId, eventType, stepIndex, status) {
  if (!workflowId) return false;
  const key = `${workflowId}:${eventType}:${stepIndex !== undefined ? stepIndex : 'wf'}:${status || ''}`;
  const now = Date.now();
  const prev = recentEvents.get(key);

  if (prev && (now - prev) < DEDUP_WINDOW_MS) {
    return true;
  }

  recentEvents.set(key, now);

  // Periodic cleanup
  if (recentEvents.size > 2000) {
    for (const [k, ts] of recentEvents) {
      if (now - ts > DEDUP_WINDOW_MS) {
        recentEvents.delete(k);
      }
    }
  }

  return false;
}

function clearDedupCache() {
  recentEvents.clear();
}

/**
 * Core dispatch function.
 * Wraps everything in try/catch to satisfy:
 * "Log delivery failures without allowing monitoring failures to interrupt saga execution."
 */
function publishLifecycleEvent(eventType, tenantId, payload, severity = 'info') {
  try {
    if (typeof _deliverToTenant !== 'function') {
      logger.debug('SagaAdapter: delivery function not bound yet');
      return false;
    }

    const workflowId = payload?.workflowId;
    const stepIndex = payload?.stepIndex;
    const status = payload?.status || payload?.stepStatus;

    if (isDuplicate(workflowId, eventType, stepIndex, status)) {
      logger.debug('SagaAdapter: suppressed duplicate event', { workflowId, eventType, stepIndex });
      return false;
    }

    const event = createEvent(eventType, tenantId, payload, severity);
    _deliverToTenant(event.tenantId, event);
    return true;
  } catch (err) {
    logger.error('SagaAdapter: delivery failure (saga execution unaffected)', {
      eventType,
      tenantId,
      error: err.message,
    });
    return false;
  }
}

// ── Convenience lifecycle publishers ────────────────────────────────────────

function notifyWorkflowStarted(doc) {
  return publishLifecycleEvent(
    TYPES.WORKFLOW_STARTED,
    doc.companyId,
    {
      workflowId:   String(doc._id || doc.id),
      workflowName: doc.workflowName,
      status:       'running',
      tenantId:     doc.companyId,
    },
    'info'
  );
}

function notifyStepRunning(doc, stepIndex) {
  const step = doc.steps?.[stepIndex];
  return publishLifecycleEvent(
    TYPES.WORKFLOW_STEP_RUNNING,
    doc.companyId,
    {
      workflowId:   String(doc._id || doc.id),
      workflowName: doc.workflowName,
      tenantId:     doc.companyId,
      stepIndex,
      stepName:     step?.name,
      stepStatus:   'running',
    },
    'info'
  );
}

function notifyStepSuccess(doc, stepIndex) {
  const step = doc.steps?.[stepIndex];
  return publishLifecycleEvent(
    TYPES.WORKFLOW_STEP_SUCCESS,
    doc.companyId,
    {
      workflowId:   String(doc._id || doc.id),
      workflowName: doc.workflowName,
      tenantId:     doc.companyId,
      stepIndex,
      stepName:     step?.name,
      stepStatus:   'success',
    },
    'info'
  );
}

function notifyStepFailed(doc, stepIndex, error) {
  const step = doc.steps?.[stepIndex];
  return publishLifecycleEvent(
    TYPES.WORKFLOW_STEP_FAILED,
    doc.companyId,
    {
      workflowId:   String(doc._id || doc.id),
      workflowName: doc.workflowName,
      tenantId:     doc.companyId,
      stepIndex,
      stepName:     step?.name,
      stepStatus:   'failed',
      error:        error ? (error.message || String(error)) : undefined,
    },
    'warn'
  );
}

function notifyStepRetry(doc, stepIndex, attempt, maxRetries = 3) {
  const step = doc.steps?.[stepIndex];
  return publishLifecycleEvent(
    TYPES.WORKFLOW_STEP_RETRY,
    doc.companyId,
    {
      workflowId:   String(doc._id || doc.id),
      workflowName: doc.workflowName,
      tenantId:     doc.companyId,
      stepIndex,
      stepName:     step?.name,
      attempt,
      maxRetries,
    },
    'warn'
  );
}

function notifyStepRetrySuccess(doc, stepIndex) {
  const step = doc.steps?.[stepIndex];
  return publishLifecycleEvent(
    TYPES.WORKFLOW_STEP_RETRY_SUCCESS,
    doc.companyId,
    {
      workflowId:   String(doc._id || doc.id),
      workflowName: doc.workflowName,
      tenantId:     doc.companyId,
      stepIndex,
      stepName:     step?.name,
      stepStatus:   'success',
    },
    'info'
  );
}

function notifyCompensating(doc, stepIndex) {
  const step = doc.steps?.[stepIndex];
  return publishLifecycleEvent(
    TYPES.WORKFLOW_COMPENSATING,
    doc.companyId,
    {
      workflowId:   String(doc._id || doc.id),
      workflowName: doc.workflowName,
      tenantId:     doc.companyId,
      stepIndex,
      stepName:     step?.name,
      stepStatus:   'rolled back',
    },
    'warn'
  );
}

function notifyCompensationFailed(doc, stepIndex, error) {
  const step = stepIndex !== undefined ? doc.steps?.[stepIndex] : null;
  return publishLifecycleEvent(
    TYPES.WORKFLOW_COMPENSATION_FAILED,
    doc.companyId,
    {
      workflowId:   String(doc._id || doc.id),
      workflowName: doc.workflowName,
      tenantId:     doc.companyId,
      stepIndex,
      stepName:     step?.name,
      stepStatus:   'compensation_failed',
      error:        error ? (error.message || String(error)) : 'Rollback failed',
    },
    'error'
  );
}

function notifyWorkflowCompleted(doc) {
  return publishLifecycleEvent(
    TYPES.WORKFLOW_COMPLETED,
    doc.companyId,
    {
      workflowId:   String(doc._id || doc.id),
      workflowName: doc.workflowName,
      status:       'success',
      tenantId:     doc.companyId,
    },
    'info'
  );
}

function notifyWorkflowFailed(doc, error) {
  return publishLifecycleEvent(
    TYPES.WORKFLOW_FAILED,
    doc.companyId,
    {
      workflowId:   String(doc._id || doc.id),
      workflowName: doc.workflowName,
      status:       'failed',
      tenantId:     doc.companyId,
      error:        error ? (error.message || String(error)) : undefined,
    },
    'error'
  );
}

module.exports = {
  setDeliverFn,
  publishLifecycleEvent,
  isDuplicate,
  clearDedupCache,
  notifyWorkflowStarted,
  notifyStepRunning,
  notifyStepSuccess,
  notifyStepFailed,
  notifyStepRetry,
  notifyStepRetrySuccess,
  notifyCompensating,
  notifyCompensationFailed,
  notifyWorkflowCompleted,
  notifyWorkflowFailed,
};
