const mongoose = require('mongoose')

const eventSchema = new mongoose.Schema({
    companyId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, required: true },
    payload: { type: Object, default: {} }
}, { timestamps: true })

module.exports = mongoose.model('Event', eventSchema)