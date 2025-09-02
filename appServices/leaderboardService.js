const Prediction = require('../models/Prediction');
const Result = require('../models/Result');

async function getLeaderboard() {
  const predictions = await Prediction.find();
  const results = await Result.find();

  let leaderboard = {};

  predictions.forEach(pred => {
    const result = results.find(r => r.matchId.toString() === pred.matchId.toString());
    if (result) {
      const correct = pred.predictedOutcome === result.finalOutcome;
      const user = pred.userName || "Anonymous";
      if (!leaderboard[user]) leaderboard[user] = { points: 0 };
      if (correct) leaderboard[user].points += 3; // 3 points for correct prediction
    }
  });

  return Object.entries(leaderboard)
    .map(([user, stats]) => ({ user, points: stats.points }))
    .sort((a, b) => b.points - a.points);
}

module.exports = { getLeaderboard };
