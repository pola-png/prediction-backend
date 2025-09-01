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
  const games = [
    { match: "Chelsea vs Arsenal", prediction: "Chelsea Win", confidence: "78%", odds: 2.5 },
    { match: "Real Madrid vs Barcelona", prediction: "Draw", confidence: "55%", odds: 3.1 },
    { match: "PSG vs Marseille", prediction: "PSG Win", confidence: "82%", odds: 1.8 },
    { match: "Bayern vs Dortmund", prediction: "Over 2.5 Goals", confidence: "70%", odds: 2.8 },
    { match: "AC Milan vs Inter", prediction: "Inter Win", confidence: "69%", odds: 4.5 },
  ];
  return games;
}

// ================== ROUTES ==================

// API: JSON Predictions
app.get("/predictions", (req, res) => {
  res.json({
    status: "success",
    data: getPredictions()
  });
});

// HTML Page: Big Odds (10+ odds upward combined)
app.get("/big-odds", (req, res) => {
  const games = getPredictions();
  // Filter for "big odds" — odds >= 2.5 as example
  const bigOdds = games.filter(g => g.odds >= 2.5);

  let html = `
    <html>
      <head>
        <title>🔥 Big Odds Predictions 🔥</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background: #f4f4f9; }
          h1 { color: #222; }
          .game { margin-bottom: 15px; padding: 10px; background: #fff; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
          .match { font-weight: bold; }
          .odds { color: green; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>🔥 Big Odds (10+ Combined) 🔥</h1>
        ${bigOdds.map(g => `
          <div class="game">
            <div class="match">${g.match}</div>
            <div>Prediction: ${g.prediction}</div>
            <div>Confidence: ${g.confidence}</div>
            <div class="odds">Odds: ${g.odds}</div>
          </div>
        `).join("")}
      </body>
    </html>
  `;
  res.send(html);
});

// Home route
app.get("/", (req, res) => {
  res.send("AI Prediction Backend is running ✅");
});

// ================== CRON JOB ==================
// Runs every 2 hours
cron.schedule("0 */2 * * *", () => {
  console.log("⏰ Running AI Predictions update every 2 hours...");
  // later you can fetch/update from APIs here
  getPredictions();
});

// ================== START SERVER ==================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
