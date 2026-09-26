// Version 3: correct four questions inside existing event snapshots.
//
// Events freeze a copy of their questions, so fixing backend/content/ alone
// would leave events created before the fix (including DEMO123 in a deployed
// volume) marking students against the wrong key. Each patch only applies when
// the snapshot still matches the original v1 content, so an event built from
// already-corrected content is left alone.
//
// Scores of attempts submitted before this migration are not recomputed; the
// answers table keeps what the student was told at the time.

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
  version: 3,
  name: "fix-answer-keys",
  up(db) {
    const select = db.prepare("SELECT id, question_json FROM event_questions WHERE question_id = ?");
    const update = db.prepare("UPDATE event_questions SET question_json = ? WHERE id = ?");

    PATCHES.forEach(({ questionId, applies, patch }) => {
      select.all(questionId).forEach(row => {
        const question = JSON.parse(row.question_json);
        if (question.type === "mcq" && applies(question)) {
          update.run(JSON.stringify(patch(question)), row.id);
        }
      });
    });
  }
};
