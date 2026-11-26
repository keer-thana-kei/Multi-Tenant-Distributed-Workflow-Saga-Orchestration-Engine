const { EventEmitter } = require('events')
const Redis = require('ioredis')

const bus = new EventEmitter()
bus.setMaxListeners(0)

const CHANNEL = 'workflow-trace'
const REDIS_URL = process.env.REDIS_URL
let pub = null

if (REDIS_URL) {
    pub = new Redis(REDIS_URL)
    pub.on('error', (e) => console.error('Redis publisher error:', e.message))
}

const buildMessage = (exec) => ({
    type: 'execution.update',
    companyId: String(exec.companyId),
    executionId: String(exec._id),
    status: exec.status,
    startedAt: exec.startedAt,
    finishedAt: exec.finishedAt,
    steps: exec.steps.map((s) => ({
        nodeId: s.nodeId,
        name: s.name,
        status: s.status,
        attempts: s.attempts,
        output: s.output,
        error: s.error,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt
    }))
})

// Called after every save. With Redis: goes to every API copy. Without: local only.
const publish = (exec) => {
    const msg = buildMessage(exec)
    if (pub) pub.publish(CHANNEL, JSON.stringify(msg)).catch(() => {})
    else bus.emit('trace', msg)
}

// API copies call this once so Redis messages reach the local WebSocket server
const startTraceSubscriber = () => {
    if (!REDIS_URL) return
    const sub = new Redis(REDIS_URL)
    sub.on('error', (e) => console.error('Redis subscriber error:', e.message))
    sub.subscribe(CHANNEL)
    sub.on('message', (_channel, text) => {
        try { bus.emit('trace', JSON.parse(text)) } catch {}
    })
    console.log('Subscribed to live trace channel (Redis)')
}

module.exports = { bus, publish, startTraceSubscriber }