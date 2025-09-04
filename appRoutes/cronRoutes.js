const express = require('express');
const router = express.Router();
const resultService = require('../appServices/resultService');
const predictionService = require('../appServices/predictionService');
const updateService = require('../appServices/updateService');

// Middleware to verify cron token
const verifyCronToken = (req, res, next) => {
  const token = req.headers['x-cron-token'];
  if (!token || token !== process.env.CRON_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Endpoint to update match results
router.get('/update-results', async (req, res) => {
  const token = req.headers['x-cron-token'];
  if (token !== process.env.CRON_TOKEN) {
    return res.status(403).send('Forbidden: invalid token');
  }

  // Respond immediately
  res.status(200).send('Cron job received, updating results...');

  // Continue processing asynchronously
  try {
    await resultService.updateAllResults();
    console.log('✅ Results updated successfully');
  } catch (err) {
    console.error('❌ Error updating results:', err);
  }
});

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

// Endpoint to update matches from all sources
router.get('/updateMatches', verifyCronToken, async (req, res) => {
  try {
    // Respond immediately
    res.status(200).json({
      status: 'processing',
      message: 'Update started from all sources',
      timestamp: new Date().toISOString()
    });

    // Continue processing asynchronously
    const result = await updateService.updateAllSources();
    
    console.log('✅ Matches updated successfully:', result.stats);
    
    // Log stats for each source
    Object.entries(result.stats).forEach(([source, stats]) => {
      console.log(`${source}: Processed ${stats.processed}, Updated ${stats.updated}`);
    });
  } catch (error) {
    console.error('❌ Error updating matches:', error);
  }
});

module.exports = router;
