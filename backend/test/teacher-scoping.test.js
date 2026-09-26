// Teachers only see and read their own events and results.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit } = require("./helpers");

test("teacher scoping", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app, store } = ctx;

  store.createUser({ email: "other@school.test", password: "other-password-1" });
  const demoToken = await login(app);
  const otherToken = await login(app, { email: "other@school.test", password: "other-password-1" });
  const auth = token => ({ Authorization: `Bearer ${token}` });

  const demoEvent = (await request(app).get("/api/events").set(auth(demoToken))).body.events[0];
  const { attempt } = await startAttempt(app, { studentName: "Private Student" });
  await submit(app, attempt, {});

  await t.test("a new teacher's event list is empty", async () => {
    const res = await request(app).get("/api/events").set(auth(otherToken));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.events, []);
  });

  await t.test("another teacher's results look like a missing event", async () => {
    const res = await request(app).get(`/api/events/${demoEvent.id}/results`).set(auth(otherToken));
    assert.equal(res.status, 404);
    assert.doesNotMatch(JSON.stringify(res.body), /Private Student/);
  });

  await t.test("each teacher sees only the events they created", async () => {
    const created = await request(app)
      .post("/api/events")
      .set(auth(otherToken))
      .send({ title: "Other's round", selectionMode: "S1" });
    assert.equal(created.status, 201);

    const mine = (await request(app).get("/api/events").set(auth(otherToken))).body.events;
    assert.deepEqual(mine.map(event => event.title), ["Other's round"]);

    const demoList = (await request(app).get("/api/events").set(auth(demoToken))).body.events;
    assert.ok(!demoList.some(event => event.title === "Other's round"));

    const ownResults = await request(app).get(`/api/events/${created.body.event.id}/results`).set(auth(otherToken));
    assert.equal(ownResults.status, 200);

    const crossResults = await request(app).get(`/api/events/${created.body.event.id}/results`).set(auth(demoToken));
    assert.equal(crossResults.status, 404);
  });

  await t.test("teacher routes need a valid token", async () => {
    for (const url of ["/api/events", "/api/events/1/results", "/api/ontology", "/api/outcomes", "/api/catalog"]) {
      assert.equal((await request(app).get(url)).status, 401, url);
      assert.equal((await request(app).get(url).set("Authorization", "Bearer forged")).status, 401, url);
    }
    assert.equal((await request(app).post("/api/question-bank/preview").send({})).status, 401);
  });
});
