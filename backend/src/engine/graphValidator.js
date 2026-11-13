const VALID_OPS = ['equals', 'notEquals', 'gt', 'lt']

const isHttpUrl = (value) => {
    try {
        const u = new URL(value)
        return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
        return false
    }
}

// Returns { valid, errors, order }  (order = node ids in safe run order)
const validateGraph = (nodes, edges = []) => {
    const errors = []

    if (!Array.isArray(nodes) || nodes.length === 0) {
        return { valid: false, errors: ['Graph needs at least one node'], order: [] }
    }
    if (nodes.length > 100) {
        return { valid: false, errors: ['Graph is limited to 100 nodes'], order: [] }
    }
    if (!Array.isArray(edges)) edges = []

    // ---- nodes
    const ids = new Set()
    for (const n of nodes) {
        if (!n || typeof n.id !== 'string' || !n.id) {
            errors.push('Every node needs a string id')
            continue
        }
        if (ids.has(n.id)) errors.push(`Duplicate node id: ${n.id}`)
        ids.add(n.id)

        if (!n.name) errors.push(`Node ${n.id}: name is required`)
        if (!isHttpUrl(n.url)) errors.push(`Node ${n.id}: url must be a valid http/https URL`)
        if (n.compensateUrl && !isHttpUrl(n.compensateUrl)) {
            errors.push(`Node ${n.id}: compensateUrl must be a valid http/https URL`)
        }
    }

    // ---- edges
    const seen = new Set()
    const goodEdges = []
    for (const e of edges) {
        if (!e || !ids.has(e.from) || !ids.has(e.to)) {
            errors.push(`Edge ${e && e.from} -> ${e && e.to} points to a node that does not exist`)
            continue
        }
        if (e.from === e.to) {
            errors.push(`Node ${e.from} cannot connect to itself`)
            continue
        }
        const key = `${e.from}->${e.to}`
        if (seen.has(key)) {
            errors.push(`Duplicate edge ${key}`)
            continue
        }
        seen.add(key)

        if (e.condition) {
            const c = e.condition
            if (!c.field || typeof c.field !== 'string') {
                errors.push(`Edge ${key}: condition needs a "field"`)
            }
            if (c.op && !VALID_OPS.includes(c.op)) {
                errors.push(`Edge ${key}: condition op must be one of ${VALID_OPS.join(', ')}`)
            }
            if (c.value === undefined) {
                errors.push(`Edge ${key}: condition needs a "value"`)
            }
        }
        goodEdges.push(e)
    }

    // ---- loop detection + run order (Kahn's algorithm)
    const indegree = new Map(nodes.map((n) => [n.id, 0]))
    const next = new Map(nodes.map((n) => [n.id, []]))
    for (const e of goodEdges) {
        indegree.set(e.to, indegree.get(e.to) + 1)
        next.get(e.from).push(e.to)
    }

    const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id)
    const order = []
    while (queue.length) {
        const id = queue.shift()
        order.push(id)
        for (const to of next.get(id)) {
            indegree.set(to, indegree.get(to) - 1)
            if (indegree.get(to) === 0) queue.push(to)
        }
    }
    if (order.length < ids.size) {
        const stuck = [...ids].filter((id) => !order.includes(id))
        errors.push(`Loop detected involving: ${stuck.join(', ')}`)
    }

    // ---- everything must be one connected graph
    if (ids.size > 1) {
        const around = new Map(nodes.map((n) => [n.id, []]))
        for (const e of goodEdges) {
            around.get(e.from).push(e.to)
            around.get(e.to).push(e.from)
        }
        const first = nodes[0].id
        const visited = new Set([first])
        const stack = [first]
        while (stack.length) {
            const id = stack.pop()
            for (const nb of around.get(id)) {
                if (!visited.has(nb)) {
                    visited.add(nb)
                    stack.push(nb)
                }
            }
        }
        if (visited.size < ids.size) {
            const lost = [...ids].filter((id) => !visited.has(id))
            errors.push(`Disconnected nodes: ${lost.join(', ')}`)
        }
    }

    return { valid: errors.length === 0, errors, order }
}

module.exports = { validateGraph, VALID_OPS }