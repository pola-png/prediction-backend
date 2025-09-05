const axios = require('axios');

const OPENLIGA_API = "https://api.openligadb.de/getmatchdata";
const LEAGUES = {
  'bl1': 'Bundesliga',
  'pl': 'Premier League',
  'pd': 'La Liga'
};

async function fetchLive() {
  try {
    const matches = [];
    
    for (const [leagueId, leagueName] of Object.entries(LEAGUES)) {
      const { data } = await axios.get(`${OPENLIGA_API}/${leagueId}`);
      
      const liveMatches = data
        .filter(m => m.matchIsFinished || m.matchIsRunning)
        .map(m => ({
          matchId: `${leagueName}-${m.team1.teamName}-${m.team2.teamName}-${m.matchDateTime}`.toLowerCase().replace(/\s+/g, '-'),
          competition: leagueName,
          homeTeam: m.team1.teamName,
          awayTeam: m.team2.teamName,
          date: new Date(m.matchDateTime),
          status: m.matchIsFinished ? "completed" : "live",
          score: {
            homeTeam: m.matchResults?.[0]?.pointsTeam1 || 0,
            awayTeam: m.matchResults?.[0]?.pointsTeam2 || 0
          },
          source: "openligadb",
          lastUpdated: new Date()
        }));
      
      matches.push(...liveMatches);
    }
    
    return matches;
  } catch (err) {
    console.error("❌ Failed to fetch from OpenLigaDB:", err.message);
    return [];
  }
}

module.exports = { fetchLive };
