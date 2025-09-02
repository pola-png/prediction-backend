const mongoose = require("mongoose");

const predictionSchema = new mongoose.Schema({
  match: { type: mongoose.Schema.Types.ObjectId, ref: "Match", required: true },
  predictedWinner: { type: String, required: true },
  confidence: { type: Number, min: 0, max: 100 }, // percentage
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Prediction", predictionSchema);
