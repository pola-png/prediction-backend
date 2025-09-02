const express = require('express');
const router = express.Router();
const matchService = require('../appServices/matchService');

// GET all matches
router.get('/', async (req, res) => {
  const matches = await matchService.getAllMatches();
  res.json(matches);
});

// GET single match
router.get('/:id', async (req, res) => {
  const match = await matchService.getMatchById(req.params.id);
  res.json(match);
});

// CREATE new match
router.post('/', async (req, res) => {
  const newMatch = await matchService.createMatch(req.body);
  res.json(newMatch);
});

// UPDATE match
router.put('/:id', async (req, res) => {
  const updatedMatch = await matchService.updateMatch(req.params.id, req.body);
  res.json(updatedMatch);
});

// DELETE match
router.delete('/:id', async (req, res) => {
  await matchService.deleteMatch(req.params.id);
  res.json({ message: 'Match deleted' });
});

module.exports = router;
