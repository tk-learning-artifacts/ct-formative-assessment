// Block programming questions: the shared engine (program checks, the
// interpreter and its step limit), the rule that keeps the given blocks in
// place, marking with and without partial credit, what students are sent, and
// a full attempt over HTTP. The engine is one file, web/lib/blocks-engine.js,
// which the student page loads for its animation and the scorer requires for
// marking; a test below checks the served copy is that same file.

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const engine = require("../../web/lib/blocks-engine");
const scoring = require("../src/scoring");
const blocksType = require("../src/scoring/types/blocks");
const { loadContent } = require("../src/content");
const { buildApp, login, startAttempt, submit, getAttempt, allKeys } = require("./helpers");

const hat = next => ({ type: "when_run", ...(next ? { next } : {}) });
const chain = (...blocks) => {
  for (let i = blocks.length - 2; i >= 0; i -= 1) {
    blocks[i] = { ...blocks[i], next: blocks[i + 1] };
  }
  return blocks[0];
};
const b = (type, extra = {}) => ({ type, ...extra });
const move = () => b("move_forward");
const program = first => ({ scripts: [hat(first)] });

const corridor = { grid: ["....G"], start: { x: 0, y: 0, facing: "east" }, expect: { reachGoal: true } };
const maze = { world: "maze" };

const content = new Map(loadContent().questions.map(question => [question.id, question]));

test("a program is checked against the block list before anything runs", () => {
  const ok = engine.normalizeWorkspace(program(chain(move(), b("turn_left"))), maze);
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.value, { scripts: [{ type: "when_run", next: { type: "move_forward", next: { type: "turn_left" } } }] });

  const bad = [
    [null, /scripts/],
    [{ scripts: "no" }, /scripts/],
    [program(b("launch_rocket")), /unknown block "launch_rocket"/],
    [program(b("path_ahead")), /cannot go where a stacking block goes/],
    [program(b("if_then", { inputs: { IF: move() } })), /cannot go where a boolean block goes/],
    [program(b("repeat_times", { fields: { TIMES: 21 } })), /TIMES must be a whole number from 0 to 20/],
    [program(b("repeat_times", { fields: { TIMES: "4; drop table" } })), /TIMES must be a whole number/],
    [program(b("compare", {})), /cannot go where a stacking block goes/],
    [program(b("change_var", { fields: { VAR: "stars" } })), /variable this question does not have/],
    [{ scripts: [hat(b("when_run"))] }, /cannot go where a stacking block goes/],
    [{ scripts: [b("path_ahead", { next: move() })] }, /cannot have a block under it/],
    [{ scripts: Array.from({ length: 31 }, () => hat()) }, /at most 30 scripts/]
  ];

  bad.forEach(([raw, pattern]) => assert.match(engine.normalizeWorkspace(raw, maze).error || "", pattern, JSON.stringify(raw).slice(0, 80)));

  // Size and depth limits stop a request from building something huge.
  const long = program(chain(...Array.from({ length: 301 }, move)));
  assert.match(engine.normalizeWorkspace(long, maze).error, /at most 300 blocks/);
  let deep = move();
  for (let i = 0; i < 45; i += 1) {
    deep = b("repeat_times", { fields: { TIMES: 1 }, inputs: { DO: deep } });
  }
  assert.match(engine.normalizeWorkspace(program(deep), maze).error, /nested at most 40 deep/);

  // Unknown keys, ids and lock marks are dropped unless the editor asks for them.
  const extra = engine.normalizeWorkspace({ scripts: [{ type: "when_run", id: "a", locked: true, code: "alert(1)", next: { type: "move_forward", fields: { X: 1 } } }] }, maze);
  assert.deepEqual(extra.value, { scripts: [{ type: "when_run", next: { type: "move_forward" } }] });
  assert.deepEqual(engine.normalizeWorkspace(extra.value, { ...maze, keepIds: true }).value, extra.value);
});

test("the interpreter moves, senses, counts and stops safely", () => {
  const run = (first, stage = corridor, options = {}) => engine.run(program(first), stage, { world: "maze", ...options });

  assert.equal(run(chain(move(), move(), move(), move())).outcome, "passed");
  assert.equal(run(chain(move(), move())).outcome, "not-at-goal");

  const crash = run(chain(b("turn_left"), move()));
  assert.equal(crash.outcome, "crashed");
  assert.deepEqual([crash.state.x, crash.state.y], [0, 0]);

  // A loop with nothing inside, and loops inside loops, still stop.
  const empty = run(b("repeat_until", { inputs: { UNTIL: b("at_goal") } }));
  assert.equal(empty.outcome, "step-limit");
  assert.equal(empty.steps, engine.LIMITS.defaultStepLimit + 1);
  let nested = b("turn_left");
  for (let i = 0; i < 6; i += 1) {
    nested = b("repeat_times", { fields: { TIMES: 20 }, inputs: { DO: nested } });
  }
  const started = Date.now();
  assert.equal(run(nested, corridor, { stepLimit: 5000 }).outcome, "step-limit");
  assert.ok(Date.now() - started < 1000);

  // Variables, arithmetic and say. A variable called "constructor" is a number.
  const stars = { grid: ["..*.*G"], start: { x: 0, y: 0, facing: "east" }, expect: { say: "2" } };
  const counter = chain(
    b("repeat_until", { inputs: { UNTIL: b("at_goal"), DO: chain(move(), b("if_then", { inputs: { IF: b("on_star"), THEN: b("change_var", { fields: { VAR: "constructor" }, inputs: { BY: b("number", { fields: { NUM: 1 } }) } }) } })) } }),
    b("say", { inputs: { VALUE: b("get_var", { fields: { VAR: "constructor" } }) } })
  );
  const counted = run(counter, stars, { variables: ["constructor"] });
  assert.equal(counted.outcome, "passed");
  assert.equal(counted.state.said, "2");
  assert.equal(run(b("say", { inputs: { VALUE: b("arith", { fields: { OP: "×" }, inputs: { A: b("number", { fields: { NUM: 999 } }), B: b("number", { fields: { NUM: 999 } }) } }) } }), stars).state.said, "998001");

  // Empty slots: an empty condition is false, an empty number is 0.
  assert.equal(run(b("if_else", { inputs: { THEN: move(), ELSE: b("turn_left") } })).state.facing, "north");

  // Only the script under "when Run clicked" runs; two of them is no program.
  assert.equal(engine.run({ scripts: [move()] }, corridor, maze).outcome, "no-program");
  assert.equal(engine.run({ scripts: [hat(), hat()] }, corridor, maze).outcome, "no-program");

  // Frames for the animation carry the block ids.
  const frames = engine.run(program(chain({ ...move(), id: "m1" }, { type: "turn_right", id: "t1" })), corridor, { world: "maze", record: true }).frames;
  assert.deepEqual(frames.map(frame => [frame.event, frame.block, frame.x, frame.facing]), [["move", "m1", 1, "east"], ["turn", "t1", 1, "south"]]);
});

test("text and Python views read the program back", () => {
  const solution = content.get("BLK-RGS-S1-01").solution;
  assert.equal(engine.toText(solution), [
    "when Run clicked",
    "set stars to (0)",
    "repeat until <at the flag?>",
    "  move forward",
    "  if <on a star?> then",
    "    change stars by (1)",
    "say (stars)"
  ].join("\n"));
  assert.equal(engine.toPython(solution), [
    "stars = 0",
    "while not at_goal():",
    "    move_forward()",
    "    if on_star():",
    "        stars += 1",
    "say(stars)"
  ].join("\n"));
  assert.equal(engine.toPython(program(b("repeat_times", { fields: { TIMES: 3 } }))), "for _ in range(3):\n    pass");
  assert.equal(engine.toPython(program(b("if_then", { inputs: { IF: b("not", { inputs: { BOOL: b("and", { inputs: { A: b("path_ahead"), B: b("at_goal") } }) } }) } }))),
    "if not (path_ahead() and at_goal()):\n    pass");
});

test("marking keeps the given blocks where they were and allows only offered blocks", () => {
  const question = content.get("BLK-S1-01");
  const score = response => scoring.scoreResponse(question, response).result;
  const solution = question.solution;
  assert.equal(score(solution).correct, true);

  const body = solution.scripts[0].next.inputs.DO;
  const withDo = DO => ({ scripts: [hat({ type: "repeat_until", inputs: { UNTIL: b("at_goal"), DO } })] });

  // Replacing the given if/else with a hand-rolled one is refused, even
  // though it would work.
  const replaced = withDo(b("if_else", { inputs: { IF: b("path_right"), THEN: b("turn_right"), ELSE: body } }));
  const refused = score(replaced);
  assert.equal(refused.earned, 0);
  assert.match(refused.detail.rejected[0], /DO \[1\] > IF: the given "path_ahead" block is missing or was replaced/);

  // A block slotted in above a given one, which the editor cannot do.
  assert.equal(score(withDo({ ...b("turn_left"), next: body })).earned, 0);

  // Removing the given condition.
  const noCondition = JSON.parse(JSON.stringify(solution));
  delete noCondition.scripts[0].next.inputs.UNTIL;
  assert.equal(score(noCondition).earned, 0);

  // A block the question does not offer.
  const unoffered = JSON.parse(JSON.stringify(solution));
  unoffered.scripts[0].next.next = b("pick_up");
  assert.match(score(unoffered).detail.rejected[0], /"pick_up" block is not offered/);

  // Loose blocks elsewhere on the workspace are ignored.
  assert.equal(score({ scripts: solution.scripts.concat([b("pick_up"), b("turn_left")]) }).correct, true);

  // A locked field stays as given unless the block is editable.
  const stairs = content.get("BLK-P6-01");
  assert.equal(scoring.scoreResponse(stairs, stairs.solution).result.correct, true, "TIMES is editable, so 4 is allowed");
  const s1 = content.get("BLK-S2-01");
  assert.equal(scoring.scoreResponse(s1, s1.solution).result.correct, true);
});

test("partial credit is the share of stages passed, short of full marks", () => {
  const question = content.get("BLK-RGS-S1-01");
  const fixed = JSON.parse(JSON.stringify(question.solution));
  // Say 3, the example's count, instead of the variable.
  fixed.scripts[0].next.next.next.inputs.VALUE = b("number", { fields: { NUM: 3 } });

  const result = scoring.scoreResponse(question, fixed).result;
  assert.equal(result.correct, false);
  assert.equal(result.earned, Math.floor(question.points / 4));
  assert.deepEqual(result.detail.partial, { casesPassed: 1, casesTotal: 4 });
  assert.deepEqual(result.detail.outcomes, ["passed", "wrong-say", "wrong-say", "wrong-say"]);

  // Without partial marking, the same share scores 0.
  const strict = { ...question, marking: undefined };
  assert.equal(scoring.scoreResponse(strict, fixed).result.earned, 0);

  // Too many blocks fails every stage.
  const stairs = content.get("BLK-P6-01");
  const longhand = program(chain(...Array.from({ length: 4 }, () => [move(), b("turn_left"), move(), b("turn_right")]).flat().map(block => ({ ...block }))));
  const unlocked = { scripts: [hat({ type: "repeat_times", fields: { TIMES: 1 }, next: longhand.scripts[0].next })] };
  assert.equal(engine.run(unlocked, stairs.example, { world: "maze" }).outcome, "passed");
  assert.deepEqual(scoring.scoreResponse(stairs, unlocked).result.detail.outcomes, ["too-many-blocks"]);

  // Nothing, or garbage, scores 0 and is stored as no answer.
  assert.equal(scoring.scoreResponse(question, undefined).result.earned, 0);
  assert.equal(scoring.scoreResponse(question, "print('hi')").response, null);
  assert.equal(scoring.scoreResponse(question, { scripts: [{ type: "eval" }] }).recorded, null);
});

test("content validation catches broken block questions", () => {
  const good = content.get("BLK-S1-01");
  const edit = change => {
    const copy = JSON.parse(JSON.stringify(good));
    change(copy);
    return blocksType.validate(copy).join("\n");
  };

  assert.equal(edit(() => {}), "");
  assert.match(edit(q => { q.world = "space"; }), /world must be one of maze/);
  assert.match(edit(q => { q.toolbox.push("launch_rocket"); }), /toolbox block "launch_rocket" does not exist/);
  assert.match(edit(q => { q.toolbox.push("when_run"); }), /cannot be offered/);
  assert.match(edit(q => { q.toolbox.push("change_var"); }), /no variables/);
  assert.match(edit(q => { q.example.grid[0] = "..."; }), /rows must all be/);
  assert.match(edit(q => { q.example.start = { x: 3, y: 0, facing: "east" }; }), /start is on a wall/);
  assert.match(edit(q => { q.cases[0].expect = { collectAll: true }; }), /needs a star/);
  assert.match(edit(q => { q.stepLimit = 10; }), /stepLimit/);
  assert.match(edit(q => { q.marking = { partial: "lines" }; }), /marking may only be/);
  // The reference solution must pass every stage.
  assert.match(edit(q => { q.solution.scripts[0].next.inputs.DO.inputs.ELSE = b("turn_right"); }), /solution fails the example: Ran out of steps/);
  // A grid the solution cannot finish.
  assert.match(edit(q => { q.cases[0].grid[4] = "#####.#G"; }), /solution fails cases\[0\]/);
  // The starting program must leave something to do.
  assert.match(edit(q => { q.startProgram = JSON.parse(JSON.stringify(q.solution)); q.startProgram.scripts[0].locked = true; }), /already passes every stage/);
  // Given blocks must sit at the top of their stack.
  assert.match(edit(q => {
    q.startProgram.scripts[0].next.inputs.DO = { type: "turn_left", next: { type: "move_forward", locked: true } };
  }), /sits under or inside an unlocked block/);
  assert.match(edit(q => { delete q.startProgram.scripts[0].locked; }), /exactly one "when_run" script, locked/);
});

test("students get the example, the starting program and the toolbox, never the cases or the solution", () => {
  loadContent().questions.filter(question => question.type === "blocks").forEach(question => {
    const shown = scoring.toPublicQuestion(question);
    assert.equal(shown.cases, undefined, question.id);
    assert.equal(shown.solution, undefined, question.id);
    assert.equal(shown.details, undefined, question.id);
    assert.equal(shown.marking, undefined, question.id);
    assert.equal(shown.hiddenCases, (question.cases || []).length);
    assert.deepEqual(shown.example, question.example);
    assert.deepEqual(shown.startProgram, question.startProgram);
    // No stage the student is not shown appears anywhere in what they get.
    const text = JSON.stringify(shown);
    (question.cases || []).forEach(stage => {
      if (JSON.stringify(stage.grid) !== JSON.stringify(question.example.grid)) {
        assert.equal(text.includes(JSON.stringify(stage.grid)), false, `${question.id} leaks a hidden grid`);
      }
    });
  });
});

test("the page and the server run the same engine file", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;

  const served = await request(app).get("/lib/blocks-engine.js");
  assert.equal(served.status, 200);
  assert.equal(served.text, fs.readFileSync(require.resolve("../../web/lib/blocks-engine"), "utf8"));
  assert.equal(blocksType.engine, engine);

  const renderer = fs.readFileSync(path.join(__dirname, "../../web/types/blocks.js"), "utf8");
  assert.match(renderer, /loadScript\("\/lib\/blocks-engine\.js"\)/);

  // Blockly is served from web/vendor/, with its provenance header; the
  // licence text sits beside it but, like package.json, is not served.
  const blockly = await request(app).get("/vendor/blockly-13.3.0/blockly_compressed.js");
  assert.equal(blockly.status, 200);
  assert.match(blockly.text.slice(0, 800), /Blockly 13\.3\.0[\s\S]*sha512-[\s\S]*Apache-2\.0/);
  assert.equal((await request(app).get("/vendor/blockly-13.3.0/msg-en.js")).status, 200);
  for (const url of ["/lib/package.json", "/vendor/blockly-13.3.0/../../package.json"]) {
    assert.equal((await request(app).get(url)).status, 404, url);
  }
  // A path without an extension falls back to the student page, as any
  // client route does, so these never return the licence file or a listing.
  for (const url of ["/vendor/blockly-13.3.0/LICENSE", "/vendor/blockly-13.3.0/"]) {
    const res = await request(app).get(url);
    assert.doesNotMatch(res.text, /Apache License|blockly_compressed/, url);
  }
});

test("a block question attempt over HTTP, from start to the released breakdown", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const ids = ["BLK-S1-01", "BLK-RGS-S1-01"];

  const created = await request(app).post("/api/events").set(auth).send({ title: "Blocks", filter: { questionIds: ids, audiences: ["core", "rgsynapse"] } });
  assert.equal(created.status, 201);
  const joinCode = created.body.event.join_code;
  const good = await startAttempt(app, { joinCode });
  const partial = await startAttempt(app, { joinCode });

  await t.test("the start response has no cases, solution or marking", () => {
    const keys = allKeys(good);
    ["cases", "solution", "marking", "details", "answer"].forEach(key => assert.ok(!keys.has(key), `start response has "${key}"`));
    const byId = Object.fromEntries(good.questions.map(question => [question.id, question]));
    assert.equal(byId["BLK-S1-01"].hiddenCases, 3);
    assert.equal(byId["BLK-RGS-S1-01"].showPython, true);
  });

  const fixedCount = JSON.parse(JSON.stringify(content.get("BLK-RGS-S1-01").solution));
  fixedCount.scripts[0].next.next.next.inputs.VALUE = b("number", { fields: { NUM: 3 } });

  await t.test("the server marks by running the program", async () => {
    const right = await submit(app, good.attempt, {
      "BLK-S1-01": content.get("BLK-S1-01").solution,
      "BLK-RGS-S1-01": content.get("BLK-RGS-S1-01").solution
    });
    assert.equal(right.status, 200);
    assert.equal(right.body.result.score, 10);

    const some = await submit(app, partial.attempt, { "BLK-S1-01": { scripts: "nope" }, "BLK-RGS-S1-01": fixedCount });
    assert.equal(some.body.result.score, 1);
  });

  await t.test("the teacher's results carry the per-stage outcomes", async () => {
    const results = await request(app).get(`/api/events/${created.body.event.id}/results`).set(auth);
    assert.equal(results.status, 200);
    const text = JSON.stringify(results.body);
    assert.match(text, /"outcomes":\["passed","wrong-say","wrong-say","wrong-say"\]/);
  });

  await t.test("after release the breakdown shows the program, but never the solution", async () => {
    await request(app).post(`/api/events/${created.body.event.id}/release`).set(auth);
    const res = await getAttempt(app, partial.attempt);
    const rows = Object.fromEntries(res.body.result.perQuestion.map(row => [row.id, row]));

    assert.deepEqual(rows["BLK-RGS-S1-01"].response, engine.normalizeWorkspace(fixedCount, { world: "maze", variables: ["stars"] }).value);
    assert.deepEqual(rows["BLK-RGS-S1-01"].detail, { partial: { casesPassed: 1, casesTotal: 4 } });
    assert.equal(rows["BLK-RGS-S1-01"].correctResponse ?? null, null);
    assert.equal(rows["BLK-S1-01"].response, null);

    const keys = allKeys(res.body);
    ["cases", "solution", "outcomes", "rejected"].forEach(key => assert.ok(!keys.has(key), `breakdown has "${key}"`));
  });
});
