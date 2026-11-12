
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

module.exports = router;
