// Per-event assessment settings (ADR 0003) and per-question commits.
//
// events:  feedback_mode ("each", "end" or "release") and navigation_mode
//          ("free" or "linear"). Existing events get "release" and "free",
//          which is exactly how they behaved before, so nothing changes for
//          them.
// answers: committed_at, set when a student commits one answer before
//          submitting (feedback after each question, or in-order
//          navigation). A committed answer is final: submit keeps it and
//          ignores anything sent for that question. Rows written at submit
//          leave it null.

module.exports = {
  up(db) {
    db.exec(`
      ALTER TABLE events ADD COLUMN feedback_mode TEXT NOT NULL DEFAULT 'release'
        CHECK (feedback_mode IN ('each', 'end', 'release'));
      ALTER TABLE events ADD COLUMN navigation_mode TEXT NOT NULL DEFAULT 'free'
        CHECK (navigation_mode IN ('free', 'linear'));

      ALTER TABLE answers ADD COLUMN committed_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_answers_attempt ON answers (attempt_id, question_id);
    `);
  }
};
