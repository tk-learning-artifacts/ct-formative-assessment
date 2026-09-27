// The content files load, and the validator rejects the mistakes authors make.

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadContent, DEFAULT_CONTENT_DIR } = require("../src/content");
const { makeTempDir } = require("./helpers");

function withEditedContent(file, edit, fn) {
  const dir = makeTempDir();
  fs.cpSync(DEFAULT_CONTENT_DIR, dir, { recursive: true });
  const target = path.join(dir, file);
  const data = JSON.parse(fs.readFileSync(target, "utf8"));
  edit(data);
  fs.writeFileSync(target, JSON.stringify(data));

  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("the shipped content is valid", () => {
  const content = loadContent();
  assert.equal(content.questions.filter(q => q.audience === "core").length, 20);
  assert.equal(content.questions.filter(q => q.audience === "rgsynapse").length, 24);
  assert.ok(content.nodes.length >= 20);
  assert.ok(content.outcomes.length >= 10);
  assert.ok(content.questions.every(q => q.ontology.length && q.outcomes.length));
});

test("every learning outcome is used by at least one question", () => {
  const content = loadContent();
  const used = new Set(content.questions.flatMap(q => q.outcomes));
  assert.deepEqual(content.outcomes.map(o => o.id).filter(id => !used.has(id)), []);
});

const brokenCases = [
  ["questions/core.json", data => { data.questions[0].ontology.push("concept.unknown"); }, /unknown ontology node "concept.unknown"/],
  ["questions/core.json", data => { data.questions[0].outcomes = ["LO-STR-1"]; }, /does not cover that level/],
  ["questions/core.json", data => { data.questions[1].id = data.questions[0].id; }, /missing or duplicated/],
  ["questions/core.json", data => { data.questions[0].answer = { index: 9 }; }, /answer.index must point at one of the options/],
  ["questions/core.json", data => { data.questions[0].level = "S2"; data.questions[0].audience = "mars"; }, /unknown audience/],
  ["questions/rgsynapse.json", data => { data.questions[0].level = "P5"; }, /not offered to audience "rgsynapse"/],
  ["questions/core.json", data => { data.questions[0].difficulty = 9; }, /difficulty/],
  ["ontology.json", data => { data.nodes.find(n => n.id === "concept.sequences").prerequisites = ["concept.loops"]; }, /prerequisite cycle/],
  ["ontology.json", data => { data.nodes.find(n => n.id === "concept").parent = "concept.loops"; }, /parent cycle/],
  ["ontology.json", data => { data.nodes.find(n => n.id === "concept.loops").parent = "practice"; }, /sits under/],
  ["learning-outcomes.json", data => { data.outcomes[0].nodes = ["concept.nope"]; }, /maps to unknown node/],
  ["ontology.json", data => {
    data.nodes.push({ id: "concept.algorithms", kind: "concept", label: "Algorithms", parent: "concept", prerequisites: [], sources: [{ framework: "ctquest", term: "x" }] });
  }, /reserved for brennan-resnick-2012 nodes/],
  ["questions/core.json", data => { data.questions[0].crosswalk = { bebrasCategory: "robots" }; }, /crosswalk bebrasCategory "robots" is not one of/],
  ["questions/core.json", data => { data.questions[0].crosswalk = { moe: "x" }; }, /unknown crosswalk "moe"/],
  ["legacy-modes.json", data => { data.modes.ALL.push("NOPE-1"); }, /lists unknown question "NOPE-1"/],
  ["legacy-modes.json", data => { data.modes.P5.push("S1-01"); }, /not a core P5 question/],
  ["legacy-modes.json", data => { data.modes.ALL.push("RGS-S1-01"); }, /not a core question/],
  ["legacy-modes.json", data => { delete data.modes.S2; }, /mode "S2" needs/]
];

test("adding a core question does not change what the legacy ALL and level modes select", () => {
  const { openDatabase } = require("../src/db");
  const selection = require("../src/selection");

  withEditedContent("questions/core.json", data => {
    data.questions.push({ ...data.questions[0], id: "P5-99", title: "New P5 question" });
  }, dir => {
    const store = openDatabase({ dbPath: ":memory:", contentDir: dir });
    try {
      assert.equal(store.previewQuestions(selection.legacyModeToFilter("ALL", store.content)).length, 20);
      assert.equal(store.previewQuestions(selection.legacyModeToFilter("P5", store.content)).length, 5);
      assert.equal(store.previewQuestions({ audiences: ["core"], levels: ["P5"] }).length, 6);
    } finally {
      store.close();
    }
  });
});

brokenCases.forEach(([file, edit, pattern]) => {
  test(`the validator rejects: ${pattern}`, () => {
    withEditedContent(file, edit, dir => {
      assert.throws(() => loadContent(dir), pattern);
    });
  });
});
