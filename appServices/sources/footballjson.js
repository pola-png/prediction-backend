const axios = require('axios');

const OPENFOOTBALL_BASE = "https://raw.githubusercontent.com/openfootball/football.json/master";
const LEAGUES = {
  'PL': '2023-24/en.1.json',
  'LaLiga': '2023-24/es.1.json',
  'Bundesliga': '2023-24/de.1.json'
};

async function load() {
  try {
    const matches = [];
    
    for (const [league, path] of Object.entries(LEAGUES)) {
      const { data } = await axios.get(`${OPENFOOTBALL_BASE}/${path}`);
      
      const leagueMatches = data.matches.map(m => ({
        matchId: `${league}-${m.team1}-${m.team2}-${m.date}`.toLowerCase().replace(/\s+/g, '-'),
        competition: league,
        homeTeam: m.team1,
        awayTeam: m.team2,
        date: new Date(m.date),
        status: "scheduled",
        source: "footballjson",
        season: "2023-24"
      }));
      
      matches.push(...leagueMatches);
    }
    
    return matches;
  } catch (err) {
    console.error("❌ Failed to load from football.json:", err.message);
    return [];
  }
}

module.exports = { load };
