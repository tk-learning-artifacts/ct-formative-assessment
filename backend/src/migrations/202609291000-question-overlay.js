// Teachers review the shared question bank and may flag, comment on, edit
// the metadata of and retire questions. The questions stay in
// backend/content/questions/*.json, which the app never writes; these tables
// are laid over them (src/overlay.js).
//
// question_overrides: one row per question that has anything on it. A NULL
// field means "no override, use the JSON". There is deliberately no foreign
// key to bank_questions: syncContent empties that table on every boot, and a
// question that leaves the JSON keeps its row here until it comes back.
//
// question_comments: append-only remarks by teachers. resolved_at is for a
// later "mark resolved" action; nothing sets it yet.
//
// question_override_changes: who changed what and when, one row per field,
// modelled on event_setting_changes. Values are text (JSON for lists).
//
// bank_questions.retired: 1 when the question is retired, so the SQL in
// selection.js can leave it out of every event. It is rewritten from
// question_overrides at each boot.

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS question_overrides (
        question_id TEXT PRIMARY KEY,
        level TEXT,
        points INTEGER,
        topic TEXT,
        q_type TEXT,
        difficulty INTEGER,
        ontology_json TEXT,
        outcomes_json TEXT,
        details TEXT,
        retired_at TEXT,
        retired_by INTEGER REFERENCES users(id),
        flagged_at TEXT,
        flagged_by INTEGER REFERENCES users(id),
        flag_note TEXT,
        updated_by INTEGER REFERENCES users(id),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS question_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id TEXT NOT NULL,
        author_id INTEGER NOT NULL REFERENCES users(id),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_question_comments_question ON question_comments (question_id, id);

      CREATE TABLE IF NOT EXISTS question_override_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id TEXT NOT NULL,
        changed_by INTEGER NOT NULL REFERENCES users(id),
        field TEXT NOT NULL
          CHECK (field IN ('level', 'points', 'topic', 'q_type', 'difficulty', 'ontology', 'outcomes', 'details', 'retired', 'flag', 'comment')),
        old_value TEXT,
        new_value TEXT,
        changed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_question_override_changes_question ON question_override_changes (question_id, id);
    `);

    const columns = db.prepare("PRAGMA table_info(bank_questions)").all().map(column => column.name);

    if (!columns.includes("retired")) {
      db.exec("ALTER TABLE bank_questions ADD COLUMN retired INTEGER NOT NULL DEFAULT 0");
    }
  }
};
