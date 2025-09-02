const axios = require('axios');
const Match = require('../models/Match');

const FD_API = "https://api.football-data.org/v4";
const AF_API = "https://v3.football.api-sports.io";

const matchService = {
  // Basic CRUD operations
  async getAllMatches() {
    return await Match.find().sort({ date: 1 });
  },

  async getMatchById(id) {
    return await Match.findById(id);
  },

  async createMatch(data) {
    const match = new Match(data);
    return await match.save();
  },

  async updateMatch(id, data) {
    return await Match.findByIdAndUpdate(id, data, { new: true });
  },

  async deleteMatch(id) {
    return await Match.findByIdAndDelete(id);
  },

  // Enhanced operations for cron jobs
  async fetchAndStoreMatches() {
    try {
      // Try Football-Data.org first
      let matches = await this.fetchFromFootballData();
      
      // If no matches found, try API-Football
      if (!matches.length) {
        matches = await this.fetchFromApiFootball();
      }

      // If both APIs fail, use fallback data
      if (!matches.length) {
        matches = this.getFallbackMatches();
      }

      // Store matches in DB
      const saved = await this.upsertMatches(matches);
      console.log(`✅ Updated ${saved.length} matches`);
      return saved;
    } catch (error) {
      console.error('Failed to fetch and store matches:', error.message);
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
          status: ['SCHEDULED', 'LIVE', 'IN_PLAY', 'PAUSED'].join(','),
          limit: 100
        }
      });

      return (response.data.matches || []).map(match => ({
        provider: 'football-data',
        providerMatchId: String(match.id),
        league: match.competition?.name,
        season: match.season?.startDate?.slice(0, 4),
        date: new Date(match.utcDate),
        status: match.status,
        homeTeam: match.homeTeam?.name,
        awayTeam: match.awayTeam?.name,
        score: {
          current: {
            home: match.score?.fullTime?.home,
            away: match.score?.fullTime?.away
          },
          halftime: {
            home: match.score?.halfTime?.home,
            away: match.score?.halfTime?.away
          }
        }
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
          status: 'NS-LIVE-HT-FT',
          timezone: 'UTC'
        }
      });

      return (response.data.response || []).map(match => ({
        provider: 'api-football',
        providerMatchId: String(match.fixture.id),
        league: match.league?.name,
        season: String(match.league?.season),
        date: new Date(match.fixture.date),
        status: this.mapApiFootballStatus(match.fixture.status.short),
        homeTeam: match.teams?.home?.name,
        awayTeam: match.teams?.away?.name,
        score: {
          current: {
            home: match.goals?.home,
            away: match.goals?.away
          },
          halftime: {
            home: match.score?.halftime?.home,
            away: match.score?.halftime?.away
          }
        }
      }));
    } catch (error) {
      console.error('API-Football error:', error.message);
      return [];
    }
  },

  getFallbackMatches() {
    const now = new Date();
    return [
      {
        provider: 'manual',
        providerMatchId: `FALLBACK-${now.getTime()}`,
        league: 'Premier League',
        season: '2025',
        date: new Date(now.getTime() + 2 * 3600000),
        status: 'SCHEDULED',
        homeTeam: 'Manchester United',
        awayTeam: 'Liverpool',
        score: {
          current: { home: null, away: null },
          halftime: { home: null, away: null }
        }
      }
    ];
  },

  mapApiFootballStatus(status) {
    const statusMap = {
      'NS': 'SCHEDULED',
      '1H': 'IN_PLAY',
      'HT': 'PAUSED',
      '2H': 'IN_PLAY',
      'FT': 'FINISHED',
      'PST': 'POSTPONED',
      'CANC': 'CANCELLED'
    };
    return statusMap[status] || 'SCHEDULED';
  },

  async upsertMatches(matches) {
    const results = [];
    for (const match of matches) {
      const updated = await Match.findOneAndUpdate(
        {
          provider: match.provider,
          providerMatchId: match.providerMatchId
        },
        match,
        { upsert: true, new: true }
      );
      results.push(updated);
    }
    return results;
  }
};

module.exports = matchService;
