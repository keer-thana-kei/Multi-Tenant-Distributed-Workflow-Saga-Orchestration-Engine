const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const testUserRoutes = require("./routes/testUser");
const authRoutes = require("./routes/auth");
const apiKeyRoutes = require("./routes/apiKeys");
const workflowRoutes = require("./routes/Workflow");
const { recoverStuckRuns } = require("./engine/executor");
const { startEventWatcher } = require("./engine/eventWatcher");
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Workflow Engine API is running",
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "workflow-backend" });
});

app.use("/api/auth", authRoutes);
app.use("/api/keys", apiKeyRoutes);
app.use("/api/test", testUserRoutes);
app.use("/api/workflows", workflowRoutes);
app.use("/mock", require("./routes/mock"));
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid or empty JSON body" });
  }
  console.error(err);
  res.status(500).json({ message: "Server error" });
});
app.use('/api/events', require('./routes/events'))

const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log("MongoDB connected successfully!");
    await recoverStuckRuns();

    startEventWatcher();

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log("Connected to DB:", mongoose.connection.name);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error.message);
  });
