const router = require('express').Router()
const mongoose = require('mongoose')
const Execution = require('../models/Execution')
const DeadLetter = require('../models/DeadLetter')
const { tenantAuth } = require('../middleware/tenant')

router.use(tenantAuth)

// ── Helpers ──────────────────────────────────────────────────────────────

function parseDateRange(query) {
    let start = null
    let end = null

    if (query.startDate) {
        start = new Date(query.startDate)
        if (isNaN(start.getTime())) return null
    }

    if (query.endDate) {
        end = new Date(query.endDate)
        if (isNaN(end.getTime())) return null
        if (query.endDate.length === 10) {
            end.setHours(23, 59, 59, 999)
        }
    }

    return { start, end }
}

function validateCompanyId(req, res) {
    if (!req.tenantId || !mongoose.Types.ObjectId.isValid(req.tenantId)) {
        res.status(401).json({
            success: false,
            message: 'Unauthorized: missing or invalid tenant identification'
        })
        return false
    }

    const { companyId } = req.query
    if (companyId) {
        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            res.status(400).json({
                success: false,
                message: 'Invalid company ID format'
            })
            return false
        }

        if (String(companyId) !== String(req.tenantId)) {
            res.status(403).json({
                success: false,
                message: 'Unauthorized: companyId does not belong to authenticated tenant'
            })
            return false
        }
    }

    return true
}

function buildBaseMatch(req, dateRange) {
    if (!req.tenantId || !mongoose.Types.ObjectId.isValid(req.tenantId)) {
        throw new Error('Tenant identification missing or invalid')
    }
    const tenantObjId = new mongoose.Types.ObjectId(req.tenantId)
    const match = { companyId: tenantObjId }

    if (dateRange && (dateRange.start || dateRange.end)) {
        match.createdAt = {}
        if (dateRange.start) match.createdAt.$gte = dateRange.start
        if (dateRange.end) match.createdAt.$lte = dateRange.end
    }

    return match
}

// ── GET /companies ────────────────────────────────────────────────────────
// Returns companies/tenants accessible to the authenticated tenant
router.get('/companies', async (req, res, next) => {
    try {
        const tenant = req.tenant
        res.json({
            success: true,
            data: [
                {
                    id: String(tenant._id),
                    name: tenant.name,
                    active: tenant.active
                }
            ]
        })
    } catch (err) { next(err) }
})

// ── 1. GET /summary ───────────────────────────────────────────────────────

router.get('/summary', async (req, res, next) => {
    try {
        if (!validateCompanyId(req, res)) return

        const dateRange = parseDateRange(req.query)
        if (dateRange === null) {
            return res.status(400).json({ success: false, message: 'Invalid date format' })
        }

        const match = buildBaseMatch(req, dateRange)

        const pipeline = [
            { $match: match },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    success: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
                    failed: {
                        $sum: {
                            $cond: [
                                { $in: ['$status', ['failed', 'compensating', 'compensated']] },
                                1,
                                0
                            ]
                        }
                    },
                    running: { $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] } },
                    pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                    compensating: { $sum: { $cond: [{ $eq: ['$status', 'compensating'] }, 1, 0] } },
                    compensated: { $sum: { $cond: [{ $eq: ['$status', 'compensated'] }, 1, 0] } }
                }
            }
        ]

        const [result] = await Execution.aggregate(pipeline)

        const data = result || {
            total: 0,
            success: 0,
            failed: 0,
            running: 0,
            pending: 0,
            compensating: 0,
            compensated: 0
        }
        delete data._id

        data.successRate = data.total > 0
            ? parseFloat(((data.success / data.total) * 100).toFixed(2))
            : 0
        data.failureRate = data.total > 0
            ? parseFloat(((data.failed / data.total) * 100).toFixed(2))
            : 0

        res.json({ success: true, data })
    } catch (err) { next(err) }
})

// ── 2. GET /failures ──────────────────────────────────────────────────────

router.get('/failures', async (req, res, next) => {
    try {
        if (!validateCompanyId(req, res)) return

        const dateRange = parseDateRange(req.query)
        if (dateRange === null) {
            return res.status(400).json({ success: false, message: 'Invalid date format' })
        }

        const match = buildBaseMatch(req, dateRange)
        const failedStatuses = ['failed', 'compensating', 'compensated']
        const failedMatch = { ...match, status: { $in: failedStatuses } }

        // A. Failures grouped by time (day)
        const failuresByTime = await Execution.aggregate([
            { $match: failedMatch },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, date: '$_id', count: 1 } }
        ])

        // B. Failures grouped by execution status
        const failuresByStatus = await Execution.aggregate([
            { $match: failedMatch },
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $project: { _id: 0, status: '$_id', count: 1 } }
        ])

        // C. Failures grouped by workflow
        const failuresByWorkflow = await Execution.aggregate([
            { $match: failedMatch },
            { $group: { _id: '$workflowId', count: { $sum: 1 } } },
            {
                $lookup: {
                    from: 'workflows',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'workflow'
                }
            },
            { $unwind: { path: '$workflow', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 0,
                    workflowId: '$_id',
                    workflowName: { $ifNull: ['$workflow.workflowName', 'Unknown Workflow'] },
                    count: 1
                }
            },
            { $sort: { count: -1 } }
        ])

        // D. Failures grouped by step
        const failuresByStep = await Execution.aggregate([
            { $match: match },
            { $unwind: '$steps' },
            {
                $match: {
                    'steps.status': {
                        $in: ['failed', 'compensation_failed']
                    }
                }
            },
            {
                $group: {
                    _id: '$steps.name',
                    failureCount: { $sum: 1 }
                }
            },
            { $project: { _id: 0, stepName: '$_id', count: '$failureCount' } },
            { $sort: { count: -1 } }
        ])

        // E. Step retry and attempt statistics (steps with attempts > 1)
        const stepRetryStats = await Execution.aggregate([
            { $match: match },
            { $unwind: '$steps' },
            { $match: { 'steps.attempts': { $gt: 1 } } },
            {
                $group: {
                    _id: '$steps.name',
                    totalRetries: { $sum: '$steps.attempts' },
                    maxAttempts: { $max: '$steps.attempts' },
                    avgAttempts: { $avg: '$steps.attempts' },
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    stepName: '$_id',
                    totalRetries: 1,
                    maxAttempts: 1,
                    avgAttempts: { $round: ['$avgAttempts', 2] },
                    count: 1
                }
            },
            { $sort: { totalRetries: -1 } }
        ])

        // F. Failure heatmap (hour-of-day [0-23] × day-of-week [1-7])
        const failureHeatmap = await Execution.aggregate([
            { $match: failedMatch },
            {
                $group: {
                    _id: {
                        hour: { $hour: '$createdAt' },
                        dayOfWeek: { $dayOfWeek: '$createdAt' }
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    hour: '$_id.hour',
                    dayOfWeek: '$_id.dayOfWeek',
                    count: 1
                }
            },
            { $sort: { dayOfWeek: 1, hour: 1 } }
        ])

        res.json({
            success: true,
            data: {
                failuresByTime,
                failuresByStatus,
                failuresByWorkflow,
                failuresByStep,
                stepRetryStats,
                failureHeatmap
            }
        })
    } catch (err) { next(err) }
})

// ── 3. GET /latency ───────────────────────────────────────────────────────

router.get('/latency', async (req, res, next) => {
    try {
        if (!validateCompanyId(req, res)) return

        const dateRange = parseDateRange(req.query)
        if (dateRange === null) {
            return res.status(400).json({ success: false, message: 'Invalid date format' })
        }

        const match = {
            ...buildBaseMatch(req, dateRange),
            startedAt: { $exists: true, $ne: null },
            finishedAt: { $exists: true, $ne: null }
        }

        // Summary duration stats
        const [overall] = await Execution.aggregate([
            { $match: match },
            {
                $addFields: {
                    durationMs: { $subtract: ['$finishedAt', '$startedAt'] }
                }
            },
            {
                $match: { durationMs: { $gte: 0 } }
            },
            {
                $group: {
                    _id: null,
                    avgDuration: { $avg: '$durationMs' },
                    minDuration: { $min: '$durationMs' },
                    maxDuration: { $max: '$durationMs' }
                }
            }
        ])

        const stats = overall
            ? {
                avgDuration: Math.round(overall.avgDuration),
                minDuration: Math.round(overall.minDuration),
                maxDuration: Math.round(overall.maxDuration)
            }
            : { avgDuration: 0, minDuration: 0, maxDuration: 0 }

        // Latency trend over time (by day)
        const latencyTrend = await Execution.aggregate([
            { $match: match },
            {
                $addFields: {
                    durationMs: { $subtract: ['$finishedAt', '$startedAt'] }
                }
            },
            {
                $match: { durationMs: { $gte: 0 } }
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$finishedAt' } },
                    avgMs: { $avg: '$durationMs' }
                }
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, date: '$_id', avgMs: { $round: ['$avgMs', 0] } } }
        ])

        // Execution duration distribution buckets
        const durationDistribution = await Execution.aggregate([
            { $match: match },
            {
                $addFields: {
                    durationMs: { $subtract: ['$finishedAt', '$startedAt'] }
                }
            },
            {
                $match: { durationMs: { $gte: 0 } }
            },
            {
                $bucket: {
                    groupBy: '$durationMs',
                    boundaries: [0, 1000, 5000, 15000, 30000, 60000],
                    default: 60000,
                    output: { count: { $sum: 1 } }
                }
            },
            {
                $project: {
                    _id: 0,
                    bucket: {
                        $switch: {
                            branches: [
                                { case: { $eq: ['$_id', 0] }, then: '0-1s' },
                                { case: { $eq: ['$_id', 1000] }, then: '1-5s' },
                                { case: { $eq: ['$_id', 5000] }, then: '5-15s' },
                                { case: { $eq: ['$_id', 15000] }, then: '15-30s' },
                                { case: { $eq: ['$_id', 30000] }, then: '30-60s' }
                            ],
                            default: '60s+'
                        }
                    },
                    count: 1
                }
            }
        ])

        res.json({
            success: true,
            data: {
                ...stats,
                latencyTrend,
                durationDistribution
            }
        })
    } catch (err) { next(err) }
})

// ── 4. GET /quota ─────────────────────────────────────────────────────────

router.get('/quota', async (req, res, next) => {
    try {
        if (!validateCompanyId(req, res)) return

        const tenant = req.tenant
        const maxRunsPerMinute = tenant.maxRunsPerMinute || 60

        const oneMinuteAgo = new Date(Date.now() - 60 * 1000)
        const tenantObjId = new mongoose.Types.ObjectId(req.tenantId)

        // Count executions started in the current 60-second window
        const [recentResult] = await Execution.aggregate([
            {
                $match: {
                    companyId: tenantObjId,
                    $or: [
                        { startedAt: { $gte: oneMinuteAgo } },
                        { createdAt: { $gte: oneMinuteAgo } }
                    ]
                }
            },
            { $count: 'count' }
        ])

        const currentRunsThisMinute = recentResult ? recentResult.count : 0

        // Total lifetime executions for this tenant
        const [totalResult] = await Execution.aggregate([
            { $match: { companyId: tenantObjId } },
            { $count: 'count' }
        ])
        const totalExecutions = totalResult ? totalResult.count : 0

        const quotaUtilization = Math.min(
            100,
            parseFloat(((currentRunsThisMinute / maxRunsPerMinute) * 100).toFixed(2))
        )

        const remainingQuota = Math.max(0, maxRunsPerMinute - currentRunsThisMinute)

        // Quota threshold alerts
        const WARNING_THRESHOLD = 80
        const EXCEEDED_THRESHOLD = 100
        let quotaStatus = 'normal'
        if (quotaUtilization >= EXCEEDED_THRESHOLD) {
            quotaStatus = 'exceeded'
        } else if (quotaUtilization >= WARNING_THRESHOLD) {
            quotaStatus = 'warning'
        }

        res.json({
            success: true,
            data: {
                tenantName: tenant.name,
                maxRunsPerMinute,
                currentRunsThisMinute,
                usedQuota: currentRunsThisMinute,
                totalQuota: maxRunsPerMinute,
                remainingQuota,
                quotaUtilization,
                quotaStatus,
                isWarning: quotaUtilization >= WARNING_THRESHOLD,
                isExceeded: quotaUtilization >= EXCEEDED_THRESHOLD,
                warningThreshold: WARNING_THRESHOLD,
                exceededThreshold: EXCEEDED_THRESHOLD,
                totalExecutions
            }
        })
    } catch (err) { next(err) }
})

// ── 5. GET /deadletters ───────────────────────────────────────────────────

router.get('/deadletters', async (req, res, next) => {
    try {
        if (!validateCompanyId(req, res)) return

        const dateRange = parseDateRange(req.query)
        if (dateRange === null) {
            return res.status(400).json({ success: false, message: 'Invalid date format' })
        }

        const match = buildBaseMatch(req, dateRange)

        // Count by status
        const statusCounts = await DeadLetter.aggregate([
            { $match: match },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            },
            { $project: { _id: 0, status: '$_id', count: 1 } }
        ])

        const totals = { open: 0, replayed: 0, discarded: 0, total: 0 }
        statusCounts.forEach(({ status, count }) => {
            if (status in totals) totals[status] = count
            totals.total += count
        })

        // Count by failure reason for open entries
        const openMatch = { ...match, status: 'open' }
        const reasonCounts = await DeadLetter.aggregate([
            { $match: openMatch },
            {
                $group: {
                    _id: '$reason',
                    count: { $sum: 1 }
                }
            },
            { $project: { _id: 0, reason: '$_id', count: 1 } }
        ])

        // Recent dead letters (last 10 open entries)
        const recent = await DeadLetter.find(openMatch)
            .sort({ createdAt: -1 })
            .limit(10)
            .select('stepName reason error createdAt')
            .lean()

        res.json({
            success: true,
            data: {
                ...totals,
                byReason: reasonCounts,
                recentOpen: recent.map(d => ({
                    stepName: d.stepName || 'Unknown',
                    reason: d.reason,
                    error: d.error ? d.error.substring(0, 200) : null,
                    createdAt: d.createdAt
                }))
            }
        })
    } catch (err) { next(err) }
})

module.exports = router
