const express = require('express');
const router = express.Router();
const resultService = require('../appServices/resultService');
const predictionService = require('../appServices/predictionService');

// Middleware to verify cron token
const verifyCronToken = (req, res, next) => {
  const token = req.headers['x-cron-token'];
  if (!token || token !== process.env.CRON_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Endpoint to update match results
router.post('/update-results', verifyCronToken, (req, res) => {
  // Respond immediately
  res.json({ 
    success: true,
    message: 'Update process started',
    jobId: Date.now(),
    timestamp: new Date().toISOString()
  });

  // Process updates asynchronously
  (async () => {
    try {
      const results = await resultService.updateAllResults();
      console.log('✅ Async update completed:', results);
    } catch (error) {
      console.error('❌ Async update failed:', error);
    }
  })().catch(err => console.error('💥 Unhandled async error:', err));

// Endpoint to update predictions
router.post('/update-predictions', verifyCronToken, async (req, res) => {
  try {
    await predictionService.generatePredictions();
    res.json({ 
      success: true,
      message: 'Predictions updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cron job error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update predictions',
      message: error.message
    });
  }
});

// Health check endpoint for cron jobs
router.get('/health', verifyCronToken, (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
