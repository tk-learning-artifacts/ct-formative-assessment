// Parsons problem: the student puts shuffled lines of code in order to build
// a working program, leaving out any distractor lines.
// Content shape:
//   lines: [{ id, text }]   every line, distractors included. Indentation is
//                           part of each line's text (Python needs it), so
//                           the student orders lines but never indents them.
//   answer: { order: [ids], alternatives: [[ids], ...] }
//                           the correct order, plus optional other orders
//                           that are just as correct (independent lines
//                           swapped). Lines in no order are distractors.
//   language                public: the language of the lines ("python",
//                           "swift"), shown as a label.
//   expectedOutput          optional, public: what the finished program
//                           prints, shown to the student as the target.
//   code                    optional, as for every type; for example the
//                           Python program a Swift Parsons translates.
//   marking: { partial: "longest-run" }
//                           optional; the default is all or nothing.
//
// The student never sees the content ids or the content order. The public
// projection replaces `lines` with the same lines under opaque ids (a hash of
// the question id and line id), in a shuffle seeded by the question id that
// is never a correct order and never the content order. The response is the
// list of opaque ids in the student's order; it is stored as the content ids
// with their text.

const crypto = require("crypto");

const MAX_SHUFFLE_TRIES = 200;

function publicLineId(questionId, lineId) {
  return "L" + crypto.createHash("sha256").update(`${questionId}\u0000${lineId}`).digest("hex").slice(0, 10);
}

// A small seeded generator (mulberry32), so the shuffle is the same on every
// request and every server without being stored.
function seededRandom(seedText) {
  let seed = crypto.createHash("sha256").update(seedText).digest().readUInt32LE(0);

  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function acceptedOrders(question) {
  return [question.answer.order].concat(question.answer.alternatives || []);
}

function textOf(question) {
  return new Map(question.lines.map(line => [line.id, line.text]));
}

function sameSequence(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

// A shown order leaks the answer if its solution lines, read top to bottom
// with the distractors skipped, already form a correct program, or if it is
// the order the author wrote the lines in. Comparing text rather than ids
// also catches two identical lines swapped.
function leaksAnswer(question, ids) {
  const text = textOf(question);
  const solution = new Set(question.answer.order);
  const shownText = ids.filter(id => solution.has(id)).map(id => text.get(id));
  const contentIds = question.lines.map(line => line.id);

  return sameSequence(ids, contentIds) ||
    acceptedOrders(question).some(order => sameSequence(order.map(id => text.get(id)), shownText));
}

// The content ids in the order the student is shown, or null if no safe
// order turns up (validate reports that as an error).
function shuffledIds(question) {
  const random = seededRandom(`parsons:${question.id}`);

  for (let tries = 0; tries < MAX_SHUFFLE_TRIES; tries += 1) {
    const ids = question.lines.map(line => line.id);

    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }

    if (!leaksAnswer(question, ids)) {
      return ids;
    }
  }

  return null;
}

// The longest stretch of the student's program that appears, line for line
// and in the same order, somewhere in one correct order.
function longestRun(given, orders) {
  let best = 0;

  orders.forEach(order => {
    for (let start = 0; start < given.length; start += 1) {
      for (let at = 0; at < order.length; at += 1) {
        let length = 0;
        while (start + length < given.length && at + length < order.length && given[start + length] === order[at + length]) {
          length += 1;
        }
        best = Math.max(best, length);
      }
    }
  });

  return best;
}

module.exports = {
  type: "parsons",
  status: "active",
  label: "Parsons problem",

  // `lines` comes from projectPublic below, never straight from content.
  publicFields: ["language", "lines", "expectedOutput"],

  sample: {
    id: "SAMPLE-PARSONS",
    type: "parsons",
    audience: "core",
    level: "S1",
    title: "Sample",
    prompt: "Put the lines in order so the program prints 1, then 2, then 3.",
    language: "python",
    lines: [
      { id: "a", text: "print(1)" },
      { id: "b", text: "print(2)" },
      { id: "c", text: "print(3)" },
      { id: "x", text: "print(4)" }
    ],
    answer: { order: ["a", "b", "c"] },
    expectedOutput: "1\n2\n3",
    points: 3,
    difficulty: 1,
    ontology: ["concept.sequences"],
    outcomes: ["LO-TRACE-1"]
  },

  validate(question) {
    const errors = [];
    const lines = question.lines;

    if (!Array.isArray(lines) || lines.length < 3) {
      errors.push("parsons needs a lines array with at least 3 entries");
      return errors;
    }

    if (lines.some(line => !line || typeof line.id !== "string" || !line.id || typeof line.text !== "string" || !line.text.trim())) {
      errors.push("every parsons line needs a string id and non-empty text");
      return errors;
    }

    const ids = new Set(lines.map(line => line.id));

    if (ids.size !== lines.length) {
      errors.push("parsons line ids must be distinct");
    }

    const answer = question.answer;

    if (!answer || !Array.isArray(answer.order) || answer.order.length < 2) {
      errors.push("parsons answer.order must list at least 2 line ids");
      return errors;
    }

    if (answer.alternatives !== undefined && !Array.isArray(answer.alternatives)) {
      errors.push("parsons answer.alternatives must be a list of orders");
      return errors;
    }

    const solution = new Set(answer.order);

    acceptedOrders(question).forEach((order, n) => {
      const name = n === 0 ? "answer.order" : `answer.alternatives[${n - 1}]`;

      if (!Array.isArray(order) || order.some(id => !ids.has(id))) {
        errors.push(`parsons ${name} must list known line ids`);
      } else if (new Set(order).size !== order.length) {
        errors.push(`parsons ${name} uses a line twice`);
      } else if (n > 0 && (order.length !== solution.size || order.some(id => !solution.has(id)))) {
        errors.push(`parsons ${name} must use exactly the lines in answer.order`);
      }
    });

    // A distractor that reads exactly like a solution line could be used in
    // its place, and the scorer (which compares text) would mark it right.
    const text = textOf(question);
    const solutionText = new Set(answer.order.map(id => text.get(id)));
    lines.filter(line => !solution.has(line.id) && solutionText.has(line.text)).forEach(line => {
      errors.push(`parsons distractor "${line.id}" has the same text as a solution line`);
    });

    if (typeof question.language !== "string" || !question.language.trim()) {
      errors.push("parsons needs a language for its lines, such as \"python\"");
    }

    if (question.expectedOutput !== undefined && typeof question.expectedOutput !== "string") {
      errors.push("parsons expectedOutput must be a string");
    }

    const marking = question.marking;

    if (marking !== undefined && (!marking || typeof marking !== "object" || Object.keys(marking).some(key => key !== "partial") || marking.partial !== "longest-run")) {
      errors.push("parsons marking may only be { \"partial\": \"longest-run\" }");
    }

    if (!errors.length && shuffledIds(question) === null) {
      errors.push("parsons has no shuffled order that hides the answer; add a line or a distractor");
    }

    return errors;
  },

  // Replaces the content lines with opaque ids in the shuffled order. The
  // registry copies only publicFields from what this returns.
  projectPublic(question) {
    const text = textOf(question);
    const ids = shuffledIds(question) || [];

    return {
      ...question,
      lines: ids.map(id => ({ id: publicLineId(question.id, id), text: text.get(id) }))
    };
  },

  // raw: the opaque ids in the student's order. Returns the content ids, or
  // null if the list is empty, repeats a line or names an unknown one.
  normalizeResponse(raw, question) {
    if (!Array.isArray(raw) || !raw.length || raw.length > question.lines.length) {
      return null;
    }

    const byPublicId = new Map(question.lines.map(line => [publicLineId(question.id, line.id), line.id]));
    const ids = raw.map(id => (typeof id === "string" ? byPublicId.get(id) : undefined));

    if (ids.some(id => id === undefined) || new Set(ids).size !== ids.length) {
      return null;
    }

    return ids;
  },

  recordResponse(question, response) {
    if (response === null) {
      return null;
    }

    const text = textOf(question);
    return { lines: response.map(id => ({ id, text: text.get(id) })) };
  },

  // What the breakdown shows as the correct answer once results are released.
  keyResponse(question) {
    const text = textOf(question);
    return { lines: question.answer.order.map(id => ({ id, text: text.get(id) })) };
  },

  score(question, response) {
    const max = question.points;

    if (response === null) {
      return { status: "scored", earned: 0, max, correct: false, detail: null };
    }

    const text = textOf(question);
    const given = response.map(id => text.get(id));
    const orders = acceptedOrders(question).map(order => order.map(id => text.get(id)));
    const correct = orders.some(order => sameSequence(order, given));

    if (correct || !question.marking || question.marking.partial !== "longest-run") {
      return { status: "scored", earned: correct ? max : 0, max, correct, detail: null };
    }

    // Credit for the longest correct stretch, out of the longer of the
    // student's program and the solution, so extra lines cost marks too.
    const run = longestRun(given, orders);
    const of = Math.max(given.length, orders[0].length);
    const earned = Math.min(max - 1, Math.floor((max * run) / of));

    return { status: "scored", earned: Math.max(0, earned), max, correct: false, detail: { partial: { longestRun: run, ofLines: of } } };
  },

  publicLineId,
  shuffledIds,
  leaksAnswer
};
