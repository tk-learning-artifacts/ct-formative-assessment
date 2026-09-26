// Multiple choice: one correct option, identified by its index.
// Answer key shape: { "index": <integer> }. Response shape: an integer index.

// Fields a student is allowed to see. Anything not listed here (answer,
// future rubric or solution fields) never leaves the server.
const PUBLIC_FIELDS = [
  "id", "type", "audience", "level", "title", "prompt", "art", "code",
  "options", "points", "topic", "qType", "details"
];

function validate(question) {
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
}

function toPublic(question) {
  const safe = {};

  PUBLIC_FIELDS.forEach(field => {
    if (question[field] !== undefined) {
      safe[field] = question[field];
    }
  });

  return safe;
}

function normalizeResponse(raw, question) {
  const index = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;

  if (!Number.isInteger(index) || index < 0 || index >= question.options.length) {
    return null;
  }

  return index;
}

function score(question, response) {
  const max = question.points;
  const correct = response !== null && response === question.answer.index;

  return {
    status: "scored",
    earned: correct ? max : 0,
    max,
    correct
  };
}

// For the legacy answers columns, which predate per-type responses.
function legacyColumns(question, response) {
  return {
    chosenIndex: response,
    correctIndex: question.answer.index
  };
}

module.exports = {
  type: "mcq",
  status: "active",
  label: "Multiple choice",
  validate,
  toPublic,
  normalizeResponse,
  score,
  legacyColumns
};
