const express = require('express');
const router = express.Router();
const leaderboardService = require('../appServices/leaderboardService');

// GET leaderboard table
router.get('/', async (req, res) => {
  const leaderboard = await leaderboardService.getLeaderboard();
  res.json(leaderboard);
});

module.exports = router;
