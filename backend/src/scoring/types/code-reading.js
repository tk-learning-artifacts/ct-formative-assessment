// Code reading: the student reads a snippet and works out what it does, for
// any input, rather than tracing one run (that is code-trace).
// Content shape:
//   code: { language, source }   required; shown with line numbers.
//   options: [text]              plain-English descriptions of what the code
//                                does; exactly one is right.
//   answer: { index, followUp? } index: the right description. followUp:
//                                the right follow-up option (kind "choice")
//                                or line number (kind "line"); for "line" it
//                                may be a list of lines, any of which earns
//                                the mark.
//   followUp                     optional second part, public:
//     { kind: "choice", prompt, options: [text], points }
//        for example "Which input would change the result?"
//     { kind: "line", prompt, points }
//        "Which line would you change so that it ...?"; the student picks
//        one of the code's non-blank lines.
//   glossary: [{ term, note }]   optional, public: notes on words in the
//                                code, shown when the student taps or
//                                hovers the word.
//
// Scoring: the description is worth points minus followUp.points, the
// follow-up its own points, each all or nothing, so a student who reads the
// purpose right but misses the follow-up keeps the description marks.
// detail.partial lists each part's result, which the breakdown shows after
// release like any other partial credit.
//
// Response: { choice, followUp } while answering, either part may be missing;
// stored as { choice: { index, text }, followUp: { index, text } or
// { line, text } } so the record says what the student saw.
//
// Written explanations are not part of this type. An "explain it in your own
// words" task is an open-response-ai question with a code block, so the AI
// pipeline keeps one status per answer (see ADR 0005).

const FOLLOW_UP_KINDS = ["choice", "line"];
const MAX_GLOSSARY_TERMS = 8;
const MAX_NOTE_CHARS = 200;
const MAX_TERM_CHARS = 30;

function codeLines(question) {
  return String(question.code && question.code.source || "").split("\n");
}

// Line numbers (from 1) the student may pick for a "line" follow-up.
function pickableLines(question) {
  return codeLines(question)
    .map((text, i) => ({ line: i + 1, text }))
    .filter(entry => entry.text.trim());
}

function followUpKeys(question) {
  const key = question.answer && question.answer.followUp;
  return Array.isArray(key) ? key : [key];
}

function describePoints(question) {
  return question.points - (question.followUp ? question.followUp.points : 0);
}

function validateOptions(options, where, errors) {
  if (!Array.isArray(options) || options.length < 2) {
    errors.push(`${where} needs at least 2 options`);
  } else if (options.some(option => typeof option !== "string" || !option.trim())) {
    errors.push(`every ${where} option must be a non-empty string`);
  } else if (new Set(options.map(option => option.trim())).size !== options.length) {
    errors.push(`${where} options must be distinct`);
  }
}

function validateFollowUp(question, errors) {
  const followUp = question.followUp;
  const answer = question.answer || {};

  if (followUp === undefined) {
    if (answer.followUp !== undefined) {
      errors.push("code-reading answer.followUp needs a followUp part");
    }
    return;
  }

  if (!followUp || typeof followUp !== "object") {
    errors.push("code-reading followUp must be an object");
    return;
  }

  const allowed = ["kind", "prompt", "options", "points"];
  Object.keys(followUp).filter(key => !allowed.includes(key)).forEach(key => {
    errors.push(`code-reading followUp.${key} is not a known field (the key goes in answer.followUp)`);
  });

  if (!FOLLOW_UP_KINDS.includes(followUp.kind)) {
    errors.push(`code-reading followUp.kind must be one of ${FOLLOW_UP_KINDS.join(", ")}`);
    return;
  }

  if (typeof followUp.prompt !== "string" || !followUp.prompt.trim()) {
    errors.push("code-reading followUp needs a prompt");
  }

  if (!Number.isInteger(followUp.points) || followUp.points < 1 || followUp.points >= question.points) {
    errors.push("code-reading followUp.points must be at least 1 and leave at least 1 point for the description");
  }

  const keys = followUpKeys(question);

  if (followUp.kind === "choice") {
    validateOptions(followUp.options, "code-reading followUp", errors);

    if (!Number.isInteger(answer.followUp) || !Array.isArray(followUp.options) || answer.followUp < 0 || answer.followUp >= followUp.options.length) {
      errors.push("code-reading answer.followUp must point at one of the followUp options");
    }
    return;
  }

  if (followUp.options !== undefined) {
    errors.push("code-reading followUp of kind \"line\" takes its options from the code's lines");
  }

  const lines = new Set(pickableLines(question).map(entry => entry.line));

  if (!keys.length || keys.some(line => !Number.isInteger(line) || !lines.has(line)) || new Set(keys).size !== keys.length) {
    errors.push("code-reading answer.followUp must be a non-blank line number of the code, or a list of them");
  }
}

function validateGlossary(question, errors) {
  const glossary = question.glossary;

  if (glossary === undefined) {
    return;
  }

  if (!Array.isArray(glossary) || !glossary.length || glossary.length > MAX_GLOSSARY_TERMS) {
    errors.push(`code-reading glossary must list 1 to ${MAX_GLOSSARY_TERMS} terms`);
    return;
  }

  const source = String(question.code && question.code.source || "");
  const seen = new Set();

  glossary.forEach((entry, i) => {
    const where = `code-reading glossary[${i}]`;

    if (!entry || typeof entry.term !== "string" || !entry.term.trim() || entry.term.length > MAX_TERM_CHARS || entry.term !== entry.term.trim()) {
      errors.push(`${where}.term must be a word or symbol of 1 to ${MAX_TERM_CHARS} characters, without spaces at either end`);
      return;
    }

    if (seen.has(entry.term)) {
      errors.push(`${where}.term "${entry.term}" is listed twice`);
    }
    seen.add(entry.term);

    if (!source.includes(entry.term)) {
      errors.push(`${where}.term "${entry.term}" does not appear in the code`);
    }

    if (typeof entry.note !== "string" || !entry.note.trim() || entry.note.length > MAX_NOTE_CHARS || /[\r\n]/.test(entry.note)) {
      errors.push(`${where}.note must be one line of 1 to ${MAX_NOTE_CHARS} characters`);
    }

    Object.keys(entry).filter(key => key !== "term" && key !== "note").forEach(key => {
      errors.push(`${where}.${key} is not a known field`);
    });
  });
}

function toIndex(raw, length) {
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  return Number.isInteger(value) && value >= 0 && value < length ? value : null;
}

function recordFollowUp(question, value) {
  if (value === null || value === undefined || !question.followUp) {
    return null;
  }

  if (question.followUp.kind === "choice") {
    return { index: value, text: question.followUp.options[value] };
  }

  return { line: value, text: codeLines(question)[value - 1] };
}

function recordChoice(question, value) {
  return value === null || value === undefined ? null : { index: value, text: question.options[value] };
}

module.exports = {
  type: "code-reading",
  status: "active",
  label: "Code reading",

  // Fields a student sees on top of the shared base projection in ../index.js
  // (which already carries `code`). followUp comes from projectPublic below,
  // rebuilt from its allowlisted fields.
  publicFields: ["options", "followUp", "glossary"],

  // A valid example, used by tests that run against every registered type.
  sample: {
    id: "SAMPLE-CR",
    type: "code-reading",
    audience: "rgsynapse",
    level: "S1",
    title: "Sample",
    prompt: "What does this function do?",
    code: { language: "python", source: "def f(xs):\n    total = 0\n    for x in xs:\n        total += x\n    return total" },
    options: ["Adds up the numbers", "Counts the numbers", "Finds the largest number"],
    answer: { index: 0, followUp: 4 },
    followUp: { kind: "line", prompt: "Which line adds each number to the running total?", points: 1 },
    glossary: [{ term: "+=", note: "Adds the right side to the variable on the left." }],
    points: 3,
    difficulty: 2,
    ontology: ["practice.testing-debugging.tracing"],
    outcomes: ["LO-READ-RGS-1"]
  },

  validate(question) {
    const errors = [];

    if (!question.code || typeof question.code.source !== "string" || !question.code.source.trim() ||
        typeof question.code.language !== "string" || !question.code.language.trim()) {
      errors.push("code-reading needs code: { language, source }");
      return errors;
    }

    validateOptions(question.options, "code-reading", errors);

    const index = question.answer && question.answer.index;

    if (!Number.isInteger(index) || !Array.isArray(question.options) || index < 0 || index >= question.options.length) {
      errors.push("code-reading answer.index must point at one of the options");
    }

    validateFollowUp(question, errors);
    validateGlossary(question, errors);

    return errors;
  },

  // followUp is rebuilt from its public fields, so a field added to it by
  // mistake (a key, a note) never reaches the student.
  projectPublic(question) {
    if (!question.followUp) {
      return question;
    }

    const { kind, prompt, points } = question.followUp;
    const followUp = { kind, prompt, points };

    if (kind === "choice") {
      followUp.options = question.followUp.options.slice();
    }

    return { ...question, followUp };
  },

  // raw: { choice, followUp }, either part optional. Returns the same shape
  // with nulls for missing or invalid parts, or null if neither is usable.
  normalizeResponse(raw, question) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const choice = toIndex(raw.choice, question.options.length);
    let followUp = null;

    if (question.followUp && question.followUp.kind === "choice") {
      followUp = toIndex(raw.followUp, question.followUp.options.length);
    } else if (question.followUp && question.followUp.kind === "line") {
      const line = toIndex(raw.followUp, Infinity);
      followUp = pickableLines(question).some(entry => entry.line === line) ? line : null;
    }

    return choice === null && followUp === null ? null : { choice, followUp };
  },

  recordResponse(question, response) {
    if (response === null) {
      return null;
    }

    const recorded = { choice: recordChoice(question, response.choice) };

    if (question.followUp) {
      recorded.followUp = recordFollowUp(question, response.followUp);
    }

    return recorded;
  },

  // What the breakdown shows as the correct answer once results are released.
  // A "line" follow-up with several accepted lines shows the first.
  keyResponse(question) {
    const key = { choice: recordChoice(question, question.answer.index) };

    if (question.followUp) {
      key.followUp = recordFollowUp(question, followUpKeys(question)[0]);
    }

    return key;
  },

  score(question, response) {
    const max = question.points;

    if (response === null) {
      return { status: "scored", earned: 0, max, correct: false, detail: null };
    }

    const describeMax = describePoints(question);
    const describeRight = response.choice === question.answer.index;
    const parts = [{ part: "describe", earned: describeRight ? describeMax : 0, max: describeMax }];

    if (question.followUp) {
      const followUpRight = response.followUp !== null && followUpKeys(question).includes(response.followUp);
      parts.push({ part: "followUp", earned: followUpRight ? question.followUp.points : 0, max: question.followUp.points });
    }

    const earned = parts.reduce((sum, part) => sum + part.earned, 0);
    const correct = earned === max;

    // The parts are spelled out whenever there are two and one was missed.
    const detail = parts.length > 1 && !correct ? { partial: { parts } } : null;

    return { status: "scored", earned, max, correct, detail };
  },

  pickableLines
};
