const Execution = require('../models/Execution')
const executeRun = require('./executor')
const { runsWorker, WORKER_ID } = require('./role')

const MAX_CONCURRENT = Number(process.env.WORKER_CONCURRENCY) || 50
const POLL_MS = Number(process.env.POLL_INTERVAL_MS) || 1000
const STALE_MS = Number(process.env.STALE_RUN_MS) || 10 * 60 * 1000

let running = 0

const runOne = async (id) => {
    running++
    try {
        await executeRun(id)
    } catch (err) {
        console.error('Engine crashed:', err)
    } finally {
        running--
    }
}

// Atomically take ownership of one specific pending run
const claim = (id) =>
    Execution.findOneAndUpdate(
        { _id: id, status: 'pending', claimedBy: null },
        { $set: { claimedBy: WORKER_ID } },
        { returnDocument: 'after', projection: { _id: 1 } }
    )

// Called by routes and the event watcher right after creating an execution.
// API-only copies do nothing: a worker will pick the run up.
const dispatch = async (id) => {
    if (!runsWorker) return
    try {
        if (await claim(id)) runOne(id)
    } catch (err) {
        console.error('Dispatch error:', err.message)
    }
}

// Workers also poll for pending runs (created by API copies)
let ticking = false
const tick = async () => {
    if (ticking) return
    ticking = true
    try {
        while (running < MAX_CONCURRENT) {
            const next = await Execution.findOneAndUpdate(
                { status: 'pending', claimedBy: null },
                { $set: { claimedBy: WORKER_ID } },
                { sort: { createdAt: 1 }, returnDocument: 'after', projection: { _id: 1 } }
            )
            if (!next) break
            runOne(next._id)
        }
    } catch (err) {
        console.error('Poller error:', err.message)
    } finally {
        ticking = false
    }
}

const startPoller = () => {
    setInterval(tick, POLL_MS)
    console.log(`Worker ${WORKER_ID} polling for runs (max ${MAX_CONCURRENT} at once)`)
}

// Safe for many workers: only touches runs nobody has updated for STALE_MS
const sweepStale = async () => {
    try {
        const cutoff = new Date(Date.now() - STALE_MS)

        const dead = await Execution.find({
            status: { $in: ['running', 'compensating'] },
            updatedAt: { $lt: cutoff }
        })
        for (const exec of dead) {
            for (const step of exec.steps) {
                if (step.status === 'running') step.status = 'failed'
            }
            exec.status = 'failed'
            exec.finishedAt = new Date()
            await exec.save()
            console.log(`Recovered stale execution ${exec._id} -> failed`)
        }

        // Claimed by a worker that died before starting it: release it
        await Execution.updateMany(
            { status: 'pending', claimedBy: { $ne: null }, updatedAt: { $lt: cutoff } },
            { $set: { claimedBy: null } }
        )
    } catch (err) {
        console.error('Stale sweep error:', err.message)
    }
}

const startStaleSweeper = () => setInterval(sweepStale, 60 * 1000)

module.exports = { dispatch, startPoller, startStaleSweeper }