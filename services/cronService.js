// src/services/cronService.js
// Robust cron helpers: fetch matches (primary + fallback), generate predictions, fetch results

const axios = require('axios');
const Match = require('../models/Match');
const Team = require('../models/Team');
const Prediction = require('../models/Prediction');
const { getPredictionFromAI } = require('./aiService');

// --- Helpers ---

async function getOrCreateTeam(name) {
  if (!name) return null;
  let team = await Team.findOne({ name });
  if (!team) {
    team = await Team.create({ name });
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
    // handle date + time string like "2025-09-15" + "20:30"
    if (typeof c === 'string' && c.includes(' ') && !isNaN(new Date(c).getTime())) {
      const d2 = new Date(c);
      if (!isNaN(d2.getTime())) return d2;
    }
  }
  return null;
}

// --- Primary source: SoccersAPI (free plan possible limitations) ---
async function fetchFromSoccersAPI() {
  let newMatchesCount = 0;
  const { SOCCERSAPI_USER, SOCCERSAPI_TOKEN } = process.env;
  if (!SOCCERSAPI_USER || !SOCCERSAPI_TOKEN) {
    throw new Error('SoccersAPI credentials not found.');
  }

  const today = new Date().toISOString().split('T')[0];
  const url = `https://api.soccersapi.com/v2.2/fixtures/?user=${SOCCERSAPI_USER}&token=${SOCCERSAPI_TOKEN}&t=schedule&d=${today}`;

  console.log(`CRON: Fetching matches for ${today} from SoccersAPI.`);
  const response = await axios.get(url, { timeout: 15_000 });
  const liveMatches = response.data?.data || [];
  console.log(`CRON: Found ${liveMatches.length} matches from SoccersAPI.`);

  for (const matchData of liveMatches) {
    try {
      // tolerate multiple field naming variations
      const homeName = matchData.home_name || matchData.home?.name || matchData.home?.team_name;
      const awayName = matchData.away_name || matchData.away?.name || matchData.away?.team_name;
      if (!matchData.id || !homeName || !awayName) continue;

      const externalId = `soccersapi-${matchData.id}`;
      const existingMatch = await Match.findOne({ externalId });
      if (existingMatch) continue;

      const homeTeam = await getOrCreateTeam(homeName);
      const awayTeam = await getOrCreateTeam(awayName);
      if (!homeTeam || !awayTeam) continue;

      const matchDate =
        tryParseDate(
          matchData.date && matchData.time ? `${matchData.date}T${matchData.time}` : null,
          matchData.time?.starting_at?.date_time,
          matchData.starting_at?.date_time,
          matchData.matchDateUtc,
          matchData.utcDate
        ) || new Date();

      await Match.create({
        source: 'soccersapi',
        externalId,
        leagueCode: matchData.league_name || matchData.league || null,
        matchDateUtc: matchDate,
        status: 'scheduled',
        homeTeam: homeTeam._id,
        awayTeam: awayTeam._id,
      });

      newMatchesCount++;
    } catch (err) {
      console.warn('CRON: Skipped a SoccersAPI match due to error:', err?.message || err);
    }
  }

  return { newMatchesCount };
}

// --- Fallback source: OpenLigaDB ---
async function fetchFromOpenLigaDB() {
  let newMatchesCount = 0;
  let updatedMatchesCount = 0;
  const leagueShortcuts = ['bl1', 'bl2'];
  const currentSeason = getCurrentSeason();

  for (const league of leagueShortcuts) {
    const url = `https://api.openligadb.de/getmatchdata/${league}/${currentSeason}`;
    console.log(`CRON: Fetching matches for ${league} season ${currentSeason} from OpenLigaDB.`);

    const openLigaRes = await axios.get(url, { timeout: 15000 });
    const liveMatches = openLigaRes.data || [];
    console.log(`CRON: Found ${liveMatches.length} matches for ${league} from OpenLigaDB.`);

    for (const matchData of liveMatches) {
      try {
        if (!matchData.matchID || !matchData.team1?.teamName || !matchData.team2?.teamName) continue;

        const externalId = `openliga-${matchData.matchID}`;
        const existingMatch = await Match.findOne({ externalId });

        const lastUpdateDate =
          tryParseDate(matchData.lastUpdateDateTimeUTC, matchData.matchDateTimeUTC) || new Date();

        if (existingMatch) {
          const existingLastUpdate = new Date(existingMatch.updatedAt || 0);
          if (lastUpdateDate > existingLastUpdate) {
            const homeGoals = (matchData.matchResults || []).find(r => r.resultName === 'Endergebnis')?.pointsTeam1 ?? null;
            const awayGoals = (matchData.matchResults || []).find(r => r.resultName === 'Endergebnis')?.pointsTeam2 ?? null;

            await Match.updateOne({ _id: existingMatch._id }, {
              $set: {
                status: matchData.matchIsFinished ? 'finished' : 'scheduled',
                homeGoals,
                awayGoals,
                updatedAt: lastUpdateDate,
              }
            });
            updatedMatchesCount++;
          }
          continue;
        }

        const homeTeam = await getOrCreateTeam(matchData.team1.teamName);
        const awayTeam = await getOrCreateTeam(matchData.team2.teamName);
        if (!homeTeam || !awayTeam) continue;

        const homeGoalsOnCreate = (matchData.matchResults || []).find(r => r.resultName === 'Endergebnis')?.pointsTeam1 ?? null;
        const awayGoalsOnCreate = (matchData.matchResults || []).find(r => r.resultName === 'Endergebnis')?.pointsTeam2 ?? null;
        const matchDate = tryParseDate(matchData.matchDateTimeUTC) || new Date();

        await Match.create({
          source: 'openligadb',
          externalId,
          leagueCode: matchData.leagueName || null,
          matchDateUtc: matchDate,
          status: matchData.matchIsFinished ? 'finished' : 'scheduled',
          homeTeam: homeTeam._id,
          awayTeam: awayTeam._id,
          homeGoals: homeGoalsOnCreate,
          awayGoals: awayGoalsOnCreate,
          updatedAt: lastUpdateDate,
        });

        newMatchesCount++;
      } catch (err) {
        console.warn('CRON: Skipped an OpenLigaDB match due to error:', err?.message || err);
      }
    }
  }

  return { newMatchesCount, updatedMatchesCount };
}

// --- Combined fetch: primary + fallback + historical JSON ---
async function fetchAndStoreMatches() {
  let newMatchesCount = 0;
  let updatedMatchesCount = 0;
  let newHistoryCount = 0;

  try {
    console.log('CRON: Attempting primary source: SoccersAPI');
    const result = await fetchFromSoccersAPI();
    newMatchesCount += result.newMatchesCount;
  } catch (err) {
    console.error('CRON: Primary SoccersAPI failed:', err?.message || err);
    console.log('CRON: Falling back to OpenLigaDB');
    try {
      const fallback = await fetchFromOpenLigaDB();
      newMatchesCount += fallback.newMatchesCount;
      updatedMatchesCount += fallback.updatedMatchesCount || 0;
    } catch (fallbackErr) {
      console.error('CRON: OpenLigaDB fallback failed:', fallbackErr?.message || fallbackErr);
    }
  }

  if (process.env.FOOTBALL_JSON_URL) {
    try {
      console.log('CRON: Fetching historical matches from football.json');
      const fallbackRes = await axios.get(process.env.FOOTBALL_JSON_URL, { timeout: 15000 });
      const history = fallbackRes.data?.matches || [];
      console.log(`CRON: Found ${history.length} historical matches.`);

      for (const matchData of history) {
        try {
          if (!matchData.team1 || !matchData.team2 || !matchData.date) continue;
          const externalId = `footballjson-${matchData.date}-${matchData.team1}-${matchData.team2}`;
          const existingMatch = await Match.findOne({ externalId });
          if (existingMatch) continue;

          const homeTeam = await getOrCreateTeam(matchData.team1);
          const awayTeam = await getOrCreateTeam(matchData.team2);
          if (!homeTeam || !awayTeam) continue;

          const homeGoals = matchData.score?.ft?.[0] ?? null;
          const awayGoals = matchData.score?.ft?.[1] ?? null;
          const matchDate = tryParseDate(matchData.date) || new Date(matchData.date);

          await Match.create({
            source: 'footballjson',
            externalId,
            leagueCode: matchData.league || 'history',
            matchDateUtc: matchDate,
            status: 'finished',
            homeTeam: homeTeam._id,
            awayTeam: awayTeam._id,
            homeGoals,
            awayGoals,
          });
          newHistoryCount++;
        } catch (err) {
          console.warn('CRON: Skipped a football.json historical match due to error:', err?.message || err);
        }
      }
    } catch (err) {
      console.error('CRON: Error fetching football.json:', err?.message || err);
    }
  }

  return { newMatchesCount, updatedMatchesCount, newHistoryCount };
}

// --- Generate Predictions (non-blocking/robust) ---
async function generateAllPredictions() {
  let processedCount = 0;

  const upcomingMatches = await Match.find({
    status: { $in: ['scheduled', 'upcoming', 'tba'] },
    matchDateUtc: { $gte: new Date() },
    prediction: { $exists: false }
  }).populate('homeTeam awayTeam').limit(25).lean();

  if (!upcomingMatches.length) {
    console.log('CRON: No new matches require predictions.');
    return { processedCount: 0 };
  }

  const historicalMatches = await Match.find({ status: 'finished' }).populate('homeTeam awayTeam').lean();

  for (const match of upcomingMatches) {
    try {
      if (!match.homeTeam || !match.awayTeam) {
        console.warn(`CRON: Skipping prediction for ${match._id} due to missing teams.`);
        continue;
      }

      const predictionResult = await getPredictionFromAI(match, historicalMatches);
      if (!predictionResult) {
        console.warn(`CRON: AI returned no prediction for match ${match._id}`);
        continue;
      }

      // Store prediction document with both detailed 'outcomes' and convenient top-level fields
      const predictionDoc = new Prediction({
        matchId: match._id,
        outcomes: predictionResult,
        prediction: predictionResult.prediction ?? predictionResult.outcome ?? null,
        odds: typeof predictionResult.odds === 'number' ? predictionResult.odds : (predictionResult.oddsValue ?? null),
        confidence: predictionResult.confidence ?? null,
        bucket: predictionResult.bucket ?? null,
        version: '1.5-flash'
      });

      await predictionDoc.save();
      await Match.updateOne({ _id: match._id }, { $set: { prediction: predictionDoc._id } });

      processedCount++;
      console.log(`CRON: Generated prediction for ${match.homeTeam?.name} vs ${match.awayTeam?.name}`);
    } catch (err) {
      console.error(`CRON: Prediction generation failed for match ${match._id}:`, err?.message || err);
    }
  }

  return { processedCount };
}

// --- Fetch results (OpenLigaDB) ---
async function fetchAndStoreResults() {
  let updatedCount = 0;

  const matchesToCheck = await Match.find({
    status: 'scheduled',
    matchDateUtc: { $lt: new Date() },
    source: 'openligadb'
  });

  if (!matchesToCheck.length) {
    console.log('CRON: No results to fetch from OpenLigaDB.');
    return { updatedCount };
  }

  console.log(`CRON: Checking results for ${matchesToCheck.length} OpenLigaDB matches.`);

  for (const match of matchesToCheck) {
    try {
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
              updatedAt: new Date(),
            }
          });
          updatedCount++;
          console.log(`CRON: Updated result for ${match.externalId}`);
        }
      }
    } catch (err) {
      console.warn(`CRON: Failed to fetch result for ${match.externalId}:`, err?.message || err);
    }
  }

  return { updatedCount };
}

module.exports = {
  fetchAndStoreMatches,
  generateAllPredictions,
  fetchAndStoreResults,
};
