// Import libraries
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Example AI Prediction Data
function getPredictions() {
  return [
    { match: "Chelsea vs Arsenal", prediction: "Chelsea Win", confidence: "78%", odds: 2.5 },
    { match: "Real Madrid vs Barcelona", prediction: "Draw", confidence: "55%", odds: 3.1 },
    { match: "PSG vs Marseille", prediction: "PSG Win", confidence: "82%", odds: 1.8 },
    { match: "Bayern vs Dortmund", prediction: "Over 2.5 Goals", confidence: "70%", odds: 2.8 },
    { match: "AC Milan vs Inter", prediction: "Inter Win", confidence: "69%", odds: 4.5 },
  ];
}

// ================== ROUTES ==================

// API: All predictions
app.get("/api/predictions", (req, res) => {
  res.json({
    status: "success",
    data: getPredictions(),
  });
});

// API: Big odds (filter odds >= 2.5)
app.get("/api/big-odds", (req, res) => {
  const bigOdds = getPredictions().filter((g) => g.odds >= 2.5);
  res.json({
    status: "success",
    data: bigOdds,
  });
});

// API: Sure odds (filter odds < 2.0, for "VIP")
app.get("/api/vip", (req, res) => {
  const sureOdds = getPredictions().filter((g) => g.odds < 2.0);
  res.json({
    status: "success",
    data: sureOdds,
  });
});

// Home route
app.get("/", (req, res) => {
  res.send("✅ AI Prediction Backend is running");
});

// ================== CRON JOB ==================
// Runs every 2 hours
cron.schedule("0 */2 * * *", () => {
  console.log("⏰ Running AI Predictions update every 2 hours...");
  // later you can fetch/update predictions from real APIs here
  getPredictions();
});

// ================== START SERVER ==================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
