// Live smoke test for AI scoring. Run by hand only; npm test never calls it.
//
//   AI_API_KEY=… node backend/scripts/ai-smoke.js [questionId]
//
// Sends ONE scoring request to OpenRouter for one sample question
// (default AIS-S1-01) with a made-up answer that contains no personal data,
// through the same guarded provider and payload builder the app uses. Prints
// the model, whether the reply passed validateModelScore, and the validated
// result. The key is read from the environment and never printed.

const { loadConfig } = require("../src/config");
const { loadContent } = require("../src/content");
const { createAiProvider, buildScoringPayload, validateModelScore } = require("../src/ai");

const SYNTHETIC_ANSWERS = {
  "AIS-S1-01": "The line count -= 1 is not indented, so it runs after the loop instead of inside it. count stays 10 and the condition is always true. Indent it under print.",
  "AIS-S2-01": "If scores is an empty list, len(scores) is 0 and it divides by zero. Please make it return 0 for an empty list.",
  "AIS-S2-02": "Try \"level\" (should be True) and \"Racecar\" (should be True, but it returns False because of the capital R)."
};

async function main() {
  const questionId = process.argv[2] || "AIS-S1-01";
  const env = { ...process.env, AI_PROVIDER: process.env.AI_PROVIDER || "openrouter" };
  const config = loadConfig(env);

  if (config.ai.provider !== "openrouter") {
    throw new Error("This smoke test is for AI_PROVIDER=openrouter.");
  }

  if (!SYNTHETIC_ANSWERS[questionId]) {
    throw new Error(`No synthetic answer for ${questionId}. Use one of: ${Object.keys(SYNTHETIC_ANSWERS).join(", ")}`);
  }

  // Report the HTTP status, and OpenRouter's error text on failure (it never
  // contains the key), so a rejected request can be diagnosed.
  let fetches = 0;
  const fetchWithReport = async (url, init) => {
    fetches += 1;
    const response = await fetch(url, init);
    console.log(`HTTP ${response.status} from OpenRouter (request ${fetches})`);

    if (!response.ok) {
      console.log(`Error body: ${(await response.clone().text()).slice(0, 500)}`);
    }

    return response;
  };

  const content = loadContent();
  const store = { content, getEventQuestions: () => [] };
  const provider = createAiProvider({ ...config.ai, maxRetries: 0 }, { fetch: fetchWithReport });
  const question = content.questions.find(item => item.id === questionId);
  const payload = buildScoringPayload({
    store,
    questionId,
    responseText: SYNTHETIC_ANSWERS[questionId],
    studentName: "Synthetic Smoke",
    studentGroup: "Nobody"
  });

  console.log(`Question: ${questionId} (${question.points} points)`);
  console.log(`Model requested: ${provider.model}`);

  const reply = await provider.score(payload);
  const checked = validateModelScore(reply.output, { rubric: payload.question.rubric, maxPoints: payload.question.maxPoints });

  console.log(`Model that answered: ${reply.model}`);
  console.log(`Validated: ${checked.ok ? "yes" : "no"}`);
  console.log(checked.ok ? JSON.stringify(checked.value, null, 2) : `Errors: ${checked.errors.join("; ")}`);
  process.exitCode = checked.ok ? 0 : 1;
}

main().catch(error => {
  console.error(`Smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
