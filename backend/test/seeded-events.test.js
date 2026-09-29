// The events every server has from its first boot (content/seeded-events.json,
// src/db.js ensureSeededEvents), and scripts/delete-event.js.
//
// The app is built with the demo teacher's credentials passed explicitly, so
// these tests do not depend on SEED_TEACHER_* being unset in the shell.

const fs = require("fs");
const path = require("path");
const os = require("os");
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const request = require("supertest");
const { buildApp, login, startAttempt, DEMO_TEACHER } = require("./helpers");
const { openDatabase } = require("../src/db");
const { loadContent } = require("../src/content");

const CONTENT_DIR = path.join(__dirname, "../content");
const ENV = { SEED_TEACHER_EMAIL: DEMO_TEACHER.email, SEED_TEACHER_PASSWORD: DEMO_TEACHER.password };
const auth = token => ({ Authorization: `Bearer ${token}` });

test("a new database has the RGSynapse challenge: 20 questions, half multiple choice, harder, none AI scored", async t => {
  const ctx = await buildApp({ env: ENV });
  t.after(() => ctx.cleanup());
  const token = await login(ctx.app);
  const list = await request(ctx.app).get("/api/events").set(auth(token));
  const event = list.body.events.find(item => item.join_code === "RGSYN2");

  assert.ok(event, list.body.events.map(item => item.join_code).join(","));
  assert.equal(event.title, "RGSynapse challenge");
  assert.equal(event.question_count, 20);
  assert.equal(event.owner_email, DEMO_TEACHER.email);
  assert.ok(list.body.events.some(item => item.join_code === "DEMO123"), "the demo event is still seeded");

  const questions = (await request(ctx.app).get(`/api/events/${event.id}/questions`).set(auth(token))).body.questions;
  const byType = questions.reduce((acc, question) => ({ ...acc, [question.type]: (acc[question.type] || 0) + 1 }), {});
  assert.equal(byType.mcq, 10, JSON.stringify(byType));
  assert.equal(questions.length - byType.mcq, 10);
  assert.ok(!("open-response-ai" in byType), "every answer is marked at once");
  assert.ok(questions.every(question => question.audience === "rgsynapse"));
  assert.ok(questions.every(question => question.difficulty >= 3), "difficulty 3 and 4 only");
  assert.ok(new Set(questions.map(question => question.level)).size === 2, "Sec 1 and Sec 2");
  assert.equal(new Set(questions.map(question => question.id)).size, 20);
});

test("students see the questions in the order the file lists", async t => {
  const ctx = await buildApp({ env: ENV });
  t.after(() => ctx.cleanup());
  const seeded = loadContent(CONTENT_DIR).seededEvents.find(item => item.joinCode === "RGSYN2");
  const attempt = await startAttempt(ctx.app, { joinCode: "RGSYN2" });

  assert.deepEqual(attempt.questions.map(question => question.id), seeded.questionIds);
  assert.equal(attempt.event.joinCode, "RGSYN2");
});

test("restarting never duplicates or resets a seeded event, and keeps a teacher's edits", async t => {
  const ctx = await buildApp({ env: ENV });
  t.after(() => ctx.cleanup());
  const token = await login(ctx.app);
  const list = () => request(ctx.app).get("/api/events").set(auth(token));
  const event = (await list()).body.events.find(item => item.join_code === "RGSYN2");
  const edited = await request(ctx.app).patch(`/api/events/${event.id}`).set(auth(token)).send({ title: "Renamed by a teacher", durationMinutes: 50 });
  assert.equal(edited.status, 200);

  const { dbPath } = ctx;
  ctx.close();
  const reopened = openDatabase({ dbPath, seedTeacher: null });
  t.after(() => reopened.close());
  const events = reopened.listEvents().filter(item => item.join_code === "RGSYN2");
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Renamed by a teacher");
  assert.equal(events[0].duration_minutes, 50);
});

test("a server that already has events gets a newly seeded one added, owned by its admin", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctquest-seeded-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, "app.db");

  // A server from before the event existed: no seeded events, one hand-made event.
  const first = openDatabase({ dbPath, seedTeacher: { email: DEMO_TEACHER.email, password: DEMO_TEACHER.password }, seedEvents: false });
  const admin = first.findUserByEmail(DEMO_TEACHER.email);
  first.createEventWithQuestions({ title: "Made by hand", joinCode: "HAND22", selectionMode: "P5", createdBy: admin.id });
  assert.equal(first.listEvents().some(item => item.join_code === "RGSYN2"), false);
  first.close();

  const second = openDatabase({ dbPath, seedTeacher: null });
  t.after(() => second.close());
  const codes = second.listEvents().map(item => item.join_code).sort();
  assert.deepEqual(codes, ["DEMO123", "HAND22", "RGSYN2"]);
  assert.equal(second.listEvents().find(item => item.join_code === "RGSYN2").owner_email, DEMO_TEACHER.email);
});

test("SEED_EVENTS=false leaves the seeded events out", async t => {
  const ctx = await buildApp({ env: { ...ENV, SEED_EVENTS: "false" } });
  t.after(() => ctx.cleanup());
  const token = await login(ctx.app);
  const list = await request(ctx.app).get("/api/events").set(auth(token));
  assert.deepEqual(list.body.events.map(item => item.join_code), ["DEMO123"]);
});

test("a retired question is left out of a seeded event rather than stopping start-up", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctquest-seeded-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, "app.db");
  const first = openDatabase({ dbPath, seedTeacher: { email: DEMO_TEACHER.email, password: DEMO_TEACHER.password }, seedEvents: false });
  const admin = first.findUserByEmail(DEMO_TEACHER.email);
  first.db.prepare("INSERT INTO question_overrides (question_id, retired_at, retired_by, updated_at) VALUES ('RGS-S1-01', 'now', ?, 'now')").run(admin.id);
  first.close();

  const second = openDatabase({ dbPath, seedTeacher: null });
  t.after(() => second.close());
  const event = second.listEvents().find(item => item.join_code === "RGSYN2");
  assert.equal(event.question_count, 19);
});

test("the content check names a seeded event that lists an unknown or wrong-audience question", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctquest-content-"));
  fs.cpSync(CONTENT_DIR, dir, { recursive: true });
  const file = path.join(dir, "seeded-events.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  data.events[0].questionIds[0] = "NOPE-01";
  data.events[0].questionIds[1] = "P5-01";
  data.events[0].joinCode = "RGS01O";
  fs.writeFileSync(file, JSON.stringify(data));

  try {
    assert.throws(() => loadContent(dir), error => {
      const text = error.contentErrors.join("\n");
      return /unknown question "NOPE-01"/.test(text) && /"P5-01", which is a core question, not rgsynapse/.test(text) && /join code/.test(text);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("delete-event shows what it would delete, then deletes the event with its attempts", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctquest-delete-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, "app.db");
  const ctx = await buildApp({ dbPath, env: ENV });
  await startAttempt(ctx.app, { joinCode: "RGSYN2" });
  ctx.close();

  const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, "../scripts/delete-event.js"), ...args], {
    env: { PATH: process.env.PATH, DB_PATH: dbPath },
    encoding: "utf8"
  });

  const dry = run("RGSYN2");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Would delete "RGSynapse challenge" \(RGSYN2\).*20 questions, 1 attempts \(1 not reset\)/);

  const check = openDatabase({ dbPath, seedTeacher: null, seedEvents: false });
  assert.ok(check.listEvents().some(item => item.join_code === "RGSYN2"), "a dry run deletes nothing");
  check.close();

  assert.notEqual(run("NOSUCH").status, 0);
  assert.notEqual(run().status, 0);

  const done = run("rgsyn2", "--yes");
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /Deleted "RGSynapse challenge"/);

  const after = openDatabase({ dbPath, seedTeacher: null, seedEvents: false });
  t.after(() => after.close());
  assert.equal(after.listEvents().some(item => item.join_code === "RGSYN2"), false);
  assert.equal(after.db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE event_id NOT IN (SELECT id FROM events)").get().n, 0);
  assert.equal(after.db.prepare("SELECT COUNT(*) AS n FROM event_questions WHERE event_id NOT IN (SELECT id FROM events)").get().n, 0);
  assert.equal(after.db.prepare("SELECT COUNT(*) AS n FROM answers WHERE attempt_id NOT IN (SELECT id FROM attempts)").get().n, 0);
  assert.ok(after.listEvents().some(item => item.join_code === "DEMO123"), "other events are untouched");
});
