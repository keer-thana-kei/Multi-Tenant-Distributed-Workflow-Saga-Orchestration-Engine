const mongoose = require('mongoose')

const policyFields = {
    maxRetries: { type: Number, default: 3 },
    backoff: { type: String, enum: ['exponential', 'fixed'], default: 'exponential' },
    baseDelayMs: { type: Number, default: 1000 },
    maxDelayMs: { type: Number, default: 30000 },
    timeoutMs: { type: Number, default: 5000 },
    retryOnStatus: [Number]
}

const stepSchema = new mongoose.Schema({
    name: { type: String, required: true },
    url: { type: String, required: true },
    method: { type: String, default: 'POST' },
    compensateUrl: String,
    compensateMethod: { type: String, default: 'POST' },
    ...policyFields
}, { _id: false })

const nodeSchema = new mongoose.Schema({
    id: { type: String, required: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    method: { type: String, default: 'POST' },
    compensateUrl: String,
    compensateMethod: { type: String, default: 'POST' },
    position: mongoose.Schema.Types.Mixed,
    ...policyFields
}, { _id: false })

const edgeSchema = new mongoose.Schema({
    from: { type: String, required: true },
    to: { type: String, required: true },
    condition: mongoose.Schema.Types.Mixed
}, { _id: false })

const workflowSchema = new mongoose.Schema({
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    workflowName: { type: String, required: true },
    triggerEvent: { type: String, index: true },
    steps: [stepSchema],
    nodes: [nodeSchema],
    edges: [edgeSchema]
}, { timestamps: true })

module.exports = mongoose.model('Workflow', workflowSchema)