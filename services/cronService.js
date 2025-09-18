// services/cronService.js
const axios = require("axios");
const Match = require("../models/Match");
const Team = require("../models/Team");

const GOALSERVE_TOKEN =
  process.env.GOALSERVE_TOKEN || "fdc97ba4c57b4de23f4808ddf528229c";

// ✅ Use soccernew root endpoint instead of /home to fetch ALL matches
const GOALSERVE_URL = `https://www.goalserve.com/getfeed/${GOALSERVE_TOKEN}/soccernew?json=true`;

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
        static_id: m.id ? Number(m.id) : null,
        league: cat.name,
        league_id: cat.id ? Number(cat.id) : null,
        country: cat.country || null,
        season: cat.season || null,
        stage: cat.stage || null,
        stage_id: cat.stage_id ? Number(cat.stage_id) : null,

        date: m.date || null,
        time: m.time || null,
        status: m.status || "scheduled",

        home: {
          id: m.hometeam?.id ? Number(m.hometeam.id) : null,
          name: m.hometeam?.name || null,
          shortName: m.hometeam?.short_name || null,
          code: m.hometeam?.code || null,
          country: m.hometeam?.country || null,
          logoUrl: m.hometeam?.logo || null,
        },
        away: {
          id: m.awayteam?.id ? Number(m.awayteam.id) : null,
          name: m.awayteam?.name || null,
          shortName: m.awayteam?.short_name || null,
          code: m.awayteam?.code || null,
          country: m.awayteam?.country || null,
          logoUrl: m.awayteam?.logo || null,
        },
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
      if (!m.static_id) continue;

      // ✅ Save/Update Teams
      const homeTeam = await Team.findOneAndUpdate(
        { team_id: m.home.id },
        { ...m.home },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      const awayTeam = await Team.findOneAndUpdate(
        { team_id: m.away.id },
        { ...m.away },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // ✅ Save/Update Match
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
          date: m.date ? new Date(`${m.date} ${m.time} UTC`) : null,
          time: m.time,
          status: m.status,
          homeTeam: {
            id: homeTeam?.team_id || null,
            name: homeTeam?.name || null,
            shortName: homeTeam?.shortName || null,
            logoUrl: homeTeam?.logoUrl || null,
          },
          awayTeam: {
            id: awayTeam?.team_id || null,
            name: awayTeam?.name || null,
            shortName: awayTeam?.shortName || null,
            logoUrl: awayTeam?.logoUrl || null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      if (!existing) newMatchesCount++;
    }

    console.log("✅ Total matches processed:", matches.length);
    console.log("✅ New matches inserted:", newMatchesCount);

    return { newMatchesCount, totalProcessed: matches.length };
  } catch (err) {
    console.error("❌ Goalserve fetch failed:", err.message || err);
    return { newMatchesCount: 0, error: err.message };
  }
}

module.exports = {
  fetchAndStoreUpcomingMatches,
};
