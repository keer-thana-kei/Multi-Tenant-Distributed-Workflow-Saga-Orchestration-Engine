
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