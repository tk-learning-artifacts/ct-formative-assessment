// The code-trace and Parsons types: output normalisation and partial credit,
// the Parsons shuffle (deterministic, opaque ids, never a correct order), and
// a full attempt over HTTP from start to the released breakdown.

const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const scoring = require("../src/scoring");
const { loadContent } = require("../src/content");
const { buildApp, login, startAttempt, submit, getAttempt, allKeys } = require("./helpers");

const codeTrace = scoring.getType("code-trace");
const parsons = scoring.getType("parsons");

const traceQuestion = {
  id: "T-CT",
  type: "code-trace",
  title: "t",
  prompt: "p",
  code: { language: "python", source: "print('a  b')\nprint(1)\nprint(2)\nprint(3)" },
  answer: { output: "a  b\n1\n2\n3" },
  points: 4
};

function scoreTrace(question, raw) {
  return scoring.scoreResponse(question, raw).result;
}

test("code-trace forgives line endings and trailing whitespace, nothing else by default", () => {
  assert.equal(scoreTrace(traceQuestion, "a  b\n1\n2\n3").earned, 4);
  assert.equal(scoreTrace(traceQuestion, "a  b  \r\n1\r\n2\t\r\n3\n\n  \n").earned, 4);
  assert.equal(scoreTrace(traceQuestion, "a b\n1\n2\n3").earned, 0);
  assert.equal(scoreTrace(traceQuestion, " a  b\n1\n2\n3").earned, 0, "leading spaces are part of the output");
  assert.equal(scoreTrace(traceQuestion, "a  b\n1\n2").earned, 0);
  assert.equal(scoreTrace(traceQuestion, "   ").earned, 0);
  assert.equal(scoreTrace(traceQuestion, undefined).earned, 0);
  assert.equal(scoreTrace(traceQuestion, 42).earned, 0);
  assert.deepEqual(scoreTrace(traceQuestion, "a  b\n1\n2\n3"), { status: "scored", earned: 4, max: 4, correct: true, detail: null });
});

test("code-trace can collapse spaces, accept other forms and give credit per line", () => {
  const collapse = { ...traceQuestion, marking: { collapseSpaces: true } };
  assert.equal(scoreTrace(collapse, "a b\n1\n2\n3").earned, 4);
  assert.equal(scoreTrace(collapse, "a \t  b\n1\n2\n3").earned, 4);

  const accepted = { ...traceQuestion, answer: { output: "['x']", accepted: ["[\"x\"]"] } };
  assert.equal(scoreTrace(accepted, "[\"x\"]").earned, 4);
  assert.equal(scoreTrace(accepted, "['x']").earned, 4);
  assert.equal(scoreTrace(accepted, "[x]").earned, 0);

  const partial = { ...traceQuestion, marking: { partial: "lines" } };
  assert.deepEqual(scoreTrace(partial, "a  b\n1\n9\n3"), { status: "scored", earned: 3, max: 4, correct: false, detail: { partial: { matchedLines: 3, ofLines: 4 } } });
  assert.equal(scoreTrace(partial, "a  b\n1").earned, 2);
  assert.equal(scoreTrace(partial, "a  b\n1\n2\n3\nextra").earned, 3, "an extra line costs marks and never reaches full marks");
  assert.equal(scoreTrace(partial, "1\n2\n3").earned, 0, "lines are compared by position");
});

test("code-trace records exactly what the student typed and validates its key", () => {
  assert.deepEqual(scoring.scoreResponse(traceQuestion, "a  b \r\n1").recorded, { text: "a  b \n1" });
  assert.equal(scoring.scoreResponse(traceQuestion, "").recorded, null);
  assert.equal(scoring.scoreResponse(traceQuestion, "x".repeat(10000)).recorded.text.length, 4000);
  assert.deepEqual(scoring.keyResponse(traceQuestion), { text: "a  b\n1\n2\n3" });

  assert.deepEqual(codeTrace.validate(traceQuestion), []);
  assert.ok(codeTrace.validate({ ...traceQuestion, code: undefined }).length);
  assert.ok(codeTrace.validate({ ...traceQuestion, answer: { output: "  \n " } }).length);
  assert.ok(codeTrace.validate({ ...traceQuestion, answer: { output: "1", accepted: "2" } }).length);
  assert.ok(codeTrace.validate({ ...traceQuestion, marking: { partial: "words" } }).length);
  assert.ok(codeTrace.validate({ ...traceQuestion, marking: { collapse: true } }).length);
  assert.deepEqual(Object.keys(scoring.toPublicQuestion(traceQuestion)).sort(), ["code", "id", "points", "prompt", "title", "type"]);
});

const parsonsQuestion = {
  id: "T-PA",
  type: "parsons",
  title: "t",
  prompt: "p",
  language: "python",
  lines: [
    { id: "a", text: "x = 1" },
    { id: "b", text: "y = 2" },
    { id: "c", text: "z = x + y" },
    { id: "d", text: "print(z)" },
    { id: "w", text: "print(x)" }
  ],
  answer: { order: ["a", "b", "c", "d"], alternatives: [["b", "a", "c", "d"]] },
  expectedOutput: "3",
  points: 4
};

// The opaque ids a student would send for the given content ids.
function publicIds(question, ids) {
  return ids.map(id => parsons.publicLineId(question.id, id));
}

function scoreParsons(question, ids) {
  return scoring.scoreResponse(question, publicIds(question, ids)).result;
}

test("parsons accepts the key and its alternatives, and nothing with a distractor", () => {
  assert.deepEqual(scoreParsons(parsonsQuestion, ["a", "b", "c", "d"]), { status: "scored", earned: 4, max: 4, correct: true, detail: null });
  assert.equal(scoreParsons(parsonsQuestion, ["b", "a", "c", "d"]).earned, 4);
  assert.equal(scoreParsons(parsonsQuestion, ["a", "b", "d", "c"]).earned, 0);
  assert.equal(scoreParsons(parsonsQuestion, ["a", "b", "c", "d", "w"]).earned, 0);
  assert.equal(scoreParsons(parsonsQuestion, ["a", "b", "c"]).earned, 0);
});

test("parsons partial credit follows the longest correct run", () => {
  const partial = { ...parsonsQuestion, marking: { partial: "longest-run" } };
  assert.equal(scoreParsons(partial, ["a", "b", "c", "d"]).earned, 4);
  assert.deepEqual(scoreParsons(partial, ["c", "d", "a", "b"]), { status: "scored", earned: 2, max: 4, correct: false, detail: { partial: { longestRun: 2, ofLines: 4 } } });
  assert.equal(scoreParsons(partial, ["a", "c", "d", "b"]).earned, 3, "\"a c d\" is a run in the alternative order b a c d");
  assert.equal(scoreParsons(partial, ["a", "b", "c", "d", "w"]).earned, 3, "an extra line never reaches full marks");
  assert.equal(scoreParsons(partial, ["d", "c", "b", "a"]).earned, 2, "\"b a\" is a run in the alternative order");
  assert.equal(scoreParsons({ ...partial, answer: { order: ["a", "b", "c", "d"] } }, ["d", "c", "b", "a"]).earned, 1);
});

test("parsons turns the student's opaque ids into content ids, and rejects anything else", () => {
  const ids = publicIds(parsonsQuestion, ["a", "b"]);
  assert.deepEqual(scoring.scoreResponse(parsonsQuestion, ids).response, ["a", "b"]);
  assert.deepEqual(scoring.scoreResponse(parsonsQuestion, ids).recorded, { lines: [{ id: "a", text: "x = 1" }, { id: "b", text: "y = 2" }] });

  // Content ids are not accepted: a student could only know them from a leak.
  assert.equal(scoring.scoreResponse(parsonsQuestion, ["a", "b", "c", "d"]).response, null);
  assert.equal(scoring.scoreResponse(parsonsQuestion, [ids[0], ids[0]]).response, null);
  assert.equal(scoring.scoreResponse(parsonsQuestion, []).response, null);
  assert.equal(scoring.scoreResponse(parsonsQuestion, "a,b").response, null);
  assert.equal(scoring.scoreResponse(parsonsQuestion, [ids[0], 7]).response, null);
  assert.equal(scoring.scoreResponse(parsonsQuestion, undefined).recorded, null);

  assert.deepEqual(scoring.keyResponse(parsonsQuestion).lines.map(line => line.id), ["a", "b", "c", "d"]);
});

test("parsons validation catches broken questions", () => {
  assert.deepEqual(parsons.validate(parsonsQuestion), []);
  const broken = [
    { lines: parsonsQuestion.lines.slice(0, 2) },
    { lines: [...parsonsQuestion.lines, { id: "a", text: "again" }] },
    { answer: { order: ["a", "nope"] } },
    { answer: { order: ["a", "a", "b"] } },
    { answer: { order: ["a", "b", "c", "d"], alternatives: [["a", "b", "c"]] } },
    { answer: { order: ["a", "b", "c", "d"], alternatives: [["a", "b", "c", "w"]] } },
    { lines: [...parsonsQuestion.lines, { id: "v", text: "x = 1" }] },
    { language: undefined },
    { marking: { partial: "lines" } },
    { expectedOutput: 3 }
  ];

  broken.forEach(change => {
    assert.ok(parsons.validate({ ...parsonsQuestion, ...change }).length, JSON.stringify(change));
  });
});

// Every order that counts as correct, as text, so identical lines count too.
function correctTextOrders(question) {
  const text = new Map(question.lines.map(line => [line.id, line.text]));
  return [question.answer.order].concat(question.answer.alternatives || []).map(order => order.map(id => text.get(id)).join("\n"));
}

function assertShuffleHidesAnswer(question) {
  const shown = scoring.toPublicQuestion(question).lines;
  const contentText = question.lines.map(line => line.text);
  const solutionText = new Set(question.answer.order.map(id => question.lines.find(line => line.id === id).text));

  assert.equal(shown.length, question.lines.length, `${question.id} shows every line`);
  assert.deepEqual(shown.map(line => line.text).sort(), contentText.slice().sort(), `${question.id} shows the same lines`);
  assert.notDeepEqual(shown.map(line => line.text), contentText, `${question.id} is shown in content order`);

  const shownSolution = shown.map(line => line.text).filter(text => solutionText.has(text)).join("\n");
  assert.ok(!correctTextOrders(question).includes(shownSolution), `${question.id} is shown in a correct order`);

  // The ids are opaque: they are not the content ids, and sorting them does
  // not give the answer either.
  const contentIds = new Set(question.lines.map(line => line.id));
  shown.forEach(line => assert.ok(!contentIds.has(line.id), `${question.id} shows content id ${line.id}`));
  shown.forEach(line => assert.match(line.id, /^L[0-9a-f]{10}$/));
  assert.deepEqual(scoring.toPublicQuestion(question).lines, shown, `${question.id} shuffle is deterministic`);
}

// A student who has this repository but not the server's secret. Two
// attacks that worked while the ids and shuffle were unkeyed: hashing likely
// content ids, and replaying the shuffle seeded by the question id to invert
// it back to the order the author wrote the lines in.
function unkeyedLineId(questionId, lineId) {
  return "L" + crypto.createHash("sha256").update(`${questionId}\u0000${lineId}`).digest("hex").slice(0, 10);
}

function unkeyedFirstShuffle(questionId, size) {
  let seed = crypto.createHash("sha256").update(`parsons:${questionId}`).digest().readUInt32LE(0);
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const idx = Array.from({ length: size }, (_, i) => i);
  for (let i = size - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

test("the Parsons ids and shuffle are keyed with the server secret", () => {
  const shipped = loadContent().questions.filter(question => question.type === "parsons");

  try {
    scoring.configure({ secret: "first-secret-for-this-test" });
    const first = shipped.map(question => scoring.toPublicQuestion(question).lines);
    scoring.configure({ secret: "second-secret-for-this-test" });
    const second = shipped.map(question => scoring.toPublicQuestion(question).lines);

    shipped.forEach((question, n) => {
      const ids = new Set(first[n].map(line => line.id));
      assert.ok(second[n].every(line => !ids.has(line.id)), `${question.id} ids depend on the secret`);

      // Hashing the content ids without the key finds nothing.
      const guessed = new Set(question.lines.map(line => unkeyedLineId(question.id, line.id)));
      assert.ok(first[n].every(line => !guessed.has(line.id)), `${question.id} ids are not the unkeyed hash`);

      // Inverting the unkeyed shuffle no longer gives the content order.
      const shown = first[n].map(line => line.text);
      const recovered = [];
      unkeyedFirstShuffle(question.id, shown.length).forEach((contentIndex, k) => { recovered[contentIndex] = shown[k]; });
      assert.notDeepEqual(recovered, question.lines.map(line => line.text), `${question.id} content order recovered`);
    });

    assert.ok(shipped.some((question, n) => first[n].map(line => line.text).join("\n") !== second[n].map(line => line.text).join("\n")),
      "the shuffle depends on the secret");
  } finally {
    scoring.configure({ secret: "question-types-test-restored" });
  }
});

test("the Parsons shuffle never shows a correct order or the content order", () => {
  const shipped = loadContent().questions.filter(question => question.type === "parsons");
  assert.ok(shipped.length >= 3);
  shipped.concat([parsonsQuestion, parsons.sample]).forEach(assertShuffleHidesAnswer);

  // Many generated questions, including tiny ones where most orders are
  // correct, so a shuffle that merely usually works would be caught.
  for (let n = 0; n < 300; n += 1) {
    const size = 3 + (n % 4);
    const lines = Array.from({ length: size }, (_, i) => ({ id: `l${i}`, text: `line ${i}` }));
    const order = lines.map(line => line.id);
    const question = { ...parsonsQuestion, id: `GEN-${n}`, lines, answer: { order } };

    if (n % 3 === 0) {
      question.answer = { order, alternatives: [[order[1], order[0], ...order.slice(2)]] };
    }

    assert.deepEqual(parsons.validate(question), [], question.id);
    assertShuffleHidesAnswer(question);
  }
});

test("the Parsons shuffle depends on the question id", () => {
  const a = scoring.toPublicQuestion(parsonsQuestion).lines.map(line => line.text);
  const others = ["T-PA-2", "T-PA-3", "T-PA-4", "T-PA-5"].map(id => scoring.toPublicQuestion({ ...parsonsQuestion, id }).lines.map(line => line.text));
  assert.ok(others.some(order => order.join() !== a.join()), "different questions get different shuffles");
});

test("a question whose every order is correct cannot be shuffled safely and is rejected", () => {
  const lines = [{ id: "a", text: "a = 1" }, { id: "b", text: "b = 2" }, { id: "c", text: "c = 3" }];
  const ids = ["a", "b", "c"];
  const all = [["a", "c", "b"], ["b", "a", "c"], ["b", "c", "a"], ["c", "a", "b"], ["c", "b", "a"]];
  const question = { ...parsonsQuestion, lines, answer: { order: ids, alternatives: all } };

  assert.match(parsons.validate(question).join(), /no shuffled order that hides the answer/);
});

test("code-trace and Parsons attempts over HTTP, from start to the released breakdown", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;
  const token = await login(app);
  const auth = { Authorization: `Bearer ${token}` };
  const filter = { types: ["code-trace", "parsons"], audiences: ["core", "rgsynapse"] };

  const created = await request(app).post("/api/events").set(auth).send({ title: "New types", filter });
  assert.equal(created.status, 201);
  assert.equal(created.body.event.question_count, 6);

  const joinCode = created.body.event.join_code;
  const good = await startAttempt(app, { joinCode });
  const bad = await startAttempt(app, { joinCode });

  await t.test("students get the programs and shuffled lines, and no key", () => {
    const keys = allKeys(good);
    ["answer", "accepted", "output", "order", "alternatives", "marking", "details", "correctIndex"].forEach(key => {
      assert.ok(!keys.has(key), `start response has "${key}"`);
    });

    const byId = Object.fromEntries(good.questions.map(question => [question.id, question]));
    assert.equal(byId["TS-CT-01"].code.language, "python");
    assert.equal(byId["TS-PA-03"].language, "swift");
    assert.equal(byId["TS-PA-03"].code.language, "python");
    assert.equal(byId["TS-PA-02"].expectedOutput, "14");
    assert.ok(byId["TS-PA-02"].lines.every(line => /^L[0-9a-f]{10}$/.test(line.id)));
  });

  // Build the right and wrong answers from what the student was sent.
  const content = new Map(loadContent().questions.map(question => [question.id, question]));
  const publicLines = Object.fromEntries(good.questions.filter(q => q.type === "parsons").map(q => [q.id, q.lines]));

  function orderByText(questionId, ids) {
    const text = new Map(content.get(questionId).lines.map(line => [line.id, line.text]));
    return ids.map(id => publicLines[questionId].find(line => line.text === text.get(id)).id);
  }

  const correctAnswers = {
    "TS-CT-01": "2\r\n4\r\n8\r\n16\r\n",
    "TS-CT-02": "LOOP  1\nLIST 2\nPRINT 3",
    "TS-CT-03": "[\"go!\", \"go!go!\", \"go!go!go!\"]\n9",
    "TS-PA-01": orderByText("TS-PA-01", ["start", "loop", "show", "step", "launch"]),
    "TS-PA-02": orderByText("TS-PA-02", ["zero", "list", "loop", "test", "add", "print"]),
    "TS-PA-03": orderByText("TS-PA-03", ["declare", "loop", "square", "close", "print"])
  };

  const wrongAnswers = {
    "TS-CT-01": "2\n4\n6\n8",
    "TS-CT-02": "LOOP 1\nIF 2\nLIST 3",
    "TS-PA-01": orderByText("TS-PA-01", ["start", "loop", "step", "show", "launch"]),
    "TS-PA-02": orderByText("TS-PA-02", ["list", "zero", "loop", "odd", "add", "print"]),
    "TS-PA-03": orderByText("TS-PA-03", ["let", "loop", "square", "close", "print"])
  };

  await t.test("submitting returns only the totals", async () => {
    const right = await submit(app, good.attempt, correctAnswers);
    assert.equal(right.status, 200);
    assert.deepEqual(right.body.result, { score: 26, max: 26, breakdownReleased: false });

    const wrong = await submit(app, bad.attempt, wrongAnswers);
    assert.equal(wrong.status, 200);
    // CT-01: 2 of 4 lines; CT-02: 1 of 3; PA-02: longest run "list zero loop" 3 of 6 -> 2 of 5.
    assert.deepEqual(wrong.body.result, { score: 5, max: 26, breakdownReleased: false });

    const before = await getAttempt(app, bad.attempt);
    assert.equal(before.body.result.perQuestion, undefined);
  });

  await t.test("after release the breakdown shows each answer and the correct one", async () => {
    const release = await request(app).post(`/api/events/${created.body.event.id}/release`).set(auth);
    assert.equal(release.status, 200);

    const res = await getAttempt(app, bad.attempt);
    const rows = Object.fromEntries(res.body.result.perQuestion.map(row => [row.id, row]));

    assert.deepEqual(rows["TS-CT-01"].response, { text: "2\n4\n6\n8" });
    assert.deepEqual(rows["TS-CT-01"].correctResponse, { text: "2\n4\n8\n16" });
    assert.equal(rows["TS-CT-01"].earned, 2);
    assert.deepEqual(rows["TS-CT-01"].detail, { partial: { matchedLines: 2, ofLines: 4 } });
    assert.equal(rows["TS-CT-03"].response, null);
    assert.equal(rows["TS-CT-03"].earned, 0);

    assert.deepEqual(rows["TS-PA-03"].response.lines.map(line => line.text), ["let total = 0", "for i in 1...4 {", "    total += i * i", "}", "print(total)"]);
    assert.deepEqual(rows["TS-PA-03"].correctResponse.lines.map(line => line.text), ["var total = 0", "for i in 1...4 {", "    total += i * i", "}", "print(total)"]);
    assert.equal(rows["TS-PA-03"].correct, false);
    assert.equal(rows["TS-PA-02"].earned, 2);
    assert.equal(rows["TS-PA-01"].earned, 0);
  });

  await t.test("the teacher's results carry the recorded responses", async () => {
    const res = await request(app).get(`/api/events/${created.body.event.id}/results`).set(auth);
    const attempt = res.body.attempts.find(row => row.id === good.attempt.id);
    const answers = Object.fromEntries(attempt.answers.map(answer => [answer.questionId, answer]));

    assert.equal(answers["TS-CT-02"].questionType, "code-trace");
    assert.deepEqual(answers["TS-CT-02"].response, { text: "LOOP  1\nLIST 2\nPRINT 3" });
    assert.equal(answers["TS-CT-02"].earnedPoints, 3);
    assert.deepEqual(answers["TS-PA-02"].response.lines.map(line => line.id), ["zero", "list", "loop", "test", "add", "print"]);
    assert.equal(answers["TS-PA-02"].earnedPoints, 5);
  });
});

test("the new sample questions stay out of the legacy modes", () => {
  const modes = require("../content/legacy-modes.json").modes;
  const pinned = new Set(Object.values(modes).flat());
  loadContent().questions.filter(question => question.id.startsWith("TS-")).forEach(question => {
    assert.ok(!pinned.has(question.id), question.id);
  });
});
