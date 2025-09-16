// services/aiService.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { z } = require('zod');

if (!process.env.GEMINI_API_KEY) {
  console.warn('AI: GEMINI_API_KEY not set. AI features disabled.');
}
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// Output schema for each prediction object (probabilities 0..1, confidence 0..100)
const GenerateMatchPredictionsOutputSchema = z.object({
  oneXTwo: z.object({ home: z.number().min(0).max(1), draw: z.number().min(0).max(1), away: z.number().min(0).max(1) }).optional(),
  doubleChance: z.object({
    homeOrDraw: z.number().min(0).max(1),
    homeOrAway: z.number().min(0).max(1),
    drawOrAway: z.number().min(0).max(1)
  }).optional(),
  over05: z.number().min(0).max(1).optional(),
  over15: z.number().min(0).max(1).optional(),
  over25: z.number().min(0).max(1).optional(),
  bttsYes: z.number().min(0).max(1).optional(),
  bttsNo: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(100),
  bucket: z.string()
});

// AI model order (try newer first)
const aiModels = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-1.5-flash',
  'gemini-1.5-pro'
];

async function callGenerativeAI(prompt, outputSchema) {
  if (!genAI) throw new Error('Generative AI not initialized (GEMINI_API_KEY).');

  const maxModelRetries = 2;
  for (const modelName of aiModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      for (let attempt = 0; attempt <= maxModelRetries; attempt++) {
        try {
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const text = response.text();
          if (!text) throw new Error('AI returned empty response');

          // attempt to extract JSON substring
          const jsonStringMatch = text.match(/(\[.*\]|\{.*\})/s);
          const jsonString = jsonStringMatch ? jsonStringMatch[0].replace(/```json|```/g, '').trim() : text.trim();

          let parsed;
          try {
            parsed = JSON.parse(jsonString);
          } catch (err) {
            // try to fix common trailing commas
            const fixed = jsonString.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
            parsed = JSON.parse(fixed);
          }

          // Accept array or single object
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          // Validate & parse via zod
          return arr.map(item => outputSchema.parse(item));
        } catch (errInner) {
          if (attempt === maxModelRetries) {
            console.warn(`AI [${modelName}] parse/generate failed after ${maxModelRetries + 1} attempts: ${errInner.message}`);
            break;
          }
          // backoff
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
      }
    } catch (outerErr) {
      console.warn(`AI model ${modelName} unavailable: ${outerErr.message}`);
    }
  }
  throw new Error('AI: All models failed to generate predictions.');
}

async function getPredictionsFromAI(match, historicalMatches = []) {
  if (!genAI) {
    // If AI not configured, return empty array (frontend will still work)
    return [];
  }

  const h2hMatches = (historicalMatches || []).filter(h =>
    (h.homeTeam?.name === match.homeTeam?.name && h.awayTeam?.name === match.awayTeam?.name) ||
    (h.homeTeam?.name === match.awayTeam?.name && h.awayTeam?.name === match.homeTeam?.name)
  );

  const prompt = `
You are an expert football analyst. Produce a JSON array of 1-3 prediction objects for the match below.
Return valid JSON only (no markdown). Each object must include:
 - oneXTwo (home, draw, away) probabilities (0-1) if available
 - doubleChance (homeOrDraw, homeOrAway, drawOrAway) probabilities (0-1) if available
 - over05, over15, over25 (0-1) optionally
 - bttsYes, bttsNo (0-1) optionally
 - confidence (0-100)
 - bucket: one of "vip","daily2","value5","big10"

Match: ${match.homeTeam?.name} vs ${match.awayTeam?.name}
League: ${match.league || match.leagueCode || 'N/A'}
Date (UTC): ${match.matchDateUtc}

Head-to-head (most recent first):
${h2hMatches.length ? h2hMatches.map(h => `- ${new Date(h.matchDateUtc).toISOString()}: ${h.homeTeam?.name || 'N/A'} ${h.homeGoals ?? '-'}-${h.awayGoals ?? '-'} ${h.awayTeam?.name || 'N/A'}`).join('\n') : 'No direct H2H'}

Constraints:
- Only return predictions with numeric probabilities in 0..1.
- Confidence should reflect model certainty (0-100).
- Keep JSON compact.

Return an array like:
[
  {
    "oneXTwo": { "home": 0.3, "draw": 0.25, "away": 0.45 },
    "doubleChance": { "homeOrDraw": 0.55, "homeOrAway": 0.7, "drawOrAway": 0.8 },
    "over05": 0.95,
    "over15": 0.7,
    "over25": 0.4,
    "bttsYes": 0.6,
    "bttsNo": 0.4,
    "confidence": 92,
    "bucket": "vip"
  }
]
`;

  const parsed = await callGenerativeAI(prompt, GenerateMatchPredictionsOutputSchema);

  // Filter: return predictions with valid numeric confidence and at least some probs
  return (parsed || []).filter(p => typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 100);
}

async function getSummaryFromAI(match) {
  if (!genAI) throw new Error('Generative AI not initialized.');
  const prompt = `
Briefly summarize the main reasons behind the prediction for ${match.homeTeam?.name} vs ${match.awayTeam?.name}. 
Focus on recent form, H2H and goal trends. Return plain text only (no JSON).
`;
  for (const modelName of aiModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      if (text) return text.trim();
    } catch (err) {
      console.warn(`AI summary failed on ${modelName}: ${err.message}`);
    }
  }
  throw new Error('AI: All models failed to generate summary.');
}

module.exports = { getPredictionsFromAI, getSummaryFromAI };
