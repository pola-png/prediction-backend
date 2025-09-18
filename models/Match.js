// models/Match.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const matchSchema = new Schema(
  {
    // IDs
    static_id: { type: Number, optional: true, index: true }, // permanent match id across feeds
    id: { type: Number }, // legacy id (may change when rescheduled)
    externalId: { type: String, index: true }, // feed-specific id like "goalserve-12345"
    source: { type: String, default: "goalserve", index: true }, // source system

    // Tournament info
    league_id: { type: Number },
    league: { type: String },
    season: { type: String },
    country: { type: String },
    stage: { type: String },
    stage_id: { type: Number },
    gid: { type: Number },
    groupId: { type: Number },

    // Date/time
    matchDateUtc: { type: Date },
    date: { type: Date }, // optional original date field
    time: { type: String },

    status: { type: String }, // Scheduled, FT, AET, Postp., etc.

    // Venue info
    venue: { type: String },
    venue_id: { type: Number },
    venue_city: { type: String },

    // Teams: references to Team model (populate in controllers)
    homeTeam: { type: Schema.Types.ObjectId, ref: 'Team' },
    awayTeam: { type: Schema.Types.ObjectId, ref: 'Team' },

    // Scores
    homeGoals: { type: Number },
    awayGoals: { type: Number },
    ft_score: { type: Number },
    ft_score_away: { type: Number },
    et_score: { type: Number },
    et_score_away: { type: Number },
    pen_score: { type: Number },
    pen_score_away: { type: Number },

    // Halftime
    halftime: { type: String },

    // Goals (feed events)
    goals: [
      {
        team: String,
        minute: String,
        player: String,
        playerid: Number,
        assist: String,
        assistid: Number,
        score: String,
      },
    ],

    // Lineups & substitutions & staff & officials
    lineups: [
      {
        number: Number,
        name: String,
        booking: String,
        id: Number,
        team: String,
      },
    ],
    substitutions: [
      {
        player_in_number: Number,
        player_in_name: String,
        player_in_booking: String,
        player_in_id: Number,
        player_out_name: String,
        player_out_id: Number,
        minute: String,
        team: String,
      },
    ],
    coaches: [
      {
        name: String,
        id: Number,
        team: String,
      },
    ],
    referees: [
      {
        name: String,
        id: Number,
      },
    ],

    // Odds / stats / injuries / h2h / history
    odds: { type: Schema.Types.Mixed },
    stats: { type: Schema.Types.Mixed },
    injuries: [{ type: Schema.Types.Mixed }],
    h2h: { type: Schema.Types.Mixed },
    history: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Match', matchSchema);
