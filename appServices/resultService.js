const axios = require('axios');
const Result = require('../models/Result');
const Match = require('../models/Match');

const FD_API = "https://api.football-data.org/v4";
const AF_API = "https://v3.football.api-sports.io";

const resultService = {
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
