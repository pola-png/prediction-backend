// models/Prediction.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const PredictionSchema = new Schema({
  matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
  version: { type: String, default: null },
  features: {
    teamFormWeight: Number,
    h2hWeight: Number,
    homeAdvWeight: Number,
    goalsWeight: Number,
    injuriesWeight: Number,
  },
  outcomes: {
    oneXTwo: {
      home: { type: Number, required: true },
      draw: { type: Number, required: true },
      away: { type: Number, required: true },
    },
    doubleChance: {
      homeOrDraw: Number,
      homeOrAway: Number,
      drawOrAway: Number,
    },
    over05: Number,
    over15: { type: Number, required: true },
    over25: { type: Number, required: true },
    bttsYes: { type: Number, required: true },
    bttsNo: Number,
  },
  confidence: { type: Number, required: true },
  bucket: { type: String, required: true, enum: ['vip', 'daily2', 'value5', 'big10'] },
  status: { type: String, enum: ['pending', 'won', 'lost'], default: 'pending' },
}, { timestamps: true });

module.exports = mongoose.model('Prediction', PredictionSchema);
