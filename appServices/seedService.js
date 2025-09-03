const axios = require('axios');
const Match = require('../models/Match');
const Team = require('../models/Team');
const { FOOTBALL_JSON_SOURCES } = require('../utils/dataSources');

/**
 * Service for seeding match data
 * @type {Object}
 */
const seedService = {
  /**
   * Seeds initial team data into the database from football.json data
   * @returns {Promise<{count: number}>}
   */
  async seedTeams() {
    console.log('🌱 Starting team seeding process from football.json...');
    
    try {
      let allTeams = new Set();

      for (const [leagueCode, league] of Object.entries(FOOTBALL_JSON_SOURCES)) {
        console.log(`📥 Fetching teams for ${league.name}...`);
        try {
          const { data } = await axios.get(league.url);

          if (!data.clubs && !data.matches) {
            console.log(`⚠️ No team data found for ${league.name}`);
            continue;
          }

          // Extract teams from clubs if available
          if (data.clubs) {
            data.clubs.forEach(club => {
              allTeams.add(JSON.stringify({
                name: club.name,
                code: club.code,
                country: league.country,
                leagues: [leagueCode]
              }));
            });
          }

          // Extract teams from matches if no clubs data
          if (data.matches) {
            data.matches.forEach(match => {
              allTeams.add(JSON.stringify({
                name: match.team1,
                country: league.country,
                leagues: [leagueCode]
              }));
              allTeams.add(JSON.stringify({
                name: match.team2,
                country: league.country,
                leagues: [leagueCode]
              }));
            });
          }
        } catch (err) {
          console.error(`❌ Error fetching ${league.name} data:`, err.message);
          continue;
        }
      }

      const teams = Array.from(allTeams).map(teamJson => JSON.parse(teamJson));

      if (teams.length === 0) {
        console.log('⚠️ No teams found');
        return { count: 0 };
      }

      // Insert teams with ordered: false to ignore duplicates
      await Team.insertMany(teams.map(team => ({
        name: team.name,
        shortName: team.code || team.name,
        country: team.country,
        leagues: team.leagues
      })), { ordered: false });
      
      console.log(`✅ Seeded ${teams.length} teams successfully`);
      return { count: teams.length };

    } catch (error) {
      console.error('❌ Team seeding failed:', error.message);
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
