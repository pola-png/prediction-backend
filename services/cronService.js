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

function isWithinNext24Hours(date) {
  if (!date) return false;
  const now = new Date();
  const limit = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return date >= now && date <= limit;
}

// SoccersAPI
async function fetchFromSoccersAPI() {
  let newMatchesCount = 0;
  const { SOCCERSAPI_USER, SOCCERSAPI_TOKEN } = process.env;
  if (!SOCCERSAPI_USER || !SOCCERSAPI_TOKEN) {
    throw new Error('SoccersAPI credentials not found.');
  }
  const today = new Date().toISOString().split('T')[0];
  const url = `https://api.soccersapi.com/v2.2/fixtures/?user=${SOCCERSAPI_USER}&token=${SOCCERSAPI_TOKEN}&t=schedule&d=${today}`;

  const response = await axios.get(url, { timeout: 15000 });
  const matches = response.data?.data || [];

  for (const md of matches) {
    try {
      const homeName = md.home_name || md.home?.name || md.home?.team_name;
      const awayName = md.away_name || md.away?.name || md.away?.team_name;
      if (!md.id || !homeName || !awayName) continue;

      const externalId = `soccersapi-${md.id}`;
      const exists = await Match.findOne({ externalId });
      if (exists) continue;

      const matchDate = tryParseDate(
        md.date && md.time ? `${md.date}T${md.time}` : null,
        md.utcDate,
        md.matchDateUtc
      );
      if (!isWithinNext24Hours(matchDate)) continue;

      const homeTeam = await getOrCreateTeam(homeName, md.home?.logo);
      const awayTeam = await getOrCreateTeam(awayName, md.away?.logo);
      if (!homeTeam || !awayTeam) continue;

      await Match.create({
        source: 'soccersapi',
        externalId,
        leagueCode: md.league_name || md.league || null,
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

// OpenLigaDB
async function fetchFromOpenLigaDB() {
  let newMatchesCount = 0;
  let updatedMatchesCount = 0;
  const leagueShortcuts = ['bl1', 'bl2'];
  const season = getCurrentSeason();

  for (const league of leagueShortcuts) {
    const url = `https://api.openligadb.de/getmatchdata/${league}/${season}`;
    const res = await axios.get(url, { timeout: 15000 });
    const matches = res.data || [];

    for (const md of matches) {
      try {
        if (!md.matchID || !md.team1?.teamName || !md.team2?.teamName) continue;
        const matchDate = tryParseDate(md.matchDateTimeUTC);
        if (!isWithinNext24Hours(matchDate)) continue;

        const externalId = `openliga-${md.matchID}`;
        const existing = await Match.findOne({ externalId });
        const lastUpdate = tryParseDate(md.lastUpdateDateTimeUTC) || new Date();

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

        const homeGoals = (md.matchResults || []).find(r => r.resultName === 'Endergebnis')?.pointsTeam1 ?? null;
        const awayGoals = (md.matchResults || []).find(r => r.resultName === 'Endergebnis')?.pointsTeam2 ?? null;

        await Match.create({
          source: 'openligadb',
          externalId,
          leagueCode: md.leagueName || null,
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
  let newHistoryCount = 0;

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

  // keep history fetch as-is (not limited to 24h)
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

          const homeTeam = await getOrCreateTeam(md.team1);
          const awayTeam = await getOrCreateTeam(md.team2);

          const homeGoals = md.score?.ft?.[0] ?? null;
          const awayGoals = md.score?.ft?.[1] ?? null;
          const matchDate = tryParseDate(md.date) || new Date(md.date);

          await Match.create({
            source: 'footballjson',
            externalId,
            leagueCode: md.league || 'history',
            matchDateUtc: matchDate,
            status: 'finished',
            homeTeam: homeTeam._id,
            awayTeam: awayTeam._id,
            homeGoals,
            awayGoals,
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

// Predictions + results unchanged
async function evaluatePredictionsForMatch(match) { /* ...same as yours... */ }
async function generateAllPredictions() { /* ...same as yours... */ }
async function fetchAndStoreResults() { /* ...same as yours... */ }

module.exports = {
  fetchAndStoreMatches,
  generateAllPredictions,
  fetchAndStoreResults,
  evaluatePredictionsForMatch
};
