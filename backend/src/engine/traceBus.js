const { EventEmitter } = require('events')

const bus = new EventEmitter()
bus.setMaxListeners(0)

// Called after every save of an execution
const publish = (exec) => {
    bus.emit('trace', {
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
            startedAt: s.startedAt,
            finishedAt: s.finishedAt
        }))
    })
}

module.exports = { bus, publish }