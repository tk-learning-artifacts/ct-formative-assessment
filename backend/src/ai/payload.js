// Builds the only payload that may be sent to an AI provider.
//
// The caller supplies ids and the student's response text, never question
// content: the builder looks the question up itself, in the event snapshot
// (or the content bank when there is no event yet), and the learning-outcome
// statements in the validated content. So no caller-built prompt, outcome
// text or extra field can smuggle anything into the request.
//
// The output shape is fixed: question content, rubric, level/LO metadata and
// the scrubbed response text. It has no field for a student's name, class
// group, attempt id, token or any other identifier.
//
// The response text is free text a student typed, so it can contain personal
// data ("I'm Ada from S1-2, call 9123 4567"). scrubResponseText is the hook for
// that known risk. The student's own name and class group are required
// redaction inputs; they are used here to scrub and are never sent.

const MAX_RESPONSE_CHARS = 4000;
const REDACTED = "[redacted]";
const BUILDER_ARGS = ["store", "eventId", "questionId", "responseText", "studentName", "studentGroup"];

// Scripts written without spaces between words. Names in them are matched as
// plain substrings, because a letter-boundary rule would never match inside
// running text.
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

// Every payload this builder returns is deep-frozen and remembered here; the
// guarded provider in ./index.js refuses anything else.
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

function identifierPattern(term) {
  const escaped = escapeRegExp(term);

  if (UNSPACED_SCRIPT.test(term)) {
    return new RegExp(escaped, "giu");
  }

  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${escaped}(?![\\p{L}\\p{N}\\p{M}])`, "giu");
}

// The whole string plus each part with at least two letters, longest first.
function identifierTerms(values) {
  const terms = new Set();

  values.forEach(value => {
    const whole = String(value || "").normalize("NFKC").trim().replace(/\s+/gu, " ");

    if (!whole) {
      return;
    }

    terms.add(whole);
    whole.split(/[\s\-‐‑'’.,_/]+/u).forEach(part => {
      if ((part.match(/\p{L}/gu) || []).length >= 2) {
        terms.add(part);
      }
    });
  });

  return Array.from(terms).sort((a, b) => b.length - a.length);
}

function scrubResponseText(text, redact) {
  if (!Array.isArray(redact)) {
    throw new Error("scrubResponseText needs the list of the student's identifiers to redact.");
  }

  let out = String(text || "").normalize("NFKC").slice(0, MAX_RESPONSE_CHARS);

  out = out
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+/gu, REDACTED)
    .replace(/(?<![\p{L}\p{N}])[STFGM]\d{7}[A-Z](?![\p{L}\p{N}])/giu, REDACTED)
    .replace(/(?<![\d+])\+\d{1,3}[\s-]?\d(?:[\s-]?\d){6,13}(?!\d)/g, REDACTED)
    .replace(/(?<![\d+])(?:65[\s-]?)?[3689]\d{3}[\s-]?\d{4}(?!\d)/g, REDACTED);

  identifierTerms(redact).forEach(term => {
    out = out.replace(identifierPattern(term), REDACTED);
  });

  return out;
}

function requireText(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`buildScoringPayload needs ${name} (used only for redaction, never sent).`);
  }
}

function lookUpQuestion(store, eventId, questionId) {
  const questions = eventId === undefined || eventId === null
    ? store.content.questions
    : store.getEventQuestions(eventId);
  const question = questions.find(item => item.id === questionId);

  if (!question) {
    throw new Error(`No question "${questionId}"${eventId ? ` in event ${eventId}` : ""}.`);
  }

  return question;
}

function buildScoringPayload(args) {
  const extra = Object.keys(args || {}).filter(key => !BUILDER_ARGS.includes(key));

  if (extra.length) {
    throw new Error(`buildScoringPayload does not accept: ${extra.join(", ")}`);
  }

  const { store, eventId = null, questionId, responseText, studentName, studentGroup } = args;

  if (!store || !store.content) {
    throw new Error("buildScoringPayload needs the store to look the question up.");
  }

  requireText(studentName, "studentName");
  requireText(studentGroup, "studentGroup");

  const question = lookUpQuestion(store, eventId, questionId);

  if (!Array.isArray(question.rubric) || !question.rubric.length) {
    throw new Error("AI scoring needs a question with a rubric.");
  }

  const statements = new Map(store.content.outcomes.map(outcome => [outcome.id, outcome.statement]));

  const payload = {
    task: "score-open-response",
    question: {
      prompt: String(question.prompt),
      level: String(question.level),
      audience: String(question.audience),
      maxPoints: Number(question.points),
      outcomes: (question.outcomes || []).map(id => ({ id: String(id), statement: statements.get(id) || null })),
      rubric: question.rubric.map(criterion => ({
        id: String(criterion.id),
        description: String(criterion.description),
        points: Number(criterion.points)
      }))
    },
    response: {
      text: scrubResponseText(responseText, [studentName, studentGroup])
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
