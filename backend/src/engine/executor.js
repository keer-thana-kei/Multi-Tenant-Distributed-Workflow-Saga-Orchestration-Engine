const Execution = require('../models/Execution')
const { setExecStatus, setStepStatus } = require('./stateMachine')
const { publish } = require('./traceBus')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MAX_OUTPUT_CHARS = 10000

// Save to the database, then tell live viewers
const persist = async (exec) => {
    await exec.save()
    publish(exec)
}

const trimOutput = (output) => {
    try {
        const text = JSON.stringify(output ?? null)
        return text.length > MAX_OUTPUT_CHARS ? { truncated: true } : output ?? null
    } catch {
        return null
    }
}

const callStep = async (url, method) => {
    try {
        const res = await fetch(url, { method, signal: AbortSignal.timeout(5000) })
        let output = null
        try { output = await res.json() } catch { output = null }
        return { ok: res.ok, output }
    } catch {
        return { ok: false, output: null }
    }
}

const runWithRetry = async (url, method, maxRetries = 3, onAttempt) => {
    let attempts = 0
    for (let a = 0; a <= maxRetries; a++) {
        if (a > 0) await sleep(1000 * 2 ** (a - 1))   // 1s, 2s, 4s
        attempts++
        if (onAttempt) await onAttempt(attempts)
        const { ok, output } = await callStep(url, method)
        if (ok) return { ok: true, attempts, output }
    }
    return { ok: false, attempts, output: null }
}

const getPath = (obj, path) =>
    path.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj)

const checkCondition = (cond, output) => {
    if (!cond || !cond.field) return true
    const op = cond.op || 'equals'
    const actual = getPath(output, cond.field)

    if (actual === undefined) return op === 'notEquals'

    switch (op) {
        case 'equals':    return String(actual) === String(cond.value)
        case 'notEquals': return String(actual) !== String(cond.value)
        case 'gt':        return Number(actual) > Number(cond.value)
        case 'lt':        return Number(actual) < Number(cond.value)
        default:          return false
    }
}

const rollback = async (exec, failedIndex) => {
    setExecStatus(exec, 'compensating')
    await persist(exec)

    for (let i = failedIndex - 1; i >= 0; i--) {
        const step = exec.steps[i]
        if (step.status !== 'success') continue

        if (!step.compensateUrl) {
            setStepStatus(step, 'compensation_skipped')
        } else {
            const { ok } = await runWithRetry(
                step.compensateUrl,
                step.compensateMethod || 'POST',
                step.maxRetries
            )
            setStepStatus(step, ok ? 'compensated' : 'compensation_failed')
        }
        await persist(exec)
    }

    const anyFailed = exec.steps.some((s) => s.status === 'compensation_failed')
    setExecStatus(exec, anyFailed ? 'failed' : 'compensated')
    exec.finishedAt = new Date()
    await persist(exec)
}

const executeRun = async (executionId) => {
    const exec = await Execution.findById(executionId)
    if (!exec) return

    setExecStatus(exec, 'running')
    exec.startedAt = new Date()
    await persist(exec)

    const isGraph = exec.steps.some((s) => s.nodeId)
    const byNodeId = new Map(exec.steps.filter((s) => s.nodeId).map((s) => [s.nodeId, s]))

    for (let i = 0; i < exec.steps.length; i++) {
        const step = exec.steps[i]

        if (isGraph) {
            const incoming = exec.edges.filter((e) => e.to === step.nodeId)
            if (incoming.length > 0) {
                const active = incoming.some((e) => {
                    const source = byNodeId.get(e.from)
                    return (
                        source &&
                        source.status === 'success' &&
                        checkCondition(e.condition, source.output)
                    )
                })
                if (!active) {
                    setStepStatus(step, 'skipped')
                    await persist(exec)
                    continue
                }
            }
        }

        setStepStatus(step, 'running')
        step.startedAt = new Date()
        await persist(exec)

        // Live "attempt 2, attempt 3..." updates while retrying
        const { ok, attempts, output } = await runWithRetry(
            step.url,
            step.method,
            step.maxRetries,
            async (n) => {
                step.attempts = n
                if (n > 1) await persist(exec)
            }
        )
        step.attempts = attempts
        step.finishedAt = new Date()

        if (!ok) {
            setStepStatus(step, 'failed')
            for (let j = i + 1; j < exec.steps.length; j++) {
                if (exec.steps[j].status === 'pending') setStepStatus(exec.steps[j], 'skipped')
            }
            await persist(exec)
            return rollback(exec, i)
        }

        step.output = trimOutput(output)
        setStepStatus(step, 'success')
        await persist(exec)
    }

    setExecStatus(exec, 'success')
    exec.finishedAt = new Date()
    await persist(exec)
}

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