// Version 2: the CT platform core.
//
// - events.filter_json: the v2 question filter an event was built from.
// - attempts.token_hash / deadline_at: per-attempt secret and fixed deadline.
// - answers rebuilt so non-MCQ types fit: correct_index becomes nullable and
//   each row records its question type, raw response and scoring status.
//   Nothing references answers, so dropping and renaming it is safe.
// - Content tables for the ontology, learning outcomes and question bank.
//   Their rows are replaced from backend/content/ on every boot (db.js), so
//   they carry no data a migration needs to preserve.
// - Event question snapshots rewritten from the v1 shape (answerIndex) to the
//   v2 shape (type + answer), so runtime code only ever reads one shape.
// - Indexes for the queries the API runs per request.

function upgradeSnapshot(question) {
  if (question.type) {
    return null;
  }

  const { answerIndex, ...rest } = question;

  return {
    ...rest,
    type: "mcq",
    audience: "core",
    answer: { index: answerIndex }
  };
}

module.exports = {
  version: 2,
  name: "platform-core",
  up(db) {
    db.exec(`
      ALTER TABLE events ADD COLUMN filter_json TEXT;
      ALTER TABLE attempts ADD COLUMN token_hash TEXT;
      ALTER TABLE attempts ADD COLUMN deadline_at TEXT;

      CREATE TABLE answers_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_id INTEGER NOT NULL,
        question_id TEXT NOT NULL,
        question_type TEXT NOT NULL DEFAULT 'mcq',
        response_json TEXT,
        chosen_index INTEGER,
        correct_index INTEGER,
        earned_points INTEGER NOT NULL,
        max_points INTEGER NOT NULL,
        score_status TEXT NOT NULL DEFAULT 'scored',
        FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
      );

      INSERT INTO answers_v2 (id, attempt_id, question_id, question_type, response_json, chosen_index, correct_index, earned_points, max_points, score_status)
      SELECT id, attempt_id, question_id, 'mcq',
             CASE WHEN chosen_index IS NULL THEN 'null' ELSE CAST(chosen_index AS TEXT) END,
             chosen_index, correct_index, earned_points, max_points, 'scored'
      FROM answers;

      DROP TABLE answers;
      ALTER TABLE answers_v2 RENAME TO answers;

      CREATE TABLE ontology_nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT,
        parent_id TEXT,
        sources_json TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL
      );

      -- kind 'parent_of': from_id is the parent, to_id the child.
      -- kind 'requires':  from_id needs to_id to be learned first.
      CREATE TABLE ontology_edges (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('parent_of', 'requires')),
        PRIMARY KEY (from_id, to_id, kind)
      );

      CREATE TABLE learning_outcomes (
        id TEXT PRIMARY KEY,
        statement TEXT NOT NULL,
        position INTEGER NOT NULL
      );

      CREATE TABLE outcome_nodes (
        outcome_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        PRIMARY KEY (outcome_id, node_id)
      );

      CREATE TABLE outcome_levels (
        outcome_id TEXT NOT NULL,
        level TEXT NOT NULL,
        PRIMARY KEY (outcome_id, level)
      );

      -- No rows for an outcome means it applies to every audience.
      CREATE TABLE outcome_audiences (
        outcome_id TEXT NOT NULL,
        audience TEXT NOT NULL,
        PRIMARY KEY (outcome_id, audience)
      );

      CREATE TABLE bank_questions (
        id TEXT PRIMARY KEY,
        bank TEXT NOT NULL,
        type TEXT NOT NULL,
        audience TEXT NOT NULL,
        level TEXT NOT NULL,
        difficulty INTEGER NOT NULL,
        points INTEGER NOT NULL,
        position INTEGER NOT NULL,
        question_json TEXT NOT NULL
      );

      CREATE TABLE question_nodes (
        question_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        PRIMARY KEY (question_id, node_id)
      );

      CREATE TABLE question_outcomes (
        question_id TEXT NOT NULL,
        outcome_id TEXT NOT NULL,
        PRIMARY KEY (question_id, outcome_id)
      );

      CREATE INDEX idx_events_created_by ON events (created_by, created_at);
      CREATE INDEX idx_event_questions_event ON event_questions (event_id, question_order);
      CREATE INDEX idx_attempts_event ON attempts (event_id, started_at);
      CREATE INDEX idx_answers_attempt ON answers (attempt_id);
      CREATE INDEX idx_ontology_edges_to ON ontology_edges (to_id, kind);
      CREATE INDEX idx_outcome_levels_level ON outcome_levels (level);
      CREATE INDEX idx_bank_questions_filter ON bank_questions (audience, level, type, difficulty);
      CREATE INDEX idx_question_nodes_node ON question_nodes (node_id);
      CREATE INDEX idx_question_outcomes_outcome ON question_outcomes (outcome_id);
    `);

    const snapshots = db.prepare("SELECT id, question_json FROM event_questions").all();
    const updateSnapshot = db.prepare("UPDATE event_questions SET question_json = ? WHERE id = ?");

    snapshots.forEach(row => {
      const upgraded = upgradeSnapshot(JSON.parse(row.question_json));
      if (upgraded) {
        updateSnapshot.run(JSON.stringify(upgraded), row.id);
      }
    });

    const timed = db.prepare(`
      SELECT a.id, a.started_at, e.duration_minutes
      FROM attempts a
      JOIN events e ON e.id = a.event_id
      WHERE e.duration_minutes IS NOT NULL
    `).all();
    const setDeadline = db.prepare("UPDATE attempts SET deadline_at = ? WHERE id = ?");

    timed.forEach(row => {
      const deadline = Date.parse(row.started_at) + row.duration_minutes * 60 * 1000;
      if (Number.isFinite(deadline)) {
        setDeadline.run(new Date(deadline).toISOString(), row.id);
      }
    });
  }
};
