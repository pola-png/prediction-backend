// models/Team.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const TeamSchema = new Schema(
  {
    team_id: { type: Number, required: true, unique: true, index: true }, // ✅ true unique identifier
    name: { type: String, index: true }, // ⚡ not unique anymore (avoids null duplicate error)
    shortName: { type: String },
    code: { type: String },
    country: { type: String },
    logoUrl: { type: String },
    venue: { type: Schema.Types.Mixed }, // flexible, stores venue info from Goalserve
    coach: { type: Schema.Types.Mixed }, // flexible, stores coach info
    sourceIds: { type: Map, of: String }, // optional mappings to external ids
  },
  { timestamps: true }
);

module.exports = mongoose.model('Team', TeamSchema);
