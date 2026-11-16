const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { WebSocketServer } = require('ws')
const Tenant = require('../models/Tenant')
const { bus } = require('./traceBus')

const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex')

// Browsers cannot set headers on a WebSocket, so credentials come in the URL:
//   ws://localhost:5000/ws?token=<jwt>         (preferred)
//   ws://localhost:5000/ws?apiKey=<key>        (testing)
const findTenantId = async (params) => {
    const token = params.get('token')
    const apiKey = params.get('apiKey')

    if (token) {
        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET)
            if (!payload.tenantId) return null
            const t = await Tenant.findOne({ _id: payload.tenantId, active: true })
            return t ? String(t._id) : null
        } catch {
            return null
        }
    }
    if (apiKey) {
        const t = await Tenant.findOne({ apiKeyHash: hashKey(apiKey), active: true })
        return t ? String(t._id) : null
    }
    return null
}

const attachWebSocket = (httpServer) => {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

    wss.on('connection', async (ws, req) => {
        const params = new URL(req.url, 'http://localhost').searchParams

        let tenantId = null
        try {
            tenantId = await findTenantId(params)
        } catch (err) {
            console.error('WS auth error:', err.message)
        }
        if (!tenantId) return ws.close(1008, 'Unauthorized')

        ws.tenantId = tenantId
        ws.executionId = params.get('executionId') || null   // optional filter
        ws.isAlive = true
        ws.on('pong', () => { ws.isAlive = true })
        ws.on('error', () => {})

        ws.send(JSON.stringify({ type: 'connected' }))
    })

    // Forward each trace only to the same company's connections
    bus.on('trace', (msg) => {
        const text = JSON.stringify(msg)
        for (const client of wss.clients) {
            if (client.readyState !== client.OPEN) continue
            if (client.tenantId !== msg.companyId) continue
            if (client.executionId && client.executionId !== msg.executionId) continue
            client.send(text)
        }
    })

    // Drop dead connections every 30s
    const heartbeat = setInterval(() => {
        for (const client of wss.clients) {
            if (client.isAlive === false) { client.terminate(); continue }
            client.isAlive = false
            client.ping()
        }
    }, 30000)
    wss.on('close', () => clearInterval(heartbeat))

    console.log('WebSocket ready at /ws')
}

module.exports = { attachWebSocket }