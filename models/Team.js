// models/Team.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const TeamSchema = new Schema(
  {
    name: { type: String, required: true, index: true, unique: true },
    logoUrl: { type: String }, // store logo if available
    sourceIds: { type: Map, of: String }, // optional mapping of external ids
  },
  { timestamps: true }
);

module.exports = mongoose.model('Team', TeamSchema);
