// Shared test setup. Every app built here gets its own database in a fresh
// temporary directory (passed through DB_PATH), so tests never touch
// backend/data/app.db and never see each other's data.

process.env.NODE_ENV = "test";

const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const { loadConfig } = require("../src/config");
const { createApp } = require("../src/app");

const DEMO_TEACHER = { email: "teacher@ctquest.local", password: "changeme123" };

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ctquest-test-"));
}

// Builds an app on a temporary database. Pass dbPath to open an existing file
// (the migration tests do), and env to override settings.
function buildApp({ dbPath = null, env = {} } = {}) {
  const dir = dbPath ? path.dirname(dbPath) : makeTempDir();
  const resolvedDbPath = dbPath || path.join(dir, "app.db");
  const config = loadConfig({ ...process.env, DB_PATH: resolvedDbPath, ...env });
  const app = createApp({ config, log: () => {} });
  const store = app.locals.store;

  return {
    app,
    store,
    dir,
    dbPath: resolvedDbPath,
    close() {
      store.close();
    },
    cleanup() {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function login(app, { email, password } = DEMO_TEACHER) {
  const res = await request(app).post("/api/auth/login").send({ email, password });

  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body.token;
}

async function startAttempt(app, { joinCode = "DEMO123", studentName = "Test Student", studentGroup = "S1-1" } = {}) {
  const res = await request(app).post("/api/attempts").send({ joinCode, studentName, studentGroup });

  if (res.status !== 201) {
    throw new Error(`start attempt failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body;
}

function submit(app, attempt, answers, token = attempt.token) {
  const req = request(app).post(`/api/attempts/${attempt.id}/submit`);

  if (token) {
    req.set("X-Attempt-Token", token);
  }

  return req.send({ answers });
}

// Recursively collects every object key in a JSON value.
function allKeys(value, found = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => allKeys(item, found));
  } else if (value && typeof value === "object") {
    Object.keys(value).forEach(key => {
      found.add(key);
      allKeys(value[key], found);
    });
  }

  return found;
}

module.exports = {
  DEMO_TEACHER,
  makeTempDir,
  buildApp,
  login,
  startAttempt,
  submit,
  allKeys
};
