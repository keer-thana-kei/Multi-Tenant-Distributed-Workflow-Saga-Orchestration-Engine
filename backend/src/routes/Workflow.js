
const router = require('express').Router();

const mongoose = require('mongoose');
const Workflow = require('../models/Workflow');
const Execution = require('../models/Execution');
const executeRun = require('../engine/executor');

const {
    tenantAuth,
    tenantRateLimit
} = require('../middleware/tenant');

// Apply tenant authentication and rate limiting
// to every route in this file.
router.use(tenantAuth, tenantRateLimit);

// CREATE WORKFLOW
router.post('/', async (req, res, next) => {
    try {
        const { workflowName, steps, triggerEvent } = req.body;

        if (!workflowName || !Array.isArray(steps)) {
            return res.status(400).json({
                message: 'workflowName and steps are required'
            });
        }

        const workflow = await Workflow.create({
            companyId: req.tenantId,
            workflowName,
            steps,
            triggerEvent
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

        const execution = await Execution.create({
            companyId: req.tenantId,
            workflowId: workflow._id,
            steps: workflow.steps.map(step => step.toObject())
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
