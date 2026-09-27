// Question visuals (ADR 0007): boot validation of every kind, the student
// projection, answer safety (no key in a visual's data, description, file
// name or image metadata), colours only as Slate tokens, the image files,
// and the visuals over HTTP: what a student is sent, what the teacher
// preview shows, and the files the pages load.

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { loadContent, DEFAULT_CONTENT_DIR } = require("../src/content");
const scoring = require("../src/scoring");
const visuals = require("../src/visuals");
const { SOLVERS } = require("./solvers");
const { buildApp, login, startAttempt, getAttempt, submit, allKeys, makeTempDir } = require("./helpers");

const V = visuals.core;
const { questions } = loadContent();
const withVisual = questions.filter(question => question.visual);
const IMG_DIR = visuals.DEFAULT_IMAGE_DIR;

// A minimal valid visual per kind, for the validator tests.
const GOOD = {
  grid: { kind: "grid", purpose: "information", rows: ["S.", "#T"] },
  cells: { kind: "cells", purpose: "reading-load", rows: [{ label: "Row", cells: ["1", { shape: "circle" }, { fill: "dark" }, "…"] }] },
  graph: { kind: "graph", purpose: "information", nodes: [{ id: "A", x: 30, y: 30 }, { id: "B", x: 200, y: 30 }], edges: [{ from: "A", to: "B", weight: 3 }] },
  flowchart: {
    kind: "flowchart",
    purpose: "reading-load",
    nodes: [
      { id: "s", type: "start", text: "Begin", col: 0, row: 0 },
      { id: "q", type: "decision", text: "Is it big?", col: 0, row: 1 },
      { id: "y", type: "end", text: "Big", col: 0, row: 2 },
      { id: "n", type: "end", text: "Small", col: 1, row: 2 }
    ],
    edges: [{ from: "s", to: "q" }, { from: "q", to: "y", label: "Yes" }, { from: "q", to: "n", label: "No", exit: "right" }]
  },
  table: { kind: "table", purpose: "information", columns: ["In", "Out"], rows: [["1", "2"]] },
  illustration: {
    kind: "illustration",
    purpose: "context",
    src: "p5-01.webp",
    alt: "A robot beside a table.",
    source: { generator: "codex", prompt: "A robot beside a table.", date: "2026-09-27", reviewed: true }
  }
};

function check(visual, id = "P5-01", extra = {}) {
  return visuals.validateQuestionVisual({ id, ...extra, visual });
}

test("every kind file in web/visuals/kinds/ is loaded, and each has a valid example here", () => {
  const files = fs.readdirSync(visuals.KINDS_DIR).filter(name => name.endsWith(".js")).map(name => name.replace(/\.js$/, "")).sort();
  assert.deepEqual(visuals.kinds(), files);
  assert.deepEqual(Object.keys(GOOD).sort(), files, "add a valid example of the new kind to GOOD");
  Object.values(GOOD).forEach(visual => assert.deepEqual(check(visual), [], visual.kind));
});

test("boot validation refuses a broken visual", () => {
  const cases = [
    [{ kind: "sketch", purpose: "information" }, /unknown kind "sketch"/],
    [{ ...GOOD.grid, purpose: undefined }, /purpose must be one of/],
    [{ ...GOOD.grid, purpose: "context" }, /cannot have purpose "context"/],
    [{ ...GOOD.illustration, purpose: "information" }, /cannot have purpose "information"/],
    [{ ...GOOD.grid, highlight: ["A1"] }, /unknown key "highlight"/],
    [{ ...GOOD.grid, caption: "two\nlines" }, /caption must be one line/],
    [{ ...GOOD.grid, rows: ["S.", "T"] }, /row 2 must be a string 2 cells wide/],
    [{ ...GOOD.grid, rows: ["..", ".T"] }, /exactly one S/],
    [{ ...GOOD.cells, rows: [{ cells: [{ shape: "star" }] }] }, /shape must be one of/],
    [{ ...GOOD.graph, edges: [{ from: "A", to: "Z" }] }, /does not exist/],
    [{ ...GOOD.graph, nodes: [{ id: "A", x: 30, y: 30 }, { id: "B", x: 40, y: 30 }] }, /too close/],
    [{ ...GOOD.flowchart, edges: GOOD.flowchart.edges.slice(0, 2) }, /exactly two arrows out/],
    [{ ...GOOD.flowchart, edges: GOOD.flowchart.edges.concat({ from: "y", to: "s" }) }, /leaves an end box/],
    [{ ...GOOD.flowchart, nodes: GOOD.flowchart.nodes.map(node => (node.id === "q" ? { ...node, text: "Is this number much bigger than the one before it?" } : node)) }, /does not fit/],
    [{ ...GOOD.table, rows: [["1"]] }, /must have 2 cells/],
    [{ ...GOOD.illustration, alt: "" }, /needs alt text/],
    [{ ...GOOD.illustration, alt: undefined }, /needs alt text/],
    [{ ...GOOD.illustration, source: undefined }, /source must be an object/],
    [{ ...GOOD.illustration, source: { ...GOOD.illustration.source, reviewed: false } }, /reviewed must be true/],
    [{ ...GOOD.illustration, src: "robot-puts-note-first.webp" }, /named after the question/],
    [{ ...GOOD.illustration, src: "p5-01-2.webp" }, /does not exist/],
    [{ ...GOOD.illustration, src: "p5-01.png" }, /lower-case \.webp/]
  ];

  cases.forEach(([visual, pattern]) => {
    const errors = check(visual);
    assert.ok(errors.some(message => pattern.test(message)), `${JSON.stringify(visual).slice(0, 80)}: expected ${pattern}, got ${JSON.stringify(errors)}`);
  });

  assert.ok(check(GOOD.grid, "X-1", { art: "S ." }).some(message => /both art and a visual/.test(message)));
});

test("the server refuses to start on an unknown kind, a missing alt or a missing file", () => {
  const breakages = [
    [question => { question.visual = { kind: "sketch", purpose: "information" }; }, /P6-01" visual has unknown kind "sketch"/],
    [question => { delete question.visual.alt; }, /needs alt text/],
    [question => { question.visual.src = "p6-01.webp"; }, /file p6-01\.webp does not exist/]
  ];

  breakages.forEach(([edit, pattern], i) => {
    const dir = makeTempDir();
    try {
      fs.cpSync(DEFAULT_CONTENT_DIR, dir, { recursive: true });
      const file = path.join(dir, "questions/core.json");
      const bank = JSON.parse(fs.readFileSync(file, "utf8"));
      const question = bank.questions.find(item => item.id === "P6-01");
      if (i > 0) {
        question.visual = { ...GOOD.illustration };
        delete question.art;
      }
      edit(question);
      fs.writeFileSync(file, JSON.stringify(bank));
      assert.throws(() => loadContent(dir), pattern);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("an image with metadata, over the size cap or not a WebP is refused", () => {
  const dir = makeTempDir();
  const good = fs.readFileSync(path.join(IMG_DIR, "p5-01.webp"));

  try {
    // Append an EXIF chunk and fix the RIFF size, as a generator's file would carry.
    const exif = Buffer.concat([Buffer.from("EXIF"), Buffer.from([8, 0, 0, 0]), Buffer.from("prompt:x")]);
    const tagged = Buffer.concat([good, exif]);
    tagged.writeUInt32LE(tagged.length - 8, 4);
    fs.writeFileSync(path.join(dir, "p5-01.webp"), tagged);
    fs.writeFileSync(path.join(dir, "p5-01-2.webp"), Buffer.concat([good, Buffer.alloc(visuals.MAX_IMAGE_BYTES)]));
    fs.writeFileSync(path.join(dir, "p5-01-3.webp"), Buffer.from("\x89PNG\r\n\x1a\n not really"));

    const run = src => visuals.validateQuestionVisual({ id: "P5-01", visual: { ...GOOD.illustration, src } }, { imageDir: dir });
    assert.ok(run("p5-01.webp").some(message => /carries metadata \(EXIF\)/.test(message)));
    assert.ok(run("p5-01-2.webp").some(message => /the limit is 100 KB/.test(message)));
    assert.ok(run("p5-01-3.webp").some(message => /is not a WebP/.test(message)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the shipped images are small WebPs with nothing in them but the picture", () => {
  const files = fs.readdirSync(IMG_DIR);
  const used = new Set(withVisual.filter(question => question.visual.kind === "illustration").map(question => question.visual.src));
  assert.deepEqual(files.filter(name => !used.has(name)), [], "an image in web/visuals/img/ that no question uses");

  files.forEach(name => {
    const buffer = fs.readFileSync(path.join(IMG_DIR, name));
    const info = visuals.inspectWebp(buffer);
    assert.equal(info.error, undefined, name);
    assert.ok(buffer.length <= visuals.MAX_IMAGE_BYTES, `${name} is ${buffer.length} bytes`);
    assert.deepEqual(info.chunks.filter(chunk => !["VP8 ", "VP8L", "VP8X", "ALPH"].includes(chunk)), [], name);
    assert.ok(Math.max(info.width, info.height) <= visuals.MAX_IMAGE_SIDE, `${name} is ${info.width} by ${info.height}`);
    assert.doesNotMatch(buffer.toString("latin1"), /c2pa|jumb|prompt|openai|gemini|exif|xmp/i, `${name} carries text`);
  });
});

test("a student gets a visual through the kind's allowlist, never its purpose or provenance", () => {
  assert.ok(scoring.BASE_PUBLIC_FIELDS.includes("visual"));

  withVisual.forEach(question => {
    const safe = scoring.toPublicQuestion(question).visual;
    const def = V.get(question.visual.kind);
    const allowed = V.PUBLIC_COMMON.concat(def.fields);
    Object.keys(safe).forEach(key => assert.ok(allowed.includes(key), `${question.id}: "${key}" reached the student`));
    assert.equal(safe.purpose, undefined);
    assert.equal(safe.source, undefined);
    assert.equal(safe.kind, question.visual.kind);
  });
});

// The text a key is shown as, for the leak check: an MCQ's correct option,
// a code-trace's output, a code-reading's correct description.
function keyTexts(question) {
  if (question.type === "mcq" || question.type === "code-reading") {
    return [question.options[question.answer.index]];
  }
  if (question.type === "code-trace") {
    return [question.answer.output];
  }
  return [];
}

// Numbers and single letters are everywhere (a grid's row numbers, a node
// called A), so only a key of three or more characters that is not a plain
// number is searched for, and only where the prompt does not already say it.
test("no visual carries the answer the prompt does not already give", () => {
  withVisual.forEach(question => {
    const safe = scoring.toPublicQuestion(question).visual;
    const said = [JSON.stringify(safe), V.describe(safe), safe.src || ""].join(" ").toLowerCase();

    keyTexts(question)
      .map(text => String(text).trim().toLowerCase())
      .filter(text => text.length >= 3 && !/^-?[\d.]+( steps)?$/.test(text))
      .filter(text => !question.prompt.toLowerCase().includes(text))
      .forEach(text => assert.ok(!said.includes(text), `${question.id}: the visual says "${text}", the key`));
  });

  // A computed numeric answer (P6-01's 6 steps, S2-02's cheapest cost, S2-04's
  // count) is not one of the values the visual draws, unless the prompt
  // already has that number (P6-03's row holds a 3 because the prompt does).
  // Positions (x, y, col, row, numberFrom) are layout, not content.
  const LAYOUT = new Set(["x", "y", "col", "row", "numberFrom"]);
  const values = (value, key, out) => {
    if (Array.isArray(value)) {
      value.forEach(item => values(item, key, out));
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => values(v, k, out));
    } else if (!LAYOUT.has(key)) {
      out.push(String(value));
    }
    return out;
  };

  withVisual.filter(question => question.type === "mcq").forEach(question => {
    const solved = SOLVERS[question.id](question);
    if (typeof solved !== "number") {
      return;
    }
    const inPrompt = new RegExp(`(^|[^\\d.])${solved}([^\\d.]|$)`).test(question.prompt);
    const drawn = values(scoring.toPublicQuestion(question).visual, null, []);
    assert.ok(inPrompt || !drawn.includes(String(solved)), `${question.id}: the answer ${solved} is drawn in the visual`);
  });
});

test("every figure renders with only token colours, a label and a description it points at", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../../web/visuals/visuals.css"), "utf8");
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "visuals.css names a colour; use a token");

  withVisual.concat(Object.values(GOOD)).forEach(item => {
    const visual = item.visual || item;
    const safe = V.toPublic(visual);
    const html = V.figure(safe, { id: "t" });
    const def = V.get(visual.kind);
    const where = item.id || visual.kind;

    assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b|rgba?\(|\bfill="(?!url)[a-z]|\bstroke="[a-z]|style="/, `${where}: a colour in the markup`);

    if (def.structured && !def.textual) {
      assert.match(html, /<svg [^>]*role="img"[^>]*aria-labelledby="t-label"[^>]*aria-describedby="t-desc"/, where);
      assert.match(html, /<title id="t-label">/, where);
      assert.match(html, /<p id="t-desc">[^<]{20,}<\/p>/, where);
      const width = Number(html.match(/viewBox="0 0 (\d+(?:\.\d+)?)/)[1]);
      assert.ok(width <= 360, `${where}: ${width} units wide; keep figures at most 360 so text stays readable at 390px`);
    } else if (def.textual) {
      assert.match(html, /<table class="qv-table"><thead>/, where);
    } else {
      assert.match(html, new RegExp(`<img [^>]*alt="${V.esc(visual.alt).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), where);
    }
  });
});

test("the visuals over HTTP: the student's questions, the breakdown, the teacher's preview and the files", async t => {
  const ctx = await buildApp();
  t.after(() => ctx.cleanup());
  const { app } = ctx;
  const token = await login(app);
  const auth = { Authorization: `Bearer ${token}` };
  const ids = withVisual.map(question => question.id);

  await t.test("the pages learn the kinds from the server, and every kind file and image is served", async () => {
    const res = await request(app).get("/api/web-visuals");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.kinds, visuals.kinds().map(kind => `visuals/kinds/${kind}.js`));

    for (const file of ["visuals/visuals.js", "visuals/visuals.css"].concat(res.body.kinds)) {
      assert.equal((await request(app).get(`/${file}`)).status, 200, file);
    }

    for (const name of fs.readdirSync(IMG_DIR)) {
      const image = await request(app).get(`/visuals/img/${name}`);
      assert.equal(image.status, 200, name);
      assert.match(image.headers["content-type"], /image\/webp/);
    }

    for (const url of ["/visuals/package.json", "/visuals/kinds/../../package.json", "/visuals/img/p5-01.png", "/visuals/img/../../package.json"]) {
      assert.equal((await request(app).get(url)).status, 404, url);
    }
  });

  await t.test("a student is sent the projected visual; the released breakdown too; the teacher sees everything", async () => {
    const created = await request(app).post("/api/events").set(auth).send({
      title: "Visuals", joinCode: "VIS1", feedbackMode: "end",
      filter: { audiences: ["core", "rgsynapse"], questionIds: ids }
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const started = await startAttempt(app, { joinCode: "VIS1" });
    assert.equal(started.questions.length, ids.length);
    started.questions.forEach(question => {
      assert.ok(question.visual, question.id);
      assert.deepEqual(question.visual, visuals.toPublic(withVisual.find(item => item.id === question.id).visual));
    });
    const visualKeys = body => allKeys((body.questions || []).map(question => question.visual));
    assert.ok(!visualKeys(started).has("source") && !visualKeys(started).has("purpose"), "provenance or purpose reached the student");

    await submit(app, started.attempt, {}).expect(200);
    const after = await getAttempt(app, started.attempt);
    assert.equal(after.status, 200);
    assert.ok(after.body.result.perQuestion, "the breakdown is released under \"end\"");
    assert.ok(after.body.questions.every(question => question.visual), "the breakdown's questions carry their figures");
    assert.ok(!visualKeys(after.body).has("source") && !visualKeys(after.body).has("purpose"));

    const preview = await request(app).get(`/api/events/${created.body.event.id}/questions`).set(auth);
    assert.equal(preview.status, 200);
    const p501 = preview.body.questions.find(question => question.id === "P5-01");
    assert.equal(p501.visual.source.generator, "codex");
    assert.equal(p501.visual.purpose, "context");
  });
});
