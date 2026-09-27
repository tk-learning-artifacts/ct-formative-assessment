// The scorer registry: mcq scoring, reserved types, plugging in a new type,
// and a public-projection check that runs over every registered type.

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const scoring = require("../src/scoring");
const { loadContent, DEFAULT_CONTENT_DIR } = require("../src/content");
const { makeTempDir } = require("./helpers");

// Anything that marks, explains or gives away an answer.
const SECRET_FIELDS = ["answer", "answerIndex", "rubric", "solution", "accepted", "details", "explanation", "bank", "crosswalk", "ontology", "outcomes", "difficulty"];

const mcqQuestion = {
  id: "T-1",
  type: "mcq",
  title: "t",
  prompt: "p",
  options: ["a", "b", "c"],
  answer: { index: 2 },
  points: 4
};

test("mcq scores through the registry and records what the student saw", () => {
  assert.deepEqual(scoring.scoreResponse(mcqQuestion, 2).result, { status: "scored", earned: 4, max: 4, correct: true, detail: null });
  assert.deepEqual(scoring.scoreResponse(mcqQuestion, 1).result, { status: "scored", earned: 0, max: 4, correct: false, detail: null });
  assert.equal(scoring.scoreResponse(mcqQuestion, undefined).result.earned, 0);
  assert.equal(scoring.scoreResponse(mcqQuestion, "2").response, 2);
  assert.equal(scoring.scoreResponse(mcqQuestion, 7).response, null);
  assert.equal(scoring.scoreResponse(mcqQuestion, 1.5).response, null);
  assert.deepEqual(scoring.scoreResponse(mcqQuestion, 0).recorded, { index: 0, text: "a" });
  assert.equal(scoring.scoreResponse(mcqQuestion, undefined).recorded, null);
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

test("every active type's public projection leaves out every secret field", () => {
  const active = scoring.listTypes().filter(entry => entry.status === "active");
  assert.ok(active.length >= 1);

  active.forEach(({ type }) => {
    const impl = scoring.getType(type);
    assert.deepEqual(impl.validate(impl.sample), [], `${type} sample must be valid`);

    const loaded = { ...impl.sample };
    SECRET_FIELDS.forEach(field => { loaded[field] = loaded[field] === undefined ? "secret" : loaded[field]; });

    const safe = scoring.toPublicQuestion(loaded);
    SECRET_FIELDS.forEach(field => assert.equal(safe[field], undefined, `${type} exposes "${field}"`));
    Object.keys(safe).forEach(field => {
      assert.ok(scoring.BASE_PUBLIC_FIELDS.includes(field) || impl.publicFields.includes(field), `${type} exposes unlisted "${field}"`);
    });
  });
});

test("reserved types are listed but cannot score", () => {
  const types = Object.fromEntries(scoring.listTypes().map(entry => [entry.type, entry.status]));
  assert.equal(types.mcq, "active");
  assert.equal(types["open-response-ai"], "active");
  ["code-trace", "parsons", "short-answer", "multi-select"].forEach(type => {
    assert.equal(types[type], "reserved", type);
  });
  assert.throws(() => scoring.scoreResponse({ ...mcqQuestion, type: "parsons" }, 1), /no active scorer/);
});

test("every file in scoring/types is a registered type", () => {
  const files = fs.readdirSync(path.join(__dirname, "../src/scoring/types")).filter(name => name.endsWith(".js"));
  const registered = scoring.listTypes().map(entry => entry.type).sort();
  assert.deepEqual(files.map(name => path.basename(name, ".js")).sort(), registered);
});

test("a new type plugs in by registering an implementation with an allowlist projection", () => {
  scoring.registerType({
    type: "short-answer",
    label: "Short answer",
    publicFields: ["placeholder"],
    sample: { id: "SA-0", type: "short-answer", title: "t", prompt: "p", points: 1, answer: { accepted: ["x"] } },
    validate: q => (Array.isArray(q.answer && q.answer.accepted) ? [] : ["needs answer.accepted"]),
    normalizeResponse: raw => (typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : null),
    recordResponse: (_q, response) => (response === null ? null : { text: response }),
    score: (q, response) => {
      const correct = response !== null && q.answer.accepted.includes(response);
      return { status: "scored", earned: correct ? q.points : 0, max: q.points, correct, detail: null };
    }
  });

  const question = { id: "SA-1", type: "short-answer", title: "t", prompt: "p", placeholder: "a number", points: 2, answer: { accepted: ["sixteen", "16"] } };
  assert.equal(scoring.scoreResponse(question, " 16 ").result.earned, 2);
  assert.equal(scoring.scoreResponse(question, "15").result.earned, 0);
  assert.deepEqual(scoring.scoreResponse(question, "16").recorded, { text: "16" });
  assert.deepEqual(scoring.scoreResponse(question, "16").legacy, { chosenIndex: null, correctIndex: null });
  assert.deepEqual(Object.keys(scoring.toPublicQuestion(question)).sort(), ["id", "placeholder", "points", "prompt", "title", "type"]);
  assert.equal(scoring.getType("short-answer").status, "active");
  assert.throws(() => scoring.registerType({ type: "mcq-2" }), /missing/);
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
