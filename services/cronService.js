// services/cronService.js
const axios = require("axios");
const Match = require("../models/Match");
const Team = require("../models/Team");

const GOALSERVE_TOKEN = process.env.GOALSERVE_TOKEN || "fdc97ba4c57b4de23f4808ddf528229c";
const BASE_URL = `https://www.goalserve.com/getfeed/${GOALSERVE_TOKEN}`;

/* ---------------- Helpers ---------------- */
async function fetchJSON(url) {
  try {
    const { data } = await axios.get(url, { timeout: 20000 });
    return data;
  } catch (err) {
    console.error(`❌ Failed fetch: ${url}`, err.message);
    return null;
  }
}

/* ---------------- Parse Fixtures ---------------- */
function parseLeagueFixtures(json, leagueMeta) {
  if (!json?.results?.tournament) return [];

  const tournaments = Array.isArray(json.results.tournament)
    ? json.results.tournament
    : [json.results.tournament];

  let matches = [];
  for (const t of tournaments) {
    const stages = t.stage ? (Array.isArray(t.stage) ? t.stage : [t.stage]) : [t];

    for (const stage of stages) {
      const weeks = stage.week ? (Array.isArray(stage.week) ? stage.week : [stage.week]) : [stage];

      for (const week of weeks) {
        if (!week.match) continue;
        const weekMatches = Array.isArray(week.match) ? week.match : [week.match];

        for (const m of weekMatches) {
          matches.push({
            static_id: m.static_id ? Number(m.static_id) : null,
            league: t.league || leagueMeta?.name,
            league_id: t.id ? Number(t.id) : leagueMeta?.id || null,
            country: json.results.country || leagueMeta?.country || null,
            season: t.season || null,
            stage: stage.name || null,
            stage_id: stage.stage_id ? Number(stage.stage_id) : null,

            date: m.date || null,
            time: m.time || null,
            status: m.status || "scheduled",

            home: {
              id: m.localteam?.id ? Number(m.localteam.id) : null,
              name: m.localteam?.name || null,
              score: m.localteam?.score || null,
            },
            away: {
              id: m.visitorteam?.id ? Number(m.visitorteam.id) : null,
              name: m.visitorteam?.name || null,
              score: m.visitorteam?.score || null,
            },
          });
        }
      }
    }
  }

  return matches;
}

/* ---------------- Fetch & Store ALL Fixtures ---------------- */
async function fetchAndStoreAllFixtures() {
  console.log("📌 Fetching league mapping...");
  const mappingUrl = `${BASE_URL}/soccerfixtures/data/mapping?json=true`;
  const mapping = await fetchJSON(mappingUrl);

  if (!mapping?.mapping) {
    console.error("⚠️ No league mapping returned");
    return { totalLeagues: 0, totalMatches: 0 };
  }

  const leagues = Array.isArray(mapping.mapping)
    ? mapping.mapping
    : [mapping.mapping];

  let totalMatches = 0;

  for (const league of leagues) {
    const leagueId = league.id;
    const fixturesUrl = `${BASE_URL}/soccerfixtures/leagueid/${leagueId}?json=true`;

    console.log(`➡️ Fetching fixtures for ${league.name} (${leagueId})`);
    const fixtures = await fetchJSON(fixturesUrl);
    if (!fixtures) continue;

    const matches = parseLeagueFixtures(fixtures, league);
    console.log(`   ↳ Found ${matches.length} matches`);

    for (const m of matches) {
      if (!m.static_id) continue;

      // ✅ Save/Update Match
      await Match.findOneAndUpdate(
        { static_id: m.static_id },
        {
          ...m,
          date: m.date ? new Date(`${m.date} ${m.time} UTC`) : null,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    totalMatches += matches.length;
  }

  console.log(`✅ Total matches processed: ${totalMatches}`);
  return { totalLeagues: leagues.length, totalMatches };
}

module.exports = {
  fetchAndStoreAllFixtures,
};
