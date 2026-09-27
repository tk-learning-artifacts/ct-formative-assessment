// The total a student sees before results are released (policy.studentTotal).
// Under "release" it must not move as AI or teacher marks arrive, because a
// rise would show whether a written answer earned credit. It is the score of
// the instantly marked questions, labelled as marked so far, with a fixed
// count of answers marked later. Released, "end" and "each" events show the
// full total. Teachers always see the full total.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit, getAttempt } = require("./helpers");

const AI_ENV = { AI_PROVIDER: "openrouter", AI_API_KEY: "sk-or-test-key" };
const QUESTIONS = ["P5-01", "AIS-S1-01", "AIS-S2-01"];
const ANSWERS = {
  "AIS-S1-01": "The count -= 1 line is outside the loop, so count stays 10.",
  "AIS-S2-01": "average([]) divides by zero."
};

// Full marks from the model for every answer.
function stubFetch() {
  const original = globalThis.fetch;

  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
    const output = { criterionId: "full", score: payload.question.maxPoints, feedbackCode: "correct", feedback: "Good." };
    return new Response(JSON.stringify({
      model: "anthropic/claude-sonnet-5",
      choices: [{ message: { role: "assistant", content: JSON.stringify(output) }, finish_reason: "stop" }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  return () => { globalThis.fetch = original; };
}

async function setup(t, env = AI_ENV) {
  const restore = stubFetch();
  const ctx = await buildApp({ env });
  t.after(() => { restore(); ctx.cleanup(); });
  const auth = { Authorization: `Bearer ${await login(ctx.app)}` };
  const queue = ctx.expressApp.locals.scoringQueue;
  let n = 0;

  async function event(settings = {}) {
    n += 1;
    const joinCode = `TOT${n}`;
    const res = await request(ctx.app).post("/api/events").set(auth).send({
      title: `Totals ${n}`,
      joinCode,
      filter: { audiences: ["core", "rgsynapse"], questionIds: QUESTIONS },
      ...settings
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const questions = ctx.store.getEventQuestions(res.body.event.id);
    const mcq = questions.find(q => q.id === "P5-01");
    return {
      id: res.body.event.id,
      joinCode,
      mcqPoints: mcq.points,
      mcqRight: mcq.answer.index,
      max: questions.reduce((sum, q) => sum + q.points, 0)
    };
  }

  function review(eventId, attemptId, questionId, score) {
    return request(ctx.app).post(`/api/events/${eventId}/attempts/${attemptId}/answers/${questionId}/review`).set(auth).send({ score, feedback: "" });
  }

  async function teacherScore(eventId, attemptId) {
    const res = await request(ctx.app).get(`/api/events/${eventId}/results`).set(auth);
    return res.body.attempts.find(a => a.id === attemptId).score;
  }

  function release(eventId) {
    return request(ctx.app).post(`/api/events/${eventId}/release`).set(auth);
  }

  return { ...ctx, auth, queue, event, review, teacherScore, release };
}

test("under release the student's total stays the instant part while AI and teacher marks arrive", async t => {
  const { app, queue, event, review, teacherScore, release } = await setup(t);
  const ev = await event();
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
  const marked = { score: ev.mcqPoints, max: ev.max, pending: 2, markedSoFar: true, breakdownReleased: false };

  const submitted = await submit(app, attempt, { "P5-01": ev.mcqRight, ...ANSWERS });
  assert.equal(submitted.status, 200);
  assert.deepEqual(submitted.body.result, marked, "submit");

  await queue.drain();
  assert.equal(await teacherScore(ev.id, attempt.id), ev.max, "the teacher sees the AI marks at once");
  assert.deepEqual((await getAttempt(app, attempt)).body.result, marked, "after the AI marked both answers");

  assert.equal((await review(ev.id, attempt.id, "AIS-S2-01", 0)).status, 200);
  assert.equal(await teacherScore(ev.id, attempt.id), ev.max - 3, "the teacher sees their own mark");
  assert.deepEqual((await getAttempt(app, attempt)).body.result, marked, "after the teacher's mark");

  await release(ev.id);
  const released = (await getAttempt(app, attempt)).body.result;
  assert.equal(released.score, ev.max - 3);
  assert.equal(released.pending, 0);
  assert.equal(released.markedSoFar, false);
  assert.equal(released.breakdownReleased, true);
});

test("with AI off, a teacher's mark does not move the student's total before release", async t => {
  const { app, event, review, teacherScore } = await setup(t, {});
  const ev = await event();
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
  await submit(app, attempt, { "P5-01": (ev.mcqRight + 1) % 4, ...ANSWERS });

  const before = (await getAttempt(app, attempt)).body.result;
  assert.deepEqual(before, { score: 0, max: ev.max, pending: 2, markedSoFar: true, breakdownReleased: false });

  await review(ev.id, attempt.id, "AIS-S1-01", 2);
  assert.equal(await teacherScore(ev.id, attempt.id), 2);
  assert.deepEqual((await getAttempt(app, attempt)).body.result, before);
});

test("a blank written answer is not counted as being marked, and marking it by hand moves nothing", async t => {
  const { app, event, review } = await setup(t, {});
  const ev = await event();
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
  const submitted = await submit(app, attempt, { "P5-01": ev.mcqRight, "AIS-S1-01": ANSWERS["AIS-S1-01"] });
  const expected = { score: ev.mcqPoints, max: ev.max, pending: 1, markedSoFar: true, breakdownReleased: false };
  assert.deepEqual(submitted.body.result, expected);

  assert.equal((await review(ev.id, attempt.id, "AIS-S2-01", 3)).status, 200);
  assert.deepEqual((await getAttempt(app, attempt)).body.result, expected);
});

test("an event with no AI questions shows its full total, as before", async t => {
  const { app, auth } = await setup(t);
  await request(app).post("/api/events").set(auth).send({ title: "Plain", joinCode: "PLAIN", selectionMode: "P5" }).expect(201);
  const { attempt } = await startAttempt(app, { joinCode: "PLAIN" });
  const res = await submit(app, attempt, {});
  assert.deepEqual(res.body.result, { score: 0, max: res.body.result.max, pending: 0, markedSoFar: false, breakdownReleased: false });
});

test("in order under release, an answer marked before submit is left out of the submit total", async t => {
  const { app, queue, event, review } = await setup(t);
  const ev = await event({ navigationMode: "linear" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
  const commit = (id, response) => request(app).post(`/api/attempts/${attempt.id}/answers/${id}/commit`).set("X-Attempt-Token", attempt.token).send({ response });

  assert.equal((await commit("P5-01", ev.mcqRight)).status, 200);
  assert.equal((await commit("AIS-S1-01", ANSWERS["AIS-S1-01"])).status, 200);
  await queue.drain();
  assert.equal((await review(ev.id, attempt.id, "AIS-S1-01", 1)).status, 200, "the teacher marks a committed answer before submit");

  const submitted = await submit(app, attempt, { "AIS-S2-01": ANSWERS["AIS-S2-01"] });
  assert.deepEqual(submitted.body.result, { score: ev.mcqPoints, max: ev.max, pending: 2, markedSoFar: true, breakdownReleased: false });
});

test("under end and each the total is the full one, and rises as answers are marked", async t => {
  const { app, queue, event } = await setup(t);

  for (const feedbackMode of ["end", "each"]) {
    const ev = await event({ feedbackMode });
    const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
    const submitted = await submit(app, attempt, { "P5-01": ev.mcqRight, ...ANSWERS });
    assert.equal(submitted.body.result.markedSoFar, false, feedbackMode);
    assert.equal(submitted.body.result.breakdownReleased, true, feedbackMode);

    await queue.drain();
    const done = (await getAttempt(app, attempt)).body.result;
    assert.equal(done.score, ev.max, `${feedbackMode}: the AI marks are in the total`);
    assert.equal(done.pending, 0, feedbackMode);
  }
});
