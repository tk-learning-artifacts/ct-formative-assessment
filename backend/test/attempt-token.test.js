// Attempt integrity: a submission needs the secret issued at start, and the
// deadline allows a short grace window instead of discarding late answers.

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildApp, startAttempt, submit } = require("./helpers");
const { hashAttemptToken } = require("../src/security");

test("attempt tokens and deadlines", async t => {
  const ctx = await buildApp({ env: { SUBMIT_GRACE_SECONDS: "60" } });
  t.after(() => ctx.cleanup());
  const { app, store } = ctx;

  function setDeadline(attemptId, msFromNow) {
    store.db.prepare("UPDATE attempts SET deadline_at = ? WHERE id = ?")
      .run(new Date(Date.now() + msFromNow).toISOString(), attemptId);
  }

  await t.test("submit without a token is 401", async () => {
    const { attempt } = await startAttempt(app);
    const res = await submit(app, attempt, {}, null);
    assert.equal(res.status, 401);
  });

  await t.test("a wrong token, or another attempt's token, is 403", async () => {
    const first = (await startAttempt(app)).attempt;
    const second = (await startAttempt(app)).attempt;

    assert.equal((await submit(app, first, {}, "not-the-token")).status, 403);
    assert.equal((await submit(app, first, {}, second.token)).status, 403);
    assert.equal((await submit(app, first, {}, first.token)).status, 200);
  });

  await t.test("guessing the next sequential id does not help", async () => {
    const mine = (await startAttempt(app)).attempt;
    const victim = (await startAttempt(app)).attempt;
    assert.equal(victim.id, mine.id + 1);

    const res = await submit(app, { id: victim.id }, { "P5-01": 0 }, mine.token);
    assert.equal(res.status, 403);
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

  await t.test("a submission inside the grace window is accepted and marked late", async () => {
    const { attempt } = await startAttempt(app);
    setDeadline(attempt.id, -30 * 1000);
    const res = await submit(app, attempt, { "P5-01": 3 });
    assert.equal(res.status, 200);
    assert.equal(res.body.attempt.late, true);
    assert.equal(res.body.result.score, 3);
  });

  await t.test("a submission after the grace window is refused with 410", async () => {
    const { attempt } = await startAttempt(app);
    setDeadline(attempt.id, -5 * 60 * 1000);
    assert.equal((await submit(app, attempt, {})).status, 410);
  });

  await t.test("an event without a time limit has no deadline", async () => {
    const eventId = store.createEventWithQuestions({ title: "Untimed", joinCode: "UNTIMED", selectionMode: "P5", createdBy: 1 });
    assert.ok(eventId);
    const started = await startAttempt(app, { joinCode: "UNTIMED" });
    assert.equal(started.attempt.deadlineAt, null);
    assert.equal((await submit(app, started.attempt, {})).status, 200);
  });
});
