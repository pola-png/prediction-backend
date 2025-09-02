const express = require('express');
const router = express.Router();
const resultService = require('../appServices/resultService');

// GET all results
router.get('/', async (req, res) => {
  const results = await resultService.getAllResults();
  res.json(results);
});

// GET single result
router.get('/:id', async (req, res) => {
  const result = await resultService.getResultById(req.params.id);
  res.json(result);
});

// CREATE new result
router.post('/', async (req, res) => {
  const newResult = await resultService.createResult(req.body);
  res.json(newResult);
});

// UPDATE result
router.put('/:id', async (req, res) => {
  const updatedResult = await resultService.updateResult(req.params.id, req.body);
  res.json(updatedResult);
});

// DELETE result
router.delete('/:id', async (req, res) => {
  await resultService.deleteResult(req.params.id);
  res.json({ message: 'Result deleted' });
});

module.exports = router;
