  const matchDateTime = new Date(`${matchData.date} ${matchData.time}`);

        await Match.create({
            source: 'soccersapi',
            externalId: externalId,
            leagueCode: matchData.league_name,
            matchDateUtc: matchDateTime,
            status: 'scheduled',
            homeTeam: homeTeam._id,
            awayTeam: awayTeam._id,
        });
        newMatchesCount++;
    }
    return { newMatchesCount };
}

async function fetchFromOpenLigaDB() {
    let newMatchesCount = 0;
    let updatedMatchesCount = 0;
    const leagueShortcuts = ['bl1', 'bl2']; // German Bundesliga 1 and 2
    const currentSeason = getCurrentSeason();

    for (const league of leagueShortcuts) {
        const url = `https://api.openligadb.de/getmatchdata/${league}/${currentSeason}`;
        console.log(`CRON: Fetching matches for league ${league}, season ${currentSeason} from OpenLigaDB.`);
        const openLigaRes = await axios.get(url);
        const liveMatches = openLigaRes.data || [];
        console.log(`CRON: Found ${liveMatches.length} matches for ${league} from OpenLigaDB.`);

        for (const matchData of liveMatches) {
            if (!matchData.matchID || !matchData.team1?.teamName || !matchData.team2?.teamName) continue;
            
            const externalId = `openliga-${matchData.matchID}`;
            const existingMatch = await Match.findOne({ externalId });
            
            const lastUpdateDate = new Date(matchData.lastUpdateDateTimeUTC);

            if (existingMatch) {
                const existingLastUpdate = new Date(existingMatch.updatedAt);
                if (lastUpdateDate > existingLastUpdate) {
                    console.log(`CRON: Updating match ${externalId} from OpenLigaDB.`);
                    const homeGoals = matchData.matchResults.find(r => r.resultName === 'Endergebnis')?.pointsTeam1;
                    const awayGoals = matchData.matchResults.find(r => r.resultName === 'Endergebnis')?.pointsTeam2;
                    await Match.updateOne({ _id: existingMatch._id }, {
                        $set: {
                            status: matchData.matchIsFinished ? 'finished' : 'scheduled',
                            homeGoals: homeGoals,
                            awayGoals: awayGoals,
                            updatedAt: lastUpdateDate
                        }
                    });
                    updatedMatchesCount++;
                }
                continue;
            }

            const homeTeam = await getOrCreateTeam(matchData.team1.teamName);
            const awayTeam = await getOrCreateTeam(matchData.team2.teamName);
            if (!homeTeam || !awayTeam) continue;

            const homeGoalsOnCreate = matchData.matchResults.find(r => r.resultName === 'Endergebnis')?.pointsTeam1;
            const awayGoalsOnCreate = matchData.matchResults.find(r => r.resultName === 'Endergebnis')?.pointsTeam2;

            console.log(`CRON: Creating new match ${externalId} from OpenLigaDB.`);
            await Match.create({
                source: 'openligadb',
                externalId: externalId,
                leagueCode: matchData.leagueName,
                matchDateUtc: new Date(matchData.matchDateTimeUTC),
                status: matchData.matchIsFinished ? 'finished' : 'scheduled',
                homeTeam: homeTeam._id,
                awayTeam: awayTeam._id,
                homeGoals: homeGoalsOnCreate,
                awayGoals: awayGoalsOnCreate,
                updatedAt: lastUpdateDate,
            });
            newMatchesCount++;
        }
    }
    return { newMatchesCount, updatedMatchesCount };
}


async function fetchAndStoreMatches() {
    let newMatchesCount = 0;
    let updatedMatchesCount = 0;
    let newHistoryCount = 0;

    try {
        console.log("CRON: Attempting primary source: SoccersAPI");
        const soccersApiResult = await fetchFromSoccersAPI();
        newMatchesCount += soccersApiResult.newMatchesCount;
    } catch (error) {
        console.error("CRON: Primary source SoccersAPI failed:", error.message);
        console.log("CRON: Falling back to secondary source: OpenLigaDB");
        try {
            const openLigaResult = await fetchFromOpenLigaDB();
            newMatchesCount += openLigaResult.newMatchesCount;
            updatedMatchesCount += openLigaResult.updatedMatchesCount;
        } catch (fallbackError) {
            console.error("CRON: Fallback source OpenLigaDB also failed:", fallbackError.message);
        }
    }

    if (process.env.FOOTBALL_JSON_URL) {
        try {
            console.log("CRON: Fetching historical matches from football.json");
            const fallbackRes = await axios.get(process.env.FOOTBALL_JSON_URL);
            const history = fallbackRes.data.matches || [];
            console.log(`CRON: Found ${history.length} historical matches.`);

            for (const matchData of history) {
                if (!matchData.team1 || !matchData.team2 || !matchData.date) continue;
                
                const externalId = `footballjson-${matchData.date}-${matchData.team1}-${matchData.team2}`;
                const existingMatch = await Match.findOne({ externalId });
                if (existingMatch) continue;

                const homeTeam = await getOrCreateTeam(matchData.team1);
                const awayTeam = await getOrCreateTeam(matchData.team2);
                if (!homeTeam || !awayTeam) continue;

                await Match.create({
                    source: 'footballjson',
                    externalId,
                    leagueCode: 'Premier League 23/24 History',
                    matchDateUtc: new Date(matchData.date),
                    status: 'finished',
                    homeTeam: homeTeam._id,
                    awayTeam: awayTeam._id,
                    homeGoals: matchData.score.ft[0],
                    awayGoals: matchData.score.ft[1],
                });
                newHistoryCount++;
            }
        } catch (error) {
            console.error("CRON: Error fetching from football.json:", error.message);
        }
    }

    return { newMatchesCount, updatedMatchesCount, newHistoryCount };
}

async function generateAllPredictions() {
    let processedCount = 0;
    const upcomingMatches = await Match.find({
        status: { $in: ['scheduled', 'upcoming', 'tba'] },
        matchDateUtc: { $gte: new Date() },
        prediction: { $exists: false }
    }).populate('homeTeam awayTeam').limit(10).lean();
    
    if (upcomingMatches.length === 0) {
        console.log("CRON: No new matches require predictions.");
        return { processedCount: 0 };
    }
    
    console.log(`CRON: Found ${upcomingMatches.length} matches for prediction generation.`);
    const historicalMatches = await Match.find({ status: 'finished' }).populate('homeTeam awayTeam').lean();

    for (const match of upcomingMatches) {
        try {
            if (!match.homeTeam || !match.awayTeam) {
                console.error(`CRON: Skipping prediction for match ${match._id} due to missing team data.`);
                continue;
            }
            
            const predictionResult = await getPredictionFromAI(match, historicalMatches);
            
            const predictionDoc = new Prediction({
                matchId: match._id,
                outcomes: predictionResult,
                confidence: predictionResult.confidence,
                bucket: predictionResult.bucket,
                version: '1.5-flash'
            });
            await predictionDoc.save();

            await Match.updateOne({ _id: match._id }, { $set: { prediction: predictionDoc._id } });
            processedCount++;
            console.log(`CRON: Generated prediction for ${match.homeTeam.name} vs ${match.awayTeam.name}`);
        } catch (error) {
            console.error(`CRON: Failed to generate prediction for match ${match._id} (${match.homeTeam?.name} vs ${match.awayTeam?.name}):`, error.message);
        }
    }
    return { processedCount };
}

async function fetchAndStoreResults() {
    let updatedCount = 0;
    const matchesToCheck = await Match.find({
        status: 'scheduled',
        matchDateUtc: { $lt: new Date() },
        source: 'openligadb' 
    });

    if(matchesToCheck.length === 0) {
        console.log("CRON: No results to fetch from OpenLigaDB.");
        return { updatedCount };
    }

    console.log(`CRON: Checking for results for ${matchesToCheck.length} OpenLigaDB matches.`);
    for(const match of matchesToCheck) {
        try {
            const openLigaId = match.externalId.replace('openliga-', '');
            const res = await axios.get(`https://api.openligadb.de/getmatchdata/${openLigaId}`);
            const matchResult = res.data;

            if (matchResult && matchResult.matchIsFinished) {
                const homeGoals = matchResult.matchResults?.find(r => r.resultName === 'Endergebnis')?.pointsTeam1;
                const awayGoals = matchResult.matchResults?.find(r => r.resultName === 'Endergebnis')?.pointsTeam2;
                
                if (homeGoals !== undefined && awayGoals !== undefined) {
                    await Match.updateOne({ _id: match._id }, {
                        $set: {
                            status: 'finished',
                            homeGoals,
                            awayGoals,
                            updatedAt: new Date(),
                        }
                    });
                    updatedCount++;
                    console.log(`CRON: Updated result for OpenLigaDB match ${match.externalId}`);
                }
            }
        } catch(error) {
            console.error(`CRON: Failed to fetch result for match ${match.externalId}:`, error.message);
        }
    }
    
    return { updatedCount };
}

module.exports = {
    fetchAndStoreMatches,
    generateAllPredictions,
    fetchAndStoreResults
};
const axios = require('axios');
const Match = require('../models/Match');
const Team = require('../models/Team');
const Prediction = require('../models/Prediction');
const { getPredictionFromAI } = require('./aiService');

async function getOrCreateTeam(name) {
    if (!name) return null;
    let team = await Team.findOne({ name });
    if (!team) {
        team = await Team.create({ name });
    }
    return team;
}

// Helper to get the current season for OpenLigaDB (e.g., 2023 for 2023/2024 season)
function getCurrentSeason() {
    const today = new Date();
    return today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
}

async function fetchFromSoccersAPI() {
    let newMatchesCount = 0;
    const { SOCCERSAPI_USER, SOCCERSAPI_TOKEN } = process.env;
    if (!SOCCERSAPI_USER || !SOCCERSAPI_TOKEN) {
        throw new Error("SoccersAPI credentials not found. Cannot fetch from primary source.");
    }

    const today = new Date().toISOString().split('T')[0];
    const url = `https://api.soccersapi.com/v2.2/fixtures/?user=${SOCCERSAPI_USER}&token=${SOCCERSAPI_TOKEN}&t=schedule&d=${today}`;

    console.log(`CRON: Fetching matches for ${today} from SoccersAPI.`);
    const response = await axios.get(url);
    const liveMatches = response.data.data || [];
    console.log(`CRON: Found ${liveMatches.length} matches from SoccersAPI.`);

    for (const matchData of liveMatches) {
        if (!matchData.id || !matchData.home_name || !matchData.away_name) continue;

        const externalId = `soccersapi-${matchData.id}`;
        const existingMatch = await Match.findOne({ externalId });
        if (existingMatch) continue;

        const homeTeam = await getOrCreateTeam(matchData.home_name);
        const awayTeam = await getOrCreateTeam(matchData.away_name);
        if (!homeTeam || !awayTeam) continue;

        // safer date parsing
        const matchDateTime = new Date(`${matchData.date}T${matchData.time || '00:00:00'}`);

        await Match.create({
            source: 'soccersapi',
            externalId,
            leagueCode: matchData.league_name,
            matchDateUtc: matchDateTime,
            status: 'scheduled',
            homeTeam: homeTeam._id,
            awayTeam: awayTeam._id,
        });
        newMatchesCount++;
    }
    return { newMatchesCount };
}

async function fetchFromOpenLigaDB() {
    let newMatchesCount = 0;
    let updatedMatchesCount = 0;
    const leagueShortcuts = ['bl1', 'bl2']; // German Bundesliga 1 and 2
    const currentSeason = getCurrentSeason();

    for (const league of leagueShortcuts) {
        const url = `https://api.openligadb.de/getmatchdata/${league}/${currentSeason}`;
        console.log(`CRON: Fetching matches for league ${league}, season ${currentSeason} from OpenLigaDB.`);
        const openLigaRes = await axios.get(url);
        const liveMatches = openLigaRes.data || [];
        console.log(`CRON: Found ${liveMatches.length} matches for ${league} from OpenLigaDB.`);

        for (const matchData of liveMatches) {
            if (!matchData.matchID || !matchData.team1?.teamName || !matchData.team2?.teamName) continue;

            const externalId = `openliga-${matchData.matchID}`;
            const existingMatch = await Match.findOne({ externalId });

            // Parse last update date safely
            const lastUpdateDate = new Date(matchData.lastUpdateDateTimeUTC || matchData.matchDateTimeUTC || new Date());

            if (existingMatch) {
                const existingLastUpdate = new Date(existingMatch.updatedAt || 0);
                if (lastUpdateDate > existingLastUpdate) {
                    console.log(`CRON: Updating match ${externalId} from OpenLigaDB.`);
                    const homeGoals = matchData.matchResults.find(r => r.resultName === 'Endergebnis')?.pointsTeam1;
                    const awayGoals = matchData.matchResults.find(r => r.resultName === 'Endergebnis')?.pointsTeam2;
                    await Match.updateOne({ _id: existingMatch._id }, {
                        $set: {
                            status: matchData.matchIsFinished ? 'finished' : 'scheduled',
                            homeGoals,
                            awayGoals,
                            updatedAt: lastUpdateDate
                        }
                    });
                    updatedMatchesCount++;
                }
                continue;
            }

            const homeTeam = await getOrCreateTeam(matchData.team1.teamName);
            const awayTeam = await getOrCreateTeam(matchData.team2.teamName);
            if (!homeTeam || !awayTeam) continue;

            const homeGoalsOnCreate = matchData.matchResults.find(r => r.resultName === 'Endergebnis')?.pointsTeam1;
            const awayGoalsOnCreate = matchData.matchResults.find(r => r.resultName === 'Endergebnis')?.pointsTeam2;

            console.log(`CRON: Creating new match ${externalId} from OpenLigaDB.`);
            await Match.create({
                source: 'openligadb',
                externalId,
                leagueCode: matchData.leagueName,
                matchDateUtc: new Date(matchData.matchDateTimeUTC),
                status: matchData.matchIsFinished ? 'finished' : 'scheduled',
                homeTeam: homeTeam._id,
                awayTeam: awayTeam._id,
                homeGoals: homeGoalsOnCreate,
                awayGoals: awayGoalsOnCreate,
                updatedAt: lastUpdateDate,
            });
            newMatchesCount++;
        }
    }
    return { newMatchesCount, updatedMatchesCount };
}

async function fetchAndStoreMatches() {
    let newMatchesCount = 0;
    let updatedMatchesCount = 0;
    let newHistoryCount = 0;

    try {
        console.log("CRON: Attempting primary source: SoccersAPI");
        const soccersApiResult = await fetchFromSoccersAPI();
        newMatchesCount += soccersApiResult.newMatchesCount;
    } catch (error) {
        console.error("CRON: Primary source SoccersAPI failed:", error.message);
        console.log("CRON: Falling back to secondary source: OpenLigaDB");
        try {
            const openLigaResult = await fetchFromOpenLigaDB();
            newMatchesCount += openLigaResult.newMatchesCount;
            updatedMatchesCount += openLigaResult.updatedMatchesCount;
        } catch (fallbackError) {
            console.error("CRON: Fallback source OpenLigaDB also failed:", fallbackError.message);
        }
    }

    if (process.env.FOOTBALL_JSON_URL) {
        try {
            console.log("CRON: Fetching historical matches from football.json");
            const fallbackRes = await axios.get(process.env.FOOTBALL_JSON_URL);
            const history = fallbackRes.data.matches || [];
            console.log(`CRON: Found ${history.length} historical matches.`);

            for (const matchData of history) {
                if (!matchData.team1 || !matchData.team2 || !matchData.date) continue;

                const externalId = `footballjson-${matchData.date}-${matchData.team1}-${matchData.team2}`;
                const existingMatch = await Match.findOne({ externalId });
                if (existingMatch) continue;

                const homeTeam = await getOrCreateTeam(matchData.team1);
                const awayTeam = await getOrCreateTeam(matchData.team2);
                if (!homeTeam || !awayTeam) continue;

                const homeGoals = matchData.score?.ft?.[0] ?? null;
                const awayGoals = matchData.score?.ft?.[1] ?? null;

                await Match.create({
                    source: 'footballjson',
                    externalId,
                    leagueCode: 'Premier League 23/24 History',
                    matchDateUtc: new Date(matchData.date),
                    status: 'finished',
                    homeTeam: homeTeam._id,
                    awayTeam: awayTeam._id,
                    homeGoals,
                    awayGoals,
                });
                newHistoryCount++;
            }
        } catch (error) {
            console.error("CRON: Error fetching from football.json:", error.message);
        }
    }

    return { newMatchesCount, updatedMatchesCount, newHistoryCount };
}

async function generateAllPredictions() {
    let processedCount = 0;
    const upcomingMatches = await Match.find({
        status: { $in: ['scheduled', 'upcoming', 'tba'] },
        matchDateUtc: { $gte: new Date() },
        prediction: { $exists: false }
    }).populate('homeTeam awayTeam').limit(10).lean();

    if (upcomingMatches.length === 0) {
        console.log("CRON: No new matches require predictions.");
        return { processedCount: 0 };
    }

    console.log(`CRON: Found ${upcomingMatches.length} matches for prediction generation.`);
    const historicalMatches = await Match.find({ status: 'finished' }).populate('homeTeam awayTeam').lean();

    for (const match of upcomingMatches) {
        try {
            if (!match.homeTeam || !match.awayTeam) {
                console.error(`CRON: Skipping prediction for match ${match._id} due to missing team data.`);
                continue;
            }

            const predictionResult = await getPredictionFromAI(match, historicalMatches);

            const predictionDoc = new Prediction({
                matchId: match._id,
                outcomes: predictionResult,
                confidence: predictionResult.confidence,
                bucket: predictionResult.bucket,
                version: '1.5-flash'
            });
            await predictionDoc.save();

            await Match.updateOne({ _id: match._id }, { $set: { prediction: predictionDoc._id } });
            processedCount++;
            console.log(`CRON: Generated prediction for ${match.homeTeam.name} vs ${match.awayTeam.name}`);
        } catch (error) {
            console.error(`CRON: Failed to generate prediction for match ${match._id} (${match.homeTeam?.name} vs ${match.awayTeam?.name}):`, error.message);
        }
    }
    return { processedCount };
}

async function fetchAndStoreResults() {
    let updatedCount = 0;
    const matchesToCheck = await Match.find({
        status: 'scheduled',
        matchDateUtc: { $lt: new Date() },
        source: 'openligadb'
    });

    if (matchesToCheck.length === 0) {
        console.log("CRON: No results to fetch from OpenLigaDB.");
        return { updatedCount };
    }

    console.log(`CRON: Checking for results for ${matchesToCheck.length} OpenLigaDB matches.`);
    for (const match of matchesToCheck) {
        try {
            const openLigaId = match.externalId.replace('openliga-', '');
            const res = await axios.get(`https://api.openligadb.de/getmatchdata/${openLigaId}`);
            const matchResult = res.data;

            if (matchResult && matchResult.matchIsFinished) {
                const homeGoals = matchResult.matchResults?.find(r => r.resultName === 'Endergebnis')?.pointsTeam1;
                const awayGoals = matchResult.matchResults?.find(r => r.resultName === 'Endergebnis')?.pointsTeam2;

                if (homeGoals !== undefined && awayGoals !== undefined) {
                    await Match.updateOne({ _id: match._id }, {
                        $set: {
                            status: 'finished',
                            homeGoals,
                            awayGoals,
                            updatedAt: new Date(),
                        }
                    });
                    updatedCount++;
                    console.log(`CRON: Updated result for OpenLigaDB match ${match.externalId}`);
                }
            }
        } catch (error) {
            console.error(`CRON: Failed to fetch result for match ${match.externalId}:`, error.message);
        }
    }

    return { updatedCount };
}

module.exports = {
    fetchAndStoreMatches,
    generateAllPredictions,
    fetchAndStoreResults
};
