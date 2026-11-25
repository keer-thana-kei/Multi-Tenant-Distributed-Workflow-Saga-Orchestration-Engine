const Event = require('../models/Event')
const Workflow = require('../models/Workflow')
const Execution = require('../models/Execution')
const executeRun = require('./executor')
const { buildExecutionPlan } = require('./buildPlan')

let stream = null
let restartTimer = null
let retryDelay = 1000
let stopped = false

const handleChange = async (change) => {
    try {
        const event = change.fullDocument
        if (!event) return

        const workflows = await Workflow.find({
            companyId: event.companyId,
            triggerEvent: event.type
        })

        for (const wf of workflows) {
            try {
                const plan = buildExecutionPlan(wf)
                const execution = await Execution.create({
                    companyId: wf.companyId,
                    workflowId: wf._id,
                    eventId: event._id,
                    steps: plan.steps,
                    edges: plan.edges
                })

                console.log(`Event "${event.type}" triggered workflow "${wf.workflowName}"`)
                executeRun(execution._id).catch((err) =>
                    console.error('Engine crashed:', err)
                )
            } catch (err) {
                console.error(`Could not start "${wf.workflowName}":`, err.message)
            }
        }
    } catch (err) {
        console.error('Event handling error:', err.message)
    }
}

const scheduleRestart = () => {
    if (stopped || restartTimer) return
    console.log(`Change stream will restart in ${retryDelay / 1000}s...`)
    restartTimer = setTimeout(() => {
        restartTimer = null
        open()
    }, retryDelay)
    retryDelay = Math.min(retryDelay * 2, 30000)   // 1s, 2s, 4s ... max 30s
}

const open = () => {
    try {
        stream = Event.watch([{ $match: { operationType: 'insert' } }], {
            fullDocument: 'updateLookup'
        })
    } catch (err) {
        console.error('Could not open change stream:', err.message)
        return scheduleRestart()
    }

    let alive = true
    const fail = (err) => {
        if (!alive) return
        alive = false
        console.error('Change stream error:', err && err.message ? err.message : err)
        try { stream.close() } catch {}
        scheduleRestart()
    }
    

    stream.on('change', (change) => {
        retryDelay = 1000          // healthy again, reset the backoff
        handleChange(change)
    })
    stream.on('error', fail)
    stream.on('close', () => fail(new Error('stream closed')))

    console.log('Watching for events...')
}

const startEventWatcher = () => {
    stopped = false
    open()
}

const stopEventWatcher = () => {
    stopped = true
    clearTimeout(restartTimer)
    try { stream && stream.close() } catch {}
}

module.exports = { startEventWatcher, stopEventWatcher }