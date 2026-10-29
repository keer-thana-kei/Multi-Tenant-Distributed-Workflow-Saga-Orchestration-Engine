require('dotenv').config()
const mongoose = require('mongoose')
const Tenant = require('../src/models/Tenant')
const { generateApiKey } = require('../src/middleware/Tenant')

;(async () => {
    await mongoose.connect(process.env.MONGODB_URI)
    const { key, hash, prefix } = generateApiKey()
    const tenant = await Tenant.create({
        name: process.argv[2] || 'Test Co',
        apiKeyHash: hash,
        apiKeyPrefix: prefix
    })
    console.log('Tenant ID:', tenant._id.toString())
    console.log('API KEY (save it, it will not be shown again):', key)
    process.exit(0)
})()
