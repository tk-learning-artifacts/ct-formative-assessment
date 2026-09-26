// The scorer registry: mcq scoring, reserved types, and plugging in a new type.

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const scoring = require("../src/scoring");
const { loadContent, DEFAULT_CONTENT_DIR } = require("../src/content");
const { makeTempDir } = require("./helpers");

const mcqQuestion = {
  id: "T-1",
  type: "mcq",
  title: "t",
  prompt: "p",
  options: ["a", "b", "c"],
  answer: { index: 2 },
  points: 4
};

test("mcq scores through the registry", () => {
  assert.deepEqual(scoring.scoreResponse(mcqQuestion, 2).result, { status: "scored", earned: 4, max: 4, correct: true });
  assert.deepEqual(scoring.scoreResponse(mcqQuestion, 1).result, { status: "scored", earned: 0, max: 4, correct: false });
  assert.deepEqual(scoring.scoreResponse(mcqQuestion, undefined).result, { status: "scored", earned: 0, max: 4, correct: false });
  assert.equal(scoring.scoreResponse(mcqQuestion, "2").response, 2);
  assert.equal(scoring.scoreResponse(mcqQuestion, 7).response, null);
  assert.equal(scoring.scoreResponse(mcqQuestion, 1.5).response, null);
  assert.deepEqual(scoring.scoreResponse(mcqQuestion, 0).legacy, { chosenIndex: 0, correctIndex: 2 });
});

test("mcq validation catches broken questions", () => {
  const mcq = scoring.getType("mcq");
  assert.deepEqual(mcq.validate(mcqQuestion), []);
  assert.ok(mcq.validate({ ...mcqQuestion, answer: { index: 3 } }).length);
  assert.ok(mcq.validate({ ...mcqQuestion, answer: undefined }).length);
  assert.ok(mcq.validate({ ...mcqQuestion, options: ["only one"] }).length);
  assert.ok(mcq.validate({ ...mcqQuestion, options: ["same", "same"] }).length);
});

test("mcq public projection drops the answer key", () => {
  const safe = scoring.toPublicQuestion({ ...mcqQuestion, rubric: "secret", solution: "secret" });
  assert.equal(safe.answer, undefined);
  assert.equal(safe.rubric, undefined);
  assert.equal(safe.solution, undefined);
  assert.deepEqual(safe.options, ["a", "b", "c"]);
});

test("reserved types are listed but cannot score", () => {
  const types = Object.fromEntries(scoring.listTypes().map(entry => [entry.type, entry.status]));
  assert.equal(types.mcq, "active");
  ["code-trace", "parsons", "short-answer", "open-response-ai", "multi-select"].forEach(type => {
    assert.equal(types[type], "reserved", type);
  });
  assert.throws(() => scoring.scoreResponse({ ...mcqQuestion, type: "parsons" }, 1), /no active scorer/);
});

test("a new type plugs in by registering an implementation", () => {
  scoring.registerType({
    type: "short-answer",
    label: "Short answer",
    validate: q => (Array.isArray(q.answer && q.answer.accepted) ? [] : ["needs answer.accepted"]),
    toPublic: ({ answer, ...rest }) => rest,
    normalizeResponse: raw => (typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : null),
    score: (q, response) => {
      const correct = response !== null && q.answer.accepted.includes(response);
      return { status: "scored", earned: correct ? q.points : 0, max: q.points, correct };
    }
  });

  const question = { id: "SA-1", type: "short-answer", points: 2, answer: { accepted: ["sixteen", "16"] } };
  assert.equal(scoring.scoreResponse(question, " 16 ").result.earned, 2);
  assert.equal(scoring.scoreResponse(question, "15").result.earned, 0);
  assert.deepEqual(scoring.scoreResponse(question, "16").legacy, { chosenIndex: null, correctIndex: null });
  assert.equal(scoring.getType("short-answer").status, "active");
  assert.throws(() => scoring.registerType({ type: "mcq" }), /missing/);
});

test("the content loader rejects a question of a reserved type", () => {
  const dir = makeTempDir();
  fs.cpSync(DEFAULT_CONTENT_DIR, dir, { recursive: true });
  const bankPath = path.join(dir, "questions/core.json");
  const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
  bank.questions[0].type = "parsons";
  fs.writeFileSync(bankPath, JSON.stringify(bank));

  assert.throws(() => loadContent(dir), /reserved type "parsons"/);
  fs.rmSync(dir, { recursive: true, force: true });
});
