// models/Team.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const TeamSchema = new Schema(
  {
    // Core identifiers
    team_id: { type: Number, required: true, unique: true, index: true }, // Goalserve stable team ID
    name: { type: String, required: true, index: true },
    shortName: { type: String },
    code: { type: String }, // e.g. "BAR" for Barcelona
    country: { type: String },

    // Logo / visual
    logoUrl: { type: String },
    color: { type: String }, // primary team color if Goalserve provides

    // Stadium / venue info
    venue: {
      id: { type: Number },
      name: { type: String },
      city: { type: String },
      capacity: { type: Number },
      surface: { type: String },
    },

    // Coach
    coach: {
      id: { type: Number },
      name: { type: String },
      country: { type: String },
    },

    // Squad (optional if expanded later)
    players: [
      {
        id: { type: Number },
        name: { type: String },
        number: { type: Number },
        position: { type: String },
        nationality: { type: String },
        birthdate: { type: Date },
      },
    ],

    // Metadata
    founded: { type: Number },
    sourceIds: { type: Map, of: String }, // mapping of external ids (other APIs)

  },
  { timestamps: true }
);

module.exports = mongoose.model("Team", TeamSchema);
