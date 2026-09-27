// Open response, scored by the AI provider against a rubric.
// Rubric shape: [{ "id", "description", "points" }], one criterion worth the
// question's full points. The rubric is server-only, like an answer key.
// Response: free text; stored as { text }.
//
// Nothing is scored here. A non-empty answer is stored as "pending", and the
// background job in src/ai/jobs.js sends it (redacted, through the guarded
// provider) and later sets "scored" or "needs-review". An empty answer is
// scored 0 at once and never sent anywhere.

const RESPONSE_MAX_CHARS = 1000;
const CRITERION_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

module.exports = {
  type: "open-response-ai",
  status: "active",
  label: "Open response (AI scored)",

  // Scored by the background job in src/ai/jobs.js, so it needs AI_PROVIDER.
  // Event preview and creation warn when AI is off.
  requiresAi: true,

  // Fields a student sees on top of the shared base projection in ../index.js.
  // The rubric is deliberately not one of them.
  publicFields: ["responseMaxChars"],

  RESPONSE_MAX_CHARS,

  // A valid example, used by tests that run against every registered type.
  sample: {
    id: "SAMPLE-OR",
    type: "open-response-ai",
    audience: "rgsynapse",
    level: "S1",
    title: "Sample",
    prompt: "Explain why this loop never ends.",
    rubric: [
      { id: "full", description: "Says the counter never changes, so the condition stays true.", points: 2 },
      { id: "none", description: "Does not explain why the loop repeats.", points: 0 }
    ],
    points: 2,
    difficulty: 2,
    ontology: ["concept.loops"],
    outcomes: ["LO-AI-REVIEW-1"]
  },

  validate(question) {
    const errors = [];
    const rubric = question.rubric;

    if (!Array.isArray(rubric) || rubric.length < 2) {
      return ["open-response-ai needs a rubric with at least 2 criteria"];
    }

    const ids = new Set();

    rubric.forEach((criterion, index) => {
      const where = `rubric[${index}]`;

      if (!criterion || typeof criterion !== "object") {
        errors.push(`${where} must be an object`);
        return;
      }

      if (typeof criterion.id !== "string" || !CRITERION_ID.test(criterion.id)) {
        errors.push(`${where}.id must be a short lower-case id such as "full" or "partial"`);
      } else if (ids.has(criterion.id)) {
        errors.push(`${where}.id "${criterion.id}" is duplicated`);
      }
      ids.add(criterion.id);

      if (typeof criterion.description !== "string" || !criterion.description.trim()) {
        errors.push(`${where} needs a description`);
      }

      if (!Number.isInteger(criterion.points) || criterion.points < 0 || criterion.points > question.points) {
        errors.push(`${where}.points must be an integer from 0 to the question's points`);
      }
    });

    if (!rubric.some(criterion => criterion && criterion.points === question.points)) {
      errors.push("open-response-ai rubric needs a criterion worth the question's full points");
    }

    if (!rubric.some(criterion => criterion && criterion.points === 0)) {
      errors.push("open-response-ai rubric needs a criterion worth 0 points");
    }

    if (question.responseMaxChars !== undefined &&
        (!Number.isInteger(question.responseMaxChars) || question.responseMaxChars < 20 || question.responseMaxChars > RESPONSE_MAX_CHARS)) {
      errors.push(`open-response-ai responseMaxChars must be an integer from 20 to ${RESPONSE_MAX_CHARS}`);
    }

    return errors;
  },

  normalizeResponse(raw, question) {
    if (typeof raw !== "string") {
      return null;
    }

    const limit = question.responseMaxChars || RESPONSE_MAX_CHARS;
    const text = raw.normalize("NFC").replace(/\r\n?/g, "\n").trim().slice(0, limit);

    return text ? text : null;
  },

  recordResponse(_question, response) {
    return response === null ? null : { text: response };
  },

  score(question, response) {
    const max = question.points;

    if (response === null) {
      return { status: "scored", earned: 0, max, correct: false, detail: null };
    }

    return { status: "pending", earned: 0, max, correct: null, detail: { ai: "pending" } };
  }
};
