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

    if (!afKey) {
      throw new Error('API_FOOTBALL_KEY is required for updates');
    }

    try {
      // Only get matches from the last 24 hours that aren't finished
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const matches = await Match.find({
        status: { $ne: 'FINISHED' },
        date: { 
          $gte: oneDayAgo,
          $lte: new Date()
        }
      })
      .select('_id apiFootballId homeTeam awayTeam')
      .limit(20) // Process fewer matches per batch
      .sort({ date: 1 }); // Oldest first

      console.log(`Found ${matches.length} matches to check`);

      if (matches.length === 0) {
        return { processed: 0, updated: 0 };
      }

      let updated = 0;

      for (const match of matches) {
        try {
          const response = await axios.get(`${AF_API}/fixtures?id=${match.apiFootballId}`, {
            headers: { 'x-apisports-key': afKey }
          });

          const fixture = response.data?.response?.[0];
          if (!fixture) continue;

          // Only update if match is finished
          if (fixture.fixture.status.short === 'FT') {
            await this.processFinishedMatch(match, {
              source: 'API_FOOTBALL',
              homeScore: fixture.goals.home,
              awayScore: fixture.goals.away,
              status: 'FINISHED'
            });
            updated++;
          }
        } catch (err) {
          console.error(`Failed to update match ${match._id}:`, err.message);
          continue;
        }
      }

      console.log(`✅ Updated ${updated} of ${matches.length} matches`);
      return { processed: matches.length, updated };
    } catch (error) {
      console.error('❌ Update process failed:', error.message);
      throw error;
    }
  },

  async processFinishedMatch(match, resultData) {
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
        const now = new Date();

        // Update match status and score
        await Match.findByIdAndUpdate(
          match._id,
          { 
            status: 'FINISHED',
            score: {
              home: resultData.homeScore,
              away: resultData.awayScore
            },
            updatedAt: now
          },
          { session }
        );

        // Create or update result
        await Result.findOneAndUpdate(
          { match: match._id },
          {
            $set: {
              match: match._id,
              homeScore: resultData.homeScore,
              awayScore: resultData.awayScore,
              status: resultData.status,
              source: resultData.source,
              updatedAt: now
            },
            $push: {
              history: {
                homeScore: resultData.homeScore,
                awayScore: resultData.awayScore,
                source: resultData.source,
                timestamp: now
              }
            }
          },
          { 
            upsert: true, 
            new: true,
            session
          }
        );
      });

      console.log(`✅ Updated result for match: ${match._id}`);
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
  }
};

module.exports = resultService;
