// A database that holds an account still on the demo password (made before
// production refused it) blocks start-up in production. With no shell to run
// set-password, SEED_TEACHER_EMAIL and SEED_TEACHER_PASSWORD replace the demo
// password on that one account, and only while it is still the demo password.

const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { openDatabase } = require("../src/db");
const { verifyPassword } = require("../src/security");
const { DEFAULT_TEACHER_PASSWORD } = require("../src/config");

const NEW_PASSWORD = "a-long-new-password-1";

function tempDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctquest-demopw-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "app.db");
}

// The database the original app left behind: one account on the demo password.
function legacyDb(dbPath) {
  const store = openDatabase({ dbPath, seedTeacher: { email: "teacher@ctquest.local", password: DEFAULT_TEACHER_PASSWORD }, seedEvents: false });
  store.close();
}

const production = (dbPath, seedTeacher, extra = {}) => openDatabase({ dbPath, seedTeacher, isProduction: true, seedEvents: false, ...extra });
const passwordOk = (store, email, password) => verifyPassword(password, store.findUserByEmail(email).password_hash).ok;

test("production refuses to start on a demo-password account, and says how to clear it with no shell", t => {
  const dbPath = tempDb(t);
  legacyDb(dbPath);
  assert.throws(() => production(dbPath, null), /teacher@ctquest\.local.*SEED_TEACHER_EMAIL.*SEED_TEACHER_PASSWORD/s);
  assert.throws(() => production(dbPath, { email: "someone-else@school.test", password: NEW_PASSWORD }), /still use the demo password/);
});

test("SEED_TEACHER_EMAIL and SEED_TEACHER_PASSWORD replace the demo password, and the server then starts", t => {
  const dbPath = tempDb(t);
  legacyDb(dbPath);
  const logs = [];
  const store = production(dbPath, { email: "Teacher@CTQuest.local", password: NEW_PASSWORD }, { log: message => logs.push(message) });
  t.after(() => store.close());

  assert.equal(passwordOk(store, "teacher@ctquest.local", NEW_PASSWORD), true);
  assert.equal(passwordOk(store, "teacher@ctquest.local", DEFAULT_TEACHER_PASSWORD), false);
  assert.ok(logs.some(message => /Replaced the demo password on teacher@ctquest\.local/.test(message)), logs.join("\n"));
  assert.ok(!logs.some(message => message.includes(NEW_PASSWORD)), "the password is never logged");
  assert.equal(store.findUserByEmail("teacher@ctquest.local").role, "admin", "the role is left alone");
});

test("an account that has a real password is never touched, whatever SEED_TEACHER_PASSWORD says", t => {
  const dbPath = tempDb(t);
  const first = openDatabase({ dbPath, seedTeacher: { email: "head@school.test", password: "the-real-password-9" }, seedEvents: false });
  first.close();

  const store = production(dbPath, { email: "head@school.test", password: NEW_PASSWORD });
  t.after(() => store.close());
  assert.equal(passwordOk(store, "head@school.test", "the-real-password-9"), true);
  assert.equal(passwordOk(store, "head@school.test", NEW_PASSWORD), false);
});

test("only the named account is changed; another demo-password account still blocks", t => {
  const dbPath = tempDb(t);
  legacyDb(dbPath);
  const seeded = openDatabase({ dbPath, seedTeacher: null, seedEvents: false });
  seeded.createUser({ email: "second@school.test", password: DEFAULT_TEACHER_PASSWORD });
  seeded.close();

  assert.throws(() => production(dbPath, { email: "teacher@ctquest.local", password: NEW_PASSWORD }), /second@school\.test/);
});

test("a too-short replacement password is refused, and the demo password itself is not a replacement", t => {
  const dbPath = tempDb(t);
  legacyDb(dbPath);
  assert.throws(() => production(dbPath, { email: "teacher@ctquest.local", password: "short" }), /too short to replace it/);
  assert.throws(() => production(dbPath, { email: "teacher@ctquest.local", password: DEFAULT_TEACHER_PASSWORD }), /still use the demo password/);
});
