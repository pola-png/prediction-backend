const Match = require('../models/Match');
const Team = require('../models/Team');
const footballJsonService = require('./sources/footballJsonService');
const openLigaService = require('./sources/openLigaService');


class SeedService {
  /**
   * Seed matches from configured data sources
   */
  async seedMatches() {
    try {
      let matches = [];
      const sources = process.env.FOOTBALL_DATA_SOURCES?.split(',').map(s => s.trim()) || ['footballjson'];

      // Get matches from football.json
      if (sources.includes('footballjson')) {
        console.log('📥 Fetching matches from football.json...');
        const jsonMatches = await footballJsonService.getMatches();
        matches = matches.concat(jsonMatches);
      }

      // Get matches from OpenLigaDB
      if (sources.includes('openligadb')) {
        console.log('📡 Fetching matches from OpenLigaDB...');
        const liveMatches = await openLigaService.getMatches();
        matches = this.mergeMatches(matches, liveMatches);
      }

      if (matches.length === 0) {
        console.log("⚠️ No matches found from configured sources");
        return { count: 0 };
      }

      console.log(`🔄 Upserting ${matches.length} matches to database...`);
      // Use bulkWrite for upsert operation
      const operations = matches.map(match => ({
        updateOne: {
          filter: { matchId: match.matchId },
          update: { $set: match },
          upsert: true
        }
      }));

      const result = await Match.bulkWrite(operations);
      console.log('✅ Database update completed:', result);
      return {
        count: matches.length,
        modified: result.modifiedCount,
        upserted: result.upsertedCount
      };
    } catch (err) {
      console.error("❌ Failed to seed matches:", err);
      throw err;
    }
  }

  /**
   * Merge matches, preferring live data over static data
   */
  mergeMatches(baseMatches, liveMatches) {
    const matchMap = new Map();
    // Index base matches
    baseMatches.forEach(match => {
      matchMap.set(match.matchId, match);
    });
    // Overlay live matches
    liveMatches.forEach(match => {
      if (matchMap.has(match.matchId)) {
        // Update existing match with live data
        matchMap.set(match.matchId, {
          ...matchMap.get(match.matchId),
          ...match,
          lastUpdated: new Date()
        });
      } else {
        // Add new match
        matchMap.set(match.matchId, match);
      }
    });
    return Array.from(matchMap.values());
  }

  /**
   * Seed teams from match data
   */
  async seedTeams() {
    try {
      const matches = await Match.find({}, { homeTeam: 1, awayTeam: 1 });
      const teamNames = new Set();
      matches.forEach(match => {
        teamNames.add(match.homeTeam);
        teamNames.add(match.awayTeam);
      });
      const teams = Array.from(teamNames).map(name => ({
        name,
        updatedAt: new Date()
      }));
      const operations = teams.map(team => ({
        updateOne: {
          filter: { name: team.name },
          update: { $set: team },
          upsert: true
        }
      }));
      const result = await Team.bulkWrite(operations);
      return {
        count: teams.length,
        modified: result.modifiedCount,
        upserted: result.upsertedCount
      };
    } catch (err) {
      console.error("❌ Failed to seed teams:", err);
      throw err;
    }
  }
}


// Merge matches, preferring live data over static data
function mergeMatches(baseMatches, liveMatches) {
    const matchMap = new Map();
    
    // Index base matches
    baseMatches.forEach(match => {
        matchMap.set(match.matchId, match);
    });
    
    // Overlay live matches
    liveMatches.forEach(match => {
        if (matchMap.has(match.matchId)) {
            // Update existing match with live data
            matchMap.set(match.matchId, {
                ...matchMap.get(match.matchId),
                ...match,
                lastUpdated: new Date()
            });
        } else {
            // Add new match
            matchMap.set(match.matchId, match);
        }
    });
    
    return Array.from(matchMap.values());
}

// Export all required functions
module.exports = {
    seedMatches,
    seedTeams: async () => {
        // Implement team seeding logic here if needed
        return { count: 0 };
    }
};

/**
 * Service for seeding match data using football.json
 */
class SeedService {
  constructor() {
    this.sources = {
      'PL': {
        url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/en.1.json',
        name: 'Premier League',
        country: 'England'
      },
      'BL': {
        url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/de.1.json',
        name: 'Bundesliga',
        country: 'Germany'
      },
      'SA': {
        url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/it.1.json',
        name: 'Serie A',
        country: 'Italy'
      },
      'LL': {
        url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/es.1.json',
        name: 'La Liga',
        country: 'Spain'
      },
      'L1': {
        url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/fr.1.json',
        name: 'Ligue 1',
        country: 'France'
      }
    };
  }

  /**
   * Seeds initial team data into the database from football.json data
   * @returns {Promise<{count: number}>}
   */
  async seedTeams() {
    console.log('🌱 Starting team seeding process from football.json...');
    
    try {
      let allTeams = new Set();

      for (const [leagueCode, league] of Object.entries(this.sources)) {
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
  }

  /**
   * Seeds matches from football.json data
   * @returns {Promise<{count: number, errors: number}>}
   */
  async seedUpcomingMatches() {
    console.log('🌱 Starting database seeding process from football.json...');

    try {
      let totalMatches = 0;
      let errorCount = 0;

      for (const [leagueCode, source] of Object.entries(this.sources)) {
        console.log(`\n📊 Processing ${source.name}...`);
        
        try {
          console.log(`📥 Fetching data from: ${source.url}`);
          const { data } = await axios.get(source.url);

          if (!data.matches || data.matches.length === 0) {
            console.log(`⚠️ No matches found for ${source.name}`);
            continue;
          }

          console.log(`Found ${data.matches.length} matches for ${source.name}`);

          for (const match of data.matches) {
            try {
              // Find or create teams
              const [homeTeam, awayTeam] = await Promise.all([
                Team.findOneAndUpdate(
                  { name: match.team1 },
                  { 
                    name: match.team1,
                    leagues: [leagueCode],
                    country: source.country
                  },
                  { upsert: true, new: true }
                ),
                Team.findOneAndUpdate(
                  { name: match.team2 },
                  { 
                    name: match.team2,
                    leagues: [leagueCode],
                    country: source.country
                  },
                  { upsert: true, new: true }
                )
              ]);

              // Create or update match
              await Match.updateOne(
                {
                  date: new Date(match.date),
                  homeTeam: homeTeam._id,
                  awayTeam: awayTeam._id
                },
                {
                  date: new Date(match.date),
                  homeTeam: homeTeam._id,
                  awayTeam: awayTeam._id,
                  score: match.score ? {
                    home: match.score.ft[0],
                    away: match.score.ft[1]
                  } : null,
                  status: match.score ? 'FINISHED' : 'SCHEDULED',
                  competition: {
                    code: leagueCode,
                    name: source.name,
                    country: source.country
                  },
                  updatedAt: new Date()
                },
                { upsert: true }
              );

              totalMatches++;
              console.log(`✅ Processed: ${match.team1} vs ${match.team2}`);
            } catch (err) {
              console.error(`❌ Error processing match: ${err.message}`);
              errorCount++;
            }
          }
        } catch (err) {
          console.error(`❌ Error fetching ${source.name} data:`, err.message);
          errorCount++;
        }
      }

      console.log(`
📊 Seeding Summary
=================
Total matches processed: ${totalMatches}
Errors encountered: ${errorCount}
=================`);
      
      return { count: totalMatches, errors: errorCount };

    } catch (error) {
      console.error('❌ Seeding process failed:', error.message);
      throw error;
    }
  }

  /**
   * Manually seed a match for testing
   * @param {Object} matchData Match data to seed
   * @returns {Promise<Object>} The saved match
   */
  async seedTestMatch(matchData) {
    try {
      console.log('🌱 Seeding test match...');
      
      // Find or create teams
      const [homeTeam, awayTeam] = await Promise.all([
        Team.findOneAndUpdate(
          { name: matchData.homeTeam },
          { name: matchData.homeTeam },
          { upsert: true, new: true }
        ),
        Team.findOneAndUpdate(
          { name: matchData.awayTeam },
          { name: matchData.awayTeam },
          { upsert: true, new: true }
        )
      ]);

      const match = new Match({
        homeTeam: homeTeam._id,
        awayTeam: awayTeam._id,
        date: new Date(matchData.date),
        status: 'SCHEDULED',
        competition: matchData.competition || {
          code: 'TEST',
          name: 'Test Match'
        },
        updatedAt: new Date()
      });

      const saved = await match.save();
      console.log(`✅ Test match saved: ${saved._id}`);
      return saved;
    } catch (error) {
      console.error('❌ Error seeding test match:', error.message);
      throw error;
    }
  }
}

module.exports = new SeedService();
