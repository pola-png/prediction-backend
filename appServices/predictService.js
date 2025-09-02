const Prediction = require('../models/Prediction');

async function getAllPredictions() {
  return await Prediction.find();
}

async function getPredictionById(id) {
  return await Prediction.findById(id);
}

async function createPrediction(data) {
  const prediction = new Prediction(data);
  return await prediction.save();
}

async function updatePrediction(id, data) {
  return await Prediction.findByIdAndUpdate(id, data, { new: true });
}

async function deletePrediction(id) {
  return await Prediction.findByIdAndDelete(id);
}

module.exports = { getAllPredictions, getPredictionById, createPrediction, updatePrediction, deletePrediction };
