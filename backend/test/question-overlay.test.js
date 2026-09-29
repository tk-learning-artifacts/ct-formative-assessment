// The question bank overlay: teachers flag, comment on, edit and retire
// questions, and the edits are layered over backend/content/questions/*.json
// without ever writing to it. See src/overlay.js.
//
// The app is built with the demo teacher's credentials passed explicitly, so
// these tests do not depend on SEED_TEACHER_* being unset in the shell (the
// seeded first account is an admin, ADR 0004).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit, allKeys, DEMO_TEACHER } = require("./helpers");
const { openDatabase } = require("../src/db");
const { applyOverride } = require("../src/overlay");
const selection = require("../src/selection");
const presets = require("../src/presets");

const CONTENT_DIR = path.join(__dirname, "../content");
const TEACHER = { email: "reviewer@school.test", password: "reviewer-password-1" };
const ANSWER_KEYS = ["answer", "answerIndex", "correctIndex", "correct_index", "accepted", "rubric", "solution", "details"];

// A hash of every file under backend/content/, to show the app never writes it.
function contentHash() {
  const hash = crypto.createHash("sha256");
  const walk = dir => fs.readdirSync(dir).sort().forEach(name => {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      walk(full);
    } else {
      hash.update(full).update(fs.readFileSync(full));
    }
  });
  walk(CONTENT_DIR);
  return hash.digest("hex");
}

const auth = token => ({ Authorization: `Bearer ${token}` });

async function setup(t) {
  const ctx = await buildApp({ env: { SEED_TEACHER_EMAIL: DEMO_TEACHER.email, SEED_TEACHER_PASSWORD: DEMO_TEACHER.password } });
  t.after(() => ctx.cleanup());
  ctx.store.createUser(TEACHER);
  ctx.admin = await login(ctx.app);
  ctx.teacher = await login(ctx.app, TEACHER);
  ctx.get = url => request(ctx.app).get(url);
  ctx.send = (method, url, token, body) => request(ctx.app)[method](url).set(auth(token)).send(body || {});
  ctx.entry = async id => {
    const res = await ctx.send("get", "/api/question-bank", ctx.teacher);
    assert.equal(res.status, 200);
    return res.body.questions.find(item => item.teacher.id === id);
  };
  return ctx;
}

function makeEvent(ctx, joinCode, filter) {
  return ctx.send("post", "/api/events", ctx.admin, { title: `Overlay ${joinCode}`, joinCode, filter });
}

test("applyOverride lays the non-null fields over a question without changing it", () => {
  const question = { id: "Q1", level: "P5", points: 3, topic: "Loops", qType: "Trace", difficulty: 2, ontology: ["a"], outcomes: ["o"], details: "note", title: "T" };
  const row = { level: null, points: 5, topic: null, q_type: "Explain", difficulty: null, ontology_json: '["b","c"]', outcomes_json: null, details: null };
  const merged = applyOverride(question, row);

  assert.deepEqual(merged, { ...question, points: 5, qType: "Explain", ontology: ["b", "c"] });
  assert.equal(question.points, 3);
  assert.deepEqual(applyOverride(question, null), question);
});

test("the bank lists merged questions with their original values, overlay and comments", async t => {
  const ctx = await setup(t);
  const before = await ctx.entry("P5-02");
  assert.equal(before.overlay, null);
  assert.deepEqual(before.comments, []);
  assert.equal(before.teacher.points, 3);
  assert.equal(before.public.points, 3);

  const patched = await ctx.send("patch", "/api/question-bank/P5-02", ctx.admin, {
    points: 5,
    difficulty: 3,
    topic: "Number patterns",
    qType: "Spot the rule",
    details: "Look for the constant difference.",
    outcomes: ["LO-PAT-1", "LO-SEQ-1"],
    level: "P6"
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));

  const after = await ctx.entry("P5-02");
  assert.equal(after.teacher.points, 5);
  assert.equal(after.teacher.level, "P6");
  assert.equal(after.teacher.qType, "Spot the rule");
  assert.deepEqual(after.teacher.outcomes, ["LO-PAT-1", "LO-SEQ-1"]);
  assert.equal(after.public.points, 5);
  assert.equal(after.public.topic, "Number patterns");
  assert.equal(after.overlay.points, 5);
  assert.equal(after.overlay.updatedBy, DEMO_TEACHER.email);
  assert.equal(after.overlay.retired, false);
  assert.equal(after.original.points, 3);
  assert.equal(after.original.level, "P5");
  assert.equal(after.original.details, before.teacher.details === undefined ? null : before.teacher.details);

  // The SQL columns and tag tables follow, so selection filters see them.
  const row = ctx.store.db.prepare("SELECT level, points, difficulty FROM bank_questions WHERE id = 'P5-02'").get();
  assert.deepEqual({ ...row }, { level: "P6", points: 5, difficulty: 3 });
  const outcomes = ctx.store.db.prepare("SELECT outcome_id FROM question_outcomes WHERE question_id = 'P5-02' ORDER BY outcome_id").all().map(item => item.outcome_id);
  assert.deepEqual(outcomes, ["LO-PAT-1", "LO-SEQ-1"]);
  assert.ok(ctx.store.previewQuestions({ audiences: ["core"], levels: ["P6"], questionIds: ["P5-02"] }).length === 1);
  assert.equal(ctx.store.previewQuestions({ audiences: ["core"], levels: ["P5"], questionIds: ["P5-02"] }).length, 0);

  // null clears one field; the rest stay.
  const cleared = await ctx.send("patch", "/api/question-bank/P5-02", ctx.admin, { points: null });
  assert.equal(cleared.status, 200);
  const reverted = await ctx.entry("P5-02");
  assert.equal(reverted.teacher.points, 3);
  assert.equal(reverted.overlay.points, null);
  assert.equal(reverted.teacher.level, "P6");

  const audit = ctx.store.db.prepare("SELECT field, old_value, new_value FROM question_override_changes WHERE question_id = 'P5-02' AND field = 'points' ORDER BY id").all();
  assert.deepEqual(audit.map(item => ({ ...item })), [
    { field: "points", old_value: null, new_value: "5" },
    { field: "points", old_value: "5", new_value: null }
  ]);
});

test("an invalid override is refused with 400 and the list of errors, and nothing is stored", async t => {
  const ctx = await setup(t);
  const bad = [
    { points: 0 },
    { points: 2.5 },
    { difficulty: 9 },
    { outcomes: ["LO-DOES-NOT-EXIST"] },
    { ontology: ["concept.nope"] },
    { ontology: [] },
    { level: "S2" },
    { level: "P7" },
    { topic: "" },
    { points: "many" },
    { colour: "red" },
    {}
  ];

  for (const body of bad) {
    const res = await ctx.send("patch", "/api/question-bank/P5-02", ctx.admin, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(Array.isArray(res.body.errors) && res.body.errors.length, JSON.stringify(body));
  }

  assert.equal((await ctx.send("patch", "/api/question-bank/P5-02", ctx.admin, "nope")).status, 400);
  assert.equal((await ctx.send("patch", "/api/question-bank/NO-SUCH-QUESTION", ctx.admin, { points: 2 })).status, 404);
  assert.equal(ctx.store.db.prepare("SELECT COUNT(*) AS n FROM question_overrides").get().n, 0);
  assert.equal(ctx.store.db.prepare("SELECT COUNT(*) AS n FROM question_override_changes").get().n, 0);
  assert.equal((await ctx.entry("P5-02")).teacher.points, 3);
});

test("an edit reaches only events created afterwards", async t => {
  const ctx = await setup(t);
  const filter = { audiences: ["core"], questionIds: ["P5-01"] };
  const first = await makeEvent(ctx, "OVLA1", filter);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const { attempt } = await startAttempt(ctx.app, { joinCode: "OVLA1" });
  const submitted = await submit(ctx.app, attempt, { "P5-01": 0 });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));

  const maxPoints = () => ctx.store.db.prepare("SELECT max_points FROM answers WHERE attempt_id = ? AND question_id = 'P5-01'").get(attempt.id).max_points;
  const snapshotPoints = eventId => JSON.parse(ctx.store.db.prepare("SELECT question_json FROM event_questions WHERE event_id = ? AND question_id = 'P5-01'").get(eventId).question_json).points;
  assert.equal(maxPoints(), 3);
  assert.equal(snapshotPoints(first.body.event.id), 3);

  const patched = await ctx.send("patch", "/api/question-bank/P5-01", ctx.admin, { points: 8 });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));

  assert.equal(snapshotPoints(first.body.event.id), 3, "the existing event's copy is unchanged");
  assert.equal(maxPoints(), 3, "the existing attempt's max_points is unchanged");

  const second = await makeEvent(ctx, "OVLA2", filter);
  assert.equal(second.status, 201);
  assert.equal(snapshotPoints(second.body.event.id), 8, "a new event gets the new value");
});

test("a retired question is left out of previews, presets and events, even when named by id", async t => {
  const ctx = await setup(t);
  const { store } = ctx;
  const coreCheck = store.content.presets.find(preset => preset.id === "core-ct-check");
  const presetIds = () => {
    const resolved = selection.resolveSelection({ preset: presets.defaultChoice(coreCheck, store.content) }, store.content);
    return store.previewQuestions(resolved.filter).map(question => question.id);
  };
  assert.ok(presetIds().includes("P5-02"));

  assert.equal((await ctx.send("post", "/api/question-bank/P5-02/retire", ctx.admin)).status, 200);

  const byFilter = await ctx.send("post", "/api/question-bank/preview", ctx.teacher, { filter: { audiences: ["core"], levels: ["P5"], types: ["mcq"] } });
  assert.equal(byFilter.status, 200);
  assert.ok(!byFilter.body.questions.some(question => question.id === "P5-02"));
  const byId = await ctx.send("post", "/api/question-bank/preview", ctx.teacher, { filter: { audiences: ["core"], questionIds: ["P5-01", "P5-02"] } });
  assert.deepEqual(byId.body.questions.map(question => question.id), ["P5-01"]);
  const named = await ctx.send("post", "/api/question-bank/preview", ctx.teacher, { filter: { audiences: ["core"], questionIds: ["P5-02"] }, include: "questions" });
  assert.equal(named.body.count, 0);

  assert.ok(!presetIds().includes("P5-02"));
  const cards = await ctx.send("get", "/api/presets", ctx.teacher);
  assert.equal(cards.body.presets.find(preset => preset.id === "core-ct-check").count, presetIds().length);

  const eventById = await makeEvent(ctx, "OVLR1", { audiences: ["core"], questionIds: ["P5-01", "P5-02"] });
  assert.equal(eventById.status, 201);
  const questions = store.db.prepare("SELECT question_id FROM event_questions WHERE event_id = ?").all(eventById.body.event.id).map(row => row.question_id);
  assert.deepEqual(questions, ["P5-01"]);
  assert.equal((await makeEvent(ctx, "OVLR2", { audiences: ["core"], questionIds: ["P5-02"] })).status, 400);
  const legacy = await ctx.send("post", "/api/events", ctx.teacher, { title: "Legacy", selectionMode: "ALL" });
  assert.equal(legacy.status, 201);
  assert.ok(!store.db.prepare("SELECT question_id FROM event_questions WHERE event_id = ?").all(legacy.body.event.id).some(row => row.question_id === "P5-02"));

  // The bank still shows it, marked retired, and restoring brings it back.
  const retired = await ctx.entry("P5-02");
  assert.equal(retired.overlay.retired, true);
  assert.equal(retired.overlay.retiredBy, DEMO_TEACHER.email);
  assert.equal((await ctx.send("post", "/api/question-bank/P5-02/restore", ctx.admin)).status, 200);
  assert.ok(presetIds().includes("P5-02"));
  assert.equal((await ctx.entry("P5-02")).overlay.retired, false);
});

test("retiring a question that would leave a preset with none is refused", async t => {
  const ctx = await setup(t);
  const { store } = ctx;
  // "ordering-tracing" matches exactly TS-CT-01 and TS-PA-01 by default.
  assert.equal((await ctx.send("post", "/api/question-bank/TS-CT-01/retire", ctx.admin)).status, 200);

  const refused = await ctx.send("post", "/api/question-bank/TS-PA-01/retire", ctx.admin);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Code ordering and tracing practice/);
  assert.equal(store.db.prepare("SELECT retired FROM bank_questions WHERE id = 'TS-PA-01'").get().retired, 0);
  assert.equal((await ctx.entry("TS-PA-01")).overlay, null);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM question_override_changes WHERE question_id = 'TS-PA-01'").get().n, 0);

  // A database with that state still boots.
  const { dbPath } = ctx;
  ctx.close();
  const reopened = openDatabase({ dbPath, seedTeacher: null });
  assert.equal(reopened.db.prepare("SELECT retired FROM bank_questions WHERE id = 'TS-CT-01'").get().retired, 1);
  reopened.close();
});

test("teachers may flag and comment; editing and retiring is for admins", async t => {
  const ctx = await setup(t);

  for (const [method, url, body] of [
    ["patch", "/api/question-bank/P5-02", { points: 4 }],
    ["post", "/api/question-bank/P5-02/retire", {}],
    ["post", "/api/question-bank/P5-02/restore", {}]
  ]) {
    const res = await ctx.send(method, url, ctx.teacher, body);
    assert.equal(res.status, 403, `${method} ${url}`);
  }
  assert.equal((await request(ctx.app).get("/api/question-bank")).status, 401);
  assert.equal((await request(ctx.app).post("/api/question-bank/P5-02/flag").send({})).status, 401);
  assert.equal((await ctx.entry("P5-02")).overlay, null);

  const flagged = await ctx.send("post", "/api/question-bank/P5-02/flag", ctx.teacher, { note: "Option B is also correct" });
  assert.equal(flagged.status, 200);
  assert.equal(flagged.body.question.overlay.flagged, true);
  assert.equal(flagged.body.question.overlay.flagNote, "Option B is also correct");
  assert.equal(flagged.body.question.overlay.flaggedBy, TEACHER.email);

  const commented = await ctx.send("post", "/api/question-bank/P5-02/comments", ctx.teacher, { body: "Checked with the S1 team." });
  assert.equal(commented.status, 200);
  await ctx.send("post", "/api/question-bank/P5-02/comments", ctx.admin, { body: "Agreed." });
  assert.equal((await ctx.send("post", "/api/question-bank/P5-02/comments", ctx.teacher, { body: "  " })).status, 400);

  const entry = await ctx.entry("P5-02");
  assert.deepEqual(entry.comments.map(comment => [comment.author, comment.body]), [[TEACHER.email, "Checked with the S1 team."], [DEMO_TEACHER.email, "Agreed."]]);

  const unflagged = await ctx.send("delete", "/api/question-bank/P5-02/flag", ctx.teacher);
  assert.equal(unflagged.status, 200);
  assert.equal(unflagged.body.question.overlay.flagged, false);
  assert.equal(unflagged.body.question.comments.length, 2, "comments outlive the flag");
  assert.equal((await ctx.send("post", "/api/question-bank/NO-SUCH/flag", ctx.teacher)).status, 404);

  const audit = ctx.store.db.prepare("SELECT field, changed_by FROM question_override_changes WHERE question_id = 'P5-02' ORDER BY id").all();
  assert.deepEqual(audit.map(item => item.field), ["flag", "comment", "comment", "flag"]);
});

test("the public field of every bank entry has no answer keys, even after edits", async t => {
  const ctx = await setup(t);
  const mcq = await ctx.send("patch", "/api/question-bank/P5-02", ctx.admin, { details: "The method is the answer." });
  assert.equal(mcq.status, 200);
  await ctx.send("patch", "/api/question-bank/AIS-S1-01", ctx.admin, { details: "Indentation is the answer." });

  const res = await ctx.send("get", "/api/question-bank", ctx.teacher);
  assert.ok(res.body.questions.length >= 60);
  res.body.questions.forEach(entry => {
    const keys = allKeys(entry.public);
    ANSWER_KEYS.forEach(key => assert.ok(!keys.has(key), `${entry.teacher.id} public has "${key}"`));
  });

  const edited = res.body.questions.find(entry => entry.teacher.id === "P5-02");
  assert.equal(edited.teacher.details, "The method is the answer.");
  assert.ok(!JSON.stringify(edited.public).includes("The method is the answer."));
  assert.ok(allKeys(edited.teacher).has("answer") || allKeys(edited.teacher).has("answerIndex") || allKeys(edited.teacher).has("options"), "the teacher view keeps the key");
});

test("overrides survive a restart, and one the JSON has made invalid is skipped, not fatal", async t => {
  const ctx = await setup(t);
  assert.equal((await ctx.send("patch", "/api/question-bank/P5-02", ctx.admin, { points: 6 })).status, 200);
  // What a later edit to the JSON could leave behind: an outcome that no
  // longer exists, written straight into the table.
  ctx.store.db.prepare("INSERT INTO question_overrides (question_id, outcomes_json, points, updated_at) VALUES ('P5-01', '[\"LO-GONE\"]', 9, 'now')").run();
  const { dbPath } = ctx;
  ctx.close();

  const logs = [];
  const reopened = openDatabase({ dbPath, seedTeacher: null, log: message => logs.push(message) });
  t.after(() => reopened.close());
  const stored = id => JSON.parse(reopened.db.prepare("SELECT question_json FROM bank_questions WHERE id = ?").get(id).question_json);

  assert.equal(stored("P5-02").points, 6);
  assert.equal(stored("P5-01").points, 3, "the stale override is not applied");
  assert.deepEqual(stored("P5-01").outcomes, ["LO-SEQ-1"]);
  assert.ok(logs.some(message => message.includes("P5-01") && message.includes("LO-GONE")), logs.join("\n"));

  const entry = reopened.bank.getBankEntry("P5-01");
  assert.ok(entry.overlay.stale.length);
  assert.equal(reopened.bank.getBankEntry("P5-02").overlay.stale, null);
});

test("nothing the overlay does writes to backend/content", async t => {
  const before = contentHash();
  const ctx = await setup(t);

  await ctx.send("patch", "/api/question-bank/P5-02", ctx.admin, { points: 4, topic: "Changed", details: "x" });
  await ctx.send("post", "/api/question-bank/P5-01/retire", ctx.admin);
  await ctx.send("post", "/api/question-bank/P5-01/restore", ctx.admin);
  await ctx.send("post", "/api/question-bank/P5-03/flag", ctx.teacher, { note: "n" });
  await ctx.send("post", "/api/question-bank/P5-03/comments", ctx.teacher, { body: "c" });
  await ctx.send("patch", "/api/question-bank/P5-02", ctx.admin, { points: null, topic: null });

  assert.equal(contentHash(), before);
});

test("a retirement that empties a preset after a content change is logged at boot, not fatal", async t => {
  const ctx = await setup(t);
  assert.equal((await ctx.send("post", "/api/question-bank/TS-CT-01/retire", ctx.admin)).status, 200);
  // The state a later edit to presets.json could leave behind, written past the API guard.
  ctx.store.db.prepare("INSERT INTO question_overrides (question_id, retired_at, retired_by, updated_at) VALUES ('TS-PA-01', 'now', NULL, 'now')").run();
  const { dbPath } = ctx;
  ctx.close();

  const logs = [];
  const reopened = openDatabase({ dbPath, seedTeacher: null, log: message => logs.push(message) });
  t.after(() => reopened.close());
  assert.ok(logs.some(message => message.includes("ordering-tracing") && message.includes("TS-PA-01")), logs.join("\n"));
});

test("edited values are capped: points, string lengths and list sizes", async t => {
  const ctx = await setup(t);
  const patch = body => ctx.send("patch", "/api/question-bank/P5-02", ctx.admin, body);

  assert.equal((await patch({ points: 1e300 })).status, 400);
  assert.equal((await patch({ points: 101 })).status, 400);
  assert.equal((await patch({ details: "x".repeat(5001) })).status, 400);
  assert.equal((await patch({ topic: "x".repeat(101) })).status, 400);
  assert.equal((await patch({ outcomes: Array.from({ length: 51 }, () => "LO-SEQ-1") })).status, 400);
  assert.equal((await ctx.entry("P5-02")).overlay, null);
});

test("the picker's question counts leave retired questions out", async t => {
  const ctx = await setup(t);
  const count = async () => {
    const res = await ctx.send("get", "/api/outcomes", ctx.teacher);
    assert.equal(res.status, 200);
    return res.body.outcomes.reduce((sum, outcome) => sum + outcome.questionCount, 0);
  };
  const before = await count();
  assert.equal((await ctx.send("post", "/api/question-bank/P5-02/retire", ctx.admin)).status, 200);
  assert.ok(await count() < before);
});
