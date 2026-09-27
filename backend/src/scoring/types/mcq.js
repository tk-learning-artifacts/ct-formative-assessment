// Multiple choice: one correct option, identified by its index.
// Answer key shape: { "index": <integer> }.
// Response: an integer index while scoring; stored as { index, text } so the
// record still says what the student saw if the question is edited later.

module.exports = {
  type: "mcq",
  status: "active",
  label: "Multiple choice",

  // Fields a student sees on top of the shared base projection in ../index.js.
  publicFields: ["options"],

  // A valid example, used by tests that run against every registered type.
  sample: {
    id: "SAMPLE-MCQ",
    type: "mcq",
    audience: "core",
    level: "P5",
    title: "Sample",
    prompt: "Pick b.",
    options: ["a", "b", "c"],
    answer: { index: 1 },
    points: 1,
    difficulty: 1,
    ontology: ["concept.sequences"],
    outcomes: ["LO-SEQ-1"]
  },

  validate(question) {
    const errors = [];

    if (!Array.isArray(question.options) || question.options.length < 2) {
      errors.push("mcq needs an options array with at least 2 entries");
    } else if (question.options.some(option => typeof option !== "string" || !option.trim())) {
      errors.push("every mcq option must be a non-empty string");
    } else if (new Set(question.options.map(option => option.trim())).size !== question.options.length) {
      errors.push("mcq options must be distinct");
    }

    const index = question.answer && question.answer.index;

    if (!Number.isInteger(index) || !Array.isArray(question.options) || index < 0 || index >= question.options.length) {
      errors.push("mcq answer.index must point at one of the options");
    }

    return errors;
  },

  normalizeResponse(raw, question) {
    const index = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;

    if (!Number.isInteger(index) || index < 0 || index >= question.options.length) {
      return null;
    }

    return index;
  },

  recordResponse(question, response) {
    return response === null ? null : { index: response, text: question.options[response] };
  },

  score(question, response) {
    const max = question.points;
    const correct = response !== null && response === question.answer.index;

    return {
      status: "scored",
      earned: correct ? max : 0,
      max,
      correct,
      detail: null
    };
  },

  // Fills the v1 answers columns, which predate per-type responses.
  legacyColumns(question, response) {
    return {
      chosenIndex: response,
      correctIndex: question.answer.index
    };
  }
};
