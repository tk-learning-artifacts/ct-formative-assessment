// Computed answer-key check. For every question, a solver works the answer out
// from the question's own text and the test asserts that exactly one option
// matches it and that this option is the stored key. Run against the original
// v1 questions it flags P6-01 (key said 7, the grid needs 6), S2-02 (the true
// cost, 4, was not an option), S1-01 ("3" and "B" were both right) and P5-01
// ("3, 1, 2" also always worked); the last test below keeps that true.

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { loadContent } = require("../src/content");
const { SOLVERS, NOT_COMPUTABLE } = require("./solvers");

const { questions } = loadContent();

function optionMatchesValue(option, value) {
  const text = option.trim().toLowerCase();

  if (text === String(value).trim().toLowerCase()) {
    return true;
  }

  const leadingNumber = text.match(/^-?\d+(\.\d+)?/);
  return typeof value === "number" && leadingNumber !== null && Number(leadingNumber[0]) === value && /^-?\d+(\.\d+)?(\s|$)/.test(text);
}

function matchingOptions(question, solved) {
  const predicate = solved && typeof solved === "object" && typeof solved.pick === "function"
    ? solved.pick
    : option => optionMatchesValue(option, solved);

  return question.options
    .map((option, index) => (predicate(option) ? index : -1))
    .filter(index => index >= 0);
}

test("every question has a solver or a documented reason why not", () => {
  const missing = questions
    .filter(question => !SOLVERS[question.id] && !NOT_COMPUTABLE[question.id])
    .map(question => question.id);

  assert.deepEqual(missing, [], `add a solver in backend/test/solvers/ for: ${missing.join(", ")}`);
});

test("no solver is left over for a question that no longer exists", () => {
  const ids = new Set(questions.map(question => question.id));
  const stale = Object.keys(SOLVERS).filter(id => !ids.has(id));
  assert.deepEqual(stale, []);
});

function keyProblem(question) {
  const solved = SOLVERS[question.id](question);
  const matches = matchingOptions(question, solved);
  const shown = solved && solved.pick ? "(predicate)" : JSON.stringify(solved);

  if (matches.length !== 1) {
    return `${question.id}: computed ${shown}; expected exactly one matching option, got ${matches.length} ` +
      `(${matches.map(index => JSON.stringify(question.options[index])).join(", ") || "none"})`;
  }

  if (question.answer.index !== matches[0]) {
    return `${question.id}: key is option ${question.answer.index} (${JSON.stringify(question.options[question.answer.index])}) ` +
      `but the computed answer is option ${matches[0]} (${JSON.stringify(question.options[matches[0]])})`;
  }

  return null;
}

questions.forEach(question => {
  if (NOT_COMPUTABLE[question.id]) {
    test(`${question.id} key is checked by hand: ${NOT_COMPUTABLE[question.id]}`, { skip: true }, () => {});
    return;
  }

  test(`${question.id} answer key matches the computed answer`, () => {
    assert.equal(question.type, "mcq", "only mcq solvers exist so far; add a matcher for the new type");

    assert.equal(keyProblem(question), null);
  });
});

test("the solvers flag exactly the four defects in the original v1 question bank", () => {
  const v1 = new Database(":memory:");
  v1.exec(fs.readFileSync(path.join(__dirname, "fixtures/v1-app.sql"), "utf8"));
  const original = v1.prepare("SELECT question_json FROM event_questions WHERE event_id = 1 ORDER BY question_order")
    .all()
    .map(row => JSON.parse(row.question_json))
    .map(({ answerIndex, ...rest }) => ({ ...rest, type: "mcq", answer: { index: answerIndex } }));
  v1.close();

  assert.equal(original.length, 20);
  const flagged = original.filter(question => keyProblem(question) !== null).map(question => question.id);
  assert.deepEqual(flagged, ["P5-01", "P6-01", "S1-01", "S2-02"]);
});
