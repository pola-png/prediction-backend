// services/cronService.js
const axios = require("axios");
const Match = require("../models/Match");
const Team = require("../models/Team");

const GOALSERVE_TOKEN = process.env.GOALSERVE_TOKEN || "fdc97ba4c57b4de23f4808ddf528229c";
const GOALSERVE_URL = `https://www.goalserve.com/getfeed/${GOALSERVE_TOKEN}/soccernew/home?json=true`;

/* ---------------- Parse Goalserve ---------------- */
function parseGoalserveMatches(json) {
  if (!json?.scores?.category) return [];

  const categories = Array.isArray(json.scores.category)
    ? json.scores.category
    : [json.scores.category];

  let matches = [];
  for (const cat of categories) {
    if (cat.matches) {
      const catMatches = Array.isArray(cat.matches) ? cat.matches : [cat.matches];
      matches.push(
        ...catMatches.map(m => ({
          static_id: m.id,
          league: cat.name,
          date: m.date,
          time: m.time,
          status: m.status || "scheduled",
          home: m.hometeam?.name,
          away: m.awayteam?.name,
          homeLogo: m.hometeam?.logo,
          awayLogo: m.awayteam?.logo,
        }))
      );
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
      // Find or create teams
      const homeTeam = await Team.findOneAndUpdate(
        { name: m.home },
        { name: m.home, logoUrl: m.homeLogo },
        { upsert: true, new: true }
      );
      const awayTeam = await Team.findOneAndUpdate(
        { name: m.away },
        { name: m.away, logoUrl: m.awayLogo },
        { upsert: true, new: true }
      );

      // Upsert match
      const existing = await Match.findOneAndUpdate(
        { static_id: m.static_id },
        {
          static_id: m.static_id,
          league: m.league,
          matchDateUtc: new Date(`${m.date} ${m.time} UTC`),
          status: m.status,
          homeTeam: homeTeam._id,
          awayTeam: awayTeam._id,
        },
        { upsert: true, new: true }
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
