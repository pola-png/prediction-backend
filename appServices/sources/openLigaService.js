const axios = require('axios');

const API_URL = "https://api.openligadb.de";
const LEAGUES = {
    'bl1': 'Bundesliga',
    'pl': 'Premier League',
    'pd': 'La Liga'
};

async function getMatches() {
    try {
        const matches = [];
        
        for (const [leagueId, leagueName] of Object.entries(LEAGUES)) {
            console.log(`📡 Fetching ${leagueName} matches from OpenLigaDB...`);
            const { data } = await axios.get(`${API_URL}/getmatchdata/${leagueId}`);
            
            const liveMatches = data.map(m => ({
                matchId: `${leagueName}-${m.team1.teamName}-${m.team2.teamName}-${m.matchDateTime}`.toLowerCase().replace(/\s+/g, '-'),
                competition: leagueName,
                homeTeam: m.team1.teamName,
                awayTeam: m.team2.teamName,
                date: new Date(m.matchDateTime),
                status: m.matchIsFinished ? "completed" : (m.matchIsRunning ? "live" : "scheduled"),
                score: m.matchIsFinished || m.matchIsRunning ? {
                    homeTeam: m.matchResults?.[0]?.pointsTeam1 || 0,
                    awayTeam: m.matchResults?.[0]?.pointsTeam2 || 0
                } : undefined,
                source: "openligadb",
                lastUpdated: new Date()
            }));
            
            matches.push(...liveMatches);
        }
        
        console.log(`✅ Found ${matches.length} matches from OpenLigaDB`);
        return matches;
    } catch (err) {
        console.error("❌ Error fetching from OpenLigaDB:", err.message);
        return [];
    }
}

module.exports = { getMatches };
