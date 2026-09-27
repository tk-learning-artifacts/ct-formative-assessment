// The DEMO123 flow end to end over HTTP: join, start, submit, score, the
// teacher seeing the result and releasing the breakdown. Uses the original
// 20 questions.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit, getAttempt } = require("./helpers");
const { loadContent } = require("../src/content");

const ORIGINAL_IDS = [
  "P5-01", "P5-02", "P5-03", "P5-04", "P5-05",
  "P6-01", "P6-02", "P6-03", "P6-04", "P6-05",
  "S1-01", "S1-02", "S1-03", "S1-04", "S1-05",
  "S2-01", "S2-02", "S2-03", "S2-04", "S2-05"
];

const bank = new Map(loadContent().questions.map(question => [question.id, question]));
const keys = Object.fromEntries(ORIGINAL_IDS.map(id => [id, bank.get(id).answer.index]));

test("DEMO123 end to end", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;
  const token = await login(app);
  const auth = { Authorization: `Bearer ${token}` };
  let grace;

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

  await t.test("all correct answers score 90/90; the submit response carries only the total", async () => {
    grace = (await startAttempt(app, { studentName: "Grace", studentGroup: "S2-1" })).attempt;
    const res = await submit(app, grace, Object.fromEntries(ORIGINAL_IDS.map(id => [id, keys[id]])));

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.result, { score: 90, max: 90, pending: 0, markedSoFar: false, breakdownReleased: false });
    assert.equal(res.body.attempt.late, false);
    assert.equal(res.body.attempt.status, "submitted");
  });

  await t.test("partial answers score only the correct ones; missing answers score zero", async () => {
    const { attempt } = await startAttempt(app, { studentName: "Linus", studentGroup: "P6-3" });
    const res = await submit(app, attempt, {
      "P5-01": keys["P5-01"],        // 3 points
      "P6-01": (keys["P6-01"] + 1) % 4,
      "S2-05": String(keys["S2-05"]) // numeric strings are accepted: 6 points
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.result.score, 9);
    assert.equal(res.body.result.max, 90);
  });

  await t.test("out-of-range and junk answers are stored as no answer", async () => {
    const { attempt } = await startAttempt(app);
    const res = await submit(app, attempt, { "P5-01": 99, "P5-02": "abc", "P5-03": -1, "P5-04": { x: 1 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.result.score, 0);

    const answers = ctx.store.db.prepare("SELECT response_json FROM answers WHERE attempt_id = ? ORDER BY id LIMIT 4").all(attempt.id);
    assert.ok(answers.every(row => row.response_json === "null"));
  });

  await t.test("the teacher sees every attempt with the chosen option text", async () => {
    const events = await request(app).get("/api/events").set(auth);
    const demo = events.body.events.find(event => event.join_code === "DEMO123");
    assert.equal(demo.question_count, 20);
    assert.equal(demo.results_released_at, null);

    const res = await request(app).get(`/api/events/${demo.id}/results`).set(auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.attempts.length, 4);
    assert.equal(res.body.event.breakdown_released, false);

    const row = res.body.attempts.find(attempt => attempt.student_name === "Grace");
    assert.equal(row.status, "submitted");
    assert.equal(row.score, 90);
    assert.equal(row.late, false);
    assert.equal(row.answers.length, 20);
    assert.deepEqual(row.answers[0].response, { index: keys["P5-01"], text: bank.get("P5-01").options[keys["P5-01"]] });
    assert.equal(row.answers[0].scoreStatus, "scored");

    const ada = res.body.attempts.find(attempt => attempt.student_name === "Ada");
    assert.equal(ada.status, "started");
    assert.equal(ada.score, null);
  });

  await t.test("the breakdown appears for the student once the teacher releases it", async () => {
    const before = await getAttempt(app, grace);
    assert.equal(before.status, 200);
    assert.equal(before.body.result.breakdownReleased, false);
    assert.equal(before.body.result.perQuestion, undefined);

    const demo = (await request(app).get("/api/events").set(auth)).body.events.find(event => event.join_code === "DEMO123");
    const released = await request(app).post(`/api/events/${demo.id}/release`).set(auth);
    assert.equal(released.status, 200);
    assert.ok(released.body.event.results_released_at);

    const after = await getAttempt(app, grace);
    assert.equal(after.body.result.breakdownReleased, true);
    assert.equal(after.body.result.perQuestion.length, 20);
    const first = after.body.result.perQuestion[0];
    assert.equal(first.correct, true);
    assert.equal(first.response.text, bank.get("P5-01").options[keys["P5-01"]]);
    assert.equal(first.correctResponse.text, first.response.text);
  });

  await t.test("unknown join codes and missing names are refused", async () => {
    const res = await request(app).post("/api/attempts").send({ joinCode: "NOPE99", studentName: "A", studentGroup: "B" });
    assert.equal(res.status, 404);

    const missingName = await request(app).post("/api/attempts").send({ joinCode: "DEMO123", studentGroup: "B" });
    assert.equal(missingName.status, 400);
  });
});
