// Scorer registry. Each question type registers one implementation with:
//
//   validate(question)             -> array of error strings (empty when valid)
//   toPublic(question)             -> the copy a student may see (no answer key)
//   normalizeResponse(raw, q)      -> the stored response, or null if unusable
//   score(question, response)      -> { status, earned, max, correct }
//   legacyColumns(question, resp)  -> optional { chosenIndex, correctIndex }
//
// status is "scored" for types marked synchronously. A future AI-scored type
// returns { status: "pending", earned: 0, max } and is finalised later by a
// background job (src/ai scoreWithAi) to "scored", or to "needs-review" when
// AI is off or its output fails validation, so the submit route never waits
// on a model. The status is stored in answers.score_status.
//
// Reserved types are named here so content and teachers can refer to them,
// but the loader rejects questions of a reserved type until a scorer ships.

const mcq = require("./mcq");

const registry = new Map();

const RESERVED_TYPES = [
  {
    type: "multi-select",
    label: "Multiple select",
    description: "Pick every correct option; partial credit rules to be decided."
  },
  {
    type: "code-trace",
    label: "Code trace",
    description: "Student types the output of a program; compared after whitespace normalisation."
  },
  {
    type: "parsons",
    label: "Parsons problem",
    description: "Student drags shuffled code lines into the right order (and indentation)."
  },
  {
    type: "short-answer",
    label: "Short answer",
    description: "A typed word or number matched against a list of accepted answers."
  },
  {
    type: "open-response-ai",
    label: "Open response (AI scored)",
    description: "Free text scored against a rubric by the AI provider. Needs the AI extension point enabled."
  }
];

function registerType(impl) {
  ["type", "validate", "toPublic", "normalizeResponse", "score"].forEach(key => {
    if (!impl[key]) {
      throw new Error(`Question type implementation is missing "${key}"`);
    }
  });

  if (registry.has(impl.type) && registry.get(impl.type).status === "active") {
    throw new Error(`Question type "${impl.type}" is already registered`);
  }

  registry.set(impl.type, { status: "active", ...impl });
}

RESERVED_TYPES.forEach(entry => {
  registry.set(entry.type, { ...entry, status: "reserved" });
});

registerType(mcq);

function getType(type) {
  return registry.get(type) || null;
}

function getActiveType(type) {
  const impl = getType(type);

  if (!impl || impl.status !== "active") {
    throw new Error(`Question type "${type}" has no active scorer`);
  }

  return impl;
}

function listTypes() {
  return Array.from(registry.values()).map(impl => ({
    type: impl.type,
    label: impl.label || impl.type,
    status: impl.status,
    description: impl.description || null
  }));
}

function toPublicQuestion(question) {
  return getActiveType(question.type).toPublic(question);
}

function scoreResponse(question, rawResponse) {
  const impl = getActiveType(question.type);
  const response = rawResponse === undefined ? null : impl.normalizeResponse(rawResponse, question);
  const result = impl.score(question, response);
  const legacy = impl.legacyColumns ? impl.legacyColumns(question, response) : { chosenIndex: null, correctIndex: null };

  return { response, result, legacy };
}

module.exports = {
  registerType,
  getType,
  getActiveType,
  listTypes,
  toPublicQuestion,
  scoreResponse
};
