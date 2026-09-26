// The DEMO123 flow end to end over HTTP: join, start, submit, score, and the
// teacher seeing the result. Uses the original 20 questions.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit } = require("./helpers");
const { loadContent } = require("../src/content");

const ORIGINAL_IDS = [
  "P5-01", "P5-02", "P5-03", "P5-04", "P5-05",
  "P6-01", "P6-02", "P6-03", "P6-04", "P6-05",
  "S1-01", "S1-02", "S1-03", "S1-04", "S1-05",
  "S2-01", "S2-02", "S2-03", "S2-04", "S2-05"
];

const keys = Object.fromEntries(loadContent().questions.map(question => [question.id, question.answer.index]));

test("DEMO123 end to end", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;

  await t.test("join shows the demo event with 20 questions", async () => {
    const res = await request(app).post("/api/events/join").send({ joinCode: "demo123" });
    assert.equal(res.status, 200);
    assert.equal(res.body.event.joinCode, "DEMO123");
    assert.equal(res.body.event.durationMinutes, 45);
    assert.equal(res.body.questionCount, 20);
  });

  await t.test("starting returns the original 20 questions in order, a token and a deadline", async () => {
    const body = await startAttempt(app, { studentName: "Ada", studentGroup: "S1-2" });
    assert.deepEqual(body.questions.map(question => question.id), ORIGINAL_IDS);
    assert.equal(typeof body.attempt.token, "string");
    assert.ok(body.attempt.token.length >= 40);

    const remainingMs = Date.parse(body.attempt.deadlineAt) - Date.parse(body.serverNow);
    assert.equal(remainingMs, 45 * 60 * 1000);
  });

  await t.test("all correct answers score 90/90", async () => {
    const { attempt } = await startAttempt(app, { studentName: "Grace", studentGroup: "S2-1" });
    const answers = Object.fromEntries(ORIGINAL_IDS.map(id => [id, keys[id]]));
    const res = await submit(app, attempt, answers);

    assert.equal(res.status, 200);
    assert.equal(res.body.result.score, 90);
    assert.equal(res.body.result.max, 90);
    assert.equal(res.body.result.perQuestion.length, 20);
    assert.ok(res.body.result.perQuestion.every(item => item.earned === item.max));
    assert.equal(res.body.attempt.late, false);
  });

  await t.test("partial answers score only the correct ones; missing answers score zero", async () => {
    const { attempt } = await startAttempt(app, { studentName: "Linus", studentGroup: "P6-3" });
    const wrong = (keys["P6-01"] + 1) % 4;
    const res = await submit(app, attempt, {
      "P5-01": keys["P5-01"],        // 3 points
      "P6-01": wrong,                // wrong
      "S2-05": String(keys["S2-05"]) // numeric strings are accepted: 6 points
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.result.score, 9);
    assert.equal(res.body.result.max, 90);

    const byId = Object.fromEntries(res.body.result.perQuestion.map(item => [item.id, item]));
    assert.equal(byId["P6-01"].chosen, wrong);
    assert.equal(byId["P6-01"].earned, 0);
    assert.equal(byId["S1-01"].chosen, null);
  });

  await t.test("out-of-range and junk answers are stored as no answer", async () => {
    const { attempt } = await startAttempt(app);
    const res = await submit(app, attempt, { "P5-01": 99, "P5-02": "abc", "P5-03": -1, "P5-04": { x: 1 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.score, 0);
    assert.ok(res.body.result.perQuestion.slice(0, 4).every(item => item.chosen === null));
  });

  await t.test("the teacher sees every attempt with per-question answers", async () => {
    const token = await login(app);
    const events = await request(app).get("/api/events").set("Authorization", `Bearer ${token}`);
    assert.equal(events.status, 200);
    const demo = events.body.events.find(event => event.join_code === "DEMO123");
    assert.equal(demo.question_count, 20);

    const res = await request(app).get(`/api/events/${demo.id}/results`).set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.attempts.length, 4);

    const grace = res.body.attempts.find(attempt => attempt.student_name === "Grace");
    assert.equal(grace.status, "submitted");
    assert.equal(grace.score, 90);
    assert.equal(grace.answers.length, 20);
    assert.equal(grace.answers[0].questionType, "mcq");
    assert.equal(grace.answers[0].scoreStatus, "scored");

    const ada = res.body.attempts.find(attempt => attempt.student_name === "Ada");
    assert.equal(ada.status, "started");
    assert.equal(ada.score, null);
  });

  await t.test("unknown and closed join codes are refused", async () => {
    const res = await request(app).post("/api/attempts").send({ joinCode: "NOPE99", studentName: "A", studentGroup: "B" });
    assert.equal(res.status, 404);

    const missingName = await request(app).post("/api/attempts").send({ joinCode: "DEMO123", studentGroup: "B" });
    assert.equal(missingName.status, 400);
  });
});
