const router = require('express').Router()
const Event = require('../models/Event')
const { tenantAuth, tenantRateLimit } = require('../middleware/tenant')

router.use(tenantAuth, tenantRateLimit)

router.post('/', async (req, res, next) => {
    try {
        const { type, payload } = req.body
        if (!type) return res.status(400).json({ message: 'type is required' })
        const event = await Event.create({ companyId: req.tenantId, type, payload })
        res.status(201).json({ eventId: event._id })
    } catch (err) { next(err) }
})

module.exports = router