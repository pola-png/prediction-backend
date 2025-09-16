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
    team = await Team.create({ name, logoUrl });
  } else if (logoUrl && !team.logoUrl) {
    team.logoUrl = logoUrl;
    await team.save();
  }
  return team;
}

function tryParseDate(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// Example primary fetch (SoccersAPI) - simplified; keep fallback logic
async function fetchFromSoccersAPI() {
  let newMatchesCount = 0;
  const { SOCCERSAPI_USER, SOCCERSAPI_TOKEN } = process.env;
  if (!SOCCERSAPI_USER || !SOCCERSAPI_TOKEN) {
    throw new Error('SoccersAPI credentials not found.');
  }
  const today = new Date().toISOString().split('T')[0];
  const url = `https://api.soccersapi.com/v2.2/fixtures/?user=${SOCCERSAPI_USER}&token=${SOCCERSAPI_TOKEN}&t=schedule&d=${today}`;

  const response = await axios.get(url, { timeout: 15000 });
  const liveMatches = response.data?.data || [];

  for (const md of liveMatches) {
    try {
      const homeName = md.home_name || md.home?.name || md.home?.team_name;
      const awayName = md.away_name || md.away?.name || md.away?.team_name;
      if (!md.id || !homeName || !awayName) continue;

      const externalId = `soccersapi-${md.id}`;
      const exists = await Match.findOne({ externalId });
      if (exists) continue;

      const homeTeam = await getOrCreateTeam(homeName, md.home?.logo);
      const awayTeam = await getOrCreateTeam(awayName, md.away?.logo);
      if (!homeTeam || !awayTeam) continue;

      const matchDate = tryParseDate(md.utcDate, md.matchDateUtc, `${md.date}T${md.time}`) || new Date();

      await Match.create({
        source: 'soccersapi',
        externalId,
        leagueCode: md.league_id || md.league || null,
        leagueName: md.league_name || md.country || null,
        matchDateUtc: matchDate,
        status: 'scheduled',
        homeTeam: homeTeam._id,
        awayTeam: awayTeam._id,
      });

      newMatchesCount++;
    } catch (err) {
      console.warn('CRON: skip soccersapi match err', err.message || err);
    }
  }

  return { newMatchesCount };
}

// Fallback example (OpenLiga)
async function fetchFromOpenLigaDB() {
  let newMatchesCount = 0;
  let updatedMatchesCount = 0;
  const leagueShortcuts = ['bl1', 'bl2'];

  for (const league of leagueShortcuts) {
    const url = `https://api.openligadb.de/getmatchdata/${league}`;
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
                updatedAt: lastUpdate,
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
          leagueCode: league,
          leagueName: md.leagueName || null,
          matchDateUtc: matchDate,
          status: md.matchIsFinished ? 'finished' : 'scheduled',
          homeTeam: homeTeam._id,
          awayTeam: awayTeam._id,
          homeGoals,
          awayGoals,
          updatedAt: lastUpdate,
        });

        newMatchesCount++;
      } catch (err) {
        console.warn('CRON: skip openligadb match err', err.message || err);
      }
    }
  }

  return { newMatchesCount, updatedMatchesCount };
}

// Combined fetch
async function fetchAndStoreMatches() {
  let newMatchesCount = 0;
  let updatedMatchesCount = 0;

  try {
    const primary = await fetchFromSoccersAPI();
    newMatchesCount += primary.newMatchesCount;
  } catch (err) {
    console.error('CRON: SoccersAPI failed:', err.message || err);
    try {
      const fallback = await fetchFromOpenLigaDB();
      newMatchesCount += fallback.newMatchesCount;
      updatedMatchesCount += fallback.updatedMatchesCount || 0;
    } catch (fallbackErr) {
      console.error('CRON: OpenLigaDB fallback failed:', fallbackErr.message || fallbackErr);
    }
  }

  return { newMatchesCount, updatedMatchesCount };
}

// Generate predictions (only next 24 hours)
async function generateAllPredictions() {
  let processedCount = 0;
  const now = new Date();
  const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Fetch upcoming matches within next 24 hours
  const upcoming = await Match.find({
    status: { $in: ['scheduled', 'upcoming', 'tba'] },
    matchDateUtc: { $gte: now, $lte: cutoff },
  }).populate('homeTeam awayTeam').limit(200).lean();

  if (!upcoming.length) return { processedCount: 0 };

  // historical for H2H
  const historical = await Match.find({ status: 'finished' }).populate('homeTeam awayTeam').lean();

  for (const match of upcoming) {
    try {
      if (!match.homeTeam || !match.awayTeam) continue;
      // request AI predictions (minConfidence 90 by default)
      const aiPredictions = await getPredictionsFromAI(match, historical, 90);
      for (const p of aiPredictions) {
        await Prediction.findOneAndUpdate(
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
            status: 'pending',
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

module.exports = {
  fetchAndStoreMatches,
  generateAllPredictions,
};
