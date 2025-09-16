// services/aiService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { z } = require("zod");

if (!process.env.GEMINI_API_KEY) {
  console.warn('AI: GEMINI_API_KEY not set. AI features will be disabled.');
}
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const GenerateMatchPredictionsOutputSchema = z.object({
  oneXTwo: z.object({ home: z.number(), draw: z.number(), away: z.number() }),
  doubleChance: z.object({ homeOrDraw: z.number(), homeOrAway: z.number(), drawOrAway: z.number() }),
  over05: z.number(),
  over15: z.number(),
  over25: z.number(),
  bttsYes: z.number(),
  bttsNo: z.number(),
  confidence: z.number().min(0).max(100),
  bucket: z.enum(['vip', 'daily2', 'value5', 'big10']),
});

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

          // Remove markdown fenced blocks if any, trim, extract JSON
          let jsonString = text.replace(/```json/g, "").replace(/```/g, "").trim();

          // Some models return extra text: try to find first JSON substring
          const firstBrace = jsonString.indexOf('[') !== -1 ? jsonString.indexOf('[') : jsonString.indexOf('{');
          if (firstBrace > 0) jsonString = jsonString.slice(firstBrace);

          // Try parse
          const parsed = JSON.parse(jsonString);

          if (Array.isArray(parsed)) return parsed.map(item => outputSchema.parse(item));
          return [outputSchema.parse(parsed)];
        } catch (err) {
          if (attempt === maxRetries) {
            console.warn(`AI [${modelName}] failed after ${maxRetries + 1} attempts: ${err.message}`);
            break;
          }
          // exponential backoff
          await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
        }
      }
    } catch (outerErr) {
      console.warn(`AI model ${modelName} unavailable: ${outerErr.message}`);
    }
  }

  throw new Error("AI: All models failed to generate predictions.");
}

async function getPredictionsFromAI(match, historicalMatches = [], minConfidence = 90) {
  if (!genAI) throw new Error("Generative AI not initialized.");

  // simple H2H summary for prompt
  const h2hMatches = (historicalMatches || []).filter(h =>
    (h.homeTeam?.name === match.homeTeam?.name && h.awayTeam?.name === match.awayTeam?.name) ||
    (h.homeTeam?.name === match.awayTeam?.name && h.awayTeam?.name === match.homeTeam?.name)
  );

  const h2hText = h2hMatches.length
    ? h2hMatches.slice(0, 8).map(m => {
        const d = new Date(m.matchDateUtc);
        const dateStr = `${d.toISOString().split('T')[0]}`;
        const sHome = m.homeGoals != null ? m.homeGoals : '-';
        const sAway = m.awayGoals != null ? m.awayGoals : '-';
        return `- ${dateStr}: ${m.homeTeam?.name || 'N/A'} ${sHome} - ${sAway} ${m.awayTeam?.name || 'N/A'}`;
      }).join('\n')
    : 'No direct H2H data available.';

  const prompt = `
You are a professional football data analyst. Return a JSON array of prediction objects for the match below.
Match: ${match.homeTeam?.name} vs ${match.awayTeam?.name}
League: ${match.leagueName || match.leagueCode || 'N/A'}
Date (UTC): ${match.matchDateUtc}

Head-to-Head:
${h2hText}

Requirements:
- Return only JSON (no markdown fences).
- Provide an array of one or more objects with keys:
  oneXTwo: { home, draw, away }   (numbers between 0 and 1, sum NOT required)
  doubleChance: { homeOrDraw, homeOrAway, drawOrAway }  (0..1)
  over05, over15, over25: numbers (0..1)
  bttsYes, bttsNo: numbers (0..1)
  confidence: integer 0..100
  bucket: one of 'vip','daily2','value5','big10'
- Only return predictions that would be useful for accumulators, include doubleChance and over/gg suggestions.
- Provide realistic/confident predictions; we will filter by minConfidence >= ${minConfidence}.
`;

  const preds = await callGenerativeAI(prompt, GenerateMatchPredictionsOutputSchema);
  return (preds || []).filter(p => typeof p.confidence === 'number' && p.confidence >= minConfidence);
}

async function getSummaryFromAI(match) {
  if (!genAI) throw new Error("Generative AI not initialized.");

  const prompt = `
Provide a concise factual summary for ${match.homeTeam?.name} vs ${match.awayTeam?.name}. Focus on recent form, H2H, home advantage and key trends. Answer in plain text in 2-4 short sentences.
`;
  for (const modelName of aiModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      if (text) return text.trim();
    } catch (err) {
      console.warn(`AI summary failed for ${modelName}: ${err.message}`);
    }
  }
  throw new Error("AI: All models failed to generate summary.");
}

module.exports = { getPredictionsFromAI, getSummaryFromAI };
