const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataController');

// --- Frontend Data Routes ---
router.get('/dashboard', dataController.getDashboardData);
router.get('/predictions/:bucket', dataController.getPredictionsByBucket);

// ✅ Results endpoints
router.get('/results', dataController.getResults);         // all finished matches
router.get('/recent-results', dataController.getRecentResults); // recent finished matches
router.get('/summary/:matchId', dataController.getMatchSummary);

// ✅ Matches
router.get('/upcoming', dataController.getUpcomingMatches);   // only upcoming/scheduled
router.get('/recent', dataController.getRecentMatches);       // last 10 matches any status

// --- Cron Job Triggers ---
// NOTE: For external cron services, use 'Authorization: Bearer <token>' header
router.get('/cron/fetch-matches', dataController.runFetchMatches);
router.get('/cron/generate-predictions', dataController.runGeneratePredictions);
router.get('/cron/fetch-results', dataController.runFetchResults);

module.exports = router;
