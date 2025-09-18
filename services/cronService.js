import axios from "axios";
import mongoose from "mongoose";
const unique_key = new mongoose.Types.ObjectId().toString();
import Match from "../models/Match.js";

export const fetchMatches = async () => {
  try {
    console.log("Fetching Goalserve feed...");

    const { data } = await axios.get(
      "https://www.goalserve.com/getfeed/fdc97ba4c57b4de23f4808ddf528229c/soccernew/home?json=true"
    );

    let matches = [];

    if (data?.sport?.[0]?.category) {
      data.sport[0].category.forEach((cat) => {
        if (cat.match) matches.push(...cat.match);
      });
    }

    console.log(`✅ Total matches processed: ${matches.length}`);
    let newCount = 0;

    for (const m of matches) {
      try {
        // Always generate our own unique key (ignore Goalserve IDs)
        const unique_key = new mongoose.Types.ObjectId().toString();

        const doc = {
          unique_key,
          static_id: m.static_id || null,
          id: m.id || null,
          fix_id: m.fix_id || null,
          league: m.league || "",
          league_id: m.league_id || "",
          date: m.date ? new Date(m.date) : null,
          matchDateUtc: m.matchDateUtc ? new Date(m.matchDateUtc) : null,
          status: m.status || "",
          homeTeam: m.localteam || {},
          awayTeam: m.visitorteam || {},
          goals: m.goals || [],
          lineups: m.lineups || [],
          substitutions: m.substitutions || [],
          coaches: m.coaches || [],
          referees: m.referees || [],
          odds: m.odds || {},
          stats: m.stats || {},
          injuries: m.injuries || [],
          h2h: m.h2h || {},
          history: m.history || {},
          updatedAt: new Date(),
        };

        await Match.create(doc);
        newCount++;
      } catch (err) {
        console.error("CRON: skipping match due to error:", err.message);
      }
    }

    console.log(`✅ Total new matches saved: ${newCount}`);
  } catch (err) {
    console.error("❌ Failed to fetch matches:", err.message);
  }
};
