// services/cronService.js
const axios = require("axios");
const Match = require("../models/Match");
const Team = require("../models/Team");

const GOALSERVE_TOKEN = process.env.GOALSERVE_TOKEN || "fdc97ba4c57b4de23f4808ddf528229c";
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

/**
 * Parse date returned by Goalserve.
 * Supports dd.MM.yyyy (e.g. 19.09.2019) or ISO-like yyyy-mm-dd.
 * Produces a UTC Date (using the provided time if available).
 */
function parseGoalserveDate(dateStr, timeStr) {
  if (!dateStr) return null;

  // dd.MM.yyyy
  if (/\d{2}\.\d{2}\.\d{4}/.test(dateStr)) {
    const [day, month, year] = dateStr.split(".").map((v) => parseInt(v, 10));
    let hour = 0,
      minute = 0;
    if (timeStr && /^\d{1,2}:\d{2}$/.test(timeStr)) {
      [hour, minute] = timeStr.split(":").map((v) => parseInt(v, 10));
    }
    // create UTC date
    return new Date(Date.UTC(year, month - 1, day, hour, minute));
  }

  // ISO / yyyy-mm-dd or other parseable values
  const dt = timeStr ? `${dateStr}T${timeStr}Z` : dateStr;
  const d = new Date(dt);
  if (!isNaN(d.getTime())) return d;
  return null;
}

/* ---------------- Extract matches from Goalserve JSON ---------------- */

/**
 * Recursively extract match objects from category/subcategory structure.
 * Goalserve feed uses: scores -> category (array or object) -> matches or subcategory -> matches
 */
function extractMatchesFromCategory(cat) {
  const collected = [];

  if (!cat) return collected;

  // matches directly under category
  if (cat.matches) {
    const cm = Array.isArray(cat.matches) ? cat.matches : [cat.matches];
    for (const m of cm) collected.push({ match: m, category: cat });
  }

  // subcategory(s) (some feeds put matches under subcategory)
  if (cat.subcategory) {
    const subs = Array.isArray(cat.subcategory) ? cat.subcategory : [cat.subcategory];
    for (const sc of subs) {
      // matches under subcategory
      if (sc.matches) {
        const sm = Array.isArray(sc.matches) ? sc.matches : [sc.matches];
        for (const m of sm) collected.push({ match: m, category: cat, subcategory: sc });
      }
      // nested subcategories (defensive)
      if (sc.subcategory) {
        const deeper = Array.isArray(sc.subcategory) ? sc.subcategory : [sc.subcategory];
        for (const d of deeper) {
          if (d.matches) {
            const dm = Array.isArray(d.matches) ? d.matches : [d.matches];
            for (const m of dm) collected.push({ match: m, category: cat, subcategory: sc, nested: d });
          }
        }
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

    for (const item of extracted) {
      const m = item.match;
      // try multiple possible static id fields
      const staticIdRaw = m.static_id ?? m.staticId ?? m["static-id"] ?? m.id ?? null;
      const static_id = Number(staticIdRaw);
      if (!Number.isFinite(static_id)) {
        // skip entries without a valid numeric static_id
        continue;
      }

      // team fields may be hometeam/visitorteam or hometeam/awayteam depending on feed
      const homeObj = m.hometeam || m.localteam || m.localTeam || m.home || m.homeTeam || null;
      const awayObj = m.awayteam || m.visitorteam || m.visitorTeam || m.away || m.awayTeam || null;

      out.push({
        static_id,
        // optional legacy id
        id: m.id ? Number(m.id) : undefined,
        // category-level metadata
        league: (item.subcategory?.name || item.category?.name || null) || null,
        league_id: item.category?.id ? Number(item.category.id) : null,
        country: item.category?.country || null,
        season: item.category?.season || null,
        stage: m.stage || item.category?.stage || null,
        stage_id: m.stage_id ? Number(m.stage_id) : null,
        gid: m.groupId ? Number(m.groupId) : null,

        date: m.date || m.match_date || null,
        time: m.time || m.match_time || null,
        status: m.status || "scheduled",

        // home / away raw pieces
        homeId: homeObj?.id ? Number(homeObj.id) : null,
        home: homeObj?.name ?? homeObj?.team ?? null,
        homeShortName: homeObj?.short_name ?? null,
        homeCode: homeObj?.code ?? null,
        homeCountry: homeObj?.country ?? null,
        homeLogo: homeObj?.logo ?? null,

        awayId: awayObj?.id ? Number(awayObj.id) : null,
        away: awayObj?.name ?? awayObj?.team ?? null,
        awayShortName: awayObj?.short_name ?? null,
        awayCode: awayObj?.code ?? null,
        awayCountry: awayObj?.country ?? null,
        awayLogo: awayObj?.logo ?? null,
      });
    }
  }

  return out;
}

/* ---------------- Fetch & Store ---------------- */

async function fetchAndStoreUpcomingMatches() {
  console.log("Fetching Goalserve:", GOALSERVE_URL);

  try {
    const resp = await safeGet(GOALSERVE_URL, 3);
    const data = resp?.data;
    // optional debug: uncomment to inspect feed structure
    // console.log("Goalserve raw feed:", JSON.stringify(data, null, 2));

    const matches = parseGoalserveMatches(data);

    if (!matches.length) {
      console.log("⚠️ Goalserve returned 0 matches");
      return { newMatchesCount: 0 };
    }

    let newMatchesCount = 0;

    for (const m of matches) {
      try {
        // parse/normalize date
        const matchDate = parseGoalserveDate(m.date, m.time);

        // Build embedded team objects for Match schema (do NOT insert null names into Team to avoid unique-name error)
        const homeTeamObj = { id: m.homeId ?? null, name: m.home ?? null, logo: m.homeLogo ?? null, score: null, ft_score: null, et_score: null, pen_score: null };
        const awayTeamObj = { id: m.awayId ?? null, name: m.away ?? null, logo: m.awayLogo ?? null, score: null, ft_score: null, et_score: null, pen_score: null };

        // If team names exist, upsert Team records by name (safe because Team schema enforces `name` unique and we skip null)
        let homeTeamRecord = null;
        let awayTeamRecord = null;

        if (m.home) {
          homeTeamRecord = await Team.findOneAndUpdate(
            { name: m.home },
            { name: m.home, logoUrl: m.homeLogo ?? null },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }

        if (m.away) {
          awayTeamRecord = await Team.findOneAndUpdate(
            { name: m.away },
            { name: m.away, logoUrl: m.awayLogo ?? null },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }

        // Prepare match document object matching your Match schema (embedded team objects)
        const matchDoc = {
          static_id: Number(m.static_id),
          ...(m.id !== undefined && { id: Number(m.id) }),
          league_id: m.league_id !== null ? Number(m.league_id) : undefined,
          league: m.league || undefined,
          season: m.season || undefined,
          country: m.country || undefined,
          stage: m.stage || undefined,
          stage_id: m.stage_id !== null ? Number(m.stage_id) : undefined,
          gid: m.gid !== null ? Number(m.gid) : undefined,
          date: matchDate || undefined,
          time: m.time || undefined,
          status: m.status || undefined,
          // embed the team (not ObjectId)
          homeTeam: homeTeamObj,
          awayTeam: awayTeamObj,
        };

        // Upsert the match by static_id (only fields defined above to avoid strict-mode errors)
        const updated = await Match.findOneAndUpdate(
          { static_id: matchDoc.static_id },
          matchDoc,
          { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
        );

        // If this was an insert, count it. Mongoose returns the document even when upserted,
        // but there is no reliable boolean to say "insert happened" across versions — so we can
        // check createdAt if your schema timestamps are enabled (they are in your schema).
        if (updated && updated.createdAt && (Date.now() - updated.createdAt.getTime()) < 5000) {
          // newly created in the last 5s
          newMatchesCount++;
        } else {
          // fallback: if no createdAt or older, do not increment
        }
      } catch (innerErr) {
        console.warn("CRON: skipping match due to error:", innerErr.message || innerErr);
        // continue processing remaining matches
      }
    }

    console.log("✅ Total new matches fetched:", newMatchesCount);
    return { newMatchesCount };
  } catch (err) {
    console.error("❌ Goalserve fetch failed:", err.message || err);
    return { newMatchesCount: 0, error: err.message || String(err) };
  }
}

module.exports = {
  fetchAndStoreUpcomingMatches,
};
