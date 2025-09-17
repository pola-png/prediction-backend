const axios = require('axios');
const Match = require('../models/Match');
const Team = require('../models/Team');
const Prediction = require('../models/Prediction');
const History = require('../models/History'); // new model
const { getPredictionsFromAI } = require('./aiService');

// default axios instance for cron calls (longer timeout + retry)
const http = axios.create({ timeout: 60000, maxRedirects: 5 });

/* ---------------- Helpers ---------------- */
async function getOrCreateTeam(name, logoUrl = null) {
  if (!name) return null;
  const cleanName = String(name).trim();
  if (!cleanName) return null;

  let team = await Team.findOne({ name: cleanName }).exec();
  if (!team) {
    team = await Team.create({ name: cleanName, logo: logoUrl || null });
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

function withinNext24Hours(date) {
  if (!date) return false;
  const now = new Date();
  const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return date >= now && date <= until;
}

/* ---------------- Retry wrapper ---------------- */
async function safeGet(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await http.get(url);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`Retrying (${i + 1}/${retries}) after error:`, err.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

/* ---------------- Upcoming fetchers ---------------- */
async function fetchUpcomingFromSoccersAPI() {
  const { SOCCERSAPI_USER, SOCCERSAPI_TOKEN } = process.env;
  if (!SOCCERSAPI_USER || !SOCCERSAPI_TOKEN) {
    return { newMatchesCount: 0 };
  }

  let newMatchesCount = 0;
  try {
    const today = new Date().toISOString().split('T')[0];
    const url = `https://api.soccersapi.com/v2.2/fixtures/?user=${SOCCERSAPI_USER}&token=${SOCCERSAPI_TOKEN}&t=schedule&d=${today}`;
    const res = await safeGet(url);
    const items = res.data?.data || [];

    for (const md of items) {
      try {
        const homeName = md.home_name || md.home?.name || md.home?.team_name;
        const awayName = md.away_name || md.away?.name || md.away?.team_name;
        if (!md.id || !homeName || !awayName) continue;

        const matchDate = tryParseDate(
          md.date && md.time ? `${md.date}T${md.time}` : null,
          md.utcDate,
          md.matchDateUtc
        );
        if (!matchDate || !withinNext24Hours(matchDate)) continue;

        const externalId = `soccersapi-${md.id}`;
        const leagueName = md.league_name || md.league || md.leagueCode || null;

        const homeTeam = await getOrCreateTeam(homeName, md.home?.logo || md.home_logo || null);
        const awayTeam = await getOrCreateTeam(awayName, md.away?.logo || md.away_logo || null);
        if (!homeTeam || !awayTeam) continue;

        const existing = await Match.findOne({ externalId }).exec();
        if (existing) {
          existing.matchDateUtc = matchDate;
          existing.league = existing.league || leagueName;
          existing.homeTeam = existing.homeTeam || homeTeam._id;
          existing.awayTeam = existing.awayTeam || awayTeam._id;
          existing.source = 'soccersapi';
          existing.status = existing.status || 'scheduled';
          await existing.save();
        } else {
          await Match.create({
            source: 'soccersapi',
            externalId,
            league: leagueName,
            matchDateUtc: matchDate,
            status: 'scheduled',
            homeTeam: homeTeam._id,
            awayTeam: awayTeam._id
          });
          newMatchesCount++;
        }
      } catch (err) {
        console.warn('CRON:soccersapi item skip:', err.message || err);
      }
    }
  } catch (err) {
    throw new Error(`SoccersAPI fetch error: ${err.message || err}`);
  }

  return { newMatchesCount };
}

async function fetchUpcomingFromOpenLigaDB() {
  let newMatchesCount = 0;
  const leagueShortcuts = ['bl1', 'bl2'];
  const season = new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1;

  for (const league of leagueShortcuts) {
    try {
      const url = `https://api.openligadb.de/getmatchdata/${league}/${season}`;
      const res = await safeGet(url);
      const items = res.data || [];

      for (const md of items) {
        try {
          if (!md.matchID || !md.team1?.teamName || !md.team2?.teamName) continue;

          const matchDate = tryParseDate(md.matchDateTimeUTC);
          if (!matchDate || !withinNext24Hours(matchDate)) continue;

          const externalId = `openliga-${md.matchID}`;
          const homeTeam = await getOrCreateTeam(md.team1.teamName, md.team1.teamIconUrl || null);
          const awayTeam = await getOrCreateTeam(md.team2.teamName, md.team2.teamIconUrl || null);
          if (!homeTeam || !awayTeam) continue;

          const existing = await Match.findOne({ externalId }).exec();
          const leagueName = md.leagueName || league;

          if (existing) {
            existing.matchDateUtc = matchDate;
            existing.league = existing.league || leagueName;
            existing.homeTeam = existing.homeTeam || homeTeam._id;
            existing.awayTeam = existing.awayTeam || awayTeam._id;
            existing.status = md.matchIsFinished ? 'finished' : 'scheduled';
            await existing.save();
            continue;
          }

          await Match.create({
            source: 'openligadb',
            externalId,
            league: leagueName,
            matchDateUtc: matchDate,
            status: md.matchIsFinished ? 'finished' : 'scheduled',
            homeTeam: homeTeam._id,
            awayTeam: awayTeam._id
          });
          newMatchesCount++;
        } catch (err) {
          console.warn('CRON:openligadb item skip:', err.message || err);
        }
      }
    } catch (err) {
      console.warn('CRON:openligadb fetch error for', league, err.message || err);
    }
  }

  return { newMatchesCount };
}

/**
 * Fetch upcoming matches (only next 24 hours).
 */
async function fetchAndStoreUpcomingMatches() {
  let totalNew = 0;
  try {
    const socRes = await fetchUpcomingFromSoccersAPI();
    totalNew += socRes.newMatchesCount || 0;
  } catch (err) {
    console.error('CRON: SoccersAPI failed:', err.message || err);
    try {
      const fb = await fetchUpcomingFromOpenLigaDB();
      totalNew += fb.newMatchesCount || 0;
    } catch (fbErr) {
      console.error('CRON: OpenLigaDB fallback failed:', fbErr.message || fbErr);
    }
  }
  return { newMatchesCount: totalNew };
}

/* ---------------- History import ---------------- */
async function importHistoryFromUrl(url) {
  if (!url) throw new Error('No URL provided for history import');
  const res = await safeGet(url);
  const items = res.data?.matches || res.data || [];
  if (!Array.isArray(items)) throw new Error('History JSON did not contain an array');

  let created = 0;
  let updated = 0;

  for (const md of items) {
    try {
      const homeName = md.home || md.homeTeam || md.team1 || md.team1?.name;
      const awayName = md.away || md.awayTeam || md.team2 || md.team2?.name;
      const rawDate = md.date || md.matchDateUtc || md.utcDate || md.datetime;
      if (!homeName || !awayName || !rawDate) continue;

      const matchDate = tryParseDate(rawDate);
      if (!matchDate) continue;

      const externalId = md.id
        ? `history-${md.id}`
        : `history-${matchDate.toISOString()}-${String(homeName).replace(/\s+/g, '_')}-${String(awayName).replace(/\s+/g, '_')}`;

      const homeLogo = md.homeLogo || md.team1?.logo || md.homeTeam?.logo || null;
      const awayLogo = md.awayLogo || md.team2?.logo || md.awayTeam?.logo || null;

      const homeTeam = await getOrCreateTeam(homeName, homeLogo);
      const awayTeam = await getOrCreateTeam(awayName, awayLogo);
      if (!homeTeam || !awayTeam) continue;

      let existing = await History.findOne({ externalId }).exec();
      if (!existing) {
        existing = await History.findOne({
          homeTeam: homeTeam._id,
          awayTeam: awayTeam._id,
          matchDateUtc: matchDate
        }).exec();
      }

      const leagueName = md.league || md.competition || md.leagueName || null;
      const homeGoals = md.score?.home ?? md.score?.ft?.[0] ?? md.homeGoals ?? null;
      const awayGoals = md.score?.away ?? md.score?.ft?.[1] ?? md.awayGoals ?? null;

      if (existing) {
        existing.externalId = existing.externalId || externalId;
        existing.league = existing.league || leagueName;
        existing.matchDateUtc = existing.matchDateUtc || matchDate;
        existing.homeTeam = existing.homeTeam || homeTeam._id;
        existing.awayTeam = existing.awayTeam || awayTeam._id;
        existing.status = 'finished';
        if (homeGoals !== null && awayGoals !== null) {
          existing.homeGoals = homeGoals;
          existing.awayGoals = awayGoals;
        }
        await existing.save();
        updated++;
      } else {
        await History.create({
          source: 'history-import',
          externalId,
          league: leagueName,
          matchDateUtc: matchDate,
          status: 'finished',
          homeTeam: homeTeam._id,
          awayTeam: awayTeam._id,
          homeGoals: homeGoals !== undefined ? homeGoals : undefined,
          awayGoals: awayGoals !== undefined ? awayGoals : undefined
        });
        created++;
      }
    } catch (err) {
      console.warn('CRON: history import item skip:', err.message || err);
    }
  }

  return { created, updated, total: created + updated };
}

/* ---------------- Generate predictions ---------------- */
async function generateAllPredictions() {
  let processedCount = 0;
  const now = new Date();
  const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const upcoming = await Match.find({
    status: { $in: ['scheduled', 'upcoming', 'tba'] },
    matchDateUtc: { $gte: now, $lte: until }
  }).populate('homeTeam awayTeam').limit(50).lean();

  if (!upcoming.length) return { processedCount: 0 };

  const historical = await History.find({ status: 'finished' })
    .populate('homeTeam awayTeam')
    .lean();

  for (const match of upcoming) {
    try {
      if (!match.homeTeam || !match.awayTeam) continue;
      const aiPredictions = await getPredictionsFromAI(match, historical);
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

/* ---------------- Exported functions ---------------- */
module.exports = {
  fetchAndStoreUpcomingMatches,
  fetchUpcomingFromSoccersAPI,
  importHistoryFromUrl,
  generateAllPredictions
};
