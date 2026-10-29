const mongoose = require('mongoose')

const tenantSchema = new mongoose.Schema({
    name: { type: String, required: true },
    apiKeyHash: { type: String, required: true, unique: true },
    apiKeyPrefix: String,              // first few chars, to help users identify a key
    active: { type: Boolean, default: true },
    maxRunsPerMinute: { type: Number, default: 60 }
}, { timestamps: true })

module.exports = mongoose.model('Tenant', tenantSchema)