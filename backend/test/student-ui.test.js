// Static checks on the student page (web/app.js has no browser test
// harness): the two-step join, Submit only on the review page, and the word
// "challenge" instead of "test". Plus the wording of the join error.

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp } = require("./helpers");

const web = file => fs.readFileSync(path.join(__dirname, "../../web", file), "utf8");
const app = web("app.js");

// The source between "function name" and the next function at the same indent.
function functionBody(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf("\n  function ", start + 1);
  const nextAsync = source.indexOf("\n  async function ", start + 1);
  const ends = [next, nextAsync].filter(index => index !== -1);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
}

test("join is two steps: the code, then the name and class, with no demo hint", () => {
  assert.doesNotMatch(app, /try DEMO123/);
  assert.doesNotMatch(app, /placeholder="DEMO123"/);
  assert.match(app, /id="joinBtn"/);
  assert.match(app, /\/api\/events\/join/);
  assert.match(app, /id="startBtn"/);

  const codeStep = functionBody(app, "renderJoinCode");
  assert.doesNotMatch(codeStep, /id="name"/);
  assert.doesNotMatch(codeStep, /id="group"/);

  const detailsStep = functionBody(app, "renderDetails");
  assert.match(detailsStep, /id="name"/);
  assert.match(detailsStep, /id="group"/);
  assert.doesNotMatch(detailsStep, /id="joinCode"/);
});

test("Submit is only on the review page, and question pages have Skip", () => {
  const submits = app.match(/id="submitBtn"/g) || [];
  assert.equal(submits.length, 1);
  assert.match(functionBody(app, "renderReview"), /id="submitBtn"/);
  assert.doesNotMatch(functionBody(app, "navButtons"), /submitBtn/);

  // Skip is offered under free navigation too, not only in order.
  const buttons = functionBody(app, "navButtons");
  assert.equal((buttons.match(/id="skipBtn"/g) || []).length, 2);
});

test("student-facing copy says challenge, never test", () => {
  const withoutComments = app.split("\n").filter(line => !/^\s*\/\//.test(line)).join("\n");
  assert.doesNotMatch(withoutComments, /\b[Tt]ests?\b/);
  assert.match(withoutComments, /Join a challenge/);
  assert.match(withoutComments, /Start challenge/);
});

test("index.html loads attempt-review.js before app.js", () => {
  const html = web("index.html");
  const review = html.indexOf('src="attempt-review.js"');
  assert.notEqual(review, -1);
  assert.ok(review < html.indexOf('src="app.js"'));
});

test("joining with an unknown code says challenge, not test", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());

  const res = await request(ctx.app).post("/api/events/join").send({ joinCode: "NOPE99" });
  assert.equal(res.status, 404);
  assert.match(res.body.error, /challenge/);
  assert.doesNotMatch(res.body.error, /\btest\b/i);
});
