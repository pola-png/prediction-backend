// services/aiService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { z } = require("zod");

// Ensure GEMINI_API_KEY exists
if (!process.env.GEMINI_API_KEY) {
  console.warn('AI: GEMINI_API_KEY environment variable not set. AI features will be disabled.');
}

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// Zod schema for a single prediction (same shape used for validation)
const GenerateMatchPredictionsOutputSchema = z.object({
  oneXTwo: z.object({ home: z.number(), draw: z.number(), away: z.number() }),
  doubleChance: z.object({ homeOrDraw: z.number(), homeOrAway: z.number(), drawOrAway: z.number() }),
  over05: z.number(),
  over15: z.number(),
  over25: z.number(),
  bttsYes: z.number(),
  bttsNo: z.number(),
  confidence: z.number().min(0).max(100),
  bucket: z.enum(['vip', '2odds', '5odds', 'big10']),
});

// Models to attempt (fallback order). Keep names you actually can access in your Google account.
// Add/remove models according to your Google AI Studio access/permitted names.
const aiModels = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-pro",
  "gemini-1.5-flash-preview",
  "gemini-1.5-pro-preview",
  "gemini-1.0"
];

async function callGenerativeAI(prompt, outputSchema) {
  if (!genAI) throw new Error("Generative AI is not initialized. Check GEMINI_API_KEY.");

  const maxRetries = 2;

  for (const modelName of aiModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      // try a couple of times per model
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const text = response.text();

          if (!text) throw new Error("AI returned empty response.");

          // strip markdown fences if any and parse
          const jsonString = text.replace(/```json/g, "").replace(/```/g, "").trim();
          const parsed = JSON.parse(jsonString);

          // If AI returns array of predictions or single object, normalize to array
          if (Array.isArray(parsed)) {
            // validate each element
            return parsed.map(item => outputSchema.parse(item));
          }
          return [outputSchema.parse(parsed)];
        } catch (err) {
          // if last attempt for this model -> throw to try next model
          if (attempt === maxRetries) {
            console.warn(`AI [${modelName}] failed after ${maxRetries + 1} attempts: ${err.message}`);
            break;
          }
          // exponential backoff
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
      }
    } catch (outer) {
      console.warn(`AI: model ${modelName} unavailable or call failed: ${outer.message}`);
      // continue to next model
    }
  }

  throw new Error("AI: All models failed to generate predictions.");
}

/**
 * Returns an array of predictions (each conforms to the zod schema).
 * Filters predictions to include only those with confidence >= 90 (per requirement).
 * If AI returns fewer than desired, caller will handle it.
 */
async function getPredictionsFromAI(match, historicalMatches) {
  // Build compact H2H list
  const h2hMatches = (historicalMatches || []).filter(
    h =>
      (h.homeTeam?.name === match.homeTeam?.name && h.awayTeam?.name === match.awayTeam?.name) ||
      (h.homeTeam?.name === match.awayTeam?.name && h.awayTeam?.name === match.homeTeam?.name)
  );

  const prompt = `
You are an expert sports analyst. Generate multiple football match predictions in JSON array format.

Match: ${match.homeTeam?.name} vs ${match.awayTeam?.name}
League: ${match.leagueCode || 'N/A'}
Date: ${match.matchDateUtc}

Head-to-Head:
${h2hMatches.map(m => `- ${new Date(m.matchDateUtc).toLocaleDateString()}: ${m.homeTeam?.name || 'N/A'} ${m.homeGoals ?? '-'} - ${m.awayGoals ?? '-'} ${m.awayTeam?.name || 'N/A'}`).join('\n') || 'No direct H2H data available.'}

Provide a JSON array of prediction objects. Each object must include:
- oneXTwo: { home, draw, away } (probabilities 0-1, sum ideally ~1)
- doubleChance: { homeOrDraw, homeOrAway, drawOrAway }
- over05, over15, over25 (probabilities 0-1)
- bttsYes, bttsNo (probabilities 0-1, sum ideally ~1)
- confidence (0-100)
- bucket (one of 'vip','2odds','5odds','big10')

Only include predictions with confidence >= 90. Return valid JSON only (no markdown fences).
`;

  const predictions = await callGenerativeAI(prompt, GenerateMatchPredictionsOutputSchema);
  // Ensure list and filter confidence >= 90 (safety)
  const filtered = (predictions || []).filter(p => typeof p.confidence === 'number' && p.confidence >= 90);
  return filtered;
}

async function getSummaryFromAI(match) {
  if (!genAI) throw new Error("Generative AI is not initialized. Check GEMINI_API_KEY.");

  const prompt = `
Provide a concise summary of the key insights and factors influencing the prediction for the match between ${match.homeTeam?.name} and ${match.awayTeam?.name}.
Focus on: recent form, head-to-head, home advantage, key injuries (if known), and goal trends. Keep it short and factual.
`;
  for (const modelName of aiModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (err) {
      console.warn(`AI summary failed for ${modelName}: ${err.message}`);
    }
  }
  throw new Error("AI: All models failed to generate summary.");
}

module.exports = { getPredictionsFromAI, getSummaryFromAI };
