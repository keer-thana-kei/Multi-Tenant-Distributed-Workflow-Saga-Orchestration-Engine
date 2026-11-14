const Execution = require('../models/Execution')
const DeadLetter = require('../models/DeadLetter')
const { setExecStatus, setStepStatus } = require('../engine/statemachine')
const { publish } = require('./traceBus')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MAX_OUTPUT_CHARS = 10000

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

// ---------- retry policy ----------
const clamp = (v, min, max, fallback) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
}

// Safe limits so a tenant cannot ask for 1,000,000 retries
const policyOf = (step) => ({
    maxRetries: clamp(step.maxRetries, 0, 10, 3),
    backoff: step.backoff === 'fixed' ? 'fixed' : 'exponential',
    baseDelayMs: clamp(step.baseDelayMs, 100, 60000, 1000),
    maxDelayMs: clamp(step.maxDelayMs, 100, 300000, 30000),
    timeoutMs: clamp(step.timeoutMs, 500, 30000, 5000),
    retryOnStatus:
        Array.isArray(step.retryOnStatus) && step.retryOnStatus.length
            ? step.retryOnStatus.map(Number)
            : null
})

const delayFor = (retryNumber, p) => {
    const raw = p.backoff === 'fixed' ? p.baseDelayMs : p.baseDelayMs * 2 ** (retryNumber - 1)
    return Math.min(raw, p.maxDelayMs)
}

// Transient = worth trying again. 4xx (except 408/425/429) is permanent.
const shouldRetry = (status, p) => {
    if (status === null) return true                       // network error / timeout
    if (p.retryOnStatus) return p.retryOnStatus.includes(status)
    return status === 408 || status === 425 || status === 429 || status >= 500
}

const callStep = async (url, method, timeoutMs) => {
    try {
        const res = await fetch(url, { method, signal: AbortSignal.timeout(timeoutMs) })
        let output = null
        try { output = await res.json() } catch { output = null }
        return { ok: res.ok, status: res.status, output, error: res.ok ? null : `HTTP ${res.status}` }
    } catch (err) {
        return {
            ok: false,
            status: null,
            output: null,
            error: err.name === 'TimeoutError' ? 'Timeout' : err.message
        }
    }
}

const runWithRetry = async (url, method, policy, onAttempt) => {
    let attempts = 0
    let last = { error: null }
    for (let a = 0; a <= policy.maxRetries; a++) {
        if (a > 0) await sleep(delayFor(a, policy))
        attempts++
        if (onAttempt) await onAttempt(attempts)

        last = await callStep(url, method, policy.timeoutMs)
        if (last.ok) return { ok: true, attempts, output: last.output, error: null }
        if (!shouldRetry(last.status, policy)) break       // permanent error, stop early
    }
    return { ok: false, attempts, output: null, error: last.error }
}

// ---------- dead-letter queue ----------
const sendToDLQ = async (exec, step, reason, error) => {
    try {
        const isComp = reason === 'compensation_failed'
        await DeadLetter.create({
            companyId: exec.companyId,
            executionId: exec._id,
            workflowId: exec.workflowId,
            nodeId: step.nodeId,
            stepName: step.name,
            reason,
            url: isComp ? step.compensateUrl : step.url,
            method: isComp ? step.compensateMethod || 'POST' : step.method,
            attempts: step.attempts,
            error
        })
        console.log(`DLQ: "${step.name}" (${reason})`)
    } catch (err) {
        console.error('Could not write to DLQ:', err.message)
    }
}

// ---------- conditions ----------
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

// ---------- saga rollback ----------
const rollback = async (exec, failedIndex) => {
    setExecStatus(exec, 'compensating')
    await persist(exec)

    for (let i = failedIndex - 1; i >= 0; i--) {
        const step = exec.steps[i]
        if (step.status !== 'success') continue

        if (!step.compensateUrl) {
            setStepStatus(step, 'compensation_skipped')
        } else {
            const { ok, error } = await runWithRetry(
                step.compensateUrl,
                step.compensateMethod || 'POST',
                policyOf(step)
            )
            setStepStatus(step, ok ? 'compensated' : 'compensation_failed')
            if (!ok) {
                step.error = `Undo failed: ${error}`
                await sendToDLQ(exec, step, 'compensation_failed', error)
            }
        }
        await persist(exec)
    }

    const anyFailed = exec.steps.some((s) => s.status === 'compensation_failed')
    setExecStatus(exec, anyFailed ? 'failed' : 'compensated')
    exec.finishedAt = new Date()
    await persist(exec)
}

// ---------- main run ----------
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

        const { ok, attempts, output, error } = await runWithRetry(
            step.url,
            step.method,
            policyOf(step),
            async (n) => {
                step.attempts = n
                if (n > 1) await persist(exec)
            }
        )
        step.attempts = attempts
        step.finishedAt = new Date()

        if (!ok) {
            setStepStatus(step, 'failed')
            step.error = error
            for (let j = i + 1; j < exec.steps.length; j++) {
                if (exec.steps[j].status === 'pending') setStepStatus(exec.steps[j], 'skipped')
            }
            await persist(exec)
            await sendToDLQ(exec, step, 'step_failed', error)
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
module.exports.runWithRetry = runWithRetry
module.exports.policyOf = policyOf