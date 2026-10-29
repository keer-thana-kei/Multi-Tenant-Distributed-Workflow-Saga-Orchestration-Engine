const mongoose = require('mongoose')

const execStepSchema = new mongoose.Schema({
    name: String,
    url: String,
    method: String,
    compensateUrl: String,
    compensateMethod: String,
    maxRetries: Number,
    status: {
        type: String,
        enum: ['pending', 'running', 'success', 'failed',
               'compensated', 'compensation_failed', 'compensation_skipped'],
        default: 'pending'
    },
    attempts: { type: Number, default: 0 },
    startedAt: Date,
    finishedAt: Date
}, { _id: false })

const executionSchema = new mongoose.Schema({
    companyId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
    status: {
        type: String,
        enum: ['pending', 'running', 'success', 'compensating', 'compensated', 'failed'],
        default: 'pending'
    },
    steps: [execStepSchema],
    startedAt: Date,
    finishedAt: Date
}, { timestamps: true })

module.exports = mongoose.model('Execution', executionSchema)