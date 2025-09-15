const Match = require('../models/Match');
const Prediction = require('../models/Prediction');
const { fetchAndStoreMatches, generateAllPredictions, fetchAndStoreResults } = require('../services/cronService');
const { getPredictionFromAI } = require('../services/aiService');

// --- Bucket Configuration (confidence thresholds + max picks per bucket) ---
const BUCKET_CONFIG = {
  vip: { minConfidence: 95, maxCount: 1, exactCount: 1 },
  "2odds": { minConfidence: 90, maxCount: 3, exactCount: 3 },
  "5odds": { minConfidence: 85, maxCount: 5 },
  big10: { minConfidence: 80, maxCount: 10 },
};

// --- Helper: assign predictions to buckets with exact count rules ---
function bucketPredictions(allPredictions) {
  const bucketed = {};
  for (const [bucket, config] of Object.entries(BUCKET_CONFIG)) {
    let filtered = allPredictions
      .filter(p => p.confidence >= config.minConfidence)
      .sort((a, b) => b.confidence - a.confidence);

    if (config.exactCount) {
      filtered = filtered.slice(0, config.exactCount);
      while (filtered.length < config.exactCount) filtered.push(null); // fill empty slots if not enough predictions
    } else {
      filtered = filtered.slice(0, config.maxCount);
    }

    bucketed[bucket] = filtered;
  }
  return bucketed;
}

// --- Dashboard data (predictions grouped by buckets) ---
exports.getDashboardData = async (req, res) => {
  try {
    const buckets = Object.keys(BUCKET_CONFIG);
    const data = {};

    for (const bucket of buckets) {
      const predictions = await Prediction.find({ bucket })
        .populate('matchId')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
      data[bucket] = bucketPredictions(predictions);
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("API: Failed to fetch dashboard data:", err.message);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
};

// --- Predictions by bucket ---
exports.getPredictionsByBucket = async (req, res) => {
  try {
    const bucket = req.params.bucket;
    const predictions = await Prediction.find({ bucket })
      .populate('matchId')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    res.json(bucketPredictions(predictions));
  } catch (err) {
    console.error("API: Failed to fetch predictions:", err.message);
    res.status(500).json({ error: "Failed to fetch predictions" });
  }
};

// --- All Results (finished matches) ---
exports.getResults = async (req, res) => {
  try {
    const results = await Match.find({ status: "finished" })
      .populate("homeTeam awayTeam prediction")
      .sort({ matchDateUtc: -1 })
      .limit(30)
      .lean();

    res.json(results);
  } catch (err) {
    console.error("API: Failed to fetch results:", err.message);
    res.status(500).json({ error: "Failed to fetch results" });
  }
};

// --- Recent Results (latest finished matches only) ---
exports.getRecentResults = async (req, res) => {
  try {
    const results = await Match.find({ status: "finished" })
      .populate("homeTeam awayTeam prediction")
      .sort({ matchDateUtc: -1 })
      .limit(10)
      .lean();

    res.json(results);
  } catch (err) {
    console.error("API: Failed to fetch recent results:", err.message);
    res.status(500).json({ error: "Failed to fetch recent results" });
  }
};

// --- Single match summary (by matchId) ---
exports.getMatchSummary = async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId)
      .populate("homeTeam awayTeam prediction")
      .lean();

    if (!match) return res.status(404).json({ error: "Match not found" });

    const predictions = await Prediction.find({ matchId: match._id }).lean();
    match.predictions = bucketPredictions(predictions);

    res.json(match);
  } catch (err) {
    console.error("API: Failed to fetch match summary:", err.message);
    res.status(500).json({ error: "Failed to fetch match summary" });
  }
};

// --- Upcoming Matches with AI + stored predictions ---
exports.getUpcomingMatches = async (req, res) => {
  try {
    const upcoming = await Match.find({ status: { $in: ["scheduled", "upcoming", "tba"] } })
      .populate("homeTeam awayTeam")
      .sort({ matchDateUtc: 1 })
      .limit(20)
      .lean();

    const matchIds = upcoming.map(m => m._id);
    const storedPredictions = await Prediction.find({ matchId: { $in: matchIds } }).lean();

    const combinedMatches = await Promise.all(upcoming.map(async match => {
      const historicalMatches = await Match.find({
        $or: [
          { "homeTeam.name": match.homeTeam.name, "awayTeam.name": match.awayTeam.name },
          { "homeTeam.name": match.awayTeam.name, "awayTeam.name": match.homeTeam.name }
        ],
        status: "finished"
      }).lean();

      let aiPrediction = null;
      try {
        aiPrediction = await getPredictionFromAI(match, historicalMatches);
      } catch (err) {
        console.error(`AI prediction failed for match ${match._id}:`, err.message);
      }

      const matchStoredPredictions = storedPredictions.filter(p => p.matchId.toString() === match._id.toString());
      const allPredictions = aiPrediction ? [aiPrediction, ...matchStoredPredictions] : matchStoredPredictions;

      return { ...match, predictions: bucketPredictions(allPredictions) };
    }));

    res.json(combinedMatches);
  } catch (err) {
    console.error("API: Failed to fetch upcoming matches:", err.message);
    res.status(500).json({ error: "Failed to fetch upcoming matches" });
  }
};

// --- Recent Matches (latest 10 regardless of status) ---
exports.getRecentMatches = async (req, res) => {
  try {
    const recent = await Match.find({})
      .populate("homeTeam awayTeam prediction")
      .sort({ matchDateUtc: -1 })
      .limit(10)
      .lean();

    const matchIds = recent.map(m => m._id);
    const storedPredictions = await Prediction.find({ matchId: { $in: matchIds } }).lean();

    const combined = recent.map(match => {
      const matchPredictions = storedPredictions.filter(p => p.matchId.toString() === match._id.toString());
      return { ...match, predictions: bucketPredictions(matchPredictions) };
    });

    res.json(combined);
  } catch (err) {
    console.error("API: Failed to fetch recent matches:", err.message);
    res.status(500).json({ error: "Failed to fetch recent matches" });
  }
};

// --- CRON Triggers ---
exports.runFetchMatches = async (req, res) => {
  try {
    const result = await fetchAndStoreMatches();
    res.json({ success: true, message: "fetch-matches job started", result });
  } catch (err) {
    console.error("CRON API: Failed fetch-matches:", err.message);
    res.status(500).json({ error: "Failed to fetch matches" });
  }
};

exports.runGeneratePredictions = async (req, res) => {
  try {
    const result = await generateAllPredictions();
    res.json({ success: true, message: "generate-predictions job started", result });
  } catch (err) {
    console.error("CRON API: Failed generate-predictions:", err.message);
    res.status(500).json({ error: "Failed to generate predictions" });
  }
};

exports.runFetchResults = async (req, res) => {
  try {
    const result = await fetchAndStoreResults();
    res.json({ success: true, message: "fetch-results job started", result });
  } catch (err) {
    console.error("CRON API: Failed fetch-results:", err.message);
    res.status(500).json({ error: "Failed to fetch results" });
  }
};
