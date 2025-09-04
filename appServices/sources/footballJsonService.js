const axios = require('axios');

const BASE_URL = "https://raw.githubusercontent.com/openfootball/football.json/master";
const LEAGUES = {
    'PL': '2023-24/en.1.json',
    'LaLiga': '2023-24/es.1.json',
    'Bundesliga': '2023-24/de.1.json'
};

async function getMatches() {
    try {
        const matches = [];
        
        for (const [league, path] of Object.entries(LEAGUES)) {
            console.log(`📥 Fetching ${league} matches from football.json...`);
            const { data } = await axios.get(`${BASE_URL}/${path}`);
            
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
        
        console.log(`✅ Found ${matches.length} matches from football.json`);
        return matches;
    } catch (err) {
        console.error("❌ Error fetching from football.json:", err.message);
        return [];
    }
}

module.exports = { getMatches };
