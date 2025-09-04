const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema({
  homeTeam: { type: mongoose.Schema.Types.ObjectId, ref: "Team", required: true },
  awayTeam: { type: mongoose.Schema.Types.ObjectId, ref: "Team", required: true },
  date: { type: Date, required: true },
  provider: { 
    type: String, 
    enum: ["football-data", "api-football", "manual", "football.json", "OpenLigaDB", "GitHub"], 
    default: "manual" 
  },
  providerMatchId: { type: String, sparse: true },
  league: String,
  season: String,
  status: { 
    type: String, 
    enum: ["SCHEDULED", "IN_PLAY", "PAUSED", "FINISHED", "CANCELLED", "POSTPONED"],
    default: "SCHEDULED" 
  },
  minute: { type: Number, default: 0 },
  score: {
    current: { home: Number, away: Number },
    halftime: { home: Number, away: Number },
    fulltime: { home: Number, away: Number }
  },
  events: [{
    minute: Number,
    type: { type: String, enum: ["GOAL", "YELLOW_CARD", "RED_CARD", "SUBSTITUTION"] },
    team: String,
    player: String,
    detail: String,
    timestamp: { type: Date, default: Date.now }
  }],
  lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

// Index for provider ID lookups
matchSchema.index({ provider: 1, providerMatchId: 1 }, { unique: true, sparse: true });
// Index for finding live matches
matchSchema.index({ status: 1, date: 1 });

module.exports = mongoose.model("Match", matchSchema);
