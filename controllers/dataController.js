const Match = require('../models/Match');
const Team = require('../models/Team');
const Prediction = require('../models/Prediction');
const { fetchAndStoreMatches, generateAllPredictions, fetchAndStoreResults } = require('../services/cronService');
const { getSummaryFromAI } = require('../services/aiService');


// --- Frontend API Methods ---

exports.getDashboardData = async (req, res) => {
    try {
        const upcomingMatches = await Match.find({
            status: { $in: ['scheduled', 'upcoming', 'tba'] },
            prediction: { $exists: true }
        })
        .sort({ matchDateUtc: 1 })
        .limit(5)
        .populate('homeTeam awayTeam prediction')
        .lean();

        const recentResults = await Match.find({ status: 'finished' })
        .sort({ matchDateUtc: -1 })
        .limit(5)
        .populate('homeTeam awayTeam prediction')
        .lean();
        
        const buckets = ['vip', '2odds', '5odds', 'big10'];
        const bucketCounts = {};
        for (const bucket of buckets) {
            const matches = await Match.find({ status: { $in: ['scheduled', 'upcoming', 'tba'] } })
                .populate({
                    path: 'prediction',
                    match: { bucket: bucket }
                });
            const filteredMatches = matches.filter(m => m.prediction);
            bucketCounts[bucket] = filteredMatches.length;
        }

        res.json({ upcomingMatches, recentResults, bucketCounts });
    } catch (error) {
        console.error("API: Error fetching dashboard data:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

exports.getPredictionsByBucket = async (req, res) => {
    try {
        const { bucket } = req.params;
        const matches = await Match.find({ status: { $in: ['scheduled', 'upcoming', 'tba'] } })
            .populate({
                path: 'prediction',
                match: { bucket }
            })
            .populate('homeTeam awayTeam')
            .sort({ 'prediction.confidence': -1, matchDateUtc: 1 })
            .limit(20)
            .lean();

        const filteredMatches = matches.filter(m => m.prediction);
        res.json(filteredMatches);
    } catch (error) {
        console.error(`API: Error fetching predictions for bucket ${req.params.bucket}:`, error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

exports.getRecentResults = async (req, res) => {
    try {
        const matches = await Match.find({ status: 'finished' })
            .sort({ matchDateUtc: -1 })
            .limit(50)
            .populate('homeTeam awayTeam prediction')
            .lean();
        res.json(matches);
    } catch (error) {
        console.error("API: Error fetching recent results:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

exports.getMatchSummary = async (req, res) => {
    try {
        const { matchId } = req.params;
        const match = await Match.findById(matchId)
            .populate('prediction homeTeam awayTeam')
            .lean();

        if (!match || !match.prediction) {
            return res.status(404).json({ error: "Prediction not found for this match." });
        }
        if (!match.homeTeam || !match.awayTeam) {
            return res.status(404).json({ error: 'Could not load team details for summary.' });
        }

        const summary = await getSummaryFromAI(match);
        res.json({ summary });
    } catch (error)
        {
        console.error("API: Failed to fetch match summary", error);
        res.status(500).json({ error: `Could not load AI summary. ${error.message}` });
    }
};


// --- CRON JOB CONTROLLERS ---

const checkCronToken = (req, res, next) => {
  const token = req.query.token || req.headers['authorization'];
  const cronToken = `Bearer ${process.env.CRON_TOKEN}`;

  if (!token || token !== cronToken) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
};

exports.runFetchMatches = [
  checkCronToken,
  async (req, res) => {
    console.log('CRON: Triggered job: fetch-matches');

    // ✅ Respond immediately
    res.status(202).json({ success: true, message: 'fetch-matches job started' });

    // 🔄 Run in background
    fetchAndStoreMatches()
      .then(result => {
        console.log(
          `CRON: Job 'fetch-matches' complete. New: ${result.newMatchesCount}, History: ${result.newHistoryCount}`
        );
      })
      .catch(error => {
        console.error("CRON: Job 'fetch-matches' failed:", error);
      });
  },
];

exports.runGeneratePredictions = [
  checkCronToken,
  async (req, res) => {
    console.log('CRON: Triggered job: generate-predictions');

    res.status(202).json({ success: true, message: 'generate-predictions job started' });

    generateAllPredictions()
      .then(result => {
        console.log(`CRON: Job 'generate-predictions' complete. Processed: ${result.processedCount}`);
      })
      .catch(error => {
        console.error("CRON: Job 'generate-predictions' failed:", error);
      });
  },
];

exports.runFetchResults = [
  checkCronToken,
  async (req, res) => {
    console.log('CRON: Triggered job: fetch-results');

    res.status(202).json({ success: true, message: 'fetch-results job started' });

    fetchAndStoreResults()
      .then(result => {
        console.log(`CRON: Job 'fetch-results' complete. Updated: ${result.updatedCount}`);
      })
      .catch(error => {
        console.error("CRON: Job 'fetch-results' failed:", error);
      });
  },
];