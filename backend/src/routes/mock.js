
const router = require("express").Router();

// 1. Validate Order
router.post("/validate-order", (req, res) => {
    console.log("MOCK: order validated");

    res.status(200).json({
        success: true,
        message: "Order validated successfully",
        data: req.body
    });
});

// 2. Process Payment
router.post("/process-payment", (req, res) => {
    console.log("MOCK: payment charged");

    res.status(200).json({
        success: true,
        message: "Payment processed successfully"
    });
});

// 3. Send Notification
router.post("/send-notification", (req, res) => {
    console.log("MOCK: notification sent");

    res.status(200).json({
        success: true,
        message: "Notification sent successfully"
    });
});

// 4. Payment endpoint
router.post("/payment", (req, res) => {
    console.log("MOCK: payment charged");

    res.status(200).json({
        ok: true,
        message: "Payment charged successfully"
    });
});

// 5. Refund endpoint (compensation)
router.post("/refund", (req, res) => {
    console.log("MOCK: payment REFUNDED");

    res.status(200).json({
        ok: true,
        message: "Payment refunded successfully"
    });
});

// 6. SMS endpoint (intentional failure for Saga testing)
router.post("/sms", (req, res) => {
    console.log("MOCK: SMS failing on purpose");

    res.status(500).json({
        ok: false,
        message: "Simulated SMS service failure"
    });
});

// 7. Slow endpoint (for timeout testing)
router.post("/slow", (req, res) => {
    console.log("MOCK: slow endpoint called");

    setTimeout(() => {
        res.status(200).json({
            ok: true,
            message: "Slow operation completed"
        });
    }, 4000);
});

// 8. Inventory available
router.post("/inventory-yes", (req, res) => {
    console.log("MOCK: inventory checked -> in stock");
    res.json({ inStock: true });
});

// 9. Inventory unavailable
router.post("/inventory-no", (req, res) => {
    console.log("MOCK: inventory checked -> OUT of stock");
    res.json({ inStock: false });
});

// 10. Shipping endpoint
router.post("/ship", (req, res) => {
    console.log("MOCK: order SHIPPED");
    res.json({ ok: true });
});

// 11. Backorder endpoint
router.post("/backorder", (req, res) => {
    console.log("MOCK: BACKORDER created");
    res.json({ ok: true });
});

// 12. Flaky endpoint for retry policy / DLQ tests
// Fails twice and succeeds on the third call.
// Reset using POST /mock/flaky-reset
let flakyCalls = 0;

router.post("/flaky", (req, res) => {
    flakyCalls++;

    if (flakyCalls % 3 !== 0) {
        console.log(`MOCK: flaky FAILED (call ${flakyCalls})`);
        return res.status(503).json({ ok: false });
    }

    console.log(`MOCK: flaky OK (call ${flakyCalls})`);
    res.json({ ok: true });
});

// 13. Reset flaky endpoint counter
router.post("/flaky-reset", (req, res) => {
    flakyCalls = 0;
    res.json({ ok: true });
});

// 14. Permanent error (should NOT be retried)
router.post("/bad-request", (req, res) => {
    console.log("MOCK: bad request (400)");
    res.status(400).json({ ok: false });
});

// 15. Refund that always fails
// Used to test compensation_failed
router.post("/refund-broken", (req, res) => {
    console.log("MOCK: refund BROKEN");
    res.status(500).json({ ok: false });
});

module.exports = router;
