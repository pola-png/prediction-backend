const axios = require("axios");
const Match = require("../models/Match");
const Team = require("../models/Team");

const GOALSERVE_TOKEN =
  process.env.GOALSERVE_TOKEN || "fdc97ba4c57b4de23f4808ddf528229c";
const GOALSERVE_URL = `https://www.goalserve.com/getfeed/${GOALSERVE_TOKEN}/soccernew/home?json=true`;

async function fetchJSON(url) {
  try {
    const { data } = await axios.get(url, { timeout: 20000 });
    return data;
  } catch (err) {
    console.error(`❌ Failed fetch: ${url}`, err.message || err);
    return null;
  }
}

function parseGoalserveMatches(json) {
  if (!json?.scores?.category) return [];

  const categories = Array.isArray(json.scores.category)
    ? json.scores.category
    : [json.scores.category];

  const matches = [];

  for (const cat of categories) {
    if (!cat.matches) continue;
    const catMatches = Array.isArray(cat.matches) ? cat.matches : [cat.matches];

    for (const m of catMatches) {
      matches.push({
        league: cat.name || null,
        country: cat.country || null,
        season: cat.season || null,
        stage: cat.stage || null,
        date: m.date || null,
        time: m.time || null,
        status: m.status || "scheduled",
        rawMatch: m,
        home: {
          name: m.hometeam?.name || null,
          shortName: m.hometeam?.short_name || null,
          code: m.hometeam?.code || null,
          country: m.hometeam?.country || null,
          logoUrl: m.hometeam?.logo || null,
        },
        away: {
          name: m.awayteam?.name || null,
          shortName: m.awayteam?.short_name || null,
          code: m.awayteam?.code || null,
          country: m.awayteam?.country || null,
          logoUrl: m.awayteam?.logo || null,
        },
        scores: m.scores || {},
        events: m.events || {},
        odds: m.odds || {},
        stats: m.stats || {},
        injuries: m.injuries || [],
        h2h: m.h2h || {},
        history: m.history || {},
        lineups: m.lineups || [],
        substitutions: m.substitutions || [],
        coaches: m.coaches || [],
        referees: m.referees || [],
      });
    }
  }

  return matches;
}

async function fetchAndStoreUpcomingMatches() {
  console.log("Fetching Goalserve:", GOALSERVE_URL);
  const data = await fetchJSON(GOALSERVE_URL);
  if (!data) return { newMatchesCount: 0, processed: 0 };

  const parsed = parseGoalserveMatches(data);
  if (!parsed.length) {
    console.log("⚠️ Goalserve returned 0 matches");
    return { newMatchesCount: 0, processed: 0 };
  }

  let newMatchesCount = 0;
  let processed = 0;

  for (const m of parsed) {
    processed++;

    try {
      // --- Upsert Teams
      let homeTeam = null;
      if (m.home?.name) {
        const homeRes = await Team.findOneAndUpdate(
          { name: m.home.name },
          {
            $set: {
              name: m.home.name,
              logoUrl: m.home.logoUrl || null,
              shortName: m.home.shortName || null,
              code: m.home.code || null,
              country: m.home.country || null,
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true, rawResult: true }
        );
        homeTeam = homeRes.value || null;
      }

      let awayTeam = null;
      if (m.away?.name) {
        const awayRes = await Team.findOneAndUpdate(
          { name: m.away.name },
          {
            $set: {
              name: m.away.name,
              logoUrl: m.away.logoUrl || null,
              shortName: m.away.shortName || null,
              code: m.away.code || null,
              country: m.away.country || null,
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true, rawResult: true }
        );
        awayTeam = awayRes.value || null;
      }

      // --- Build full match object
      const matchObj = {
        league: m.league || undefined,
        season: m.season || undefined,
        country: m.country || undefined,
        stage: m.stage || undefined,
        status: m.status || "scheduled",
        source: "goalserve",
        matchDateUtc: m.date ? new Date(`${m.date} ${m.time || "00:00"} UTC`) : null,
        date: m.date ? new Date(`${m.date} ${m.time || "00:00"} UTC`) : null,
        homeTeam: homeTeam
          ? { id: homeTeam._id, name: homeTeam.name, logoUrl: homeTeam.logoUrl || null }
          : { name: m.home?.name || "Home", logoUrl: m.home?.logoUrl || null },
        awayTeam: awayTeam
          ? { id: awayTeam._id, name: awayTeam.name, logoUrl: awayTeam.logoUrl || null }
          : { name: m.away?.name || "Away", logoUrl: m.away?.logoUrl || null },
        scores: m.scores,
        events: m.events,
        odds: m.odds,
        stats: m.stats,
        injuries: m.injuries,
        h2h: m.h2h,
        history: m.history,
        lineups: m.lineups,
        substitutions: m.substitutions,
        coaches: m.coaches,
        referees: m.referees,
        rawMatch: m.rawMatch,
        createdAt: new Date(),
      };

      // Save match
      const newMatch = new Match(matchObj);
      await newMatch.save();
      newMatchesCount++;
    } catch (err) {
      console.warn("CRON: skipping match due to error:", err.message || err);
      continue;
    }
  }

  console.log(`✅ Total matches processed: ${processed}`);
  console.log(`✅ Total new matches inserted: ${newMatchesCount}`);
  return { newMatchesCount, processed };
}

module.exports = {
  fetchAndStoreUpcomingMatches,
};
