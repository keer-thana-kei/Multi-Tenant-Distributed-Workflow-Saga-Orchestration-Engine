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

module.exports = router