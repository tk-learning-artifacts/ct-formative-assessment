// The code-reading type: validation, the public projection, scoring and
// partial credit, the solvers' claims against the real python3 and swift
// (where installed), and an HTTP attempt from start to the released
// breakdown and the teacher's results.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, execFileSync } = require("child_process");
const { promisify } = require("util");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const scoring = require("../src/scoring");
const { loadContent } = require("../src/content");
const { SPECS, SOLVERS, withLine, lineFixes } = require("./solvers/type-code-reading");
const { buildApp, login, startAttempt, submit, getAttempt, allKeys } = require("./helpers");

const execFileAsync = promisify(execFile);
const impl = scoring.getType("code-reading");
const content = new Map(loadContent().questions.map(question => [question.id, question]));

// The sample with a choice follow-up instead of its line one.
const choiceQuestion = {
  ...impl.sample,
  id: "T-CR-CHOICE",
  answer: { index: 0, followUp: 1 },
  followUp: { kind: "choice", prompt: "What does f([2, 3]) give back?", options: ["2", "5", "6"], points: 1 }
};

test("code-reading validation catches broken questions", () => {
  const q = impl.sample;
  assert.deepEqual(impl.validate(q), []);
  assert.deepEqual(impl.validate(choiceQuestion), []);
  assert.deepEqual(impl.validate({ ...q, followUp: undefined, answer: { index: 0 } }), []);

  const broken = {
    "no code": { ...q, code: undefined },
    "one option": { ...q, options: ["only"] },
    "repeated options": { ...q, options: ["a", "a", "b"] },
    "key out of range": { ...q, answer: { index: 3, followUp: 2 } },
    "follow-up key without a follow-up": { ...q, followUp: undefined },
    "unknown follow-up kind": { ...q, followUp: { ...q.followUp, kind: "text" } },
    "follow-up takes every point": { ...q, followUp: { ...q.followUp, points: 3 } },
    "follow-up worth nothing": { ...q, followUp: { ...q.followUp, points: 0 } },
    "key written inside the follow-up": { ...q, followUp: { ...q.followUp, answer: 2 } },
    "line follow-up on a missing line": { ...q, answer: { index: 0, followUp: 9 } },
    "line follow-up with options": { ...q, followUp: { ...q.followUp, options: ["a", "b"] } },
    "choice follow-up key out of range": { ...choiceQuestion, answer: { index: 0, followUp: 3 } },
    "glossary term not in the code": { ...q, glossary: [{ term: "while", note: "Repeats." }] },
    "glossary term twice": { ...q, glossary: [{ term: "+=", note: "a" }, { term: "+=", note: "b" }] },
    "glossary note on two lines": { ...q, glossary: [{ term: "+=", note: "Adds\nthings" }] },
    "glossary note too long": { ...q, glossary: [{ term: "+=", note: "x".repeat(201) }] },
    "empty glossary": { ...q, glossary: [] }
  };

  Object.entries(broken).forEach(([name, question]) => {
    assert.ok(impl.validate(question).length, `${name} should be rejected`);
  });

  // A blank line in the code cannot be the follow-up key.
  const blank = { ...q, code: { language: "python", source: "x = 1\n\nprint(x)" }, glossary: undefined, answer: { index: 0, followUp: 2 } };
  assert.ok(impl.validate(blank).length);
  assert.deepEqual(impl.validate({ ...blank, answer: { index: 0, followUp: [1, 3] } }), []);
});

test("students get the code, descriptions, follow-up and glossary, and no key", () => {
  const loaded = {
    ...impl.sample,
    followUp: { ...impl.sample.followUp, answer: 2, note: "line 3 is the one" },
    details: "teacher only",
    rubric: "secret",
    solution: "secret"
  };
  const safe = scoring.toPublicQuestion(loaded);

  assert.deepEqual(safe.followUp, { kind: "line", prompt: impl.sample.followUp.prompt, points: 1 });
  assert.deepEqual(safe.options, impl.sample.options);
  assert.deepEqual(safe.glossary, impl.sample.glossary);
  assert.deepEqual(safe.code, impl.sample.code);
  ["answer", "details", "rubric", "solution", "ontology", "outcomes", "difficulty"].forEach(field => {
    assert.equal(safe[field], undefined, field);
  });

  assert.deepEqual(scoring.toPublicQuestion(choiceQuestion).followUp, { kind: "choice", prompt: choiceQuestion.followUp.prompt, points: 1, options: ["2", "5", "6"] });
});

test("each part is marked on its own, and a missed part is spelled out", () => {
  const q = impl.sample;
  const score = raw => scoring.scoreResponse(q, raw);

  assert.deepEqual(score({ choice: 0, followUp: 4 }).result, { status: "scored", earned: 3, max: 3, correct: true, detail: null });
  assert.deepEqual(score({ choice: 0, followUp: 2 }).result, {
    status: "scored", earned: 2, max: 3, correct: false,
    detail: { partial: { parts: [{ part: "describe", earned: 2, max: 2 }, { part: "followUp", earned: 0, max: 1 }] } }
  });
  assert.equal(score({ choice: 1, followUp: 4 }).result.earned, 1);
  assert.equal(score({ choice: 0 }).result.earned, 2);
  assert.equal(score({ followUp: 4 }).result.earned, 1);
  assert.deepEqual(score({ choice: 2, followUp: 1 }).result.detail.partial.parts.map(part => part.earned), [0, 0]);

  // Without a follow-up the description is worth every point.
  const plain = { ...q, followUp: undefined, answer: { index: 0 } };
  assert.deepEqual(scoring.scoreResponse(plain, { choice: 0 }).result, { status: "scored", earned: 3, max: 3, correct: true, detail: null });
  assert.deepEqual(scoring.scoreResponse(plain, { choice: 1 }).result, { status: "scored", earned: 0, max: 3, correct: false, detail: null });

  // Several accepted lines: any of them earns the follow-up mark.
  const either = { ...q, answer: { index: 0, followUp: [2, 4] } };
  assert.equal(scoring.scoreResponse(either, { choice: 0, followUp: 2 }).result.earned, 3);
  assert.equal(scoring.scoreResponse(either, { choice: 0, followUp: 4 }).result.earned, 3);
});

test("code-reading keeps only usable parts and records what the student saw", () => {
  const q = impl.sample;
  const normal = raw => scoring.scoreResponse(q, raw).response;

  assert.deepEqual(normal({ choice: "1", followUp: "4" }), { choice: 1, followUp: 4 });
  assert.deepEqual(normal({ choice: 9, followUp: 4 }), { choice: null, followUp: 4 });
  assert.equal(normal({ choice: 9, followUp: 99 }), null);
  assert.equal(normal(2), null);
  assert.equal(normal([0, 4]), null);
  assert.equal(normal(undefined), null);
  assert.equal(scoring.scoreResponse(q, undefined).result.earned, 0);

  assert.deepEqual(scoring.scoreResponse(q, { choice: 1, followUp: 2 }).recorded, {
    choice: { index: 1, text: "Counts the numbers" },
    followUp: { line: 2, text: "    total = 0" }
  });
  assert.deepEqual(scoring.scoreResponse(q, { choice: 1 }).recorded, { choice: { index: 1, text: "Counts the numbers" }, followUp: null });
  assert.deepEqual(scoring.scoreResponse(choiceQuestion, { followUp: 2 }).recorded, { choice: null, followUp: { index: 2, text: "6" } });

  assert.deepEqual(scoring.keyResponse(q), { choice: { index: 0, text: "Adds up the numbers" }, followUp: { line: 4, text: "        total += x" } });
  assert.deepEqual(scoring.keyResponse(choiceQuestion), { choice: { index: 0, text: "Adds up the numbers" }, followUp: { index: 1, text: "5" } });

  // The legacy MCQ columns stay empty, so the breakdown uses keyResponse.
  assert.deepEqual(scoring.scoreResponse(q, { choice: 0 }).legacy, { chosenIndex: null, correctIndex: null });
});

test("a code-reading solver refuses an option it has no claim for", () => {
  const question = content.get("CR-P5-01");
  const edited = { ...question, options: question.options.map((option, i) => (i === 2 ? "The smallest number in the list" : option)) };
  const { describe } = SOLVERS["CR-P5-01"](edited);
  assert.throws(() => edited.options.forEach(option => describe.pick(option)), /no claim for the option/);
});

test("every wrong description fails on at least one input, so the inputs tell them apart", () => {
  Object.entries(SPECS).forEach(([id, spec]) => {
    const question = content.get(id);
    question.options.forEach((option, index) => {
      const holdsEverywhere = spec.inputs.every(input => spec.claims[option](input, spec.run(input)));
      assert.equal(holdsEverywhere, index === question.answer.index, `${id}: ${option}`);
    });
  });
});

// ---------- The real programs ----------

function hasCommand(command, args) {
  try {
    execFileSync(command, args, { stdio: "ignore", timeout: 20000 });
    return true;
  } catch (_error) {
    return false;
  }
}

const RUNNERS = {
  python: { command: "python3", available: hasCommand("python3", ["--version"]), extension: ".py" },
  swift: { command: "swift", available: hasCommand("swift", ["--version"]), extension: ".swift" }
};

// The source followed by one print per input. Python prints JSON so lists,
// dictionaries and None compare exactly; Swift's print of a Bool is the
// word true or false, as String() gives in JavaScript.
function harness(language, source, calls) {
  if (language === "python") {
    return `${source}\n\nimport json\n${calls.map(call => `print(json.dumps(${call}))`).join("\n")}\n`;
  }
  return `${source}\n\n${calls.map(call => `print(${call})`).join("\n")}\n`;
}

function parseOutput(language, line) {
  return language === "python" ? JSON.parse(line) : line;
}

async function runReal(language, program) {
  const runner = RUNNERS[language];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctquest-read-"));
  const file = path.join(dir, `main${runner.extension}`);

  try {
    fs.writeFileSync(file, program);
    const { stdout } = await execFileAsync(runner.command, [file], { encoding: "utf8", timeout: 60000 });
    return stdout.replace(/\n$/, "").split("\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

Object.entries(SPECS).filter(([, spec]) => spec.call).forEach(([id, spec]) => {
  const question = content.get(id);
  const language = question.code.language;
  const runner = RUNNERS[language];
  const skip = !runner ? `no runner for ${language}` : !runner.available && `${runner.command} is not installed`;

  test(`${id}: the real ${language} behaves as the solver's translation does`, { skip }, async () => {
    const calls = spec.inputs.map(spec.call);
    const printed = await runReal(language, harness(language, question.code.source, calls));
    const expected = spec.inputs.map(input => (language === "python" ? spec.run(input) : String(spec.run(input))));

    assert.deepEqual(printed.map(line => parseOutput(language, line)), expected);

    if (spec.followUp && typeof spec.followUp === "object") {
      for (const fix of lineFixes(spec)) {
        const fixed = withLine(question.code.source, fix.line, fix.replace);
        const fixedPrinted = await runReal(language, harness(language, fixed, calls));
        spec.inputs.forEach((input, i) => {
          assert.ok(spec.followUp.goal(input, parseOutput(language, fixedPrinted[i])), `${id}: with line ${fix.line} changed, ${calls[i]} printed ${fixedPrinted[i]}`);
        });
      }
    }
  });
});

// ---------- Over HTTP ----------

test("code-reading attempts over HTTP, from start to the released breakdown", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;
  const token = await login(app);
  const auth = { Authorization: `Bearer ${token}` };
  const filter = { types: ["code-reading"], audiences: ["core", "rgsynapse"] };

  const created = await request(app).post("/api/events").set(auth).send({ title: "Reading code", filter });
  assert.equal(created.status, 201);
  assert.equal(created.body.event.question_count, 14);

  const joinCode = created.body.event.join_code;
  const good = await startAttempt(app, { joinCode });
  const mixed = await startAttempt(app, { joinCode });

  await t.test("students get line-numbered code, glossary and follow-up, and no key", () => {
    const keys = allKeys(good);
    ["answer", "details", "correctIndex", "rubric", "outcomes", "ontology"].forEach(key => {
      assert.ok(!keys.has(key), `start response has "${key}"`);
    });

    const byId = Object.fromEntries(good.questions.map(question => [question.id, question]));
    assert.equal(byId["CR-RGS-S1-02"].code.language, "swift");
    assert.deepEqual(Object.keys(byId["CR-P6-01"].followUp).sort(), ["kind", "points", "prompt"]);
    assert.equal(byId["CR-P5-01"].followUp.options.length, 4);
    assert.ok(byId["CR-P5-01"].glossary.every(entry => Object.keys(entry).join() === "term,note"));
  });

  const right = Object.fromEntries(Array.from(content.values())
    .filter(question => question.type === "code-reading")
    .map(question => [question.id, { choice: question.answer.index, followUp: [].concat(question.answer.followUp)[0] }]));

  // Right description, wrong follow-up on two; wrong description, right
  // follow-up on one; only the description on one; the rest left out.
  const partial = {
    "CR-P5-01": { choice: 1, followUp: 0 },
    "CR-P6-01": { choice: 0, followUp: 4 },
    "CR-S1-01": { choice: 1, followUp: 0 },
    "CR-RGS-S1-01": { choice: 0 }
  };

  await t.test("submitting returns only the totals", async () => {
    const full = await submit(app, good.attempt, right);
    assert.equal(full.status, 200);
    assert.deepEqual(full.body.result, { score: 42, max: 42, pending: 0, markedSoFar: false, breakdownReleased: false });

    const some = await submit(app, mixed.attempt, partial);
    assert.equal(some.status, 200);
    assert.deepEqual(some.body.result, { score: 7, max: 42, pending: 0, markedSoFar: false, breakdownReleased: false });

    const before = await getAttempt(app, mixed.attempt);
    assert.equal(before.body.result.perQuestion, undefined);
  });

  await t.test("after release the breakdown shows both parts and which were missed", async () => {
    const release = await request(app).post(`/api/events/${created.body.event.id}/release`).set(auth);
    assert.equal(release.status, 200);

    const res = await getAttempt(app, mixed.attempt);
    const rows = Object.fromEntries(res.body.result.perQuestion.map(row => [row.id, row]));

    assert.deepEqual(rows["CR-P6-01"].response, {
      choice: { index: 0, text: "How many vowels are in the word" },
      followUp: { line: 4, text: "        change count by 1" }
    });
    assert.deepEqual(rows["CR-P6-01"].correctResponse.followUp, { line: 3, text: "    if letter is a vowel then" });
    assert.equal(rows["CR-P6-01"].earned, 2);
    assert.deepEqual(rows["CR-P6-01"].detail, { partial: { parts: [{ part: "describe", earned: 2, max: 2 }, { part: "followUp", earned: 0, max: 1 }] } });
    assert.equal(rows["CR-S1-01"].earned, 1);
    assert.equal(rows["CR-RGS-S1-01"].response.followUp, null);
    assert.equal(rows["CR-RGS-S2-02"].response, null);
    assert.equal(rows["CR-RGS-S2-02"].earned, 0);
  });

  await t.test("the teacher's results carry the recorded responses and the outcome", async () => {
    const res = await request(app).get(`/api/events/${created.body.event.id}/results`).set(auth);
    const attempt = res.body.attempts.find(row => row.id === mixed.attempt.id);
    const answers = Object.fromEntries(attempt.answers.map(answer => [answer.questionId, answer]));

    assert.equal(answers["CR-P5-01"].questionType, "code-reading");
    assert.equal(answers["CR-P5-01"].earnedPoints, 2);
    assert.deepEqual(answers["CR-P5-01"].response.followUp, { index: 0, text: "7, 9, 2" });

    const summary = await request(app).get(`/api/events/${created.body.event.id}/outcomes-summary`).set(auth);
    assert.equal(summary.status, 200);
    assert.ok(JSON.stringify(summary.body).includes("LO-READ-1"));
  });
});

test("the code-reading preset gives the same questions on its card, in the preview and in the event", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app, store } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const card = (await request(app).get("/api/presets").set(auth)).body.presets.find(preset => preset.id === "code-reading");

  assert.ok(card, "the preset is listed");
  assert.equal(card.aiScored, false);
  const expected = { core: 8, "core:P5": 1, "core:S2": 2, rgsynapse: 6, "rgsynapse:S1": 3, "rgsynapse:S2": 3 };

  for (const [who, count] of Object.entries(expected)) {
    const choice = { ...card.defaults, who };
    const preview = await request(app).post("/api/question-bank/preview").set(auth).send({ preset: choice });
    assert.equal(preview.body.count, count, who);
    assert.ok(preview.body.questions.every(q => q.type === "code-reading"), who);
    assert.equal(preview.body.aiRequired, false);

    if (who === card.defaults.who) {
      assert.equal(card.count, preview.body.count);
    }

    const created = await request(app).post("/api/events").set(auth).send({ title: `Reading ${who}`, preset: choice });
    assert.equal(created.status, 201);
    assert.equal(created.body.event.question_count, count);
    assert.deepEqual(store.getEventQuestions(created.body.event.id).map(q => q.id), preview.body.questions.map(q => q.id));
  }
});
