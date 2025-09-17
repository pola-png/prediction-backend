// services/aiService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { z } = require("zod");

if (!process.env.GEMINI_API_KEY) {
  console.warn('AI: GEMINI_API_KEY environment variable not set. AI features will be disabled.');
}
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// output schema for a single prediction object
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

// AI model candidates (fallback order)
const aiModels = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-pro",
  "gemini-1.5-flash",
  "gemini-1.5-pro"
];

function extractJSONFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // remove markdown fences
  let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();

  // try parse as-is
  try {
    return JSON.parse(cleaned);
  } catch (e) {}

  // find a JSON array first
  const arrayStart = cleaned.indexOf('[');
  if (arrayStart !== -1) {
    // attempt to extract balanced JSON array substring
    let depth = 0;
    for (let i = arrayStart; i < cleaned.length; i++) {
      if (cleaned[i] === '[') depth++;
      else if (cleaned[i] === ']') depth--;
      if (depth === 0) {
        const candidate = cleaned.slice(arrayStart, i + 1);
        try { return JSON.parse(candidate); } catch (e) {}
        break;
      }
    }
  }

  // fallback: try to find the first object
  const objStart = cleaned.indexOf('{');
  if (objStart !== -1) {
    let depth = 0;
    for (let i = objStart; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++;
      else if (cleaned[i] === '}') depth--;
      if (depth === 0) {
        const candidate = cleaned.slice(objStart, i + 1);
        try { return JSON.parse(candidate); } catch (e) {}
        break;
      }
    }
  }

  return null;
}

async function callGenerativeAI(prompt, outputSchema) {
  if (!genAI) throw new Error("Generative AI is not initialized. Check GEMINI_API_KEY.");

  const maxRetries = 1; // inner retry loop for a single model
  for (const modelName of aiModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const text = response.text();
          if (!text || !text.trim()) throw new Error("AI returned empty response.");

          const parsed = extractJSONFromText(text);
          if (!parsed) throw new Error("AI response did not contain valid JSON.");

          // If parsed is array -> parse each item, else single object
          if (Array.isArray(parsed)) {
            return parsed.map(item => outputSchema.parse(item));
          } else {
            return [outputSchema.parse(parsed)];
          }
        } catch (err) {
          if (attempt === maxRetries) {
            console.warn(`AI [${modelName}] failed attempt ${attempt}: ${err.message}`);
            break;
          }
          // small backoff and retry
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
      }
    } catch (outerErr) {
      console.warn(`AI model ${modelName} unavailable: ${outerErr.message}`);
    }
  }
  throw new Error("AI: All models failed to generate predictions.");
}

async function getPredictionsFromAI(match, historicalMatches) {
  if (!genAI) throw new Error("AI: No GEMINI_API_KEY configured");

  const h2hMatches = (historicalMatches || []).filter(h =>
    (h.homeTeam?.name === match.homeTeam?.name && h.awayTeam?.name === match.awayTeam?.name) ||
    (h.homeTeam?.name === match.awayTeam?.name && h.awayTeam?.name === match.homeTeam?.name)
  );

  const prompt = `
You are an expert football analyst. Output a JSON array (or a single JSON object) with prediction objects for the match.
Match: ${match.homeTeam?.name} vs ${match.awayTeam?.name}
League: ${match.league || 'N/A'}
Date (UTC): ${new Date(match.matchDateUtc).toISOString()}

Head-to-head (most relevant):
${h2hMatches.slice(0,10).map(m => `- ${new Date(m.matchDateUtc).toISOString().split('T')[0]}: ${m.homeTeam?.name || 'N/A'} ${m.homeGoals ?? '-'} - ${m.awayGoals ?? '-'} ${m.awayTeam?.name || 'N/A'}`).join('\n') || 'No direct H2H data available.'}

Return a JSON array of prediction objects. Each object must contain:
- oneXTwo: { home:number, draw:number, away:number } // probabilities 0-1
- doubleChance: { homeOrDraw:number, homeOrAway:number, drawOrAway:number }
- over05, over15, over25: numbers 0-1
- bttsYes, bttsNo: numbers 0-1
- confidence: number (0-100) // how confident the model is
- bucket: string (one of 'vip','daily2','value5','big10')

Only include predictions with confidence >= 90. Provide valid JSON only (no markdown fences). Use decimal probabilities and ensure numbers are between 0 and 1 (except confidence which is 0-100).
`;

  const preds = await callGenerativeAI(prompt, GenerateMatchPredictionsOutputSchema);
  // filter defensively for confidence >= 90 and normalize numbers
  return (preds || []).map(p => ({
    oneXTwo: {
      home: Math.max(0, Math.min(1, p.oneXTwo.home)),
      draw: Math.max(0, Math.min(1, p.oneXTwo.draw)),
      away: Math.max(0, Math.min(1, p.oneXTwo.away))
    },
    doubleChance: {
      homeOrDraw: Math.max(0, Math.min(1, p.doubleChance.homeOrDraw)),
      homeOrAway: Math.max(0, Math.min(1, p.doubleChance.homeOrAway)),
      drawOrAway: Math.max(0, Math.min(1, p.doubleChance.drawOrAway))
    },
    over05: Math.max(0, Math.min(1, p.over05)),
    over15: Math.max(0, Math.min(1, p.over15)),
    over25: Math.max(0, Math.min(1, p.over25)),
    bttsYes: Math.max(0, Math.min(1, p.bttsYes)),
    bttsNo: Math.max(0, Math.min(1, p.bttsNo)),
    confidence: Math.max(0, Math.min(100, p.confidence)),
    bucket: p.bucket
  })).filter(p => typeof p.confidence === 'number' && p.confidence >= 90);
}

async function getSummaryFromAI(match) {
  if (!genAI) throw new Error("Generative AI is not initialized. Check GEMINI_API_KEY.");

  const prompt = `
Provide a concise summary (2-4 sentences) of key factors for ${match.homeTeam?.name} vs ${match.awayTeam?.name}: recent form, head-to-head, home advantage, goal trends. Keep factual and short.
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
