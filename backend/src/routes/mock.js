const router = require('express').Router()

router.post('/payment', (req, res) => {
    console.log('MOCK: payment charged')
    res.json({ ok: true })
})

router.post('/refund', (req, res) => {
    console.log('MOCK: payment REFUNDED')
    res.json({ ok: true })
})

router.post('/sms', (req, res) => {
    console.log('MOCK: sms failing on purpose')
    res.status(500).json({ ok: false })
})

router.post('/slow', (req, res) => setTimeout(() => res.json({ ok: true }), 4000))

router.post('/inventory-yes', (req, res) => {
    console.log('MOCK: inventory checked -> in stock')
    res.json({ inStock: true })
})

router.post('/inventory-no', (req, res) => {
    console.log('MOCK: inventory checked -> OUT of stock')
    res.json({ inStock: false })
})

router.post('/ship', (req, res) => {
    console.log('MOCK: order SHIPPED')
    res.json({ ok: true })
})

router.post('/backorder', (req, res) => {
    console.log('MOCK: BACKORDER created')
    res.json({ ok: true })
})

// ---- for retry policy / DLQ tests
// Fails twice (503), succeeds on the 3rd call. Reset with POST /mock/flaky-reset
let flakyCalls = 0
router.post('/flaky', (req, res) => {
    flakyCalls++
    if (flakyCalls % 3 !== 0) {
        console.log(`MOCK: flaky FAILED (call ${flakyCalls})`)
        return res.status(503).json({ ok: false })
    }
    console.log(`MOCK: flaky OK (call ${flakyCalls})`)
    res.json({ ok: true })
})
router.post('/flaky-reset', (req, res) => {
    flakyCalls = 0
    res.json({ ok: true })
})

// Permanent error: should NOT be retried
router.post('/bad-request', (req, res) => {
    console.log('MOCK: bad request (400)')
    res.status(400).json({ ok: false })
})

// Refund that always fails, to test compensation_failed
router.post('/refund-broken', (req, res) => {
    console.log('MOCK: refund BROKEN')
    res.status(500).json({ ok: false })
})

module.exports = router