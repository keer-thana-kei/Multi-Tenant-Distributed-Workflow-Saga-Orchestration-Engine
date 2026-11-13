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

// ---- for branching tests
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

module.exports = router