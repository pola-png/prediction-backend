const Match = require('../models/Match');
const Prediction = require('../models/Prediction');
const Team = require('../models/Team');
const Player = require('../models/Player'); // Assuming you have a Player model
const {
  fetchAndStoreUpcomingMatches,
  importHistoryFromUrl,
  generateAllPredictions
} = require('../services/cronService');

/* ---------------- Helpers ---------------- */

function getOneXTwo(pred) {
  if (!pred) return null;
  if (pred.outcomes?.oneXTwo) return pred.outcomes.oneXTwo;
  if (pred.oneXTwo) return pred.oneXTwo;
  if (pred.outcome?.oneXTwo) return pred.outcome.oneXTwo;
  return null;
}

function calculateWinner(match) {
  if (!match || match.status !== 'finished') return null;
  // Use FT first, then ET, then Pen if tie
  const homeScore = match.ft_score ?? match.homeGoals ?? 0;
  const awayScore = match.ft_score_away ?? match.awayGoals ?? 0;

  if (homeScore > awayScore) return 'home';
  if (homeScore < awayScore) return 'away';

  const etHome = match.et_score ?? 0;
  const etAway = match.et_score_away ?? 0;
  if (etHome > etAway) return 'home';
  if (etHome < etAway) return 'away';

  const penHome = match.pen_score ?? 0;
  const penAway = match.pen_score_away ?? 0;
  if (penHome > penAway) return 'home';
  if (penHome < penAway) return 'away';

  return 'draw';
}

function applyPredictionStatus(match, predictions) {
  const actualWinner = calculateWinner(match);
  if (!actualWinner) return predictions;

  return predictions.map(p => {
    const oneXTwo = getOneXTwo(p);
    if (oneXTwo && !p.status) {
      const predictedWinner =
        oneXTwo.home > oneXTwo.away ? 'home' :
        oneXTwo.home < oneXTwo.away ? 'away' : 'draw';
      p.status = predictedWinner === actualWinner ? 'won' : 'lost';
    }
    return p;
  });
}

function groupPredictionsByMatch(predictions) {
  return predictions.reduce((acc, p) => {
    const matchIdKey = (p.matchId && (p.matchId._id || p.matchId)) ? String(p.matchId._id || p.matchId) : 'unknown';
    if (!acc[matchIdKey]) acc[matchIdKey] = [];
    acc[matchIdKey].push(p);
    return acc;
  }, {});
}

function safeTeamObj(team) {
  if (!team) return null;
  if (typeof team === 'object' && (team._id || team.id)) {
    return {
      id: String(team._id || team.id),
      name: team.name || 'Unknown',
      logo: team.logoUrl || team.logo || null
    };
  }
  return { id: String(team), name: 'Unknown', logo: null };
}

function formatMatch(match, predictions = []) {
  const home = match.homeTeam ? safeTeamObj(match.homeTeam) : null;
  const away = match.awayTeam ? safeTeamObj(match.awayTeam) : null;
  const matchDate = match.matchDateUtc || match.date || match.matchDate || null;

  return {
    id: String(match._id || match.id),
    static_id: match.static_id || null,
    league: match.league || match.leagueCode || null,
    season: match.season || null,
    date: matchDate ? new Date(matchDate).toISOString() : null,
    matchDateUtc: matchDate ? new Date(matchDate).toISOString() : null,
    status: match.status || 'scheduled',
    venue: match.venue || null,
    venue_id: match.venue_id || null,
    groupId: match.groupId || null,
    homeTeam: home,
    awayTeam: away,
    score: match.status === 'finished' ? {
      ft: { home: match.ft_score ?? match.homeGoals, away: match.ft_score_away ?? match.awayGoals },
      et: { home: match.et_score ?? null, away: match.et_score_away ?? null },
      pen: { home: match.pen_score ?? null, away: match.pen_score_away ?? null }
    } : null,
    predictions: (predictions || []).map(p => ({
      id: String(p._id || p.id),
      bucket: p.bucket,
      confidence: p.confidence,
      outcomes: p.outcomes,
      status: p.status || 'pending'
    }))
  };
}

/* ---------------- Dashboard ---------------- */
exports.getDashboardData = async (req, res) => {
  try {
    const buckets = ["vip", "daily2", "value5", "big10"];
    const data = {};

    for (const bucket of buckets) {
      const predictions = await Prediction.find({ bucket })
        .populate({ path: "matchId", populate: ["homeTeam", "awayTeam"] })
        .sort({ createdAt: -1 })
        .lean();

      const grouped = groupPredictionsByMatch(predictions);
      data[bucket] = Object.values(grouped).map(g => {
        const matchObj = g[0].matchId || {};
        return formatMatch(matchObj, g);
      }).slice(0, 5);
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("API: Failed to fetch dashboard data:", err.message || err);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
};

/* ---------------- Predictions ---------------- */
exports.getPredictionsByBucket = async (req, res) => {
  try {
    const bucket = req.params.bucket;
    const predictions = await Prediction.find({ bucket })
      .populate({ path: "matchId", populate: ["homeTeam", "awayTeam"] })
      .sort({ createdAt: -1 })
      .lean();

    const grouped = groupPredictionsByMatch(predictions);
    const formatted = Object.values(grouped).map(g => formatMatch(g[0].matchId || {}, g));
    res.json(formatted);
  } catch (err) {
    console.error("API: Failed to fetch predictions:", err.message || err);
    res.status(500).json({ error: "Failed to fetch predictions" });
  }
};

/* ---------------- Results ---------------- */
async function fetchResultsWithPredictions(limit = 30) {
  const results = await Match.find({ status: "finished" })
    .populate("homeTeam awayTeam")
    .sort({ matchDateUtc: -1 })
    .limit(limit)
    .lean();

  const predictions = await Prediction.find({ matchId: { $in: results.map(r => r._id) } }).lean();

  return results.map(match => {
    const preds = applyPredictionStatus(match, predictions.filter(p => String(p.matchId) === String(match._id)));
    return formatMatch(match, preds);
  });
}

exports.getResults = async (req, res) => {
  try {
    const resultsWithOutcome = await fetchResultsWithPredictions(30);
    res.json(resultsWithOutcome);
  } catch (err) {
    console.error("API: Failed to fetch results:", err.message || err);
    res.status(500).json({ error: "Failed to fetch results" });
  }
};

exports.getRecentResults = async (req, res) => {
  try {
    const resultsWithOutcome = await fetchResultsWithPredictions(10);
    res.json(resultsWithOutcome);
  } catch (err) {
    console.error("API: Failed to fetch recent results:", err.message || err);
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
    const withStatus = applyPredictionStatus(match, predictions);
    res.json(formatMatch(match, withStatus));
  } catch (err) {
    console.error("API: Failed to fetch match summary:", err.message || err);
    res.status(500).json({ error: "Failed to fetch match summary" });
  }
};

/* ---------------- Matches ---------------- */
exports.getUpcomingMatches = async (req, res) => {
  try {
    const now = new Date();
    const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const upcoming = await Match.find({
      status: { $in: ["scheduled", "upcoming", "tba"] },
      matchDateUtc: { $gte: now, $lte: until }
    })
      .populate("homeTeam awayTeam")
      .sort({ matchDateUtc: 1 })
      .limit(50)
      .lean();

    const matchIds = upcoming.map(m => m._id);
    const predictions = await Prediction.find({ matchId: { $in: matchIds } }).lean();

    const out = upcoming.map(match => {
      const preds = predictions.filter(p => String(p.matchId) === String(match._id));
      return formatMatch(match, preds);
    });

    res.json(out);
  } catch (err) {
    console.error("API: Failed to fetch upcoming matches:", err.message || err);
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

    res.json(recent.map(m => formatMatch(m)));
  } catch (err) {
    console.error("API: Failed to fetch recent matches:", err.message || err);
    res.status(500).json({ error: "Failed to fetch recent matches" });
  }
};

/* ---------------- History ---------------- */
exports.getMatchHistory = async (req, res) => {
  try {
    const { limit = 50, league, season } = req.query;
    const filter = { status: "finished" };
    if (league) filter.league = league;
    if (season) filter.season = season;

    const matches = await Match.find(filter)
      .populate("homeTeam awayTeam")
      .sort({ matchDateUtc: -1 })
      .limit(parseInt(limit, 10))
      .lean();

    const predictions = await Prediction.find({ matchId: { $in: matches.map(m => m._id) } }).lean();
    const withPreds = matches.map(match => formatMatch(match, applyPredictionStatus(match, predictions.filter(p => String(p.matchId) === String(match._id)))));
    res.json(withPreds);
  } catch (err) {
    console.error("API: Failed to fetch match history:", err.message || err);
    res.status(500).json({ error: "Failed to fetch match history" });
  }
};

/* ---------------- Lineups & Player Stats ---------------- */
exports.getMatchLineups = async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId)
      .populate({
        path: "homeTeam awayTeam",
        populate: { path: "players" }
      }).lean();
    if (!match) return res.status(404).json({ error: "Match not found" });

    res.json({
      home: match.homeTeam.players || [],
      away: match.awayTeam.players || []
    });
  } catch (err) {
    console.error("API: Failed to fetch match lineups:", err.message || err);
    res.status(500).json({ error: "Failed to fetch match lineups" });
  }
};

exports.getTeamPlayers = async (req, res) => {
  try {
    const team = await Team.findById(req.params.teamId)
      .populate("players")
      .lean();
    if (!team) return res.status(404).json({ error: "Team not found" });

    res.json(team.players || []);
  } catch (err) {
    console.error("API: Failed to fetch team players:", err.message || err);
    res.status(500).json({ error: "Failed to fetch team players" });
  }
};
