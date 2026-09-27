// The CT platform core, on top of the original schema.
//
// events:   filter_json (the v2 filter the event was built from) and
//           results_released_at. Events that existed before this migration
//           are marked released, so students keep seeing their breakdown as
//           they always did.
// attempts: token_hash (per-attempt secret), deadline_at (fixed at start:
//           the earlier of start + duration and the event's end_at), late
//           (submitted after the grace window), student_key (normalised
//           name and group, for the one-attempt rule), reset_at / reset_by
//           (a teacher reset; the row is kept).
// answers:  rebuilt so non-MCQ types fit. correct_index becomes nullable, and
//           each row records its question type, its response as JSON, its
//           scoring status and a detail_json for structured scoring detail
//           (AI feedback later). Migrated MCQ rows store the chosen option's
//           text as it was when the student answered, so the record stays
//           true even if a snapshot is corrected later. Nothing references
//           answers, so dropping and renaming it is safe.
// event_questions: v1 snapshots (answerIndex) rewritten to the v2 shape, with
//           ontology and outcome tags copied from the bank question of the
//           same id where one exists.
// Content tables for the ontology, learning outcomes and question bank.
// Their rows are replaced from backend/content/ on every boot (db.js).

const { studentKey } = require("../policy");

function upgradeSnapshot(question, bankById) {
  if (question.type) {
    return null;
  }

  const { answerIndex, ...rest } = question;
  const upgraded = {
    ...rest,
    type: "mcq",
    audience: "core",
    answer: { index: answerIndex }
  };
  const bank = bankById.get(question.id);

  if (bank) {
    upgraded.ontology = bank.ontology.slice();
    upgraded.outcomes = bank.outcomes.slice();
  }

  return upgraded;
}

module.exports = {
  up(db, ctx = {}) {
    const now = new Date().toISOString();
    const bankById = new Map(((ctx.content && ctx.content.questions) || []).map(question => [question.id, question]));

    db.exec(`
      ALTER TABLE events ADD COLUMN filter_json TEXT;
      ALTER TABLE events ADD COLUMN results_released_at TEXT;

      ALTER TABLE attempts ADD COLUMN token_hash TEXT;
      ALTER TABLE attempts ADD COLUMN deadline_at TEXT;
      ALTER TABLE attempts ADD COLUMN late INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE attempts ADD COLUMN student_key TEXT;
      ALTER TABLE attempts ADD COLUMN reset_at TEXT;
      ALTER TABLE attempts ADD COLUMN reset_by INTEGER;
    `);

    db.prepare("UPDATE events SET results_released_at = ?").run(now);

    // Snapshots: remember the v1 options per (event, question) before
    // upgrading, so answers can record the text the student actually saw.
    const snapshotRows = db.prepare("SELECT id, event_id, question_id, question_json FROM event_questions").all();
    const optionsAtAnswerTime = new Map();
    const updateSnapshot = db.prepare("UPDATE event_questions SET question_json = ? WHERE id = ?");

    snapshotRows.forEach(row => {
      const question = JSON.parse(row.question_json);
      optionsAtAnswerTime.set(`${row.event_id}\u001f${row.question_id}`, question.options || []);
      const upgraded = upgradeSnapshot(question, bankById);
      if (upgraded) {
        updateSnapshot.run(JSON.stringify(upgraded), row.id);
      }
    });

    // Attempts: student keys and fixed deadlines.
    const attempts = db.prepare(`
      SELECT a.id, a.event_id, a.student_name, a.student_group, a.started_at, e.duration_minutes, e.end_at
      FROM attempts a
      JOIN events e ON e.id = a.event_id
    `).all();
    const updateAttempt = db.prepare("UPDATE attempts SET student_key = ?, deadline_at = ? WHERE id = ?");

    attempts.forEach(row => {
      const candidates = [];
      const started = Date.parse(row.started_at);

      if (row.duration_minutes && Number.isFinite(started)) {
        candidates.push(started + row.duration_minutes * 60 * 1000);
      }

      if (row.end_at && Number.isFinite(Date.parse(row.end_at))) {
        candidates.push(Date.parse(row.end_at));
      }

      const deadline = candidates.length ? new Date(Math.min(...candidates)).toISOString() : null;
      updateAttempt.run(studentKey(row.student_name, row.student_group), deadline, row.id);
    });

    // Answers: rebuild with response_json carrying the chosen option's text.
    const oldAnswers = db.prepare(`
      SELECT ans.id, ans.attempt_id, ans.question_id, ans.chosen_index, ans.correct_index, ans.earned_points, ans.max_points,
             a.event_id
      FROM answers ans
      JOIN attempts a ON a.id = ans.attempt_id
    `).all();

    db.exec(`
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
        detail_json TEXT,
        FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
      );
    `);

    const insertAnswer = db.prepare(`
      INSERT INTO answers_v2 (id, attempt_id, question_id, question_type, response_json, chosen_index, correct_index, earned_points, max_points, score_status, detail_json)
      VALUES (@id, @attempt_id, @question_id, 'mcq', @response_json, @chosen_index, @correct_index, @earned_points, @max_points, 'scored', NULL)
    `);

    oldAnswers.forEach(row => {
      const options = optionsAtAnswerTime.get(`${row.event_id}\u001f${row.question_id}`) || [];
      const response = row.chosen_index === null
        ? null
        : { index: row.chosen_index, text: options[row.chosen_index] === undefined ? null : options[row.chosen_index] };

      insertAnswer.run({
        id: row.id,
        attempt_id: row.attempt_id,
        question_id: row.question_id,
        response_json: JSON.stringify(response),
        chosen_index: row.chosen_index,
        correct_index: row.correct_index,
        earned_points: row.earned_points,
        max_points: row.max_points
      });
    });

    db.exec(`
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
      CREATE INDEX idx_attempts_student ON attempts (event_id, student_key);
      CREATE INDEX idx_answers_attempt ON answers (attempt_id);
      CREATE INDEX idx_ontology_edges_to ON ontology_edges (to_id, kind);
      CREATE INDEX idx_outcome_levels_level ON outcome_levels (level);
      CREATE INDEX idx_bank_questions_filter ON bank_questions (audience, level, type, difficulty);
      CREATE INDEX idx_question_nodes_node ON question_nodes (node_id);
      CREATE INDEX idx_question_outcomes_outcome ON question_outcomes (outcome_id);
    `);
  }
};
