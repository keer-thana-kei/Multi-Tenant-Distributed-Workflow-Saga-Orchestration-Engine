const mongoose = require('mongoose')

// Straight-line step (old format)
const stepSchema = new mongoose.Schema({
    name: { type: String, required: true },
    url: { type: String, required: true },
    method: { type: String, default: 'POST' },
    compensateUrl: String,
    compensateMethod: { type: String, default: 'POST' },
    maxRetries: { type: Number, default: 3 }
}, { _id: false })

// Graph node (new format)
const nodeSchema = new mongoose.Schema({
    id: { type: String, required: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    method: { type: String, default: 'POST' },
    compensateUrl: String,
    compensateMethod: { type: String, default: 'POST' },
    maxRetries: { type: Number, default: 3 },
    position: mongoose.Schema.Types.Mixed     // {x, y} so the canvas can redraw it
}, { _id: false })

// Graph arrow. condition = { field, op, value } (optional)
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