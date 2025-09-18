// services/cronService.js
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

/**
 * Try many likely places for an ID coming from Goalserve XML->JSON conversion.
 * Returns { externalId: string|null, staticId: number|null }
 */
function extractIdsFromRawMatch(m) {
  // candidate properties that Goalserve or the XML->JSON converter might put IDs into
  const candidates = [
    m.id,
    m.static_id,
    m.staticId,
    m.match_id,
    m._id,
    m["@id"],
    (m.$ && m.$.id) || null,
    (m["@attributes"] && m["@attributes"].id) || null,
  ];

  // first non-null string-like candidate for externalId
  let externalId = null;
  for (const c of candidates) {
    if (c !== undefined && c !== null) {
      externalId = String(c);
      break;
    }
  }

  // static numeric id if present and numeric
  let staticId = null;
  if (externalId) {
    const asNum = Number(externalId);
    if (!Number.isNaN(asNum)) staticId = asNum;
  }
  // also check static_id specifically
  if (staticId === null && m.static_id !== undefined && m.static_id !== null) {
    const s = Number(m.static_id);
    if (!Number.isNaN(s)) staticId = s;
  }

  return { externalId, staticId };
}

function normalizeString(s = "") {
  return String(s)
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_\-:]/g, "")
    .toLowerCase();
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
      const { externalId, staticId } = extractIdsFromRawMatch(m);

      matches.push({
        // keep both (static numeric id when available, and the raw id as externalId)
        static_id: staticId,
        externalId, // may be null -> we'll fallback later
        league: cat.name || null,
        league_id: cat.id ? Number(cat.id) : null,
        country: cat.country || null,
        season: cat.season || null,
        stage: cat.stage || null,
        stage_id: cat.stage_id ? Number(cat.stage_id) : null,
        date: m.date || null,
        time: m.time || null,
        status: m.status || "scheduled",
        rawMatch: m, // keep raw match if needed for debugging
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

    // ensure we always have an externalId (fallback to generated one when missing)
    let externalId = m.externalId;
    if (!externalId) {
      // create a stable-ish fallback using feed values (league + date + home/away)
      const leaguePart = normalizeString(m.league || "unknownleague");
      const datePart = normalizeString(m.date || "nodate");
      const homePart = normalizeString(m.home?.name || "home");
      const awayPart = normalizeString(m.away?.name || "away");
      externalId = `goalserve_fallback:${leaguePart}:${datePart}:${homePart}-vs-${awayPart}`;
      // append time if available to reduce collisions
      if (m.time) externalId += `:${normalizeString(m.time)}`;
      // we deliberately keep static_id separate (may be null)
    }

    try {
      // --- Upsert Teams (only if we have name/id) to avoid upserting {name: null}
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

      // --- Build set object (only include keys that actually exist)
      const setObj = {
        externalId,
        static_id: m.static_id ?? undefined, // include numeric static_id only when present
        league: m.league || undefined,
        league_id: m.league_id || undefined,
        season: m.season || undefined,
        country: m.country || undefined,
        stage: m.stage || undefined,
        stage_id: m.stage_id || undefined,
        time: m.time || undefined,
        status: m.status || undefined,
        source: "goalserve",
      };

      // parse and set match date/time (doc shows dd.MM.yyyy + HH:mm)
      if (m.date) {
        let dt = null;
        // try direct ISO-ish attempt first
        const isoTry = new Date(`${m.date} ${m.time || "00:00"} UTC`);
        if (!isNaN(isoTry.getTime())) dt = isoTry;
        if (!dt) {
          const parts = (m.date || "").split(/[.\-\/]/);
          if (parts.length >= 3) {
            const [day, month, year] = parts;
            const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${m.time || "00:00"} UTC`;
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
          logoUrl: homeTeam.logoUrl || null,
        };
      } else if (m.home?.name) {
        setObj.homeTeam = { id: m.home.id || null, name: m.home.name, logoUrl: m.home.logoUrl || null };
      }

      if (awayTeam) {
        setObj.awayTeam = {
          id: awayTeam.team_id || null,
          name: awayTeam.name || null,
          logoUrl: awayTeam.logoUrl || null,
        };
      } else if (m.away?.name) {
        setObj.awayTeam = { id: m.away.id || null, name: m.away.name, logoUrl: m.away.logoUrl || null };
      }

      // remove undefined keys so we don't overwrite with undefined
      for (const k of Object.keys(setObj)) {
        if (setObj[k] === undefined) delete setObj[k];
      }

      const matchRes = await Match.findOneAndUpdate(
        { source: "goalserve", externalId },
        { $set: setObj, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true, rawResult: true }
      );

      if (matchRes.lastErrorObject?.upserted) newMatchesCount++;
    } catch (err) {
      // don't fail the whole loop — log and continue
      console.warn("CRON: skipping match due to error:", err.message || err);
      // helpful debug: log a tiny preview of the raw match when there is an odd error
      if (m && m.rawMatch) {
        try {
          console.debug("CRON: raw match preview:", JSON.stringify(m.rawMatch).slice(0, 300));
        } catch (e) { /* ignore */ }
      }
      continue;
    }
  } // end loop

  console.log(`✅ Total matches processed: ${processed}`);
  console.log(`✅ Total new matches fetched: ${newMatchesCount}`);
  return { newMatchesCount, processed };
}

module.exports = {
  fetchAndStoreUpcomingMatches,
};
