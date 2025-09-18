import axios from "axios";
import Match from "../models/Match.js";

export const fetchMatches = async () => {
  try {
    console.log("Fetching Goalserve: https://www.goalserve.com/getfeed/fdc97ba4c57b4de23f4808ddf528229c/soccernew/home?json=true");

    const { data } = await axios.get(
      "https://www.goalserve.com/getfeed/fdc97ba4c57b4de23f4808ddf528229c/soccernew/home?json=true"
    );

    let matches = [];

    // Extract matches from Goalserve structure
    if (data && data.sport && data.sport[0]?.category) {
      data.sport[0].category.forEach((cat) => {
        if (cat.match) {
          matches.push(...cat.match);
        }
      });
    }

    console.log(`✅ Total matches processed: ${matches.length}`);

    let newCount = 0;

    for (const m of matches) {
      try {
        // Build a unique key (static_id || id || fix_id)
        const unique_key = m.static_id || m.id || m.fix_id || `fallback_${Date.now()}_${Math.random()}`;

        const setObj = {
          static_id: m.static_id || null,
          league: m.league || "",
          league_id: m.league_id || "",
          date: m.date ? new Date(m.date) : null,
          matchDateUtc: m.matchDateUtc ? new Date(m.matchDateUtc) : null,
          status: m.status || "",
          localteam: m.localteam || {},
          visitorteam: m.visitorteam || {},
          goals: m.goals || [],
          injuries: m.injuries || [],
          substitutions: m.substitutions || [],
          lineups: m.lineups || [],
          coaches: m.coaches || [],
          referees: m.referees || [],
          updatedAt: new Date(),
        };

        const res = await Match.findOneAndUpdate(
          { unique_key },
          { $set: setObj, $setOnInsert: { createdAt: new Date(), unique_key } },
          { upsert: true, new: true, rawResult: true }
        );

        if (res.lastErrorObject?.upserted) newCount++;
      } catch (err) {
        console.error("CRON: skipping match due to error:", err.message);
      }
    }

    console.log(`✅ Total new matches fetched: ${newCount}`);
  } catch (err) {
    console.error("❌ Failed to fetch matches:", err.message);
  }
};
