const router = require('express').Router()
const mongoose = require('mongoose')
const Workflow = require('../models/Workflow')
const Execution = require('../models/Execution')
const executeRun = require('../engine/executor')
const { validateGraph } = require('../engine/graphValidator')
const { buildExecutionPlan } = require('../engine/buildPlan')
const { tenantAuth, tenantRateLimit } = require('../middleware/tenant')

const router = require('express').Router();
const mongoose = require('mongoose');

const isId = (id) => mongoose.Types.ObjectId.isValid(id)

// Check a graph without saving it (the canvas calls this live)
router.post('/validate', (req, res) => {
    const { nodes, edges } = req.body;

    const result = validateGraph(nodes, edges || []);
    res.json(result);
});

// Create
router.post('/', async (req, res, next) => {
    try {
        const { workflowName, steps, nodes, edges, triggerEvent } = req.body;

        if (!workflowName) {
            return res.status(400).json({
                message: 'workflowName is required'
            });
        }

        // Graph-based workflow
        if (Array.isArray(nodes) && nodes.length > 0) {
            const result = validateGraph(nodes, edges || []);

        if (Array.isArray(nodes) && nodes.length) {
            const result = validateGraph(nodes, edges || [])
            if (!result.valid) {
                return res.status(400).json({
                    message: 'Invalid graph',
                    errors: result.errors
                });
            }

            const workflow = await Workflow.create({
                companyId: req.tenantId,
                workflowName,
                triggerEvent,
                nodes,
                edges: edges || []
            });

            return res.status(201).json(workflow);
        }

        if (!Array.isArray(steps) || steps.length === 0) {
            return res.status(400).json({
                message: 'Provide either steps or nodes'
            });
        }

        const workflow = await Workflow.create({
            companyId: req.tenantId,
            workflowName,
            triggerEvent,
            steps
        });

        res.status(201).json(workflow);

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
        if (req.query.status) filter.status = req.query.status

        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100)
        const page = Math.max(parseInt(req.query.page) || 1, 1)

        const [items, total] = await Promise.all([
            Execution.find(filter)
                .select('workflowId status startedAt finishedAt createdAt steps.nodeId steps.name steps.status')
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Execution.countDocuments(filter)
        ])

        res.json({ items, total, page, limit })
    } catch (err) { next(err) }
})

// One execution (full detail)
router.get('/executions/:execId', async (req, res, next) => {
    try {
        if (!isId(req.params.execId)) return res.status(404).json({ message: 'Execution not found' })
        const ex = await Execution.findOne({ _id: req.params.execId, companyId: req.tenantId })
        if (!ex) return res.status(404).json({ message: 'Execution not found' })
        res.json(ex)
    } catch (err) { next(err) }
})

// One workflow
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
            workflowId: workflow._id,
            steps: executionSteps,
            edges: executionEdges
        });

        executeRun(execution._id).catch(err => {
            console.error('Engine crashed:', err);
        });

        res.status(202).json({
            message: 'Workflow execution started',
            executionId: execution._id
        });

    } catch (err) {
        next(err);
    }
});

module.exports = router;
