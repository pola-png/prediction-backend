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
   * @returns {Promise<{fetched: number, saved: number}>}
   */
  async seedUpcomingMatches() {
    console.log('🌱 Starting database seeding process...');
    const afKey = process.env.API_FOOTBALL_KEY;

    if (!afKey) {
      throw new Error('API_FOOTBALL_KEY is required for seeding');
    }

    try {
      console.log('📅 Fetching upcoming matches from API-Football...');
      
      // Get matches for next 7 days
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(today.getDate() + 7);

      const response = await axios.get(`${AF_API}/fixtures`, {
        headers: { 'x-apisports-key': afKey },
        params: {
          from: today.toISOString().split('T')[0],
          to: nextWeek.toISOString().split('T')[0],
          status: 'NS', // Not Started matches
          league: '39', // Premier League (you can add more leagues)
          timezone: 'UTC'
        }
      });

      if (!response.data?.response?.length) {
        console.log('⚠️ No upcoming matches found');
        return { fetched: 0, saved: 0 };
      }

      const matches = response.data.response;
      console.log(`📥 Found ${matches.length} upcoming matches`);

      let saved = 0;
      const errors = [];

      for (const match of matches) {
        try {
          const existingMatch = await Match.findOne({ apiFootballId: match.fixture.id });
          
          if (existingMatch) {
            console.log(`⏩ Match ${match.fixture.id} already exists, skipping...`);
            continue;
          }

          const newMatch = new Match({
            apiFootballId: match.fixture.id,
            homeTeam: match.teams.home.name,
            awayTeam: match.teams.away.name,
            date: new Date(match.fixture.date),
            status: 'SCHEDULED',
            odds: {
                home: match.odds?.bookmakers?.[0]?.bets?.[0]?.values?.[0]?.odd || null,
                draw: match.odds?.bookmakers?.[0]?.bets?.[0]?.values?.[1]?.odd || null,
                away: match.odds?.bookmakers?.[0]?.bets?.[0]?.values?.[2]?.odd || null
            },
            competition: {
              id: match.league.id,
              name: match.league.name,
              country: match.league.country
            },
            venue: {
              name: match.fixture.venue.name,
              city: match.fixture.venue.city
            }
          });

          await newMatch.save();
          saved++;
          console.log(`✅ Saved match: ${match.teams.home.name} vs ${match.teams.away.name}`);
        } catch (err) {
          console.error(`❌ Error saving match ${match.fixture.id}:`, err.message);
          errors.push({ id: match.fixture.id, error: err.message });
        }
      }

      const summary = `
🎯 Seeding Summary
=================
Matches fetched: ${matches.length}
Matches saved:  ${saved}
Errors:         ${errors.length}
=================`;

      console.log(summary);

      if (errors.length > 0) {
        console.log('⚠️ Errors encountered:', errors);
      }

      return {
        fetched: matches.length,
        saved,
        errors: errors.length > 0 ? errors : undefined
      };

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
      
      const existingMatch = await Match.findOne({ 
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        date: new Date(matchData.startTime)
      });

      if (existingMatch) {
        console.log('⚠️ Test match already exists');
        return existingMatch;
      }

      const match = new Match({
        homeTeam: matchData.homeTeam,
        awayTeam: matchData.awayTeam,
        date: new Date(matchData.startTime),
        status: matchData.status || 'SCHEDULED',
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
