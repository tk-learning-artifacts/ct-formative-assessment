// Akmal's answer-key protection policy (review item 2): one attempt per
// student per event, teacher reset, and the per-question breakdown withheld
// until the event's end_at or a teacher release.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit, getAttempt, allKeys } = require("./helpers");
const { studentKey } = require("../src/policy");

const CORRECTNESS_KEYS = ["perQuestion", "correct", "correctResponse", "correctIndex", "earned", "detail", "answer"];

function start(app, joinCode, studentName, studentGroup) {
  return request(app).post("/api/attempts").send({ joinCode, studentName, studentGroup });
}

test("student keys normalise case, spacing and Unicode width", () => {
  const key = studentKey("Ada Tan", "S1-2");
  assert.equal(studentKey("  ADA   tan ", "s1-2"), key);
  assert.equal(studentKey("Ａｄａ\tＴａｎ", "Ｓ１-２"), key);
  assert.notEqual(studentKey("Ada Tan", "S1-3"), key);
  assert.notEqual(studentKey("Ada Tang", "S1-2"), key);
});

test("one attempt per student, teacher reset and results release", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app, store } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };
  store.createUser({ email: "other@school.test", password: "other-password-1" });
  const otherAuth = { Authorization: `Bearer ${await login(app, { email: "other@school.test", password: "other-password-1" })}` };

  const created = await request(app).post("/api/events").set(auth).send({ title: "Policy", selectionMode: "P5", joinCode: "POLICY", durationMinutes: 30 });
  const eventId = created.body.event.id;

  await t.test("a second start for the same student is refused, including name variants", async () => {
    const first = await start(app, "POLICY", "Ada Tan", "S1-2");
    assert.equal(first.status, 201);

    for (const [name, group] of [["Ada Tan", "S1-2"], ["  ada   TAN ", "s1-2"], ["Ａｄａ Ｔａｎ", "S1-2"]]) {
      const again = await start(app, "POLICY", name, group);
      assert.equal(again.status, 409, name);
      assert.equal(again.body.code, "attempt-in-progress");
      assert.equal(again.body.attemptId, first.body.attempt.id);
      assert.match(again.body.error, /device where you started|ask your teacher/);
      assert.equal(again.body.token, undefined);
    }

    assert.equal((await start(app, "POLICY", "Ada Tan", "S1-3")).status, 201);

    await submit(app, first.body.attempt, { "P5-01": 0 });
    const afterSubmit = await start(app, "POLICY", "ada tan", "S1-2");
    assert.equal(afterSubmit.status, 409);
    assert.equal(afterSubmit.body.code, "already-submitted");
    assert.equal(afterSubmit.body.attemptId, undefined);
  });

  await t.test("an expired, unsubmitted attempt asks the student to see the teacher", async () => {
    const first = await start(app, "POLICY", "Bo", "S1-2");
    store.db.prepare("UPDATE attempts SET deadline_at = ? WHERE id = ?").run(new Date(Date.now() - 60000).toISOString(), first.body.attempt.id);
    const again = await start(app, "POLICY", "Bo", "S1-2");
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "attempt-expired");
  });

  await t.test("a reset lets the student start again and is owner-only", async () => {
    const first = await start(app, "POLICY", "Cai", "S1-2");
    const attemptId = first.body.attempt.id;

    const foreign = await request(app).post(`/api/events/${eventId}/attempts/${attemptId}/reset`).set(otherAuth);
    assert.equal(foreign.status, 404);
    assert.equal((await request(app).post(`/api/events/${eventId}/attempts/${attemptId}/reset`)).status, 401);
    assert.equal((await start(app, "POLICY", "Cai", "S1-2")).status, 409);

    const reset = await request(app).post(`/api/events/${eventId}/attempts/${attemptId}/reset`).set(auth);
    assert.equal(reset.status, 200);
    assert.equal((await request(app).post(`/api/events/${eventId}/attempts/${attemptId}/reset`).set(auth)).status, 404);

    const restarted = await start(app, "POLICY", "Cai", "S1-2");
    assert.equal(restarted.status, 201);
    assert.notEqual(restarted.body.attempt.id, attemptId);

    // The reset attempt is kept, cannot be submitted, and says so on resume.
    assert.equal((await submit(app, first.body.attempt, {})).status, 409);
    assert.equal((await getAttempt(app, first.body.attempt)).body.attempt.status, "reset");

    const results = await request(app).get(`/api/events/${eventId}/results`).set(auth);
    const rows = results.body.attempts.filter(a => a.student_name === "Cai");
    assert.equal(rows.length, 2);
    assert.equal(rows.filter(a => a.reset_at).length, 1);
  });

  await t.test("no per-question correctness before release, in submit or GET, including AI detail", async () => {
    const { attempt } = await startAttempt(app, { joinCode: "POLICY", studentName: "Dara" });
    const submitted = await submit(app, attempt, { "P5-01": 1, "P5-02": 1 });
    assert.equal(submitted.status, 200);
    assert.deepEqual(Object.keys(submitted.body.result).sort(), ["breakdownReleased", "markedSoFar", "max", "pending", "score"]);

    // Simulate an answer scored later by AI, with feedback in detail_json.
    store.db.prepare("UPDATE answers SET detail_json = ? WHERE attempt_id = ? AND question_id = 'P5-01'")
      .run(JSON.stringify({ ai: "scored", criterionId: "full", feedbackCode: "correct", feedback: "Nice." }), attempt.id);

    const before = await getAttempt(app, attempt);
    assert.equal(before.body.result.breakdownReleased, false);
    const keys = allKeys(before.body.result);
    CORRECTNESS_KEYS.forEach(key => assert.ok(!keys.has(key), `GET before release has "${key}"`));
    assert.doesNotMatch(JSON.stringify(before.body), /Nice\.|criterionId|feedbackCode/);

    await request(app).post(`/api/events/${eventId}/release`).set(auth);
    const after = await getAttempt(app, attempt);
    assert.equal(after.body.result.breakdownReleased, true);
    assert.equal(after.body.result.perQuestion.length, 5);
    assert.equal(after.body.result.perQuestion[0].detail.feedback, "Nice.");
  });

  await t.test("the breakdown appears once end_at has passed, without a release", async () => {
    const endAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const ev = await request(app).post("/api/events").set(auth).send({ title: "Closes", selectionMode: "P6", joinCode: "CLOSES", endAt });
    const { attempt } = await startAttempt(app, { joinCode: "CLOSES" });
    await submit(app, attempt, { "P6-01": 0 });
    assert.equal((await getAttempt(app, attempt)).body.result.perQuestion, undefined);

    store.db.prepare("UPDATE events SET end_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), ev.body.event.id);
    const after = await getAttempt(app, attempt);
    assert.equal(after.body.result.breakdownReleased, true);
    assert.equal(after.body.result.perQuestion.length, 5);
  });

  await t.test("release is owner-only", async () => {
    assert.equal((await request(app).post(`/api/events/${eventId}/release`).set(otherAuth)).status, 404);
    assert.equal((await request(app).post(`/api/events/${eventId}/release`)).status, 401);
  });

  await t.test("a four-attempt oracle replay under one name recovers nothing", async () => {
    await request(app).post("/api/events").set(auth).send({ title: "Oracle", selectionMode: "ALL", joinCode: "ORACLE" });
    const responses = [];

    for (const guess of [0, 1, 2, 3]) {
      const started = await start(app, "ORACLE", "Eve", "S2-1");

      if (started.status !== 201) {
        responses.push(started);
        continue;
      }

      const ids = started.body.questions.map(q => q.id);
      responses.push(await submit(app, started.body.attempt, Object.fromEntries(ids.map(id => [id, guess]))));
      responses.push(await getAttempt(app, started.body.attempt));
    }

    assert.equal(responses.filter(res => res.status === 409).length, 3);
    responses.forEach(res => {
      const keys = allKeys(res.body);
      CORRECTNESS_KEYS.forEach(key => assert.ok(!keys.has(key), `oracle replay saw "${key}"`));
    });
  });
});
