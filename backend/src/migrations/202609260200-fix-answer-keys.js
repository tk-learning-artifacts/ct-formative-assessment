// Correct four questions inside existing event snapshots, but only for
// events that have no submitted attempts.
//
// Events freeze a copy of their questions, so fixing backend/content/ alone
// leaves events created before the fix marking against the wrong key. For
// an event nobody has submitted yet, the snapshot is patched and every future
// student gets the corrected question. An event that already has submissions
// is left exactly as its students saw it: its snapshot, the stored answers
// (which also record the chosen option's text) and the awarded scores all
// stay consistent, and the teacher's results view never pairs an old answer
// with changed option text. The cost is that further students on such an
// event still see the flawed question; the teacher should start a new event.
// Each patch only applies when the snapshot still matches the v1 content.

const PATCHES = [
  {
    // "3, 1, 2" also closes the box last, so two options always worked.
    // The distractor becomes "3, 2, 1", which closes the box too early.
    questionId: "P5-01",
    applies: q => q.options[1] === "3, 1, 2",
    patch: q => ({ ...q, options: q.options.map((option, i) => (i === 1 ? "3, 2, 1" : option)) })
  },
  {
    // The grid's shortest path is 6 steps, not 7.
    questionId: "P6-01",
    applies: q => q.answer.index === 1 && q.options[0] === "6 steps",
    patch: q => ({ ...q, answer: { index: 0 } })
  },
  {
    // A->B->C->D costs 4, which was not an option. Options now include it.
    questionId: "S2-02",
    applies: q => JSON.stringify(q.options) === JSON.stringify(["6", "7", "8", "9"]),
    patch: q => ({ ...q, options: ["4", "6", "7", "8"], answer: { index: 0 } })
  },
  {
    // "3" and "B" were both correct. The question now asks which line runs.
    questionId: "S1-01",
    applies: q => q.options[0] === "3" && q.options[1] === "B",
    patch: q => ({
      ...q,
      prompt: "A student writes this rule to return the larger of A and B:\n\n" +
        "If A > B, return A\n" +
        "Else return B\n\n" +
        "When A = 3 and B = 3, which line runs?",
      options: [
        "The first line runs and returns A",
        "The Else line runs and returns B",
        "It crashes",
        "It returns nothing"
      ],
      answer: { index: 1 }
    })
  }
];

module.exports = {
  up(db, ctx = {}) {
    const log = ctx.log || (() => {});
    const events = db.prepare(`
      SELECT e.id, e.join_code,
             (SELECT COUNT(*) FROM attempts a WHERE a.event_id = e.id AND a.status = 'submitted') AS submitted
      FROM events e
    `).all();
    const select = db.prepare("SELECT id, question_json FROM event_questions WHERE event_id = ? AND question_id = ?");
    const update = db.prepare("UPDATE event_questions SET question_json = ? WHERE id = ?");

    events.forEach(event => {
      PATCHES.forEach(({ questionId, applies, patch }) => {
        select.all(event.id, questionId).forEach(row => {
          const question = JSON.parse(row.question_json);

          if (question.type !== "mcq" || !applies(question)) {
            return;
          }

          if (event.submitted > 0) {
            log(`Left ${questionId} unpatched in event ${event.join_code}: it already has submissions`);
            return;
          }

          update.run(JSON.stringify(patch(question)), row.id);
        });
      });
    });
  }
};
