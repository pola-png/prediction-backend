const express = require('express');
const router = express.Router();
const predictionService = require('../appServices/predictionService');

// GET all predictions
router.get('/', async (req, res) => {
  const predictions = await predictionService.getAllPredictions();
  res.json(predictions);
});

// GET single prediction
router.get('/:id', async (req, res) => {
  const prediction = await predictionService.getPredictionById(req.params.id);
  res.json(prediction);
});

// CREATE new prediction
router.post('/', async (req, res) => {
  const newPrediction = await predictionService.createPrediction(req.body);
  res.json(newPrediction);
});

// UPDATE prediction
router.put('/:id', async (req, res) => {
  const updatedPrediction = await predictionService.updatePrediction(req.params.id, req.body);
  res.json(updatedPrediction);
});

// DELETE prediction
router.delete('/:id', async (req, res) => {
  await predictionService.deletePrediction(req.params.id);
  res.json({ message: 'Prediction deleted' });
});

module.exports = router;
