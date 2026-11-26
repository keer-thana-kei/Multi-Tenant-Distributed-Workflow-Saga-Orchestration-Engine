'use strict';

const mongoose = require('mongoose');
const si = require('systeminformation');

// ── Workflow schema (mirrors backend) ──────────────────────────────────────
// We register a read-only model so we can query the same DB without coupling.
let WorkflowModel;
function getWorkflowModel() {
  if (WorkflowModel) return WorkflowModel;
  const StepSchema = new mongoose.Schema(
    { name: String, url: String, method: String, status: String },
    { _id: false }
  );
  const WorkflowSchema = new mongoose.Schema(
    { companyId: String, workflowName: String, steps: [StepSchema], status: String },
    { timestamps: true }
  );

  // Use already-registered model if it exists (prevents OverwriteModelError)
  try {
    WorkflowModel = mongoose.model('Workflow');
  } catch {
    WorkflowModel = mongoose.model('Workflow', WorkflowSchema);
  }
  return WorkflowModel;
}

/**
 * Collect real CPU + memory metrics from systeminformation.
 */
async function collectSystemMetrics() {
  const [load, mem] = await Promise.all([si.currentLoad(), si.mem()]);
  return {
    cpu: {
      usagePercent: parseFloat(load.currentLoad.toFixed(2)),
      coreCount: load.cpus?.length || 0,
    },
    memory: {
      totalBytes: mem.total,
      usedBytes: mem.used,
      freeBytes: mem.free,
      usagePercent: parseFloat(((mem.used / mem.total) * 100).toFixed(2)),
    },
  };
}

/**
 * Collect workflow metrics per tenant (companyId) from MongoDB.
 * When a tenantId is provided, only that tenant's data is returned.
 * Returns:
 * {
 *   tenants: [ { companyId, total, pending, running, success, failed } ],
 *   global: { total, pending, running, success, failed },
 *   recentFailureRate: number   // % of workflows in last 60 min that failed
 * }
 */
async function collectWorkflowMetrics(tenantId) {
  if (tenantId !== undefined && tenantId !== null) {
    if (typeof tenantId !== 'string' || !tenantId.trim()) {
      throw new Error('companyId must be a non-empty string');
    }
  }

  const Workflow = getWorkflowModel();

  // Build initial match stage — scope to single tenant when specified
  const matchStage = tenantId ? { $match: { companyId: String(tenantId).trim() } } : null;

  // Aggregate per tenant
  const pipeline = [
    ...(matchStage ? [matchStage] : []),
    {
      $group: {
        _id: '$companyId',
        total: { $sum: 1 },
        pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        running: { $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] } },
        success: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ];
  const tenantAgg = await Workflow.aggregate(pipeline);

  // Global totals
  const global = tenantAgg.reduce(
    (acc, t) => ({
      total: acc.total + t.total,
      pending: acc.pending + t.pending,
      running: acc.running + t.running,
      success: acc.success + t.success,
      failed: acc.failed + t.failed,
    }),
    { total: 0, pending: 0, running: 0, success: 0, failed: 0 }
  );

  // Recent failure rate (last 60 minutes)
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recentMatch = { updatedAt: { $gte: since } };
  if (tenantId) recentMatch.companyId = tenantId;
  const recent = await Workflow.aggregate([
    { $match: recentMatch },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      },
    },
  ]);

  const recentDoc = recent[0] || { total: 0, failed: 0 };
  const recentFailureRate =
    recentDoc.total > 0
      ? parseFloat(((recentDoc.failed / recentDoc.total) * 100).toFixed(2))
      : 0;

  return {
    tenants: tenantAgg.map((t) => ({
      companyId: t._id || 'unknown',
      total: t.total,
      pending: t.pending,
      running: t.running,
      success: t.success,
      failed: t.failed,
    })),
    global,
    recentFailureRate,
  };
}

/**
 * Collect all metrics: system + workflow.
 */
async function collectMetrics() {
  const [system, workflows] = await Promise.all([
    collectSystemMetrics().catch((err) => ({ error: err.message })),
    collectWorkflowMetrics().catch((err) => ({ error: err.message })),
  ]);

  return {
    collectedAt: new Date().toISOString(),
    system,
    workflows,
  };
}

/**
 * Strict tenant-specific metrics query.
 * Throws error if companyId is missing or empty.
 * Never executes an unfiltered aggregation.
 */
async function collectTenantMetrics(companyId) {
  if (!companyId || typeof companyId !== 'string' || !companyId.trim()) {
    throw new Error('companyId is mandatory for tenant-specific metrics');
  }
  return collectWorkflowMetrics(companyId.trim());
}

module.exports = {
  collectMetrics,
  collectSystemMetrics,
  collectWorkflowMetrics,
  collectTenantMetrics,
  getWorkflowModel,
};
