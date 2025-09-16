// models/Prediction.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const PredictionSchema = new Schema(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    version: { type: String, default: 'ai-2x' },

    // outcomes structure follows what AI returns
    outcomes: {
      oneXTwo: {
        home: Number,
        draw: Number,
        away: Number,
      },
      doubleChance: {
        homeOrDraw: Number,
        homeOrAway: Number,
        drawOrAway: Number,
      },
      over05: Number,
      over15: Number,
      over25: Number,
      bttsYes: Number,
      bttsNo: Number,
    },

    confidence: { type: Number, min: 0, max: 100 },
    bucket: { type: String, enum: ['vip', 'daily2', 'value5', 'big10'], required: true },
    status: { type: String, enum: ['pending', 'won', 'lost'], default: 'pending' },
    analysis: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Prediction', PredictionSchema);
