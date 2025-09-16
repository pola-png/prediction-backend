// services/cronService.js
const axios = require('axios');
const Match = require('../models/Match');
const Team = require('../models/Team');
const Prediction = require('../models/Prediction');
const { getPredictionsFromAI } = require('./aiService');

// Helpers
async function getOrCreateTeam(name, logoUrl = null) {
  if (!name) return null;
  let team = await Team.findOne({ name });
  if (!team) {
    team = await Team.create({ name, logo: logoUrl || null });
  } else {
    // update missing logo if we now have one
    if (!team.logo && logoUrl) {
      team.logo = logoUrl;
      await team.save();
    }
  }
  return team;
}

function getCurrentSeason() {
  const today = new Date();
  return today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
}

function tryParseDate(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/* -------------------- External providers -------------------- */

// Example: SoccersAPI (structure varies; be defensive)
async function fetchFromSoccersAPI() {
  let newMatchesCount = 0;
  const { SOCCERSAPI_USER, SOCCERSAPI_TOKEN } = process.env;
  if (!SOCCERSAPI_USER || !SOCCERSAPI_TOKEN) {
    throw new Error('SoccersAPI credentials not found.');
  }

  const today = new Date().toISOString().split('T')[0];
  const url = `https://api.soccersapi.com/v2.2/fixtures/?user=${SOCCERSAPI_USER}&token=${SOCCERSAPI_TOKEN}&t=schedule&d=${today}`;

  const response = await axios.get(url, { timeout: 15000 });
  const fixtures = response.data?.data || [];

  for (const md of fixtures) {
    try {
      const homeName = md.home_name || md.home?.name || md.home?.team_name;
      const awayName = md.away_name || md.away?.name || md.away?.team_name;
      if (!md.id || !homeName || !awayName) continue;

      const externalId = `soccersapi-${md.id}`;
      const exists = await Match.findOne({ externalId });
      if (exists) continue;

      const homeLogo = md.home?.logo || md.home?.image || null;
      const awayLogo = md.away?.logo || md.away?.image || null;

      const homeTeam = await getOrCreateTeam(homeName, homeLogo);
      const awayTeam = await getOrCreateTeam(awayName, awayLogo);
      if (!homeTeam || !awayTeam) continue;

      const matchDate = tryParseDate(md.date && md.time ? `${md.date}T${md.time}` : null, md.utcDate, md.matchDateUtc) || new Date();

      await Match.create({
        source: 'soccersapi',
        externalId,
        league: md.league_name || md.league || null,
        matchDateUtc: matchDate,
        status: 'scheduled',
        homeTeam: homeTeam._id,
        awayTeam: awayTeam._id
      });

      newMatchesCount++;
    } catch (err) {
      console.warn('CRON: skip soccersapi match err', err.message || err);
    }
  }
  return { newMatchesCount };
}

// OpenLigaDB (fallback)
async function fetchFromOpenLigaDB() {
  let newMatchesCount = 0;
  let updatedMatchesCount = 0;
  const leagueShortcuts = ['bl1', 'bl2']; // expand as needed
  const season = getCurrentSeason();

  for (const league of leagueShortcuts) {
    const url = `https://api.openligadb.de/getmatchdata/${league}/${season}`;
    const res = await axios.get(url, { timeout: 15000 });
    const liveMatches = res.data || [];

    for (const md of liveMatches) {
      try {
        if (!md.matchID || !md.team1?.teamName || !md.team2?.teamName) continue;
        const externalId = `openliga-${md.matchID}`;
        const existing = await Match.findOne({ externalId });
        const lastUpdate = tryParseDate(md.lastUpdateDateTimeUTC, md.matchDateTimeUTC) || new Date();

        if (existing) {
          const existingUpdated = new Date(existing.updatedAt || 0);
          if (lastUpdate > existingUpdated) {
            const homeGoals = (md.matchResults || []).find(r => r.resultName === 'Endergebnis')?.pointsTeam1 ?? null;
            const awayGoals = (md.matchResults || []).find(r => r.resultName === 'Endergebnis')?.pointsTeam2 ?? null;

            await Match.updateOne({ _id: existing._id }, {
              $set: {
                status: md.matchIsFinished ? 'finished' : 'scheduled',
                homeGoals,
                awayGoals,
                updatedAt: lastUpdate
              }
            });
            updatedMatchesCount++;
          }
          continue;
        }

        const homeTeam = await getOrCreateTeam(md.team1.teamName, md.team1.teamIconUrl);
        const awayTeam = await getOrCreateTeam(md.team2.teamName, md.team2.teamIconUrl);
        if (!homeTeam || !awayTeam) continue;

        const homeGoals = (md.matchResults || []).find(r => r.resultName === 'Endergebnis')?.pointsTeam1 ?? null;
        const awayGoals = (md.matchResults || []).find(r => r.resultName === 'Endergebnis')?.pointsTeam2 ?? null;
        const matchDate = tryParseDate(md.matchDateTimeUTC) || new Date();

        await Match.create({
          source: 'openligadb',
          externalId,
          league: md.leagueName || null,
          matchDateUtc: matchDate,
          status: md.matchIsFinished ? 'finished' : 'scheduled',
          homeTeam: homeTeam._id,
          awayTeam: awayTeam._id,
          homeGoals,
          awayGoals,
          updatedAt: lastUpdate
        });

        newMatchesCount++;
      } catch (err) {
        console.warn('CRON: skip openligadb match err', err.message || err);
      }
    }
  }

  return { newMatchesCount, updatedMatchesCount };
}

/* Combined fetch (primary + fallback + optional history) */
async function fetchAndStoreMatches() {
  let newMatchesCount = 0;
  let updatedMatchesCount = 0;
  let newHistoryCount = 0;

  try {
    const primary = await fetchFromSoccersAPI();
    newMatchesCount += primary.newMatchesCount;
  } catch (err) {
    console.error('CRON: SoccersAPI failed:', err.message || err);
    try {
      const fallback = await fetchFromOpenLigaDB();
      newMatchesCount += fallback.newMatchesCount || 0;
      updatedMatchesCount += fallback.updatedMatchesCount || 0;
    } catch (fallbackErr) {
      console.error('CRON: OpenLigaDB fallback failed:', fallbackErr.message || fallbackErr);
    }
  }

  // Optional: import history from static football JSON
  if (process.env.FOOTBALL_JSON_URL) {
    try {
      const res = await axios.get(process.env.FOOTBALL_JSON_URL, { timeout: 15000 });
      const history = res.data?.matches || [];
      for (const md of history) {
        try {
          if (!md.team1 || !md.team2 || !md.date) continue;
          const externalId = `footballjson-${md.date}-${md.team1}-${md.team2}`;
          const exists = await Match.findOne({ externalId });
          if (exists) continue;

          const homeTeam = await getOrCreateTeam(md.team1, md.homeLogo || null);
          const awayTeam = await getOrCreateTeam(md.team2, md.awayLogo || null);
          if (!homeTeam || !awayTeam) continue;

          const homeGoals = md.score?.ft?.[0] ?? null;
          const awayGoals = md.score?.ft?.[1] ?? null;
          const matchDate = tryParseDate(md.date) || new Date(md.date);

          await Match.create({
            source: 'footballjson',
            externalId,
            league: md.league || 'history',
            matchDateUtc: matchDate,
            status: 'finished',
            homeTeam: homeTeam._id,
            awayTeam: awayTeam._id,
            homeGoals,
            awayGoals
          });
          newHistoryCount++;
        } catch (err) {
          console.warn('CRON: skip history match err', err.message || err);
        }
      }
    } catch (err) {
      console.warn('CRON: fetching football.json failed:', err.message || err);
    }
  }

  return { newMatchesCount, updatedMatchesCount, newHistoryCount };
}

/* Evaluate predictions for finished match and mark won/lost */
async function evaluatePredictionsForMatch(match) {
  if (!match || match.status !== 'finished') return;
  const predictions = await Prediction.find({ matchId: match._id });
  if (!predictions.length) return;

  const actualWinner = (match.homeGoals > match.awayGoals) ? 'home' :
                       (match.homeGoals < match.awayGoals) ? 'away' : 'draw';

  for (const p of predictions) {
    const predictedWinner = (p.outcomes?.oneXTwo?.home > p.outcomes?.oneXTwo?.away) ? 'home' :
                            (p.outcomes?.oneXTwo?.home < p.outcomes?.oneXTwo?.away) ? 'away' : 'draw';
    const newStatus = (predictedWinner === actualWinner) ? 'won' : 'lost';
    if (p.status !== newStatus) {
      p.status = newStatus;
      await p.save();
    }
  }
}

/* Generate predictions for upcoming matches (only next 24 hours) */
async function generateAllPredictions() {
  let processedCount = 0;

  const now = new Date();
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const upcoming = await Match.find({
    status: { $in: ['scheduled', 'upcoming', 'tba'] },
    matchDateUtc: { $gte: now, $lte: next24h }
  }).populate('homeTeam awayTeam').limit(50).lean();

  if (!upcoming.length) return { processedCount: 0 };

  const historical = await Match.find({ status: 'finished' }).populate('homeTeam awayTeam').lean();

  for (const match of upcoming) {
    try {
      if (!match.homeTeam || !match.awayTeam) continue;
      const aiPredictions = await getPredictionsFromAI(match, historical);
      for (const p of aiPredictions) {
        const doc = await Prediction.findOneAndUpdate(
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
        processedCount++;
      }
    } catch (err) {
      console.error(`CRON: prediction fail for match ${match._id}:`, err.message || err);
    }
  }

  return { processedCount };
}

/* Fetch results and evaluate predictions */
async function fetchAndStoreResults() {
  let updatedCount = 0;

  // Find scheduled matches whose date is now in the past (finished)
  const matchesToCheck = await Match.find({
    status: 'scheduled',
    matchDateUtc: { $lt: new Date() }
  });

  if (!matchesToCheck.length) return { updatedCount };

  for (const match of matchesToCheck) {
    try {
      // Basic attempt: if we have an externalId and it's openliga, try fetching its updated data
      if (match.source === 'openligadb' && match.externalId) {
        const openLigaId = (match.externalId || '').replace('openliga-', '');
        if (!openLigaId) continue;

        const res = await axios.get(`https://api.openligadb.de/getmatchdata/${openLigaId}`, { timeout: 10000 });
        const matchResult = res.data;

        if (matchResult?.matchIsFinished) {
          const homeGoals = (matchResult.matchResults || []).find(r => r.resultName === 'Endergebnis')?.pointsTeam1 ?? null;
          const awayGoals = (matchResult.matchResults || []).find(r => r.resultName === 'Endergebnis')?.pointsTeam2 ?? null;

          if (homeGoals !== null && awayGoals !== null) {
            await Match.updateOne({ _id: match._id }, {
              $set: {
                status: 'finished',
                homeGoals,
                awayGoals,
                updatedAt: new Date()
              }
            });

            const finished = await Match.findById(match._id).lean();
            await evaluatePredictionsForMatch(finished);
            updatedCount++;
          }
        }
      }
      // If other sources -> you can add fetch logic here
    } catch (err) {
      console.warn(`CRON: failed to fetch result for ${match.externalId}:`, err.message || err);
    }
  }

  return { updatedCount };
}

module.exports = {
  fetchAndStoreMatches,
  generateAllPredictions,
  fetchAndStoreResults,
  evaluatePredictionsForMatch
};
