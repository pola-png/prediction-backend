// models/Match.js
const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  // Unique IDs
  static_id: { type: Number, required: true, unique: true, index: true }, // stable across feeds
  id: { type: Number }, // legacy id (not stable, changes when match date changes)

  // Tournament info
  league_id: { type: Number },
  league: { type: String },
  season: { type: String },
  country: { type: String },
  stage: { type: String },
  stage_id: { type: Number },
  groupId: { type: Number }, // optional (for group stages like UCL group A/B)

  // Match info
  date: { type: Date },
  time: { type: String },
  status: { type: String }, // Scheduled, FT, AET, Postp., etc.

  // Venue info
  venue: { type: String },
  venue_id: { type: Number },
  venue_city: { type: String },

  // Teams
  homeTeam: {
    id: Number,
    name: String,
    score: Number,
    ft_score: Number,
    et_score: Number,
    pen_score: Number,
  },
  awayTeam: {
    id: Number,
    name: String,
    score: Number,
    ft_score: Number,
    et_score: Number,
    pen_score: Number,
  },

  // Half-time score
  halftime: { type: String },

  // Goals
  goals: [
    {
      team: String, // localteam or visitorteam
      minute: String, // e.g. "45+2"
      player: String,
      playerid: Number,
      assist: String,
      assistid: Number,
      score: String, // running score after goal
    },
  ],

  // Lineups
  lineups: [
    {
      number: Number,
      name: String,
      booking: String, // e.g. "YC 45", "RC 87"
      id: Number,
    },
  ],

  // Substitutions
  substitutions: [
    {
      player_in_number: Number,
      player_in_name: String,
      player_in_booking: String,
      player_in_id: Number,
      player_out_name: String,
      player_out_id: Number,
      minute: String,
    },
  ],

  // Coaches
  coaches: [
    {
      name: String,
      id: Number,
    },
  ],

  // Referees
  referees: [
    {
      name: String,
      id: Number,
    },
  ],

  // Extra fields for odds & stats compatibility
  odds: { type: mongoose.Schema.Types.Mixed }, // store odds JSON blob
  stats: { type: mongoose.Schema.Types.Mixed }, // store live stats blob
}, { timestamps: true });

module.exports = mongoose.model('Match', matchSchema);
