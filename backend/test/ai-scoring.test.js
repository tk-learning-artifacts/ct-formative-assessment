// AI scoring end to end: submit stores open-response answers as pending
// without waiting, the background job scores them through OpenRouter (a fake
// global fetch here, so no network), totals are recomputed, pending answers
// survive a restart, teachers can mark by hand (owner only), students see
// feedback only after release, and no student identifier leaves the server.

const https = require("https");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit, getAttempt, allKeys } = require("./helpers");

const AI_ENV = { AI_PROVIDER: "openrouter", AI_API_KEY: "sk-or-test-key", AI_CONCURRENCY: "2" };
const AI_QUESTIONS = ["AIS-S1-01", "AIS-S2-01"];

function modelReply(output) {
  return new Response(JSON.stringify({
    model: "anthropic/claude-sonnet-5",
    choices: [{ message: { role: "assistant", content: JSON.stringify(output) }, finish_reason: "stop" }]
  }), { status: 200, headers: { "content-type": "application/json" } });
}

// A good reply for whichever question the payload is about: full marks for
// the loop question, partial for the average question.
function replyFor(body) {
  const payload = JSON.parse(JSON.parse(body).messages[1].content);
  return payload.question.maxPoints === 2
    ? { criterionId: "full", score: 2, feedbackCode: "correct", feedback: "You spotted the unindented line." }
    : { criterionId: "partial", score: 2, feedbackCode: "incomplete", feedback: "Say what it should return instead." };
}

// Replaces the global fetch for one test. Each call is recorded; replies are
// held until release() when hold is set, so a test can look at the state
// while scoring is in flight.
function stubFetch({ hold = false, respond = init => modelReply(replyFor(init.body)) } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  const held = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: { ...init.headers }, body: init.body });
    if (!hold) return respond(init);
    return new Promise(resolve => held.push(() => resolve(respond(init))));
  };

  return {
    calls,
    held,
    release() {
      held.splice(0).forEach(go => go());
    },
    restore() {
      globalThis.fetch = original;
    }
  };
}

async function waitFor(check, what) {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function aiEvent(app, auth, joinCode, questionIds = ["P5-01", ...AI_QUESTIONS]) {
  const res = await request(app).post("/api/events").set(auth).send({
    title: `AI ${joinCode}`,
    joinCode,
    filter: { audiences: ["core", "rgsynapse"], questionIds }
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

const ANSWERS = {
  "P5-01": 0,
  "AIS-S1-01": "The count -= 1 line is not indented so it is outside the loop and count stays 10. Indent it.",
  "AIS-S2-01": "average([]) divides by zero and crashes."
};

function answerRow(store, attemptId, questionId) {
  return store.db.prepare("SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?").get(attemptId, questionId);
}

test("with AI on, submit stores pending and the job scores in the background", async t => {
  const fetch = stubFetch({ hold: true });
  const ctx = await buildApp({ env: AI_ENV });
  t.after(() => { fetch.restore(); ctx.cleanup(); });
  const { app, store } = ctx;
  const queue = ctx.expressApp.locals.scoringQueue;
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const created = await aiEvent(app, auth, "AION");
  assert.equal(created.aiRequired, true);
  assert.equal(created.aiEnabled, true);
  assert.equal(created.warning, undefined);

  const { attempt } = await startAttempt(app, { joinCode: "AION" });
  const p501 = store.getEventQuestions(created.event.id).find(q => q.id === "P5-01");
  const mcqCorrect = p501.answer.index === 0 ? p501.points : 0;

  const submitted = await submit(app, attempt, ANSWERS);
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.result.max, p501.points + 2 + 3);
  assert.equal(submitted.body.result.score, mcqCorrect);

  AI_QUESTIONS.forEach(id => assert.equal(answerRow(store, attempt.id, id).score_status, "pending"));
  assert.deepEqual(JSON.parse(answerRow(store, attempt.id, "AIS-S1-01").response_json), { text: ANSWERS["AIS-S1-01"] });

  await waitFor(() => fetch.held.length === 2, "both answers to be sent");
  const pendingView = await getAttempt(app, attempt);
  assert.equal(pendingView.body.result.pending, 2);
  assert.equal(pendingView.body.result.score, mcqCorrect);

  fetch.release();
  await queue.drain();

  const loop = answerRow(store, attempt.id, "AIS-S1-01");
  assert.equal(loop.score_status, "scored");
  assert.equal(loop.earned_points, 2);
  assert.deepEqual(JSON.parse(loop.detail_json), {
    ai: "scored", criterionId: "full", score: 2, feedbackCode: "correct",
    feedback: "You spotted the unindented line.", model: "anthropic/claude-sonnet-5"
  });
  assert.equal(answerRow(store, attempt.id, "AIS-S2-01").earned_points, 2);

  // Before release the student's total stays the instantly marked part,
  // with both written answers counted as still being marked, so the total
  // cannot tell them whether the AI gave credit (policy.studentTotal).
  const done = await getAttempt(app, attempt);
  assert.deepEqual(done.body.result, { score: mcqCorrect, max: p501.points + 5, pending: 2, markedSoFar: true, breakdownReleased: false });

  const results = await request(app).get(`/api/events/${created.event.id}/results`).set(auth);
  const row = results.body.attempts[0].answers.find(answer => answer.questionId === "AIS-S1-01");
  assert.equal(row.scoreStatus, "scored");
  assert.equal(row.detail.feedback, "You spotted the unindented line.");
  assert.equal(results.body.attempts[0].score, mcqCorrect + 4);

  await request(app).post(`/api/events/${created.event.id}/release`).set(auth);
  const released = await getAttempt(app, attempt);
  assert.equal(released.body.result.pending, 0);
  assert.equal(released.body.result.markedSoFar, false);
  assert.equal(released.body.result.score, mcqCorrect + 4, "after release the total includes the AI scores");
});

test("the job respects the concurrency cap, and a bad reply becomes needs-review", async t => {
  const fetch = stubFetch({ hold: true, respond: () => modelReply({ criterionId: "full", score: 99, feedbackCode: "correct" }) });
  const ctx = await buildApp({ env: AI_ENV });
  t.after(() => { fetch.restore(); ctx.cleanup(); });
  const { app, store } = ctx;
  const queue = ctx.expressApp.locals.scoringQueue;
  const auth = { Authorization: `Bearer ${await login(app)}` };
  await aiEvent(app, auth, "CAP");

  const attempts = [];
  for (let i = 0; i < 3; i += 1) {
    const { attempt } = await startAttempt(app, { joinCode: "CAP" });
    await submit(app, attempt, ANSWERS);
    attempts.push(attempt);
  }

  await waitFor(() => fetch.held.length === 2, "two requests");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(fetch.calls.length, 2, "no more than AI_CONCURRENCY requests at once");
  assert.equal(queue.inFlight, 2);

  while (fetch.calls.length < 6 || fetch.held.length) {
    fetch.release();
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await queue.drain();

  assert.equal(fetch.calls.length, 6);
  attempts.forEach(attempt => AI_QUESTIONS.forEach(id => {
    const row = answerRow(store, attempt.id, id);
    assert.equal(row.score_status, "needs-review");
    assert.equal(row.earned_points, 0);
    assert.deepEqual(JSON.parse(row.detail_json), { ai: "needs-review", reason: "invalid-output" });
  }));
});

test("pending answers are picked up after a restart", async t => {
  const fetch = stubFetch();
  t.after(() => fetch.restore());

  const first = await buildApp({ env: AI_ENV });
  const firstQueue = first.expressApp.locals.scoringQueue;
  firstQueue.stop();
  const auth = { Authorization: `Bearer ${await login(first.app)}` };
  await aiEvent(first.app, auth, "REBOOT");
  const { attempt } = await startAttempt(first.app, { joinCode: "REBOOT" });
  await submit(first.app, attempt, ANSWERS);
  assert.equal(answerRow(first.store, attempt.id, "AIS-S1-01").score_status, "pending");
  assert.equal(fetch.calls.length, 0);
  first.close();

  const second = await buildApp({ dbPath: first.dbPath, env: AI_ENV });
  t.after(() => second.cleanup());
  await second.expressApp.locals.scoringQueue.drain();

  assert.equal(fetch.calls.length, 2);
  AI_QUESTIONS.forEach(id => assert.equal(answerRow(second.store, attempt.id, id).score_status, "scored"));
  const auth2 = { Authorization: `Bearer ${await login(second.app)}` };
  const results = await request(second.app).get(`/api/events/${attempt.eventId}/results`).set(auth2);
  assert.ok(results.body.attempts[0].score >= 4);
});

test("an empty open response is scored 0 at once and never sent", async t => {
  const fetch = stubFetch();
  const ctx = await buildApp({ env: AI_ENV });
  t.after(() => { fetch.restore(); ctx.cleanup(); });
  const { app, store } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };
  await aiEvent(app, auth, "EMPTY");
  const { attempt } = await startAttempt(app, { joinCode: "EMPTY" });
  await submit(app, attempt, { "AIS-S1-01": "   ", "AIS-S2-01": 42 });
  await ctx.expressApp.locals.scoringQueue.drain();

  AI_QUESTIONS.forEach(id => {
    const row = answerRow(store, attempt.id, id);
    assert.equal(row.score_status, "scored");
    assert.equal(row.earned_points, 0);
    assert.equal(row.response_json, "null");
  });
  assert.equal(fetch.calls.length, 0);
});

test("with AI off, AI answers wait for the teacher and events carry a warning", async t => {
  const fetch = stubFetch();
  const ctx = await buildApp({ env: { AI_PROVIDER: "none" } });
  t.after(() => { fetch.restore(); ctx.cleanup(); });
  const { app, store } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };

  const preview = await request(app).post("/api/question-bank/preview").set(auth)
    .send({ filter: { audiences: ["rgsynapse"], questionIds: AI_QUESTIONS } });
  assert.equal(preview.body.aiRequired, true);
  assert.equal(preview.body.aiEnabled, false);
  assert.match(preview.body.warning, /AI is off/);

  const mcqOnly = await request(app).post("/api/question-bank/preview").set(auth).send({ selectionMode: "ALL" });
  assert.equal(mcqOnly.body.aiRequired, false);
  assert.equal(mcqOnly.body.warning, undefined);

  const created = await aiEvent(app, auth, "AIOFF");
  assert.equal(created.aiRequired, true);
  assert.equal(created.aiEnabled, false);
  assert.match(created.warning, /mark them by hand/);

  const { attempt } = await startAttempt(app, { joinCode: "AIOFF" });
  await submit(app, attempt, ANSWERS);
  await ctx.expressApp.locals.scoringQueue.drain();

  AI_QUESTIONS.forEach(id => {
    const row = answerRow(store, attempt.id, id);
    assert.equal(row.score_status, "needs-review");
    assert.deepEqual(JSON.parse(row.detail_json), { ai: "needs-review", reason: "ai-disabled" });
  });
  assert.equal(fetch.calls.length, 0, "AI off sends nothing");

  // The rest of the app is unaffected: the demo event still scores MCQs.
  const demo = await startAttempt(app);
  const demoSubmit = await submit(app, demo.attempt, { "P5-01": 0 });
  assert.equal(demoSubmit.status, 200);
});

test("teacher review: owner only, validated, recomputes the total, and the job never overwrites it", async t => {
  const fetch = stubFetch({ hold: true });
  const ctx = await buildApp({ env: AI_ENV });
  t.after(() => { fetch.restore(); ctx.cleanup(); });
  const { app, store } = ctx;
  const queue = ctx.expressApp.locals.scoringQueue;
  const token = await login(app);
  const auth = { Authorization: `Bearer ${token}` };
  store.setPassword("other@school.edu.sg", "another-password-1");
  const otherAuth = { Authorization: `Bearer ${await login(app, { email: "other@school.edu.sg", password: "another-password-1" })}` };

  const created = await aiEvent(app, auth, "REVIEW");
  const eventId = created.event.id;
  const { attempt } = await startAttempt(app, { joinCode: "REVIEW" });
  await submit(app, attempt, ANSWERS);
  await waitFor(() => fetch.held.length === 2, "both answers to be sent");

  const review = (questionId, body, headers = auth, event = eventId, attemptId = attempt.id) => request(app)
    .post(`/api/events/${event}/attempts/${attemptId}/answers/${questionId}/review`).set(headers).send(body);

  assert.equal((await review("AIS-S1-01", { score: 1 }, otherAuth)).status, 404, "another teacher gets 404");
  assert.equal((await review("AIS-S1-01", { score: 1 }, {})).status, 401);
  assert.equal((await review("AIS-S1-01", { score: 3 })).status, 400, "above max");
  assert.equal((await review("AIS-S1-01", { score: -1 })).status, 400);
  assert.equal((await review("AIS-S1-01", { score: 1.5 })).status, 400);
  assert.equal((await review("AIS-S1-01", { score: "2" })).status, 400);
  assert.equal((await review("AIS-S1-01", { score: 1, feedback: "x".repeat(501) })).status, 400);
  assert.equal((await review("AIS-S1-01", { score: 1, feedback: "bad‮chars" })).status, 400);
  assert.equal((await review("P5-01", { score: 1 })).status, 400, "MCQ answers are not marked by hand");
  assert.equal((await review("NOPE", { score: 1 })).status, 404);
  assert.equal((await review("AIS-S1-01", { score: 1 }, auth, eventId, 99999)).status, 404);

  const before = store.getAttempt(attempt.id).score;
  const ok = await review("AIS-S1-01", { score: 1, feedback: "Good start; now say how to fix it." });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.answer.earnedPoints, 1);
  assert.equal(ok.body.attempt.score, before + 1);
  assert.equal(ok.body.answer.detail.review.reviewedBy, 1);

  // The AI reply for the answer the teacher already marked arrives later and
  // is dropped; the other answer is scored normally.
  fetch.release();
  await queue.drain();
  const marked = answerRow(store, attempt.id, "AIS-S1-01");
  assert.equal(marked.score_status, "scored");
  assert.equal(marked.earned_points, 1);
  assert.equal(JSON.parse(marked.detail_json).review.feedback, "Good start; now say how to fix it.");
  assert.equal(store.getAttempt(attempt.id).score, before + 1 + 2);

  // Overriding an AI score keeps the AI's record for the teacher.
  const again = await review("AIS-S2-01", { score: 3 });
  assert.equal(again.status, 200);
  assert.equal(again.body.answer.detail.ai, "scored");
  assert.equal(again.body.answer.detail.review.score, 3);
  assert.equal(again.body.answer.detail.review.feedback, undefined);
  assert.equal(store.getAttempt(attempt.id).score, before + 1 + 3);

  const unsubmitted = await startAttempt(app, { joinCode: "REVIEW" });
  assert.equal((await review("AIS-S1-01", { score: 1 }, auth, eventId, unsubmitted.attempt.id)).status, 404);
});

test("students see AI feedback only after release, as validated text with no internals", async t => {
  const fetch = stubFetch({
    respond: init => modelReply(JSON.parse(JSON.parse(init.body).messages[1].content).question.maxPoints === 2
      ? { criterionId: "full", score: 2, feedbackCode: "correct", feedback: "Nice & clear: \"count\" never changes." }
      : { criterionId: "partial", score: 2, feedbackCode: "incomplete", feedback: "Say what it should return." })
  });
  const ctx = await buildApp({ env: AI_ENV });
  t.after(() => { fetch.restore(); ctx.cleanup(); });
  const { app } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const created = await aiEvent(app, auth, "GATED");
  const { attempt } = await startAttempt(app, { joinCode: "GATED" });
  await submit(app, attempt, ANSWERS);
  await ctx.expressApp.locals.scoringQueue.drain();

  const before = await getAttempt(app, attempt);
  assert.equal(before.body.result.breakdownReleased, false);
  assert.equal(before.body.result.perQuestion, undefined);
  assert.equal(before.body.result.pending, 2, "both written answers still count as being marked before release");
  assert.doesNotMatch(JSON.stringify(before.body), /never changes|should return|criterionId|feedbackCode|incomplete/);

  const teacherBefore = await request(app).get(`/api/events/${created.event.id}/results`).set(auth);
  assert.match(JSON.stringify(teacherBefore.body), /never changes/, "the teacher sees feedback before release");

  await request(app).post(`/api/events/${created.event.id}/release`).set(auth);
  const after = await getAttempt(app, attempt);
  const loop = after.body.result.perQuestion.find(item => item.id === "AIS-S1-01");
  assert.equal(loop.status, "scored");
  assert.equal(loop.earned, 2);
  assert.deepEqual(loop.detail, { source: "ai", feedbackCode: "correct", feedback: "Nice & clear: \"count\" never changes." });
  assert.deepEqual(loop.response, { text: ANSWERS["AIS-S1-01"] });

  const keys = allKeys(after.body);
  ["rubric", "criterionId", "reason", "model", "reviewedBy", "details", "answer"].forEach(key => assert.ok(!keys.has(key), `student view has "${key}"`));
  after.body.questions.filter(q => q.type === "open-response-ai").forEach(q => {
    assert.equal(q.rubric, undefined);
    assert.equal(q.responseMaxChars, 600);
  });

  // A teacher's mark replaces the AI's feedback in the student view.
  await request(app).post(`/api/events/${created.event.id}/attempts/${attempt.id}/answers/AIS-S2-01/review`).set(auth)
    .send({ score: 3, feedback: "Full marks after all." });
  const reviewed = (await getAttempt(app, attempt)).body.result.perQuestion.find(item => item.id === "AIS-S2-01");
  assert.deepEqual(reviewed.detail, { source: "teacher", feedback: "Full marks after all." });
  assert.equal(reviewed.earned, 3);
});

test("spy: Ada Tan of S1-3 never appears in any outgoing request, even when she types her name", async t => {
  const fetch = stubFetch();
  const httpsCalls = [];
  const originalHttpsRequest = https.request;
  https.request = (...args) => { httpsCalls.push(args); throw new Error("no https requests in tests"); };
  const ctx = await buildApp({ env: AI_ENV });
  t.after(() => { https.request = originalHttpsRequest; fetch.restore(); ctx.cleanup(); });
  const { app, store } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };
  await aiEvent(app, auth, "SPY", AI_QUESTIONS);

  const { attempt } = await startAttempt(app, { joinCode: "SPY", studentName: "Ada Tan", studentGroup: "S1-3" });
  await submit(app, attempt, {
    "AIS-S1-01": "Hi I'm Ada Tan from S1-3 (ADA TAN, s1-3, ada.tan@school.edu.sg, +65 9123 4567). count -= 1 is outside the loop so count stays 10. Signed, Ada.",
    "AIS-S2-01": "Tan here. average([]) divides by zero. -- ada tan, class S1-3"
  });
  await ctx.expressApp.locals.scoringQueue.drain();

  assert.equal(fetch.calls.length, 2);
  assert.equal(httpsCalls.length, 0);
  const attemptRow = store.getAttempt(attempt.id);

  fetch.calls.forEach(call => {
    const outgoing = [call.url, JSON.stringify(call.headers), call.body].join("\n");
    ["Ada Tan", "S1-3", "ada.tan", "9123"].forEach(text => {
      assert.ok(!outgoing.toLowerCase().includes(text.toLowerCase()), `outgoing request contains "${text}"`);
    });
    assert.doesNotMatch(outgoing, /\bada\b/i);
    assert.doesNotMatch(outgoing, /\btan\b/i);
    assert.ok(!outgoing.includes(attempt.token), "attempt token");
    assert.ok(!outgoing.includes(attemptRow.token_hash));

    const sent = JSON.parse(JSON.parse(call.body).messages[1].content);
    const keys = allKeys(sent);
    ["attemptId", "attempt_id", "studentName", "studentGroup", "name", "group", "email", "token"]
      .forEach(key => assert.ok(!keys.has(key), `payload has "${key}"`));
    assert.match(sent.response.text, /\[redacted\]/);
    assert.match(sent.response.text, /count|average|divides/);
  });
});

test("the open-response-ai type validates its rubric and normalizes text", () => {
  const scoring = require("../src/scoring");
  const impl = scoring.getType("open-response-ai");
  const base = impl.sample;

  assert.deepEqual(impl.validate(base), []);
  assert.match(impl.validate({ ...base, rubric: undefined })[0], /at least 2 criteria/);
  assert.ok(impl.validate({ ...base, rubric: [base.rubric[0], { ...base.rubric[0] }] }).some(e => /duplicated/.test(e)));
  assert.ok(impl.validate({ ...base, rubric: [{ ...base.rubric[0], points: 1 }, base.rubric[1]] }).some(e => /full points/.test(e)));
  assert.ok(impl.validate({ ...base, rubric: [base.rubric[0], { ...base.rubric[1], points: 1 }] }).some(e => /0 points/.test(e)));
  assert.ok(impl.validate({ ...base, rubric: [{ ...base.rubric[0], id: "Full Marks!" }, base.rubric[1]] }).some(e => /lower-case id/.test(e)));
  assert.ok(impl.validate({ ...base, rubric: [base.rubric[0], { ...base.rubric[1], description: " " }] }).some(e => /description/.test(e)));
  assert.ok(impl.validate({ ...base, responseMaxChars: 5000 }).length);

  const q = { ...base, responseMaxChars: 20 };
  assert.equal(impl.normalizeResponse("  hello\r\nworld  ", q), "hello\nworld");
  assert.equal(impl.normalizeResponse("x".repeat(50), q).length, 20);
  assert.equal(impl.normalizeResponse("   ", q), null);
  assert.equal(impl.normalizeResponse(7, q), null);
  assert.deepEqual(scoring.scoreResponse(base, "because").result, { status: "pending", earned: 0, max: 2, correct: null, detail: { ai: "pending" } });
  assert.deepEqual(scoring.scoreResponse(base, undefined).result, { status: "scored", earned: 0, max: 2, correct: false, detail: null });
  assert.deepEqual(scoring.scoreResponse(base, "because").recorded, { text: "because" });
});
