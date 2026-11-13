const router = require('express').Router()
const Workflow = require('../models/Workflow')
const Execution = require('../models/Execution')
const executeRun = require('../engine/executor')
const { validateGraph } = require('../engine/graphValidator')
const { buildExecutionPlan } = require('../engine/buildPlan')
const { tenantAuth, tenantRateLimit } = require('../middleware/tenant')

router.use(tenantAuth, tenantRateLimit)

// Check a graph without saving it (the canvas can call this live)
router.post('/validate', (req, res) => {
    const { nodes, edges } = req.body
    const result = validateGraph(nodes, edges || [])
    res.json(result)
})

router.post('/', async (req, res, next) => {
    try {
        const { workflowName, steps, nodes, edges, triggerEvent } = req.body
        if (!workflowName) return res.status(400).json({ message: 'workflowName is required' })

        // Graph workflow
        if (Array.isArray(nodes) && nodes.length) {
            const result = validateGraph(nodes, edges || [])
            if (!result.valid) {
                return res.status(400).json({ message: 'Invalid graph', errors: result.errors })
            }
            const workflow = await Workflow.create({
                companyId: req.tenantId,
                workflowName,
                triggerEvent,
                nodes,
                edges: edges || []
            })
            return res.status(201).json(workflow)
        }

        // Straight-line workflow
        if (!Array.isArray(steps) || steps.length === 0) {
            return res.status(400).json({ message: 'Provide either "steps" or "nodes"' })
        }
        const workflow = await Workflow.create({
            companyId: req.tenantId,
            workflowName,
            triggerEvent,
            steps
        })
        res.status(201).json(workflow)
    } catch (err) { next(err) }
})

router.get('/', async (req, res, next) => {
    try {
        res.json(await Workflow.find({ companyId: req.tenantId }))
    } catch (err) { next(err) }
})

router.get('/executions/:execId', async (req, res, next) => {
    try {
        const ex = await Execution.findOne({ _id: req.params.execId, companyId: req.tenantId })
        if (!ex) return res.status(404).json({ message: 'Execution not found' })
        res.json(ex)
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

router.post('/:id/run', async (req, res, next) => {
    try {
        const wf = await Workflow.findOne({ _id: req.params.id, companyId: req.tenantId })
        if (!wf) return res.status(404).json({ message: 'Workflow not found' })

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

        executeRun(execution._id).catch((err) => console.error('Engine crashed:', err))

        res.status(202).json({ executionId: execution._id })
    } catch (err) { next(err) }
})

module.exports = router