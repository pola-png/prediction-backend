const axios = require("axios");

const AF_API = "https://v3.football.api-sports.io";
const FD_API = "https://api.football-data.org/v4";

/**
 * Maps Football-Data.org competition IDs to API-Football league IDs
 */
const LEAGUE_ID_MAP = {
  // Premier League
  'PL': { apiFootball: 39, footballData: 2021 },
  // La Liga
  'PD': { apiFootball: 140, footballData: 2014 },
  // Bundesliga
  'BL1': { apiFootball: 78, footballData: 2002 },
  // Serie A
  'SA': { apiFootball: 135, footballData: 2019 },
  // Ligue 1
  'FL1': { apiFootball: 61, footballData: 2015 }
};

/**
 * Fetches matches from both APIs with fallback
 * @param {string} leagueCode - League code (PL, PD, etc)
 * @returns {Promise<Array>} Array of normalized match objects
 */
async function fetchMatchesFromApi(leagueCode) {
  const leagueIds = LEAGUE_ID_MAP[leagueCode];
  if (!leagueIds) {
    throw new Error(`Invalid league code: ${leagueCode}`);
  }

  console.log(`📡 Fetching matches for ${leagueCode}...`);
  
  try {
    // Try API-Football first
    console.log(`🎯 Trying API-Football (league ${leagueIds.apiFootball})...`);
    const apiFootballRes = await axios.get(`${AF_API}/fixtures`, {
      params: { 
        league: leagueIds.apiFootball, 
        season: 2025,
        status: 'NS-PST-LIVE' // Not Started, Postponed, and Live matches
      },
      headers: { 
        'x-rapidapi-host': 'v3.football.api-sports.io',
        'x-rapidapi-key': process.env.API_FOOTBALL_KEY 
      }
    });

    if (apiFootballRes.data?.response?.length > 0) {
      console.log(`✅ Got ${apiFootballRes.data.response.length} matches from API-Football`);
      return apiFootballRes.data.response.map(match => ({
        apiFootballId: match.fixture.id,
        leagueId: leagueIds.apiFootball,
        homeTeam: match.teams.home.name,
        awayTeam: match.teams.away.name,
        date: new Date(match.fixture.date),
        status: 'SCHEDULED',
        competition: {
          id: match.league.id,
          name: match.league.name,
          country: match.league.country
        },
        venue: {
          name: match.fixture.venue.name,
          city: match.fixture.venue.city
        }
      }));
    }
  } catch (err) {
    console.warn("⚠️ API-Football failed, falling back:", err.message);
    if (err.response) {
      console.warn("API-Football response:", err.response.data);
    }
  }

  // Fallback → Football-Data.org
  try {
    console.log(`🎯 Trying Football-Data.org (competition ${leagueIds.footballData})...`);
    const footballDataRes = await axios.get(
      `${FD_API}/competitions/${leagueIds.footballData}/matches?status=SCHEDULED`,
      { 
        headers: { 
          "X-Auth-Token": process.env.FOOTBALL_DATA_KEY 
        }
      }
    );

    if (footballDataRes.data?.matches?.length > 0) {
      console.log(`✅ Got ${footballDataRes.data.matches.length} matches from Football-Data.org`);
      return footballDataRes.data.matches.map(match => ({
        fdApiId: match.id,
        leagueId: leagueIds.footballData,
        homeTeam: match.homeTeam.name,
        awayTeam: match.awayTeam.name,
        date: new Date(match.utcDate),
        status: 'SCHEDULED',
        competition: {
          id: match.competition.id,
          name: match.competition.name,
          country: match.competition.area.name
        }
      }));
    }
  } catch (err) {
    console.warn("⚠️ Football-Data.org fallback failed:", err.message);
    if (err.response) {
      console.warn("Football-Data.org response:", err.response.data);
    }
  }

  console.log('❌ No matches found from either API');
  return []; // no matches found
}

module.exports = { fetchMatchesFromApi, LEAGUE_ID_MAP };
