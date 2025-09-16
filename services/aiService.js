// services/aiService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { z } = require("zod");

if (!process.env.GEMINI_API_KEY) {
  console.warn('AI: GEMINI_API_KEY environment variable not set. AI features will be disabled.');
}
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// Utility: convert probability (0–1) to decimal odds
const probToOdds = (p) => {
  if (typeof p !== 'number' || p <= 0) return null;
  return +(1 / p).toFixed(2); // keep 2 decimals
};

// Schema definition
const GenerateMatchPredictionsOutputSchema = z.object({
  oneXTwo: z.object({
    home: z.number(),
    draw: z.number(),
    away: z.number()
  }),
  doubleChance: z.object({
    homeOrDraw: z.number(),
    homeOrAway: z.number(),
    drawOrAway: z.number()
  }),
  over05: z.number(),
  over15: z.number(),
  over25: z.number(),
  bttsYes: z.number(),
  bttsNo: z.number(),
  confidence: z.number().min(0).max(100),
  bucket: z.enum(['vip', 'daily2', 'value5', 'big10']),
});

// Updated AI models fallback order
const aiModels = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-pro",
  "gemini-1.5-flash",
  "gemini-1.5-pro"
];

async function callGenerativeAI(prompt, outputSchema) {
  if (!genAI) throw new Error("Generative AI is not initialized. Check GEMINI_API_KEY.");

  const maxRetries = 2;
  for (const modelName of aiModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const text = response.text();
          if (!text) throw new Error("AI returned empty response.");

          const jsonString = text.replace(/```json/g, "").replace(/```/g, "").trim();
          const parsed = JSON.parse(jsonString);

          if (Array.isArray(parsed)) return parsed.map(item => enrichPrediction(outputSchema.parse(item)));
          return [enrichPrediction(outputSchema.parse(parsed))];
        } catch (err) {
          if (attempt === maxRetries) {
            console.warn(`AI [${modelName}] failed after ${maxRetries + 1} attempts: ${err.message}`);
            break;
          }
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
      }
    } catch (outerErr) {
      console.warn(`AI model ${modelName} unavailable: ${outerErr.message}`);
    }
  }
  throw new Error("AI: All models failed to generate predictions.");
}

// Add odds and accumulator to predictions
function enrichPrediction(pred) {
  const odds = {
    homeWin: probToOdds(pred.oneXTwo.home),
    draw: probToOdds(pred.oneXTwo.draw),
    awayWin: probToOdds(pred.oneXTwo.away),
    homeOrDraw: probToOdds(pred.doubleChance.homeOrDraw),
    homeOrAway: probToOdds(pred.doubleChance.homeOrAway),
    drawOrAway: probToOdds(pred.doubleChance.drawOrAway),
    over05: probToOdds(pred.over05),
    over15: probToOdds(pred.over15),
    over25: probToOdds(pred.over25),
    bttsYes: probToOdds(pred.bttsYes),
    bttsNo: probToOdds(pred.bttsNo),
  };

  return {
    ...pred,
    odds,
  };
}

async function getPredictionsFromAI(match, historicalMatches) {
  const h2hMatches = (historicalMatches || []).filter(h =>
    (h.homeTeam?.name === match.homeTeam?.name && h.awayTeam?.name === match.awayTeam?.name) ||
    (h.homeTeam?.name === match.awayTeam?.name && h.awayTeam?.name === match.homeTeam?.name)
  );

  const prompt = `
You are an expert sports analyst. Generate multiple football match predictions in JSON array format.

Match: ${match.homeTeam?.name} vs ${match.awayTeam?.name}
League: ${match.league || 'N/A'}
Date: ${match.matchDateUtc}

Head-to-Head:
${h2hMatches.map(m => `- ${new Date(m.matchDateUtc).toLocaleDateString()}: ${m.homeTeam?.name || 'N/A'} ${m.homeGoals ?? '-'} - ${m.awayGoals ?? '-'} ${m.awayTeam?.name || 'N/A'}`).join('\n') || 'No direct H2H data available.'}

Provide a JSON array of prediction objects. Each object must include:
- oneXTwo: { home, draw, away } (probabilities 0-1)
- doubleChance: { homeOrDraw, homeOrAway, drawOrAway }
- over05, over15, over25 (0-1)
- bttsYes, bttsNo (0-1)
- confidence (0-100)
- bucket (one of 'vip','daily2','value5','big10')

Only include predictions with confidence >= 90. Return valid JSON only (no markdown fences).
`;

  const preds = await callGenerativeAI(prompt, GenerateMatchPredictionsOutputSchema);
  return (preds || []).filter(p => typeof p.confidence === 'number' && p.confidence >= 90);
}

async function getSummaryFromAI(match) {
  if (!genAI) throw new Error("Generative AI is not initialized. Check GEMINI_API_KEY.");

  const prompt = `
Provide a concise summary of the key insights and factors influencing the prediction for the match between ${match.homeTeam?.name} and ${match.awayTeam?.name}.
Focus on recent form, head-to-head, home advantage and goal trends. Keep it short and factual.
`;

  for (const modelName of aiModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      if (text) return text;
    } catch (err) {
      console.warn(`AI summary failed for ${modelName}: ${err.message}`);
    }
  }
  throw new Error("AI: All models failed to generate summary.");
}

module.exports = { getPredictionsFromAI, getSummaryFromAI };
