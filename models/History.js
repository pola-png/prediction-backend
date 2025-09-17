// models/History.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const HistorySchema = new Schema({
  externalId: { type: String, index: true, sparse: true },
  source: { type: String },
  league: { type: String },
  leagueCode: { type: String },
  matchDateUtc: { type: Date, required: true },
  status: { type: String, enum: ['finished'], default: 'finished' },
  homeTeam: { type: Schema.Types.ObjectId, ref: 'Team' },
  awayTeam: { type: Schema.Types.ObjectId, ref: 'Team' },
  homeGoals: { type: Number },
  awayGoals: { type: Number },
  score: {
    home: Number,
    away: Number
  },
  odds: { type: Schema.Types.Mixed }
}, { timestamps: true });

module.exports = mongoose.model('History', HistorySchema);
