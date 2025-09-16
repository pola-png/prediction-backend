// models/Match.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const MatchSchema = new Schema(
  {
    source: { type: String, default: 'manual' }, // e.g. soccersapi/openligadb
    externalId: { type: String, index: true, unique: true, sparse: true },

    leagueCode: { type: String, index: true }, // raw API league code
    leagueName: { type: String },              // human readable league name (for frontend)

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

    // optional raw score object
    score: {
      home: Number,
      away: Number,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Match', MatchSchema);
