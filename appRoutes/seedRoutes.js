const express = require('express');
const router = express.Router();
const seedService = require('../appServices/seedService');

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
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await seedService.seedUpcomingMatches();
    res.json({ 
      message: 'Matches seeded successfully', 
      count: result.count 
    });
  } catch (err) {
    console.error('Seed route error:', err);
    res.status(500).json({ 
      error: 'Failed to seed matches', 
      details: err.message 
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

module.exports = router;
