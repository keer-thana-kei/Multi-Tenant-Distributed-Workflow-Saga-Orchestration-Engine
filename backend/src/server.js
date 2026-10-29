const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const testUserRoutes = require("./routes/testUser");
const authRoutes = require("./routes/auth");
const apiKeyRoutes = require("./routes/apiKeys");
const workflowRoutes = require("./routes/Workflow");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Workflow Engine API is running"
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/keys", apiKeyRoutes);
app.use("/api/test", testUserRoutes);
app.use("/api/workflows", workflowRoutes);
app.use('/mock', require('./routes/mock'))

const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected successfully!");

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
       console.log('Connected to DB:', mongoose.connection.name);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error.message);
  });