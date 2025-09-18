// models/Team.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const TeamSchema = new Schema(
  {
    team_id: { type: Number }, // external provider id (Goalserve static team ID)
    name: { type: String }, // team display name
    shortName: { type: String },
    code: { type: String },
    country: { type: String },
    logoUrl: { type: String },
    venue: { type: Schema.Types.Mixed },
    coach: { type: Schema.Types.Mixed },
    sourceIds: { type: Map, of: String }, // optional external id map
  },
  { timestamps: true }
);

// Ensure name unique only when name exists (prevents duplicate-null error).
TeamSchema.index(
  { name: 1 },
  { unique: true, partialFilterExpression: { name: { $type: 'string' } } }
);

// Ensure team_id unique only when present
TeamSchema.index(
  { team_id: 1 },
  { unique: true, partialFilterExpression: { team_id: { $type: 'number' } } }
);

module.exports = mongoose.model('Team', TeamSchema);
