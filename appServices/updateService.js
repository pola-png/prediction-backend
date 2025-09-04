const axios = require('axios');
const Match = require('../models/Match');
const { OPENLIGA_DB_SOURCES, API_URLS } = require('../utils/dataSources');

class UpdateService {
  constructor() {
    this.API_BASE = API_URLS.OPENLIGA_DB;
    this.FOOTBALL_JSON_URL = 'https://raw.githubusercontent.com/openfootball/football.json/master/2023-24/en.1.json';
    this.GITHUB_DATASET_URL = 'https://raw.githubusercontent.com/openfootball/england/master/2023-24/1-premierleague.txt';
  }

  /**
   * Fetch and update matches from all sources
   * @returns {Promise<{success: boolean, stats: object}>}
   */
  async updateAllSources() {
    try {
      const [footballJsonData, openLigaData, githubData] = await Promise.all([
        this.fetchFromFootballJson(),
        this.fetchFromOpenLigaDB(),
        this.fetchFromGitHubDataset()
      ]);

      const stats = {
        footballJson: { processed: footballJsonData.length, updated: 0 },
        openLigaDB: { processed: openLigaData.length, updated: 0 },
        github: { processed: githubData.length, updated: 0 }
      };

      // Process all matches
      for (const source of Object.keys(stats)) {
        const matches = source === 'footballJson' ? footballJsonData :
                       source === 'openLigaDB' ? openLigaData : githubData;
        
        for (const match of matches) {
          try {
            await Match.findOneAndUpdate(
              {
                homeTeam: match.homeTeam,
                awayTeam: match.awayTeam,
                date: match.date
              },
              {
                ...match,
                lastUpdated: new Date(),
                source
              },
              { upsert: true, new: true }
            );
            stats[source].updated++;
          } catch (err) {
            console.error(`Error updating match from ${source}:`, err);
          }
        }
      }

      return { success: true, stats };
    } catch (error) {
      console.error('Error in updateAllSources:', error);
      throw error;
    }
  }

  /**
   * Update match results from OpenLigaDB
   * @param {string} leagueId - The league identifier (e.g., 'BL' for Bundesliga)
   * @returns {Promise<{updated: number, failed: number}>}
   */
  async updateLeagueResults(leagueId) {
    try {
      const league = OPENLIGA_DB_SOURCES[leagueId];
      if (!league) {
        console.log(`⚠️ No OpenLigaDB configuration found for league: ${leagueId}`);
        return { updated: 0, failed: 0 };
      }

      const url = `${this.API_BASE}/getmatchdata/${league.id}/${new Date().getFullYear()}`;
      console.log(`📡 Fetching match data from OpenLigaDB: ${url}`);
      
      const { data: matches } = await axios.get(url);
      
      let updated = 0;
      let failed = 0;

      for (const match of matches) {
        try {
          // Only update if match is finished
          if (match.MatchIsFinished) {
            const result = await this.updateMatchResult(match, leagueId);
            if (result) updated++;
          }
        } catch (err) {
          console.error(`❌ Error updating match ${match.MatchID}:`, err.message);
          failed++;
        }
      }

      return { updated, failed };
    } catch (err) {
      console.error(`❌ Failed to update ${leagueId} results:`, err.message);
      throw err;
    }
  }

  /**
   * Update a single match result
   * @private
   */
  async updateMatchResult(openLigaMatch, leagueId) {
    const matchDate = new Date(openLigaMatch.MatchDateTime);
    const homeTeam = openLigaMatch.Team1.TeamName;
    const awayTeam = openLigaMatch.Team2.TeamName;

    // Find match in our database
    const match = await Match.findOne({
      homeTeam: { $regex: new RegExp(homeTeam, 'i') },
      awayTeam: { $regex: new RegExp(awayTeam, 'i') },
      date: {
        $gte: new Date(matchDate.setHours(0, 0, 0, 0)),
        $lte: new Date(matchDate.setHours(23, 59, 59, 999))
      }
    });

    if (!match) {
      console.log(`⚠️ No matching match found for: ${homeTeam} vs ${awayTeam} on ${matchDate.toISOString()}`);
      return false;
    }

    // Update match with results
    match.score = {
      home: openLigaMatch.MatchResults[0].PointsTeam1,
      away: openLigaMatch.MatchResults[0].PointsTeam2
    };
    match.status = 'FINISHED';
    match.externalIds = {
      ...match.externalIds,
      openLigaId: openLigaMatch.MatchID
    };
    match.updatedAt = new Date();

    await match.save();
    console.log(`✅ Updated result for: ${homeTeam} vs ${awayTeam}`);
    return true;
  }

  /**
   * Update results for all configured leagues
   * @returns {Promise<{league: string, updated: number, failed: number}[]>}
   */
  async updateAllResults() {
    const results = [];
    
    for (const leagueId of Object.keys(OPENLIGA_DB_SOURCES)) {
      try {
        const result = await this.updateLeagueResults(leagueId);
        results.push({
          league: leagueId,
          ...result
        });
      } catch (err) {
        console.error(`❌ Failed to update ${leagueId}:`, err.message);
        results.push({
          league: leagueId,
          updated: 0,
          failed: -1,
          error: err.message
        });
      }
    }

    return results;
  }
}

module.exports = new UpdateService();
