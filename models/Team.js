// models/Team.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const TeamSchema = new Schema({
  name: { type: String, required: true },
  logo: { type: String },        // legacy field
  logoUrl: { type: String },     // preferred
  country: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Team', TeamSchema);
