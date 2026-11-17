
// Load environment variables
require("dotenv").config();

const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

// Routes
const testUserRoutes = require("./routes/testUser");
const authRoutes = require("./routes/auth");
const apiKeyRoutes = require("./routes/apiKeys");
const workflowRoutes = require("./routes/Workflow");
const eventRoutes = require("./routes/events");
const dlqRoutes = require("./routes/dlq");

// Engine services
const { recoverStuckRuns } = require("./engine/executor");
const { startEventWatcher } = require("./engine/eventWatcher");
const { attachWebSocket } = require("./engine/wsServer");

// Initialize Express
const app = express();

// Environment configuration
console.log("Environment configuration:");
console.log(
    "DEFAULT_TENANT_NAME:",
    process.env.DEFAULT_TENANT_NAME || "NOT FOUND"
);
console.log(
    "JWT_SECRET configured:",
    Boolean(process.env.JWT_SECRET)
);
console.log(
    "MONGODB_URI configured:",
    Boolean(process.env.MONGODB_URI)
);

// Middleware
app.use(cors());
app.use(express.json());

// Root route
app.get("/", (req, res) => {
    res.json({
        message: "Workflow Engine API is running"
    });
});

// Health check route
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "workflow-backend"
    });
});

// Authentication routes
app.use("/api/auth", authRoutes);

// API key routes
app.use("/api/keys", apiKeyRoutes);

// Test user routes
app.use("/api/test", testUserRoutes);

// Workflow routes
app.use("/api/workflows", workflowRoutes);

// Event routes
app.use("/api/events", eventRoutes);

// Monitoring statistics routes
app.use("/api/stats", require("./routes/stats"));

// Mock endpoints for Saga testing
app.use("/mock", require("./routes/mock"));

// Dead Letter Queue routes
app.use("/api/dlq", dlqRoutes);

// Error handling middleware
// This must be placed after all routes.
app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") {
        return res.status(400).json({
            message: "Invalid or empty JSON body"
        });
    }

    console.error(err);

    res.status(500).json({
        message: "Server error"
    });
});

// Server port
const PORT = process.env.PORT || 5000;

// Create HTTP server
// WebSocket and Express share the same HTTP server.
const server = http.createServer(app);

// Attach WebSocket monitoring
attachWebSocket(server);

// MongoDB connection
mongoose
    .connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log("MongoDB connected successfully!");
        console.log("Connected to DB:", mongoose.connection.name);

        // Recover unfinished workflow executions
        await recoverStuckRuns();

        // Start watching database events
        startEventWatcher();

        // Start HTTP and WebSocket server
        server.listen(PORT, () => {
            console.log(
                `Server running on http://localhost:${PORT}`
            );
        });
    })
    .catch((error) => {
        console.error(
            "MongoDB connection failed:",
            error.message
        );
    });
