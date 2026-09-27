// The student page's light poll (GET /api/attempts/:id?fields=status) and
// in-order question delivery. The status response carries the settings, the
// deadline, commit and marking status and the total policy.js allows, and no
// question content or key. Under in-order navigation the student holds only
// the questions up to the one they are on: start sends the first, each
// commit or skip sends the next, and resume sends those reached so far.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit, getAttempt, allKeys } = require("./helpers");

const P5 = ["P5-01", "P5-02", "P5-03", "P5-04", "P5-05"];

// Anything that is question content or would say which answer is right.
const CONTENT_KEYS = ["questions", "question", "next", "prompt", "options", "code", "art", "lines", "title", "answer",
  "correct", "correctResponse", "correctIndex", "perQuestion", "response", "detail", "feedback", "earned"];

async function setup(t) {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const auth = { Authorization: `Bearer ${await login(ctx.app)}` };
  let n = 0;

  async function event(settings) {
    n += 1;
    const joinCode = `STAT${n}`;
    const res = await request(ctx.app).post("/api/events").set(auth).send({ title: `Status ${n}`, joinCode, selectionMode: "P5", ...settings });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { joinCode, id: res.body.event.id, questions: ctx.store.getEventQuestions(res.body.event.id) };
  }

  function edit(id, body) {
    return request(ctx.app).patch(`/api/events/${id}`).set(auth).send(body);
  }

  return { ...ctx, auth, event, edit };
}

function status(app, attempt, token = attempt.token) {
  const req = request(app).get(`/api/attempts/${attempt.id}?fields=status`);
  return token ? req.set("X-Attempt-Token", token) : req;
}

function commit(app, attempt, questionId, response) {
  return request(app).post(`/api/attempts/${attempt.id}/answers/${encodeURIComponent(questionId)}/commit`)
    .set("X-Attempt-Token", attempt.token).send({ response });
}

// Fails if any of these questions (by id or prompt) appears anywhere in body.
function assertAbsent(body, questions, where) {
  const text = JSON.stringify(body);
  questions.forEach(q => {
    assert.ok(!text.includes(JSON.stringify(q.id).slice(1, -1)), `${where}: ${q.id} is in the response`);
    assert.ok(!text.includes(JSON.stringify(q.prompt).slice(1, -1)), `${where}: the prompt of ${q.id} is in the response`);
  });
}

function assertNoContent(body, questions, where) {
  const keys = allKeys(body);
  CONTENT_KEYS.forEach(key => assert.ok(!keys.has(key), `${where}: status has "${key}"`));
  questions.forEach(q => {
    assert.ok(!JSON.stringify(body).includes(JSON.stringify(q.prompt).slice(1, -1)), `${where}: the prompt of ${q.id} is in the status`);
  });
}

test("the status poll needs the token and knows only the status fields", async t => {
  const { app, event } = await setup(t);
  const ev = await event({});
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });

  assert.equal((await status(app, attempt, null)).status, 401);
  assert.equal((await status(app, attempt, "wrong-token")).status, 404);
  const bad = await request(app).get(`/api/attempts/${attempt.id}?fields=questions`).set("X-Attempt-Token", attempt.token);
  assert.equal(bad.status, 400);

  const res = await status(app, attempt);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ["attempt", "progress", "result", "serverNow"]);
  assert.deepEqual(res.body.attempt, { id: attempt.id, status: "started", deadlineAt: null, late: false });
  assert.deepEqual(res.body.progress, { feedbackMode: "release", navigationMode: "free", committed: [] });
  assert.equal(res.body.result, null);
  assertNoContent(res.body, ev.questions, "free, in progress");
});

test("under each the status gives commit and marking status, never the result or key", async t => {
  const { app, store, event, edit } = await setup(t);
  const ev = await event({ feedbackMode: "each" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
  const q1 = store.content.questions.find(q => q.id === "P5-01");

  assert.equal((await commit(app, attempt, "P5-01", (q1.answer.index + 1) % q1.options.length)).status, 200);
  assert.equal((await commit(app, attempt, "P5-03", null)).status, 200);

  const res = await status(app, attempt);
  assert.deepEqual(res.body.progress.committed, [
    { questionId: "P5-01", skipped: false, status: "scored" },
    { questionId: "P5-03", skipped: true, status: "scored" }
  ]);
  assertNoContent(res.body, ev.questions, "each, after a wrong commit");

  // The full attempt, by contrast, carries the result and key for P5-01.
  const full = await getAttempt(app, attempt);
  assert.ok(full.body.progress.committed[0].result.correctResponse);

  // A new deadline shows in the status straight away.
  assert.equal((await edit(ev.id, { durationMinutes: 10 })).status, 200);
  assert.ok((await status(app, attempt)).body.attempt.deadlineAt);

  // Tightened to release: committed answers lose their marking status.
  assert.equal((await edit(ev.id, { feedbackMode: "release" })).status, 200);
  assert.deepEqual((await status(app, attempt)).body.progress.committed, [
    { questionId: "P5-01", skipped: false },
    { questionId: "P5-03", skipped: true }
  ]);
});

test("after submit the status carries the total policy.js allows, and no breakdown", async t => {
  const { app, auth, event } = await setup(t);

  for (const feedbackMode of ["end", "release"]) {
    const ev = await event({ feedbackMode });
    const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
    const submitted = await submit(app, attempt, { "P5-01": 0 });
    assert.equal(submitted.status, 200);

    const res = await status(app, attempt);
    assert.equal(res.body.attempt.status, "submitted");
    assert.equal(res.body.progress, null);
    assert.deepEqual(res.body.result, submitted.body.result, feedbackMode);
    assertNoContent(res.body, ev.questions, `${feedbackMode}, submitted`);

    if (feedbackMode === "release") {
      await request(app).post(`/api/events/${ev.id}/release`).set(auth);
      const released = await status(app, attempt);
      assert.equal(released.body.result.breakdownReleased, true);
      assertNoContent(released.body, ev.questions, "release, released");
    }
  }
});

test("free navigation still sends every question at start, with the count", async t => {
  const { app, event } = await setup(t);
  const ev = await event({ feedbackMode: "each" });
  const started = await startAttempt(app, { joinCode: ev.joinCode });
  assert.deepEqual(started.questions.map(q => q.id), P5);
  assert.equal(started.questionCount, 5);
  assert.deepEqual((await getAttempt(app, started.attempt)).body.questions.map(q => q.id), P5);
});

test("in order, the student holds only the questions up to the one they are on", async t => {
  const { app, event } = await setup(t);

  for (const feedbackMode of ["release", "each"]) {
    const ev = await event({ navigationMode: "linear", feedbackMode });
    const later = from => ev.questions.slice(from);
    const started = await startAttempt(app, { joinCode: ev.joinCode });
    const { attempt } = started;

    assert.deepEqual(started.questions.map(q => q.id), ["P5-01"], feedbackMode);
    assert.equal(started.questionCount, 5);
    assertAbsent(started, later(1), `${feedbackMode} start`);

    const first = await commit(app, attempt, "P5-01", 0);
    assert.equal(first.status, 200);
    assert.equal(first.body.next.id, "P5-02");
    assert.equal(first.body.next.answer, undefined, "the next question is the public projection");
    assertAbsent(first.body, later(2), `${feedbackMode} commit 1`);

    const skipped = await commit(app, attempt, "P5-02", null);
    assert.equal(skipped.body.next.id, "P5-03", "a skip brings the next question too");
    assertAbsent(skipped.body, later(3), `${feedbackMode} skip`);

    const resumed = await getAttempt(app, attempt);
    assert.deepEqual(resumed.body.questions.map(q => q.id), ["P5-01", "P5-02", "P5-03"]);
    assert.equal(resumed.body.questionCount, 5);
    assertAbsent(resumed.body, later(3), `${feedbackMode} resume`);
    assertAbsent((await status(app, attempt)).body, later(3), `${feedbackMode} status`);

    // Submitting on P5-03: the later questions are never sent as questions,
    // before or after.
    const submitted = await submit(app, attempt, { "P5-03": 0 });
    assert.equal(submitted.status, 200);
    assertAbsent(submitted.body, later(3), `${feedbackMode} submit`);

    const after = await getAttempt(app, attempt);
    assert.deepEqual(after.body.questions.map(q => q.id), ["P5-01", "P5-02", "P5-03"]);

    if (feedbackMode === "release") {
      assert.equal(after.body.result.perQuestion, undefined);
      assertAbsent(after.body, later(3), "release, after submit");
    } else {
      // Under "each" (and "end") the breakdown is visible straight after
      // submit, and by design it lists every question with its key,
      // including those the student never reached (ADR 0003 §3). The
      // question content itself (the prompt) still never arrives.
      later(3).forEach(q => {
        assert.ok(!JSON.stringify(after.body).includes(JSON.stringify(q.prompt).slice(1, -1)), `the prompt of ${q.id} is in the breakdown`);
        const row = after.body.result.perQuestion.find(item => item.id === q.id);
        assert.equal(row.response, null, `${q.id} is stored blank`);
        assert.ok(row.correctResponse, `${q.id} shows its key in the breakdown`);
      });
    }
  }
});

test("in order, the last commit brings no next question", async t => {
  const { app, event } = await setup(t);
  const ev = await event({ navigationMode: "linear" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });

  for (const [i, id] of P5.entries()) {
    const res = await commit(app, attempt, id, 0);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.next ? res.body.next.id : null, i < 4 ? P5[i + 1] : null);
  }

  assert.deepEqual((await getAttempt(app, attempt)).body.questions.map(q => q.id), P5);
});

test("a switch from free to in order keeps the questions a student already holds; new attempts are staged", async t => {
  const { app, event, edit } = await setup(t);
  const ev = await event({});
  const early = await startAttempt(app, { joinCode: ev.joinCode });
  assert.equal(early.questions.length, 5);

  assert.equal((await edit(ev.id, { navigationMode: "linear" })).status, 200);

  // The student who started under free still gets them all on resume, and
  // commits in order from the start as the page does after the switch.
  assert.deepEqual((await getAttempt(app, early.attempt)).body.questions.map(q => q.id), P5);
  const caughtUp = await commit(app, early.attempt, "P5-01", 0);
  assert.equal(caughtUp.body.next.id, "P5-02");

  const late = await startAttempt(app, { joinCode: ev.joinCode });
  assert.deepEqual(late.questions.map(q => q.id), ["P5-01"]);
  assertAbsent(late, ev.questions.slice(1), "attempt started after the switch");

  // Back to free: the staged attempt gets every question on its next read.
  assert.equal((await edit(ev.id, { navigationMode: "free" })).status, 200);
  assert.deepEqual((await getAttempt(app, late.attempt)).body.questions.map(q => q.id), P5);
});
