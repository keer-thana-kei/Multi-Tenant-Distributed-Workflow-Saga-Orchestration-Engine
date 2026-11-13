const { validateGraph } = require('./graphValidator')

const buildExecutionPlan = (wf) => {
    // Graph workflow
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
                maxRetries: n.maxRetries ?? 3
            }
        })
        return { steps, edges }
    }

    // Straight-line workflow (old behaviour)
    return {
        steps: wf.steps.map((s) => (s.toObject ? s.toObject() : s)),
        edges: []
    }
}

module.exports = { buildExecutionPlan }