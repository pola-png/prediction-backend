// services/cronService.js
const axios = require("axios");
const Match = require("../models/Match");
const Team = require("../models/Team");

const GOALSERVE_TOKEN =
  process.env.GOALSERVE_TOKEN || "fdc97ba4c57b4de23f4808ddf528229c";
const GOALSERVE_URL = `https://www.goalserve.com/getfeed/${GOALSERVE_TOKEN}/soccernew/home?json=true`;

/* ---------------- Parse Goalserve ---------------- */
function parseGoalserveMatches(json) {
  if (!json?.scores?.category) return [];

  const categories = Array.isArray(json.scores.category)
    ? json.scores.category
    : [json.scores.category];

  let matches = [];
  for (const cat of categories) {
    if (!cat.matches) continue;

    const catMatches = Array.isArray(cat.matches)
      ? cat.matches
      : [cat.matches];

    for (const m of catMatches) {
      matches.push({
        static_id: m.id ? String(m.id) : null,
        league: cat.name,
        league_id: cat.id ? String(cat.id) : null,
        country: cat.country || null,
        season: cat.season || null,
        stage: cat.stage || null,
        stage_id: cat.stage_id ? String(cat.stage_id) : null,

        date: m.date,
        time: m.time,
        status: m.status || "scheduled",

        homeId: m.hometeam?.id ? String(m.hometeam.id) : null,
        home: m.hometeam?.name || null,
        homeShortName: m.hometeam?.short_name || null,
        homeCode: m.hometeam?.code || null,
        homeCountry: m.hometeam?.country || null,
        homeLogo: m.hometeam?.logo || null,

        awayId: m.awayteam?.id ? String(m.awayteam.id) : null,
        away: m.awayteam?.name || null,
        awayShortName: m.awayteam?.short_name || null,
        awayCode: m.awayteam?.code || null,
        awayCountry: m.awayteam?.country || null,
        awayLogo: m.awayteam?.logo || null,
      });
    }
  }
  return matches;
}

/* ---------------- Fetch & Store ---------------- */
async function fetchAndStoreUpcomingMatches() {
  console.log("Fetching Goalserve:", GOALSERVE_URL);

  try {
    const { data } = await axios.get(GOALSERVE_URL, { timeout: 20000 });
    const matches = parseGoalserveMatches(data);

    if (!matches.length) {
      console.log("⚠️ Goalserve returned 0 matches");
      return { newMatchesCount: 0 };
    }

    let newMatchesCount = 0;

    for (const m of matches) {
      if (!m.static_id) continue; // skip invalid matches

      // ✅ Find or create teams (using team_id, aligned with Team.js)
      const homeTeam = await Team.findOneAndUpdate(
        { team_id: m.homeId },
        {
          team_id: m.homeId,
          name: m.home,
          shortName: m.homeShortName,
          code: m.homeCode,
          country: m.homeCountry,
          logoUrl: m.homeLogo,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      const awayTeam = await Team.findOneAndUpdate(
        { team_id: m.awayId },
        {
          team_id: m.awayId,
          name: m.away,
          shortName: m.awayShortName,
          code: m.awayCode,
          country: m.awayCountry,
          logoUrl: m.awayLogo,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // ✅ Upsert match (aligned with Match.js schema)
      const existing = await Match.findOneAndUpdate(
        { static_id: m.static_id },
        {
          static_id: m.static_id,
          league: m.league,
          league_id: m.league_id,
          season: m.season,
          country: m.country,
          stage: m.stage,
          stage_id: m.stage_id,
          date: m.date && m.time ? new Date(`${m.date} ${m.time} UTC`) : null,
          time: m.time,
          status: m.status,
          homeTeam: homeTeam ? homeTeam._id : null,
          awayTeam: awayTeam ? awayTeam._id : null,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (!existing) newMatchesCount++;
    }

    console.log("✅ Total new matches fetched:", newMatchesCount);
    return { newMatchesCount };
  } catch (err) {
    console.error("❌ Goalserve fetch failed:", err.message || err);
    return { newMatchesCount: 0, error: err.message };
  }
}

module.exports = {
  fetchAndStoreUpcomingMatches,
};
