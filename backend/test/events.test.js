// Event creation checks: absolute times only, and a 24-hour duration cap.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login } = require("./helpers");

test("event creation validation", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const auth = { Authorization: `Bearer ${await login(ctx.app)}` };
  const create = body => request(ctx.app).post("/api/events").set(auth).send({ title: "Dates", selectionMode: "P5", ...body });

  await t.test("date-times without a time zone are rejected", async () => {
    for (const value of ["2026-10-01T09:00", "2026-10-01 09:00", "2026-10-01", "next tuesday"]) {
      const res = await create({ startAt: value });
      assert.equal(res.status, 400, value);
      assert.match(res.body.error, /time zone|valid/);
    }
  });

  await t.test("absolute times are stored as UTC, whatever offset was sent", async () => {
    const res = await create({ startAt: "2026-10-01T09:00:00+08:00", endAt: "2026-10-01T02:00:00Z" });
    assert.equal(res.status, 201);
    assert.equal(res.body.event.start_at, "2026-10-01T01:00:00.000Z");
    assert.equal(res.body.event.end_at, "2026-10-01T02:00:00.000Z");
  });

  await t.test("the deadline must come after the start", async () => {
    const res = await create({ startAt: "2026-10-01T03:00:00Z", endAt: "2026-10-01T02:00:00Z" });
    assert.equal(res.status, 400);
  });

  await t.test("durations are capped at 24 hours", async () => {
    assert.equal((await create({ durationMinutes: 1440 })).status, 201);
    assert.equal((await create({ durationMinutes: 1441 })).status, 400);
    assert.equal((await create({ durationMinutes: -5 })).status, 400);
  });
});
