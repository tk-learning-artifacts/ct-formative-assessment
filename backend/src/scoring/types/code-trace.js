// Code trace: the student reads the program in `code` and types its exact
// output.
// Answer key shape: { "output": "...", "accepted": ["...", ...] }. `accepted`
// is optional and lists other forms that count as the same output (for
// example a list printed with double quotes instead of single ones).
// Marking flags, all optional, in `marking`:
//   collapseSpaces  runs of spaces and tabs inside a line count as one space
//   partial         "lines" gives credit per matching output line; the
//                   default is all or nothing
// Response: the text the student typed. Stored as { text } exactly as typed
// (line endings unified), so the record shows what they wrote.

const MAX_RESPONSE_LENGTH = 4000;

// Line endings unified, trailing whitespace dropped on every line and at the
// end. Leading spaces and blank lines at the start are kept, because they
// are part of the output.
function normalizeOutput(text, { collapseSpaces = false } = {}) {
  let lines = String(text).replace(/\r\n?/g, "\n").split("\n").map(line => line.replace(/\s+$/, ""));

  if (collapseSpaces) {
    lines = lines.map(line => line.replace(/[ \t]+/g, " "));
  }

  while (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function keyForms(question) {
  return [question.answer.output].concat(question.answer.accepted || []);
}

// Blank lines at the start and end removed. Only partial credit uses this:
// one stray blank line typed above the output would otherwise shift every
// line down by one and match none of them. The key is trimmed the same way,
// so a key that starts with a blank line still lines up.
function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start] === "") start += 1;
  while (end > start && lines[end - 1] === "") end -= 1;

  return lines.slice(start, end);
}

// Matching lines, position by position, against one accepted form, with
// blank lines at either end ignored. Extra or missing lines count against
// the student through the larger denominator.
function lineMatch(expectedLines, givenLines) {
  const expected = trimBlankLines(expectedLines);
  const given = trimBlankLines(givenLines);
  let matched = 0;

  expected.forEach((line, i) => {
    if (given[i] === line) matched += 1;
  });

  return { matched, of: Math.max(expected.length, given.length) };
}

module.exports = {
  type: "code-trace",
  status: "active",
  label: "Code trace",

  // The program itself is the shared `code` field. Nothing else is public.
  publicFields: [],

  sample: {
    id: "SAMPLE-CODE-TRACE",
    type: "code-trace",
    audience: "core",
    level: "S1",
    title: "Sample",
    prompt: "What does this print?",
    code: { language: "python", source: "for i in range(2):\n    print(i)" },
    answer: { output: "0\n1" },
    marking: { partial: "lines" },
    points: 2,
    difficulty: 1,
    ontology: ["concept.loops"],
    outcomes: ["LO-TRACE-1"]
  },

  validate(question) {
    const errors = [];
    const answer = question.answer;

    if (!question.code || typeof question.code.source !== "string" || !question.code.source.trim()) {
      errors.push("code-trace needs a code block with the program to trace");
    }

    if (!answer || typeof answer.output !== "string" || !normalizeOutput(answer.output).length) {
      errors.push("code-trace answer.output must be a non-empty string");
    }

    if (answer && answer.accepted !== undefined) {
      if (!Array.isArray(answer.accepted) || answer.accepted.some(form => typeof form !== "string" || !form.trim())) {
        errors.push("code-trace answer.accepted must be a list of non-empty strings");
      }
    }

    const marking = question.marking;

    if (marking !== undefined) {
      if (!marking || typeof marking !== "object" || Array.isArray(marking)) {
        errors.push("code-trace marking must be an object");
      } else {
        Object.keys(marking).forEach(key => {
          if (!["collapseSpaces", "partial"].includes(key)) errors.push(`code-trace marking has unknown key "${key}"`);
        });

        if (marking.collapseSpaces !== undefined && typeof marking.collapseSpaces !== "boolean") {
          errors.push("code-trace marking.collapseSpaces must be true or false");
        }

        if (marking.partial !== undefined && marking.partial !== "lines") {
          errors.push("code-trace marking.partial must be \"lines\" when set");
        }
      }
    }

    return errors;
  },

  normalizeResponse(raw) {
    if (typeof raw !== "string" || !raw.trim()) {
      return null;
    }

    return raw.replace(/\r\n?/g, "\n").slice(0, MAX_RESPONSE_LENGTH);
  },

  recordResponse(question, response) {
    return response === null ? null : { text: response };
  },

  // What the breakdown shows as the correct answer once results are released.
  keyResponse(question) {
    return { text: question.answer.output };
  },

  score(question, response) {
    const max = question.points;
    const marking = question.marking || {};

    if (response === null) {
      return { status: "scored", earned: 0, max, correct: false, detail: null };
    }

    const given = normalizeOutput(response, marking);
    const forms = keyForms(question).map(form => normalizeOutput(form, marking));
    const correct = forms.some(form => form.length === given.length && form.every((line, i) => line === given[i]));

    if (correct || marking.partial !== "lines") {
      return { status: "scored", earned: correct ? max : 0, max, correct, detail: null };
    }

    // Best line match over every accepted form. A wrong answer never earns
    // full marks, even if rounding would allow it, so an answer that differs
    // from the key only by a blank line at the start earns max - 1.
    const best = forms
      .map(form => lineMatch(form, given))
      .reduce((a, b) => (b.matched / b.of > a.matched / a.of ? b : a));
    const earned = Math.min(max - 1, Math.floor((max * best.matched) / best.of));

    return { status: "scored", earned: Math.max(0, earned), max, correct: false, detail: { partial: { matchedLines: best.matched, ofLines: best.of } } };
  },

  normalizeOutput
};
