const Match = require('../models/Match');
const Prediction = require('../models/Prediction');
const { fetchAndStoreMatches, fetchAndStoreResults } = require('../services/cronService');
const { getPredictionsFromAI } = require('../services/aiService');

// --- Dashboard data (predictions grouped by buckets) ---
exports.getDashboardData = async (req, res) => {
  try {
    const buckets = ["vip", "daily2", "value5", "big10"];
    const data = {};

    for (const bucket of buckets) {
      const predictions = await Prediction.find({ bucket })
        .populate('matchId')
        .sort({ createdAt: -1 })
        .lean();

      const grouped = predictions.reduce((acc, p) => {
        const matchId = p.matchId._id.toString();
        if (!acc[matchId]) acc[matchId] = [];
        acc[matchId].push(p);
        return acc;
      }, {});

      data[bucket] = Object.values(grouped).map(group => group.slice(0, 5));
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
      .lean();

    const grouped = predictions.reduce((acc, p) => {
      const matchId = p.matchId._id.toString();
      if (!acc[matchId]) acc[matchId] = [];
      acc[matchId].push(p);
      return acc;
    }, {});

    res.json(Object.values(grouped));
  } catch (err) {
    console.error("API: Failed to fetch predictions:", err.message);
    res.status(500).json({ error: "Failed to fetch predictions" });
  }
};

// --- All Results (finished matches) with prediction outcomes ---
exports.getResults = async (req, res) => {
  try {
    const results = await Match.find({ status: "finished" })
      .populate("homeTeam awayTeam")
      .sort({ matchDateUtc: -1 })
      .limit(30)
      .lean();

    const predictions = await Prediction.find({ matchId: { $in: results.map(r => r._id) } }).lean();

    const resultsWithOutcome = results.map(match => {
      const matchPredictions = predictions.filter(p => p.matchId.toString() === match._id.toString());
      matchPredictions.forEach(p => {
        const predictedWinner = p.oneXTwo.home > p.oneXTwo.away ? "home" : p.oneXTwo.home < p.oneXTwo.away ? "away" : "draw";
        const actualWinner = match.homeGoals > match.awayGoals ? "home" : match.homeGoals < match.awayGoals ? "away" : "draw";
        p.outcome = predictedWinner === actualWinner ? "won" : "lost";
      });
      return { ...match, predictions: matchPredictions };
    });

    res.json(resultsWithOutcome);
  } catch (err) {
    console.error("API: Failed to fetch results:", err.message);
    res.status(500).json({ error: "Failed to fetch results" });
  }
};

// --- Recent Results (latest finished matches only) ---
exports.getRecentResults = async (req, res) => {
  try {
    const results = await Match.find({ status: "finished" })
      .populate("homeTeam awayTeam")
      .sort({ matchDateUtc: -1 })
      .limit(10)
      .lean();

    const predictions = await Prediction.find({ matchId: { $in: results.map(r => r._id) } }).lean();

    const resultsWithOutcome = results.map(match => {
      const matchPredictions = predictions.filter(p => p.matchId.toString() === match._id.toString());
      matchPredictions.forEach(p => {
        const predictedWinner = p.oneXTwo.home > p.oneXTwo.away ? "home" : p.oneXTwo.home < p.oneXTwo.away ? "away" : "draw";
        const actualWinner = match.homeGoals > match.awayGoals ? "home" : match.homeGoals < match.awayGoals ? "away" : "draw";
        p.outcome = predictedWinner === actualWinner ? "won" : "lost";
      });
      return { ...match, predictions: matchPredictions };
    });

    res.json(resultsWithOutcome);
  } catch (err) {
    console.error("API: Failed to fetch recent results:", err.message);
    res.status(500).json({ error: "Failed to fetch recent results" });
  }
};

// --- Single match summary (by matchId) ---
exports.getMatchSummary = async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId)
      .populate("homeTeam awayTeam")
      .lean();

    if (!match) return res.status(404).json({ error: "Match not found" });

    const predictions = await Prediction.find({ matchId: match._id }).lean();

    predictions.forEach(p => {
      if (match.status === "finished") {
        const predictedWinner = p.oneXTwo.home > p.oneXTwo.away ? "home" : p.oneXTwo.home < p.oneXTwo.away ? "away" : "draw";
        const actualWinner = match.homeGoals > match.awayGoals ? "home" : match.homeGoals < match.awayGoals ? "away" : "draw";
        p.outcome = predictedWinner === actualWinner ? "won" : "lost";
      }
    });

    res.json({ ...match, predictions });
  } catch (err) {
    console.error("API: Failed to fetch match summary:", err.message);
    res.status(500).json({ error: "Failed to fetch match summary" });
  }
};

// --- Upcoming Matches with AI predictions (multi-model, pre-save) ---
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
      upcoming.map(async (match) => {
        const predictions = await getPredictionsFromAI(match, historicalMatches);

        for (const p of predictions) {
          await Prediction.findOneAndUpdate(
            { matchId: match._id, bucket: p.bucket },
            { ...p, matchId: match._id },
            { upsert: true, new: true }
          );
        }

        return { ...match, predictions };
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
      .populate("homeTeam awayTeam")
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
    const upcoming = await Match.find({ status: { $in: ["scheduled", "upcoming", "tba"] } })
      .populate("homeTeam awayTeam")
      .sort({ matchDateUtc: 1 })
      .lean();

    const historicalMatches = await Match.find({ status: "finished" })
      .populate("homeTeam awayTeam")
      .lean();

    const allResults = [];
    for (const match of upcoming) {
      try {
        const predictions = await getPredictionsFromAI(match, historicalMatches);
        for (const p of predictions) {
          const saved = await Prediction.findOneAndUpdate(
            { matchId: match._id, bucket: p.bucket },
            { ...p, matchId: match._id },
            { upsert: true, new: true }
          );
          allResults.push(saved);
        }
      } catch (err) {
        console.error(`Failed AI prediction for match ${match._id}: ${err.message}`);
      }
    }

    res.json({ success: true, message: "generate-predictions job completed", resultCount: allResults.length });
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
