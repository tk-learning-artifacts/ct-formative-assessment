// Startup secrets and password hashing.

const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { loadConfig } = require("../src/config");
const { hashPassword, verifyPassword } = require("../src/security");
const { buildApp, makeTempDir, login } = require("./helpers");

test("production refuses to start without JWT_SECRET", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production" }), /JWT_SECRET/);
  assert.equal(loadConfig({ NODE_ENV: "production", JWT_SECRET: "long-random" }).jwtSecret, "long-random");
  assert.equal(loadConfig({ NODE_ENV: "development" }).jwtSecret, "ct-quest-dev-secret");
});

test("server.js exits non-zero in production without JWT_SECRET", () => {
  const dir = makeTempDir();
  const result = spawnSync(process.execPath, [path.join(__dirname, "../src/server.js")], {
    env: { PATH: process.env.PATH, NODE_ENV: "production", DB_PATH: path.join(dir, "app.db") },
    encoding: "utf8",
    timeout: 10000
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /JWT_SECRET must be set/);
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
