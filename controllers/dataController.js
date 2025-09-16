// controllers/dataController.js
const Match = require('../models/Match');
const Prediction = require('../models/Prediction');
const Team = require('../models/Team');
const { fetchAndStoreMatches, generateAllPredictions, fetchAndStoreResults } = require('../services/cronService');
const { getPredictionsFromAI } = require('../services/aiService');

/* -------------------- Helpers -------------------- */
function safeGet(obj, path, fallback = null) {
  try {
    return path.split('.').reduce((a, k) => (a && a[k] !== undefined ? a[k] : null), obj) ?? fallback;
  } catch {
    return fallback;
  }
}

function getOneXTwo(pred) {
  if (!pred) return null;
  if (pred.outcomes?.oneXTwo) return pred.outcomes.oneXTwo;
  if (pred.oneXTwo) return pred.oneXTwo;
  if (pred.outcome?.oneXTwo) return pred.outcome.oneXTwo;
  return null;
}

function applyPredictionStatus(match, predictions) {
  if (!match || match.status !== 'finished') return predictions;
  const homeGoals = match.homeGoals ?? safeGet(match, 'score.home');
  const awayGoals = match.awayGoals ?? safeGet(match, 'score.away');

  const actualWinner =
    homeGoals > awayGoals ? 'home' :
    homeGoals < awayGoals ? 'away' : 'draw';

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
    // p.matchId can be populated object or id
    const matchObj = p.matchId && typeof p.matchId === 'object' ? p.matchId : { _id: p.matchId };
    const matchId = (matchObj && matchObj._id) ? matchObj._id.toString() : 'unknown';
    if (!acc[matchId]) acc[matchId] = [];
    acc[matchId].push(p);
    return acc;
  }, {});
}

/* -------------------- Prediction utilities -------------------- */
function computeBestMarketFromOutcomes(outcomes = {}) {
  // Prefer doubleChance, then over15/25/05, then btts, then oneXTwo
  if (!outcomes) return { text: 'N/A', odds: 1.0 };

  // Double Chance
  if (outcomes.doubleChance) {
    const dc = outcomes.doubleChance;
    const options = [
      { key: 'homeOrDraw', label: 'Home or Draw', prob: dc.homeOrDraw },
      { key: 'homeOrAway', label: 'Home or Away', prob: dc.homeOrAway },
      { key: 'drawOrAway', label: 'Draw or Away', prob: dc.drawOrAway },
    ].filter(x => typeof x.prob === 'number' && x.prob > 0);

    if (options.length) {
      const best = options.reduce((a, b) => (a.prob >= b.prob ? a : b));
      return { text: `Double Chance — ${best.label}`, odds: +(1 / best.prob).toFixed(2), probability: best.prob };
    }
  }

  // Overs (prefer over1.5, then over2.5, then over0.5)
  if (typeof outcomes.over15 === 'number' && outcomes.over15 > 0) {
    return { text: 'Over 1.5', odds: +(1 / outcomes.over15).toFixed(2), probability: outcomes.over15 };
  }
  if (typeof outcomes.over25 === 'number' && outcomes.over25 > 0) {
    return { text: 'Over 2.5', odds: +(1 / outcomes.over25).toFixed(2), probability: outcomes.over25 };
  }
  if (typeof outcomes.over05 === 'number' && outcomes.over05 > 0) {
    return { text: 'Over 0.5', odds: +(1 / outcomes.over05).toFixed(2), probability: outcomes.over05 };
  }

  // BTTS
  if (typeof outcomes.bttsYes === 'number' && outcomes.bttsYes > 0) {
    return { text: 'BTTS — Yes', odds: +(1 / outcomes.bttsYes).toFixed(2), probability: outcomes.bttsYes };
  }
  if (typeof outcomes.bttsNo === 'number' && outcomes.bttsNo > 0) {
    return { text: 'BTTS — No', odds: +(1 / outcomes.bttsNo).toFixed(2), probability: outcomes.bttsNo };
  }

  // Fallback: oneXTwo
  if (outcomes.oneXTwo) {
    const { home = 0, draw = 0, away = 0 } = outcomes.oneXTwo;
    const max = Math.max(home, draw, away);
    if (max > 0) {
      const label = max === home ? 'Home Win' : max === away ? 'Away Win' : 'Draw';
      return { text: label, odds: +(1 / max).toFixed(2), probability: max };
    }
  }

  return { text: 'N/A', odds: 1.0 };
}

/* -------------------- Formatter -------------------- */
function formatPredictionDoc(p, matchContext = {}) {
  const outcomes = p.outcomes || {};
  const computed = computeBestMarketFromOutcomes(outcomes);

  return {
    _id: p._id,
    bucket: p.bucket,
    confidence: p.confidence ?? null,
    outcomes,
    status: p.status || 'pending',
    // textual prediction and odds (frontend uses prediction/odds)
    prediction: p.prediction || computed.text,
    odds: p.odds || computed.odds,
    // keep original fields for advanced UI
    is_vip: p.is_vip ?? (p.bucket === 'vip'),
    analysis: p.analysis || null,
  };
}

function formatMatch(match, predictions = []) {
  const homeTeam = match.homeTeam || {};
  const awayTeam = match.awayTeam || {};

  return {
    _id: match._id,
    league: match.league || match.leagueCode || match.competition || 'Unknown League',
    matchDateUtc: match.matchDateUtc,
    status: match.status,
    homeTeam: {
      _id: homeTeam._id ?? homeTeam.id ?? null,
      name: homeTeam.name ?? 'Home',
      logoUrl: homeTeam.logoUrl ?? homeTeam.logo ?? null
    },
    awayTeam: {
      _id: awayTeam._id ?? awayTeam.id ?? null,
      name: awayTeam.name ?? 'Away',
      logoUrl: awayTeam.logoUrl ?? awayTeam.logo ?? null
    },
    score: match.status === 'finished' ? (match.score ?? { home: match.homeGoals, away: match.awayGoals }) : null,
    predictions: (predictions || []).map(p => formatPredictionDoc(p, match)),
  };
}

/* -------------------- Dashboard -------------------- */
exports.getDashboardData = async (req, res) => {
  try {
    const buckets = ['vip', 'daily2', 'value5', 'big10'];
    const data = {};

    for (const bucket of buckets) {
      const predictions = await Prediction.find({ bucket })
        .populate({
          path: 'matchId',
          populate: ['homeTeam', 'awayTeam']
        })
        .sort({ createdAt: -1 })
        .lean();

      const grouped = groupPredictionsByMatch(predictions);
      data[bucket] = Object.values(grouped)
        .map(g => formatMatch(g[0].matchId, g))
        .slice(0, 5);
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('API: Failed to fetch dashboard data:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

/* -------------------- Predictions -------------------- */
exports.getPredictionsByBucket = async (req, res) => {
  try {
    const bucket = req.params.bucket;
    const predictions = await Prediction.find({ bucket })
      .populate({
        path: 'matchId',
        populate: ['homeTeam', 'awayTeam']
      })
      .sort({ createdAt: -1 })
      .lean();

    const grouped = groupPredictionsByMatch(predictions);
    const formatted = Object.values(grouped).map(g => formatMatch(g[0].matchId, g));

    // Return an array of matches (each with predictions array)
    res.json(formatted);
  } catch (err) {
    console.error('API: Failed to fetch predictions:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch predictions' });
  }
};

/* -------------------- Results -------------------- */
async function fetchResultsWithPredictions(limit = 30) {
  const results = await Match.find({ status: 'finished' })
    .populate('homeTeam awayTeam')
    .sort({ matchDateUtc: -1 })
    .limit(limit)
    .lean();

  const predictions = await Prediction.find({ matchId: { $in: results.map(r => r._id) } }).lean();

  return results.map(match => {
    const preds = applyPredictionStatus(match, predictions.filter(p => p.matchId.toString() === match._id.toString()));
    return formatMatch(match, preds);
  });
}

exports.getResults = async (req, res) => {
  try {
    const resultsWithOutcome = await fetchResultsWithPredictions(30);
    res.json(resultsWithOutcome);
  } catch (err) {
    console.error('API: Failed to fetch results:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
};

exports.getRecentResults = async (req, res) => {
  try {
    const resultsWithOutcome = await fetchResultsWithPredictions(10);
    res.json(resultsWithOutcome);
  } catch (err) {
    console.error('API: Failed to fetch recent results:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch recent results' });
  }
};

exports.getMatchSummary = async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId)
      .populate('homeTeam awayTeam')
      .lean();
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const predictions = await Prediction.find({ matchId: match._id }).lean();
    res.json(formatMatch(match, applyPredictionStatus(match, predictions)));
  } catch (err) {
    console.error('API: Failed to fetch match summary:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch match summary' });
  }
};

/* -------------------- Matches -------------------- */
exports.getUpcomingMatches = async (req, res) => {
  try {
    // Strict 24h window from "now"
    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const upcoming = await Match.find({
      matchDateUtc: { $gte: now, $lte: next24h },
      status: { $in: ['scheduled', 'upcoming', 'tba'] }
    })
      .populate('homeTeam awayTeam')
      .sort({ matchDateUtc: 1 })
      .lean();

    // load historical finished matches for AI context
    const historical = await Match.find({ status: 'finished' }).populate('homeTeam awayTeam').lean();

    const upcomingWithPredictions = await Promise.all(upcoming.map(async match => {
      // fetch existing predictions for this match
      const existing = await Prediction.find({ matchId: match._id }).lean();

      if (existing && existing.length) {
        // format existing predictions
        return formatMatch(match, existing);
      }

      // else call AI to produce predictions (if enabled)
      try {
        const aiPreds = await getPredictionsFromAI(match, historical); // array
        const savedPreds = [];
        for (const p of aiPreds) {
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
                bttsNo: p.bttsNo
              },
              confidence: p.confidence,
              bucket: p.bucket,
              status: 'pending'
            },
            { upsert: true, new: true }
          );
          savedPreds.push(saved);
        }
        return formatMatch(match, savedPreds);
      } catch (err) {
        console.warn(`API: AI predictions failed for ${match._id}:`, err.message || err);
        // return match with empty predictions if AI fails
        return formatMatch(match, []);
      }
    }));

    res.json(upcomingWithPredictions);
  } catch (err) {
    console.error('API: Failed to fetch upcoming matches:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch upcoming matches' });
  }
};

exports.getRecentMatches = async (req, res) => {
  try {
    const recent = await Match.find({})
      .populate('homeTeam awayTeam')
      .sort({ matchDateUtc: -1 })
      .limit(10)
      .lean();

    res.json(recent.map(m => formatMatch(m)));
  } catch (err) {
    console.error('API: Failed to fetch recent matches:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch recent matches' });
  }
};

/* -------------------- History -------------------- */
exports.getMatchHistory = async (req, res) => {
  try {
    const { limit = 50, league } = req.query;
    const filter = { status: 'finished' };
    if (league) filter.league = league;

    const matches = await Match.find(filter)
      .populate('homeTeam awayTeam')
      .sort({ matchDateUtc: -1 })
      .limit(parseInt(limit, 10))
      .lean();

    const predictions = await Prediction.find({ matchId: { $in: matches.map(m => m._id) } }).lean();

    const withPredictions = matches.map(match =>
      formatMatch(
        match,
        applyPredictionStatus(match, predictions.filter(p => p.matchId.toString() === match._id.toString()))
      )
    );

    res.json(withPredictions);
  } catch (err) {
    console.error('API: Failed to fetch match history:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch match history' });
  }
};

/* -------------------- CRON -------------------- */
exports.runFetchMatches = async (req, res) => {
  try {
    const result = await fetchAndStoreMatches();
    res.json({ success: true, result });
  } catch (err) {
    console.error('CRON API: Failed fetch-matches:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
};

exports.runGeneratePredictions = async (req, res) => {
  try {
    const result = await generateAllPredictions();
    res.json({ success: true, result });
  } catch (err) {
    console.error('CRON API: Failed generate-predictions:', err.message || err);
    res.status(500).json({ error: 'Failed to generate predictions' });
  }
};

exports.runFetchResults = async (req, res) => {
  try {
    const result = await fetchAndStoreResults();
    res.json({ success: true, result });
  } catch (err) {
    console.error('CRON API: Failed fetch-results:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
};
