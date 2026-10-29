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
 * Returns:
 * {
 *   tenants: [ { companyId, total, pending, running, success, failed } ],
 *   global: { total, pending, running, success, failed },
 *   recentFailureRate: number   // % of workflows in last 60 min that failed
 * }
 */
async function collectWorkflowMetrics() {
  const Workflow = getWorkflowModel();

  // Aggregate per tenant
  const tenantAgg = await Workflow.aggregate([
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
  ]);

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
  const recent = await Workflow.aggregate([
    { $match: { updatedAt: { $gte: since } } },
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

module.exports = {
  collectMetrics,
  collectSystemMetrics,
  collectWorkflowMetrics,
  getWorkflowModel,
};
