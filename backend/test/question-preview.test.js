// Teacher-only question previews: full content, answer key included, for the
// compact question preview in admin.html. Two endpoints:
//   POST /api/question-bank/preview with { include: "questions" }
//   GET  /api/events/:id/questions (the event's frozen snapshot)
// Both go through the same selection path as the plain summary preview and
// event creation (selection.selectQuestions / db.previewQuestions /
// db.getEventQuestions), so counts and order always match what
// POST /api/events freezes into event_questions. Access to the second
// endpoint is covered in full by admin-role.test.js's EVENT_ROUTES matrix
// ("GET questions"); this file checks the content each endpoint returns.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, getAttempt, allKeys } = require("./helpers");
const scoring = require("../src/scoring");

// One question per active type, across both audiences, so every type's
// answer-key shape is exercised: mcq (P5-01), code-trace (TS-CT-01),
// parsons with distractors and partial credit (TS-PA-02), open-response-ai
// (AIS-S1-01). Naming them all in questionIds opts the AI one in.
const FILTER = { audiences: ["core", "rgsynapse"], questionIds: ["P5-01", "TS-CT-01", "TS-PA-02", "AIS-S1-01"] };

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

test("POST /api/question-bank/preview: include: \"questions\" returns full teacher views", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;
  const token = await login(app);

  await t.test("requires auth, like the plain preview", async () => {
    const res = await request(app).post("/api/question-bank/preview").send({ filter: FILTER, include: "questions" });
    assert.equal(res.status, 401);
  });

  await t.test("an unsupported include value is a 400", async () => {
    const res = await request(app).post("/api/question-bank/preview").set(auth(token)).send({ filter: FILTER, include: "everything" });
    assert.equal(res.status, 400);
  });

  await t.test("same count and order as the summary preview, with the answer key filled in per type", async () => {
    const summary = await request(app).post("/api/question-bank/preview").set(auth(token)).send({ filter: FILTER });
    const full = await request(app).post("/api/question-bank/preview").set(auth(token)).send({ filter: FILTER, include: "questions" });

    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.equal(full.status, 200, JSON.stringify(full.body));
    assert.equal(full.body.count, summary.body.count);
    assert.equal(full.body.count, 4);
    assert.deepEqual(full.body.questions.map(q => q.id), summary.body.questions.map(q => q.id));

    const byId = Object.fromEntries(full.body.questions.map(q => [q.id, q]));

    assert.ok(Array.isArray(byId["P5-01"].options), "mcq options");
    assert.equal(typeof byId["P5-01"].answer.index, "number", "mcq answer.index");

    assert.equal(byId["TS-CT-01"].answer.output, "2\n4\n8\n16");
    assert.match(byId["TS-CT-01"].details, /doubles before the first print/);

    assert.deepEqual(byId["TS-PA-02"].answer.order, ["list", "zero", "loop", "test", "add", "print"]);
    assert.deepEqual(byId["TS-PA-02"].answer.alternatives, [["zero", "list", "loop", "test", "add", "print"]]);
    // The distractors: lines in the question but not in the correct order.
    // Content ids, not the opaque shuffled ids a student is shown.
    const distractors = byId["TS-PA-02"].lines.filter(line => !byId["TS-PA-02"].answer.order.includes(line.id));
    assert.deepEqual(distractors.map(line => line.id).sort(), ["count", "odd"]);
    assert.equal(byId["TS-PA-02"].marking.partial, "longest-run");

    assert.ok(Array.isArray(byId["AIS-S1-01"].rubric) && byId["AIS-S1-01"].rubric.length >= 2, "AI rubric");
    assert.ok(byId["AIS-S1-01"].rubric.some(criterion => criterion.points === byId["AIS-S1-01"].points));
  });

  await t.test("the same filter's preview count equals the event it creates, with and without include", async () => {
    const full = await request(app).post("/api/question-bank/preview").set(auth(token)).send({ filter: FILTER, include: "questions" });
    const created = await request(app).post("/api/events").set(auth(token)).send({ title: "Parity check", filter: FILTER });

    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.event.question_count, full.body.count);
    assert.deepEqual(
      ctx.store.getEventQuestions(created.body.event.id).map(q => q.id),
      full.body.questions.map(q => q.id)
    );
  });

  // The teacher page's create-event form opens on a quick setup card, so
  // { preset, include: "questions" } is the toggle's actual default path;
  // everything above only exercises { filter, include }.
  await t.test("a preset with include: \"questions\" matches the plain preset preview", async () => {
    const choice = { id: "core-ct-check" };
    const summary = await request(app).post("/api/question-bank/preview").set(auth(token)).send({ preset: choice });
    const full = await request(app).post("/api/question-bank/preview").set(auth(token)).send({ preset: choice, include: "questions" });

    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.equal(full.status, 200, JSON.stringify(full.body));
    assert.equal(full.body.count, summary.body.count);
    assert.ok(full.body.count > 0);
    assert.deepEqual(full.body.questions.map(q => q.id), summary.body.questions.map(q => q.id));

    const created = await request(app).post("/api/events").set(auth(token)).send({ title: "Preset parity check", preset: choice });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.event.question_count, full.body.count);
  });
});

test("GET /api/events/:id/questions: the frozen snapshot as full teacher views", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app, store } = ctx;
  const token = await login(app);

  const created = await request(app).post("/api/events").set(auth(token)).send({ title: "Snapshot check", filter: FILTER });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const eventId = created.body.event.id;

  await t.test("requires auth", async () => {
    const res = await request(app).get(`/api/events/${eventId}/questions`);
    assert.equal(res.status, 401);
  });

  await t.test("returns exactly toTeacherQuestion of the stored snapshot, in snapshot order", async () => {
    const res = await request(app).get(`/api/events/${eventId}/questions`).set(auth(token));
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const expected = store.getEventQuestions(eventId).map(scoring.toTeacherQuestion);
    assert.deepEqual(res.body.questions, expected);
    assert.equal(res.body.questions.length, 4);
  });

  await t.test("a Parsons snapshot keeps its content line ids, not a student's opaque shuffled ones", async () => {
    const res = await request(app).get(`/api/events/${eventId}/questions`).set(auth(token));
    const parsons = res.body.questions.find(q => q.type === "parsons");
    assert.deepEqual(parsons.lines.map(line => line.id).sort(), ["add", "count", "list", "loop", "odd", "print", "test", "zero"]);
  });

  await t.test("an attempt token is not a teacher credential", async () => {
    const attempt = await startAttempt(app, { joinCode: created.body.event.join_code });

    const preview = await request(app).post("/api/question-bank/preview")
      .set("X-Attempt-Token", attempt.attempt.token)
      .send({ filter: FILTER, include: "questions" });
    assert.equal(preview.status, 401);

    const questions = await request(app).get(`/api/events/${eventId}/questions`)
      .set("X-Attempt-Token", attempt.attempt.token);
    assert.equal(questions.status, 401);
  });
});

// The point of these two teacher-only endpoints is that they show a teacher
// what a student does not. This proves the student-facing routes these
// endpoints sit beside are untouched: still exactly toPublicQuestion, with
// none of the fields the teacher view adds.
test("student routes carry no more than they did before: exactly toPublicQuestion, nothing a teacher view adds", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;
  const token = await login(app);

  const created = await request(app).post("/api/events").set(auth(token)).send({ title: "No-leak check", filter: FILTER });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const snapshot = ctx.store.getEventQuestions(created.body.event.id);
  const expectedPublic = snapshot.map(scoring.toPublicQuestion);

  const started = await startAttempt(app, { joinCode: created.body.event.join_code });
  assert.deepEqual(started.questions, expectedPublic, "start returns exactly toPublicQuestion, in snapshot order");

  const resumed = await getAttempt(app, started.attempt);
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.deepEqual(resumed.body.questions, expectedPublic, "resume returns the same");

  const leaked = new Set();
  ["answer", "details", "rubric", "marking", "alternatives"].forEach(field => {
    if (allKeys(started.questions).has(field)) leaked.add(`start:${field}`);
    if (allKeys(resumed.body.questions).has(field)) leaked.add(`resume:${field}`);
  });
  assert.deepEqual(Array.from(leaked), [], "no teacher-only field reaches a student route");
});
