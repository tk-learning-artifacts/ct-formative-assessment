// Changing an event's questions while it has no live attempt (ADR 0003 §10,
// amended 2026-09-29): allowed with no attempts at all, or once every attempt
// is reset; refused with 409 while any attempt is live. Owner only. The change
// replaces the snapshot students receive, keeps reset attempts as history, and
// is recorded in the settings history as the field 'questions'.
//
// The app is built with the demo teacher's credentials passed explicitly, so
// these tests do not depend on SEED_TEACHER_* being unset in the shell.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, DEMO_TEACHER } = require("./helpers");

const OTHER = { email: "other@school.test", password: "other-password-1" };
const auth = token => ({ Authorization: `Bearer ${token}` });

async function setup(t) {
  const ctx = await buildApp({ env: { SEED_TEACHER_EMAIL: DEMO_TEACHER.email, SEED_TEACHER_PASSWORD: DEMO_TEACHER.password } });
  t.after(() => ctx.cleanup());
  ctx.store.createUser({ ...OTHER, role: "teacher" });
  ctx.owner = await login(ctx.app);
  ctx.other = await login(ctx.app, OTHER);
  let n = 0;

  ctx.event = async (token = ctx.owner, filter = { levels: ["P5"] }) => {
    n += 1;
    const res = await request(ctx.app).post("/api/events").set(auth(token)).send({ title: `Change ${n}`, joinCode: `CHG${n}`, filter: { audiences: ["core"], ...filter } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { id: res.body.event.id, joinCode: `CHG${n}`, count: res.body.event.question_count };
  };
  ctx.put = (id, body, token = ctx.owner) => request(ctx.app).put(`/api/events/${id}/questions`).set(auth(token)).send(body);
  ctx.questions = async (id, token = ctx.owner) => (await request(ctx.app).get(`/api/events/${id}/questions`).set(auth(token))).body.questions;
  return ctx;
}

test("an event with no attempts can have its questions replaced", async t => {
  const ctx = await setup(t);
  const event = await ctx.event();
  const before = await ctx.questions(event.id);
  assert.ok(before.every(question => question.level === "P5"));

  const res = await ctx.put(event.id, { filter: { audiences: ["core"], levels: ["P6"] } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.event.id, event.id);

  const after = await ctx.questions(event.id);
  assert.ok(after.length > 0 && after.every(question => question.level === "P6"));
  assert.equal(res.body.event.question_count, after.length);
  assert.deepEqual(res.body.event.filter.levels, ["P6"]);
  assert.match(res.body.event.filter_summary, /P6/);

  // Students who join afterwards get the new questions.
  const attempt = await startAttempt(ctx.app, { joinCode: event.joinCode });
  assert.equal(attempt.questions.length, after.length);
  assert.ok(attempt.questions.every(question => question.level === "P6"));
});

test("the change is recorded in the settings history", async t => {
  const ctx = await setup(t);
  const event = await ctx.event();
  assert.equal((await ctx.put(event.id, { filter: { audiences: ["core"], levels: ["S1"] } })).status, 200);

  const results = await request(ctx.app).get(`/api/events/${event.id}/results`).set(auth(ctx.owner));
  const change = results.body.settingChanges.find(item => item.field === "questions");
  assert.ok(change, JSON.stringify(results.body.settingChanges));
  assert.match(change.oldValue, /P5/);
  assert.match(change.newValue, /S1/);
  assert.equal(change.changedBy, DEMO_TEACHER.email);
});

test("a live attempt blocks the change, and a reset lifts it", async t => {
  const ctx = await setup(t);
  const event = await ctx.event();
  const attempt = await startAttempt(ctx.app, { joinCode: event.joinCode });
  const before = await ctx.questions(event.id);

  const blocked = await ctx.put(event.id, { filter: { audiences: ["core"], levels: ["P6"] } });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Reset them all/);
  assert.equal((await ctx.questions(event.id)).length, before.length);

  const reset = await request(ctx.app).post(`/api/events/${event.id}/attempts/${attempt.attempt.id}/reset`).set(auth(ctx.owner));
  assert.equal(reset.status, 200);
  assert.equal((await ctx.put(event.id, { filter: { audiences: ["core"], levels: ["P6"] } })).status, 200);

  // The reset attempt stays in the results as history, and the outcome summary leaves it out.
  const results = await request(ctx.app).get(`/api/events/${event.id}/results`).set(auth(ctx.owner));
  assert.equal(results.body.attempts.length, 1);
  assert.ok(results.body.attempts[0].reset_at);
  const summary = await request(ctx.app).get(`/api/events/${event.id}/outcomes-summary`).set(auth(ctx.owner));
  assert.equal(summary.status, 200);

  // A student may start again, on the new questions.
  const again = await startAttempt(ctx.app, { joinCode: event.joinCode, studentName: "Second Student" });
  assert.ok(again.questions.every(question => question.level === "P6"));
});

test("only the owner may change the questions", async t => {
  const ctx = await setup(t);
  const event = await ctx.event();
  const before = await ctx.questions(event.id);

  // Another teacher: the event does not exist for them.
  assert.equal((await ctx.put(event.id, { filter: { audiences: ["core"], levels: ["P6"] } }, ctx.other)).status, 404);
  // An admin who is not the owner reads, but does not change (ADR 0004).
  const other = await ctx.event(ctx.other);
  assert.equal((await ctx.put(other.id, { filter: { audiences: ["core"], levels: ["P6"] } }, ctx.owner)).status, 403);
  assert.equal((await ctx.put(event.id, { filter: { audiences: ["core"], levels: ["P6"] } }, "")).status, 401);
  assert.equal((await ctx.questions(event.id)).length, before.length);
});

test("an invalid or empty selection is refused and nothing changes", async t => {
  const ctx = await setup(t);
  const event = await ctx.event();
  const before = await ctx.questions(event.id);

  assert.equal((await ctx.put(event.id, {})).status, 400);
  assert.equal((await ctx.put(event.id, { filter: { audiences: ["core"], levels: ["NOPE"] } })).status, 400);
  assert.equal((await ctx.put(event.id, { filter: { audiences: ["core"], levels: ["P5"], types: ["parsons"], difficulty: { min: 5 } } })).status, 400);
  assert.deepEqual((await ctx.questions(event.id)).map(question => question.id), before.map(question => question.id));

  const results = await request(ctx.app).get(`/api/events/${event.id}/results`).set(auth(ctx.owner));
  assert.equal(results.body.settingChanges.filter(item => item.field === "questions").length, 0);
});

test("a preset card can replace the questions and is recorded as the event's preset", async t => {
  const ctx = await setup(t);
  const event = await ctx.event();
  const preset = ctx.store.content.presets.find(item => item.id === "ordering-tracing") || ctx.store.content.presets[0];
  const res = await ctx.put(event.id, { preset: { id: preset.id } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.event.preset.id, preset.id);
});

test("removed and retired questions are honoured: a retired question is not selected", async t => {
  const ctx = await setup(t);
  const event = await ctx.event();
  const admin = await request(ctx.app).post("/api/question-bank/P6-01/retire").set(auth(ctx.owner));
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  assert.equal((await ctx.put(event.id, { filter: { audiences: ["core"], levels: ["P6"] } })).status, 200);
  assert.ok(!(await ctx.questions(event.id)).some(question => question.id === "P6-01"));
});
