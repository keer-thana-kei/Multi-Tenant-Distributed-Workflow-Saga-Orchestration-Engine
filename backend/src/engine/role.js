const os = require('os')

const ROLE = (process.env.ROLE || 'all').toLowerCase()

module.exports = {
    ROLE,
    WORKER_ID: `${os.hostname()}-${process.pid}`,
    runsApi: ROLE === 'api' || ROLE === 'all',
    runsWorker: ROLE === 'worker' || ROLE === 'all'
}