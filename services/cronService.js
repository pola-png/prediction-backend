const axios = require('axios');
const Match = require('../models/Match');
const Team = require('../models/Team');
const Prediction = require('../models/Prediction');
const History = require('../models/History'); // new model
const { getPredictionsFromAI } = require('./aiService');

// Axios instance with timeout and retry
const http = axios.create({ timeout: 60000, maxRedirects: 5 });

/* ---------------- Helper Functions ---------------- */
async function getOrCreateTeam(name, logoUrl = null) {
    if (!name) return null;
    const cleanName = String(name).trim();
    if (!cleanName) return null;

    let team = await Team.findOne({ name: cleanName }).exec();
    if (!team) {
        team = await Team.create({ name: cleanName, logo: logoUrl || null });
    } else if (logoUrl && !team.logo) {
        team.logo = logoUrl;
        await team.save();
    }
    return team;
}

function tryParseDate(...candidates) {
    for (const c of candidates) {
        if (!c) continue;
        const d = new Date(c);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}

function withinNext24Hours(date) {
    if (!date) return false;
    const now = new Date();
    const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return date >= now && date <= until;
}

async function safeGet(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await http.get(url);
        } catch (err) {
            if (i === retries - 1) throw err;
            console.warn(`Retrying (${i + 1}/${retries}) after error:`, err.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

/* ---------------- SoccersAPI Fetch ---------------- */
async function fetchUpcomingFromSoccersAPI() {
    const { SOCCERSAPI_USER, SOCCERSAPI_TOKEN } = process.env;
    if (!SOCCERSAPI_USER || !SOCCERSAPI_TOKEN) {
        console.warn('SoccersAPI credentials missing');
        return { newMatchesCount: 0 };
    }

    let newMatchesCount = 0;
    try {
        const todayUTC = new Date().toISOString().split('T')[0];
        const url = `https://api.soccersapi.com/v2.2/fixtures/?user=${SOCCERSAPI_USER}&token=${SOCCERSAPI_TOKEN}&t=schedule&d=${todayUTC}&utc=0`;
        console.log('Fetching SoccersAPI:', url);
        const res = await safeGet(url);
        const items = res.data?.data || [];
        console.log(`SoccersAPI returned ${items.length} matches`);

        for (const md of items) {
            try {
                const homeName = md.home_name || md.home?.name;
                const awayName = md.away_name || md.away?.name;
                if (!md.id || !homeName || !awayName) continue;

                const matchDate = tryParseDate(
                    md.date && md.time ? `${md.date}T${md.time}Z` : null,
                    md.utcDate,
                    md.matchDateUtc
                );
                if (!matchDate || !withinNext24Hours(matchDate)) continue;

                const externalId = `soccersapi-${md.id}`;
                const leagueName = md.league_name || md.league || md.leagueCode || null;

                const homeTeam = await getOrCreateTeam(homeName, md.home?.logo || md.home_logo || null);
                const awayTeam = await getOrCreateTeam(awayName, md.away?.logo || md.away_logo || null);
                if (!homeTeam || !awayTeam) continue;

                const existing = await Match.findOne({ externalId }).exec();
                if (existing) {
                    existing.matchDateUtc = matchDate;
                    existing.league = existing.league || leagueName;
                    existing.homeTeam = existing.homeTeam || homeTeam._id;
                    existing.awayTeam = existing.awayTeam || awayTeam._id;
                    existing.source = 'soccersapi';
                    existing.status = existing.status || 'scheduled';
                    await existing.save();
                } else {
                    await Match.create({
                        source: 'soccersapi',
                        externalId,
                        league: leagueName,
                        matchDateUtc: matchDate,
                        status: 'scheduled',
                        homeTeam: homeTeam._id,
                        awayTeam: awayTeam._id
                    });
                    newMatchesCount++;
                }
            } catch (err) {
                console.warn('CRON:soccersapi item skip:', err.message);
            }
        }
    } catch (err) {
        console.error('SoccersAPI fetch failed:', err.message);
    }

    return { newMatchesCount };
}

/* ---------------- Fetch & store upcoming matches ---------------- */
async function fetchAndStoreUpcomingMatches() {
    let totalNew = 0;
    try {
        const socRes = await fetchUpcomingFromSoccersAPI();
        totalNew += socRes.newMatchesCount || 0;
    } catch (err) {
        console.error('CRON: SoccersAPI failed:', err.message);
    }
    console.log(`Total new matches fetched: ${totalNew}`);
    return { newMatchesCount: totalNew };
}

/* ---------------- Generate predictions ---------------- */
async function generateAllPredictions() {
    let processedCount = 0;
    const now = new Date();
    const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const upcoming = await Match.find({
        status: { $in: ['scheduled', 'upcoming', 'tba'] },
        matchDateUtc: { $gte: now, $lte: until }
    }).populate('homeTeam awayTeam').limit(50).lean();

    if (!upcoming.length) return { processedCount: 0 };

    const historical = await History.find({ status: 'finished' })
        .populate('homeTeam awayTeam')
        .lean();

    for (const match of upcoming) {
        try {
            if (!match.homeTeam || !match.awayTeam) continue;
            const aiPredictions = await getPredictionsFromAI(match, historical);
            for (const p of aiPredictions) {
                await Prediction.findOneAndUpdate(
                    { matchId: match._id, bucket: p.bucket },
                    {
                        matchId: match._id,
                        version: 'ai-2x',
                        outcomes: {
                            oneXTwo: p.oneXTwo,
                            doubleChance: p.doubleChance,
                            over05: p.over05,
                            over15: p.over15,
                            over25: p.over25,
                            bttsYes: p.bttsYes,
                            bttsNo: p.bttsNo,
                        },
                        confidence: p.confidence,
                        bucket: p.bucket,
                        status: 'pending'
                    },
                    { upsert: true, new: true }
                );
                processedCount++;
            }
        } catch (err) {
            console.error(`CRON: prediction fail for match ${match._id}:`, err.message);
        }
    }

    return { processedCount };
}

/* ---------------- Export ---------------- */
module.exports = {
    fetchAndStoreUpcomingMatches,
    fetchUpcomingFromSoccersAPI,
    generateAllPredictions
};
