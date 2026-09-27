// Quick setup presets (backend/content/presets.json) and the length cap:
// the endpoint, knobs compiling to ordinary filters, card count = preview
// count = event count, AI-scored questions only in presets that say so, the
// balanced limit, and the boot-time checks on the presets file.

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, makeTempDir } = require("./helpers");
const { loadContent, DEFAULT_CONTENT_DIR } = require("../src/content");
const { openDatabase } = require("../src/db");
const selection = require("../src/selection");

function withEditedPresets(edit, fn) {
  const dir = makeTempDir();
  fs.cpSync(DEFAULT_CONTENT_DIR, dir, { recursive: true });
  const target = path.join(dir, "presets.json");
  const data = JSON.parse(fs.readFileSync(target, "utf8"));
  edit(data);
  fs.writeFileSync(target, JSON.stringify(data));

  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function presetById(data, id) {
  return data.presets.find(preset => preset.id === id);
}

test("GET /api/presets: teacher only, every preset with knobs, defaults and a count", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };

  assert.equal((await request(app).get("/api/presets")).status, 401);

  const res = await request(app).get("/api/presets").set(auth);
  assert.equal(res.status, 200);
  assert.equal(res.body.shortLength, 10);
  assert.deepEqual(res.body.emphasis.map(item => item.id), ["all", "concepts", "practices", "perspectives"]);
  assert.ok(res.body.presets.length >= 5);

  res.body.presets.forEach(preset => {
    assert.ok(preset.label && preset.description, preset.id);
    assert.ok(preset.count > 0, `${preset.id} matches questions by default`);
    assert.equal(preset.defaults.id, preset.id);
    assert.ok(preset.knobs.length <= 3);
    assert.equal(preset.whoOptions.length > 0, preset.knobs.includes("who"), preset.id);
    // Only questions' counts and summaries: no filters with keys, no prompts.
    assert.equal(JSON.stringify(preset).includes("\"answer\""), false);
  });

  const core = res.body.presets.find(preset => preset.id === "core-ct-check");
  assert.equal(core.count, 20);
  assert.deepEqual(core.whoOptions.map(option => option.value), ["core", "core:P5", "core:P6", "core:S1", "core:S2"]);

  // Every option a card offers matches something: the core bank has no
  // perspectives questions, so the core card does not offer that emphasis,
  // and levels with no loop or code-ordering questions are left out.
  assert.deepEqual(core.emphasisOptions.map(item => item.id), ["all", "concepts", "practices"]);
  const loops = res.body.presets.find(preset => preset.id === "loops-conditionals");
  assert.equal(loops.whoOptions.some(option => option.value === "core:S2"), false);
  assert.ok(loops.whoOptions.some(option => option.value === "core"));
  const ordering = res.body.presets.find(preset => preset.id === "ordering-tracing");
  assert.equal(ordering.whoOptions.some(option => ["core:P5", "core:P6", "core:S2"].includes(option.value)), false);
  const rgsS1 = res.body.presets.find(preset => preset.id === "rgs-s1-starter");
  assert.deepEqual(rgsS1.emphasisOptions.map(item => item.id), ["all", "concepts", "practices", "perspectives"]);

  for (const preset of res.body.presets) {
    const whos = preset.knobs.includes("who") ? preset.whoOptions.map(option => option.value) : [undefined];
    for (const who of whos) {
      const choice = { ...preset.defaults, ...(who ? { who } : {}) };
      const preview = await request(app).post("/api/question-bank/preview").set(auth).send({ preset: choice });
      assert.ok(preview.body.count > 0, `${preset.id} offers ${who}, which matches nothing`);
    }
    for (const item of preset.emphasisOptions) {
      let any = false;
      for (const who of whos) {
        const preview = await request(app).post("/api/question-bank/preview").set(auth)
          .send({ preset: { ...preset.defaults, ...(who ? { who } : {}), emphasis: item.id } });
        any = any || preview.body.count > 0;
      }
      assert.ok(any, `${preset.id} offers emphasis ${item.id}, which matches nothing`);
    }
  }

  const mixed = res.body.presets.find(preset => preset.id === "mixed-level");
  assert.equal(mixed.whoOptions.some(option => option.level === null), false, "levelRequired leaves out 'all levels'");
  assert.equal(mixed.defaults.who, "core:P5");
});

test("a preset choice gives the same questions in the card, the preview and the event", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app, store } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const cards = (await request(app).get("/api/presets").set(auth)).body.presets;

  const choices = cards.map(card => card.defaults).concat([
    { id: "core-ct-check", who: "core:S1", emphasis: "practices" },
    { id: "core-ct-check", length: "short" },
    { id: "rgs-s2", emphasis: "concepts", length: "short" },
    { id: "loops-conditionals", who: "rgsynapse:S2" },
    { id: "mixed-level", who: "rgsynapse:S1", length: "short" },
    { id: "ordering-tracing", who: "rgsynapse" }
  ]);

  let n = 0;

  for (const choice of choices) {
    const preview = await request(app).post("/api/question-bank/preview").set(auth).send({ preset: choice });
    assert.equal(preview.status, 200, JSON.stringify(choice));
    assert.ok(preview.body.count > 0, JSON.stringify(choice));
    assert.equal(preview.body.selectionMode, "FILTER");
    assert.equal(preview.body.filter.audiences.length, 1, "one audience, so the advanced picker can show it");

    const card = cards.find(item => item.id === choice.id);
    if (JSON.stringify(choice) === JSON.stringify(card.defaults)) {
      assert.equal(preview.body.count, card.count, `${choice.id}: card count = preview count`);
    }

    // The filter the preview returns fills the advanced picker; sending it
    // back as a filter selects the same questions.
    const asFilter = await request(app).post("/api/question-bank/preview").set(auth).send({ filter: preview.body.filter });
    assert.deepEqual(asFilter.body.questions.map(q => q.id), preview.body.questions.map(q => q.id));

    n += 1;
    const created = await request(app).post("/api/events").set(auth).send({ title: `Preset ${n}`, preset: choice });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.event.question_count, preview.body.count);
    assert.deepEqual(store.getEventQuestions(created.body.event.id).map(q => q.id), preview.body.questions.map(q => q.id));
  }
});

test("knobs map onto filter keys, and knobs a preset does not offer are refused", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const preview = body => request(app).post("/api/question-bank/preview").set(auth).send(body);

  const s1Practices = await preview({ preset: { id: "core-ct-check", who: "core:S1", emphasis: "practices", length: "full" } });
  assert.deepEqual(s1Practices.body.filter, { audiences: ["core"], levels: ["S1"], nodes: ["practice"], types: ["mcq"] });

  const short = await preview({ preset: { id: "core-ct-check", length: "short" } });
  assert.equal(short.body.filter.limit, 10);
  assert.equal(short.body.count, 10);

  for (const [choice, pattern] of [
    [{ id: "nope" }, /unknown preset/],
    [{ id: "rgs-s2", who: "core:S1" }, /has no who setting/],
    [{ id: "loops-conditionals", emphasis: "concepts" }, /has no emphasis setting/],
    [{ id: "ordering-tracing", length: "short" }, /has no length setting/],
    [{ id: "core-ct-check", who: "rgsynapse:S1" }, /cannot be set to/],
    [{ id: "mixed-level", who: "core" }, /cannot be set to/],
    [{ id: "core-ct-check", emphasis: "vibes" }, /emphasis must be one of/],
    [{ id: "core-ct-check", length: "long" }, /length must be one of/],
    [{ id: "core-ct-check", colour: "blue" }, /unknown preset key/],
    ["core-ct-check", /preset must be an object/]
  ]) {
    const res = await preview({ preset: choice });
    assert.equal(res.status, 400, JSON.stringify(choice));
    assert.match(res.body.error, pattern);
    assert.equal((await request(app).post("/api/events").set(auth).send({ title: "Bad", preset: choice })).status, 400);
  }

  // A filter sent alongside a preset wins, as the advanced picker's does.
  const both = await preview({ preset: { id: "rgs-s2" }, filter: { audiences: ["core"], levels: ["P5"] } });
  assert.deepEqual(both.body.filter, { audiences: ["core"], levels: ["P5"] });
});

test("AI-scored questions come only from a preset that says aiScored, with the AI-off warning", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app, store } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };
  const cards = (await request(app).get("/api/presets").set(auth)).body.presets;
  const aiTypes = new Set(selection.aiScoredTypes());

  for (const card of cards) {
    const options = card.whoOptions.length ? card.whoOptions.map(option => option.value) : [undefined];

    for (const who of options) {
      const choice = { ...card.defaults, ...(who ? { who } : {}) };
      const res = await request(app).post("/api/question-bank/preview").set(auth).send({ preset: choice });
      const hasAi = res.body.questions.some(q => aiTypes.has(q.type));

      if (!card.aiScored) {
        assert.equal(hasAi, false, `${card.id} ${who || ""} must not include AI-scored questions`);
      }

      if (hasAi) {
        assert.match(res.body.warning, /AI is off/);
        // Still ordered after every other question.
        const firstAi = res.body.questions.findIndex(q => aiTypes.has(q.type));
        assert.ok(res.body.questions.slice(firstAi).every(q => aiTypes.has(q.type)));
      }
    }
  }

  const review = cards.find(card => card.id === "debugging-ai-review");
  assert.equal(review.aiScored, true);
  assert.equal(review.aiRequired, true);

  const created = await request(app).post("/api/events").set(auth).send({ title: "Review", preset: review.defaults });
  assert.equal(created.status, 201);
  assert.match(created.body.warning, /AI is off/);
  assert.ok(store.getEventQuestions(created.body.event.id).some(q => aiTypes.has(q.type)));
});

test("filter.limit: validated, deterministic, and balanced across levels and outcomes", async t => {
  const content = loadContent();

  assert.deepEqual(selection.normalizeFilter({ limit: 5 }, content).filter, { audiences: ["core"], limit: 5 });

  for (const limit of [0, -1, 101, 2.5, "10", true]) {
    const { filter, errors } = selection.normalizeFilter({ limit }, content);
    assert.equal(filter, null, String(limit));
    assert.match(errors[0], /filter.limit must be an integer from 1 to 100/);
  }

  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app, store } = ctx;
  const auth = { Authorization: `Bearer ${await login(app)}` };

  const all = selection.selectQuestions(store.db, { audiences: ["core"], types: ["mcq"] });
  const picked = selection.selectQuestions(store.db, { audiences: ["core"], types: ["mcq"], limit: 10 });
  assert.equal(picked.length, 10);
  assert.deepEqual(selection.selectQuestions(store.db, { audiences: ["core"], types: ["mcq"], limit: 10 }).map(q => q.id), picked.map(q => q.id), "same filter, same pick");

  // Bank order is kept.
  const positions = picked.map(q => all.findIndex(item => item.id === q.id));
  assert.deepEqual(positions, positions.slice().sort((a, b) => a - b));

  // Every level is represented, none has more than one extra.
  const perLevel = picked.reduce((acc, q) => ({ ...acc, [q.level]: (acc[q.level] || 0) + 1 }), {});
  assert.deepEqual(Object.keys(perLevel).sort(), ["P5", "P6", "S1", "S2"]);
  assert.ok(Math.max(...Object.values(perLevel)) - Math.min(...Object.values(perLevel)) <= 1, JSON.stringify(perLevel));

  // Within one level, outcomes are spread before any repeats.
  const s2 = selection.selectQuestions(store.db, { audiences: ["rgsynapse"], levels: ["S2"], limit: 6 });
  const s2Outcomes = s2.map(q => q.outcomes[0]);
  assert.equal(new Set(s2Outcomes).size, s2Outcomes.length, "six questions, six different outcomes");

  // A limit above the match count keeps everything.
  assert.equal(selection.selectQuestions(store.db, { audiences: ["core"], levels: ["P5"], limit: 50 }).length, 5);

  // The event list says there is a limit.
  const created = await request(app).post("/api/events").set(auth).send({ title: "Short", filter: { audiences: ["core"], limit: 4 } });
  assert.equal(created.body.event.question_count, 4);
  assert.match(created.body.event.filter_summary, /at most 4/);
});

test("the presets file is validated at boot", () => {
  const cases = [
    [data => { presetById(data, "rgs-s2").filter.types = ["open-response-ai"]; }, /includes AI-scored types, so it must say "aiScored": true/],
    [data => { delete presetById(data, "debugging-ai-review").filter.types; }, /says "aiScored": true but names no AI-scored type/],
    [data => { presetById(data, "loops-conditionals").knobs = ["length"]; }, /spans several audiences, so it needs the "who" knob/],
    [data => { presetById(data, "loops-conditionals").knobs.push("emphasis"); }, /fixes nodes, so it cannot offer the "emphasis" knob/],
    [data => { presetById(data, "rgs-s2").filter.limit = 5; }, /fixes a limit, so it cannot offer the "length" knob/],
    [data => { presetById(data, "rgs-s2").filter.questionIds = ["RGS-S2-01"]; }, /by tags, not by questionIds/],
    [data => { presetById(data, "rgs-s2").knobs = ["colour"]; }, /knobs must be a list/],
    [data => { presetById(data, "rgs-s2").filter.levels = ["S9"]; }, /unknown levels: S9/],
    [data => { presetById(data, "rgs-s2").id = "core-ct-check"; }, /unique and kebab-case/],
    [data => { presetById(data, "rgs-s2").description = ""; }, /needs a description/],
    [data => { presetById(data, "rgs-s2").levelRequired = true; }, /levelRequired must be true or false, and needs the "who" knob/],
    [data => { presetById(data, "rgs-s2").colour = "blue"; }, /unknown key "colour"/],
    [data => { data.shortLength = 0; }, /shortLength must be an integer from 1 to 100/],
    // An event's filter.limit tops out at 100, so a longer "short" setting
    // would compile to a filter no event accepts.
    [data => { data.shortLength = 101; }, /shortLength must be an integer from 1 to 100/]
  ];

  cases.forEach(([edit, pattern]) => {
    withEditedPresets(edit, dir => {
      assert.throws(() => loadContent(dir), pattern);
    });
  });

  // Valid structure but no matching questions: caught once the content
  // tables exist, so opening the database fails.
  withEditedPresets(data => {
    presetById(data, "rgs-s2").filter.difficulty = { min: 5 };
  }, dir => {
    assert.throws(() => openDatabase({ dbPath: ":memory:", contentDir: dir }), /preset "rgs-s2" matches no questions/);
  });
});
