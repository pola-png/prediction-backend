const axios = require('axios');
const Match = require('../models/Match');

const AF_API = "https://v3.football.api-sports.io";

/**
 * Service for seeding match data
 * @type {Object}
 */
const seedService = {
  /**
   * Fetches upcoming matches from API-Football and seeds the database
   * @returns {Promise<{count: number}>}
   */
  async seedUpcomingMatches() {
    console.log('🌱 Starting database seeding process...');
    const afKey = process.env.API_FOOTBALL_KEY;

    if (!afKey) {
      throw new Error('API_FOOTBALL_KEY is required for seeding');
    }

    try {
      console.log('📅 Fetching upcoming matches from API-Football...');
      
      const leagues = [39, 61]; // Premier League, Ligue 1
      let allMatches = [];

      for (const leagueId of leagues) {
        const response = await axios.get(`${AF_API}/fixtures`, {
          headers: { 'x-apisports-key': afKey },
          params: {
            league: leagueId,
            season: 2025,
            status: 'NS'  // Not Started matches
          }
        });

        if (!response.data?.response) continue;

        const matches = response.data.response.map(m => ({
          apiFootballId: m.fixture.id,
          leagueId: leagueId,
          homeTeam: m.teams.home.name,
          awayTeam: m.teams.away.name,
          date: new Date(m.fixture.date),
          status: 'SCHEDULED',
          competition: {
            id: m.league.id,
            name: m.league.name,
            country: m.league.country
          }
        }));

        allMatches = allMatches.concat(matches);
      }

      if (allMatches.length === 0) {
        console.log('⚠️ No upcoming matches found');
        return { count: 0 };
      }

      console.log(`📥 Found ${allMatches.length} upcoming matches`);

      // Use insertMany with ordered: false to ignore duplicates
      await Match.insertMany(allMatches, { ordered: false });
      
      console.log(`✅ Seeded ${allMatches.length} matches successfully`);
      return { count: allMatches.length };

    } catch (error) {
      console.error('❌ Seeding process failed:', error.message);
      if (error.response) {
        console.error('API Response:', error.response.data);
      }
      throw error;
    }
  },

  /**
   * Manually seed a match for testing
   * @param {Object} matchData Match data to seed
   * @returns {Promise<Object>} The saved match
   */
  async seedTestMatch(matchData) {
    try {
      console.log('🌱 Seeding test match...');
      
      const match = new Match({
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        date: new Date(matchData.startTime),
        status: 'SCHEDULED',
        odds: matchData.odds || {
          home: null,
          draw: null,
          away: null
        }
      });

      const saved = await match.save();
      console.log(`✅ Test match saved: ${saved._id}`);
      return saved;
    } catch (error) {
      console.error('❌ Error seeding test match:', error.message);
      throw error;
    }
  }
};

module.exports = seedService;
