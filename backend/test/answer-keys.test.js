// Computed answer-key check. For every question, a solver works the answer out
// from the question's own text and the test asserts that exactly one option
// matches it and that this option is the stored key. Run against the original
// v1 questions it flags P6-01 (key said 7, the grid needs 6), S2-02 (the true
// cost, 4, was not an option), S1-01 ("3" and "B" were both right) and P5-01
// ("3, 1, 2" also always worked); the last test below keeps that true.
//
// Code-trace and Parsons questions have no options, so they get their own
// checks: the solver's computed output must score full marks as the key does,
// and every accepted Parsons order must print the question's expectedOutput.
// When python3 or swift is installed, the real programs are run as well.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, execFileSync } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { loadContent } = require("../src/content");
const { SOLVERS, NOT_COMPUTABLE } = require("./solvers");
const scoring = require("../src/scoring");
const { normalizeOutput } = require("../src/scoring/types/code-trace");

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

// An AI-scored question has no single key. Its solver returns the facts the
// full-credit criterion relies on (see solvers/ai-samples.js); each must hold
// when computed and be named in that criterion's description.
function rubricProblem(question) {
  const { facts } = SOLVERS[question.id](question);
  const full = question.rubric.find(criterion => criterion.points === question.points);
  const problems = [];

  if (!Array.isArray(facts) || !facts.length) {
    return `${question.id}: the solver returned no facts`;
  }

  facts.forEach(fact => {
    if (fact.holds !== true) {
      problems.push(`"${fact.mention}" does not hold for the question's code`);
    }
    if (!full.description.toLowerCase().includes(fact.mention.toLowerCase())) {
      problems.push(`the full-credit criterion does not mention "${fact.mention}"`);
    }
  });

  return problems.length ? `${question.id}: ${problems.join("; ")}` : null;
}

questions.forEach(question => {
  if (NOT_COMPUTABLE[question.id]) {
    test(`${question.id} key is checked by hand: ${NOT_COMPUTABLE[question.id]}`, { skip: true }, () => {});
    return;
  }

  if (question.type === "open-response-ai") {
    test(`${question.id} rubric rests on computed facts`, () => {
      assert.equal(rubricProblem(question), null);
    });
    return;
  }

  test(`${question.id} answer key matches the computed answer`, () => {
    assert.ok(TYPE_CHECKS[question.type], `no answer-key check for type "${question.type}"; add one to TYPE_CHECKS`);
    TYPE_CHECKS[question.type](question);
  });
});

function parsonsSource(question, order) {
  const text = new Map(question.lines.map(line => [line.id, line.text]));
  return order.map(id => text.get(id)).join("\n");
}

function parsonsOrders(question) {
  return [question.answer.order].concat(question.answer.alternatives || []);
}

const TYPE_CHECKS = {
  mcq(question) {
    assert.equal(keyProblem(question), null);
  },

  "code-trace"(question) {
    const computed = SOLVERS[question.id](question);
    assert.deepEqual(normalizeOutput(question.answer.output), normalizeOutput(computed), `${question.id}: key output differs from the computed output`);
    assert.equal(scoring.scoreResponse(question, computed).result.correct, true);
  },

  parsons(question) {
    assert.equal(typeof question.expectedOutput, "string", `${question.id}: give expectedOutput so the key order can be checked`);

    parsonsOrders(question).forEach(order => {
      const printed = SOLVERS[question.id](question, parsonsSource(question, order));
      assert.equal(printed, question.expectedOutput, `${question.id}: order ${order.join(",")} prints ${JSON.stringify(printed)}`);
    });
  }
};

// The real interpreters, where installed. CI and the Docker image have
// neither, so these skip there and the JavaScript translations above stand.
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

// Asynchronous on purpose: a synchronous run (swift takes seconds) blocks the
// event loop while the test reporter's output queues up, and with
// --test-force-exit on macOS, where pipe writes are asynchronous, the child
// could exit before that output reached the runner, silently dropping the
// rest of this file's results.
async function runProgram(language, source) {
  const runner = RUNNERS[language];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctquest-run-"));
  const file = path.join(dir, `main${runner.extension}`);

  try {
    fs.writeFileSync(file, `${source}\n`);
    const { stdout } = await execFileAsync(runner.command, [file], { encoding: "utf8", timeout: 60000 });
    return stdout;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

questions.filter(question => question.type === "code-trace" || question.type === "parsons").forEach(question => {
  const language = question.type === "code-trace" ? question.code.language : question.language;
  const runner = RUNNERS[language];
  const skip = !runner ? `no runner for ${language}` : !runner.available && `${runner.command} is not installed`;

  test(`${question.id} key checked by running real ${language}`, { skip }, async () => {
    if (question.type === "code-trace") {
      const printed = await runProgram(language, question.code.source);
      assert.equal(scoring.scoreResponse(question, printed).result.correct, true, `${question.id}: ${runner.command} printed ${JSON.stringify(printed)}`);
      return;
    }

    for (const order of parsonsOrders(question)) {
      const printed = await runProgram(language, parsonsSource(question, order));
      assert.deepEqual(normalizeOutput(printed), normalizeOutput(question.expectedOutput), `${question.id}: order ${order.join(",")} printed ${JSON.stringify(printed)}`);
    }

    // A reference program in the code block (TS-PA-03 shows the Python it
    // translates) must print the same thing.
    if (question.code && RUNNERS[question.code.language] && RUNNERS[question.code.language].available) {
      assert.deepEqual(normalizeOutput(await runProgram(question.code.language, question.code.source)), normalizeOutput(question.expectedOutput));
    }
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
