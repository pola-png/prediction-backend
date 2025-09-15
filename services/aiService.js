const { GoogleGenerativeAI } = require("@google/generative-ai");
const { z } = require("zod");

// Ensure GEMINI_API_KEY exists
if (!process.env.GEMINI_API_KEY) {
  console.warn('AI: GEMINI_API_KEY environment variable not set. AI features will be disabled.');
}

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// Zod schema for validation
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

// List of AI models to try (fallback order)
const aiModels = [
  "gemini-1.5-flash-preview",
  "gemini-1.5-preview",
  "gemini-1.0"
];

async function callGenerativeAI(prompt, outputSchema) {
  if (!genAI) throw new Error("Generative AI is not initialized. Check GEMINI_API_KEY.");

  const maxRetries = 3;
  for (const modelName of aiModels) {
    const model = genAI.getGenerativeModel({ model: modelName });
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        if (!text) throw new Error("AI returned empty response.");

        const jsonString = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(jsonString);

        if (Array.isArray(parsed)) {
          return parsed.map(item => outputSchema.parse(item));
        }
        return outputSchema.parse(parsed);
      } catch (error) {
        console.error(`AI [${modelName}] attempt ${attempt + 1} failed: ${error.message}`);
        if (attempt === maxRetries - 1) {
          console.warn(`AI model ${modelName} failed after ${maxRetries} attempts, trying next model...`);
        } else {
          await new Promise(res => setTimeout(res, 1000 * Math.pow(2, attempt)));
        }
      }
    }
  }
  throw new Error("AI: All models failed to generate predictions.");
}

async function getPredictionsFromAI(match, historicalMatches) {
  const h2hMatches = historicalMatches.filter(
    h =>
      (h.homeTeam.name === match.homeTeam.name && h.awayTeam.name === match.awayTeam.name) ||
      (h.homeTeam.name === match.awayTeam.name && h.awayTeam.name === match.homeTeam.name)
  );

  const prompt = `
You are an expert sports analyst. Generate multiple football match predictions in JSON array format.

Match Details: ${match.homeTeam.name} vs ${match.awayTeam.name}
League: ${match.leagueCode}
Date: ${match.matchDateUtc}

Historical Head-to-Head:
${h2hMatches.map(m => `- ${new Date(m.matchDateUtc).toLocaleDateString()}: ${m.homeTeam.name} ${m.homeGoals} - ${m.awayGoals} ${m.awayTeam.name}`).join('\n') || 'No direct H2H data available.'}

Provide an array of predictions with probabilities (0-1) for:
- 1X2 (home, draw, away)
- Double Chance (home/draw, home/away, draw/away)
- Over/Under 0.5, 1.5, 2.5 goals
- Both Teams to Score (BTTS) Yes/No
- Confidence score (0-100)
- Prediction bucket ('vip', '2odds', '5odds', 'big10')

Only include predictions with confidence ≥90. Your response MUST be a valid JSON array conforming to the Zod schema provided.
Do not wrap the JSON in markdown backticks.
`;

  const allPredictions = await callGenerativeAI(prompt, GenerateMatchPredictionsOutputSchema);
  return allPredictions.filter(p => p.confidence >= 90);
}

async function getSummaryFromAI(match) {
  if (!genAI) throw new Error("Generative AI is not initialized. Check GEMINI_API_KEY.");

  const prompt = `
Provide a concise summary of the key insights and factors influencing the prediction for the match between ${match.homeTeam.name} and ${match.awayTeam.name}.
Focus on significant factors like team form, head-to-head stats, home advantage, and goal trends. Explain rationale clearly.
`;

  const allModels = [...aiModels];
  for (const modelName of allModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (err) {
      console.warn(`AI summary failed for model ${modelName}: ${err.message}`);
    }
  }

  throw new Error("AI: All models failed to generate summary.");
}

module.exports = { getPredictionsFromAI, getSummaryFromAI };
