// controllers/dataController.js
const Match = require('../models/Match');
const Prediction = require('../models/Prediction');
const Team = require('../models/Team');
const { fetchAndStoreMatches, generateAllPredictions, fetchAndStoreResults } = require('../services/cronService');
const { getPredictionsFromAI } = require('../services/aiService');

/* -------------------- Helpers -------------------- */
function getOneXTwoFromOutcomes(outcomes) {
  if (!outcomes) return null;
  return outcomes.oneXTwo || outcomes['one_x_two'] || null;
}
function getDoubleChanceFromOutcomes(outcomes) {
  if (!outcomes) return null;
  return outcomes.doubleChance || outcomes.double_chance || null;
}
function getOverFromOutcomes(outcomes, key = 'over05') {
  if (!outcomes) return null;
  return outcomes[key];
}

function groupPredictionsByMatch(predictions) {
  return predictions.reduce((acc, p) => {
    const matchObj = p.matchId;
    const matchId = (matchObj && (matchObj._id || matchObj.id)) ? (matchObj._id ? matchObj._id.toString() : matchObj.id.toString()) : (p.matchId ? p.matchId.toString() : 'unknown');
    if (!acc[matchId]) acc[matchId] = [];
    acc[matchId].push(p);
    return acc;
  }, {});
}

function normalizeTeam(teamObj) {
  if (!teamObj) return null;
  const id = teamObj._id ? teamObj._id.toString() : (teamObj.id || null);
  const logoUrl = teamObj.logoUrl ?? teamObj.logo ?? null;
  return { id, name: teamObj.name || 'Unknown', logoUrl };
}

function formatPredictionForResponse(p) {
  return {
    id: p._id ? p._id.toString() : (p.id || null),
    bucket: p.bucket,
    confidence: p.confidence,
    outcomes: p.outcomes || p,
    status: p.status || 'pending'
  };
}

function formatMatch(match, predictions = []) {
  const homeTeam = normalizeTeam(match.homeTeam);
  const awayTeam = normalizeTeam(match.awayTeam);
  const league = match.league || match.competition || 'Unknown League';
  const matchDateUtc = match.matchDateUtc || match.date || null;

  const score = (match.status === 'finished') ? (
    typeof match.homeGoals !== 'undefined' || typeof match.awayGoals !== 'undefined'
      ? { home: match.homeGoals, away: match.awayGoals }
      : match.score || null
  ) : null;

  return {
    id: match._id ? match._id.toString() : (match.id || null),
    date: matchDateUtc,
    matchDateUtc,
    league,
    status: match.status,
    homeTeam,
    awayTeam,
    score,
    predictions: (predictions || []).map(formatPredictionForResponse)
  };
}

/* -------------------- Utility: prob -> decimal odds -------------------- */
function probToDecimalOdds(p) {
  // p is probability from 0..1; protect against 0
  const prob = Number(p) || 0;
  if (prob <= 0) return Infinity; // avoid division by zero
  return +(1 / prob);
}

/* -------------------- Dashboard -------------------- */
exports.getDashboardData = async (req, res) => {
  try {
    const buckets = ['vip', 'daily2', 'value5', 'big10'];
    const data = {};
    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    for (const bucket of buckets) {
      const predictions = await Prediction.find({ bucket })
        .populate({
          path: 'matchId',
          populate: ['homeTeam', 'awayTeam']
        })
        .sort({ createdAt: -1 })
        .lean();

      const filtered = predictions.filter(p => {
        const m = p.matchId;
        if (!m) return false;
        const md = new Date(m.matchDateUtc || m.date || m.utcDate || null);
        if (isNaN(md)) return false;
        if (md < now || md > next24h) return false;
        const status = m.status || 'scheduled';
        return ['scheduled', 'upcoming', 'tba'].includes(status);
      });

      const grouped = groupPredictionsByMatch(filtered);
      data[bucket] = Object.values(grouped).map(g => formatMatch(g[0].matchId, g)).slice(0, 5);
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('API: Failed to fetch dashboard data:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

/* -------------------- Predictions -------------------- */
exports.getPredictionsByBucket = async (req, res) => {
  try {
    const bucket = req.params.bucket;
    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const predictions = await Prediction.find({ bucket })
      .populate({
        path: 'matchId',
        populate: ['homeTeam', 'awayTeam']
      })
      .sort({ createdAt: -1 })
      .lean();

    const filtered = predictions.filter(p => {
      const m = p.matchId;
      if (!m) return false;
      const md = new Date(m.matchDateUtc || m.date || m.utcDate || null);
      if (isNaN(md)) return false;
      if (md < now || md > next24h) return false;
      const status = m.status || 'scheduled';
      return ['scheduled', 'upcoming', 'tba'].includes(status);
    });

    const grouped = groupPredictionsByMatch(filtered);
    const formatted = Object.values(grouped).map(g => formatMatch(g[0].matchId, g));

    res.json(formatted);
  } catch (err) {
    console.error('API: Failed to fetch predictions:', err);
    res.status(500).json({ error: 'Failed to fetch predictions' });
  }
};

/* -------------------- New: Accumulators -------------------- */
/**
 * GET /api/accumulators/:bucket
 * Returns suggested accumulator cards (3,4,6) built from predictions in next 24h.
 * Rules:
 *  - Prefer doubleChance outcomes (homeOrDraw/homeOrAway/drawOrAway).
 *  - If no double chance, fall back to over05, bttsYes, or oneXTwo top picks.
 *  - Use prediction.confidence thresholds optionally.
 *  - Compute decimal odds as product(1/prob).
 */
exports.getAccumulatorsByBucket = async (req, res) => {
  try {
    const bucket = req.params.bucket;
    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // fetch predictions and populate matches and teams
    const predictions = await Prediction.find({ bucket })
      .populate({ path: 'matchId', populate: ['homeTeam', 'awayTeam'] })
      .lean();

    // keep only predictions for matches in next 24 hours and scheduled
    const filtered = predictions.filter(p => {
      const m = p.matchId;
      if (!m) return false;
      const md = new Date(m.matchDateUtc || m.date || null);
      if (isNaN(md)) return false;
      if (md < now || md > next24h) return false;
      const status = m.status || 'scheduled';
      return ['scheduled', 'upcoming', 'tba'].includes(status);
    });

    // For each match, choose a best outcome (pref doubleChance), compute odds
    const choices = filtered.map(p => {
      const m = p.matchId;
      const doubleChance = getDoubleChanceFromOutcomes(p.outcomes);
      const oneXTwo = getOneXTwoFromOutcomes(p.outcomes);
      const over05 = getOverFromOutcomes(p.outcomes, 'over05');
      const bttsYes = getOverFromOutcomes(p.outcomes, 'bttsYes');

      // chooser prefers doubleChance -> over05 -> bttsYes -> oneXTwo
      let chosen = null;
      if (doubleChance) {
        // choose the highest double chance probability and label
        const pairs = [
          ['homeOrDraw', doubleChance.homeOrDraw],
          ['homeOrAway', doubleChance.homeOrAway],
          ['drawOrAway', doubleChance.drawOrAway]
        ];
        pairs.sort((a,b)=> (b[1]||0)- (a[1]||0));
        chosen = { type: 'doubleChance', label: pairs[0][0], prob: pairs[0][1] || 0 };
      } else if (over05) {
        chosen = { type: 'over05', label: 'Over 0.5', prob: over05 };
      } else if (bttsYes) {
        chosen = { type: 'bttsYes', label: 'BTTS Yes', prob: bttsYes };
      } else if (oneXTwo) {
        const pairs = [['home', oneXTwo.home], ['draw', oneXTwo.draw], ['away', oneXTwo.away]];
        pairs.sort((a,b)=> (b[1]||0)-(a[1]||0));
        chosen = { type: 'oneXTwo', label: pairs[0][0], prob: pairs[0][1] || 0 };
      } else {
        chosen = { type: 'unknown', label: 'unknown', prob: 0 };
      }

      const decimalOdds = chosen.prob > 0 ? +(1 / chosen.prob) : Infinity;

      return {
        predictionId: p._id ? p._id.toString() : p.id || null,
        match: formatMatch(m, [p]),
        chosen,
        decimalOdds,
        confidence: p.confidence || 0
      };
    });

    // Build accumulator groups of sizes 3,4,6: simple greedy combinations
    // Filter choices with finite odds
    const viable = choices.filter(c => isFinite(c.decimalOdds) && c.decimalOdds > 1 && c.match && c.match.id);

    // sort by confidence desc
    viable.sort((a,b) => (b.confidence||0) - (a.confidence||0));

    const makeGroups = (size) => {
      const groups = [];
      // naive grouping: slide over sorted list to create non-overlapping groups but we'll allow overlapping to present more options.
      for (let i = 0; i < viable.length; i++) {
        const group = viable.slice(i, i + size);
        if (group.length === size) {
          const totalOdds = +(group.reduce((acc, g) => acc * g.decimalOdds, 1));
          groups.push({
            size,
            picks: group.map(g => ({
              matchId: g.match.id,
              league: g.match.league,
              homeTeam: g.match.homeTeam,
              awayTeam: g.match.awayTeam,
              pick: g.chosen,
              odds: +(g.decimalOdds.toFixed(2)),
              confidence: g.confidence
            })),
            totalOdds: +totalOdds.toFixed(2)
          });
        }
      }
      // keep top 12 groups by totalOdds or confidence
      return groups.slice(0, 12);
    };

    const accum3 = makeGroups(3);
    const accum4 = makeGroups(4);
    const accum6 = makeGroups(6);

    res.json({ success: true, accumulators: { accum3, accum4, accum6 } });
  } catch (err) {
    console.error('API: Failed to build accumulators:', err);
    res.status(500).json({ error: 'Failed to build accumulators' });
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
    const preds = predictions.filter(p => p.matchId && p.matchId.toString() === match._id.toString());
    const scored = preds.map(p => p); // keep as-is, apply status elsewhere
    return formatMatch(match, scored);
  });
}

exports.getResults = async (req, res) => {
  try {
    const resultsWithOutcome = await fetchResultsWithPredictions(30);
    res.json(resultsWithOutcome);
  } catch (err) {
    console.error('API: Failed to fetch results:', err);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
};

exports.getRecentResults = async (req, res) => {
  try {
    const resultsWithOutcome = await fetchResultsWithPredictions(10);
    res.json(resultsWithOutcome);
  } catch (err) {
    console.error('API: Failed to fetch recent results:', err);
    res.status(500).json({ error: 'Failed to fetch recent results' });
  }
};

exports.getMatchSummary = async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId).populate('homeTeam awayTeam').lean();
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const predictions = await Prediction.find({ matchId: match._id }).lean();
    res.json(formatMatch(match, predictions));
  } catch (err) {
    console.error('API: Failed to fetch match summary:', err);
    res.status(500).json({ error: 'Failed to fetch match summary' });
  }
};

/* -------------------- Matches (24 hours) -------------------- */
exports.getUpcomingMatches = async (req, res) => {
  try {
    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const upcoming = await Match.find({
      status: { $in: ['scheduled','upcoming','tba'] },
      matchDateUtc: { $gte: now.toISOString(), $lte: next24h.toISOString() }
    })
      .populate('homeTeam awayTeam')
      .sort({ matchDateUtc: 1 })
      .limit(50)
      .lean();

    const historical = await Match.find({ status: 'finished' }).populate('homeTeam awayTeam').lean();

    const upcomingWithPredictions = await Promise.all(upcoming.map(async match => {
      try {
        const predsFromAI = await getPredictionsFromAI(match, historical);
        const savedPreds = [];
        for (const p of predsFromAI) {
          const saved = await Prediction.findOneAndUpdate(
            { matchId: match._id, bucket: p.bucket },
            {
              matchId: match._id,
              version: 'ai-2x',
              outcomes: p.outcomes || p,
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
        console.warn(`AI prediction failed for match ${match._id}:`, err);
        const existing = await Prediction.find({ matchId: match._id }).lean();
        return formatMatch(match, existing);
      }
    }));

    res.json(upcomingWithPredictions);
  } catch (err) {
    console.error('API: Failed to fetch upcoming matches:', err);
    res.status(500).json({ error: 'Failed to fetch upcoming matches' });
  }
};

/* -------------------- Other endpoints left unchanged -------------------- */
exports.getRecentMatches = async (req, res) => {
  try {
    const recent = await Match.find({}).populate('homeTeam awayTeam').sort({ matchDateUtc: -1 }).limit(10).lean();
    res.json(recent.map(m => formatMatch(m)));
  } catch (err) {
    console.error('API: Failed to fetch recent matches:', err);
    res.status(500).json({ error: 'Failed to fetch recent matches' });
  }
};

/* -------------------- History -------------------- */
exports.getMatchHistory = async (req, res) => {
  try {
    const { limit = 50, league } = req.query;
    const filter = { status: 'finished' };
    if (league) filter.league = league;

    const matches = await Match.find(filter).populate('homeTeam awayTeam').sort({ matchDateUtc: -1 }).limit(parseInt(limit,10)).lean();
    const predictions = await Prediction.find({ matchId: { $in: matches.map(m => m._id) } }).lean();
    const withPredictions = matches.map(match => formatMatch(match, predictions.filter(p => p.matchId && p.matchId.toString() === match._id.toString())));
    res.json(withPredictions);
  } catch (err) {
    console.error('API: Failed to fetch match history:', err);
    res.status(500).json({ error: 'Failed to fetch match history' });
  }
};

/* -------------------- CRON -------------------- */
exports.runFetchMatches = async (req, res) => {
  try {
    const result = await fetchAndStoreMatches();
    res.json({ success: true, result });
  } catch (err) {
    console.error('CRON API: Failed fetch-matches:', err);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
};

exports.runGeneratePredictions = async (req, res) => {
  try {
    const result = await generateAllPredictions();
    res.json({ success: true, result });
  } catch (err) {
    console.error('CRON API: Failed generate-predictions:', err);
    res.status(500).json({ error: 'Failed to generate predictions' });
  }
};

exports.runFetchResults = async (req, res) => {
  try {
    const result = await fetchAndStoreResults();
    res.json({ success: true, result });
  } catch (err) {
    console.error('CRON API: Failed fetch-results:', err);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
};
