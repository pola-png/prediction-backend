// models/Match.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const MatchSchema = new Schema({
  source: { type: String },
  externalId: { type: String, unique: true, sparse: true },
  leagueCode: { type: String, default: null }, // optional so creations don't fail
  matchDateUtc: { type: Date, required: true },
  status: {
    type: String,
    enum: ['scheduled', 'upcoming', 'tba', 'live', 'inplay', 'finished', 'postponed', 'cancelled'],
    default: 'scheduled'
  },
  homeTeam: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
  awayTeam: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
  homeGoals: { type: Number, default: null },
  awayGoals: { type: Number, default: null },
  tags: [{ type: String }],
  prediction: { type: Schema.Types.ObjectId, ref: 'Prediction', default: null },
  season: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Match', MatchSchema);
