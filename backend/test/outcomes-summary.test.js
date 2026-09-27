// GET /api/events/:id/outcomes-summary: aggregation against a known set of
// answers, reset and late attempts, unsubmitted attempts, and owner scoping.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit } = require("./helpers");

test("outcomes summary endpoint", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app, store } = ctx;
  const token = await login(app);
  const auth = { Authorization: `Bearer ${token}` };

  function setDeadline(attemptId, msFromNow) {
    store.db.prepare("UPDATE attempts SET deadline_at = ? WHERE id = ?")
      .run(new Date(Date.now() + msFromNow).toISOString(), attemptId);
  }

  // The five core P5 questions: P5-01..05, one point value (3) each, each
  // tagged with exactly one LO and one ontology node, split concept/practice
  // 4/2 at the top level. Correct indices come from backend/content.
  const created = await request(app)
    .post("/api/events")
    .set(auth)
    .send({ title: "P5 outcomes test", selectionMode: "P5" });
  assert.equal(created.status, 201);
  const event = created.body.event;

  const CORRECT = { "P5-01": 3, "P5-02": 1, "P5-03": 3, "P5-04": 2, "P5-05": 2 };
  // Wrong on P5-02, P5-03 and P5-05 (the practice.generalisation, concept.conditionals
  // and concept.data.representation.binary questions); correct on the rest.
  const PARTIAL = { "P5-01": 3, "P5-02": 0, "P5-03": 0, "P5-04": 2, "P5-05": 0 };

  const ada = await startAttempt(app, { joinCode: event.join_code, studentName: "Ada" });
  await submit(app, ada.attempt, CORRECT);

  const ben = await startAttempt(app, { joinCode: event.join_code, studentName: "Ben" });
  await submit(app, ben.attempt, PARTIAL);

  const cara = await startAttempt(app, { joinCode: event.join_code, studentName: "Cara" });
  setDeadline(cara.attempt.id, -5 * 60 * 1000);
  await submit(app, cara.attempt, CORRECT);

  const dan = await startAttempt(app, { joinCode: event.join_code, studentName: "Dan" });
  await submit(app, dan.attempt, CORRECT);
  const resetRes = await request(app)
    .post(`/api/events/${event.id}/attempts/${dan.attempt.id}/reset`)
    .set(auth);
  assert.equal(resetRes.status, 200);

  await startAttempt(app, { joinCode: event.join_code, studentName: "Eve" }); // never submits

  const res = await request(app).get(`/api/events/${event.id}/outcomes-summary`).set(auth);
  assert.equal(res.status, 200);

  const outcomeById = Object.fromEntries(res.body.outcomes.map(outcome => [outcome.id, outcome]));

  // Reset (Dan) and unsubmitted (Eve) attempts never count; Ada, Ben and
  // Cara (late) do, so every group sees 3 submitted attempts, 1 of them late.
  assert.equal(outcomeById["LO-SEQ-1"].questionsCovered, 1);
  assert.equal(outcomeById["LO-SEQ-1"].submittedAttempts, 3);
  assert.equal(outcomeById["LO-SEQ-1"].lateAttempts, 1);
  assert.equal(outcomeById["LO-SEQ-1"].meanPercentage, 100);
  assert.equal(outcomeById["LO-SEQ-1"].belowHalfCount, 0);
  assert.equal(typeof outcomeById["LO-SEQ-1"].statement, "string");

  assert.equal(outcomeById["LO-PAT-1"].meanPercentage, 66.7);
  assert.equal(outcomeById["LO-PAT-1"].belowHalfCount, 1);
  assert.equal(outcomeById["LO-COND-1"].meanPercentage, 66.7);
  assert.equal(outcomeById["LO-COND-1"].belowHalfCount, 1);
  assert.equal(outcomeById["LO-TRACE-1"].meanPercentage, 100);
  assert.equal(outcomeById["LO-TRACE-1"].belowHalfCount, 0);
  assert.equal(outcomeById["LO-DATA-1"].meanPercentage, 66.7);
  assert.equal(outcomeById["LO-DATA-1"].belowHalfCount, 1);

  const nodeById = Object.fromEntries(res.body.ontologyNodes.map(node => [node.id, node]));

  // Top-level rollups: "concept" covers P5-01/03/04/05 (4 questions), and Ben
  // lands on exactly 50% there, which must not count as "below 50%".
  assert.equal(nodeById["concept"].questionsCovered, 4);
  assert.equal(nodeById["concept"].meanPercentage, 83.3);
  assert.equal(nodeById["concept"].belowHalfCount, 0);
  assert.equal(nodeById["practice"].questionsCovered, 2);
  assert.equal(nodeById["practice"].meanPercentage, 83.3);
  assert.equal(nodeById["practice"].belowHalfCount, 0);
  assert.ok(!nodeById["perspective"], "perspective has no tagged questions in this event and should be omitted");

  assert.equal(nodeById["concept.sequences"].questionsCovered, 2);
  assert.equal(nodeById["concept.sequences"].meanPercentage, 100);
  assert.equal(nodeById["practice.abstracting-modularizing.generalisation"].meanPercentage, 66.7);
  assert.equal(nodeById["practice.testing-debugging.tracing"].meanPercentage, 100);

  await t.test("another teacher's outcomes summary looks like a missing event", async () => {
    store.createUser({ email: "other@school.test", password: "other-password-1" });
    const otherToken = await login(app, { email: "other@school.test", password: "other-password-1" });
    const cross = await request(app)
      .get(`/api/events/${event.id}/outcomes-summary`)
      .set({ Authorization: `Bearer ${otherToken}` });
    assert.equal(cross.status, 404);
  });

  await t.test("needs a valid token, like the other teacher routes", async () => {
    assert.equal((await request(app).get(`/api/events/${event.id}/outcomes-summary`)).status, 401);
  });
});
