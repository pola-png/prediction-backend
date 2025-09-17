const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  playerId: { type: Number, unique: true },
  name: { type: String, required: true },
  number: Number,
  position: String, // G, D, M, A
  age: Number,
  injured: { type: Boolean, default: false },

  // Playing stats
  minutes: Number,
  appearances: Number,
  lineups: Number,
  substituteIn: Number,
  substituteOut: Number,
  substitutesOnBench: Number,

  // Goal stats
  goals: Number,
  assists: Number,
  shotsTotal: Number,
  shotsOn: Number,
  penComm: Number,
  penWon: Number,
  penScored: Number,
  penMissed: Number,
  penSaved: Number,

  // Discipline
  yellowCards: Number,
  yellowRed: Number,
  redCards: Number,

  // Defense stats
  tackles: Number,
  blocks: Number,
  interceptions: Number,
  clearances: Number,
  dispossessed: Number,
  saves: Number,
  insideBoxSaves: Number,

  // Passing / playmaking
  passes: Number,
  passAccuracy: Number,
  keyPasses: Number,
  crossesTotal: Number,
  crossesAccurate: Number,
  dribbleAttempts: Number,
  dribbleSucc: Number,
  woodworks: Number, // shots hitting woodwork

  // Captaincy and rating
  isCaptain: Number,
  rating: Number,

  // Team reference
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' }
}, { timestamps: true });

module.exports = mongoose.model('Player', playerSchema);
