const axios = require('axios');
const Match = require('../models/Match');
const Team = require('../models/Team');

const AF_API = "https://v3.football.api-sports.io";

/**
 * Service for seeding match data
 * @type {Object}
 */
const seedService = {
  /**
   * Seeds initial team data into the database
   * @returns {Promise<{count: number}>}
   */
  async seedTeams() {
    console.log('🌱 Starting team seeding process...');
    const afKey = process.env.API_FOOTBALL_KEY;

    if (!afKey) {
      throw new Error('API_FOOTBALL_KEY is required for seeding');
    }

    try {
      const leagues = [39, 61]; // Premier League, Ligue 1
      let allTeams = [];

      for (const leagueId of leagues) {
        console.log(`📥 Fetching teams for league ${leagueId}...`);
        const response = await axios.get(`${AF_API}/teams`, {
          headers: { 'x-apisports-key': afKey },
          params: {
            league: leagueId,
            season: 2025
          }
        });

        if (!response.data?.response) continue;

        const teams = response.data.response.map(t => ({
          apiFootballId: t.team.id,
          name: t.team.name,
          shortName: t.team.code || t.team.name,
          logo: t.team.logo,
          leagueId: leagueId,
          venue: {
            name: t.venue?.name || null,
            city: t.venue?.city || null,
            capacity: t.venue?.capacity || null
          }
        }));

        allTeams = allTeams.concat(teams);
      }

      if (allTeams.length === 0) {
        console.log('⚠️ No teams found');
        return { count: 0 };
      }

      // Insert teams with ordered: false to ignore duplicates
      await Team.insertMany(allTeams, { ordered: false });
      
      console.log(`✅ Seeded ${allTeams.length} teams successfully`);
      return { count: allTeams.length };

    } catch (error) {
      console.error('❌ Team seeding failed:', error.message);
      if (error.response) {
        console.error('API Response:', error.response.data);
      }
      throw error;
    }
  },

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

        // Find teams in our database
        const matches = [];
        for (const m of response.data.response) {
          const homeTeam = await Team.findOne({ apiFootballId: m.teams.home.id });
          const awayTeam = await Team.findOne({ apiFootballId: m.teams.away.id });
          
          if (!homeTeam || !awayTeam) {
            console.log(`⚠️ Skipping match ${m.fixture.id} - teams not found in database`);
            continue;
          }

          matches.push({
            apiFootballId: m.fixture.id,
            leagueId: leagueId,
            homeTeam: homeTeam._id,
            awayTeam: awayTeam._id,
            date: new Date(m.fixture.date),
            status: 'SCHEDULED',
            competition: {
              id: m.league.id,
              name: m.league.name,
              country: m.league.country
            }
          });
        }

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
