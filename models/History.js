const mongoose = require('mongoose');
const { Schema } = mongoose;

const historySchema = new Schema(
  {
    source: { type: String, default: 'history-import' }, // fallback, external API etc.
    externalId: { type: String, index: true, unique: true, sparse: true },

    league: { type: String },

    matchDateUtc: { type: Date, required: true },
    status: { type: String, enum: ['finished'], default: 'finished' },

    homeTeam: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    awayTeam: { type: Schema.Types.ObjectId, ref: 'Team', required: true },

    homeGoals: { type: Number, default: null },
    awayGoals: { type: Number, default: null }
  },
  { timestamps: true }
);

// Add compound index to avoid duplicates on same teams/date
historySchema.index({ homeTeam: 1, awayTeam: 1, matchDateUtc: 1 }, { unique: true });

module.exports = mongoose.model('History', historySchema);
