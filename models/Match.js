// models/Match.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const MatchSchema = new Schema(
  {
    source: { type: String, default: 'manual' }, // e.g. soccersapi, openligadb, footballjson
    externalId: { type: String, index: true, unique: true, sparse: true },

    leagueCode: { type: String, index: true },   // short code or API league identifier
    leagueName: { type: String },                // full league name for display

    matchDateUtc: { type: Date, required: true },
    status: {
      type: String,
      enum: ['scheduled', 'upcoming', 'tba', 'finished'],
      default: 'scheduled',
    },

    homeTeam: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    awayTeam: { type: Schema.Types.ObjectId, ref: 'Team', required: true },

    homeGoals: { type: Number },
    awayGoals: { type: Number },

    score: {
      home: Number,
      away: Number,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Match', MatchSchema);
