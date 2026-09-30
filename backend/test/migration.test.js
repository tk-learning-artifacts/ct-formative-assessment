// Upgrading a v1 database. fixtures/v1-app.sql is a dump of a database made by
// the original code on main: the seeded teacher and DEMO123, a P6-only event
// (P6RND, no attempts), and on DEMO123:
//   Ada   submitted, 16/90
//   Grace started, never submitted
//   Chen  submitted 15/90, chose the options migration 202609260200 changes or
//         re-keys: P5-01 "3, 1, 2", P6-01 "7 steps", S1-01 "B", S2-02 "8"
//   Dev   submitted 3/90, chose the other side of each

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const Database = require("better-sqlite3");
const { buildApp, makeTempDir, login, startAttempt, submit } = require("./helpers");

// These tests open old databases to check the upgrade and count their events,
// so the events every server seeds (content/seeded-events.json) are left out.
const NO_SEEDED_EVENTS = { SEED_EVENTS: "false" };
const { migrate, MIGRATIONS } = require("../src/migrations");

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
  let ctx = await buildApp({ dbPath, env: NO_SEEDED_EVENTS });
  t.after(() => {
    ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const { db } = ctx.store;
  const auth = { Authorization: `Bearer ${await login(ctx.app)}` };

  const attemptByName = name => db.prepare("SELECT * FROM attempts WHERE student_name = ?").get(name);
  const answer = (name, questionId) => db.prepare("SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?").get(attemptByName(name).id, questionId);
  const snapshot = (joinCode, questionId) => JSON.parse(db.prepare(`
    SELECT q.question_json FROM event_questions q JOIN events e ON e.id = q.event_id
    WHERE e.join_code = ? AND q.question_id = ?
  `).get(joinCode, questionId).question_json);

  await t.test("records every migration by id and backs up the v1 file first", () => {
    const ids = db.prepare("SELECT id FROM schema_migrations ORDER BY id").all().map(row => row.id);
    assert.deepEqual(ids, MIGRATIONS.map(migration => migration.id));
    assert.deepEqual(ctx.store.migration.applied, ids);
    assert.ok(ctx.store.migration.backupPath);

    const backup = new Database(ctx.store.migration.backupPath, { readonly: true });
    assert.equal(backup.prepare("SELECT COUNT(*) AS c FROM answers").get().c, 60);
    assert.equal(backup.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").get(), undefined);
    backup.close();
  });

  await t.test("keeps every row and every awarded score", () => {
    const count = table => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
    assert.equal(count("users"), 1);
    assert.equal(count("events"), 2);
    assert.equal(count("event_questions"), 25);
    assert.equal(count("attempts"), 4);
    assert.equal(count("answers"), 60);

    assert.deepEqual(["Ada", "Chen", "Dev"].map(name => attemptByName(name).score), [16, 15, 3]);
    const ada = attemptByName("Ada");
    assert.equal(ada.deadline_at, new Date(Date.parse(ada.started_at) + 45 * 60 * 1000).toISOString());
    assert.equal(ada.late, 0);
    assert.equal(ada.student_key, "ada\u001fs1-2");
  });

  await t.test("answers record the option text the student actually chose", () => {
    const chen = [["P5-01", 1, "3, 1, 2", 0], ["P6-01", 1, "7 steps", 4], ["S1-01", 1, "B", 5], ["S2-02", 2, "8", 6]];

    chen.forEach(([questionId, index, text, earned]) => {
      const row = answer("Chen", questionId);
      assert.deepEqual(JSON.parse(row.response_json), { index, text }, questionId);
      assert.equal(row.earned_points, earned, questionId);
      assert.equal(row.question_type, "mcq");
      assert.equal(row.score_status, "scored");
      assert.equal(row.detail_json, null);
    });

    assert.deepEqual(JSON.parse(answer("Dev", "S1-01").response_json), { index: 0, text: "3" });
    assert.equal(answer("Ada", "S1-02").response_json, "null");
  });

  await t.test("an event with submissions keeps the snapshot its students saw", () => {
    assert.equal(snapshot("DEMO123", "P6-01").answer.index, 1);
    assert.deepEqual(snapshot("DEMO123", "S2-02").options, ["6", "7", "8", "9"]);
    assert.equal(snapshot("DEMO123", "S1-01").options[1], "B");
    assert.equal(snapshot("DEMO123", "P5-01").options[1], "3, 1, 2");
  });

  await t.test("an event without submissions gets the corrected question", () => {
    assert.equal(snapshot("P6RND", "P6-01").answer.index, 0);
  });

  await t.test("snapshots are in the v2 shape with tags backfilled from the bank", () => {
    const all = db.prepare("SELECT question_json FROM event_questions").all().map(row => JSON.parse(row.question_json));
    assert.ok(all.every(q => q.type === "mcq" && q.answer && q.answerIndex === undefined));
    assert.ok(all.every(q => q.ontology.length && q.outcomes.length));
    assert.deepEqual(snapshot("DEMO123", "P6-01").ontology, ["concept.data.structures.paths"]);
  });

  await t.test("the teacher's view pairs each old answer with the options it was chosen from", async () => {
    const results = await request(ctx.app).get("/api/events/1/results").set(auth);
    const chen = results.body.attempts.find(a => a.student_name === "Chen");
    const s202 = chen.answers.find(a => a.questionId === "S2-02");
    assert.equal(s202.response.text, "8");
    assert.equal(snapshot("DEMO123", "S2-02").options[s202.response.index], "8");
    assert.equal(chen.score, 15);
  });

  await t.test("events from before the upgrade keep showing students their breakdown", () => {
    const events = db.prepare("SELECT results_released_at FROM events").all();
    assert.ok(events.every(event => event.results_released_at));
  });

  await t.test("ends with the same schema as a fresh database", async () => {
    const fresh = await buildApp();
    try {
      assert.deepEqual(schemaSummary(db), schemaSummary(fresh.store.db));
    } finally {
      fresh.cleanup();
    }
  });

  await t.test("the v1 teacher can log in with the old hash, which is then upgraded", () => {
    assert.match(db.prepare("SELECT password_hash FROM users WHERE id = 1").get().password_hash, /^scrypt\$/);
  });

  await t.test("an attempt started before the upgrade cannot be submitted, and does not block a restart", async () => {
    const grace = attemptByName("Grace");
    const res = await submit(ctx.app, { id: grace.id }, {}, null);
    assert.equal(res.status, 403);
    assert.match(res.body.error, /start the activity again/);

    const again = await request(ctx.app).post("/api/attempts").send({ joinCode: "DEMO123", studentName: "Grace", studentGroup: "S2-1" });
    assert.equal(again.status, 201);

    const chenAgain = await request(ctx.app).post("/api/attempts").send({ joinCode: "DEMO123", studentName: "chen", studentGroup: "s1-3" });
    assert.equal(chenAgain.status, 409);
  });

  await t.test("new attempts on the patched event are scored with the corrected key", async () => {
    const { attempt } = await startAttempt(ctx.app, { joinCode: "P6RND" });
    const res = await submit(ctx.app, attempt, { "P6-01": 0 });
    assert.equal(res.body.result.score, 4);
  });

  await t.test("reopening is a no-op", async () => {
    ctx.close();
    const backupsBefore = fs.readdirSync(dir).filter(name => name.includes(".pre-")).length;
    ctx = await buildApp({ dbPath, env: NO_SEEDED_EVENTS });
    assert.deepEqual(ctx.store.migration.applied, []);
    assert.equal(ctx.store.migration.backupPath, null);
    assert.equal(fs.readdirSync(dir).filter(name => name.includes(".pre-")).length, backupsBefore);
    assert.equal(ctx.store.db.prepare("SELECT COUNT(*) AS c FROM events").get().c, 2);
  });
});

test("a database with migrations this code does not know is refused", async () => {
  const dir = makeTempDir();
  const first = await buildApp({ dbPath: path.join(dir, "app.db"), env: NO_SEEDED_EVENTS });
  first.store.db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES ('209912312359-from-the-future', 'x')").run();
  first.close();

  await assert.rejects(() => buildApp({ dbPath: path.join(dir, "app.db"), env: NO_SEEDED_EVENTS }), /does not know/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an intermediate pre-review database (user_version 1 or 2) is refused with a clear message", async () => {
  for (const version of [1, 2]) {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "app.db");
    const db = new Database(dbPath);
    db.pragma(`user_version = ${version}`);
    db.close();

    await assert.rejects(() => buildApp({ dbPath, env: NO_SEEDED_EVENTS }), new RegExp(`user_version ${version}`));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// fixtures/round1-app.sql: the v1 fixture upgraded by the first review round
// (commit 11e499d, PRAGMA user_version 3), plus two round-1 submissions: Rin
// on DEMO123 (whose snapshot round 1 had already patched) and Sam on a
// round-1 RGSynapse event. .dump does not keep user_version, so it is set here.
test("a first-review-round database (user_version 3) is bridged onto schema_migrations", async t => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, "app.db");
  const raw = new Database(dbPath);
  raw.exec(fs.readFileSync(path.join(__dirname, "fixtures/round1-app.sql"), "utf8"));
  raw.pragma("user_version = 3");
  const before = raw.prepare("SELECT student_name, score FROM attempts ORDER BY id").all();
  const answerCount = raw.prepare("SELECT COUNT(*) AS c FROM answers").get().c;
  raw.close();

  const ctx = await buildApp({ dbPath, env: NO_SEEDED_EVENTS });
  t.after(() => {
    ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const { db } = ctx.store;
  const text = (name, questionId) => JSON.parse(db.prepare(`
    SELECT ans.response_json FROM answers ans JOIN attempts a ON a.id = ans.attempt_id
    WHERE a.student_name = ? AND ans.question_id = ?
  `).get(name, questionId).response_json);

  assert.equal(ctx.store.migration.bridged, true);
  assert.ok(ctx.store.migration.backupPath);
  assert.deepEqual(db.prepare("SELECT id FROM schema_migrations ORDER BY id").all().map(r => r.id), MIGRATIONS.map(m => m.id));

  assert.deepEqual(db.prepare("SELECT student_name, score FROM attempts ORDER BY id").all(), before);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM answers").get().c, answerCount);

  // Pre-round-1 answers get the v1 text they were shown; round-1 answers get the snapshot's.
  assert.deepEqual(text("Chen", "P5-01"), { index: 1, text: "3, 1, 2" });
  assert.deepEqual(text("Chen", "S2-02"), { index: 2, text: "8" });
  assert.deepEqual(text("Dev", "S1-01"), { index: 0, text: "3" });
  assert.deepEqual(text("Rin", "P5-01"), { index: 1, text: "3, 2, 1" });
  assert.deepEqual(text("Rin", "S2-02"), { index: 0, text: "4" });
  assert.deepEqual(text("Sam", "RGS-S1-01").index, 0);
  assert.equal(typeof text("Sam", "RGS-S1-01").text, "string");

  assert.ok(db.prepare("SELECT results_released_at FROM events").all().every(e => e.results_released_at));
  assert.ok(db.prepare("SELECT student_key FROM attempts").all().every(a => a.student_key));
  assert.ok(db.prepare("SELECT question_json FROM event_questions").all().map(r => JSON.parse(r.question_json)).every(q => q.ontology && q.outcomes));

  const fresh = await buildApp();
  try {
    assert.deepEqual(schemaSummary(db), schemaSummary(fresh.store.db));
  } finally {
    fresh.cleanup();
  }

  // Round-1 attempts keep their tokens and the one-attempt rule applies to them.
  const again = await request(ctx.app).post("/api/attempts").send({ joinCode: "DEMO123", studentName: "rin", studentGroup: "S2-2" });
  assert.equal(again.status, 409);
});

test("a failing migration rolls back and is not recorded", () => {
  const db = new Database(":memory:");
  const broken = { id: "209901010000-broken", up: d => { d.exec("CREATE TABLE half_done (id INTEGER)"); throw new Error("boom"); } };

  migrate(db, { ctx: { content: require("../src/content").loadContent() } });

  try {
    assert.throws(() => migrate(db, { migrations: MIGRATIONS.concat(broken) }), /boom/);
    assert.equal(db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(broken.id), undefined);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get(), undefined);
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  } finally {
    db.close();
  }
});

test("migration files must follow the YYYYMMDDHHMM-slug naming", () => {
  MIGRATIONS.forEach(migration => assert.match(migration.id, /^\d{12}-[a-z0-9-]+$/));
  assert.deepEqual(MIGRATIONS.map(m => m.id), MIGRATIONS.map(m => m.id).slice().sort());
});

// A database deployed from main before the admin role has every migration up
// to 202609271700 but not 202609270811-user-roles, whose id sorts earlier.
// The runner must apply it last, fix any stray role, add the triggers, and
// then have nothing left to do (ADR 0004, Consequences).
test("user-roles applies to a database that already has the later migrations", async t => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, "app.db");
  const { loadContent } = require("../src/content");
  const content = loadContent();
  const USER_ROLES = "202609270811-user-roles";
  const earlier = MIGRATIONS.filter(migration => migration.id !== USER_ROLES);
  assert.ok(MIGRATIONS.some(migration => migration.id > USER_ROLES), "a later migration exists");

  const raw = new Database(dbPath);
  migrate(raw, { dbPath, ctx: { content }, migrations: earlier });
  raw.prepare("INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)")
    .run("stray@school.test", "scrypt$x$y", "owner", new Date().toISOString());

  const upgraded = migrate(raw, { dbPath, ctx: { content } });
  assert.deepEqual(upgraded.applied, [USER_ROLES]);
  assert.ok(upgraded.backupPath, "backed up first");
  assert.equal(raw.prepare("SELECT role FROM users WHERE email = 'stray@school.test'").get().role, "teacher");
  assert.deepEqual(
    raw.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all().map(row => row.name),
    ["users_role_check_insert", "users_role_check_update"]
  );
  assert.throws(() => raw.prepare("UPDATE users SET role = 'root'").run(), /teacher or admin/);
  assert.deepEqual(migrate(raw, { dbPath, ctx: { content } }).applied, [], "idempotent");
  raw.close();
});
