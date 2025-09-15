const Match = require('../models/Match');
const Prediction = require('../models/Prediction');
const { fetchAndStoreMatches, generateAllPredictions, fetchAndStoreResults } = require('../services/cronService');
const { getPredictionFromAI } = require('../services/aiService');

// --- Dashboard data (predictions grouped by buckets) ---
exports.getDashboardData = async (req, res) => {
  try {
    const buckets = ["vip", "daily2", "value5", "big10"];
    const data = {};

    for (const bucket of buckets) {
      data[bucket] = await Prediction.find({ bucket })
        .populate('matchId')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
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

    res.json(predictions);
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

    if (!match) {
      return res.status(404).json({ error: "Match not found" });
    }

    res.json(match);
  } catch (err) {
    console.error("API: Failed to fetch match summary:", err.message);
    res.status(500).json({ error: "Failed to fetch match summary" });
  }
};

// --- Upcoming Matches with AI predictions for all buckets ---
exports.getUpcomingMatches = async (req, res) => {
  try {
    const upcoming = await Match.find({ status: { $in: ["scheduled", "upcoming", "tba"] } })
      .populate("homeTeam awayTeam")
      .sort({ matchDateUtc: 1 })
      .limit(20)
      .lean();

    const historicalMatches = await Match.find({ status: "finished" })
      .populate("homeTeam awayTeam")
      .lean();

    const upcomingWithPredictions = await Promise.all(
      upcoming.map(async match => {
        const buckets = ["vip", "2odds", "5odds", "big10"];
        const predictionsByBucket = {};

        await Promise.all(
          buckets.map(async bucket => {
            try {
              const aiPrediction = await getPredictionFromAI(match, historicalMatches);
              if (aiPrediction.bucket === bucket) {
                predictionsByBucket[bucket] = aiPrediction;
              } else {
                predictionsByBucket[bucket] = null;
              }
            } catch (err) {
              console.error(`AI: Failed for match ${match._id} bucket ${bucket}: ${err.message}`);
              predictionsByBucket[bucket] = null;
            }
          })
        );

        return { ...match, predictions: predictionsByBucket };
      })
    );

    res.json(upcomingWithPredictions);
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

    res.json(recent);
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
