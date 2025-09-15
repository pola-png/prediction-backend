const { GoogleGenerativeAI } = require("@google/generative-ai");
const { z } = require("zod");

if (!process.env.GEMINI_API_KEY) {
  console.warn('AI: GEMINI_API_KEY environment variable not set. AI features will be disabled.');
}
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// --- Schema for single prediction ---
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

// --- Convert probability (0-1) to decimal odds ---
function probToOdds(prob) {
  if (prob <= 0) return null;
  return +(1 / prob).toFixed(2);
}

async function callGenerativeAI(prompt, outputSchema) {
  if (!genAI) throw new Error("Generative AI is not initialized. Check GEMINI_API_KEY.");
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-preview" });

  const maxRetries = 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      if (!text) throw new Error("AI returned empty response.");

      const jsonString = text.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(jsonString);
      return outputSchema.parse(parsed);
    } catch (error) {
      console.error(`AI: Attempt ${i + 1} failed. Error: ${error.message}`);
      if (i === maxRetries - 1) throw new Error(`AI failed after ${maxRetries} attempts: ${error.message}`);
      await new Promise(res => setTimeout(res, 1000 * Math.pow(2, i)));
    }
  }
}

// --- Get multiple predictions per match, filtered by confidence ---
async function getPredictionsFromAI(match, historicalMatches, bucket, count = 3, minConfidence = 90) {
  const h2hMatches = historicalMatches.filter(
    h =>
      (h.homeTeam.name === match.homeTeam.name && h.awayTeam.name === match.awayTeam.name) ||
      (h.homeTeam.name === match.awayTeam.name && h.awayTeam.name === match.homeTeam.name)
  );

  const prompt = `
You are an expert sports analyst. Generate ${count} ${bucket} football match predictions in JSON array format.

Match: ${match.homeTeam.name} vs ${match.awayTeam.name}
League: ${match.leagueCode}
Date: ${match.matchDateUtc}

Historical H2H:
${h2hMatches.map(m => `- ${new Date(m.matchDateUtc).toLocaleDateString()}: ${m.homeTeam.name} ${m.homeGoals} - ${m.awayGoals} ${m.awayTeam.name}`).join('\n') || 'No direct H2H data available.'}

Provide probabilities (0-1) for:
- 1X2 (home, draw, away)
- Double Chance (home/draw, home/away, draw/away)
- Over/Under 0.5, 1.5, 2.5 goals
- Both Teams to Score (BTTS) Yes/No
- Confidence (0-100)
- Prediction bucket ('${bucket}')

Return a JSON array with ${count} predictions. Ensure confidence is >= ${minConfidence} where possible.
`;

  const rawPredictions = await callGenerativeAI(prompt, z.array(GenerateMatchPredictionsOutputSchema));

  // Add decimal odds for 1X2
  const predictionsWithOdds = rawPredictions.map(p => ({
    ...p,
    odds: {
      home: probToOdds(p.oneXTwo.home),
      draw: probToOdds(p.oneXTwo.draw),
      away: probToOdds(p.oneXTwo.away)
    }
  }));

  return predictionsWithOdds;
}

// --- Single match summary ---
async function getSummaryFromAI(match) {
  if (!genAI) throw new Error("Generative AI is not initialized. Check GEMINI_API_KEY.");
  const prompt = `
Provide a concise summary of key insights for the match between ${match.homeTeam.name} and ${match.awayTeam.name}.
Focus on team form, H2H stats, home advantage, and goal trends. Explain the rationale behind predictions clearly.
  `;
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-preview" });
  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}

module.exports = { getPredictionsFromAI, getSummaryFromAI };
