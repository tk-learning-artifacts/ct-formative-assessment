// Builds the only payload shape that may be sent to an AI provider.
//
// The shape is fixed and typed: question content, rubric, level/LO metadata
// and the student's response text. It has no field for a student's name,
// class group, attempt id, token or any other identifier, and the builder
// takes only a question and a response string, so there is nothing to leak
// by accident. Callers cannot add fields: unknown arguments throw.
//
// The response text itself is free text a student typed, so it can contain
// personal data ("I'm Ada from S1-2, my number is 9123 4567"). scrubResponseText
// is the hook for that known risk. It currently redacts emails, phone numbers,
// NRIC/FIN-shaped ids and any strings the caller passes in `redact` (such as
// the student's own name and class, used locally and never sent).

const MAX_RESPONSE_CHARS = 4000;
const REDACTED = "[redacted]";
const BUILDER_ARGS = ["question", "responseText", "redact", "outcomes"];

// Every payload this builder returns is deep-frozen and remembered here, so a
// provider can refuse anything that did not come from the builder, or that
// had fields added afterwards (see guardProvider in ./index.js).
const BUILT_PAYLOADS = new WeakSet();

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function isBuiltPayload(payload) {
  return Boolean(payload && typeof payload === "object" && BUILT_PAYLOADS.has(payload));
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scrubResponseText(text, redact = []) {
  let out = String(text || "").slice(0, MAX_RESPONSE_CHARS);

  out = out
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, REDACTED)
    .replace(/\b[STFGM]\d{7}[A-Z]\b/gi, REDACTED)
    .replace(/(\+?65[\s-]?)?\b[689]\d{3}[\s-]?\d{4}\b/g, REDACTED);

  redact
    .map(item => String(item || "").trim())
    .filter(item => item.length >= 2)
    .sort((a, b) => b.length - a.length)
    .forEach(item => {
      out = out.replace(new RegExp(escapeRegExp(item), "gi"), REDACTED);
      // Also catch each word of a multi-word name on its own.
      item.split(/\s+/).filter(word => word.length >= 3).forEach(word => {
        out = out.replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi"), REDACTED);
      });
    });

  return out;
}

function buildScoringPayload(args) {
  const extra = Object.keys(args || {}).filter(key => !BUILDER_ARGS.includes(key));

  if (extra.length) {
    throw new Error(`buildScoringPayload does not accept: ${extra.join(", ")}`);
  }

  const { question, responseText, redact = [], outcomes = [] } = args;

  if (!question || !Array.isArray(question.rubric) || !question.rubric.length) {
    throw new Error("AI scoring needs a question with a rubric.");
  }

  const outcomeStatements = new Map(outcomes.map(outcome => [outcome.id, outcome.statement]));

  const payload = {
    task: "score-open-response",
    question: {
      prompt: String(question.prompt),
      level: String(question.level),
      audience: String(question.audience),
      maxPoints: Number(question.points),
      outcomes: (question.outcomes || []).map(id => ({ id: String(id), statement: outcomeStatements.get(id) || null })),
      rubric: question.rubric.map(criterion => ({
        id: String(criterion.id),
        description: String(criterion.description),
        points: Number(criterion.points)
      }))
    },
    response: {
      text: scrubResponseText(responseText, redact)
    }
  };

  if (question.code) {
    payload.question.code = { language: String(question.code.language), source: String(question.code.source) };
  }

  deepFreeze(payload);
  BUILT_PAYLOADS.add(payload);
  return payload;
}

module.exports = {
  buildScoringPayload,
  isBuiltPayload,
  scrubResponseText,
  MAX_RESPONSE_CHARS
};
