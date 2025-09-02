const axios = require('axios');
const Match = require('../models/Match');
const Team = require('../models/Team');
const Prediction = require('../models/Prediction');
const Result = require('../models/Result');

class PredictionService {
  constructor() {
    this.FD_API = "https://api.football-data.org/v4";
    this.AF_API = "https://v3.football.api-sports.io";
    this.ANALYSIS_DEPTH = 10; // Number of previous matches to analyze
  }

  async refreshPredictions() {
    try {
      const upcomingMatches = await Match.find({
        status: 'SCHEDULED',
        date: { $gte: new Date() }
      }).populate('homeTeam awayTeam');

      let predictionsCount = 0;
      for (const match of upcomingMatches) {
        const prediction = await this.generatePrediction(match);
        if (prediction) {
          predictionsCount++;
        }
      }
      return predictionsCount;
    } catch (error) {
      console.error('Error refreshing predictions:', error);
      throw error;
    }
  }

  async generatePrediction(match) {
    try {
      // Get historical data
      const [homeStats, awayStats] = await Promise.all([
        this.getTeamStats(match.homeTeam._id),
        this.getTeamStats(match.awayTeam._id)
      ]);

      // Get head-to-head history
      const h2h = await this.getHeadToHead(match.homeTeam._id, match.awayTeam._id);

      // Calculate various factors
      const factors = {
        recentForm: this.calculateRecentForm(homeStats, awayStats),
        headToHead: this.analyzeHeadToHead(h2h),
        goalScoring: this.analyzeGoalScoring(homeStats, awayStats),
        defensiveStrength: this.analyzeDefense(homeStats, awayStats),
        homeAdvantage: this.calculateHomeAdvantage(homeStats),
        consistency: this.analyzeConsistency(homeStats, awayStats),
        momentum: this.analyzeMomentum(homeStats, awayStats)
      };

      // Weight the factors
      const weights = {
        recentForm: 0.25,
        headToHead: 0.20,
        goalScoring: 0.15,
        defensiveStrength: 0.15,
        homeAdvantage: 0.10,
        consistency: 0.10,
        momentum: 0.05
      };

      // Calculate final probabilities
      const probabilities = this.calculateProbabilities(factors, weights);

      // Generate prediction outcomes
      const outcomes = this.generateOutcomes(probabilities);

      // Create or update prediction
      const prediction = await Prediction.findOneAndUpdate(
        { match: match._id },
        {
          match: match._id,
          probabilities,
          outcomes,
          confidence: this.calculateConfidence(probabilities),
          analysis: {
            homeTeamForm: homeStats.form,
            awayTeamForm: awayStats.form,
            h2hStats: h2h,
            factors
          },
          lastUpdated: new Date()
        },
        { upsert: true, new: true }
      );

      return prediction;
    } catch (error) {
      console.error('Error generating prediction:', error);
      return null;
    }
  }

  async getTeamStats(teamId) {
    const recentMatches = await Result.find({
      $or: [
        { 'homeTeam': teamId },
        { 'awayTeam': teamId }
      ]
    })
    .sort({ date: -1 })
    .limit(this.ANALYSIS_DEPTH)
    .populate('match');

    return this.processTeamMatches(teamId, recentMatches);
  }

  async getHeadToHead(team1Id, team2Id) {
    return await Result.find({
      $or: [
        { homeTeam: team1Id, awayTeam: team2Id },
        { homeTeam: team2Id, awayTeam: team1Id }
      ]
    })
    .sort({ date: -1 })
    .limit(10)
    .populate('match');
  }

  processTeamMatches(teamId, matches) {
    const stats = {
      wins: 0,
      draws: 0,
      losses: 0,
      goalsScored: 0,
      goalsConceded: 0,
      cleanSheets: 0,
      form: [],
      homePerformance: { wins: 0, draws: 0, losses: 0 },
      awayPerformance: { wins: 0, draws: 0, losses: 0 },
      averageGoalsScored: 0,
      averageGoalsConceded: 0
    };

    matches.forEach(result => {
      const isHome = result.match.homeTeam.equals(teamId);
      const goalsScored = isHome ? result.homeScore : result.awayScore;
      const goalsConceded = isHome ? result.awayScore : result.homeScore;

      // Update stats
      stats.goalsScored += goalsScored;
      stats.goalsConceded += goalsConceded;
      if (goalsConceded === 0) stats.cleanSheets++;

      // Determine result
      if (goalsScored > goalsConceded) {
        stats.wins++;
        stats.form.push('W');
        if (isHome) stats.homePerformance.wins++;
        else stats.awayPerformance.wins++;
      } else if (goalsScored < goalsConceded) {
        stats.losses++;
        stats.form.push('L');
        if (isHome) stats.homePerformance.losses++;
        else stats.awayPerformance.losses++;
      } else {
        stats.draws++;
        stats.form.push('D');
        if (isHome) stats.homePerformance.draws++;
        else stats.awayPerformance.draws++;
      }
    });

    // Calculate averages
    const totalMatches = matches.length;
    stats.averageGoalsScored = stats.goalsScored / totalMatches;
    stats.averageGoalsConceded = stats.goalsConceded / totalMatches;

    return stats;
  }

  calculateRecentForm(homeStats, awayStats) {
    const calculateFormPoints = form => {
      return form.slice(0, 5).reduce((points, result, index) => {
        const weight = (5 - index) / 5; // More recent matches have higher weight
        switch (result) {
          case 'W': return points + (3 * weight);
          case 'D': return points + (1 * weight);
          default: return points;
        }
      }, 0);
    };

    const homePoints = calculateFormPoints(homeStats.form);
    const awayPoints = calculateFormPoints(awayStats.form);

    return {
      home: homePoints / 15, // Normalize to 0-1 range
      away: awayPoints / 15
    };
  }

  analyzeHeadToHead(h2h) {
    // Analyze head-to-head history with recency bias
    const recentBias = 0.7;
    let homeAdvantage = 0;
    
    h2h.forEach((match, index) => {
      const weight = Math.pow(recentBias, index);
      const homeWin = match.homeScore > match.awayScore;
      const awayWin = match.homeScore < match.awayScore;
      
      if (homeWin) homeAdvantage += weight;
      else if (awayWin) homeAdvantage -= weight;
    });

    return {
      homeAdvantage: homeAdvantage / h2h.length
    };
  }

  analyzeGoalScoring(homeStats, awayStats) {
    return {
      home: {
        average: homeStats.averageGoalsScored,
        threat: homeStats.averageGoalsScored / (awayStats.averageGoalsConceded || 1)
      },
      away: {
        average: awayStats.averageGoalsScored,
        threat: awayStats.averageGoalsScored / (homeStats.averageGoalsConceded || 1)
      }
    };
  }

  analyzeDefense(homeStats, awayStats) {
    return {
      home: {
        cleanSheetRatio: homeStats.cleanSheets / this.ANALYSIS_DEPTH,
        defenseStrength: 1 - (homeStats.averageGoalsConceded / 3) // Normalize to 0-1
      },
      away: {
        cleanSheetRatio: awayStats.cleanSheets / this.ANALYSIS_DEPTH,
        defenseStrength: 1 - (awayStats.averageGoalsConceded / 3)
      }
    };
  }

  calculateHomeAdvantage(homeStats) {
    const homeGames = homeStats.homePerformance.wins + 
                     homeStats.homePerformance.draws + 
                     homeStats.homePerformance.losses;
    
    if (homeGames === 0) return 0.5;

    return (homeStats.homePerformance.wins * 3 + homeStats.homePerformance.draws) / 
           (homeGames * 3);
  }

  analyzeConsistency(homeStats, awayStats) {
    const calculateConsistency = form => {
      if (form.length < 2) return 1;
      
      let changes = 0;
      for (let i = 1; i < form.length; i++) {
        if (form[i] !== form[i-1]) changes++;
      }
      
      return 1 - (changes / (form.length - 1));
    };

    return {
      home: calculateConsistency(homeStats.form),
      away: calculateConsistency(awayStats.form)
    };
  }

  analyzeMomentum(homeStats, awayStats) {
    const calculateMomentum = form => {
      const last3 = form.slice(0, 3);
      return last3.reduce((momentum, result) => {
        switch (result) {
          case 'W': return momentum + 1;
          case 'D': return momentum + 0.5;
          default: return momentum;
        }
      }, 0) / 3;
    };

    return {
      home: calculateMomentum(homeStats.form),
      away: calculateMomentum(awayStats.form)
    };
  }

  calculateProbabilities(factors, weights) {
    // Complex probability calculation considering all factors
    let homeStrength = 0;
    let awayStrength = 0;

    homeStrength += factors.recentForm.home * weights.recentForm;
    awayStrength += factors.recentForm.away * weights.recentForm;

    homeStrength += (factors.headToHead.homeAdvantage + 1) / 2 * weights.headToHead;
    awayStrength += (1 - factors.headToHead.homeAdvantage) / 2 * weights.headToHead;

    homeStrength += factors.goalScoring.home.threat * weights.goalScoring;
    awayStrength += factors.goalScoring.away.threat * weights.goalScoring;

    homeStrength += factors.defensiveStrength.home.defenseStrength * weights.defensiveStrength;
    awayStrength += factors.defensiveStrength.away.defenseStrength * weights.defensiveStrength;

    homeStrength += factors.homeAdvantage * weights.homeAdvantage;
    
    homeStrength += factors.consistency.home * weights.consistency;
    awayStrength += factors.consistency.away * weights.consistency;

    homeStrength += factors.momentum.home * weights.momentum;
    awayStrength += factors.momentum.away * weights.momentum;

    // Normalize strengths to probabilities
    const total = homeStrength + awayStrength;
    const drawProbability = Math.min(0.3, Math.abs(homeStrength - awayStrength));

    return {
      homeWin: (homeStrength / total) * (1 - drawProbability),
      awayWin: (awayStrength / total) * (1 - drawProbability),
      draw: drawProbability
    };
  }

  generateOutcomes(probabilities) {
    const outcomes = [];
    
    // 1X2 Prediction
    const mainOutcome = this.getMostLikelyOutcome(probabilities);
    outcomes.push({
      market: '1X2',
      prediction: mainOutcome,
      confidence: this.calculateConfidence(probabilities)
    });

    // Goals Prediction
    const expectedGoals = this.calculateExpectedGoals(probabilities);
    outcomes.push({
      market: 'O/U 2.5',
      prediction: expectedGoals > 2.5 ? 'OVER' : 'UNDER',
      confidence: Math.abs(expectedGoals - 2.5) * 20 // Scale to percentage
    });

    // BTTS Prediction
    const bttsProb = this.calculateBTTSProbability(probabilities);
    outcomes.push({
      market: 'BTTS',
      prediction: bttsProb > 0.5 ? 'YES' : 'NO',
      confidence: Math.abs(bttsProb - 0.5) * 200 // Scale to percentage
    });

    return outcomes;
  }

  getMostLikelyOutcome(probabilities) {
    const { homeWin, awayWin, draw } = probabilities;
    if (homeWin > awayWin && homeWin > draw) return 'HOME';
    if (awayWin > homeWin && awayWin > draw) return 'AWAY';
    return 'DRAW';
  }

  calculateConfidence(probabilities) {
    const values = Object.values(probabilities);
    const highest = Math.max(...values);
    const confidence = (highest - 0.33) / 0.67 * 100; // Scale to percentage
    return Math.round(Math.min(Math.max(confidence, 55), 95)); // Cap between 55-95%
  }

  calculateExpectedGoals(probabilities) {
    // Using probability distribution to estimate expected goals
    return (probabilities.homeWin * 2.5 + probabilities.awayWin * 2.0 + probabilities.draw * 1.8);
  }

  calculateBTTSProbability(probabilities) {
    // Higher probability of BTTS in high-scoring or close games
    return (probabilities.draw * 0.7) + 
           (Math.min(probabilities.homeWin, probabilities.awayWin) * 0.8) +
           (Math.max(probabilities.homeWin, probabilities.awayWin) * 0.4);
  }

  async evaluatePendingPredictions() {
    const pendingPredictions = await Prediction.find({ status: 'PENDING' })
      .populate('match');

    for (const prediction of pendingPredictions) {
      const result = await Result.findOne({ match: prediction.match._id });
      if (!result) continue;

      prediction.status = this.evaluatePredictionOutcome(prediction, result);
      await prediction.save();
    }
  }

  evaluatePredictionOutcome(prediction, result) {
    const mainOutcome = prediction.outcomes.find(o => o.market === '1X2');
    if (!mainOutcome) return 'VOID';

    const actualOutcome = result.homeScore > result.awayScore ? 'HOME' :
                         result.homeScore < result.awayScore ? 'AWAY' : 'DRAW';

    return mainOutcome.prediction === actualOutcome ? 'WON' : 'LOST';
  }
}

module.exports = new PredictionService();
