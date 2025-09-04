const axios = require('axios');
const Match = require('../models/Match');
const Team = require('../models/Team');

// football.json sample repo
const OPENFOOTBALL_BASE = "https://raw.githubusercontent.com/openfootball/football.json/master";

async function seedMatchesFromOpenFootball() {
  try {
    const seasonUrl = `${OPENFOOTBALL_BASE}/2023-24/en.1.json`; // Premier League example
    const { data } = await axios.get(seasonUrl);

    const matches = data.matches.map(m => ({
      homeTeam: m.team1,
      awayTeam: m.team2,
      date: new Date(m.date),
      status: "upcoming",
      source: "openfootball"
    }));

    await Match.insertMany(matches, { ordered: false });
    return { inserted: matches.length };
  } catch (err) {
    console.error("❌ Failed to seed matches:", err.message);
    return { error: err.message };
  }
}

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
