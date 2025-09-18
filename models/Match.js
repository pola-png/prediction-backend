import mongoose from "mongoose";

const matchSchema = new mongoose.Schema(
  {
    unique_key: { type: String, required: true, unique: true }, // 🔑 new field

    static_id: { type: String, default: null },
    league: { type: String },
    league_id: { type: String },
    date: { type: Date },
    matchDateUtc: { type: Date },
    status: { type: String },

    localteam: { type: Object, default: {} },
    visitorteam: { type: Object, default: {} },
    goals: { type: Array, default: [] },
    injuries: { type: Array, default: [] },
    substitutions: { type: Array, default: [] },
    lineups: { type: Array, default: [] },
    coaches: { type: Array, default: [] },
    referees: { type: Array, default: [] },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { minimize: false }
);

export default mongoose.model("Match", matchSchema);
