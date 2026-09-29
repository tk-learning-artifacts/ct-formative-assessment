// Startup secrets, the seeded teacher account, and password hashing.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { loadConfig } = require("../src/config");
const { hashPassword, verifyPassword } = require("../src/security");
const { buildApp, makeTempDir, login } = require("./helpers");

const SERVER = path.join(__dirname, "../src/server.js");
const SET_PASSWORD = path.join(__dirname, "../scripts/set-password.js");
const PROD = { NODE_ENV: "production", JWT_SECRET: "long-random", SEED_TEACHER_PASSWORD: "a-strong-seed-pass" };

function runNode(script, args, env, input) {
  return spawnSync(process.execPath, [script, ...args], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
    input,
    timeout: 15000
  });
}

// Starts server.js on 127.0.0.1 and resolves once it is listening. PORT=0
// lets the OS pick a free port, read back from the startup line; a random
// port could collide with another server on this machine and crash the run.
// The caller stops it with child.kill() on that one process.
function startServer(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, HOST: "127.0.0.1", PORT: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  return new Promise((resolve, reject) => {
    let output = "";
    const onData = chunk => {
      output += chunk;
      const match = output.match(/running on http:\/\/[^:]+:(\d+)/);
      if (match) resolve({ child, port: Number(match[1]) });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", code => reject(new Error(`server exited with ${code}: ${output}`)));
  });
}

test("production refuses to start without JWT_SECRET or with the demo seed password", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /JWT_SECRET/);
  assert.equal(loadConfig({ NODE_ENV: "production", JWT_SECRET: "x" }).seedTeacher.password, null);
  assert.throws(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: "x", SEED_TEACHER_PASSWORD: "changeme123" }), /SEED_TEACHER_PASSWORD/);
  assert.equal(loadConfig(PROD).jwtSecret, "long-random");
  assert.equal(loadConfig({ NODE_ENV: "development" }).jwtSecret, "ct-quest-dev-secret");
  assert.deepEqual(loadConfig({ NODE_ENV: "development" }).seedTeacher, { email: "teacher@ctquest.local", password: "changeme123" });
});

test("server.js exits non-zero in production without JWT_SECRET", () => {
  const dir = makeTempDir();
  const result = runNode(SERVER, [], { NODE_ENV: "production", DB_PATH: path.join(dir, "app.db") });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /JWT_SECRET must be set/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a fresh production database is seeded from SEED_TEACHER_EMAIL / SEED_TEACHER_PASSWORD", async () => {
  const dir = makeTempDir();
  const ctx = await buildApp({ dbPath: path.join(dir, "app.db"), env: { ...PROD, SEED_TEACHER_EMAIL: "Head@School.test" } });

  try {
    await login(ctx.app, { email: "head@school.test", password: "a-strong-seed-pass" });
    const bad = await request(ctx.app).post("/api/auth/login").send({ email: "teacher@ctquest.local", password: "changeme123" });
    assert.equal(bad.status, 401);
  } finally {
    ctx.cleanup();
  }
});

test("SEED_TEACHER_PASSWORD is needed only to seed an empty production database", async () => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, "app.db");
  const { SEED_TEACHER_PASSWORD, ...prodWithoutSeed } = PROD;

  const fresh = runNode(SERVER, [], { ...prodWithoutSeed, DB_PATH: dbPath });
  assert.equal(fresh.status, 1);
  assert.match(fresh.stderr, /SEED_TEACHER_PASSWORD must be set/);

  (await buildApp({ dbPath, env: PROD })).close();
  const { child } = await startServer({ ...prodWithoutSeed, DB_PATH: dbPath });
  child.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("production refuses an existing database that still holds the demo password, until set-password is run", async () => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, "app.db");
  (await buildApp({ dbPath })).close();

  // Without SEED_TEACHER_PASSWORD: with it, start-up replaces the demo password
  // instead (test/demo-password-replace.test.js).
  const { SEED_TEACHER_PASSWORD: _omitted, ...PROD_WITHOUT_SEED_PASSWORD } = PROD;
  const refused = runNode(SERVER, [], { ...PROD_WITHOUT_SEED_PASSWORD, DB_PATH: dbPath });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /demo password: teacher@ctquest\.local/);
  assert.match(refused.stderr, /set-password/);

  const fixed = runNode(SET_PASSWORD, ["teacher@ctquest.local"], { DB_PATH: dbPath, NEW_PASSWORD: "a-much-better-one" });
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.match(fixed.stdout, /Updated teacher@ctquest\.local/);

  const { child, port } = await startServer({ ...PROD, DB_PATH: dbPath });

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "teacher@ctquest.local", password: "a-much-better-one" })
    });
    assert.equal(res.status, 200);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("set-password never takes the password from argv and rejects weak ones", () => {
  const dir = makeTempDir();
  const dbPath = path.join(dir, "app.db");

  const argv = runNode(SET_PASSWORD, ["new@school.test", "hunter2hunter2"], { DB_PATH: dbPath });
  assert.equal(argv.status, 1);
  assert.match(argv.stderr, /never an argument/);

  assert.match(runNode(SET_PASSWORD, ["new@school.test"], { DB_PATH: dbPath, NEW_PASSWORD: "short" }).stderr, /at least 10/);
  assert.match(runNode(SET_PASSWORD, ["new@school.test"], { DB_PATH: dbPath, NEW_PASSWORD: "changeme123" }).stderr, /demo password/);

  const piped = runNode(SET_PASSWORD, ["new@school.test"], { DB_PATH: dbPath }, "piped-password-1\n");
  assert.equal(piped.status, 0, piped.stderr);
  assert.match(piped.stdout, /Created new@school\.test/);
  assert.doesNotMatch(piped.stdout + piped.stderr, /piped-password-1/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("passwords get a random salt per hash and verify with the right password only", () => {
  const first = hashPassword("changeme123");
  const second = hashPassword("changeme123");

  assert.match(first, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(first, second);
  assert.deepEqual(verifyPassword("changeme123", first), { ok: true, needsRehash: false });
  assert.deepEqual(verifyPassword("wrong", first), { ok: false, needsRehash: false });
  assert.deepEqual(verifyPassword("anything", "garbage"), { ok: false, needsRehash: false });
  assert.deepEqual(verifyPassword("anything", "scrypt$zz"), { ok: false, needsRehash: false });
});

test("legacy fixed-salt hashes still verify and are flagged for rehash", () => {
  const legacy = crypto.scryptSync("changeme123", "ct-quest-salt", 64).toString("hex");
  assert.deepEqual(verifyPassword("changeme123", legacy), { ok: true, needsRehash: true });
  assert.deepEqual(verifyPassword("wrong", legacy), { ok: false, needsRehash: false });
});

test("logging in with a legacy hash rewrites it in the new format", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const legacy = crypto.scryptSync("changeme123", "ct-quest-salt", 64).toString("hex");
  ctx.store.db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(legacy, "teacher@ctquest.local");

  await login(ctx.app);
  const stored = ctx.store.db.prepare("SELECT password_hash FROM users WHERE email = ?").get("teacher@ctquest.local").password_hash;
  assert.match(stored, /^scrypt\$/);

  await login(ctx.app);
  const bad = await request(ctx.app).post("/api/auth/login").send({ email: "teacher@ctquest.local", password: "nope" });
  assert.equal(bad.status, 401);
});
