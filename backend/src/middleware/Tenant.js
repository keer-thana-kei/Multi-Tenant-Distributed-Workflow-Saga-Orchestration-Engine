const crypto = require('crypto')
const rateLimit = require('express-rate-limit')
const Tenant = require('../models/Tenant')

const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex')

// Generate a new key (call from a script or admin route; show it ONCE)
const generateApiKey = () => {
    const key = 'wf_' + crypto.randomBytes(24).toString('hex')
    return { key, hash: hashKey(key), prefix: key.slice(0, 7) }
}

// Identify the tenant from the x-api-key header
const tenantAuth = async (req, res, next) => {
    try {
        const key = req.header('x-api-key')
        if (!key) return res.status(401).json({ message: 'Missing API key' })

        const tenant = await Tenant.findOne({ apiKeyHash: hashKey(key), active: true })
        if (!tenant) return res.status(401).json({ message: 'Invalid API key' })

        req.tenantId = tenant._id
        req.tenant = tenant
        next()
    } catch (err) {
        next(err)
    }
}

// Per-tenant rate limit (must come AFTER tenantAuth)
const tenantRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: (req) => req.tenant?.maxRunsPerMinute || 60,
    keyGenerator: (req) => String(req.tenantId),
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Rate limit exceeded' }
})

module.exports = { tenantAuth, tenantRateLimit, generateApiKey }