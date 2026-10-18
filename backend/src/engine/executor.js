const Workflow = require('../models/Workflow')

// RETRY LOGIC
const retryStep = async (step, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Retrying ${step.name}... attempt ${i + 1}`)
            const result = await fetch(step.url, { method: step.method })
            if (result.ok) return true
        } catch (err) {
            console.log(`Retry ${i + 1} failed!!`)
        }
    }
    return false
}

// ROLLBACK LOGIC
const rollback = async (workflow, failedIndex) => {
    console.log('ROLLING BACK!!')
    for (let i = failedIndex - 1; i >= 0; i--) {
        const step = workflow.steps[i]
        console.log(`Undoing step: ${step.name}`)
        step.status = 'rolled back'
    }
    workflow.status = 'failed'
    await workflow.save()
}

// MAIN ENGINE
const executeWorkflow = async (workflowId) => {
    // Step 1 - get workflow from database
    const workflow = await Workflow.findById(workflowId)
    workflow.status = 'running'
    await workflow.save()

    // Step 2 - loop through steps
    for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i]

        try {
            console.log(`Running step: ${step.name}`)
            step.status = 'running'
            await workflow.save()

            // Step 3 - call the URL
            const result = await fetch(step.url, { method: step.method })

            if (result.ok) {
                // SUCCESS!!
                step.status = 'success'
                await workflow.save()
                console.log(`Step ${step.name} SUCCESS!!`)
            } else {
                // FAIL - try retry
                console.log(`Step ${step.name} FAILED!! Retrying...`)
                const retried = await retryStep(step)

                if (retried) {
                    step.status = 'success'
                    await workflow.save()
                } else {
                    // STILL FAILED - rollback!!
                    step.status = 'failed'
                    await rollback(workflow, i)
                    return
                }
            }

        } catch (err) {
            step.status = 'failed'
            await rollback(workflow, i)
            return
        }
    }

    // ALL STEPS DONE!!
    workflow.status = 'success'
    await workflow.save()
    console.log('Workflow completed SUCCESSFULLY!!')
}

module.exports = executeWorkflow