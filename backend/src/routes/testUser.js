const express = require("express");
const User = require("../models/User");

const router = express.Router();

router.get("/user/:email", async (req, res) => {
  try {
    const user = await User.findOne({
      email: req.params.email
    });

    if (!user) {
      return res.json({
        registered: false,
        message: "User not found"
      });
    }

    res.json({
      registered: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Database error"
    });
  }
});

module.exports = router;