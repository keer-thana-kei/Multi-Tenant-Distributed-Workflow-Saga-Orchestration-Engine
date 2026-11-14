const mongoose = require('mongoose')

const execStepSchema = new mongoose.Schema({
    nodeId: String,
    name: String,
    url: String,
    method: String,
    compensateUrl: String,
    compensateMethod: String,
    maxRetries: Number,
    backoff: String,
    baseDelayMs: Number,
    maxDelayMs: Number,
    timeoutMs: Number,
    retryOnStatus: [Number],
    status: {
        type: String,
        enum: ['pending', 'running', 'success', 'failed', 'skipped',
               'compensated', 'compensation_failed', 'compensation_skipped'],
        default: 'pending'
    },
    attempts: { type: Number, default: 0 },
    output: mongoose.Schema.Types.Mixed,
    error: String,
    startedAt: Date,
    finishedAt: Date
}, { _id: false })

const executionSchema = new mongoose.Schema({
    companyId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
    status: {
        type: String,
        enum: ['pending', 'running', 'success', 'compensating', 'compensated', 'failed'],
        default: 'pending'
    },
    steps: [execStepSchema],
    edges: [mongoose.Schema.Types.Mixed],
    startedAt: Date,
    finishedAt: Date
}, { timestamps: true })

module.exports = mongoose.model('Execution', executionSchema)