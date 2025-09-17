const axios = require('axios');
const Match = require('../models/Match');
const Team = require('../models/Team');
const Prediction = require('../models/Prediction');
const History = require('../models/History');
const { getPredictionsFromAI } = require('./aiService');

// Axios instance
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

/* ---------------- Sportmonks Fetcher ---------------- */

async function fetchUpcomingFromSportmonks() {
    const { SPORTMONKS_TOKEN } = process.env;
    if (!SPORTMONKS_TOKEN) return { newMatchesCount: 0 };

    const today = new Date().toISOString().split('T')[0];
    const url = `https://api.sportmonks.com/v3/football/fixtures/date/${today}?api_token=${SPORTMONKS_TOKEN}&include=localTeam,visitorTeam,league`;
    console.log('Fetching Sportmonks:', url);

    const res = await safeGet(url);
    const items = res.data?.data || [];
    console.log(`Sportmonks returned ${items.length} matches`);

    let newMatchesCount = 0;
    for (const md of items) {
        try {
            const homeTeam = await getOrCreateTeam(md.localTeam?.data?.name, md.localTeam?.data?.logo_path);
            const awayTeam = await getOrCreateTeam(md.visitorTeam?.data?.name, md.visitorTeam?.data?.logo_path);
            if (!homeTeam || !awayTeam) continue;

            const matchDate = tryParseDate(md.time?.starting_at?.date_time_utc);
            if (!matchDate || !withinNext24Hours(matchDate)) continue;

            const externalId = `sportmonks-${md.id}`;
            const leagueName = md.league?.data?.name || null;

            const existing = await Match.findOne({ externalId }).exec();
            if (existing) {
                existing.matchDateUtc = matchDate;
                existing.league = existing.league || leagueName;
                existing.homeTeam = existing.homeTeam || homeTeam._id;
                existing.awayTeam = existing.awayTeam || awayTeam._id;
                existing.source = 'sportmonks';
                existing.status = existing.status || 'scheduled';
                await existing.save();
            } else {
                await Match.create({
                    source: 'sportmonks',
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
            console.warn('CRON: Sportmonks item skip:', err.message);
        }
    }

    return { newMatchesCount };
}

/* ---------------- Goalserve Fetcher ---------------- */

async function fetchUpcomingFromGoalserve({ league, date_start, date_end } = {}) {
    const { GOALSERVE_TOKEN } = process.env;
    if (!GOALSERVE_TOKEN) return { newMatchesCount: 0 };

    // Updated working Goalserve URL
    let url = `https://www.goalserve.com/getfeed/${GOALSERVE_TOKEN}/soccernew/home?json=true`;   if (league) url += `&league=${encodeURIComponent(league)}`;
    if (date_start) url += `&date_start=${encodeURIComponent(date_start)}`;
    if (date_end) url += `&date_end=${encodeURIComponent(date_end)}`;

    console.log('Fetching Goalserve:', url);

    const res = await safeGet(url);
    const items = res.data?.matches || [];
    console.log(`Goalserve returned ${items.length} matches`);

    let newMatchesCount = 0;
    for (const md of items) {
        try {
            const homeTeam = await getOrCreateTeam(md.home?.name, md.home?.logo);
            const awayTeam = await getOrCreateTeam(md.away?.name, md.away?.logo);
            if (!homeTeam || !awayTeam) continue;

            const matchDate = tryParseDate(md.date_utc);
            if (!matchDate || !withinNext24Hours(matchDate)) continue;

            const externalId = `goalserve-${md.id}`;
            const leagueName = md.league?.name || null;

            const existing = await Match.findOne({ externalId }).exec();
            if (existing) {
                existing.matchDateUtc = matchDate;
                existing.league = existing.league || leagueName;
                existing.homeTeam = existing.homeTeam || homeTeam._id;
                existing.awayTeam = existing.awayTeam || awayTeam._id;
                existing.source = 'goalserve';
                existing.status = existing.status || 'scheduled';
                await existing.save();
            } else {
                await Match.create({
                    source: 'goalserve',
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
            console.warn('CRON: Goalserve item skip:', err.message);
        }
    }

    return { newMatchesCount };
}

/* ---------------- Fetch & store upcoming matches ---------------- */

async function fetchAndStoreUpcomingMatches(filters = {}) {
    let totalNew = 0;
    try {
        const sm = await fetchUpcomingFromSportmonks();
        totalNew += sm.newMatchesCount || 0;
    } catch (err) {
        console.error('Sportmonks fetch failed:', err.message);
    }

    try {
        const gs = await fetchUpcomingFromGoalserve(filters);
        totalNew += gs.newMatchesCount || 0;
    } catch (err) {
        console.error('Goalserve fetch failed:', err.message);
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

/* ---------------- Import historical matches ---------------- */

async function importHistoryFromUrl(url) {
    if (!url) throw new Error('No URL provided for history import');

    console.log('Importing history from URL:', url);
    const res = await safeGet(url);
    const items = res.data?.matches || [];
    console.log(`History URL returned ${items.length} matches`);

    let importedCount = 0;

    for (const md of items) {
        try {
            const homeTeam = await getOrCreateTeam(md.home?.name, md.home?.logo);
            const awayTeam = await getOrCreateTeam(md.away?.name, md.away?.logo);
            if (!homeTeam || !awayTeam) continue;

            const matchDate = tryParseDate(md.date_utc, md.date);
            if (!matchDate) continue;

            const externalId = md.externalId || `history-${md.id}`;
            const leagueName = md.league?.name || null;

            const matchData = {
                source: 'history',
                externalId,
                league: leagueName,
                matchDateUtc: matchDate,
                status: 'finished',
                homeTeam: homeTeam._id,
                awayTeam: awayTeam._id,
                homeGoals: md.homeGoals ?? md.home_score ?? 0,
                awayGoals: md.awayGoals ?? md.away_score ?? 0
            };

            const existing = await Match.findOne({ externalId }).exec();
            let match;
            if (existing) {
                Object.assign(existing, matchData);
                await existing.save();
                match = existing;
            } else {
                match = await Match.create(matchData);
            }

            await History.findOneAndUpdate(
                { matchId: match._id },
                { matchId: match._id, status: 'finished' },
                { upsert: true, new: true }
            );

            if (md.predictions && Array.isArray(md.predictions)) {
                for (const p of md.predictions) {
                    await Prediction.findOneAndUpdate(
                        { matchId: match._id, bucket: p.bucket },
                        {
                            matchId: match._id,
                            bucket: p.bucket,
                            version: p.version || 'manual',
                            outcomes: p.outcomes || {},
                            confidence: p.confidence ?? 0,
                            status: 'finished'
                        },
                        { upsert: true, new: true }
                    );
                }
            }

            importedCount++;
        } catch (err) {
            console.warn('History import skip:', err.message);
        }
    }

    console.log(`Imported ${importedCount} historical matches`);
    return { importedCount };
}

/* ---------------- Export ---------------- */
module.exports = {
    fetchAndStoreUpcomingMatches,
    fetchUpcomingFromSportmonks,
    fetchUpcomingFromGoalserve,
    generateAllPredictions,
    importHistoryFromUrl
};
