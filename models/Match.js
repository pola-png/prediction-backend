// models/Match.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const MatchSchema = new Schema({
  externalId: { type: String, index: true, sparse: true }, // e.g. soccersapi-12345
  source: { type: String }, // e.g. 'soccersapi', 'openligadb', 'history-import'
  league: { type: String },
  leagueCode: { type: String },
  matchDateUtc: { type: Date, required: true },
  status: { type: String, enum: ['scheduled','upcoming','tba','finished'], default: 'scheduled' },
  homeTeam: { type: Schema.Types.ObjectId, ref: 'Team' },
  awayTeam: { type: Schema.Types.ObjectId, ref: 'Team' },
  homeGoals: { type: Number },
  awayGoals: { type: Number },
  // optional raw score object
  score: {
    home: Number,
    away: Number
  },
  // store raw bookmaker odds or parsed odds (optional)
  odds: { type: Schema.Types.Mixed } // keep flexible shape: { bookmakers: [...], best: { ... } }
}, { timestamps: true });

module.exports = mongoose.model('Match', MatchSchema);
