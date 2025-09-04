const footballJSON = require("./sources/footballjson");
const openLigaDB = require("./sources/openligadb");
const githubArchive = require("./sources/github-archive");
const Match = require("../models/Match");

// Seed current season matches and overlay live data
async function seedMatches(sources) {
  let allMatches = [];

  if (sources.includes("footballjson")) {
    console.log("📥 Seeding from football.json...");
    const jsonMatches = await footballJSON.load();
    allMatches = allMatches.concat(jsonMatches);
  }

  if (sources.includes("openligadb")) {
    console.log("📡 Overlaying live data from OpenLigaDB...");
    const liveMatches = await openLigaDB.fetchLive();
    allMatches = mergeMatches(allMatches, liveMatches);
  }

  // Bulk upsert using Mongoose
  const operations = allMatches.map(match => ({
    updateOne: {
      filter: { matchId: match.matchId },
      update: { $set: match },
      upsert: true
    }
  }));

  if (operations.length > 0) {
    await Match.bulkWrite(operations);
  }

  console.log(`✅ Seeded/updated ${allMatches.length} matches`);
  return allMatches.length;
}

// Bulk seed historical data
async function seedHistorical() {
  console.log("📚 Loading historical match data...");
  const historicalMatches = await githubArchive.loadHistorical();
  console.log(`Found ${historicalMatches.length} historical matches`);

  if (historicalMatches.length > 0) {
    const operations = historicalMatches.map(match => ({
      updateOne: {
        filter: { matchId: match.matchId },
        update: { $set: match },
        upsert: true
      }
    }));

    await Match.bulkWrite(operations);
  }

  return historicalMatches.length;
}

// Merge matches preferring live data
function mergeMatches(base, live) {
  const map = new Map();
  base.forEach(m => map.set(m.matchId, m));
  live.forEach(m => {
    if (map.has(m.matchId)) {
      map.set(m.matchId, { ...map.get(m.matchId), ...m });
    } else {
      map.set(m.matchId, m);
    }
  });
  return Array.from(map.values());
}

module.exports = { seedMatches, seedHistorical };
