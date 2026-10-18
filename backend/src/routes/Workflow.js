const router = require('express').Router()
const Workflow = require('../models/Workflow')
const executeWorkflow = require('../engine/executor')

// CREATE workflow
router.post('/', async (req, res) => {
    const { companyId, workflowName, steps } = req.body
    const workflow = await Workflow.create({ 
        companyId, 
        workflowName, 
        steps 
    })
    res.json(workflow)
})

// GET all workflows
router.get('/', async (req, res) => {
    const workflows = await Workflow.find()
    res.json(workflows)
})

// GET one workflow
router.get('/:id', async (req, res) => {
    const workflow = await Workflow.findById(req.params.id)
    res.json(workflow)
})

// DELETE workflow
router.delete('/:id', async (req, res) => {
    await Workflow.findByIdAndDelete(req.params.id)
    res.json({ message: 'Deleted!!' })
})

// RUN workflow ← THE ENGINE!!
router.post('/:id/run', async (req, res) => {
    const workflow = await Workflow.findById(req.params.id)
    if (!workflow) return res.json({ message: 'Workflow not found!!' })
    
    // start engine!!
    executeWorkflow(req.params.id)
    
    res.json({ message: 'Workflow started!!' })
})

module.exports = router