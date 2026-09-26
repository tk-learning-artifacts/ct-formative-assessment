// Event filters (v2 shape and legacy selectionMode) and the read-only
// endpoints the Phase 2 picker will use.

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt } = require("./helpers");

test("event filters and picker endpoints", async t => {
  const ctx = buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;
  const token = await login(app);
  const auth = { Authorization: `Bearer ${token}` };

  const preview = body => request(app).post("/api/question-bank/preview").set(auth).send(body);
  const createEvent = body => request(app).post("/api/events").set(auth).send({ title: "Filter test", ...body });

  await t.test("legacy selection modes keep their original meaning", async () => {
    const all = await preview({ selectionMode: "ALL" });
    assert.equal(all.body.count, 20);
    assert.deepEqual(all.body.byAudience, { core: 20 });
    assert.deepEqual(all.body.filter, { audiences: ["core"] });

    for (const level of ["P5", "P6", "S1", "S2"]) {
      const res = await preview({ selectionMode: level.toLowerCase() });
      assert.equal(res.body.count, 5, level);
      assert.deepEqual(res.body.byLevel, { [level]: 5 });
    }

    const bad = await createEvent({ selectionMode: "S9" });
    assert.equal(bad.status, 400);
  });

  await t.test("a legacy event is stored with its selection mode and the equivalent filter", async () => {
    const res = await createEvent({ selectionMode: "P6" });
    assert.equal(res.status, 201);
    assert.equal(res.body.event.selection_mode, "P6");
    assert.deepEqual(res.body.event.filter, { audiences: ["core"], levels: ["P6"] });
    assert.equal(res.body.event.question_count, 5);
  });

  await t.test("level is one filter among several", async () => {
    const s1Everyone = await preview({ filter: { levels: ["S1"] } });
    assert.deepEqual(s1Everyone.body.byAudience, { core: 5, rgsynapse: 2 });

    const rgs = await preview({ filter: { audiences: ["rgsynapse"] } });
    assert.deepEqual(rgs.body.questions.map(q => q.id), ["RGS-S1-01", "RGS-S1-02", "RGS-S2-01", "RGS-S2-02"]);

    const byOutcome = await preview({ filter: { outcomes: ["LO-DEBUG-1"] } });
    assert.deepEqual(byOutcome.body.questions.map(q => q.id), ["S1-01", "RGS-S1-02"]);

    const outcomeAndLevel = await preview({ filter: { outcomes: ["LO-PATH-1"], levels: ["S2"] } });
    assert.deepEqual(outcomeAndLevel.body.questions.map(q => q.id), ["S2-02"]);

    const difficulty = await preview({ filter: { audiences: ["core"], difficulty: { min: 4 } } });
    assert.equal(difficulty.body.count, 5);
    assert.deepEqual(difficulty.body.byLevel, { S2: 5 });

    const types = await preview({ filter: { types: ["mcq"] } });
    assert.equal(types.body.count, 24);
  });

  await t.test("an ontology node matches questions tagged with it or anything beneath it", async () => {
    const parent = await preview({ filter: { nodes: ["concept.data"] } });
    const child = await preview({ filter: { nodes: ["concept.data.structures.paths"] } });

    assert.deepEqual(child.body.questions.map(q => q.id), ["P6-01", "P6-05", "S2-02"]);
    assert.ok(child.body.questions.every(q => parent.body.questions.some(p => p.id === q.id)));
    assert.ok(parent.body.count > child.body.count);

    const practiceRoot = await preview({ filter: { nodes: ["practice"], audiences: ["rgsynapse"] } });
    assert.equal(practiceRoot.body.count, 4);
  });

  await t.test("preview count equals the created event's question count", async () => {
    const filter = { levels: ["S1", "S2"], nodes: ["concept.loops"] };
    const previewed = await preview({ filter });
    const created = await createEvent({ filter });

    assert.equal(created.status, 201);
    assert.equal(created.body.event.selection_mode, "FILTER");
    assert.deepEqual(created.body.event.filter, filter);
    assert.equal(created.body.event.question_count, previewed.body.count);

    const started = await startAttempt(app, { joinCode: created.body.event.join_code });
    assert.deepEqual(started.questions.map(q => q.id), previewed.body.questions.map(q => q.id));
  });

  await t.test("invalid filters are rejected with a reason", async () => {
    const cases = [
      [{ outcomes: ["LO-NOPE"] }, /unknown outcomes: LO-NOPE/],
      [{ nodes: ["concept.nope"] }, /unknown nodes/],
      [{ levels: ["S9"] }, /unknown levels/],
      [{ audiences: ["mars"] }, /unknown audiences/],
      [{ types: ["parsons"] }, /reserved/],
      [{ types: ["essay"] }, /unknown question type/],
      [{ colour: ["red"] }, /unknown filter key/],
      [{ levels: "S1" }, /must be an array/],
      [{ difficulty: { min: 4, max: 2 } }, /min must not be greater/],
      [[], /must be an object/]
    ];

    for (const [filter, pattern] of cases) {
      const res = await createEvent({ filter });
      assert.equal(res.status, 400, JSON.stringify(filter));
      assert.match(res.body.error, pattern);
    }
  });

  await t.test("a filter that matches nothing cannot become an event", async () => {
    const res = await createEvent({ filter: { audiences: ["rgsynapse"], levels: ["P5"] } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /No questions match/);
  });

  await t.test("the ontology endpoint lists nodes and edges", async () => {
    const res = await request(app).get("/api/ontology").set(auth);
    assert.equal(res.status, 200);
    const byId = Object.fromEntries(res.body.nodes.map(node => [node.id, node]));

    assert.equal(byId["concept.loops"].kind, "concept");
    assert.equal(byId["concept.loops"].parent, "concept");
    assert.deepEqual(byId["concept.loops"].prerequisites, ["concept.sequences"]);
    assert.ok(byId["concept.data.structures.paths"].questionCount >= 3);
    assert.ok(["concept", "practice", "perspective"].every(kind => res.body.nodes.some(node => node.kind === kind)));
    assert.ok(res.body.edges.some(edge => edge.kind === "parent_of" && edge.from === "concept" && edge.to === "concept.loops"));
    assert.ok(res.body.edges.some(edge => edge.kind === "requires" && edge.from === "concept.loops" && edge.to === "concept.sequences"));
    assert.equal(res.body.framework.id, "brennan-resnick-2012");
    const topConcepts = res.body.nodes.filter(node => node.parent === "concept").map(node => node.id);
    assert.deepEqual(topConcepts, ["concept.sequences", "concept.loops", "concept.events", "concept.parallelism", "concept.conditionals", "concept.operators", "concept.data"]);
    const topPractices = res.body.nodes.filter(node => node.parent === "practice").map(node => node.id);
    assert.deepEqual(topPractices, ["practice.experimenting-iterating", "practice.testing-debugging", "practice.reusing-remixing", "practice.abstracting-modularizing"]);
    const topPerspectives = res.body.nodes.filter(node => node.parent === "perspective").map(node => node.id);
    assert.deepEqual(topPerspectives, ["perspective.expressing", "perspective.connecting", "perspective.questioning"]);
  });

  await t.test("outcomes can be filtered by level and audience", async () => {
    const all = await request(app).get("/api/outcomes").set(auth);
    const p5 = await request(app).get("/api/outcomes?level=p5").set(auth);
    const rgsS2 = await request(app).get("/api/outcomes?level=S2&audience=rgsynapse").set(auth);

    assert.ok(all.body.outcomes.length > p5.body.outcomes.length);
    assert.ok(p5.body.outcomes.every(outcome => outcome.levels.includes("P5")));
    assert.deepEqual(rgsS2.body.outcomes.map(outcome => outcome.id), ["LO-DEBUG-1", "LO-CODE-TRACE-1", "LO-AI-REVIEW-1", "LO-TRANSLATE-1"]);
    assert.ok(rgsS2.body.outcomes.every(outcome => outcome.nodes.length > 0));

    assert.equal((await request(app).get("/api/outcomes?level=S9").set(auth)).status, 400);
    assert.equal((await request(app).get("/api/outcomes?audience=mars").set(auth)).status, 400);
  });

  await t.test("the catalog lists levels, audiences, question types and AI status", async () => {
    const res = await request(app).get("/api/catalog").set(auth);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.levels.map(level => level.id), ["P5", "P6", "S1", "S2"]);
    assert.deepEqual(res.body.audiences.map(audience => audience.id), ["core", "rgsynapse"]);
    assert.ok(res.body.questionTypes.some(type => type.type === "mcq" && type.status === "active"));
    assert.deepEqual(res.body.ai, { enabled: false, provider: "none" });
  });

  await t.test("RGSynapse questions reach students with their code and without keys", async () => {
    const created = await createEvent({ filter: { audiences: ["rgsynapse"], levels: ["S1"] } });
    const started = await startAttempt(app, { joinCode: created.body.event.join_code });
    assert.equal(started.questions.length, 2);
    assert.equal(started.questions[0].code.language, "python");
    assert.equal(started.questions[0].answer, undefined);
  });
});
