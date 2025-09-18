// services/cronService.js
const axios = require("axios");
const Match = require("../models/Match");
const Team = require("../models/Team");

const GOALSERVE_TOKEN = process.env.GOALSERVE_TOKEN || "fdc97ba4c57b4de23f4808ddf528229c";
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

  const categories = Array.isArray(json.scores.category) ? json.scores.category : [json.scores.category];
  const matches = [];

  for (const cat of categories) {
    if (!cat.matches) continue;
    const catMatches = Array.isArray(cat.matches) ? cat.matches : [cat.matches];

    for (const m of catMatches) {
      // ensure numeric static_id
      const staticId = m.id ? Number(m.id) : null;
      matches.push({
        static_id: Number.isFinite(staticId) ? staticId : null,
        league: cat.name || null,
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
        }
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

    if (!m.static_id) {
      console.warn("CRON: skipping match without numeric static_id");
      continue;
    }

    try {
      // --- Teams: prefer team_id; fallback to name if available
      let homeTeam = null;
      if (m.home?.id || m.home?.name) {
        const homeFilter = m.home.id ? { team_id: m.home.id } : { name: m.home.name };
        const homeSet = {};
        if (m.home.name) homeSet.name = m.home.name;
        if (m.home.logoUrl) homeSet.logoUrl = m.home.logoUrl;
        if (m.home.id) homeSet.team_id = m.home.id;
        if (m.home.shortName) homeSet.shortName = m.home.shortName;
        if (m.home.code) homeSet.code = m.home.code;
        if (m.home.country) homeSet.country = m.home.country;

        const homeRes = await Team.findOneAndUpdate(
          homeFilter,
          { $set: homeSet, $setOnInsert: { createdAt: new Date() } },
          { upsert: true, new: true, setDefaultsOnInsert: true, rawResult: true }
        );
        homeTeam = homeRes.value || null;
      }

      let awayTeam = null;
      if (m.away?.id || m.away?.name) {
        const awayFilter = m.away.id ? { team_id: m.away.id } : { name: m.away.name };
        const awaySet = {};
        if (m.away.name) awaySet.name = m.away.name;
        if (m.away.logoUrl) awaySet.logoUrl = m.away.logoUrl;
        if (m.away.id) awaySet.team_id = m.away.id;
        if (m.away.shortName) awaySet.shortName = m.away.shortName;
        if (m.away.code) awaySet.code = m.away.code;
        if (m.away.country) awaySet.country = m.away.country;

        const awayRes = await Team.findOneAndUpdate(
          awayFilter,
          { $set: awaySet, $setOnInsert: { createdAt: new Date() } },
          { upsert: true, new: true, setDefaultsOnInsert: true, rawResult: true }
        );
        awayTeam = awayRes.value || null;
      }

      // --- Build $set only with existing values (avoid writing nulls)
      const setObj = {
        static_id: m.static_id,
        league: m.league || undefined,
        league_id: m.league_id || undefined,
        season: m.season || undefined,
        country: m.country || undefined,
        stage: m.stage || undefined,
        stage_id: m.stage_id || undefined,
        time: m.time || undefined,
        status: m.status || undefined,
        source: "goalserve",
        externalId: `goalserve-${m.static_id}`,
      };

      // matchDateUtc / date if date exists
      if (m.date) {
        // feed date format from doc is dd.MM.yyyy and time HH:mm — convert safely
        // Try to parse as ISO first; if not, attempt dd.MM.yyyy parsing.
        let dt = null;
        const isoTry = new Date(`${m.date} ${m.time} UTC`);
        if (!isNaN(isoTry.getTime())) dt = isoTry;
        // If dd.MM.yyyy, create from parts
        if (!dt) {
          const parts = (m.date || "").split(/[.\-\/]/);
          if (parts.length >= 3) {
            const [day, month, year] = parts;
            const iso = `${year}-${month.padStart(2,"0")}-${day.padStart(2,"0")} ${m.time || "00:00"} UTC`;
            const isoD = new Date(iso);
            if (!isNaN(isoD.getTime())) dt = isoD;
          }
        }
        if (dt) {
          setObj.matchDateUtc = dt;
          setObj.date = dt;
        }
      }

      if (homeTeam) {
        setObj.homeTeam = {
          id: homeTeam.team_id || null,
          name: homeTeam.name || null,
          logoUrl: homeTeam.logoUrl || null
        };
      }
      if (awayTeam) {
        setObj.awayTeam = {
          id: awayTeam.team_id || null,
          name: awayTeam.name || null,
          logoUrl: awayTeam.logoUrl || null
        };
      }

      // Clean undefined keys from setObj (so we don't overwrite existing values with undefined)
      for (const k of Object.keys(setObj)) {
        if (setObj[k] === undefined) delete setObj[k];
      }

      const matchRes = await Match.findOneAndUpdate(
        { static_id: m.static_id },
        { $set: setObj, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true, rawResult: true }
      );

      if (matchRes.lastErrorObject && matchRes.lastErrorObject.upserted) {
        newMatchesCount++;
      }
    } catch (err) {
      console.warn("CRON: skipping match due to error:", err.message || err);
      // continue with next match
    }
  } // end loop

  console.log(`✅ Total matches processed: ${processed}`);
  console.log(`✅ Total new matches fetched: ${newMatchesCount}`);
  return { newMatchesCount, processed };
}

module.exports = {
  fetchAndStoreUpcomingMatches,
};
