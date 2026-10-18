const mongoose = require('mongoose')

const StepSchema = new mongoose.Schema({
    name: String,
    url: String,
    method: { type: String, default: 'POST' },
    status: { 
        type: String, 
        default: 'pending'
    }
})

const WorkflowSchema = new mongoose.Schema({
    companyId: String,
    workflowName: String,
    steps: [StepSchema],
    status: { 
        type: String, 
        default: 'pending'
    }
}, { timestamps: true })

module.exports = mongoose.model('Workflow', WorkflowSchema)