const axios = require('axios');

const GITHUB_DATASET_URL = "https://raw.githubusercontent.com/openfootball/football.json/master/archive";
const SEASONS = ["2020-21", "2021-22", "2022-23"];

async function loadHistorical() {
  try {
    const matches = [];
    
    for (const season of SEASONS) {
      // Load Premier League historical data
      const { data } = await axios.get(`${GITHUB_DATASET_URL}/${season}/en.1.json`);
      
      const seasonMatches = data.matches.map(m => ({
        matchId: `PL-${m.team1}-${m.team2}-${m.date}`.toLowerCase().replace(/\s+/g, '-'),
        competition: "Premier League",
        homeTeam: m.team1,
        awayTeam: m.team2,
        date: new Date(m.date),
        status: "completed",
        score: {
          homeTeam: m.score?.ft?.[0] || 0,
          awayTeam: m.score?.ft?.[1] || 0
        },
        source: "github-archive",
        season
      }));
      
      matches.push(...seasonMatches);
    }
    
    return matches;
  } catch (err) {
    console.error("❌ Failed to load historical data:", err.message);
    return [];
  }
}

module.exports = { loadHistorical };
