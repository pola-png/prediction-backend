// Import libraries
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Example AI Prediction Data
function getPredictions() {
  // Later, you can connect this to real AI/ML or APIs
  const games = [
    { match: "Chelsea vs Arsenal", prediction: "Chelsea Win", confidence: "78%" },
    { match: "Real Madrid vs Barcelona", prediction: "Draw", confidence: "55%" },
    { match: "PSG vs Marseille", prediction: "PSG Win", confidence: "82%" }
  ];

  return games;
}

// Route for predictions
app.get("/predictions", (req, res) => {
  res.json({
    status: "success",
    data: getPredictions()
  });
});

// Home route
app.get("/", (req, res) => {
  res.send("AI Prediction Backend is running ✅");
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
