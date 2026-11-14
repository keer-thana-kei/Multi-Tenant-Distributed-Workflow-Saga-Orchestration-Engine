const { validateGraph } = require('./graphValidator')

const POLICY_KEYS = ['maxRetries', 'backoff', 'baseDelayMs', 'maxDelayMs', 'timeoutMs', 'retryOnStatus']

const pickPolicy = (n) => {
    const out = {}
    for (const k of POLICY_KEYS) if (n[k] !== undefined) out[k] = n[k]
    return out
}

const buildExecutionPlan = (wf) => {
    if (wf.nodes && wf.nodes.length) {
        const nodes = wf.nodes.map((n) => (n.toObject ? n.toObject() : n))
        const edges = (wf.edges || []).map((e) => (e.toObject ? e.toObject() : e))

        const result = validateGraph(nodes, edges)
        if (!result.valid) {
            throw new Error(`Invalid graph: ${result.errors.join('; ')}`)
        }

        const byId = new Map(nodes.map((n) => [n.id, n]))
        const steps = result.order.map((id) => {
            const n = byId.get(id)
            return {
                nodeId: n.id,
                name: n.name,
                url: n.url,
                method: n.method || 'POST',
                compensateUrl: n.compensateUrl,
                compensateMethod: n.compensateMethod || 'POST',
                ...pickPolicy(n)
            }
        })
        return { steps, edges }
    }

    return {
        steps: wf.steps.map((s) => (s.toObject ? s.toObject() : s)),
        edges: []
    }
}

module.exports = { buildExecutionPlan }