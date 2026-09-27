// No answer key reaches a student: not through static files, not through any
// public API response, and not through unknown routes falling back to HTML.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit, allKeys } = require("./helpers");
const { PUBLIC_FILES } = require("../src/app");

// "details" is the teacher-facing focus note, which often gives the method away.
const ANSWER_KEYS = ["answer", "answerIndex", "correctIndex", "correct_index", "accepted", "rubric", "solution", "details"];

test("answer keys never reach students", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;

  await t.test("the old questions.js and other non-public files are not served", async () => {
    const paths = [
      "/questions.js",
      "/web/questions.js",
      "/package.json",
      "/vite.config.js",
      "/web/package.json",
      "/content/questions/core.json",
      "/backend/content/questions/core.json",
      "/questions/core.json",
      "/ontology.json",
      "/../backend/content/questions/core.json",
      "/%2e%2e/backend/content/questions/core.json",
      "/.env",
      "/app.db"
    ];

    for (const url of paths) {
      const res = await request(app).get(url);
      assert.equal(res.status, 404, `${url} should be 404, got ${res.status}`);
    }
  });

  await t.test("the public files contain no answer fields", async () => {
    for (const name of PUBLIC_FILES) {
      const res = await request(app).get(`/${name}`);
      assert.equal(res.status, 200, name);
      assert.doesNotMatch(res.text, /answerIndex|"answer"\s*:/, `${name} mentions an answer key`);
      assert.doesNotMatch(res.text, /QUESTION_BANK/, `${name} still embeds the question bank`);
    }
  });

  await t.test("join, start and submit responses carry no answer fields", async () => {
    const join = await request(app).post("/api/events/join").send({ joinCode: "DEMO123" });
    const started = await startAttempt(app);
    const submitted = await submit(app, started.attempt, { "P5-01": 0 });

    [join.body, started, submitted.body].forEach((body, i) => {
      const keys = allKeys(body);
      ANSWER_KEYS.forEach(key => assert.ok(!keys.has(key), `response ${i} has "${key}"`));
    });

    started.questions.forEach(question => {
      assert.deepEqual(Object.keys(question).filter(key => ANSWER_KEYS.includes(key)), []);
    });
  });

  await t.test("the teacher preview lists questions without keys", async () => {
    const token = await login(app);
    const res = await request(app)
      .post("/api/question-bank/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ selectionMode: "ALL" });

    assert.equal(res.status, 200);
    const keys = allKeys(res.body);
    ANSWER_KEYS.forEach(key => assert.ok(!keys.has(key), `preview has "${key}"`));
  });

  await t.test("unknown API routes return JSON 404, not the student page", async () => {
    for (const [method, url] of [["get", "/api/nope"], ["post", "/api/nope"], ["get", "/api/events/1/nope"], ["delete", "/api/events"]]) {
      const res = await request(app)[method](url);
      assert.equal(res.status, 404, `${method} ${url}`);
      assert.match(res.headers["content-type"], /application\/json/);
      assert.equal(typeof res.body.error, "string");
    }
  });

  await t.test("client routes still fall back to the student page", async () => {
    const res = await request(app).get("/some/client/route");
    assert.equal(res.status, 200);
    assert.match(res.text, /<title>CT Quest<\/title>/);
  });

  await t.test("malformed JSON gets a JSON 400", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{not json");
    assert.equal(res.status, 400);
    assert.match(res.headers["content-type"], /application\/json/);
  });
});
