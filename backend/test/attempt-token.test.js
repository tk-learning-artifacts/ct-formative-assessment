// Attempt integrity: a submission or resume needs the secret issued at start,
// missing and wrong tokens look the same, the deadline is capped by end_at,
// and late submissions are stored and flagged instead of thrown away.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit, getAttempt } = require("./helpers");
const { hashAttemptToken } = require("../src/security");

test("attempt tokens and deadlines", async t => {
  const ctx = await buildApp({ env: { SUBMIT_GRACE_SECONDS: "60" } });
  t.after(() => ctx.cleanup());
  const { app, store } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };

  function setDeadline(attemptId, msFromNow) {
    store.db.prepare("UPDATE attempts SET deadline_at = ? WHERE id = ?")
      .run(new Date(Date.now() + msFromNow).toISOString(), attemptId);
  }

  await t.test("submit or resume without a token is 401", async () => {
    const { attempt } = await startAttempt(app);
    assert.equal((await submit(app, attempt, {}, null)).status, 401);
    assert.equal((await getAttempt(app, attempt, null)).status, 401);
  });

  await t.test("a wrong token and a missing attempt get the same 404", async () => {
    const first = (await startAttempt(app)).attempt;
    const second = (await startAttempt(app)).attempt;

    const wrong = await submit(app, first, {}, "not-the-token");
    const otherToken = await submit(app, first, {}, second.token);
    const missing = await submit(app, { id: 999999 }, {}, first.token);
    const missingGet = await getAttempt(app, { id: 999999 }, first.token);

    [wrong, otherToken, missing, missingGet].forEach(res => {
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, wrong.body);
    });

    assert.equal((await submit(app, first, {}, first.token)).status, 200);
  });

  await t.test("guessing the next sequential id does not help", async () => {
    const mine = (await startAttempt(app)).attempt;
    const victim = (await startAttempt(app)).attempt;
    assert.equal(victim.id, mine.id + 1);

    assert.equal((await submit(app, { id: victim.id }, { "P5-01": 0 }, mine.token)).status, 404);
    assert.equal((await getAttempt(app, { id: victim.id }, mine.token)).status, 404);
  });

  await t.test("an attempt without a stored token gets the upgrade message, even with no token sent", async () => {
    const { attempt } = await startAttempt(app);
    store.db.prepare("UPDATE attempts SET token_hash = NULL WHERE id = ?").run(attempt.id);

    const res = await submit(app, attempt, {}, null);
    assert.equal(res.status, 403);
    assert.match(res.body.error, /start the challenge again/);
  });

  await t.test("a submitted attempt cannot be submitted again", async () => {
    const { attempt } = await startAttempt(app);
    assert.equal((await submit(app, attempt, {})).status, 200);
    assert.equal((await submit(app, attempt, {})).status, 409);
  });

  await t.test("only a hash of the token is stored", async () => {
    const { attempt } = await startAttempt(app);
    const row = store.db.prepare("SELECT token_hash FROM attempts WHERE id = ?").get(attempt.id);
    assert.equal(row.token_hash, hashAttemptToken(attempt.token));
    assert.notEqual(row.token_hash, attempt.token);
  });

  await t.test("resume after a refresh returns the questions and the deadline", async () => {
    const started = await startAttempt(app);
    const res = await getAttempt(app, started.attempt);

    assert.equal(res.status, 200);
    assert.equal(res.body.attempt.status, "started");
    assert.equal(res.body.attempt.deadlineAt, started.attempt.deadlineAt);
    assert.deepEqual(res.body.questions.map(q => q.id), started.questions.map(q => q.id));
    assert.equal(res.body.result, null);
  });

  await t.test("a submission inside the grace window counts as on time", async () => {
    const { attempt } = await startAttempt(app);
    setDeadline(attempt.id, -30 * 1000);
    const res = await submit(app, attempt, { "P5-01": 3 });
    assert.equal(res.status, 200);
    assert.equal(res.body.attempt.late, false);
  });

  await t.test("a submission after the grace window is stored and flagged late", async () => {
    const { attempt } = await startAttempt(app, { studentName: "Late Lin" });
    setDeadline(attempt.id, -5 * 60 * 1000);

    const res = await submit(app, attempt, { "P5-01": 3 });
    assert.equal(res.status, 200);
    assert.equal(res.body.attempt.late, true);
    assert.equal(res.body.result.score, 3);

    const row = store.db.prepare("SELECT late, status FROM attempts WHERE id = ?").get(attempt.id);
    assert.deepEqual(row, { late: 1, status: "submitted" });

    const demo = store.getEventByJoinCode("DEMO123");
    const results = await request(app).get(`/api/events/${demo.id}/results`).set(auth);
    assert.equal(results.body.attempts.find(a => a.student_name === "Late Lin").late, true);
  });

  await t.test("the deadline is the earlier of start + duration and the event's end_at", async () => {
    const endAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const capped = await request(app).post("/api/events").set(auth)
      .send({ title: "Ends soon", selectionMode: "P5", joinCode: "ENDSOON", durationMinutes: 45, endAt });
    assert.equal(capped.status, 201);
    assert.equal((await startAttempt(app, { joinCode: "ENDSOON" })).attempt.deadlineAt, endAt);

    const endOnly = await request(app).post("/api/events").set(auth)
      .send({ title: "End only", selectionMode: "P5", joinCode: "ENDONLY", endAt });
    assert.equal(endOnly.status, 201);
    assert.equal((await startAttempt(app, { joinCode: "ENDONLY" })).attempt.deadlineAt, endAt);

    const untimed = await request(app).post("/api/events").set(auth)
      .send({ title: "Untimed", selectionMode: "P5", joinCode: "UNTIMED" });
    assert.equal(untimed.status, 201);
    const started = await startAttempt(app, { joinCode: "UNTIMED" });
    assert.equal(started.attempt.deadlineAt, null);
    assert.equal((await submit(app, started.attempt, {})).status, 200);
  });
});
