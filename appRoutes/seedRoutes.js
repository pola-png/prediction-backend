const express = require('express');
const router = express.Router();
const seedService = require('../appServices/seedService');
const { seedMatches, seedHistorical } = require('../appServices/seeder');
const sources = require('../config/sources');

/**
 * @route POST /seed/teams
 * @desc Seed database with teams from API-Football
 * @access Private
 */
router.post('/teams', async (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await seedService.seedTeams();
    res.json({ 
      message: 'Teams seeded successfully', 
      count: result.count 
    });
  } catch (err) {
    console.error('Team seed error:', err);
    res.status(500).json({ 
      error: 'Failed to seed teams', 
      details: err.message 
    });
  }
});

/**
 * @route POST /seed/matches
 * @desc Seed database with upcoming matches from API-Football
 * @access Private
 */
router.post('/matches', async (req, res) => {
  console.log('🌱 Received seed matches request');
  
  // Log headers for debugging
  console.log('Headers received:', req.headers);
  
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    console.log('❌ Authentication failed. Token mismatch or missing');
    console.log('Received token:', token);
    console.log('Expected token:', process.env.ADMIN_TOKEN);
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Invalid or missing x-admin-token header'
    });
  }

  try {
    console.log('✅ Authentication successful, starting seed process...');
  const result = await seedService.seedMatchesFromOpenFootball();
  console.log('✅ Seed process completed:', result);
  res.json(result);
  } catch (err) {
    console.error('❌ Seed route error:', err);
    console.error('Stack trace:', err.stack);
    res.status(500).json({ 
      error: 'Failed to seed matches', 
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

/**
 * @route POST /seed/test-match
 * @desc Add a single test match to the database
 * @access Private
 */
router.post('/test-match', async (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  }

  try {
    const match = await seedService.seedTestMatch(req.body);
    res.json({
      status: 'success',
      match
    });
  } catch (err) {
    console.error('Test seed route error:', err);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to seed test match',
      error: err.message 
    });
  }
});

/**
 * @route POST /seed/init
 * @desc Initial bulk seeding of matches from both current and historical data
 * @access Private
 */
router.post('/init', async (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('🌱 Starting bulk initialization...');
    
    // First seed current season matches
    const currentCount = await seedMatches(sources);
    console.log(`✅ Seeded ${currentCount} current season matches`);
    
    // Then add historical data
    const historicalCount = await seedHistorical();
    console.log(`✅ Seeded ${historicalCount} historical matches`);
    
    res.json({
      status: 'success',
      message: 'Database initialized successfully',
      current: currentCount,
      historical: historicalCount,
      total: currentCount + historicalCount
    });
  } catch (err) {
    console.error('❌ Bulk initialization failed:', err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to initialize database',
      error: err.message
    });
  }
});

module.exports = router;
