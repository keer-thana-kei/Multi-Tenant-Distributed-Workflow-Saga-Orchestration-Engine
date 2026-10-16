const path = require("node:path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config({
  path: path.resolve(__dirname, "../../.env")
});

async function testConnection() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing from backend/.env");
    }

    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });

    console.log("MongoDB connected successfully!");

    await mongoose.disconnect();
    console.log("Connection test finished.");
  } catch (error) {
    console.error("Connection test failed:", error.message);
    process.exitCode = 1;
  }
}

testConnection();