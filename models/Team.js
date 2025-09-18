// models/Team.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const TeamSchema = new Schema(
  {
    team_id: { type: Number, index: true, unique: true, sparse: true }, // Goalserve numeric team id
    name: { type: String, index: true }, // indexed for fast lookup; NOT unique to avoid null collisions
    shortName: { type: String },
    code: { type: String },
    country: { type: String },
    logoUrl: { type: String },
    venue: { type: Schema.Types.Mixed },
    coach: { type: Schema.Types.Mixed },
    sourceIds: { type: Map, of: String } // optional mapping of external ids
  },
  { timestamps: true }
);

module.exports = mongoose.model('Team', TeamSchema);
