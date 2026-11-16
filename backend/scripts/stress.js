require('dotenv').config()
const mongoose = require('mongoose')

const Tenant = require('../src/models/Tenant')
const Workflow = require('../src/models/Workflow')
const Execution = require('../src/models/Execution')
const DeadLetter = require('../src/models/DeadLetter')
const Event = require('../src/models/Event')
const { generateApiKey } = require('../src/middleware/tenant')

const BASE = process.env.STRESS_BASE_URL || 'http://localhost:5000'
const TOTAL = Number(process.argv[2]) || 100          // how many runs
const INFLIGHT = Number(process.argv[3]) || 50        // simultaneous POST requests
const KEEP = process.argv.includes('--keep')
const TIMEOUT_MS = 10 * 60 * 1000

const TERMINAL = ['success', 'compensated', 'failed']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (sorted, p) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0
const fmt = (ms) => `${Math.round(ms)} ms`

const workflows = {
    // 60%: two fast HTTP steps
    happy: {
        workflowName: 'stress-happy',
        nodes: [
            { id: 'n1', name: 'Payment', url: `${BASE}/mock/payment` },
            { id: 'n2', name: 'Ship', url: `${BASE}/mock/ship` }
        ],
        edges: [{ from: 'n1', to: 'n2' }]
    },
    // 20%: second step fails with a 400 (no retries), payment is refunded
    rollback: {
        workflowName: 'stress-rollback',
        nodes: [
            { id: 'n1', name: 'Payment', url: `${BASE}/mock/payment`, compensateUrl: `${BASE}/mock/refund` },
            { id: 'n2', name: 'Bad', url: `${BASE}/mock/bad-request` }
        ],
        edges: [{ from: 'n1', to: 'n2' }]
    },
    // 20%: HTTP step then a sandboxed script
    script: {
        workflowName: 'stress-script',
        nodes: [
            { id: 'n1', name: 'Stock', url: `${BASE}/mock/inventory-yes` },
            { id: 'n2', name: 'Calc', type: 'script', code: 'return { total: input.last.inStock ? 100 : 0 };' }
        ],
        edges: [{ from: 'n1', to: 'n2' }]
    }
}
const expected = { happy: 'success', rollback: 'compensated', script: 'success' }
const kindFor = (i) => (i % 10 < 6 ? 'happy' : i % 10 < 8 ? 'rollback' : 'script')

const main = async () => {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log(`DB: ${mongoose.connection.name} | server: ${BASE}`)
    console.log(`Runs: ${TOTAL} | simultaneous requests: ${INFLIGHT}\n`)

    // ---- temporary tenant with a huge rate limit
    const { key, hash, prefix } = generateApiKey()
    const tenant = await Tenant.create({
        name: 'stress-test',
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        maxRunsPerMinute: 10000000
    })
    const companyId = tenant._id
    const headers = { 'x-api-key': key, 'Content-Type': 'application/json' }

    let started = false
    try {
        // ---- create the three workflows through the real API
        const wfIds = {}
        const expectedByWf = {}
        for (const [kind, body] of Object.entries(workflows)) {
            const res = await fetch(`${BASE}/api/workflows`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            })
            if (res.status !== 201) {
                throw new Error(`Could not create ${kind} workflow: ${res.status} ${await res.text()}`)
            }
            const wf = await res.json()
            wfIds[kind] = wf._id
            expectedByWf[wf._id] = expected[kind]
        }

        // ---- fire the runs
        console.log('Submitting runs...')
        const t0 = Date.now()
        started = true
        let next = 0
        let accepted = 0
        const submitErrors = {}

        const worker = async () => {
            while (true) {
                const i = next++
                if (i >= TOTAL) return
                try {
                    const res = await fetch(`${BASE}/api/workflows/${wfIds[kindFor(i)]}/run`, {
                        method: 'POST',
                        headers: { 'x-api-key': key }
                    })
                    if (res.status === 202) accepted++
                    else submitErrors[res.status] = (submitErrors[res.status] || 0) + 1
                } catch (err) {
                    const k = err.cause?.code || err.message
                    submitErrors[k] = (submitErrors[k] || 0) + 1
                }
            }
        }
        await Promise.all(Array.from({ length: Math.min(INFLIGHT, TOTAL) }, worker))
        const submitMs = Date.now() - t0
        console.log(`Accepted ${accepted}/${TOTAL} in ${(submitMs / 1000).toFixed(1)}s`)
        if (Object.keys(submitErrors).length) console.log('Submit errors:', submitErrors)

        // ---- wait until every accepted run is finished
        let lastPrint = 0
        while (true) {
            const done = await Execution.countDocuments({ companyId, status: { $in: TERMINAL } })
            if (Date.now() - lastPrint > 5000) {
                console.log(`  finished ${done}/${accepted}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
                lastPrint = Date.now()
            }
            if (done >= accepted) break
            if (Date.now() - t0 > TIMEOUT_MS) {
                console.log('Timed out waiting for runs to finish')
                break
            }
            await sleep(1000)
        }
        const totalMs = Date.now() - t0

        // ---- results
        const execs = await Execution.find({ companyId })
            .select('workflowId status createdAt startedAt finishedAt')
            .lean()

        const byStatus = {}
        let unexpected = 0
        const runTimes = []     // startedAt -> finishedAt (engine work)
        const totalTimes = []   // createdAt -> finishedAt (includes waiting in line)
        for (const e of execs) {
            byStatus[e.status] = (byStatus[e.status] || 0) + 1
            if (expectedByWf[String(e.workflowId)] !== e.status) unexpected++
            if (e.startedAt && e.finishedAt) {
                runTimes.push(e.finishedAt - e.startedAt)
                totalTimes.push(e.finishedAt - e.createdAt)
            }
        }
        runTimes.sort((a, b) => a - b)
        totalTimes.sort((a, b) => a - b)
        const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
        const dlq = await DeadLetter.countDocuments({ companyId })

        console.log('\n========== RESULTS ==========')
        console.log(`Runs submitted      : ${TOTAL}`)
        console.log(`Runs accepted (202) : ${accepted}`)
        console.log(`Runs finished       : ${execs.filter((e) => TERMINAL.includes(e.status)).length}`)
        console.log('By status          :', byStatus)
        console.log(`Wrong outcome       : ${unexpected} (expected: happy/script = success, rollback = compensated)`)
        console.log(`Dead letters        : ${dlq} (expected about ${Math.round(TOTAL * 0.2)})`)
        console.log(`Total time          : ${(totalMs / 1000).toFixed(1)} s`)
        console.log(`Throughput          : ${(accepted / (totalMs / 1000)).toFixed(1)} runs/second`)
        console.log(`Run time (engine)   : avg ${fmt(avg(runTimes))} | p50 ${fmt(pct(runTimes, 50))} | p95 ${fmt(pct(runTimes, 95))} | p99 ${fmt(pct(runTimes, 99))}`)
        console.log(`Created -> finished : avg ${fmt(avg(totalTimes))} | p50 ${fmt(pct(totalTimes, 50))} | p95 ${fmt(pct(totalTimes, 95))} | p99 ${fmt(pct(totalTimes, 99))}`)
        console.log('=============================\n')
    } finally {
        if (KEEP) {
            console.log(`Kept test data. Tenant id: ${companyId}`)
        } else {
            console.log('Cleaning up test data...')
            await Promise.all([
                Execution.deleteMany({ companyId }),
                DeadLetter.deleteMany({ companyId }),
                Workflow.deleteMany({ companyId }),
                Event.deleteMany({ companyId }),
                Tenant.deleteOne({ _id: companyId })
            ])
        }
        await mongoose.disconnect()
    }
}

main().catch((err) => {
    console.error('Stress test failed:', err)
    process.exit(1)
})