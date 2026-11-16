
const router = require('express').Router();
const mongoose = require('mongoose');

const Workflow = require('../models/Workflow');
const Execution = require('../models/Execution');

const executeRun = require('../engine/executor');
const { validateGraph } = require('../engine/graphValidator');
const { buildExecutionPlan } = require('../engine/buildPlan');

const {
    tenantAuth,
    tenantRateLimit
} = require('../middleware/tenant');

// Apply authentication and tenant rate limiting
router.use(tenantAuth, tenantRateLimit);

// VALIDATE GRAPH
router.post('/validate', (req, res) => {
    const { nodes, edges } = req.body;

    const result = validateGraph(nodes, edges || []);
    res.json(result);
});

// CREATE WORKFLOW
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

        // Step-based workflow
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

    } catch (err) {
        next(err);
    }
});

// GET ALL WORKFLOWS FOR LOGGED-IN TENANT
router.get('/', async (req, res, next) => {
    try {
        const workflows = await Workflow.find({
            companyId: req.tenantId
        });

        res.json(workflows);
    } catch (err) {
        next(err);
    }
});

// GET EXECUTION BY ID
router.get('/executions/:execId', async (req, res, next) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.execId)) {
            return res.status(400).json({
                message: 'Invalid execution ID'
            });
        }

        const execution = await Execution.findOne({
            _id: req.params.execId,
            companyId: req.tenantId
        });

        if (!execution) {
            return res.status(404).json({
                message: 'Execution not found'
            });
        }

        res.json(execution);

    } catch (err) {
        next(err);
    }
});

// GET SINGLE WORKFLOW
router.get('/:id', async (req, res, next) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
                message: 'Invalid workflow ID'
            });
        }

        const workflow = await Workflow.findOne({
            _id: req.params.id,
            companyId: req.tenantId
        });

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

// DELETE WORKFLOW
router.delete('/:id', async (req, res, next) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
                message: 'Invalid workflow ID'
            });
        }

        const workflow = await Workflow.findOneAndDelete({
            _id: req.params.id,
            companyId: req.tenantId
        });

        if (!workflow) {
            return res.status(404).json({
                message: 'Workflow not found'
            });
        }

        res.json({
            message: 'Workflow deleted successfully'
        });

    } catch (err) {
        next(err);
    }
});

// RUN WORKFLOW
router.post('/:id/run', async (req, res, next) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({
                message: 'Invalid workflow ID'
            });
        }

        const workflow = await Workflow.findOne({
            _id: req.params.id,
            companyId: req.tenantId
        });

        if (!workflow) {
            return res.status(404).json({
                message: 'Workflow not found'
            });
        }

        let executionSteps;
        let executionEdges = [];

        // Graph-based execution
        if (Array.isArray(workflow.nodes) && workflow.nodes.length > 0) {
            let plan;

            try {
                plan = buildExecutionPlan(workflow);
            } catch (err) {
                return res.status(400).json({
                    message: err.message
                });
            }

            executionSteps = plan.steps;
            executionEdges = plan.edges || [];

        } else {
            // Step-based execution
            if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
                return res.status(400).json({
                    message: 'Workflow has no executable steps'
                });
            }

            executionSteps = workflow.steps.map(step =>
                typeof step.toObject === 'function'
                    ? step.toObject()
                    : step
            );
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
