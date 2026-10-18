const mongoose = require("mongoose");

const apiKeySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    keyHash: {
      type: String,
      required: true
    },

    name: {
      type: String,
      default: "Default API Key"
    },

    createdAt: {
      type: Date,
      default: Date.now
    }
  }
);

module.exports = mongoose.model("ApiKey", apiKeySchema);