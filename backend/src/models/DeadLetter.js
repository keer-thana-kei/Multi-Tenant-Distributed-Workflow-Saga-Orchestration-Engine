const mongoose = require('mongoose')

const deadLetterSchema = new mongoose.Schema({
    companyId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    executionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Execution', required: true },
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow' },
    nodeId: String,
    stepName: String,
    reason: { type: String, enum: ['step_failed', 'compensation_failed'], required: true },
    url: String,
    method: String,
    attempts: Number,
    error: String,
    status: { type: String, enum: ['open', 'replayed', 'discarded'], default: 'open', index: true },
    replayExecutionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Execution' }
}, { timestamps: true })

module.exports = mongoose.model('DeadLetter', deadLetterSchema)