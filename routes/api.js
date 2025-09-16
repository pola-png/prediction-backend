// routes/api.js
const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataController');

/* -------------------- Frontend Data -------------------- */
router.get('/dashboard', dataController.getDashboardData);
router.get('/predictions/:bucket', dataController.getPredictionsByBucket);

/* -------------------- Results -------------------- */
router.get('/results', dataController.getResults);               // all finished matches
router.get('/results/recent', dataController.getRecentResults);  // recent finished matches
router.get('/summary/:matchId', dataController.getMatchSummary); // single match summary

/* -------------------- Matches -------------------- */
router.get('/matches/upcoming', dataController.getUpcomingMatches); // only upcoming (next 24h)
router.get('/matches/recent', dataController.getRecentMatches);     // last 10 matches
router.get('/matches/history', dataController.getMatchHistory);     // finished match history

// Explicit import for fallback history JSON (POST -> body: { url: "..." })
router.post('/matches/import-history', dataController.importHistory);

/* -------------------- Cron Job Triggers -------------------- */
// NOTE: For external cron services, use 'Authorization: Bearer <token>' header
router.get('/cron/fetch-matches', dataController.runFetchMatches);
router.get('/cron/generate-predictions', dataController.runGeneratePredictions);

module.exports = router;
