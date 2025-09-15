// controllers/dataController.js
const Match = require('../models/Match');
const Prediction = require('../models/Prediction');
const { fetchAndStoreMatches, generateAllPredictions, fetchAndStoreResults } = require('../services/cronService');
const { getPredictionsFromAI } = require('../services/aiService');

/* -------------------- Helpers -------------------- */
function getOneXTwo(pred) {
  if (!pred) return null;
  if (pred.outcomes?.oneXTwo) return pred.outcomes.oneXTwo;
  if (pred.oneXTwo) return pred.oneXTwo;
  if (pred.outcome?.oneXTwo) return pred.outcome.oneXTwo;
  return null;
}

function applyPredictionStatus(match, predictions) {
  if (match.status !== 'finished') return predictions;
  const actualWinner = match.homeGoals > match.awayGoals ? "home" : match.homeGoals < match.awayGoals ? "away" : "draw";
  predictions.forEach(p => {
    const oneXTwo = getOneXTwo(p);
    if (oneXTwo && !p.status) {
      const predictedWinner = oneXTwo.home > oneXTwo.away ? "home" : oneXTwo.home < oneXTwo.away ? "away" : "draw";
      p.status = predictedWinner === actualWinner ? "won" : "lost";
    }
  });
  return predictions;
}

function groupPredictionsByMatch(predictions) {
  return predictions.reduce((acc, p) => {
    const matchId = p.matchId?._id?.toString() || 'unknown';
    if (!acc[matchId]) acc[matchId] = [];
    acc[matchId].push(p);
    return acc;
  }, {});
}

/* -------------------- Dashboard -------------------- */
exports.getDashboardData = async (req, res) => {
  try {
    const buckets = ["vip", "daily2", "value5", "big10"];
    const data = {};

    for (const bucket of buckets) {
      const predictions = await Prediction.find({ bucket })
        .populate('matchId')
        .sort({ createdAt: -1 })
        .lean();

      const grouped = groupPredictionsByMatch(predictions);
      data[bucket] = Object.values(grouped).map(g => g.slice(0, 5));
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("API: Failed to fetch dashboard data:", err.message);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
};

/* -------------------- Predictions -------------------- */
exports.getPredictionsByBucket = async (req, res) => {
  try {
    const bucket = req.params.bucket;
    const predictions = await Prediction.find({ bucket })
      .populate('matchId')
      .sort({ createdAt: -1 })
      .lean();

    res.json(Object.values(groupPredictionsByMatch(predictions)));
  } catch (err) {
    console.error("API: Failed to fetch predictions:", err.message);
    res.status(500).json({ error: "Failed to fetch predictions" });
  }
};

/* -------------------- Results -------------------- */
async function fetchResultsWithPredictions(limit = 30) {
  const results = await Match.find({ status: "finished" })
    .populate("homeTeam awayTeam")
    .sort({ matchDateUtc: -1 })
    .limit(limit)
    .lean();

  const predictions = await Prediction.find({ matchId: { $in: results.map(r => r._id) } }).lean();

  return results.map(match => ({
    ...match,
    predictions: applyPredictionStatus(match, predictions.filter(p => p.matchId.toString() === match._id.toString()))
  }));
}

exports.getResults = async (req, res) => {
  try {
    const resultsWithOutcome = await fetchResultsWithPredictions(30);
    res.json(resultsWithOutcome);
  } catch (err) {
    console.error("API: Failed to fetch results:", err.message);
    res.status(500).json({ error: "Failed to fetch results" });
  }
};

exports.getRecentResults = async (req, res) => {
  try {
    const resultsWithOutcome = await fetchResultsWithPredictions(10);
    res.json(resultsWithOutcome);
  } catch (err) {
    console.error("API: Failed to fetch recent results:", err.message);
    res.status(500).json({ error: "Failed to fetch recent results" });
  }
};

exports.getMatchSummary = async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId)
      .populate("homeTeam awayTeam")
      .lean();
    if (!match) return res.status(404).json({ error: "Match not found" });

    const predictions = await Prediction.find({ matchId: match._id }).lean();
    res.json({ ...match, predictions: applyPredictionStatus(match, predictions) });
  } catch (err) {
    console.error("API: Failed to fetch match summary:", err.message);
    res.status(500).json({ error: "Failed to fetch match summary" });
  }
};

/* -------------------- Matches -------------------- */
exports.getUpcomingMatches = async (req, res) => {
  try {
    const upcoming = await Match.find({ status: { $in: ["scheduled", "upcoming", "tba"] } })
      .populate("homeTeam awayTeam")
      .sort({ matchDateUtc: 1 })
      .limit(20)
      .lean();

    const historical = await Match.find({ status: "finished" })
      .populate("homeTeam awayTeam")
      .lean();

    const upcomingWithPredictions = await Promise.all(upcoming.map(async match => {
      try {
        const predictions = await getPredictionsFromAI(match, historical);

        const savedPreds = [];
        for (const p of predictions) {
          const saved = await Prediction.findOneAndUpdate(
            { matchId: match._id, bucket: p.bucket },
            {
              matchId: match._id,
              version: 'ai-2x',
              outcomes: {
                oneXTwo: p.oneXTwo,
                doubleChance: p.doubleChance,
                over05: p.over05,
                over15: p.over15,
                over25: p.over25,
                bttsYes: p.bttsYes,
                bttsNo: p.bttsNo,
              },
              confidence: p.confidence,
              bucket: p.bucket,
              status: 'pending'
            },
            { upsert: true, new: true }
          );
          savedPreds.push(saved);
        }

        return { ...match, predictions: savedPreds };
      } catch (err) {
        console.warn(`API: AI predictions failed for match ${match._id}: ${err.message}`);
        const existing = await Prediction.find({ matchId: match._id }).lean();
        return { ...match, predictions: existing };
      }
    }));

    res.json(upcomingWithPredictions);
  } catch (err) {
    console.error("API: Failed to fetch upcoming matches:", err.message);
    res.status(500).json({ error: "Failed to fetch upcoming matches" });
  }
};

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

/* -------------------- History -------------------- */
exports.getMatchHistory = async (req, res) => {
  try {
    const { limit = 50, league } = req.query;
    const filter = { status: "finished" };
    if (league) filter.league = league;

    const matches = await Match.find(filter)
      .populate("homeTeam awayTeam")
      .sort({ matchDateUtc: -1 })
      .limit(parseInt(limit, 10))
      .lean();

    const predictions = await Prediction.find({ matchId: { $in: matches.map(m => m._id) } }).lean();

    const withPredictions = matches.map(match => ({
      ...match,
      predictions: applyPredictionStatus(
        match,
        predictions.filter(p => p.matchId.toString() === match._id.toString())
      )
    }));

    res.json(withPredictions);
  } catch (err) {
    console.error("API: Failed to fetch match history:", err.message);
    res.status(500).json({ error: "Failed to fetch match history" });
  }
};

/* -------------------- CRON -------------------- */
exports.runFetchMatches = async (req, res) => {
  try {
    const result = await fetchAndStoreMatches();
    res.json({ success: true, result });
  } catch (err) {
    console.error("CRON API: Failed fetch-matches:", err.message);
    res.status(500).json({ error: "Failed to fetch matches" });
  }
};

exports.runGeneratePredictions = async (req, res) => {
  try {
    const result = await generateAllPredictions();
    res.json({ success: true, result });
  } catch (err) {
    console.error("CRON API: Failed generate-predictions:", err.message);
    res.status(500).json({ error: "Failed to generate predictions" });
  }
};

exports.runFetchResults = async (req, res) => {
  try {
    const result = await fetchAndStoreResults();
    res.json({ success: true, result });
  } catch (err) {
    console.error("CRON API: Failed fetch-results:", err.message);
    res.status(500).json({ error: "Failed to fetch results" });
  }
};
