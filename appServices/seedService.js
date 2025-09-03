const axios = require('axios');
const Match = require('../models/Match');
const Team = require('../models/Team');
const { FOOTBALL_DATA_SOURCES } = require('../utils/dataSources');

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
          headers: {
            'x-rapidapi-host': 'v3.football.api-sports.io',
            'x-rapidapi-key': afKey
          },
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
   * Seeds matches from OpenFootball JSON data
   * @returns {Promise<{count: number, errors: number}>}
   */
  async seedUpcomingMatches() {
    console.log('🌱 Starting database seeding process from football.json...');

    try {
      console.log('📅 Fetching matches from football.json sources...');
      
      let totalMatches = 0;
      let errorCount = 0;

      for (const [leagueCode, dataUrl] of Object.entries(FOOTBALL_DATA_SOURCES)) {
        console.log(`\n📊 Processing ${leagueCode} from ${dataUrl}...`);
        
        try {
          const { data } = await axios.get(dataUrl);

          if (!data.matches || data.matches.length === 0) {
            console.log(`⚠️ No matches found for ${leagueCode}`);
            continue;
          }

          console.log(`Found ${data.matches.length} matches for ${leagueCode}`);

          for (const match of data.matches) {
            try {
              const matchId = `${match.date}_${match.team1}_${match.team2}`;
              
              await Match.updateOne(
                { matchId },
                {
                  matchId,
                  date: new Date(match.date),
                  homeTeam: match.team1,
                  awayTeam: match.team2,
                  score: match.score ? {
                    home: match.score.ft[0],
                    away: match.score.ft[1]
                  } : null,
                  status: match.score ? 'FINISHED' : 'SCHEDULED',
                  competition: {
                    code: leagueCode,
                    name: data.name || `League ${leagueCode}`
                  },
                  updatedAt: new Date()
                },
                { upsert: true }
              );

              totalMatches++;
            } catch (err) {
              console.error(`❌ Error processing match: ${err.message}`);
              errorCount++;
            }
          }
        } catch (err) {
          console.error(`❌ Error fetching ${leagueCode} data:`, err.message);
          errorCount++;
        }
      }

      const summary = `
📊 Seeding Summary
=================
Total matches processed: ${totalMatches}
Errors encountered: ${errorCount}
=================`;
      
      console.log(summary);
      return { count: totalMatches, errors: errorCount };

    } catch (error) {
      console.error('❌ Seeding process failed:', error.message);
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
      
      const matchId = `${matchData.date}_${matchData.homeTeam}_${matchData.awayTeam}`;
      
      const match = await Match.findOneAndUpdate(
        { matchId },
        {
          matchId,
          date: new Date(matchData.date),
          homeTeam: matchData.homeTeam,
          awayTeam: matchData.awayTeam,
          status: 'SCHEDULED',
          updatedAt: new Date()
        },
        { upsert: true, new: true }
      );

      console.log(`✅ Test match created: ${match.matchId}`);
      return match;
    } catch (error) {
      console.error('❌ Error creating test match:', error.message);
      throw error;
    }
  }
};

module.exports = seedService;
