const path = require('path')
const { Worker } = require('worker_threads')

const MAX_CODE_CHARS = 5000
const MAX_INPUT_CHARS = 200000
const MAX_TIMEOUT_MS = 3000
const MAX_CONCURRENT = Number(process.env.SANDBOX_MAX_CONCURRENT) || 4

// ---- simple concurrency limiter
let active = 0
const waiting = []

const acquire = () =>
    new Promise((resolve) => {
        if (active < MAX_CONCURRENT) {
            active++
            resolve()
        } else {
            waiting.push(resolve)
        }
    })

const release = () => {
    const next = waiting.shift()
    if (next) next()          // hand the slot to the next waiting script
    else active--
}

// ---- one script in one worker thread
const runInWorker = (code, inputJson, eventJson, timeoutMs) =>
    new Promise((resolve) => {
        let settled = false

        const worker = new Worker(path.join(__dirname, 'sandboxWorker.js'), {
            workerData: { code, inputJson, eventJson, timeoutMs },
            env: {},                                  // no secrets inside the sandbox
            resourceLimits: {
                maxOldGenerationSizeMb: 64,
                maxYoungGenerationSizeMb: 16,
                stackSizeMb: 2
            }
        })

        const finish = (result) => {
            if (settled) return
            settled = true
            clearTimeout(killTimer)
            worker.terminate()
            resolve(result)
        }

        // Backup kill switch, in case the script blocks in a way vm's timeout misses
        const killTimer = setTimeout(
            () => finish({ ok: false, error: 'Script timed out' }),
            timeoutMs + 1000
        )

        worker.once('message', finish)
        worker.once('error', (err) =>
            finish({
                ok: false,
                error: err.code === 'ERR_WORKER_OUT_OF_MEMORY'
                    ? 'Script ran out of memory'
                    : String(err.message).slice(0, 500)
            })
        )
        worker.once('exit', (exitCode) =>
            finish({ ok: false, error: `Script stopped unexpectedly (exit ${exitCode})` })
        )
    })

// Public: returns { ok, output, error }
const runScript = async (code, input, event, requestedTimeoutMs) => {
    if (typeof code !== 'string' || !code.trim()) {
        return { ok: false, output: null, error: 'Script is empty' }
    }
    if (code.length > MAX_CODE_CHARS) {
        return { ok: false, output: null, error: 'Script is too long' }
    }

    let inputJson, eventJson
    try {
        inputJson = JSON.stringify(input ?? null)
        eventJson = JSON.stringify(event ?? {})
    } catch {
        return { ok: false, output: null, error: 'Could not prepare script input' }
    }
    if (inputJson.length > MAX_INPUT_CHARS || eventJson.length > MAX_INPUT_CHARS) {
        return { ok: false, output: null, error: 'Script input is too large' }
    }

    const timeoutMs = Math.min(Math.max(Number(requestedTimeoutMs) || 1000, 100), MAX_TIMEOUT_MS)

    await acquire()
    try {
        const result = await runInWorker(code, inputJson, eventJson, timeoutMs)
        return result.ok
            ? { ok: true, output: result.output, error: null }
            : { ok: false, output: null, error: result.error }
    } finally {
        release()
    }
}

module.exports = { runScript, MAX_CODE_CHARS }