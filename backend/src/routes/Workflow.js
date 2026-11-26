const router = require('express').Router()
const mongoose = require('mongoose')
const Workflow = require('../models/Workflow')
const Execution = require('../models/Execution')
const executeRun = require('../engine/executor')
const { validateGraph } = require('../engine/graphValidator')
const { buildExecutionPlan } = require('../engine/buildPlan')
const { tenantAuth, tenantRateLimit } = require('../middleware/tenant')

router.use(tenantAuth, tenantRateLimit)

const isId = (id) => mongoose.Types.ObjectId.isValid(id)

// Check a graph without saving it (the canvas calls this live)
router.post('/validate', (req, res) => {
    const { nodes, edges } = req.body
    const result = validateGraph(nodes, edges || [])
    res.json(result)
})

// Create
router.post('/', async (req, res, next) => {
    try {
        const { workflowName, steps, nodes, edges, triggerEvent } = req.body
        if (!workflowName) return res.status(400).json({ message: 'workflowName is required' })

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

// List workflows
router.get('/', async (req, res, next) => {
    try {
        res.json(await Workflow.find({ companyId: req.tenantId }).sort({ updatedAt: -1 }))
    } catch (err) { next(err) }
})

// ---- Run history (must be BEFORE /:id and /executions/:execId)
// Optional filters: ?workflowId=...&status=success&limit=20&page=1
router.get('/executions', async (req, res, next) => {
    try {
        const filter = { companyId: req.tenantId }

        if (req.query.workflowId) {
            if (!isId(req.query.workflowId)) {
                return res.status(400).json({ message: 'Invalid workflowId' })
            }
            filter.workflowId = req.query.workflowId
        }

        res.json(execution);

    } catch (err) {
        next(err);
    }
});

// UPDATE WORKFLOW
router.put('/:id', async (req, res, next) => {
    try {
        const { workflowName, nodes, edges } = req.body;

        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
                message: 'Invalid workflow ID'
            });
        }

        if (!workflowName) {
            return res.status(400).json({
                message: 'workflowName is required'
            });
        }

        if (!Array.isArray(nodes) || nodes.length === 0) {
            return res.status(400).json({
                message: 'Workflow must contain executable nodes'
            });
        }

        const result = validateGraph(nodes, edges || []);

        if (!result.valid) {
            return res.status(400).json({
                message: 'Invalid graph',
                errors: result.errors
            });
        }

        const workflow = await Workflow.findOneAndUpdate(
            {
                _id: req.params.id,
                companyId: req.tenantId
            },
            {
                workflowName,
                nodes,
                edges: edges || []
            },
            {
                new: true,
                runValidators: true
            }
        );

        if (!workflow) {
            return res.status(404).json({
                message: 'Workflow not found'
            });
        }

        res.json(workflow);

    } catch (err) {
        next(err);
    }
});

// GET SINGLE WORKFLOW
router.get('/:id', async (req, res, next) => {
    try {
        if (!isId(req.params.id)) return res.status(404).json({ message: 'Workflow not found' })
        const wf = await Workflow.findOne({ _id: req.params.id, companyId: req.tenantId })
        if (!wf) return res.status(404).json({ message: 'Workflow not found' })
        res.json(wf)
    } catch (err) { next(err) }
})

// Update (edit a saved workflow). Send any of:
// workflowName, triggerEvent, nodes + edges (graph) or steps (straight-line)
router.put('/:id', async (req, res, next) => {
    try {
        if (!isId(req.params.id)) return res.status(404).json({ message: 'Workflow not found' })

        const wf = await Workflow.findOne({ _id: req.params.id, companyId: req.tenantId })
        if (!wf) return res.status(404).json({ message: 'Workflow not found' })

        const { workflowName, triggerEvent, nodes, edges, steps } = req.body

        if (workflowName !== undefined) {
            if (!workflowName) return res.status(400).json({ message: 'workflowName cannot be empty' })
            wf.workflowName = workflowName
        }
        if (triggerEvent !== undefined) wf.triggerEvent = triggerEvent || undefined

        if (nodes !== undefined) {
            if (!Array.isArray(nodes) || nodes.length === 0) {
                return res.status(400).json({ message: 'nodes must be a non-empty array' })
            }
            const result = validateGraph(nodes, edges || [])
            if (!result.valid) {
                return res.status(400).json({ message: 'Invalid graph', errors: result.errors })
            }
            wf.nodes = nodes
            wf.edges = edges || []
            wf.steps = []                    // a workflow is either a graph or steps
        } else if (steps !== undefined) {
            if (!Array.isArray(steps) || steps.length === 0) {
                return res.status(400).json({ message: 'steps must be a non-empty array' })
            }
            wf.steps = steps
            wf.nodes = []
            wf.edges = []
        } else if (edges !== undefined) {
            return res.status(400).json({ message: 'Send "nodes" together with "edges"' })
        }

        await wf.save()
        res.json(wf)
    } catch (err) {
        if (err.name === 'ValidationError') {
            return res.status(400).json({ message: err.message })
        }
        next(err)
    }
})

// Delete
router.delete('/:id', async (req, res, next) => {
    try {
        if (!isId(req.params.id)) return res.status(404).json({ message: 'Workflow not found' })
        const wf = await Workflow.findOneAndDelete({ _id: req.params.id, companyId: req.tenantId })
        if (!wf) return res.status(404).json({ message: 'Workflow not found' })
        res.json({ message: 'Deleted' })
    } catch (err) { next(err) }
})

// Run
router.post('/:id/run', async (req, res, next) => {
    try {
        if (!isId(req.params.id)) return res.status(404).json({ message: 'Workflow not found' })
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