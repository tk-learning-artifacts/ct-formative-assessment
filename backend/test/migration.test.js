// Upgrading a v1 database. fixtures/v1-app.sql is a dump of a database made by
// the original code on main: the seeded teacher and DEMO123, a P6-only event,
// one submitted attempt (Ada, 16/90) and one attempt still in progress (Grace).

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const Database = require("better-sqlite3");
const { buildApp, makeTempDir, login, startAttempt, submit } = require("./helpers");
const { LATEST_VERSION } = require("../src/migrations");

const FIXTURE = path.join(__dirname, "fixtures/v1-app.sql");

function writeV1Database(dir) {
  const dbPath = path.join(dir, "app.db");
  const db = new Database(dbPath);
  db.exec(fs.readFileSync(FIXTURE, "utf8"));
  assert.equal(db.pragma("user_version", { simple: true }), 0);
  db.close();
  return dbPath;
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(col => `${col.name}:${col.type}:${col.notnull}:${col.dflt_value}`).sort();
}

function schemaSummary(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  return { tables: Object.fromEntries(tables.map(table => [table, columns(db, table)])), indexes };
}

test("migrating a v1 database", async t => {
  const dir = makeTempDir();
  const dbPath = writeV1Database(dir);
  let ctx = buildApp({ dbPath });
  t.after(() => {
    ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const { db } = ctx.store;

  await t.test("reaches the latest version and backs up the v1 file first", () => {
    assert.equal(db.pragma("user_version", { simple: true }), LATEST_VERSION);
    assert.deepEqual(ctx.store.migration.applied, [1, 2, 3]);
    assert.ok(ctx.store.migration.backupPath);

    const backup = new Database(ctx.store.migration.backupPath, { readonly: true });
    assert.equal(backup.pragma("user_version", { simple: true }), 0);
    assert.equal(backup.prepare("SELECT COUNT(*) AS c FROM answers").get().c, 20);
    backup.close();
  });

  await t.test("keeps every row", () => {
    const count = table => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
    assert.equal(count("users"), 1);
    assert.equal(count("events"), 2);
    assert.equal(count("event_questions"), 25);
    assert.equal(count("attempts"), 2);
    assert.equal(count("answers"), 20);

    const ada = db.prepare("SELECT * FROM attempts WHERE student_name = 'Ada'").get();
    assert.equal(ada.status, "submitted");
    assert.equal(ada.score, 16);
    assert.equal(ada.max_score, 90);
    assert.equal(ada.deadline_at, new Date(Date.parse(ada.started_at) + 45 * 60 * 1000).toISOString());

    const answer = db.prepare("SELECT * FROM answers WHERE attempt_id = ? AND question_id = 'P5-01'").get(ada.id);
    assert.equal(answer.chosen_index, 3);
    assert.equal(answer.response_json, "3");
    assert.equal(answer.question_type, "mcq");
    assert.equal(answer.score_status, "scored");

    const unanswered = db.prepare("SELECT * FROM answers WHERE attempt_id = ? AND chosen_index IS NULL LIMIT 1").get(ada.id);
    assert.equal(unanswered.response_json, "null");
  });

  await t.test("ends with the same schema as a fresh database", () => {
    const fresh = buildApp();
    try {
      assert.deepEqual(schemaSummary(db), schemaSummary(fresh.store.db));
    } finally {
      fresh.cleanup();
    }
  });

  await t.test("rewrites snapshots to the v2 shape and fixes the four bad questions", () => {
    const snapshot = id => JSON.parse(db.prepare("SELECT question_json FROM event_questions WHERE event_id = 1 AND question_id = ?").get(id).question_json);

    const all = db.prepare("SELECT question_json FROM event_questions").all().map(row => JSON.parse(row.question_json));
    assert.ok(all.every(question => question.type === "mcq" && question.answer && question.answerIndex === undefined));

    assert.equal(snapshot("P6-01").answer.index, 0);
    assert.deepEqual(snapshot("S2-02").options, ["4", "6", "7", "8"]);
    assert.equal(snapshot("S2-02").answer.index, 0);
    assert.equal(snapshot("S1-01").options[1], "The Else line runs and returns B");
    assert.equal(snapshot("S1-01").answer.index, 1);
    assert.equal(snapshot("P5-01").options[1], "3, 2, 1");

    const p6Event = JSON.parse(db.prepare("SELECT question_json FROM event_questions WHERE event_id = 2 AND question_id = 'P6-01'").get().question_json);
    assert.equal(p6Event.answer.index, 0);
  });

  await t.test("the v1 teacher can log in with the old hash, which is then upgraded", async () => {
    const before = db.prepare("SELECT password_hash FROM users WHERE id = 1").get().password_hash;
    assert.match(before, /^[0-9a-f]{128}$/);
    await login(ctx.app);
    assert.match(db.prepare("SELECT password_hash FROM users WHERE id = 1").get().password_hash, /^scrypt\$/);
  });

  await t.test("the teacher sees the v1 events and Ada's result", async () => {
    const token = await login(ctx.app);
    const events = (await request(ctx.app).get("/api/events").set("Authorization", `Bearer ${token}`)).body.events;
    assert.deepEqual(events.map(event => event.join_code).sort(), ["DEMO123", "P6RND"]);
    assert.equal(events.find(event => event.join_code === "P6RND").filter_summary, "audiences: core / levels: P6");

    const results = await request(ctx.app).get("/api/events/1/results").set("Authorization", `Bearer ${token}`);
    const ada = results.body.attempts.find(attempt => attempt.student_name === "Ada");
    assert.equal(ada.score, 16);
    assert.equal(ada.answers.length, 20);
  });

  await t.test("an attempt started before the upgrade has no token and cannot be submitted", async () => {
    const grace = db.prepare("SELECT id FROM attempts WHERE student_name = 'Grace'").get();
    const res = await submit(ctx.app, { id: grace.id }, {}, "anything");
    assert.equal(res.status, 403);
    assert.match(res.body.error, /start the test again/);
  });

  await t.test("new attempts on the migrated DEMO123 are scored with the corrected keys", async () => {
    const { attempt } = await startAttempt(ctx.app);
    const res = await submit(ctx.app, attempt, { "P6-01": 0, "S2-02": 0, "S1-01": 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.score, 4 + 6 + 5);
  });

  await t.test("reopening is a no-op", () => {
    ctx.close();
    const backupsBefore = fs.readdirSync(dir).filter(name => name.includes(".pre-v")).length;
    ctx = buildApp({ dbPath });
    assert.deepEqual(ctx.store.migration.applied, []);
    assert.equal(ctx.store.migration.backupPath, null);
    assert.equal(fs.readdirSync(dir).filter(name => name.includes(".pre-v")).length, backupsBefore);
    assert.equal(ctx.store.db.prepare("SELECT COUNT(*) AS c FROM events").get().c, 2);
  });
});

test("a database newer than the code is refused", () => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, "app.db");
  const db = new Database(dbPath);
  db.pragma(`user_version = ${LATEST_VERSION + 1}`);
  db.close();

  assert.throws(() => buildApp({ dbPath }), /newer than this code/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a failing migration rolls back and leaves the version unchanged", () => {
  const { migrate, MIGRATIONS } = require("../src/migrations");
  const db = new Database(":memory:");
  const broken = { version: MIGRATIONS.length + 1, name: "broken", up: d => { d.exec("CREATE TABLE half_done (id INTEGER)"); throw new Error("boom"); } };

  migrate(db);
  MIGRATIONS.push(broken);
  try {
    assert.throws(() => migrate(db), /boom/);
    assert.equal(db.pragma("user_version", { simple: true }), LATEST_VERSION);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get(), undefined);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  } finally {
    MIGRATIONS.pop();
    db.close();
  }
});
