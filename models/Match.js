const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema(
  {
    // Tournament info
    league: { type: String },
    league_id: { type: String },
    season: { type: String },
    country: { type: String },
    stage: { type: String },
    gid: { type: String },
    groupId: { type: String },

    // Date/time
    matchDateUtc: { type: Date },
    date: { type: Date },
    time: { type: String },
    status: { type: String },

    // Venue
    venue: { type: String },
    venue_id: { type: String },
    venue_city: { type: String },

    // Teams
    homeTeam: { type: Object, default: {} },
    awayTeam: { type: Object, default: {} },

    // Scores
    homeGoals: { type: Number },
    awayGoals: { type: Number },
    ft_score: { type: String },
    et_score: { type: String },
    pen_score: { type: String },

    // Goals / Events
    goals: { type: Array, default: [] },
    lineups: { type: Array, default: [] },
    substitutions: { type: Array, default: [] },
    coaches: { type: Array, default: [] },
    referees: { type: Array, default: [] },

    // Misc
    odds: { type: mongoose.Schema.Types.Mixed },
    stats: { type: mongoose.Schema.Types.Mixed },
    injuries: { type: Array, default: [] },
    h2h: { type: mongoose.Schema.Types.Mixed },
    history: { type: mongoose.Schema.Types.Mixed },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { minimize: false }
);

module.exports = mongoose.model("Match", matchSchema);
