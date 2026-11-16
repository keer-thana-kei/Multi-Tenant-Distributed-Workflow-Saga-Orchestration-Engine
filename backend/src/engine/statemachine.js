const EXEC_TRANSITIONS = {
    pending: ['running'],
    running: ['success', 'compensating'],
    compensating: ['compensated', 'failed'],
    success: [],
    compensated: [],
    failed: []
}

const STEP_TRANSITIONS = {
    pending: ['running', 'skipped'],
    running: ['success', 'failed'],
    success: ['compensated', 'compensation_failed', 'compensation_skipped'],
    failed: [],
    skipped: [],
    compensated: [],
    compensation_failed: [],
    compensation_skipped: []
}

const canMove = (table, from, to) => (table[from] || []).includes(to)

const setExecStatus = (exec, to) => {
    if (!canMove(EXEC_TRANSITIONS, exec.status, to)) {
        throw new Error(`Invalid execution transition: ${exec.status} -> ${to}`)
    }
    exec.status = to
}

const setStepStatus = (step, to) => {
    if (!canMove(STEP_TRANSITIONS, step.status, to)) {
        throw new Error(`Invalid step transition (${step.name}): ${step.status} -> ${to}`)
    }
    step.status = to
}

module.exports = { setExecStatus, setStepStatus }