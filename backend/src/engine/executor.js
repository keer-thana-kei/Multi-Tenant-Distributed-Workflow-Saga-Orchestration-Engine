const Execution = require('../models/Execution')
const { setExecStatus, setStepStatus } = require('./stateMachine')

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
    setExecStatus(exec, 'compensating')
    await exec.save()

    for (let i = failedIndex - 1; i >= 0; i--) {
        const step = exec.steps[i]
        if (step.status !== 'success') continue

        if (!step.compensateUrl) {
            setStepStatus(step, 'compensation_skipped')
        } else {
            const { ok } = await runWithRetry(step.compensateUrl, step.compensateMethod || 'POST', step.maxRetries)
            setStepStatus(step, ok ? 'compensated' : 'compensation_failed')
        }
        await exec.save()
    }

    const anyFailed = exec.steps.some((s) => s.status === 'compensation_failed')
    setExecStatus(exec, anyFailed ? 'failed' : 'compensated')
    exec.finishedAt = new Date()
    await exec.save()
}

const executeRun = async (executionId) => {
    const exec = await Execution.findById(executionId)
    setExecStatus(exec, 'running')
    exec.startedAt = new Date()
    await exec.save()

    for (let i = 0; i < exec.steps.length; i++) {
        const step = exec.steps[i]
        setStepStatus(step, 'running')
        step.startedAt = new Date()
        await exec.save()

        const { ok, attempts } = await runWithRetry(step.url, step.method, step.maxRetries)
        step.attempts = attempts
        step.finishedAt = new Date()

        if (!ok) {
            setStepStatus(step, 'failed')
            await exec.save()
            return rollback(exec, i)
        }

        setStepStatus(step, 'success')
        await exec.save()
    }

    setExecStatus(exec, 'success')
    exec.finishedAt = new Date()
    await exec.save()
}

// Runs interrupted by a crash would stay "running" forever.
// Mark them failed so a human can review (auto-resume could double-charge).
const recoverStuckRuns = async () => {
    const stuck = await Execution.find({ status: { $in: ['running', 'compensating'] } })
    for (const exec of stuck) {
        for (const step of exec.steps) {
            if (step.status === 'running') step.status = 'failed'
        }
        exec.status = 'failed'
        exec.finishedAt = new Date()
        await exec.save()
        console.log(`Recovered stuck execution ${exec._id} -> failed`)
    }
}

module.exports = executeRun
module.exports.recoverStuckRuns = recoverStuckRuns