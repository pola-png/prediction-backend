// controllers/dataController.js
const Match = require('../models/Match');
const Prediction = require('../models/Prediction');
const Team = require('../models/Team');

// Helper: format team
function formatTeam(team) {
  if (!team) return null;
  return {
    id: team._id ? team._id.toString() : team.id || null,
    name: team.name || null,
    logo: team.logoUrl || null,
  };
}

// Format a match for frontend
function formatMatch(match, preds = []) {
  return {
    id: match._id ? match._id.toString() : match.id,
    date: match.matchDateUtc || match.matchDate || null,
    matchDateUtc: match.matchDateUtc ? match.matchDateUtc.toISOString() : match.matchDateUtc || null,
    status: match.status || 'scheduled',
    league: match.leagueName || match.leagueCode || 'Unknown League',
    homeTeam: match.homeTeam ? { id: match.homeTeam._id?.toString() || match.homeTeam.id, name: match.homeTeam.name, logo: match.homeTeam.logoUrl || null } : null,
    awayTeam: match.awayTeam ? { id: match.awayTeam._id?.toString() || match.awayTeam.id, name: match.awayTeam.name, logo: match.awayTeam.logoUrl || null } : null,
    score: match.homeGoals != null && match.awayGoals != null ? { home: match.homeGoals, away: match.awayGoals } : (match.score || null),
    predictions: (preds || []).map(p => ({
      id: p._id ? p._id.toString() : p.id,
      bucket: p.bucket,
      confidence: p.confidence,
      outcomes: p.outcomes,
      status: p.status || 'pending',
    })),
  };
}

/* -------------------- Predictions by bucket -------------------- */
exports.getPredictionsByBucket = async (req, res) => {
  try {
    const bucket = req.params.bucket;
    const predictions = await Prediction.find({ bucket })
      .populate({
        path: 'matchId',
        populate: [{ path: 'homeTeam' }, { path: 'awayTeam' }]
      })
      .sort({ createdAt: -1 })
      .lean();

    // Group by match
    const grouped = predictions.reduce((acc, p) => {
      const mid = p.matchId?._id?.toString() || (p.matchId && p.matchId.toString()) || 'unknown';
      acc[mid] = acc[mid] || [];
      acc[mid].push(p);
      return acc;
    }, {});

    const formatted = Object.values(grouped).map(g => formatMatch(g[0].matchId, g));
    res.json(formatted);
  } catch (err) {
    console.error('API: Failed to fetch predictions:', err.message);
    res.status(500).json({ error: 'Failed to fetch predictions' });
  }
};

/* -------------------- Results -------------------- */
async function applyPredictionStatus(match, predictions) {
  if (!match || match.status !== 'finished') return predictions;
  const actualWinner =
    match.homeGoals > match.awayGoals ? 'home' :
    match.homeGoals < match.awayGoals ? 'away' : 'draw';

  return predictions.map(p => {
    // derive predicted winner if oneXTwo exists
    const oneXTwo = p.outcomes?.oneXTwo;
    if (oneXTwo && !p.status) {
      const predictedWinner =
        oneXTwo.home > oneXTwo.away ? 'home' :
        oneXTwo.home < oneXTwo.away ? 'away' : 'draw';
      p.status = predictedWinner === actualWinner ? 'won' : 'lost';
    }
    return p;
  });
}

async function fetchResultsWithPredictions(limit = 30) {
  const results = await Match.find({ status: 'finished' })
    .populate('homeTeam awayTeam')
    .sort({ matchDateUtc: -1 })
    .limit(limit)
    .lean();

  const predictions = await Prediction.find({ matchId: { $in: results.map(r => r._id) } }).lean();

  return results.map(match => {
    const preds = predictions.filter(p => p.matchId.toString() === match._id.toString());
    const evaluated = preds.length ? applyPredictionStatus(match, preds) : [];
    return formatMatch(match, evaluated);
  });
}

exports.getResults = async (req, res) => {
  try {
    const results = await fetchResultsWithPredictions(30);
    res.json(results);
  } catch (err) {
    console.error('API: Failed to fetch results:', err.message);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
};

/* -------------------- Upcoming Matches (next 24h) -------------------- */
exports.getUpcomingMatches = async (req, res) => {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const upcoming = await Match.find({
      status: { $in: ['scheduled', 'upcoming', 'tba'] },
      matchDateUtc: { $gte: now, $lte: cutoff },
    })
      .populate('homeTeam awayTeam')
      .sort({ matchDateUtc: 1 })
      .limit(200)
      .lean();

    // get any existing predictions for these matches
    const predictions = await Prediction.find({ matchId: { $in: upcoming.map(m => m._id) } }).lean();

    const result = upcoming.map(m => {
      const preds = predictions.filter(p => p.matchId.toString() === m._id.toString());
      return formatMatch(m, preds);
    });

    res.json(result);
  } catch (err) {
    console.error('API: Failed to fetch upcoming matches:', err.message);
    res.status(500).json({ error: 'Failed to fetch upcoming matches' });
  }
};

/* -------------------- Match summary -------------------- */
exports.getMatchSummary = async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId).populate('homeTeam awayTeam').lean();
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const preds = await Prediction.find({ matchId: match._id }).lean();
    res.json(formatMatch(match, preds));
  } catch (err) {
    console.error('API: Failed to fetch match summary:', err.message);
    res.status(500).json({ error: 'Failed to fetch match summary' });
  }
};
