// Scorer registry. Every file in ./types is one question type, loaded here in
// name order; adding a type means adding a file, not editing this one.
//
// An active type module exports:
//   type, status: "active", label
//   publicFields                     fields a student sees beyond BASE_PUBLIC_FIELDS
//   sample                           a valid example question (used by tests)
//   validate(question)             -> array of error strings (empty when valid)
//   normalizeResponse(raw, q)      -> the value to score, or null if unusable
//   recordResponse(q, response)    -> the JSON stored in answers.response_json;
//                                     it should say what the student saw
//   score(question, response)      -> { status, earned, max, correct, detail }
//   legacyColumns(question, resp)  -> optional { chosenIndex, correctIndex }
//
// A reserved type module exports only type, status: "reserved", label and
// description. Content using a reserved type is rejected at boot.
//
// status is "scored" for types marked synchronously. An AI-scored type
// returns { status: "pending", earned: 0, max } and a background job
// (src/ai scoreWithAi) later sets "scored" or "needs-review" and fills
// answers.detail_json, so the submit route never waits on a model.

const fs = require("fs");
const path = require("path");

const TYPES_DIR = path.join(__dirname, "types");

// Shown to students for every type. Answer keys, rubrics, solutions and the
// teacher-only "details" note are never in this list.
const BASE_PUBLIC_FIELDS = ["id", "type", "audience", "level", "title", "prompt", "art", "code", "points", "topic", "qType"];

const ACTIVE_KEYS = ["type", "label", "publicFields", "sample", "validate", "normalizeResponse", "recordResponse", "score"];

const registry = new Map();

function registerType(impl) {
  if (!impl || !impl.type) {
    throw new Error("Question type implementation is missing \"type\"");
  }

  if (impl.status === "reserved") {
    if (registry.has(impl.type)) {
      throw new Error(`Question type "${impl.type}" is already registered`);
    }
    registry.set(impl.type, { ...impl });
    return;
  }

  ACTIVE_KEYS.forEach(key => {
    if (impl[key] === undefined) {
      throw new Error(`Question type "${impl.type}" is missing "${key}"`);
    }
  });

  if (registry.has(impl.type) && registry.get(impl.type).status === "active") {
    throw new Error(`Question type "${impl.type}" is already registered`);
  }

  registry.set(impl.type, { ...impl, status: "active" });
}

fs.readdirSync(TYPES_DIR)
  .filter(name => name.endsWith(".js"))
  .sort()
  .forEach(name => registerType(require(path.join(TYPES_DIR, name))));

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
  const impl = getActiveType(question.type);
  const safe = {};

  BASE_PUBLIC_FIELDS.concat(impl.publicFields).forEach(field => {
    if (question[field] !== undefined) {
      safe[field] = question[field];
    }
  });

  return safe;
}

function scoreResponse(question, rawResponse) {
  const impl = getActiveType(question.type);
  const response = rawResponse === undefined ? null : impl.normalizeResponse(rawResponse, question);
  const result = impl.score(question, response);
  const legacy = impl.legacyColumns ? impl.legacyColumns(question, response) : { chosenIndex: null, correctIndex: null };

  return { response, recorded: impl.recordResponse(question, response), result, legacy };
}

module.exports = {
  BASE_PUBLIC_FIELDS,
  registerType,
  getType,
  getActiveType,
  listTypes,
  toPublicQuestion,
  scoreResponse
};
