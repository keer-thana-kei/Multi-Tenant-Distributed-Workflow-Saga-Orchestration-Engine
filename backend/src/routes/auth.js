const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const Tenant = require("../models/Tenant");

const router = express.Router();

// ===============================
// VALIDATION HELPERS
// ===============================

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const isValidPassword = (password) =>
    typeof password === "string" &&
    password.length >= 8 &&
    Buffer.byteLength(password, "utf8") <= 72;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ===============================
// DEFAULT TENANT
// ===============================

async function getDefaultTenant() {
    const tenantName = process.env.DEFAULT_TENANT_NAME;

    if (!tenantName || !tenantName.trim()) {
        throw new Error("DEFAULT_TENANT_NAME is not configured");
    }

    const tenant = await Tenant.findOne({
        name: {
            $regex: `^${escapeRegex(tenantName.trim())}$`,
            $options: "i"
        },
        active: true
    });

    if (!tenant) {
        throw new Error(`Active tenant '${tenantName}' not found`);
    }

    return tenant;
}

// ===============================
// GENERATE JWT TOKEN
// ===============================

const generateToken = (user) => {
    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < 32) {
        throw new Error("JWT_SECRET is missing or too short");
    }

    return jwt.sign(
        {
            userId: user._id.toString(),
            email: user.email,
            tenantId: user.tenantId.toString()
        },
        secret,
        { expiresIn: "1h" }
    );
};

// ===============================
// REGISTER
// ===============================

router.post("/register", async (req, res) => {
    try {
        const { name, email, password } = req.body || {};

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "Name, email and password are required"
            });
        }

        if (
            typeof name !== "string" ||
            name.trim().length < 2 ||
            name.trim().length > 50
        ) {
            return res.status(400).json({
                success: false,
                message: "Name must contain 2 to 50 characters"
            });
        }

        if (typeof email !== "string" || !isValidEmail(email.trim())) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid email address"
            });
        }

        if (!isValidPassword(password)) {
            return res.status(400).json({
                success: false,
                message:
                    "Password must contain at least 8 characters and cannot exceed 72 UTF-8 bytes"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "An account with this email already exists"
            });
        }

        const tenant = await getDefaultTenant();
        const hashedPassword = await bcrypt.hash(password, 12);

        const user = await User.create({
            name: name.trim(),
            email: normalizedEmail,
            password: hashedPassword,
            tenantId: tenant._id
        });

        const token = generateToken(user);

        return res.status(201).json({
            success: true,
            message: "Registration successful",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                tenantId: user.tenantId
            }
        });
    } catch (error) {
        console.error("Registration error:", error.message);

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "An account with this email already exists"
            });
        }

        if (error.name === "ValidationError") {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        if (error.name === "MongoServerError") {
            return res.status(500).json({
                success: false,
                message: "Database operation failed"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Registration failed"
        });
    }
});

// ===============================
// LOGIN
// ===============================

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        if (!isValidEmail(email.trim())) {
            return res.status(400).json({
                success: false,
                message: "Please enter a valid email address"
            });
        }

        if (Buffer.byteLength(password, "utf8") > 72) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const user = await User.findOne({ email: normalizedEmail }).select("+password");
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const tenant = await Tenant.findOne({ _id: user.tenantId, active: true });
        if (!tenant) {
            return res.status(403).json({
                success: false,
                message: "Your tenant is inactive or unavailable"
            });
        }

        const token = generateToken(user);

        return res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                tenantId: user.tenantId
            }
        });
    } catch (error) {
        console.error("Login error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Login failed"
        });
    }
});

module.exports = router;