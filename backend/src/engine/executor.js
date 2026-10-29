// const Workflow = require('../models/Workflow')

// // RETRY LOGIC
// const retryStep = async (step, retries = 3) => {
//     for (let i = 0; i < retries; i++) {
//         try {
//             console.log(`Retrying ${step.name}... attempt ${i + 1}`)
//             const result = await fetch(step.url, { method: step.method })
//             if (result.ok) return true
//         } catch (err) {
//             console.log(`Retry ${i + 1} failed!!`)
//         } 
//     }
//     return false
// }

// // ROLLBACK LOGIC
// const rollback = async (workflow, failedIndex) => {
//     console.log('ROLLING BACK!!')
//     for (let i = failedIndex - 1; i >= 0; i--) {
//         const step = workflow.steps[i]
//         console.log(`Undoing step: ${step.name}`)
//         step.status = 'rolled back'
//     }
//     workflow.status = 'failed'
//     await workflow.save()
// }

// // MAIN ENGINE
// const executeWorkflow = async (workflowId) => {
//     // Step 1 - get workflow from database
//     const workflow = await Workflow.findById(workflowId)
//     workflow.status = 'running'
//     await workflow.save()

//     // Step 2 - loop through steps
//     for (let i = 0; i < workflow.steps.length; i++) {
//         const step = workflow.steps[i]

//         try {
//             console.log(`Running step: ${step.name}`)
//             step.status = 'running'
//             await workflow.save()

//             // Step 3 - call the URL
//             const result = await fetch(step.url, { method: step.method })

//             if (result.ok) {
//                 // SUCCESS!!
//                 step.status = 'success'
//                 await workflow.save()
//                 console.log(`Step ${step.name} SUCCESS!!`)
//             } else {
//                 // FAIL - try retry
//                 console.log(`Step ${step.name} FAILED!! Retrying...`)
//                 const retried = await retryStep(step)

//                 if (retried) {
//                     step.status = 'success'
//                     await workflow.save()
//                 } else {
//                     // STILL FAILED - rollback!!
//                     step.status = 'failed'
//                     await rollback(workflow, i)
//                     return
//                 }
//             }

//         } catch (err) {
//             step.status = 'failed'
//             await rollback(workflow, i)
//             return
//         }
//     }

//     // ALL STEPS DONE!!
//     workflow.status = 'success'
//     await workflow.save()
//     console.log('Workflow completed SUCCESSFULLY!!')
// }

// module.exports = executeWorkflow





const Execution = require('../models/Execution')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const callStep = async (url, method) => {
    try {
        const res = await fetch(url, { method, signal: AbortSignal.timeout(5000) })
        return res.ok
    } catch {
        return false
    }
}

const runWithRetry = async (url, method, maxRetries = 3) => {
    let attempts = 0
    for (let a = 0; a <= maxRetries; a++) {
        if (a > 0) await sleep(1000 * 2 ** (a - 1))
        attempts++
        if (await callStep(url, method)) return { ok: true, attempts }
    }
    return { ok: false, attempts }
}

const rollback = async (exec, failedIndex) => {
    exec.status = 'compensating'
    await exec.save()

    for (let i = failedIndex - 1; i >= 0; i--) {
        const step = exec.steps[i]
        if (step.status !== 'success') continue

        if (!step.compensateUrl) {
            step.status = 'compensation_skipped'
        } else {
            const { ok } = await runWithRetry(step.compensateUrl, step.compensateMethod || 'POST', step.maxRetries)
            step.status = ok ? 'compensated' : 'compensation_failed'
        }
        await exec.save()
    }

    const anyFailed = exec.steps.some((s) => s.status === 'compensation_failed')
    exec.status = anyFailed ? 'failed' : 'compensated'
    exec.finishedAt = new Date()
    await exec.save()
}

const executeRun = async (executionId) => {
    const exec = await Execution.findById(executionId)
    exec.status = 'running'
    exec.startedAt = new Date()
    await exec.save()

    for (let i = 0; i < exec.steps.length; i++) {
        const step = exec.steps[i]
        step.status = 'running'
        step.startedAt = new Date()
        await exec.save()

        const { ok, attempts } = await runWithRetry(step.url, step.method, step.maxRetries)
        step.attempts = attempts
        step.finishedAt = new Date()

        if (!ok) {
            step.status = 'failed'
            await exec.save()
            return rollback(exec, i)
        }

        step.status = 'success'
        await exec.save()
    }

    exec.status = 'success'
    exec.finishedAt = new Date()
    await exec.save()
}

module.exports = executeRun