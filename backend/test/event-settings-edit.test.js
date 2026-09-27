// Editing an event's settings after creating it (ADR 0003 §10), and preset
// provenance (§11). Covers the owner-only PATCH and its validation, every
// mid-event change of feedback timing and navigation (no committed answer is
// ever unlocked, and tightening feedback leaks no key), deadline recompute
// for attempts in progress, the audit trail, and which preset an event came
// from. Also: the teacher can mark a committed answer before submit, and a
// reset attempt's AI answers are never sent to the provider.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit, getAttempt, allKeys } = require("./helpers");

const KEY_FIELDS = ["perQuestion", "correct", "correctResponse", "correctIndex", "earned", "answer", "result"];

function leakedKeys(body) {
  const found = allKeys(body);
  return KEY_FIELDS.filter(key => found.has(key));
}

function commit(app, attempt, questionId, body) {
  return request(app)
    .post(`/api/attempts/${attempt.id}/answers/${encodeURIComponent(questionId)}/commit`)
    .set("X-Attempt-Token", attempt.token)
    .send(body);
}

const P5 = ["P5-01", "P5-02", "P5-03", "P5-04", "P5-05"];

async function setup(t, env) {
  const ctx = await buildApp(env ? { env } : {});
  t.after(() => ctx.cleanup());
  const auth = { Authorization: `Bearer ${await login(ctx.app)}` };
  const byId = new Map(ctx.store.content.questions.map(q => [q.id, q]));
  const key = Object.fromEntries(P5.map(id => {
    const q = byId.get(id);
    return [id, { right: q.answer.index, wrong: (q.answer.index + 1) % q.options.length, points: q.points }];
  }));
  let n = 0;

  async function event(settings = {}, body = { selectionMode: "P5" }) {
    n += 1;
    const joinCode = `EDIT${n}`;
    const res = await request(ctx.app).post("/api/events").set(auth).send({ title: `Edit ${n}`, joinCode, ...body, ...settings });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { joinCode, id: res.body.event.id, event: res.body.event };
  }

  function patch(id, body, headers = auth) {
    return request(ctx.app).patch(`/api/events/${id}`).set(headers).send(body);
  }

  async function edit(id, body) {
    const res = await patch(id, body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  }

  return { ...ctx, auth, key, event, patch, edit };
}

function attemptRow(store, id) {
  return store.db.prepare("SELECT status, deadline_at, late, score FROM attempts WHERE id = ?").get(id);
}

// ---------- The endpoint ----------

test("PATCH /api/events/:id is owner only and validated", async t => {
  const { app, store, auth, event, patch } = await setup(t);
  const ev = await event({ durationMinutes: 30 });

  store.createUser({ email: "other@school.test", password: "other-password-1" });
  const other = { Authorization: `Bearer ${await login(app, { email: "other@school.test", password: "other-password-1" })}` };

  assert.equal((await request(app).patch(`/api/events/${ev.id}`).send({ title: "X" })).status, 401);
  const notMine = await patch(ev.id, { title: "Hijacked" }, other);
  assert.equal(notMine.status, 404, "another teacher's event looks missing");
  assert.equal((await patch(999999, { title: "X" })).status, 404);
  assert.equal(store.getEventById(ev.id).title, "Edit 1");

  for (const [body, pattern] of [
    [{ filter: { audiences: ["core"] } }, /questions cannot be changed/],
    [{ preset: { id: "core-ct-check" } }, /questions cannot be changed/],
    [{ selectionMode: "ALL" }, /questions cannot be changed/],
    [{ joinCode: "NEWCODE" }, /cannot be changed: joinCode/],
    [{}, /Nothing to change/],
    [{ title: "   " }, /title is required/],
    [{ feedbackMode: "sometimes" }, /feedbackMode must be one of: each, end, release/],
    [{ navigationMode: null }, /navigationMode must be one of: free, linear/],
    [{ durationMinutes: -5 }, /Duration must be a positive number/],
    [{ durationMinutes: 24 * 60 + 1 }, /at most 1440/],
    [{ endAt: "2026-10-01T09:00" }, /Deadline must be an ISO date-time with a time zone/],
    [{ startAt: "2026-10-02T01:00:00Z", endAt: "2026-10-01T01:00:00Z" }, /Deadline must be later than the start time/]
  ]) {
    const res = await patch(ev.id, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, pattern, JSON.stringify(body));
  }

  // The start/deadline order is checked against the stored value too.
  await patch(ev.id, { endAt: "2026-12-01T01:00:00Z" });
  const clash = await patch(ev.id, { startAt: "2026-12-02T01:00:00+08:00" });
  assert.equal(clash.status, 400);
  assert.match(clash.body.error, /later than the start time/);

  // Nothing refused above was written.
  assert.equal(store.listSettingChanges(ev.id).length, 1, "only the valid endAt edit");

  const ok = await patch(ev.id, { title: "  Renamed  ", durationMinutes: 20, feedbackMode: "end", startAt: "2026-11-30T09:00:00+08:00" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.event.title, "Renamed");
  assert.equal(ok.body.event.duration_minutes, 20);
  assert.equal(ok.body.event.feedback_mode, "end");
  assert.equal(ok.body.event.start_at, "2026-11-30T01:00:00.000Z", "stored as UTC");
  assert.equal(ok.body.event.question_count, 5, "the question set is untouched");
  assert.equal(ok.body.event.created_by, undefined);

  // Clearing: null (or an empty value, as the form sends) means no limit.
  const cleared = await patch(ev.id, { durationMinutes: null, endAt: "" });
  assert.equal(cleared.body.event.duration_minutes, null);
  assert.equal(cleared.body.event.end_at, null);

  // The list shows the edit.
  const listed = (await request(app).get("/api/events").set(auth)).body.events.find(item => item.id === ev.id);
  assert.equal(listed.title, "Renamed");
});

test("each change is recorded in event_setting_changes and shown with the results", async t => {
  const { app, store, auth, event, edit } = await setup(t);
  const ev = await event({ durationMinutes: 30 });

  const first = await edit(ev.id, { title: "Edit 1", feedbackMode: "each", durationMinutes: 30 });
  assert.deepEqual(first.changes.map(change => change.field), ["feedback_mode"], "unchanged values are not recorded");

  await edit(ev.id, { durationMinutes: 15, endAt: "2026-12-01T01:00:00Z" });
  await edit(ev.id, { navigationMode: "linear", endAt: null });

  const rows = store.db.prepare("SELECT event_id, changed_by, field, old_value, new_value, changed_at FROM event_setting_changes ORDER BY id").all();
  const teacherId = store.findUserByEmail("teacher@ctquest.local").id;
  assert.deepEqual(rows.map(row => [row.field, row.old_value, row.new_value]), [
    ["feedback_mode", "release", "each"],
    ["duration_minutes", "30", "15"],
    ["end_at", null, "2026-12-01T01:00:00.000Z"],
    ["navigation_mode", "free", "linear"],
    ["end_at", "2026-12-01T01:00:00.000Z", null]
  ]);
  rows.forEach(row => {
    assert.equal(row.event_id, ev.id);
    assert.equal(row.changed_by, teacherId);
    assert.ok(!Number.isNaN(Date.parse(row.changed_at)));
  });

  const results = await request(app).get(`/api/events/${ev.id}/results`).set(auth);
  const history = results.body.settingChanges;
  assert.equal(history.length, 5);
  assert.deepEqual(history[0], {
    id: history[0].id,
    field: "end_at",
    oldValue: "2026-12-01T01:00:00.000Z",
    newValue: null,
    changedAt: history[0].changedAt,
    changedBy: "teacher@ctquest.local"
  }, "newest first, with who made it");

  // Another event's history is separate.
  const otherEv = await event({});
  assert.deepEqual((await request(app).get(`/api/events/${otherEv.id}/results`).set(auth)).body.settingChanges, []);
});

// ---------- Feedback timing, changed mid-event ----------

test("loosening feedback: release to end shows a submitted student's breakdown on the next request", async t => {
  const { app, event, edit, key } = await setup(t);
  const ev = await event({});
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
  await submit(app, attempt, { "P5-01": key["P5-01"].right, "P5-02": key["P5-02"].wrong });

  assert.equal((await getAttempt(app, attempt)).body.result.perQuestion, undefined);

  await edit(ev.id, { feedbackMode: "end" });
  const view = (await getAttempt(app, attempt)).body;
  assert.equal(view.result.breakdownReleased, true);
  assert.deepEqual(view.result.perQuestion.map(row => row.correct), [true, false, false, false, false]);
  assert.equal(view.result.perQuestion[1].correctResponse.index, key["P5-02"].right);
});

test("loosening feedback: release to each shows the results of answers already committed", async t => {
  const { app, event, edit, key } = await setup(t);
  const ev = await event({ navigationMode: "linear" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });

  const before = await commit(app, attempt, "P5-01", { response: key["P5-01"].wrong });
  assert.deepEqual(leakedKeys(before.body), []);

  await edit(ev.id, { feedbackMode: "each" });

  const resumed = (await getAttempt(app, attempt)).body;
  assert.equal(resumed.progress.feedbackMode, "each");
  assert.equal(resumed.event.feedbackMode, "each");
  const shown = resumed.progress.committed[0];
  assert.equal(shown.result.correct, false);
  assert.equal(shown.result.correctResponse.index, key["P5-01"].right);

  const next = await commit(app, attempt, "P5-02", { response: key["P5-02"].right });
  assert.equal(next.body.committed.result.correct, true);
});

test("tightening feedback: each to release hides results from then on, and locked answers stay locked", async t => {
  const { app, auth, event, edit, key } = await setup(t);
  const ev = await event({ feedbackMode: "each" });
  const running = await startAttempt(app, { joinCode: ev.joinCode });
  const done = await startAttempt(app, { joinCode: ev.joinCode });

  assert.equal((await commit(app, running.attempt, "P5-02", { response: key["P5-02"].wrong })).body.committed.result.correct, false);
  await commit(app, done.attempt, "P5-01", { response: key["P5-01"].right });
  await submit(app, done.attempt, {});
  assert.ok((await getAttempt(app, done.attempt)).body.result.perQuestion, "visible under each");

  await edit(ev.id, { feedbackMode: "release" });

  // In progress: the committed answer is still listed, without its result,
  // and nothing else in the response carries a key.
  const resumed = (await getAttempt(app, running.attempt)).body;
  assert.deepEqual(resumed.progress.committed, [{ questionId: "P5-02", skipped: false }]);
  assert.equal(resumed.result, null);
  assert.deepEqual(leakedKeys({ progress: resumed.progress, questions: resumed.questions, event: resumed.event }), []);

  // Release + free does not commit any more; the locked answer cannot be
  // reopened by commit or overwritten at submit.
  const again = await commit(app, running.attempt, "P5-02", { response: key["P5-02"].right });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "commit-not-used");
  const sent = await submit(app, running.attempt, { "P5-02": key["P5-02"].right, "P5-03": key["P5-03"].right });
  assert.equal(sent.body.result.score, key["P5-03"].points, "P5-02 keeps its committed wrong answer");
  assert.equal(sent.body.result.breakdownReleased, false);
  assert.equal(sent.body.result.perQuestion, undefined);

  // Submitted before the change: the breakdown is hidden until release.
  const hidden = (await getAttempt(app, done.attempt)).body;
  assert.equal(hidden.result.breakdownReleased, false);
  assert.equal(hidden.result.perQuestion, undefined);
  assert.equal(JSON.stringify(hidden).includes("correctResponse"), false);

  await request(app).post(`/api/events/${ev.id}/release`).set(auth);
  const released = (await getAttempt(app, running.attempt)).body.result.perQuestion;
  assert.equal(released.find(row => row.id === "P5-02").correct, false);
});

test("tightening feedback under in order: each to end keeps commits working but returns no result", async t => {
  const { app, event, edit, key } = await setup(t);
  const ev = await event({ feedbackMode: "each", navigationMode: "linear" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
  await commit(app, attempt, "P5-01", { response: key["P5-01"].right });

  await edit(ev.id, { feedbackMode: "end" });

  const next = await commit(app, attempt, "P5-02", { response: key["P5-02"].right });
  assert.equal(next.status, 200);
  assert.deepEqual(next.body.committed, { questionId: "P5-02", skipped: false });
  assert.deepEqual(leakedKeys(next.body), []);
  assert.equal((await commit(app, attempt, "P5-01", { response: key["P5-01"].wrong })).body.code, "answer-locked");

  const sent = await submit(app, attempt, {});
  assert.equal(sent.body.result.breakdownReleased, true, "end shows the breakdown after submit");
});

// ---------- Navigation, changed mid-event ----------

test("free to in order: forward only from the first open question, earlier free answers still count", async t => {
  const { app, event, edit, key } = await setup(t);
  const ev = await event({});
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });

  await edit(ev.id, { navigationMode: "linear" });
  assert.equal((await getAttempt(app, attempt)).body.progress.navigationMode, "linear");

  // The page commits, in order, what the student had answered up to the
  // first unanswered question. Out of order is refused, and once committed a
  // question cannot be reopened.
  assert.equal((await commit(app, attempt, "P5-03", { response: key["P5-03"].right })).body.code, "out-of-order");
  assert.equal((await commit(app, attempt, "P5-01", { response: key["P5-01"].right })).status, 200);
  assert.equal((await commit(app, attempt, "P5-01", { response: key["P5-01"].wrong })).body.code, "answer-locked");

  // The student had also answered P5-04 while navigation was free. This
  // attempt ran under free navigation, so submit keeps every uncommitted
  // answer it is sent, not only the current question's.
  const sent = await submit(app, attempt, {
    "P5-01": key["P5-01"].wrong,
    "P5-02": key["P5-02"].right,
    "P5-04": key["P5-04"].right
  });
  assert.equal(sent.body.result.score, key["P5-01"].points + key["P5-02"].points + key["P5-04"].points);

  // A student who starts after the change gets the in-order rule in full:
  // only the question they are on counts at submit.
  const later = await startAttempt(app, { joinCode: ev.joinCode });
  const laterSent = await submit(app, later.attempt, { "P5-01": key["P5-01"].right, "P5-02": key["P5-02"].right });
  assert.equal(laterSent.body.result.score, key["P5-01"].points);
});

test("free to in order under each: answers checked out of order stay locked", async t => {
  const { app, event, edit, key } = await setup(t);
  const ev = await event({ feedbackMode: "each" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
  await commit(app, attempt, "P5-03", { response: key["P5-03"].right });

  await edit(ev.id, { navigationMode: "linear" });

  assert.equal((await commit(app, attempt, "P5-03", { response: key["P5-03"].wrong })).body.code, "answer-locked");
  assert.equal((await commit(app, attempt, "P5-02", { response: key["P5-02"].right })).body.code, "out-of-order");
  assert.equal((await commit(app, attempt, "P5-01", { response: key["P5-01"].right })).status, 200);
  assert.equal((await commit(app, attempt, "P5-02", { response: key["P5-02"].right })).status, 200);
  // P5-03 is already committed, so the next open question is P5-04.
  assert.equal((await commit(app, attempt, "P5-04", { response: key["P5-04"].right })).status, 200);

  const committed = (await getAttempt(app, attempt)).body.progress.committed;
  assert.deepEqual(committed.map(item => [item.questionId, item.result.correct]), [["P5-01", true], ["P5-02", true], ["P5-03", true], ["P5-04", true]]);
});

test("in order to free: move freely among uncommitted questions, committed ones stay locked", async t => {
  const { app, event, edit, key } = await setup(t);
  const ev = await event({ feedbackMode: "each", navigationMode: "linear" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
  await commit(app, attempt, "P5-01", { response: key["P5-01"].wrong });
  await commit(app, attempt, "P5-02", { response: null });

  await edit(ev.id, { navigationMode: "free" });

  assert.equal((await commit(app, attempt, "P5-05", { response: key["P5-05"].right })).status, 200, "any order now");
  for (const id of ["P5-01", "P5-02"]) {
    const reopened = await commit(app, attempt, id, { response: key[id].right });
    assert.equal(reopened.status, 409, id);
    assert.equal(reopened.body.code, "answer-locked", id);
  }

  const sent = await submit(app, attempt, { "P5-01": key["P5-01"].right, "P5-02": key["P5-02"].right, "P5-03": key["P5-03"].right });
  assert.equal(sent.body.result.score, key["P5-03"].points + key["P5-05"].points, "free submit takes P5-03; the locked ones keep their stored answers");
});

test("in order to free under release: commits stop, submit takes every uncommitted answer", async t => {
  const { app, event, edit, key } = await setup(t);
  const ev = await event({ navigationMode: "linear" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
  await commit(app, attempt, "P5-01", { response: key["P5-01"].right });

  await edit(ev.id, { navigationMode: "free" });

  assert.equal((await commit(app, attempt, "P5-02", { response: 0 })).body.code, "commit-not-used");
  const resumed = (await getAttempt(app, attempt)).body.progress;
  assert.deepEqual(resumed.committed, [{ questionId: "P5-01", skipped: false }], "the committed answer is still reported as locked");

  const sent = await submit(app, attempt, { "P5-01": key["P5-01"].wrong, "P5-04": key["P5-04"].right, "P5-05": key["P5-05"].right });
  assert.equal(sent.body.result.score, key["P5-01"].points + key["P5-04"].points + key["P5-05"].points);
});

// ---------- Time limit and deadline ----------

test("changing the time limit or deadline recomputes each attempt in progress", async t => {
  const { app, auth, store, event, edit } = await setup(t);
  const ev = await event({ durationMinutes: 30 });
  const running = await startAttempt(app, { joinCode: ev.joinCode });
  const finished = await startAttempt(app, { joinCode: ev.joinCode });
  const reset = await startAttempt(app, { joinCode: ev.joinCode });
  await submit(app, finished.attempt, {});
  await request(app).post(`/api/events/${ev.id}/attempts/${reset.attempt.id}/reset`).set(auth);

  const startedMs = Date.parse(store.getAttempt(running.attempt.id).started_at);
  const frozen = id => attemptRow(store, id).deadline_at;
  const finishedBefore = frozen(finished.attempt.id);
  const resetBefore = frozen(reset.attempt.id);

  const shorter = await edit(ev.id, { durationMinutes: 10 });
  assert.equal(shorter.attemptsUpdated, 1);
  assert.equal(frozen(running.attempt.id), new Date(startedMs + 10 * 60 * 1000).toISOString());

  // A deadline before start + time limit wins.
  const endAt = new Date(startedMs + 5 * 60 * 1000).toISOString();
  await edit(ev.id, { endAt });
  assert.equal(frozen(running.attempt.id), endAt);

  // The student's page reads it on its next request.
  const resumed = (await getAttempt(app, running.attempt)).body;
  assert.equal(resumed.attempt.deadlineAt, endAt);
  assert.equal(resumed.event.endAt, endAt);
  assert.equal(resumed.event.durationMinutes, 10);

  // Longer again: start + time limit, since the deadline moved later.
  await edit(ev.id, { endAt: new Date(startedMs + 60 * 60 * 1000).toISOString(), durationMinutes: 45 });
  assert.equal(frozen(running.attempt.id), new Date(startedMs + 45 * 60 * 1000).toISOString());

  // Neither set: no deadline at all.
  await edit(ev.id, { endAt: null, durationMinutes: null });
  assert.equal(frozen(running.attempt.id), null);

  // Changing only the title leaves deadlines alone.
  assert.equal((await edit(ev.id, { title: "Renamed" })).attemptsUpdated, 0);

  // Submitted and reset attempts keep the deadline they had.
  assert.equal(frozen(finished.attempt.id), finishedBefore);
  assert.equal(frozen(reset.attempt.id), resetBefore);
});

test("a shortened deadline that has passed: commits stop, and the submit is kept and marked late", async t => {
  const { app, store, event, edit, key } = await setup(t);
  const ev = await event({ feedbackMode: "each", durationMinutes: 30 });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
  const inGrace = await startAttempt(app, { joinCode: ev.joinCode });
  await commit(app, attempt, "P5-01", { response: key["P5-01"].right });

  // Well past the deadline plus the 60-second grace window.
  await edit(ev.id, { endAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() });

  const late = await commit(app, attempt, "P5-02", { response: key["P5-02"].right });
  assert.equal(late.status, 409);
  assert.equal(late.body.code, "time-up");

  const sent = await submit(app, attempt, { "P5-02": key["P5-02"].right });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.attempt.late, true);
  assert.equal(sent.body.result.score, key["P5-01"].points + key["P5-02"].points, "nothing is lost");
  assert.equal(attemptRow(store, attempt.id).late, 1);

  // Inside the grace window: not late.
  await edit(ev.id, { endAt: new Date(Date.now() - 5 * 1000).toISOString() });
  const graceSent = await submit(app, inGrace.attempt, { "P5-01": key["P5-01"].right });
  assert.equal(graceSent.status, 200);
  assert.equal(graceSent.body.attempt.late, false);
});

// ---------- Feedback after each question: the key after a wrong answer ----------

test("after each question, a wrong answer shows the correct answer; a right one shows no second answer", async t => {
  const { app, event, key } = await setup(t);
  const ev = await event({ feedbackMode: "each" });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });

  const wrong = (await commit(app, attempt, "P5-01", { response: key["P5-01"].wrong })).body.committed.result;
  assert.equal(wrong.correct, false);
  assert.equal(wrong.response.index, key["P5-01"].wrong);
  assert.equal(wrong.correctResponse.index, key["P5-01"].right);
  assert.equal(typeof wrong.correctResponse.text, "string");

  const right = (await commit(app, attempt, "P5-02", { response: key["P5-02"].right })).body.committed.result;
  assert.equal(right.correct, true);
  assert.equal(right.correctResponse.index, right.response.index);
});

// ---------- Marking a committed answer before submit ----------

test("the teacher can mark a committed AI answer before submit; the total still waits for submit", async t => {
  const { app, auth, store, event, expressApp } = await setup(t, { AI_PROVIDER: "none" });
  const ev = await event({ feedbackMode: "each" }, { filter: { audiences: ["rgsynapse"], questionIds: ["RGS-S1-03", "AIS-S1-01"] } });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });

  await commit(app, attempt, "AIS-S1-01", { response: "Line 3 is not indented, so it runs once after the loop." });
  await expressApp.locals.scoringQueue.drain();
  assert.equal((await getAttempt(app, attempt)).body.progress.committed[0].result.status, "needs-review");

  const review = path => request(app).post(`/api/events/${ev.id}/attempts/${attempt.id}/answers/${path}/review`).set(auth);

  // An uncommitted question has nothing to mark yet.
  assert.equal((await review("RGS-S1-03").send({ score: 1 })).status, 404);

  const marked = await review("AIS-S1-01").send({ score: 2, feedback: "Right: the unindented line runs once." });
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  assert.equal(marked.body.attempt.score, null, "no total while the attempt is in progress");

  const shown = (await getAttempt(app, attempt)).body.progress.committed[0].result;
  assert.equal(shown.status, "scored");
  assert.equal(shown.earned, 2);
  assert.deepEqual(shown.detail, { source: "teacher", feedback: "Right: the unindented line runs once." });

  const sent = await submit(app, attempt, {});
  assert.equal(sent.body.result.score, 2);
  assert.equal(attemptRow(store, attempt.id).score, 2);

  // A reset attempt's answers cannot be marked.
  const other = await startAttempt(app, { joinCode: ev.joinCode });
  await commit(app, other.attempt, "AIS-S1-01", { response: "It runs once." });
  await request(app).post(`/api/events/${ev.id}/attempts/${other.attempt.id}/reset`).set(auth);
  const resetMark = await request(app).post(`/api/events/${ev.id}/attempts/${other.attempt.id}/answers/AIS-S1-01/review`).set(auth).send({ score: 1 });
  assert.equal(resetMark.status, 404);
});

test("committed AI answers on a reset attempt are not sent to the provider", async t => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("no network in tests");
  };
  t.after(() => {
    globalThis.fetch = original;
  });

  const { app, auth, store, event, expressApp } = await setup(t, { AI_PROVIDER: "openrouter", AI_API_KEY: "sk-or-test-key" });
  const queue = expressApp.locals.scoringQueue;
  queue.stop();

  const ev = await event({ feedbackMode: "each" }, { filter: { audiences: ["rgsynapse"], questionIds: ["AIS-S1-01"] } });
  const { attempt } = await startAttempt(app, { joinCode: ev.joinCode });
  await commit(app, attempt, "AIS-S1-01", { response: "Line 3 runs once." });
  await request(app).post(`/api/events/${ev.id}/attempts/${attempt.id}/reset`).set(auth);

  assert.deepEqual(store.listPendingAnswers(10), []);
  queue.start();
  await queue.drain();
  assert.equal(calls, 0);
  assert.equal(store.db.prepare("SELECT score_status FROM answers WHERE attempt_id = ?").get(attempt.id).score_status, "pending");
});

// ---------- Preset provenance ----------

test("events record the preset and knob values they came from, and whether Customise changed them", async t => {
  const { app, auth, event, store } = await setup(t);

  const fromCard = await event({}, { preset: { id: "loops-conditionals", who: "rgsynapse:S1", length: "short" } });
  assert.deepEqual(fromCard.event.preset, {
    id: "loops-conditionals",
    options: { who: "rgsynapse:S1", length: "short" },
    customised: false,
    summary: "Loops and conditionals (RGSynapse Secondary 1, short)"
  });

  // Knobs left out are stored at their defaults.
  const defaults = await event({}, { preset: { id: "core-ct-check" } });
  assert.deepEqual(defaults.event.preset.options, { who: "core", emphasis: "all", length: "full" });
  assert.equal(defaults.event.preset.summary, "Core CT check (P5 to S2)", "a core-only preset at all levels needs no audience note");
  const core = await event({}, { preset: { id: "core-ct-check", who: "core:P6", emphasis: "practices" } });
  assert.equal(core.event.preset.summary, "Core CT check (P5 to S2) (Core Primary 6, Practices)");
  const loopsCore = await event({}, { preset: { id: "loops-conditionals", who: "core" } });
  assert.equal(loopsCore.event.preset.summary, "Loops and conditionals (Core, all levels)", "named when the preset spans audiences");

  // Opened Customise, changed nothing (lists in another order): still the preset.
  const compiled = (await request(app).post("/api/question-bank/preview").set(auth).send({ preset: { id: "rgs-s2", emphasis: "concepts" } })).body.filter;
  const unchanged = await event({}, { filter: { ...compiled, levels: compiled.levels.slice().reverse() }, basedOnPreset: { id: "rgs-s2", emphasis: "concepts" } });
  assert.equal(unchanged.event.preset.customised, false);
  assert.equal(unchanged.event.preset.summary, "RGSynapse Sec 2 (Concepts)");

  const tuned = await event({}, { filter: { ...compiled, limit: 3 }, basedOnPreset: { id: "rgs-s2", emphasis: "concepts" } });
  assert.deepEqual(tuned.event.preset, {
    id: "rgs-s2",
    options: { emphasis: "concepts", length: "full" },
    customised: true,
    summary: "RGSynapse Sec 2 (Concepts)"
  });

  const custom = await event({}, { filter: { audiences: ["core"], levels: ["P5"] } });
  assert.equal(custom.event.preset, null);
  const legacy = await event({}, { selectionMode: "P6" });
  assert.equal(legacy.event.preset, null);

  const bad = await request(app).post("/api/events").set(auth).send({ title: "Bad", filter: compiled, basedOnPreset: { id: "no-such-preset" } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /basedOnPreset: unknown preset "no-such-preset"/);

  // Stored in the columns, and returned by the list and results APIs.
  const row = store.db.prepare("SELECT preset_id, preset_options_json, preset_customised FROM events WHERE id = ?").get(tuned.id);
  assert.deepEqual(row, { preset_id: "rgs-s2", preset_options_json: JSON.stringify({ emphasis: "concepts", length: "full" }), preset_customised: 1 });

  const listed = (await request(app).get("/api/events").set(auth)).body.events;
  assert.equal(listed.find(item => item.id === fromCard.id).preset.summary, "Loops and conditionals (RGSynapse Secondary 1, short)");
  assert.equal(listed.find(item => item.id === custom.id).preset, null);
  assert.equal(listed.find(item => item.join_code === "DEMO123").preset, null, "the seeded demo event has none");
  assert.equal((await request(app).get(`/api/events/${tuned.id}/results`).set(auth)).body.event.preset.customised, true);

  // Students never see it.
  const joined = await request(app).post("/api/events/join").send({ joinCode: fromCard.joinCode });
  assert.equal(joined.body.event.preset, undefined);
});
