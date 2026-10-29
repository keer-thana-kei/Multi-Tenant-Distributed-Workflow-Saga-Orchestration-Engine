const router = require('express').Router()
const Workflow = require('../models/Workflow')
const Execution = require('../models/Execution')
const executeRun = require('../engine/executor')
const { tenantAuth, tenantRateLimit } = require('../middleware/Tenant')

router.use(tenantAuth, tenantRateLimit)   // every route below is tenant-scoped

router.post('/', async (req, res, next) => {
    try {
        const { workflowName, steps } = req.body
        const workflow = await Workflow.create({ companyId: req.tenantId, workflowName, steps })
        res.status(201).json(workflow)
    } catch (err) { next(err) }
})

router.get('/', async (req, res, next) => {
    try {
        res.json(await Workflow.find({ companyId: req.tenantId }))
    } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
    try {
        const wf = await Workflow.findOne({ _id: req.params.id, companyId: req.tenantId })
        if (!wf) return res.status(404).json({ message: 'Workflow not found' })
        res.json(wf)
    } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
    try {
        const wf = await Workflow.findOneAndDelete({ _id: req.params.id, companyId: req.tenantId })
        if (!wf) return res.status(404).json({ message: 'Workflow not found' })
        res.json({ message: 'Deleted' })
    } catch (err) { next(err) }
})

// RUN: creates an Execution, then starts the engine in the background
router.post('/:id/run', async (req, res, next) => {
    try {
        const wf = await Workflow.findOne({ _id: req.params.id, companyId: req.tenantId })
        if (!wf) return res.status(404).json({ message: 'Workflow not found' })

        const execution = await Execution.create({
            companyId: req.tenantId,
            workflowId: wf._id,
            steps: wf.steps.map((s) => s.toObject())
        })

        executeRun(execution._id).catch((err) => console.error('Engine crashed:', err))

        res.status(202).json({ executionId: execution._id })
    } catch (err) { next(err) }
})

// Run history for this tenant
router.get('/executions/:execId', async (req, res, next) => {
    try {
        const ex = await Execution.findOne({ _id: req.params.execId, companyId: req.tenantId })
        if (!ex) return res.status(404).json({ message: 'Execution not found' })
        res.json(ex)
    } catch (err) { next(err) }
})

module.exports = router