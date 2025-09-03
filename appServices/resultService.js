const axios = require('axios');
const Result = require('../models/Result');
const Match = require('../models/Match');

const FD_API = "https://api.football-data.org/v4";
const AF_API = "https://v3.football.api-sports.io";

/**
 * Service for managing football match results
 * @type {Object}
 */
const resultService = {
  /**
   * Updates all match results that need processing
   * @returns {Promise<{processed: number, updated: number}>}
   */
  async updateAllResults() {
    console.log('📊 Starting match results update...');
    const afKey = process.env.API_FOOTBALL_KEY;
    const fdKey = process.env.FOOTBALL_DATA_KEY;

    if (!afKey) {
      throw new Error('API_FOOTBALL_KEY is required for updates');
    }

    try {
      console.log('🔍 Looking for matches in the last 24 hours...');
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const matches = await Match.find({
        status: { $ne: 'FINISHED' },
        date: { 
          $gte: oneDayAgo,
          $lte: new Date()
        }
      })
      .select('_id apiFootballId fdApiId homeTeam awayTeam')
      .limit(20)
      .sort({ date: 1 });

      console.log(`📊 Found ${matches.length} unfinished matches from ${oneDayAgo.toISOString()} to now`);
      
      if (matches.length === 0) {
        console.log('ℹ️ No matches need updating');
        return { processed: 0, updated: 0, skipped: 0, failed: 0, message: 'No unfinished matches found' };
      }

      const updateResults = {
        total: matches.length,
        updated: 0,
        failed: 0,
        skipped: 0
      };

      for (const match of matches) {
        try {
          let resultFound = false;

          if (afKey && match.apiFootballId) {
            console.log(`🔄 Checking API-Football for match ${match._id} (API ID: ${match.apiFootballId})`);
            try {
              const afResponse = await axios.get(`${AF_API}/fixtures`, {
                headers: {
                  'x-rapidapi-host': 'v3.football.api-sports.io',
                  'x-rapidapi-key': afKey
                },
                params: {
                  id: match.apiFootballId,
                  timezone: 'UTC'
                }
              });

              if (!afResponse.data?.response?.[0]) {
                console.log(`⚠️ No data found in API-Football for match ${match._id}`);
              } else {
                const fixtureData = afResponse.data.response[0];
                console.log(`📌 Match status from API-Football: ${fixtureData.fixture.status.short}`);
                
                // Check for all finished match statuses
                const finishedStatuses = ['FT', 'AET', 'PEN'];
                if (finishedStatuses.includes(fixtureData.fixture.status.short)) {
                  console.log(`✨ Processing finished match ${match._id} [Score: ${fixtureData.goals.home}-${fixtureData.goals.away}] (${fixtureData.fixture.status.long})`);
                  
                  let finalScore = {
                    home: fixtureData.goals.home,
                    away: fixtureData.goals.away
                  };

                  // If penalties, use penalty score
                  if (fixtureData.fixture.status.short === 'PEN' && fixtureData.score.penalty) {
                    finalScore = {
                      home: fixtureData.score.penalty.home,
                      away: fixtureData.score.penalty.away
                    };
                  }
                  
                  await this.processFinishedMatch(match, {
                    source: 'API_FOOTBALL',
                    homeScore: finalScore.home,
                    awayScore: finalScore.away,
                    status: 'FINISHED',
                    details: {
                      regularTime: fixtureData.score.fulltime,
                      extraTime: fixtureData.score.extratime,
                      penalty: fixtureData.score.penalty
                    }
                  });
                  resultFound = true;
                  updateResults.updated++;
                }
              }
            } catch (err) {
              console.error(`❌ API-Football update failed for match ${match._id}:`, err.message);
              if (err.response) {
                console.error(`Response status: ${err.response.status}`);
                console.error('Response data:', err.response.data);
              }
            }
          }

          if (!resultFound && fdKey && match.fdApiId) {
            console.log(`🔄 Checking Football-Data.org for match ${match._id} (API ID: ${match.fdApiId})`);
            try {
              const fdResponse = await axios.get(`${FD_API}/matches/${match.fdApiId}`, {
                headers: { 'X-Auth-Token': fdKey }
              });

              if (!fdResponse.data) {
                console.log(`⚠️ No data found in Football-Data.org for match ${match._id}`);
              } else {
                console.log(`📌 Match status from Football-Data.org: ${fdResponse.data.status}`);
                
                if (fdResponse.data.status === 'FINISHED') {
                  const homeScore = fdResponse.data.score.fullTime.home;
                  const awayScore = fdResponse.data.score.fullTime.away;
                  console.log(`✨ Processing finished match ${match._id} [Score: ${homeScore}-${awayScore}]`);
                  
                  await this.processFinishedMatch(match, {
                    source: 'FOOTBALL_DATA',
                    homeScore: homeScore,
                    awayScore: awayScore,
                    status: 'FINISHED'
                  });
                  updateResults.updated++;
                  resultFound = true;
                }
              }
            } catch (err) {
              console.error(`❌ Football-Data.org update failed for match ${match._id}:`, err.message);
              if (err.response) {
                console.error(`Response status: ${err.response.status}`);
                console.error('Response data:', err.response.data);
              }
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
      
      const summary = `
📊 Results Update Summary
========================
Total matches checked: ${updateResults.total}
Updates completed:    ${updateResults.updated}
Matches skipped:     ${updateResults.skipped}
Failed updates:      ${updateResults.failed}
========================`;
      
      console.log(summary);
      return {
        ...updateResults,
        message: updateResults.updated > 0 ? 
          `Successfully updated ${updateResults.updated} matches` : 
          'No matches needed updating'
      };
    } catch (error) {
      console.error('❌ Error updating results:', error.message);
      console.error('Stack trace:', error.stack);
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
  getAllResults: async function() {
    return await Result.find().populate('match').sort({ date: -1 });
  },

  getResultById: async function(id) {
    return await Result.findById(id).populate('match');
  },

  createResult: async function(data) {
    const result = new Result(data);
    return await result.save();
  },

  updateResult: async function(id, data) {
    return await Result.findByIdAndUpdate(id, data, { new: true });
  },

  deleteResult: async function(id) {
    return await Result.findByIdAndDelete(id);
  },

  // Enhanced operations for cron jobs
  fetchAndStoreResults: async function() {
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

  fetchFromFootballData: async function() {
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

  fetchFromApiFootball: async function() {
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

  upsertResults: async function(results) {
    const saved = [];
    for (const result of results) {
      try {
        const match = await Match.findOne({
          provider: result.provider,
          providerMatchId: result.providerMatchId
        });

        if (!match) continue;

        match.status = 'FINISHED';
        match.score = {
          current: { home: result.homeScore, away: result.awayScore },
          fulltime: { home: result.homeScore, away: result.awayScore }
        };
        await match.save();

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
