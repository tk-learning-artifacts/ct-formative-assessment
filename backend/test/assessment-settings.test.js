// Per-event assessment settings (ADR 0003): feedback timing (each / end /
// release) and navigation (free / linear), with the per-question commit that
// both rely on. Covers every mode, that no key reaches a student before the
// mode allows it, that a committed answer cannot be changed (by commit or by
// submit), in-order enforcement, one attempt per student in every mode, AI
// answers showing as being marked, and old events keeping their behaviour.

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const Database = require("better-sqlite3");
const { buildApp, login, makeTempDir, startAttempt, submit, getAttempt, allKeys } = require("./helpers");

// Anything that would tell a student which answer is right. (A resume
// response always has a top-level result, null before submit; committed
// answers are checked by shape where they appear.)
const KEY_FIELDS = ["perQuestion", "correct", "correctResponse", "correctIndex", "earned", "answer"];

function leakedKeys(body) {
  const found = allKeys(body);
  return KEY_FIELDS.filter(key => found.has(key));
}

function commit(app, attempt, questionId, body, token = attempt.token) {
  const req = request(app).post(`/api/attempts/${attempt.id}/answers/${encodeURIComponent(questionId)}/commit`);

  if (token) {
    req.set("X-Attempt-Token", token);
  }

  return req.send(body);
}

// The answer key for a multiple-choice question, and a wrong option.
function keys(store, ids) {
  const byId = new Map(store.content.questions.map(q => [q.id, q]));
  return Object.fromEntries(ids.map(id => {
    const q = byId.get(id);
    return [id, { right: q.answer.index, wrong: (q.answer.index + 1) % q.options.length, points: q.points }];
  }));
}

const P5 = ["P5-01", "P5-02", "P5-03", "P5-04", "P5-05"];

async function setup(t, env) {
  const ctx = await buildApp(env ? { env } : {});
  t.after(() => ctx.cleanup());
  const auth = { Authorization: `Bearer ${await login(ctx.app)}` };
  let n = 0;

  async function event(settings, body = { selectionMode: "P5" }) {
    n += 1;
    const joinCode = `SET${n}`;
    const res = await request(ctx.app).post("/api/events").set(auth).send({ title: `Settings ${n}`, joinCode, ...body, ...settings });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { joinCode, id: res.body.event.id, event: res.body.event };
  }

  return { ...ctx, auth, event, key: keys(ctx.store, P5) };
}

test("settings are stored on the event, default to release and free, and are validated", async t => {
  const { app, auth, event } = await setup(t);

  const plain = await event({});
  assert.equal(plain.event.feedback_mode, "release");
  assert.equal(plain.event.navigation_mode, "free");

  const each = await event({ feedbackMode: "each", navigationMode: "linear" });
  assert.equal(each.event.feedback_mode, "each");
  assert.equal(each.event.navigation_mode, "linear");

  for (const [body, pattern] of [
    [{ feedbackMode: "sometimes" }, /feedbackMode must be one of: each, end, release/],
    [{ navigationMode: "backwards" }, /navigationMode must be one of: free, linear/],
    [{ feedbackMode: 1 }, /feedbackMode/]
  ]) {
    const res = await request(app).post("/api/events").set(auth).send({ title: "Bad", selectionMode: "P5", ...body });
    assert.equal(res.status, 400);
    assert.match(res.body.error, pattern);
  }

  const listed = (await request(app).get("/api/events").set(auth)).body.events.find(item => item.id === each.id);
  assert.equal(listed.feedback_mode, "each");
  assert.equal(listed.navigation_mode, "linear");

  const results = await request(app).get(`/api/events/${each.id}/results`).set(auth);
  assert.equal(results.body.event.feedback_mode, "each");
  assert.equal(results.body.event.navigation_mode, "linear");

  // The student sees the settings on join, start and resume.
  const joined = await request(app).post("/api/events/join").send({ joinCode: each.joinCode });
  assert.equal(joined.body.event.feedbackMode, "each");
  const started = await startAttempt(app, { joinCode: each.joinCode });
  assert.deepEqual(started.progress, { feedbackMode: "each", navigationMode: "linear", committed: [] });
  assert.equal(started.event.navigationMode, "linear");
  const resumed = await getAttempt(app, started.attempt);
  assert.equal(resumed.body.event.feedbackMode, "each");
  assert.deepEqual(resumed.body.progress, { feedbackMode: "each", navigationMode: "linear", committed: [] });
});

test("release + free (the default): no commits, total only until release", async t => {
  const { app, auth, event, key } = await setup(t);
  const ev = await event({});
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });

  const refused = await commit(app, attempt, "P5-01", { response: key["P5-01"].right });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "commit-not-used");

  const sent = await submit(app, attempt, { "P5-01": key["P5-01"].right });
  assert.equal(sent.body.result.breakdownReleased, false);
  const view = await getAttempt(app, attempt);
  assert.equal(view.body.result.perQuestion, undefined);
  assert.equal(view.body.progress, null);

  await request(app).post(`/api/events/${ev.id}/release`).set(auth);
  assert.equal((await getAttempt(app, attempt)).body.result.perQuestion.length, 5);
});

test("end + free: nothing before submit, the breakdown straight after", async t => {
  const { app, event, key } = await setup(t);
  const ev = await event({ feedbackMode: "end" });
  const started = await startAttempt(app, { joinCode: ev.joinCode });
  const { attempt } = started;

  assert.deepEqual(leakedKeys(started), []);
  assert.deepEqual(leakedKeys((await getAttempt(app, attempt)).body), []);
  assert.equal((await commit(app, attempt, "P5-01", { response: 0 })).body.code, "commit-not-used");

  const sent = await submit(app, attempt, { "P5-01": key["P5-01"].right, "P5-02": key["P5-02"].wrong });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.result.breakdownReleased, true);
  assert.equal(sent.body.result.perQuestion, undefined, "the submit response itself stays total-only");

  const view = await getAttempt(app, attempt);
  assert.equal(view.body.result.breakdownReleased, true);
  const rows = view.body.result.perQuestion;
  assert.deepEqual(rows.map(row => row.id), P5);
  assert.equal(rows[0].correct, true);
  assert.equal(rows[1].correct, false);
  assert.equal(rows[1].correctResponse.index, key["P5-02"].right);

  // A classmate who has not submitted still sees nothing.
  const other = await startAttempt(app, { joinCode: ev.joinCode });
  assert.deepEqual(leakedKeys(other), []);
  assert.deepEqual(leakedKeys((await getAttempt(app, other.attempt)).body), []);
});

test("each + free: commit shows that question's result, locks it, and submit keeps it", async t => {
  const { app, auth, event, key, store } = await setup(t);
  const ev = await event({ feedbackMode: "each" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });

  // Free navigation: any order.
  const third = await commit(app, attempt, "P5-03", { response: key["P5-03"].wrong });
  assert.equal(third.status, 200, JSON.stringify(third.body));
  assert.equal(third.body.committed.questionId, "P5-03");
  assert.equal(third.body.committed.skipped, false);
  assert.equal(third.body.committed.result.correct, false);
  assert.equal(third.body.committed.result.earned, 0);
  assert.equal(third.body.committed.result.correctResponse.index, key["P5-03"].right);
  assert.equal(third.body.committed.result.response.index, key["P5-03"].wrong);

  const first = await commit(app, attempt, "P5-01", { response: key["P5-01"].right });
  assert.equal(first.body.committed.result.correct, true);
  assert.deepEqual(first.body.progress.committed.map(item => item.questionId), ["P5-01", "P5-03"], "in question order");

  // Locked: a second commit is refused and the stored answer is unchanged.
  const again = await commit(app, attempt, "P5-03", { response: key["P5-03"].right });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "answer-locked");

  // Only committed questions carry a key; the others do not.
  const resumed = await getAttempt(app, attempt);
  assert.deepEqual(resumed.body.progress.committed.map(item => item.questionId), ["P5-01", "P5-03"]);
  assert.equal(resumed.body.result, null);
  const keyed = JSON.stringify(resumed.body.questions);
  assert.equal(keyed.includes("correctResponse"), false);
  assert.deepEqual(leakedKeys(resumed.body.questions), []);

  // Submit tries to change the locked answer: ignored.
  const sent = await submit(app, attempt, { "P5-03": key["P5-03"].right, "P5-02": key["P5-02"].right });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.result.score, key["P5-01"].points + key["P5-02"].points);
  assert.equal(sent.body.result.breakdownReleased, true);

  const rows = (await getAttempt(app, attempt)).body.result.perQuestion;
  assert.deepEqual(rows.map(row => row.id), P5, "breakdown in question order, commits or not");
  assert.equal(rows.find(row => row.id === "P5-03").correct, false);
  assert.equal(rows.find(row => row.id === "P5-02").correct, true);

  const stored = store.db.prepare("SELECT question_id, committed_at FROM answers WHERE attempt_id = ? ORDER BY question_id").all(attempt.id);
  assert.equal(stored.length, 5, "one row per question");
  assert.deepEqual(stored.filter(row => row.committed_at).map(row => row.question_id), ["P5-01", "P5-03"]);

  // The teacher sees when each answer was committed.
  const results = await request(app).get(`/api/events/${ev.id}/results`).set(auth);
  const answers = results.body.attempts[0].answers;
  assert.ok(answers.find(answer => answer.questionId === "P5-01").committedAt);
  assert.equal(answers.find(answer => answer.questionId === "P5-02").committedAt, null);
});

test("linear + release: forward only, skips recorded, no result until release", async t => {
  const { app, auth, event, key } = await setup(t);
  const ev = await event({ navigationMode: "linear" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });

  // Out of order is refused.
  const ahead = await commit(app, attempt, "P5-02", { response: key["P5-02"].right });
  assert.equal(ahead.status, 409);
  assert.equal(ahead.body.code, "out-of-order");

  const first = await commit(app, attempt, "P5-01", { response: key["P5-01"].wrong });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.committed, { questionId: "P5-01", skipped: false });
  assert.deepEqual(leakedKeys(first.body), [], "no correctness under release");

  // An explicit skip: response null, recorded blank.
  const skip = await commit(app, attempt, "P5-02", { response: null });
  assert.deepEqual(skip.body.committed, { questionId: "P5-02", skipped: true });

  // Going back is refused: earlier questions are locked.
  for (const id of ["P5-01", "P5-02"]) {
    const back = await commit(app, attempt, id, { response: key[id].right });
    assert.equal(back.status, 409);
    assert.equal(back.body.code, "answer-locked");
  }

  const resumed = await getAttempt(app, attempt);
  assert.deepEqual(resumed.body.progress.committed, [{ questionId: "P5-01", skipped: false }, { questionId: "P5-02", skipped: true }]);
  assert.deepEqual(leakedKeys(resumed.body), []);

  // Submit on P5-03: its answer counts; answers for questions never reached
  // (P5-04, P5-05) and for locked ones are ignored.
  const sent = await submit(app, attempt, {
    "P5-01": key["P5-01"].right,
    "P5-02": key["P5-02"].right,
    "P5-03": key["P5-03"].right,
    "P5-04": key["P5-04"].right,
    "P5-05": key["P5-05"].right
  });
  assert.equal(sent.body.result.score, key["P5-03"].points);
  assert.equal(sent.body.result.breakdownReleased, false);
  assert.equal((await getAttempt(app, attempt)).body.result.perQuestion, undefined);

  await request(app).post(`/api/events/${ev.id}/release`).set(auth);
  const rows = (await getAttempt(app, attempt)).body.result.perQuestion;
  assert.deepEqual(rows.map(row => [row.id, row.correct]), [["P5-01", false], ["P5-02", false], ["P5-03", true], ["P5-04", false], ["P5-05", false]]);
  assert.equal(rows[1].response, null, "the skip is a blank answer");
});

test("linear + each: in order, and each commit, skips included, shows its result", async t => {
  const { app, event, key } = await setup(t);
  const ev = await event({ feedbackMode: "each", navigationMode: "linear" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });

  const first = await commit(app, attempt, "P5-01", { response: key["P5-01"].right });
  assert.equal(first.body.committed.result.correct, true);

  const skip = await commit(app, attempt, "P5-02", {});
  assert.equal(skip.body.committed.skipped, true);
  assert.equal(skip.body.committed.result.correct, false);
  assert.equal(skip.body.committed.result.correctResponse.index, key["P5-02"].right);

  assert.equal((await commit(app, attempt, "P5-04", { response: 0 })).body.code, "out-of-order");
  assert.equal((await commit(app, attempt, "P5-01", { response: 0 })).body.code, "answer-locked");

  // The next question's key has not been sent.
  const resumed = await getAttempt(app, attempt);
  assert.deepEqual(resumed.body.progress.committed.map(item => item.questionId), ["P5-01", "P5-02"]);
  assert.equal(JSON.stringify(resumed.body).includes("\"P5-03\",\"title\""), false);
  assert.equal(resumed.body.progress.committed.some(item => item.result.id === "P5-03"), false);

  const sent = await submit(app, attempt, {});
  assert.equal(sent.body.result.score, key["P5-01"].points);
  assert.equal(sent.body.result.breakdownReleased, true);
});

test("commit guards: token, question, submitted, reset, time up, and one attempt in every mode", async t => {
  const { app, auth, event, key, store } = await setup(t);

  for (const [feedbackMode, navigationMode] of [["release", "free"], ["end", "free"], ["each", "free"], ["release", "linear"], ["end", "linear"], ["each", "linear"]]) {
    const ev = await event({ feedbackMode, navigationMode });
    const label = `${feedbackMode}/${navigationMode}`;
    const first = await request(app).post("/api/attempts").send({ joinCode: ev.joinCode, studentName: "Ada Tan", studentGroup: "S1-2" });
    assert.equal(first.status, 201, label);
    assert.equal((await request(app).post("/api/attempts").send({ joinCode: ev.joinCode, studentName: "ada  tan", studentGroup: "s1-2" })).status, 409, label);
    await submit(app, first.body.attempt, {});
    const again = await request(app).post("/api/attempts").send({ joinCode: ev.joinCode, studentName: "Ada Tan", studentGroup: "S1-2" });
    assert.equal(again.status, 409, label);
    assert.equal(again.body.code, "already-submitted", label);
  }

  const ev = await event({ feedbackMode: "each" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });

  assert.equal((await commit(app, attempt, "P5-01", { response: 0 }, null)).status, 401);
  assert.equal((await commit(app, attempt, "P5-01", { response: 0 }, "wrong-token")).status, 404);
  assert.equal((await commit(app, { id: 999999, token: attempt.token }, "P5-01", { response: 0 })).status, 404);

  const unknown = await commit(app, attempt, "S2-01", { response: 0 });
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /not in this test/);

  // After the deadline and its grace window, commits stop.
  store.db.prepare("UPDATE attempts SET deadline_at = ? WHERE id = ?").run(new Date(Date.now() - 5 * 60 * 1000).toISOString(), attempt.id);
  const late = await commit(app, attempt, "P5-01", { response: key["P5-01"].right });
  assert.equal(late.status, 409);
  assert.equal(late.body.code, "time-up");
  store.db.prepare("UPDATE attempts SET deadline_at = NULL WHERE id = ?").run(attempt.id);

  await submit(app, attempt, {});
  const afterSubmit = await commit(app, attempt, "P5-01", { response: 0 });
  assert.equal(afterSubmit.status, 409);
  assert.equal(afterSubmit.body.code, "already-submitted");

  const second = await startAttempt(app, { joinCode: ev.joinCode });
  await request(app).post(`/api/events/${ev.id}/attempts/${second.attempt.id}/reset`).set(auth);
  const afterReset = await commit(app, second.attempt, "P5-01", { response: 0 });
  assert.equal(afterReset.status, 409);
  assert.equal(afterReset.body.code, "attempt-reset");
});

// ---------- AI-scored answers under "after each question" ----------

function modelReply(output) {
  return new Response(JSON.stringify({
    model: "anthropic/claude-sonnet-5",
    choices: [{ message: { role: "assistant", content: JSON.stringify(output) }, finish_reason: "stop" }]
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function waitFor(check, what) {
  for (let i = 0; i < 200; i += 1) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

test("each: an AI-scored answer is being marked until the job scores it", async t => {
  const original = globalThis.fetch;
  const held = [];
  globalThis.fetch = async () => new Promise(resolve => held.push(() => resolve(modelReply({
    criterionId: "full", score: 2, feedbackCode: "correct", feedback: "You spotted the unindented line."
  }))));
  t.after(() => {
    globalThis.fetch = original;
  });

  const { app, event } = await setup(t, { AI_PROVIDER: "openrouter", AI_API_KEY: "sk-or-test-key" });
  const ev = await event({ feedbackMode: "each" }, { filter: { audiences: ["rgsynapse"], questionIds: ["RGS-S1-03", "AIS-S1-01"] } });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });

  const committed = await commit(app, attempt, "AIS-S1-01", { response: "Line 3 is not indented, so it runs once after the loop." });
  assert.equal(committed.status, 200);
  assert.equal(committed.body.committed.result.status, "pending");
  assert.equal(committed.body.committed.result.correct, null);
  assert.equal(committed.body.committed.result.detail, null, "no AI internals while pending");

  await waitFor(() => held.length > 0, "the scoring request");
  const pending = await getAttempt(app, attempt);
  assert.equal(pending.body.progress.committed[0].result.status, "pending");

  held.splice(0).forEach(go => go());
  await waitFor(async () => (await getAttempt(app, attempt)).body.progress.committed[0].result.status === "scored", "the score");

  const scored = (await getAttempt(app, attempt)).body.progress.committed[0].result;
  assert.equal(scored.earned, 2);
  assert.equal(scored.correct, true);
  assert.deepEqual(scored.detail, { source: "ai", feedbackCode: "correct", feedback: "You spotted the unindented line." });

  const sent = await submit(app, attempt, {});
  assert.equal(sent.body.result.score, 2, "the committed AI score counts in the total");
});

// ---------- Existing events ----------

test("events from before the settings keep release and free, and behave as before", async t => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, "app.db");
  const raw = new Database(dbPath);
  raw.exec(fs.readFileSync(path.join(__dirname, "fixtures/v1-app.sql"), "utf8"));
  raw.close();

  const ctx = await buildApp({ dbPath });
  t.after(() => {
    ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const events = ctx.store.db.prepare("SELECT join_code, feedback_mode, navigation_mode FROM events").all();
  assert.ok(events.length >= 2);
  events.forEach(row => {
    assert.equal(row.feedback_mode, "release", row.join_code);
    assert.equal(row.navigation_mode, "free", row.join_code);
  });

  assert.equal(ctx.store.db.prepare("SELECT COUNT(*) AS n FROM answers WHERE committed_at IS NOT NULL").get().n, 0);

  const { attempt } = await startAttempt(ctx.app, { joinCode: "P6RND" });
  assert.equal((await commit(ctx.app, attempt, "P6-01", { response: 0 })).body.code, "commit-not-used");
  const sent = await submit(ctx.app, attempt, {});
  assert.equal(sent.status, 200);
  // Pre-migration events were marked released, so the breakdown still shows.
  assert.equal(sent.body.result.breakdownReleased, true);
});
