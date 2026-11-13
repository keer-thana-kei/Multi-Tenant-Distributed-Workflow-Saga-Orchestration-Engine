const Event = require('../models/Event')
const Workflow = require('../models/Workflow')
const Execution = require('../models/Execution')
const executeRun = require('./executor')
const { buildExecutionPlan } = require('./buildPlan')

const startEventWatcher = () => {
    const stream = Event.watch([{ $match: { operationType: 'insert' } }], {
        fullDocument: 'updateLookup'
    })

    stream.on('change', async (change) => {
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
            console.error('Event handling error:', err)
        }
    })

    stream.on('error', (err) => console.error('Change stream error:', err))
    console.log('Watching for events...')
}

module.exports = { startEventWatcher }