// Run with: node --env-file=.env server.cjs   (Node 20.6+)
const express = require("express");

const app = express();
app.use(express.json({ limit: "20kb" }));

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// Backup models, tried in order if the main one is busy or unavailable.
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.6-flash,gemini-3.5-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const MODELS = [MODEL, ...FALLBACK_MODELS.filter((m) => m !== MODEL)];

const ATTEMPT_TIMEOUT_MS = 4500; // per model
const TOTAL_BUDGET_MS = 13000; // whole request (frontend waits 15s)

const LABELS = ["SAFE", "MODERATE RISK", "HIGH RISK"];
const KEYS = ["dust", "gas", "humidity", "temperature"];

console.log("Gemini models:", MODELS.join(" -> "), "| key loaded:", Boolean(API_KEY));

// Reads text from the new "steps" shape and the older "outputs" shape.
function extractText(result) {
  const fromSteps = (result.steps || [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || []);
  const fromOutputs = result.outputs || [];

  return [...fromSteps, ...fromOutputs]
    .filter((item) => item.type === "text")
    .map((item) => item.text || "")
    .join("\n")
    .trim();
}

async function askModel(model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY,
          "Api-Revision": "2026-05-20",
        },
        body: JSON.stringify({ model, input: prompt, store: false }),
      }
    );
    const result = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, result };
  } finally {
    clearTimeout(timer);
  }
}

app.post("/api/gemini-advice", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is missing from .env" });
  }

  const { riskClass, readings } = req.body || {};
  if (
    !Number.isInteger(riskClass) ||
    !LABELS[riskClass] ||
    !readings ||
    !KEYS.every((k) => Number.isFinite(readings[k]))
  ) {
    return res.status(400).json({ error: "Invalid risk class or sensor readings." });
  }

  const prompt = `You are AirGuard, an environmental guidance assistant for people with asthma.
An on-device ML model classified the current sensor sample as: ${LABELS[riskClass]}.

Readings: dust ${readings.dust} ug/m3, gas ${readings.gas} (raw ADC 0-4095),
humidity ${readings.humidity}%, temperature ${readings.temperature} C.

Write 3 to 5 short, practical environmental suggestions that fit this risk level.
Format: plain text only, one suggestion per line, each line starting with "- ".
No markdown, no bold, no headings. Maximum 90 words in total.
Do not diagnose, prescribe medicine, or invent safety thresholds.
Mention following the clinician-provided asthma action plan.
For HIGH RISK, add that severe breathing difficulty needs emergency medical help.`;

  const startedAt = Date.now();
  let lastError = "Gemini is unavailable.";

  for (const model of MODELS) {
    if (Date.now() - startedAt > TOTAL_BUDGET_MS - 1000) break;

    try {
      const { ok, status, result } = await askModel(model, prompt);

      if (ok) {
        const advice = extractText(result);
        if (advice) {
          console.log(`Advice served by ${model}`);
          return res.json({ advice });
        }
        lastError = `${model} returned no text.`;
        console.error(lastError, JSON.stringify(result));
        continue;
      }

      lastError = result?.error?.message || `${model} returned HTTP ${status}.`;
      console.error(`[${model}] HTTP ${status}:`, lastError);

      // Bad key or no permission: other models will fail too, so stop.
      if (status === 401 || status === 403) break;
      // Busy (429/503), missing model (404), etc.: try the next model.
    } catch (error) {
      lastError = error.name === "AbortError" ? `${model} timed out.` : error.message;
      console.error(`[${model}]`, lastError);
    }
  }

  return res.status(502).json({ error: lastError });
});

function onListenError(err) {
  console.error(`Could not start server on port ${PORT}:`, err.code || "", err.message);
  if (err.code === "EADDRINUSE") {
    console.error("Another program is using this port. Stop it, or change PORT in .env.");
  }
  process.exit(1);
}

// Express 5 passes listen errors to the callback; Express 4 emits an "error" event.
const server = app.listen(PORT, (err) => {
  if (err) return onListenError(err);
  console.log(`AirGuard Gemini advice server running on http://localhost:${PORT}`);
});
server.on("error", onListenError);

process.on("exit", (code) => console.log("Server process exiting, code:", code));
process.on("uncaughtException", (e) => console.error("Uncaught error:", e));
process.on("unhandledRejection", (e) => console.error("Unhandled rejection:", e));
