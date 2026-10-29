const mongoose = require('mongoose')

const stepSchema = new mongoose.Schema({
    name: { type: String, required: true },
    url: { type: String, required: true },
    method: { type: String, default: 'POST' },
    compensateUrl: String,
    compensateMethod: { type: String, default: 'POST' },
    maxRetries: { type: Number, default: 3 }
}, { _id: false })

const workflowSchema = new mongoose.Schema({
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    workflowName: { type: String, required: true },
    steps: [stepSchema]
}, { timestamps: true })

module.exports = mongoose.model('Workflow', workflowSchema)