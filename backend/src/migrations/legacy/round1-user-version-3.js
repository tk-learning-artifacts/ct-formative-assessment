// Bridge for databases made by the first review round of this branch
// (commit 11e499d and earlier), which tracked migrations with PRAGMA
// user_version = 3 instead of schema_migrations. Those builds never shipped,
// but they ran in review worktrees and local tests, so their databases are
// brought up to the same schema as the current migrations produce:
//
// - schema_migrations is created and the three current migrations are marked
//   applied (round 1's v1-v3 did the same work, apart from what follows);
// - the columns and index round 1 lacked are added and backfilled:
//   events.results_released_at (set: these events predate release gating,
//   so students keep seeing their breakdown), attempts.late (0: round 1
//   refused late submissions), attempts.student_key, reset_at, reset_by,
//   answers.detail_json, idx_attempts_student;
// - integer response_json values become { index, text }.
//
// Round 1's key-fix migration patched every snapshot, including events that
// already had submissions. For answers given before round 1 (attempts with no
// token), the current snapshot may no longer show what the student saw for
// P5-01, S1-01 and S2-02, so their text comes from the original v1 option
// lists below, which are exactly what those students were shown. Every other
// answer takes its text from the current snapshot.

const { studentKey } = require("../../policy");

const MIGRATION_IDS = ["202609260000-baseline", "202609260100-platform-core", "202609260200-fix-answer-keys"];

const V1_OPTIONS = {
  "P5-01": ["1, 2, 3", "3, 1, 2", "2, 1, 3", "1, 3, 2"],
  "S1-01": ["3", "B", "It crashes", "It returns nothing"],
  "S2-02": ["6", "7", "8", "9"]
};

function bridgeRound1(db, ctx = {}) {
  const now = new Date().toISOString();
  const bankById = new Map(((ctx.content && ctx.content.questions) || []).map(question => [question.id, question]));

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);

    ALTER TABLE events ADD COLUMN results_released_at TEXT;
    ALTER TABLE attempts ADD COLUMN late INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE attempts ADD COLUMN student_key TEXT;
    ALTER TABLE attempts ADD COLUMN reset_at TEXT;
    ALTER TABLE attempts ADD COLUMN reset_by INTEGER;
    ALTER TABLE answers ADD COLUMN detail_json TEXT;

    CREATE INDEX idx_attempts_student ON attempts (event_id, student_key);
  `);

  const record = db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");
  MIGRATION_IDS.forEach(id => record.run(id, now));

  db.prepare("UPDATE events SET results_released_at = ?").run(now);

  const setKey = db.prepare("UPDATE attempts SET student_key = ? WHERE id = ?");
  db.prepare("SELECT id, student_name, student_group FROM attempts").all()
    .forEach(row => setKey.run(studentKey(row.student_name, row.student_group), row.id));

  // Round 1 upgraded v1 snapshots without tags; backfill them from the bank.
  const snapshots = db.prepare("SELECT id, event_id, question_id, question_json FROM event_questions").all();
  const setSnapshot = db.prepare("UPDATE event_questions SET question_json = ? WHERE id = ?");
  const options = new Map();

  snapshots.forEach(row => {
    const question = JSON.parse(row.question_json);
    const bank = bankById.get(row.question_id);

    if (bank && (!Array.isArray(question.ontology) || !Array.isArray(question.outcomes))) {
      setSnapshot.run(JSON.stringify({ ...question, ontology: bank.ontology.slice(), outcomes: bank.outcomes.slice() }), row.id);
    }

    options.set(`${row.event_id}\u001f${row.question_id}`, question.options || []);
  });

  const answers = db.prepare(`
    SELECT ans.id, ans.question_id, ans.response_json, a.event_id, a.token_hash
    FROM answers ans
    JOIN attempts a ON a.id = ans.attempt_id
  `).all();
  const setResponse = db.prepare("UPDATE answers SET response_json = ? WHERE id = ?");

  answers.forEach(row => {
    const parsed = row.response_json === null ? null : JSON.parse(row.response_json);

    if (!Number.isInteger(parsed)) {
      return;
    }

    const shown = !row.token_hash && V1_OPTIONS[row.question_id]
      ? V1_OPTIONS[row.question_id]
      : options.get(`${row.event_id}\u001f${row.question_id}`) || [];
    const text = shown[parsed] === undefined ? null : shown[parsed];

    setResponse.run(JSON.stringify({ index: parsed, text }), row.id);
  });
}

module.exports = {
  bridgeRound1,
  MIGRATION_IDS
};
