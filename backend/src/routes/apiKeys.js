const express = require("express");
const crypto = require("crypto");

const ApiKey = require("../models/ApiKey");
const authenticateToken = require("../middleware/auth");

const router = express.Router();

router.post("/", authenticateToken, async (req, res) => {
  try {
    const apiKey = crypto.randomBytes(32).toString("hex");

    const keyHash = crypto
      .createHash("sha256")
      .update(apiKey)
      .digest("hex");

    await ApiKey.create({
      userId: req.user.userId,
      keyHash,
      name: req.body?.name || "Default API Key"
    });

    res.status(201).json({
      message: "API key created",
      apiKey
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to create API key"
    });
  }
});

module.exports = router;