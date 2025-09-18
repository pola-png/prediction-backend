// services/cronService.js
const axios = require('axios');
const Match = require('../models/Match');
const Team = require('../models/Team');
const Prediction = require('../models/Prediction');
const History = require('../models/History');
const { getPredictionsFromAI } = require('./aiService'); // if you have this

const GOALSERVE_TOKEN = process.env.GOALSERVE_TOKEN || 'fdc97ba4c57b4de23f4808ddf528229c';
const GOALSERVE_URL = `https://www.goalserve.com/getfeed/${GOALSERVE_TOKEN}/soccernew/home?json=true`;

/* ---------------- Helpers ---------------- */
async function safeGet(url, retries = 3, timeout = 20000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, { timeout });
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`Retrying (${i + 1}/${retries}) after error:`, err.message);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

function parseGoalserveDate(dateStr, timeStr) {
  if (!dateStr) return null;
  // dd.MM.yyyy
  const ddmm = /^\d{1,2}\.\d{1,2}\.\d{4}$/;
  if (ddmm.test(dateStr)) {
    const [day, month, year] = dateStr.split('.').map((v) => parseInt(v, 10));
    let hour = 0,
      minute = 0;
    if (timeStr && /^\d{1,2}:\d{2}$/.test(timeStr)) {
      [hour, minute] = timeStr.split(':').map((v) => parseInt(v, 10));
    }
    return new Date(Date.UTC(year, month - 1, day, hour, minute));
  }
  // fallback to Date parse (ISO-like)
  const maybe = timeStr ? `${dateStr}T${timeStr}Z` : dateStr;
  const d = new Date(maybe);
  return isNaN(d.getTime()) ? null : d;
}

function extractMatchesFromCategory(cat) {
  const collected = [];
  if (!cat) return collected;

  // direct matches
  if (cat.matches) {
    const arr = Array.isArray(cat.matches) ? cat.matches : [cat.matches];
    for (const m of arr) collected.push({ match: m, category: cat });
  }

  // subcategory(s)
  if (cat.subcategory) {
    const subs = Array.isArray(cat.subcategory) ? cat.subcategory : [cat.subcategory];
    for (const sc of subs) {
      if (sc.matches) {
        const arr = Array.isArray(sc.matches) ? sc.matches : [sc.matches];
        for (const m of arr) collected.push({ match: m, category: cat, subcategory: sc });
      }
    }
  }
  return collected;
}

function parseGoalserveMatches(json) {
  if (!json?.scores?.category) return [];

  const categories = Array.isArray(json.scores.category) ? json.scores.category : [json.scores.category];
  const out = [];

  for (const cat of categories) {
    const extracted = extractMatchesFromCategory(cat);
    for (const itm of extracted) {
      const m = itm.match;
      // prefer static_id (doc shows attribute static_id present on match entries)
      const rawStatic = m.static_id ?? m.staticId ?? m.id ?? null;
      const static_id = Number(rawStatic);
      if (!Number.isFinite(static_id)) {
        // skip if static_id is not numeric
        continue;
      }

      const homeSrc = m.hometeam || m.localteam || m.home || null;
      const awaySrc = m.awayteam || m.visitorteam || m.away || null;

      out.push({
        static_id,
        id: m.id ? Number(m.id) : undefined,
        league: itm.subcategory?.name || itm.category?.name || null,
        league_id: itm.category?.id ? Number(itm.category.id) : undefined,
        country: itm.category?.country || null,
        season: itm.category?.season || null,
        stage: m.stage || itm.category?.stage || null,
        stage_id: m.stage_id ? Number(m.stage_id) : undefined,
        gid: m.groupId ? Number(m.groupId) : undefined,

        date: m.date || null,
        time: m.time || null,
        status: m.status || 'scheduled',

        homeId: homeSrc?.id ? Number(homeSrc.id) : null,
        home: homeSrc?.name ?? homeSrc?.team ?? null,
        homeShortName: homeSrc?.short_name ?? null,
        homeCode: homeSrc?.code ?? null,
        homeCountry: homeSrc?.country ?? null,
        homeLogo: homeSrc?.logo ?? null,

        awayId: awaySrc?.id ? Number(awaySrc.id) : null,
        away: awaySrc?.name ?? awaySrc?.team ?? null,
        awayShortName: awaySrc?.short_name ?? null,
        awayCode: awaySrc?.code ?? null,
        awayCountry: awaySrc?.country ?? null,
        awayLogo: awaySrc?.logo ?? null,
      });
    }
  }

  return out;
}

/* ---------------- Fetch & Store (Goalserve only) ---------------- */

async function fetchAndStoreUpcomingMatches() {
  console.log('Fetching Goalserve:', GOALSERVE_URL);

  try {
    const resp = await safeGet(GOALSERVE_URL, 3);
    const data = resp?.data;
    const matches = parseGoalserveMatches(data);

    if (!matches.length) {
      console.log('⚠️ Goalserve returned 0 matches');
      return { newMatchesCount: 0 };
    }

    let newMatchesCount = 0;

    for (const m of matches) {
      try {
        const matchDate = parseGoalserveDate(m.date, m.time);

        // Upsert Team records safely:
        // Use team_id when present, otherwise use name (but skip if name missing)
        let homeTeamRecord = null;
        if (m.homeId) {
          homeTeamRecord = await Team.findOneAndUpdate(
            { team_id: m.homeId },
            {
              team_id: m.homeId,
              name: m.home || undefined,
              shortName: m.homeShortName || undefined,
              code: m.homeCode || undefined,
              country: m.homeCountry || undefined,
              logoUrl: m.homeLogo || undefined,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        } else if (m.home) {
          homeTeamRecord = await Team.findOneAndUpdate(
            { name: m.home },
            {
              name: m.home,
              shortName: m.homeShortName || undefined,
              code: m.homeCode || undefined,
              country: m.homeCountry || undefined,
              logoUrl: m.homeLogo || undefined,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }

        let awayTeamRecord = null;
        if (m.awayId) {
          awayTeamRecord = await Team.findOneAndUpdate(
            { team_id: m.awayId },
            {
              team_id: m.awayId,
              name: m.away || undefined,
              shortName: m.awayShortName || undefined,
              code: m.awayCode || undefined,
              country: m.awayCountry || undefined,
              logoUrl: m.awayLogo || undefined,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        } else if (m.away) {
          awayTeamRecord = await Team.findOneAndUpdate(
            { name: m.away },
            {
              name: m.away,
              shortName: m.awayShortName || undefined,
              code: m.awayCode || undefined,
              country: m.awayCountry || undefined,
              logoUrl: m.awayLogo || undefined,
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }

        // Build match doc matching Match schema (populate homeTeam/awayTeam as ObjectId refs)
        const matchDoc = {
          static_id: Number(m.static_id),
          ...(m.id !== undefined && { id: Number(m.id) }),
          league: m.league || undefined,
          league_id: m.league_id !== undefined ? Number(m.league_id) : undefined,
          country: m.country || undefined,
          season: m.season || undefined,
          stage: m.stage || undefined,
          stage_id: m.stage_id !== undefined ? Number(m.stage_id) : undefined,
          gid: m.gid !== undefined ? Number(m.gid) : undefined,
          matchDateUtc: matchDate || undefined,
          date: matchDate || undefined,
          time: m.time || undefined,
          status: m.status || undefined,
          homeTeam: homeTeamRecord ? homeTeamRecord._id : undefined,
          awayTeam: awayTeamRecord ? awayTeamRecord._id : undefined,
        };

        const updated = await Match.findOneAndUpdate(
          { static_id: matchDoc.static_id },
          matchDoc,
          { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
        );

        // count newly created (heuristic using createdAt)
        if (updated && updated.createdAt && (Date.now() - updated.createdAt.getTime()) < 5000) {
          newMatchesCount++;
        }
      } catch (innerErr) {
        console.warn('CRON: skipping match due to error:', innerErr.message || innerErr);
      }
    }

    console.log('✅ Total new matches fetched:', newMatchesCount);
    return { newMatchesCount };
  } catch (err) {
    console.error('❌ Goalserve fetch failed:', err.message || err);
    return { newMatchesCount: 0, error: err.message || String(err) };
  }
}

/* ---------------- Import historical matches ---------------- */
// Accepts JSON URL with either a Goalserve-style feed or simple "matches" array.
async function importHistoryFromUrl(url) {
  if (!url) throw new Error('No URL provided for history import');
  console.log('Importing history from URL:', url);
  const resp = await safeGet(url, 3);
  const data = resp?.data || {};
  // attempt to parse as goalserve
  const parsed = parseGoalserveMatches(data);
  const items = parsed.length ? parsed : (data.matches && Array.isArray(data.matches) ? data.matches : []);
  let importedCount = 0;

  for (const md of items) {
    try {
      // If parsed from goalserve, md is normalized object shaped like our parser output
      const m = md.match ? md.match : md; // fallback if raw match object
      // For normalized objects (from parseGoalserveMatches) we already have fields
      const static_id = Number(m.static_id ?? m.id ?? m.matchId);
      if (!Number.isFinite(static_id)) continue;

      const matchDate = parseGoalserveDate(m.date || m.match_date || md.date, m.time || md.time);
      const homeName = m.home || (m.hometeam && m.hometeam.name) || md.home?.name || md.home;
      const awayName = m.away || (m.awayteam && m.awayteam.name) || md.away?.name || md.away;

      // find/create teams safely
      let homeTeamRecord = null;
      if (md.homeId || m.homeId) {
        homeTeamRecord = await Team.findOneAndUpdate(
          { team_id: Number(md.homeId ?? m.homeId) },
          { team_id: Number(md.homeId ?? m.homeId), name: homeName || undefined, logoUrl: md.home?.logo || m.homeLogo || undefined },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } else if (homeName) {
        homeTeamRecord = await Team.findOneAndUpdate(
          { name: homeName },
          { name: homeName, logoUrl: md.home?.logo || m.homeLogo || undefined },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }

      let awayTeamRecord = null;
      if (md.awayId || m.awayId) {
        awayTeamRecord = await Team.findOneAndUpdate(
          { team_id: Number(md.awayId ?? m.awayId) },
          { team_id: Number(md.awayId ?? m.awayId), name: awayName || undefined, logoUrl: md.away?.logo || m.awayLogo || undefined },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      } else if (awayName) {
        awayTeamRecord = await Team.findOneAndUpdate(
          { name: awayName },
          { name: awayName, logoUrl: md.away?.logo || m.awayLogo || undefined },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }

      const matchData = {
        static_id,
        id: m.id ? Number(m.id) : undefined,
        league: m.league || undefined,
        league_id: m.league_id !== undefined ? Number(m.league_id) : undefined,
        matchDateUtc: matchDate || undefined,
        date: matchDate || undefined,
        status: 'finished',
        homeTeam: homeTeamRecord ? homeTeamRecord._id : undefined,
        awayTeam: awayTeamRecord ? awayTeamRecord._id : undefined,
        homeGoals: Number(m.homeGoals ?? m.home_score ?? m.home?.score ?? 0),
        awayGoals: Number(m.awayGoals ?? m.away_score ?? m.away?.score ?? 0),
      };

      const existing = await Match.findOneAndUpdate({ static_id }, matchData, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true });

      // Create/mark History & Predictions if provided in feed (md.predictions etc.)
      // Keep minimal: if md.predictions exists and is array, upsert predictions
      if (Array.isArray(md.predictions)) {
        for (const p of md.predictions) {
          await Prediction.findOneAndUpdate(
            { matchId: existing._id, bucket: p.bucket },
            {
              matchId: existing._id,
              bucket: p.bucket,
              version: p.version || 'manual',
              outcomes: p.outcomes || {},
              confidence: p.confidence ?? 0,
              status: 'finished',
            },
            { upsert: true, new: true }
          );
        }
      }

      importedCount++;
    } catch (err) {
      console.warn('History import skip:', err.message || err);
    }
  }

  console.log(`Imported ${importedCount} historical matches`);
  return { importedCount };
}

/* ---------------- Generate predictions ---------------- */
async function generateAllPredictions() {
  // Basic wrapper that uses your AI service. Keep behavior original from your earlier implementation.
  let processedCount = 0;
  const now = new Date();
  const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const upcoming = await Match.find({
    status: { $in: ['scheduled', 'upcoming', 'tba'] },
    matchDateUtc: { $gte: now, $lte: until },
  }).populate('homeTeam awayTeam').limit(50).lean();

  if (!upcoming.length) return { processedCount: 0 };

  const historical = await History.find({ status: 'finished' }).populate('homeTeam awayTeam').lean();

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
  fetchAndStoreUpcomingMatches,
  importHistoryFromUrl,
  generateAllPredictions,
};
