// No answer leaks for the code-reading and blocks types, in every feedback
// timing and navigation mode. A student answers each question wrongly and
// every response along the way is checked: start, the status poll, each
// commit (where the settings use commits), resume, submit, resume after
// submit and, under "release", resume after the teacher releases.
//
// Never, in any response: a block question's hidden grids, its reference
// solution (as data, words or Python), or any teacher-only field. The keys
// (correctResponse, which for code-reading carries the follow-up key) appear
// only once the event's feedback timing allows: after each commit under
// "each", after submit under "end", after release under "release".

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildApp, login, startAttempt, submit, getAttempt, allKeys } = require("./helpers");
const engine = require("../../web/lib/blocks-engine");

const IDS = ["CR-P5-01", "CR-P6-01", "BLK-S1-01", "BLK-RGS-S2-01"];
const TEACHER_ONLY_KEYS = ["answer", "details", "cases", "solution", "programText", "rubric"];
const KEY_KEYS = ["correctResponse", "perQuestion", "correct"];

function wrongResponse(question) {
  if (question.type === "code-reading") {
    const choice = (question.answer.index + 1) % question.options.length;
    const followUp = question.followUp.kind === "choice"
      ? (question.answer.followUp + 1) % question.followUp.options.length
      : [1, 2].find(line => ![].concat(question.answer.followUp).includes(line));
    return { choice, followUp };
  }

  // The starting program as given: a real program that fails some grid.
  return question.startProgram;
}

function secretsOf(questions) {
  const secrets = [];

  questions.filter(q => q.type === "blocks").forEach(q => {
    q.cases.forEach((stage, i) => secrets.push([`${q.id} hidden grid ${i + 1}`, JSON.stringify(stage.grid)]));
    const solution = engine.normalizeWorkspace(q.solution, { world: q.world, variables: q.variables || [] }).value;
    secrets.push([`${q.id} solution`, JSON.stringify(solution)]);
    secrets.push([`${q.id} solution as words`, JSON.stringify(engine.toText(solution)).slice(1, -1)]);
    secrets.push([`${q.id} solution as Python`, JSON.stringify(engine.toPython(solution)).slice(1, -1)]);
  });

  return secrets;
}

function check(body, secrets, { keysAllowed }, where) {
  const text = JSON.stringify(body);
  const keys = allKeys(body);

  secrets.forEach(([name, value]) => assert.ok(!text.includes(value), `${where}: ${name} reached the student`));
  TEACHER_ONLY_KEYS.forEach(key => assert.ok(!keys.has(key), `${where}: "${key}" reached the student`));

  if (!keysAllowed) {
    KEY_KEYS.forEach(key => assert.ok(!keys.has(key), `${where}: "${key}" before the feedback timing allows`));
  }
}

for (const feedbackMode of ["each", "end", "release"]) {
  for (const navigationMode of ["free", "linear"]) {
    test(`code-reading and blocks: nothing leaks under feedback ${feedbackMode}, navigation ${navigationMode}`, async t => {
      const ctx = await buildApp();
      t.after(() => ctx.cleanup());
      const { app, store } = ctx;
      const auth = { Authorization: `Bearer ${await login(app)}` };
      const where = step => `${feedbackMode}/${navigationMode} ${step}`;

      const created = await request(app).post("/api/events").set(auth).send({
        title: "Leak check", joinCode: "LEAK1", feedbackMode, navigationMode,
        filter: { audiences: ["core", "rgsynapse"], questionIds: IDS }
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const eventId = created.body.event.id;
      const questions = store.getEventQuestions(eventId);
      assert.deepEqual(questions.map(q => q.id).sort(), IDS.slice().sort());
      const secrets = secretsOf(questions);
      assert.ok(secrets.length >= 8);

      const started = await startAttempt(app, { joinCode: "LEAK1" });
      const { attempt } = started;
      check(started, secrets, { keysAllowed: false }, where("start"));

      const status = () => request(app).get(`/api/attempts/${attempt.id}?fields=status`).set("X-Attempt-Token", attempt.token);
      check((await status()).body, secrets, { keysAllowed: false }, where("status"));

      const answers = Object.fromEntries(questions.map(q => [q.id, wrongResponse(q)]));
      const commits = feedbackMode === "each" || navigationMode === "linear";

      if (commits) {
        for (const question of questions) {
          const res = await request(app).post(`/api/attempts/${attempt.id}/answers/${encodeURIComponent(question.id)}/commit`)
            .set("X-Attempt-Token", attempt.token).send({ response: answers[question.id] });
          assert.equal(res.status, 200, `${where(`commit ${question.id}`)}: ${JSON.stringify(res.body)}`);
          check(res.body, secrets, { keysAllowed: feedbackMode === "each" }, where(`commit ${question.id}`));
          check((await status()).body, secrets, { keysAllowed: false }, where(`status after ${question.id}`));
        }

        if (feedbackMode === "each") {
          // The committed wrong answers are marked, with the key, at once.
          const resumed = await getAttempt(app, attempt);
          const reading = resumed.body.progress.committed.find(item => item.questionId === "CR-P5-01");
          assert.equal(reading.result.correct, false);
          assert.equal(reading.result.correctResponse.followUp.index, questions.find(q => q.id === "CR-P5-01").answer.followUp);
        }
      }

      const resumed = await getAttempt(app, attempt);
      assert.equal(resumed.status, 200);
      check(resumed.body, secrets, { keysAllowed: feedbackMode === "each" }, where("resume"));

      const submitted = await submit(app, attempt, answers);
      assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
      check(submitted.body, secrets, { keysAllowed: false }, where("submit"));
      assert.equal(submitted.body.result.score, 0, where("every answer was wrong"));

      const after = await getAttempt(app, attempt);
      check(after.body, secrets, { keysAllowed: feedbackMode !== "release" }, where("resume after submit"));
      check((await status()).body, secrets, { keysAllowed: false }, where("status after submit"));

      if (feedbackMode === "release") {
        assert.equal(after.body.result.perQuestion, undefined);
        assert.equal((await request(app).post(`/api/events/${eventId}/release`).set(auth)).status, 200);
      }

      // The breakdown: code-reading shows both keys; blocks shows no key at
      // all, only how many grids passed.
      const released = await getAttempt(app, attempt);
      check(released.body, secrets, { keysAllowed: true }, where("breakdown"));
      const byId = Object.fromEntries(released.body.result.perQuestion.map(item => [item.id, item]));
      assert.ok(byId["CR-P6-01"].correctResponse.followUp.line);
      assert.equal(byId["BLK-S1-01"].correctResponse, null);
    });
  }
}
