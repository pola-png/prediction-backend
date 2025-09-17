// models/Match.js
const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema(
  {
    // Unique IDs
    static_id: { type: Number, required: true, unique: true, index: true }, // permanent match ID across feeds
    id: { type: Number }, // legacy ID (changes if match is rescheduled)

    // Tournament info
    league_id: { type: Number },
    league: { type: String },
    season: { type: String },
    country: { type: String },
    stage: { type: String },
    stage_id: { type: Number },
    gid: { type: Number }, // stage mapping ID
    groupId: { type: Number }, // for tournaments with groups

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
      ft_score: String,
      et_score: String,
      pen_score: String,
    },
    awayTeam: {
      id: Number,
      name: String,
      score: Number,
      ft_score: String,
      et_score: String,
      pen_score: String,
    },

    // Halftime
    halftime: { type: String },

    // Goals
    goals: [
      {
        team: String, // localteam / visitorteam
        minute: String, // e.g. "45+2"
        player: String,
        playerid: Number,
        assist: String,
        assistid: Number,
        score: String, // score after goal
      },
    ],

    // Lineups
    lineups: [
      {
        number: Number,
        name: String,
        booking: String, // YC 45, RC 87, etc.
        id: Number,
        team: String, // localteam / visitorteam
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
        team: String, // localteam / visitorteam
      },
    ],

    // Coaches
    coaches: [
      {
        name: String,
        id: Number,
        team: String, // localteam / visitorteam
      },
    ],

    // Referees
    referees: [
      {
        name: String,
        id: Number,
      },
    ],

    // Odds (pregame/moneyline/etc.)
    odds: { type: mongoose.Schema.Types.Mixed },

    // Live stats (commentaries, player stats, etc.)
    stats: { type: mongoose.Schema.Types.Mixed },

    // Injuries (from player injury feed)
    injuries: [
      {
        player_id: Number,
        player_name: String,
        type: String, // injury type
        status: String, // e.g. "Out", "Doubtful"
        start_date: String,
        expected_return: String,
      },
    ],

    // Head-to-head comparison data
    h2h: { type: mongoose.Schema.Types.Mixed },

    // Historical match link (optional)
    history: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Match", matchSchema);
