const axios = require('axios');
const Match = require('../models/Match');
const { EventEmitter } = require('events');

class LiveUpdateService extends EventEmitter {
  constructor() {
    super();
    this.updateInterval = process.env.LIVE_UPDATE_INTERVAL || 30000; // 30 seconds default
    this.isRunning = false;
    this.fdKey = process.env.FOOTBALL_DATA_KEY;
    this.afKey = process.env.API_FOOTBALL_KEY;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.poll();
  }

  stop() {
    this.isRunning = false;
    if (this._timeout) {
      clearTimeout(this._timeout);
    }
  }

  async poll() {
    try {
      await this.updateLiveMatches();
    } catch (error) {
      console.error('Live update error:', error.message);
    }

    if (this.isRunning) {
      this._timeout = setTimeout(() => this.poll(), this.updateInterval);
    }
  }

  async updateLiveMatches() {
    const [fdMatches, afMatches] = await Promise.all([
      this.fetchFromFootballData(),
      this.fetchFromApiFootball()
    ]);

    const updates = [...fdMatches, ...afMatches];
    
    for (const update of updates) {
      const existing = await Match.findOne({
        provider: update.provider,
        providerMatchId: update.providerMatchId
      });

      if (!existing) continue;

      // Check for score changes
      const scoreChanged = this.hasScoreChanged(existing, update);
      
      // Update match
      const updated = await Match.findByIdAndUpdate(
        existing._id,
        {
          $set: {
            status: update.status,
            minute: update.minute,
            'score.current': update.score.current,
            lastUpdated: new Date()
          }
        },
        { new: true }
      );

      if (scoreChanged) {
        this.emit('scoreUpdate', updated);
      }
      this.emit('matchUpdate', updated);
    }
  }

  hasScoreChanged(existing, update) {
    const oldScore = existing.score?.current || {};
    const newScore = update.score?.current || {};
    return oldScore.home !== newScore.home || oldScore.away !== newScore.away;
  }

  async fetchFromFootballData() {
    if (!this.fdKey) return [];
    try {
      const res = await axios.get('https://api.football-data.org/v4/matches?status=LIVE', {
        headers: { 'X-Auth-Token': this.fdKey }
      });
      return (res.data.matches || []).map(m => ({
        provider: 'football-data',
        providerMatchId: String(m.id),
        status: m.status,
        minute: m.minute,
        score: {
          current: {
            home: m.score.fullTime.home,
            away: m.score.fullTime.away
          }
        }
      }));
    } catch (error) {
      console.error('Football-Data live fetch failed:', error.message);
      return [];
    }
  }

  async fetchFromApiFootball() {
    if (!this.afKey) return [];
    try {
      const res = await axios.get('https://v3.football.api-sports.io/fixtures?live=all', {
        headers: { 'x-apisports-key': this.afKey }
      });
      return (res.data.response || []).map(m => ({
        provider: 'api-football',
        providerMatchId: String(m.fixture.id),
        status: 'IN_PLAY',
        minute: m.fixture.status.elapsed || 0,
        score: {
          current: {
            home: m.goals.home,
            away: m.goals.away
          }
        }
      }));
    } catch (error) {
      console.error('API-Football live fetch failed:', error.message);
      return [];
    }
  }
}

module.exports = new LiveUpdateService();
