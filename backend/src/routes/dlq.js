const router = require('express').Router()
const DeadLetter = require('../models/DeadLetter')
const Workflow = require('../models/Workflow')
const Execution = require('../models/Execution')
const executeRun = require('../engine/executor')
const { runWithRetry, policyOf } = executeRun
const { buildExecutionPlan } = require('../engine/buildPlan')
const { tenantAuth, tenantRateLimit } = require('../middleware/tenant')

router.use(tenantAuth, tenantRateLimit)

// List entries. Optional ?status=open|replayed|discarded
router.get('/', async (req, res, next) => {
    try {
        const filter = { companyId: req.tenantId }
        if (req.query.status) filter.status = req.query.status
        const items = await DeadLetter.find(filter).sort({ createdAt: -1 }).limit(100)
        res.json(items)
    } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
    try {
        const item = await DeadLetter.findOne({ _id: req.params.id, companyId: req.tenantId })
        if (!item) return res.status(404).json({ message: 'Entry not found' })
        res.json(item)
    } catch (err) { next(err) }
})

// Replay
//  - step_failed:         start a NEW execution of the same workflow
//  - compensation_failed: call the undo URL again
router.post('/:id/replay', async (req, res, next) => {
    try {
        const item = await DeadLetter.findOne({ _id: req.params.id, companyId: req.tenantId })
        if (!item) return res.status(404).json({ message: 'Entry not found' })
        if (item.status !== 'open') {
            return res.status(409).json({ message: `Entry is already ${item.status}` })
        }

        if (item.reason === 'step_failed') {
            const wf = await Workflow.findOne({ _id: item.workflowId, companyId: req.tenantId })
            if (!wf) return res.status(404).json({ message: 'Workflow no longer exists' })

            let plan
            try {
                plan = buildExecutionPlan(wf)
            } catch (err) {
                return res.status(400).json({ message: err.message })
            }

            const execution = await Execution.create({
                companyId: req.tenantId,
                workflowId: wf._id,
                steps: plan.steps,
                edges: plan.edges
            })
            executeRun(execution._id).catch((e) => console.error('Engine crashed:', e))

            item.status = 'replayed'
            item.replayExecutionId = execution._id
            await item.save()
            return res.status(202).json({ executionId: execution._id })
        }

        // compensation_failed: retry the undo call
        const { ok, error } = await runWithRetry(item.url, item.method || 'POST', policyOf({}))
        if (!ok) {
            return res.status(502).json({ message: 'Undo still failing', error })
        }
        item.status = 'replayed'
        await item.save()
        res.json({ message: 'Undo succeeded', item })
    } catch (err) { next(err) }
})

// Discard (a human decided no action is needed)
router.delete('/:id', async (req, res, next) => {
    try {
        const item = await DeadLetter.findOneAndUpdate(
            { _id: req.params.id, companyId: req.tenantId, status: 'open' },
            { status: 'discarded' },
            { new: true }
        )
        if (!item) return res.status(404).json({ message: 'Open entry not found' })
        res.json(item)
    } catch (err) { next(err) }
})

module.exports = router