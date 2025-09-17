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
    if (cat.matches) {
      const catMatches = Array.isArray(cat.matches)
        ? cat.matches
        : [cat.matches];

      for (const m of catMatches) {
        matches.push({
          static_id: Number(m.id),
          id: m._id ? Number(m._id) : null,
          league: cat.name,
          country: cat.ccountry || null,
          season: m.season || null,
          stage: m.stage?.name || null,
          stage_id: m.stage?.id ? Number(m.stage.id) : null,
          gid: m.stage?.gid ? Number(m.stage.gid) : null,
          groupId: m.groupId ? Number(m.groupId) : null,

          // Match info
          date: m.date,
          time: m.time,
          status: m.status || "Scheduled",

          // Venue
          venue: m.venue || null,
          venue_id: m.venue_id ? Number(m.venue_id) : null,
          venue_city: m.venue_city || null,

          // Teams
          homeTeam: {
            id: m.hometeam?.id ? Number(m.hometeam.id) : null,
            name: m.hometeam?.name || null,
            score: m.hometeam?.score ? Number(m.hometeam.score) : null,
            ft_score: m.hometeam?.ft_score || null,
            et_score: m.hometeam?.et_score || null,
            pen_score: m.hometeam?.pen_score || null,
          },
          awayTeam: {
            id: m.awayteam?.id ? Number(m.awayteam.id) : null,
            name: m.awayteam?.name || null,
            score: m.awayteam?.score ? Number(m.awayteam.score) : null,
            ft_score: m.awayteam?.ft_score || null,
            et_score: m.awayteam?.et_score || null,
            pen_score: m.awayteam?.pen_score || null,
          },

          halftime: m.halftime?.score || null,

          // Goals
          goals: m.goals?.goal
            ? (Array.isArray(m.goals.goal) ? m.goals.goal : [m.goals.goal]).map(
                g => ({
                  team: g.team,
                  minute: g.minute,
                  player: g.player,
                  playerid: g.playerid ? Number(g.playerid) : null,
                  assist: g.assist || null,
                  assistid: g.assistid ? Number(g.assistid) : null,
                  score: g.score,
                })
              )
            : [],

          // Lineups
          lineups: m.lineups?.player
            ? (Array.isArray(m.lineups.player)
                ? m.lineups.player
                : [m.lineups.player]
              ).map(p => ({
                number: p.number ? Number(p.number) : null,
                name: p.name,
                booking: p.booking || null,
                id: p.id ? Number(p.id) : null,
                team: p.team || null,
              }))
            : [],

          // Substitutions
          substitutions: m.substitutions?.substitution
            ? (Array.isArray(m.substitutions.substitution)
                ? m.substitutions.substitution
                : [m.substitutions.substitution]
              ).map(s => ({
                player_in_number: s.player_in_number
                  ? Number(s.player_in_number)
                  : null,
                player_in_name: s.player_in_name,
                player_in_booking: s.player_in_booking || null,
                player_in_id: s.player_in_id ? Number(s.player_in_id) : null,
                player_out_name: s.player_out_name || null,
                player_out_id: s.player_out_id
                  ? Number(s.player_out_id)
                  : null,
                minute: s.minute || null,
                team: s.team || null,
              }))
            : [],

          // Coaches
          coaches: m.coaches?.coach
            ? (Array.isArray(m.coaches.coach)
                ? m.coaches.coach
                : [m.coaches.coach]
              ).map(c => ({
                name: c.name,
                id: c.id ? Number(c.id) : null,
                team: c.team || null,
              }))
            : [],

          // Referees
          referees: m.referees?.referee
            ? (Array.isArray(m.referees.referee)
                ? m.referees.referee
                : [m.referees.referee]
              ).map(r => ({
                name: r.name,
                id: r.id ? Number(r.id) : null,
              }))
            : [],

          // Odds / Stats placeholders
          odds: m.odds || null,
          stats: m.stats || null,
        });
      }
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
      // Save teams
      const homeTeam = await Team.findOneAndUpdate(
        { id: m.homeTeam.id },
        { name: m.homeTeam.name },
        { upsert: true, new: true }
      );
      const awayTeam = await Team.findOneAndUpdate(
        { id: m.awayTeam.id },
        { name: m.awayTeam.name },
        { upsert: true, new: true }
      );

      // Upsert match
      const existing = await Match.findOneAndUpdate(
        { static_id: m.static_id },
        { ...m, homeTeam, awayTeam },
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
