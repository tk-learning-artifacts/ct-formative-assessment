// web/attempt-review.js (the review page's answer states) and the
// code-reading renderer's isPartial. web/ is an ES module package, so both
// files are run in a small vm context.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const webDir = path.join(__dirname, "../../web");
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(webDir, "attempt-review.js"), "utf8"), { module: mod });
const { questionState, summarize, reviewReachable } = mod.exports;

const registered = {};
vm.runInNewContext(fs.readFileSync(path.join(webDir, "types/code-reading.js"), "utf8"), {
  window: { CTQuestTypes: { register: (type, renderer) => { registered[type] = renderer; } } },
  document: { addEventListener() {} }
});

test("questionState: undefined and null are unanswered, a value is answered", () => {
  assert.equal(questionState({}, undefined, undefined), "unanswered");
  assert.equal(questionState({}, null, undefined), "unanswered");
  assert.equal(questionState({}, 0, undefined), "answered");
  assert.equal(questionState({}, [], undefined), "answered");
});

test("questionState: committed answers are locked, committed skips are locked-skipped", () => {
  assert.equal(questionState({}, null, { skipped: true }), "locked-skipped");
  assert.equal(questionState({}, 2, { skipped: false }), "locked");
});

test("questionState: partial only when the renderer says so", () => {
  const renderer = { isPartial: () => true };
  assert.equal(questionState({}, { choice: 1 }, undefined, renderer), "partial");
  assert.equal(questionState({}, { choice: 1 }, undefined, {}), "answered");
  assert.equal(questionState({}, undefined, undefined, renderer), "unanswered");
});

test("summarize: counts, with partial answers not counted as missing", () => {
  const questions = [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }, { id: "d", title: "D" }, { id: "e", title: "E" }];
  const summary = summarize(
    questions,
    { a: 1, c: { choice: 0 }, d: 3 },
    { d: { skipped: false }, e: { skipped: true } },
    question => (question.id === "c" ? { isPartial: () => true } : undefined),
    5
  );

  assert.deepEqual(summary.rows.map(row => row.state), ["answered", "unanswered", "partial", "locked", "locked-skipped"]);
  assert.equal(summary.answered, 2);
  assert.equal(summary.partial, 1);
  assert.equal(summary.unanswered, 1);
  assert.equal(summary.lockedSkipped, 1);
  assert.equal(summary.missing, 2);
});

test("summarize: questions never delivered count as missing", () => {
  const summary = summarize([{ id: "a" }], { a: 1 }, {}, () => undefined, 4);
  assert.equal(summary.missing, 3);
});

test("reviewReachable: always with free navigation; in order only once every question is held and committed", () => {
  assert.equal(reviewReachable({ linear: false, held: 1, questionCount: 5, committedCount: 0 }), true);
  assert.equal(reviewReachable({ linear: true, held: 5, questionCount: 5, committedCount: 3 }), false);
  assert.equal(reviewReachable({ linear: true, held: 4, questionCount: 5, committedCount: 4 }), false);
  assert.equal(reviewReachable({ linear: true, held: 5, questionCount: 5, committedCount: 5 }), true);
});

test("code-reading isPartial: one part of two is partial", () => {
  const { isPartial } = registered["code-reading"];
  assert.equal(isPartial({}, { choice: 1 }), false);
  assert.equal(isPartial({ followUp: {} }, { choice: 1 }), true);
  assert.equal(isPartial({ followUp: {} }, { followUp: 2 }), true);
  assert.equal(isPartial({ followUp: {} }, { choice: 1, followUp: 2 }), false);
  assert.equal(isPartial({ followUp: {} }, undefined), false);
});
