const axios = require('axios');
const Result = require('../models/Result');
const Match = require('../models/Match');

const FD_API = "https://api.football-data.org/v4";
const AF_API = "https://v3.football.api-sports.io";

const resultService = {
  // Cron job functions
  async updateAllResults() {
    console.log('📊 Starting match results update...');
    const afKey = process.env.API_FOOTBALL_KEY;
    const fdKey = process.env.FOOTBALL_DATA_KEY;

    if (!afKey && !fdKey) {
      throw new Error('No API keys configured for result updates');
    }

    try {
      // Get matches that need updating with optimized query
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      
      const matches = await Match.find({
        $or: [
          // Recently started or in-progress matches
          {
            status: { $in: ['SCHEDULED', 'LIVE', 'IN_PLAY', 'PAUSED'] },
            date: { 
              $lte: new Date(),
              $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
            }
          },
          // Recently updated matches that might need final score
          {
            updatedAt: { $gte: thirtyMinutesAgo },
            status: { $ne: 'FINISHED' }
          }
        ]
      })
      .select('_id apiFootballId fdApiId homeTeam awayTeam date status updatedAt')
      .limit(50) // Process in batches
      .sort({ date: 1 }); // Oldest first

      console.log(`Found ${matches.length} matches to check for updates`);
      
      const updateResults = {
        total: matches.length,
        updated: 0,
        failed: 0,
        skipped: 0
      };

      for (const match of matches) {
        try {
          let resultFound = false;

          // Try API-Football first
          if (afKey && match.apiFootballId) {
            try {
              const afResponse = await axios.get(`${AF_API}/fixtures?id=${match.apiFootballId}`, {
                headers: { 'x-apisports-key': afKey }
              });

              if (afResponse.data?.response?.[0]) {
                const fixtureData = afResponse.data.response[0];
                if (fixtureData.fixture.status.short === 'FT') {
                  await this.processFinishedMatch(match, {
                    source: 'API_FOOTBALL',
                    homeScore: fixtureData.goals.home,
                    awayScore: fixtureData.goals.away,
                    status: 'FINISHED'
                  });
                  resultFound = true;
                  updateResults.updated++;
                }
              }
            } catch (err) {
              console.warn(`API-Football update failed for match ${match._id}:`, err.message);
            }
          }

          // Try Football-Data.org as backup
          if (!resultFound && fdKey && match.fdApiId) {
            try {
              const fdResponse = await axios.get(`${FD_API}/matches/${match.fdApiId}`, {
                headers: { 'X-Auth-Token': fdKey }
              });

              if (fdResponse.data && fdResponse.data.status === 'FINISHED') {
                await this.processFinishedMatch(match, {
                  source: 'FOOTBALL_DATA',
                  homeScore: fdResponse.data.score.fullTime.home,
                  awayScore: fdResponse.data.score.fullTime.away,
                  status: 'FINISHED'
                });
                updateResults.updated++;
                resultFound = true;
              }
            } catch (err) {
              console.warn(`Football-Data.org update failed for match ${match._id}:`, err.message);
            }
          }

          if (!resultFound) {
            updateResults.skipped++;
          }
        } catch (err) {
          console.error(`Failed to process match ${match._id}:`, err.message);
          updateResults.failed++;
        }
      }
      
      console.log('✅ Results update completed', updateResults);
      return updateResults;
    } catch (error) {
      console.error('❌ Error updating results:', error.message);
      throw error;
    }
  },

  async processFinishedMatch(match, resultData) {
    // Check if the result has actually changed
    const existingResult = await Result.findOne(
      { match: match._id },
      { homeScore: 1, awayScore: 1 }
    );

    if (existingResult && 
        existingResult.homeScore === resultData.homeScore && 
        existingResult.awayScore === resultData.awayScore) {
      return; // Skip if no change
    }

    const session = await Match.startSession();
    
    try {
      await session.withTransaction(async () => {
        // Prepare result document with minimal fields
        const result = {
          match: match._id,
          homeScore: resultData.homeScore,
          awayScore: resultData.awayScore,
          status: resultData.status,
          source: resultData.source,
          updatedAt: new Date()
        };

        // Update match status and score
        await Match.findByIdAndUpdate(
          match._id,
          { 
            status: 'FINISHED',
            score: {
              home: resultData.homeScore,
              away: resultData.awayScore
            },
            updatedAt: new Date()
          },
          { session }
        );

        // Create or update result with full history
        await Result.findOneAndUpdate(
          { match: match._id },
          {
            $set: {
              ...result,
              lastUpdate: new Date()
            },
            $push: {
              history: {
                homeScore: resultData.homeScore,
                awayScore: resultData.awayScore,
                source: resultData.source,
                timestamp: new Date()
              }
            }
          },
          { 
            upsert: true, 
            new: true,
            session
          }
        );

        console.log(`✅ Updated result for match: ${match._id} (${resultData.source})`);
      });
    } catch (error) {
      console.error(`Failed to process match ${match._id}:`, error);
      throw error;
    } finally {
      await session.endSession();
    }
  },

  // Basic CRUD operations
  async getAllResults() {
    return await Result.find().populate('match').sort({ date: -1 });
  },

  async getResultById(id) {
    return await Result.findById(id).populate('match');
  },

  async createResult(data) {
    const result = new Result(data);
    return await result.save();
  },

  async updateResult(id, data) {
    return await Result.findByIdAndUpdate(id, data, { new: true });
  },

  async deleteResult(id) {
    return await Result.findByIdAndDelete(id);
  },

  // Enhanced operations for cron jobs
  async fetchAndStoreResults() {
    try {
      // Try Football-Data.org first
      let results = await this.fetchFromFootballData();
      
      // If no results found, try API-Football
      if (!results.length) {
        results = await this.fetchFromApiFootball();
      }

      // Store results in DB
      const saved = await this.upsertResults(results);
      console.log(`✅ Updated ${saved.length} results`);
      return saved;
    } catch (error) {
      console.error('Failed to fetch and store results:', error.message);
      throw error;
    }
  },

  async fetchFromFootballData() {
    const fdKey = process.env.FOOTBALL_DATA_KEY;
    if (!fdKey) return [];

    try {
      const response = await axios.get(`${FD_API}/matches`, {
        headers: { 'X-Auth-Token': fdKey },
        params: {
          status: 'FINISHED',
          limit: 100
        }
      });

      return (response.data.matches || []).map(match => ({
        provider: 'football-data',
        providerMatchId: String(match.id),
        homeScore: match.score.fullTime.home,
        awayScore: match.score.fullTime.away,
        date: new Date(match.utcDate)
      }));
    } catch (error) {
      console.error('Football-Data API error:', error.message);
      return [];
    }
  },

  async fetchFromApiFootball() {
    const afKey = process.env.API_FOOTBALL_KEY;
    if (!afKey) return [];

    try {
      const response = await axios.get(`${AF_API}/fixtures`, {
        headers: { 'x-apisports-key': afKey },
        params: {
          status: 'FT',
          timezone: 'UTC'
        }
      });

      return (response.data.response || []).map(match => ({
        provider: 'api-football',
        providerMatchId: String(match.fixture.id),
        homeScore: match.goals.home,
        awayScore: match.goals.away,
        date: new Date(match.fixture.date)
      }));
    } catch (error) {
      console.error('API-Football error:', error.message);
      return [];
    }
  },

  async upsertResults(results) {
    const saved = [];
    for (const result of results) {
      try {
        // Find corresponding match
        const match = await Match.findOne({
          provider: result.provider,
          providerMatchId: result.providerMatchId
        });

        if (!match) continue;

        // Update match status
        match.status = 'FINISHED';
        match.score = {
          current: { home: result.homeScore, away: result.awayScore },
          fulltime: { home: result.homeScore, away: result.awayScore }
        };
        await match.save();

        // Create or update result
        const updated = await Result.findOneAndUpdate(
          { match: match._id },
          {
            match: match._id,
            homeScore: result.homeScore,
            awayScore: result.awayScore,
            date: result.date
          },
          { upsert: true, new: true }
        );

        saved.push(updated);
      } catch (err) {
        console.error(`Error updating result: ${err.message}`);
      }
    }
    return saved;
  }
};

module.exports = resultService;
