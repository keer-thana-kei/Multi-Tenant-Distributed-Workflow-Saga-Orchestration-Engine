const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Tenant = require("../models/Tenant");
const router = express.Router();

// REGISTER
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email and password are required"
      });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({
        message: "User already exists"
      });
    }

    // Find the active workflow-engine tenant
    const tenant = await Tenant.findOne({
       name: "workflow-engine",
        active: true
    });

    if (!tenant) {
      return res.status(404).json({
         message: "Workflow-engine tenant not found"
      });
    }

  // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

  // Create user with tenant ID
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      tenantId: tenant._id
    });

    const token = jwt.sign(
    {
      userId: user._id,
      email: user.email,
      tenantId: user.tenantId
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "1h"
    }
    );

    res.status(201).json({
      message: "Registration successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Registration failed"
    });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        tenantId: user.tenantId
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1h"
      }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Login failed"
    });
  }
});

module.exports = router;