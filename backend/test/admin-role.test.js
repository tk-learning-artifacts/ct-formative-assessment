// The admin (head of department) role, ADR 0004: every teacher route under a
// teacher on their own event, another teacher, an admin on their own event,
// and an admin on a teacher's event (read yes, change no). Plus the role
// coming from the database rather than the token, the role triggers, the
// SEED_TEACHER_ROLE setting and the set-role script.

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { loadConfig } = require("../src/config");
const { buildApp, makeTempDir, login, startAttempt, submit } = require("./helpers");

const SET_ROLE = path.join(__dirname, "../scripts/set-role.js");
const AI_QUESTION = "AIS-S1-01";

const USERS = {
  teacher: { email: "owner@school.test", password: "owner-password-1" },
  other: { email: "other@school.test", password: "other-password-1" },
  admin: { email: "head@school.test", password: "head-password-1", role: "admin" }
};

let eventCounter = 0;

// An event owned by `token`'s account, with one submitted attempt whose
// AI-scored answer waits for a mark (AI is off here), so every write route
// has something to act on.
async function eventWithAttempt(app, token) {
  eventCounter += 1;
  const joinCode = `ADM${eventCounter}`;
  const created = await request(app).post("/api/events").set(auth(token)).send({
    title: `Admin matrix ${eventCounter}`,
    joinCode,
    filter: { audiences: ["core", "rgsynapse"], questionIds: ["P5-01", AI_QUESTION] }
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const { attempt } = await startAttempt(app, { joinCode, studentName: `Matrix Student ${eventCounter}` });
  const submitted = await submit(app, attempt, { "P5-01": 0, [AI_QUESTION]: "The decrement is outside the loop." });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));

  return { id: created.body.event.id, attemptId: attempt.id };
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

// Every teacher route that takes an event id: what it is called, whether it
// changes the event, and how to send it.
const EVENT_ROUTES = [
  { name: "GET results", write: false, send: (app, ev) => request(app).get(`/api/events/${ev.id}/results`) },
  { name: "GET outcomes-summary", write: false, send: (app, ev) => request(app).get(`/api/events/${ev.id}/outcomes-summary`) },
  { name: "PATCH settings", write: true, send: (app, ev) => request(app).patch(`/api/events/${ev.id}`).send({ title: "Renamed" }) },
  { name: "POST release", write: true, send: (app, ev) => request(app).post(`/api/events/${ev.id}/release`) },
  { name: "POST reset", write: true, send: (app, ev) => request(app).post(`/api/events/${ev.id}/attempts/${ev.attemptId}/reset`) },
  {
    name: "POST review",
    write: true,
    send: (app, ev) => request(app).post(`/api/events/${ev.id}/attempts/${ev.attemptId}/answers/${AI_QUESTION}/review`).send({ score: 1, feedback: "Close." })
  }
];

// What each route changes, read straight from the database, so a refused
// write can be shown to have changed nothing.
function eventState(store, ev) {
  const { db } = store;
  return {
    event: db.prepare("SELECT title, results_released_at FROM events WHERE id = ?").get(ev.id),
    attempt: db.prepare("SELECT reset_at, score FROM attempts WHERE id = ?").get(ev.attemptId),
    answer: db.prepare("SELECT earned_points, score_status, detail_json FROM answers WHERE attempt_id = ? AND question_id = ?").get(ev.attemptId, AI_QUESTION),
    changes: db.prepare("SELECT COUNT(*) AS n FROM event_setting_changes WHERE event_id = ?").get(ev.id).n
  };
}

test("admin role: every teacher route under each kind of caller", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app, store } = ctx;

  Object.values(USERS).forEach(user => store.createUser(user));
  const tokens = {};
  for (const [key, user] of Object.entries(USERS)) {
    tokens[key] = await login(app, user);
  }

  // who: the caller; owner: whose event it is; expect: read and write status.
  const CASES = [
    { label: "teacher on their own event", who: "teacher", owner: "teacher", read: 200, write: 200 },
    { label: "another teacher", who: "other", owner: "teacher", read: 404, write: 404 },
    { label: "admin on their own event", who: "admin", owner: "admin", read: 200, write: 200 },
    { label: "admin on a teacher's event", who: "admin", owner: "teacher", read: 200, write: 403 },
    { label: "teacher on an admin's event", who: "teacher", owner: "admin", read: 404, write: 404 }
  ];

  for (const kase of CASES) {
    for (const route of EVENT_ROUTES) {
      await t.test(`${kase.label}: ${route.name}`, async () => {
        const ev = await eventWithAttempt(app, tokens[kase.owner]);
        const before = eventState(store, ev);
        const res = await route.send(app, ev).set(auth(tokens[kase.who]));
        const expected = route.write ? kase.write : kase.read;

        assert.equal(res.status, expected, JSON.stringify(res.body));

        if (expected === 404) {
          assert.deepEqual(res.body, { error: "Event not found." });
          assert.doesNotMatch(JSON.stringify(res.body), /Matrix Student/);
        }

        if (expected === 403) {
          assert.match(res.body.error, /Only the teacher who created this event can change it/);
        }

        if (expected !== 200 || !route.write) {
          assert.deepEqual(eventState(store, ev), before, "nothing changed");
        } else {
          assert.notDeepEqual(eventState(store, ev), before, "the write took effect");
        }
      });
    }
  }

  await t.test("a missing event id is a 404 for teachers and admins alike", async () => {
    for (const who of ["teacher", "admin"]) {
      for (const route of EVENT_ROUTES) {
        const res = await route.send(app, { id: 999999, attemptId: 1 }).set(auth(tokens[who]));
        assert.equal(res.status, 404, `${who} ${route.name}`);
      }
    }
  });

  await t.test("an admin's read shows everything the owner sees, and marks it read-only", async () => {
    const ev = await eventWithAttempt(app, tokens.teacher);
    await request(app).patch(`/api/events/${ev.id}`).set(auth(tokens.teacher)).send({ title: "Changed by owner" });

    const asOwner = (await request(app).get(`/api/events/${ev.id}/results`).set(auth(tokens.teacher))).body;
    const asAdmin = (await request(app).get(`/api/events/${ev.id}/results`).set(auth(tokens.admin))).body;

    assert.deepEqual(asAdmin.attempts, asOwner.attempts, "attempt details");
    assert.deepEqual(asAdmin.settingChanges, asOwner.settingChanges, "settings history");
    assert.equal(asAdmin.settingChanges[0].changedBy, USERS.teacher.email);
    assert.equal(asAdmin.event.owner_email, USERS.teacher.email);
    assert.equal(asOwner.event.owner_email, USERS.teacher.email);
    assert.deepEqual([asOwner.event.owned, asOwner.event.can_manage], [true, true]);
    assert.deepEqual([asAdmin.event.owned, asAdmin.event.can_manage], [false, false]);
    assert.equal(asAdmin.event.created_by, undefined);

    const summaryOwner = (await request(app).get(`/api/events/${ev.id}/outcomes-summary`).set(auth(tokens.teacher))).body;
    const summaryAdmin = (await request(app).get(`/api/events/${ev.id}/outcomes-summary`).set(auth(tokens.admin))).body;
    assert.deepEqual(summaryAdmin, summaryOwner);
  });

  await t.test("GET /api/events: every teacher's events for an admin, with owners; only their own for a teacher", async () => {
    const all = store.db.prepare("SELECT e.id, u.email FROM events e JOIN users u ON u.id = e.created_by").all();
    const adminList = (await request(app).get("/api/events").set(auth(tokens.admin))).body.events;

    assert.deepEqual(adminList.map(event => event.id).sort((a, b) => a - b), all.map(row => row.id).sort((a, b) => a - b));
    adminList.forEach(event => {
      assert.equal(event.owner_email, all.find(row => row.id === event.id).email);
      assert.equal(event.owned, event.owner_email === USERS.admin.email);
      assert.equal(event.can_manage, event.owned);
      assert.equal(event.created_by, undefined);
    });
    assert.ok(adminList.some(event => event.owner_email === USERS.teacher.email));
    assert.ok(adminList.some(event => event.owner_email === "teacher@ctquest.local"), "the demo event too");

    for (const who of ["teacher", "other"]) {
      const list = (await request(app).get("/api/events").set(auth(tokens[who]))).body.events;
      assert.ok(list.every(event => event.owner_email === USERS[who].email && event.owned && event.can_manage), who);
    }
    assert.deepEqual((await request(app).get("/api/events").set(auth(tokens.other))).body.events, []);
  });

  await t.test("the routes without an event id work the same for teachers and admins", async () => {
    for (const who of ["teacher", "admin"]) {
      for (const url of ["/api/auth/me", "/api/catalog", "/api/ontology", "/api/outcomes", "/api/presets"]) {
        assert.equal((await request(app).get(url).set(auth(tokens[who]))).status, 200, `${who} ${url}`);
      }
      const preview = await request(app).post("/api/question-bank/preview").set(auth(tokens[who])).send({ selectionMode: "S1" });
      assert.equal(preview.status, 200);
    }

    const me = await request(app).get("/api/auth/me").set(auth(tokens.admin));
    assert.equal(me.body.user.role, "admin");

    const created = await request(app).post("/api/events").set(auth(tokens.admin)).send({ title: "Head's own", selectionMode: "S1" });
    assert.equal(created.status, 201);
    assert.equal(created.body.event.owner_email, USERS.admin.email);
    assert.equal(created.body.event.can_manage, true);
  });
});

test("the role is read from the database on each request, not from the token", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app, store } = ctx;

  store.createUser(USERS.teacher);
  store.createUser(USERS.other);
  const ownerToken = await login(app, USERS.teacher);
  const otherToken = await login(app, USERS.other);
  const ev = await eventWithAttempt(app, ownerToken);
  const results = token => request(app).get(`/api/events/${ev.id}/results`).set(auth(token));

  assert.equal((await results(otherToken)).status, 404);

  assert.equal(store.setRole(USERS.other.email, "admin"), "teacher");
  assert.equal((await results(otherToken)).status, 200, "promoted with the same token");

  store.setRole(USERS.other.email, "teacher");
  assert.equal((await results(otherToken)).status, 404, "demoted with the same token");

  store.db.prepare("DELETE FROM users WHERE email = ?").run(USERS.other.email);
  const gone = await request(app).get("/api/events").set(auth(otherToken));
  assert.equal(gone.status, 401);
});

test("users.role only ever holds teacher or admin", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { store } = ctx;

  assert.throws(() => store.createUser({ email: "x@school.test", password: "x-password-1", role: "superuser" }), /teacher or admin/);
  assert.throws(() => store.setRole("teacher@ctquest.local", "owner"), /teacher or admin/);
  assert.equal(store.findUserByEmail("teacher@ctquest.local").role, "teacher");
  assert.equal(store.setRole("nobody@school.test", "admin"), null);
});

test("SEED_TEACHER_ROLE seeds the first account as an admin, and defaults to teacher", async t => {
  assert.equal(loadConfig({}).seedTeacher.role, "teacher");
  assert.equal(loadConfig({ SEED_TEACHER_ROLE: "Admin" }).seedTeacher.role, "admin");
  assert.throws(() => loadConfig({ SEED_TEACHER_ROLE: "root" }), /SEED_TEACHER_ROLE/);

  const seeded = await buildApp({ env: { SEED_TEACHER_ROLE: "admin" } });
  t.after(() => seeded.cleanup());
  assert.equal(seeded.store.findUserByEmail("teacher@ctquest.local").role, "admin");

  // Only an empty database is seeded, so the setting cannot promote anyone later.
  const plain = await buildApp();
  plain.close();
  const reopened = await buildApp({ dbPath: plain.dbPath, env: { SEED_TEACHER_ROLE: "admin" } });
  t.after(() => reopened.cleanup());
  assert.equal(reopened.store.findUserByEmail("teacher@ctquest.local").role, "teacher");
});

test("npm run set-role changes an existing account's role and nothing else", async () => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, "app.db");
  (await buildApp({ dbPath })).close();

  const run = args => spawnSync(process.execPath, [SET_ROLE, ...args], {
    env: { PATH: process.env.PATH, DB_PATH: dbPath },
    encoding: "utf8",
    timeout: 15000
  });

  try {
    const promoted = run(["Teacher@CTQuest.local", "admin"]);
    assert.equal(promoted.status, 0, promoted.stderr);
    assert.match(promoted.stdout, /Set teacher@ctquest\.local to admin \(was teacher\)/);

    assert.match(run(["teacher@ctquest.local", "admin"]).stdout, /already admin/);

    const demoted = run(["teacher@ctquest.local", "teacher"]);
    assert.equal(demoted.status, 0, demoted.stderr);
    assert.match(demoted.stdout, /to teacher \(was admin\)/);

    const missing = run(["nobody@school.test", "admin"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No account for nobody@school\.test.*set-password/);

    for (const args of [[], ["teacher@ctquest.local"], ["teacher@ctquest.local", "root"], ["not-an-email", "admin"], ["teacher@ctquest.local", "admin", "extra"]]) {
      const bad = run(args);
      assert.equal(bad.status, 1, args.join(" "));
      assert.match(bad.stderr, /Usage: npm run set-role -- <email> <teacher\|admin>/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
