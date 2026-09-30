// GET /api/events/:id/outcomes-summary: aggregation against a known set of
// answers, reset and late attempts, unsubmitted attempts, and owner scoping.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit } = require("./helpers");
const { buildOutcomesSummary } = require("../src/outcomes-summary");

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

  // The per-question and per-attempt fields follow the same rules: Dan
  // (reset) and Eve (not submitted) are absent, Cara (late) is present.
  const attemptIds = res.body.perAttempt.map(row => row.attemptId).sort();
  assert.deepEqual(attemptIds, [ada.attempt.id, ben.attempt.id, cara.attempt.id].sort());
  const perAttempt = Object.fromEntries(res.body.perAttempt.map(row => [row.attemptId, row]));
  assert.equal(perAttempt[ada.attempt.id].percentage, 100);
  assert.equal(perAttempt[ben.attempt.id].percentage, 40);
  assert.equal(perAttempt[ben.attempt.id].outcomes.find(row => row.id === "LO-PAT-1").percentage, 0);
  assert.equal(perAttempt[ben.attempt.id].nodes.find(row => row.id === "concept").percentage, 50);
  assert.equal(res.body.overall.meanPercentage, 80);
  assert.equal(res.body.overall.belowHalfCount, 1);
  assert.deepEqual(res.body.questions.map(row => row.id), ["P5-01", "P5-02", "P5-03", "P5-04", "P5-05"]);
  const p502 = res.body.questions.find(row => row.id === "P5-02");
  assert.equal(p502.submittedAttempts, 3);
  assert.equal(p502.fullMarks, 2);
  assert.equal(p502.percentage, 66.7);
  assert.equal(p502.maxPoints, 3);
  assert.equal(typeof p502.title, "string");

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

test("outcomes summary leaves unmarked AI answers out of the average", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;
  const token = await login(app);
  const auth = { Authorization: `Bearer ${token}` };

  // Both tagged LO-CODE-TRACE-1: an MCQ worth 5 and an AI question worth 2.
  const created = await request(app).post("/api/events").set(auth).send({
    title: "AI outcomes",
    filter: { audiences: ["rgsynapse"], questionIds: ["RGS-S1-01", "AIS-S1-01"] }
  });
  assert.equal(created.status, 201);
  const event = created.body.event;

  const ada = await startAttempt(app, { joinCode: event.join_code, studentName: "Ada" });
  await submit(app, ada.attempt, { "RGS-S1-01": 2, "AIS-S1-01": "The decrement is outside the loop." });
  // AI is off in tests, so the job marks the AI answer needs-review.
  await ctx.expressApp.locals.scoringQueue.drain();

  const summary = async () => {
    const res = await request(app).get(`/api/events/${event.id}/outcomes-summary`).set(auth);
    assert.equal(res.status, 200);
    return Object.fromEntries(res.body.outcomes.map(outcome => [outcome.id, outcome]));
  };

  const before = (await summary())["LO-CODE-TRACE-1"];
  assert.equal(before.unmarkedAnswers, 1);
  assert.equal(before.meanPercentage, 100, "the unmarked answer is not counted as 0");
  assert.equal(before.belowHalfCount, 0);

  const review = await request(app)
    .post(`/api/events/${event.id}/attempts/${ada.attempt.id}/answers/AIS-S1-01/review`)
    .set(auth)
    .send({ score: 0 });
  assert.equal(review.status, 200);

  const after = (await summary())["LO-CODE-TRACE-1"];
  assert.equal(after.unmarkedAnswers, 0);
  assert.equal(after.meanPercentage, 71.4);
});

// buildOutcomesSummary against a small fake store, so each rule can be pinned
// down without driving the scoring or the AI job.
function fakeStore(questions, attempts) {
  return {
    getEventQuestions: () => questions,
    getResults: () => attempts,
    content: { outcomes: [{ id: "LO-A", statement: "Outcome A" }, { id: "LO-B", statement: "Outcome B" }] },
    listOntology: () => [
      { id: "concept", kind: "concept", label: "Concepts", parent: null },
      { id: "concept.loops", kind: "concept", label: "Loops", parent: "concept" }
    ]
  };
}

const Q = [
  { id: "Q1", title: "One", type: "mcq", points: 2, outcomes: ["LO-A"], ontology: ["concept.loops"] },
  { id: "Q2", title: "Two", type: "open-response-ai", points: 4, outcomes: ["LO-A", "LO-B"], ontology: ["concept"] },
  { id: "Q3", title: "Free", type: "mcq", points: 0, outcomes: ["LO-B"], ontology: [] }
];

function attempt(id, answers, extra = {}) {
  return { id, status: "submitted", reset_at: null, late: false, answers, ...extra };
}

function answer(questionId, earnedPoints, extra = {}) {
  return { questionId, earnedPoints, scoreStatus: "scored", response: { text: "x" }, ...extra };
}

test("buildOutcomesSummary: questions, overall and perAttempt", async t => {
  await t.test("unmarked answers are left out, not counted as 0", () => {
    const summary = buildOutcomesSummary(fakeStore(Q, [
      attempt(1, [answer("Q1", 2), answer("Q2", 0, { scoreStatus: "needs-review" }), answer("Q3", 0)]),
      attempt(2, [answer("Q1", 0), answer("Q2", 2), answer("Q3", 0)])
    ]), 1);

    const q2 = summary.questions.find(row => row.id === "Q2");
    assert.equal(q2.unmarkedAnswers, 1);
    assert.equal(q2.markedAttempts, 1);
    assert.equal(q2.percentage, 50);
    assert.equal(q2.meanEarned, 2);

    const first = summary.perAttempt.find(row => row.attemptId === 1);
    assert.equal(first.percentage, 100, "only Q1 is marked, and it is right");
    assert.equal(first.outcomes.find(row => row.id === "LO-A").percentage, 100);
    assert.equal(first.outcomes.find(row => row.id === "LO-B").percentage, null, "nothing marked in LO-B");
    assert.equal(summary.overall.unmarkedAnswers, 1);
    assert.equal(summary.overall.meanPercentage, 66.7);
  });

  await t.test("reset attempts are dropped, late attempts are included", () => {
    const summary = buildOutcomesSummary(fakeStore(Q, [
      attempt(1, [answer("Q1", 2), answer("Q2", 4)], { reset_at: "2026-09-30T00:00:00Z" }),
      attempt(2, [answer("Q1", 0), answer("Q2", 0)], { late: true }),
      attempt(3, [], { status: "started" })
    ]), 1);

    assert.deepEqual(summary.perAttempt.map(row => row.attemptId), [2]);
    assert.equal(summary.perAttempt[0].percentage, 0);
    assert.equal(summary.overall.lateAttempts, 1);
    assert.equal(summary.questions[0].submittedAttempts, 1);
    assert.equal(summary.questions[0].percentage, 0);
  });

  await t.test("no submissions: every question present, no percentages, no attempts", () => {
    const summary = buildOutcomesSummary(fakeStore(Q, []), 1);

    assert.deepEqual(summary.perAttempt, []);
    assert.equal(summary.questions.length, 3);
    summary.questions.forEach(row => {
      assert.equal(row.submittedAttempts, 0);
      assert.equal(row.percentage, null);
      assert.equal(row.meanEarned, null);
    });
    assert.equal(summary.overall.meanPercentage, null);
    assert.equal(summary.overall.submittedAttempts, 0);
  });

  await t.test("every answer unmarked: no percentages, the unmarked count kept", () => {
    const aiOnly = [Q[1]];
    const summary = buildOutcomesSummary(fakeStore(aiOnly, [
      attempt(1, [answer("Q2", 0, { scoreStatus: "pending" })]),
      attempt(2, [answer("Q2", 0, { scoreStatus: "needs-review" })])
    ]), 1);

    assert.equal(summary.questions[0].unmarkedAnswers, 2);
    assert.equal(summary.questions[0].percentage, null);
    assert.equal(summary.questions[0].answered, 2);
    summary.perAttempt.forEach(row => {
      assert.equal(row.percentage, null);
      row.outcomes.forEach(outcome => assert.equal(outcome.percentage, null));
    });
    assert.equal(summary.overall.meanPercentage, null);
    assert.equal(summary.overall.belowHalfCount, 0);
  });

  await t.test("a question worth no points has no percentage and changes no total", () => {
    const summary = buildOutcomesSummary(fakeStore(Q, [
      attempt(1, [answer("Q1", 1), answer("Q2", 4), answer("Q3", 0)])
    ]), 1);

    const free = summary.questions.find(row => row.id === "Q3");
    assert.equal(free.percentage, null);
    assert.equal(free.fullMarks, 0);
    assert.equal(free.answered, 1);
    assert.equal(summary.perAttempt[0].percentage, 83.3);

    // An event made only of zero-point questions has no overall figure.
    const zero = buildOutcomesSummary(fakeStore([Q[2]], [attempt(1, [answer("Q3", 0)])]), 1);
    assert.equal(zero.overall, null);
    assert.equal(zero.perAttempt[0].percentage, null);
  });

  await t.test("a blank or missing answer is skipped and counts as 0", () => {
    const summary = buildOutcomesSummary(fakeStore(Q, [
      attempt(1, [answer("Q1", 0, { response: null })]),
      attempt(2, [answer("Q1", 2)])
    ]), 1);

    const q1 = summary.questions.find(row => row.id === "Q1");
    assert.equal(q1.skipped, 1);
    assert.equal(q1.answered, 1);
    assert.equal(q1.percentage, 50);
    const q2 = summary.questions.find(row => row.id === "Q2");
    assert.equal(q2.skipped, 2, "no answer row at all");
    assert.equal(q2.percentage, 0);
  });
});
