const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { migrate } = require("./migrations");
const { loadContent, DEFAULT_CONTENT_DIR } = require("./content");
const { DEFAULT_DB_PATH } = require("./config");
const { hashPassword } = require("./security");
const scoring = require("./scoring");
const selection = require("./selection");

function nowIso() {
  return new Date().toISOString();
}

function generateJoinCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < length; i += 1) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }

  return code;
}

// Replaces the content tables with what is in backend/content/. Content files
// are the source of truth; the tables exist so filters run as indexed SQL.
// Event snapshots in event_questions are separate and never touched here.
function syncContent(db, content) {
  const insertNode = db.prepare(`
    INSERT INTO ontology_nodes (id, kind, label, description, parent_id, sources_json, position)
    VALUES (@id, @kind, @label, @description, @parent_id, @sources_json, @position)
  `);
  const insertEdge = db.prepare("INSERT OR IGNORE INTO ontology_edges (from_id, to_id, kind) VALUES (?, ?, ?)");
  const insertOutcome = db.prepare("INSERT INTO learning_outcomes (id, statement, position) VALUES (?, ?, ?)");
  const insertOutcomeNode = db.prepare("INSERT OR IGNORE INTO outcome_nodes (outcome_id, node_id) VALUES (?, ?)");
  const insertOutcomeLevel = db.prepare("INSERT OR IGNORE INTO outcome_levels (outcome_id, level) VALUES (?, ?)");
  const insertOutcomeAudience = db.prepare("INSERT OR IGNORE INTO outcome_audiences (outcome_id, audience) VALUES (?, ?)");
  const insertQuestion = db.prepare(`
    INSERT INTO bank_questions (id, bank, type, audience, level, difficulty, points, position, question_json)
    VALUES (@id, @bank, @type, @audience, @level, @difficulty, @points, @position, @question_json)
  `);
  const insertQuestionNode = db.prepare("INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?, ?)");
  const insertQuestionOutcome = db.prepare("INSERT OR IGNORE INTO question_outcomes (question_id, outcome_id) VALUES (?, ?)");

  db.transaction(() => {
    db.exec(`
      DELETE FROM ontology_nodes;
      DELETE FROM ontology_edges;
      DELETE FROM learning_outcomes;
      DELETE FROM outcome_nodes;
      DELETE FROM outcome_levels;
      DELETE FROM outcome_audiences;
      DELETE FROM bank_questions;
      DELETE FROM question_nodes;
      DELETE FROM question_outcomes;
    `);

    content.nodes.forEach((node, position) => {
      insertNode.run({
        id: node.id,
        kind: node.kind,
        label: node.label,
        description: node.description || null,
        parent_id: node.parent || null,
        sources_json: JSON.stringify(node.sources || []),
        position
      });

      if (node.parent) {
        insertEdge.run(node.parent, node.id, "parent_of");
      }

      (node.prerequisites || []).forEach(prereq => insertEdge.run(node.id, prereq, "requires"));
    });

    content.outcomes.forEach((outcome, position) => {
      insertOutcome.run(outcome.id, outcome.statement, position);
      outcome.nodes.forEach(nodeId => insertOutcomeNode.run(outcome.id, nodeId));
      outcome.levels.forEach(level => insertOutcomeLevel.run(outcome.id, level));
      (outcome.audiences || []).forEach(audience => insertOutcomeAudience.run(outcome.id, audience));
    });

    content.questions.forEach((question, position) => {
      insertQuestion.run({
        id: question.id,
        bank: question.bank,
        type: question.type,
        audience: question.audience,
        level: question.level,
        difficulty: question.difficulty,
        points: question.points,
        position,
        question_json: JSON.stringify(question)
      });
      question.ontology.forEach(nodeId => insertQuestionNode.run(question.id, nodeId));
      question.outcomes.forEach(outcomeId => insertQuestionOutcome.run(question.id, outcomeId));
    });
  })();
}

function openDatabase({ dbPath = DEFAULT_DB_PATH, contentDir = DEFAULT_CONTENT_DIR, log = () => {} } = {}) {
  const resolvedPath = dbPath === ":memory:" ? dbPath : path.resolve(dbPath);

  if (process.env.NODE_ENV === "test" && resolvedPath === DEFAULT_DB_PATH) {
    throw new Error("Tests must not use backend/data/app.db. Set DB_PATH to a temporary file.");
  }

  if (resolvedPath !== ":memory:") {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const migration = migrate(db, { dbPath: resolvedPath, log });
  const content = loadContent(contentDir);
  syncContent(db, content);

  const store = createStore(db, content);
  store.migration = migration;
  store.seed();

  return store;
}

function createStore(db, content) {
  function createUniqueJoinCode() {
    let code = generateJoinCode();

    while (db.prepare("SELECT 1 FROM events WHERE join_code = ?").get(code)) {
      code = generateJoinCode();
    }

    return code;
  }

  function previewQuestions(filter) {
    return selection.selectQuestions(db, filter);
  }

  function createEventWithQuestions({
    title,
    joinCode,
    selectionMode = "ALL",
    filter = null,
    durationMinutes = null,
    startAt = null,
    endAt = null,
    createdBy
  }) {
    const resolvedFilter = filter || selection.legacyModeToFilter(selectionMode);
    const questions = previewQuestions(resolvedFilter);

    if (!questions.length) {
      const error = new Error("No questions match that selection.");
      error.status = 400;
      throw error;
    }

    const insertEvent = db.prepare(`
      INSERT INTO events (title, join_code, status, selection_mode, filter_json, duration_minutes, start_at, end_at, created_by, created_at)
      VALUES (@title, @join_code, 'active', @selection_mode, @filter_json, @duration_minutes, @start_at, @end_at, @created_by, @created_at)
    `);

    const insertQuestion = db.prepare(`
      INSERT INTO event_questions (event_id, question_id, question_order, question_json)
      VALUES (@event_id, @question_id, @question_order, @question_json)
    `);

    return db.transaction(() => {
      const eventResult = insertEvent.run({
        title,
        join_code: joinCode,
        selection_mode: selectionMode,
        filter_json: JSON.stringify(resolvedFilter),
        duration_minutes: durationMinutes,
        start_at: startAt,
        end_at: endAt,
        created_by: createdBy,
        created_at: nowIso()
      });

      questions.forEach((question, index) => {
        insertQuestion.run({
          event_id: eventResult.lastInsertRowid,
          question_id: question.id,
          question_order: index,
          question_json: JSON.stringify(question)
        });
      });

      return Number(eventResult.lastInsertRowid);
    })();
  }

  function eventRow(row) {
    if (!row) {
      return null;
    }

    const { filter_json: filterJson, ...rest } = row;
    const filter = filterJson ? JSON.parse(filterJson) : selection.legacyModeToFilter(row.selection_mode);
    return { ...rest, filter, filter_summary: selection.summarizeFilter(filter) };
  }

  function getEventById(eventId) {
    return eventRow(db.prepare(`
      SELECT id, title, join_code, status, selection_mode, filter_json, duration_minutes, start_at, end_at, created_by, created_at
      FROM events
      WHERE id = ?
    `).get(eventId));
  }

  function getEventForTeacher(eventId, userId) {
    const event = getEventById(eventId);
    return event && event.created_by === userId ? event : null;
  }

  function listEventsForTeacher(userId) {
    return db.prepare(`
      SELECT e.id, e.title, e.join_code, e.status, e.selection_mode, e.filter_json, e.duration_minutes, e.start_at, e.end_at, e.created_at,
             (SELECT COUNT(*) FROM attempts a WHERE a.event_id = e.id) AS attempt_count,
             (SELECT COUNT(*) FROM event_questions q WHERE q.event_id = e.id) AS question_count
      FROM events e
      WHERE e.created_by = ?
      ORDER BY e.created_at DESC, e.id DESC
    `).all(userId).map(eventRow);
  }

  function getEventQuestions(eventId) {
    return db.prepare(`
      SELECT question_json
      FROM event_questions
      WHERE event_id = ?
      ORDER BY question_order ASC
    `).all(eventId).map(row => JSON.parse(row.question_json));
  }

  function getEventByJoinCode(joinCode) {
    const event = db.prepare(`
      SELECT id, title, join_code, status, selection_mode, duration_minutes, start_at, end_at
      FROM events
      WHERE join_code = ?
    `).get(joinCode);

    return event || null;
  }

  function createAttempt({ eventId, studentName, studentGroup, tokenHash, startedAt, deadlineAt }) {
    const result = db.prepare(`
      INSERT INTO attempts (event_id, student_name, student_group, status, started_at, token_hash, deadline_at)
      VALUES (?, ?, ?, 'started', ?, ?, ?)
    `).run(eventId, studentName, studentGroup, startedAt, tokenHash, deadlineAt);

    return Number(result.lastInsertRowid);
  }

  function getAttempt(attemptId) {
    return db.prepare(`
      SELECT a.id, a.event_id, a.student_name, a.student_group, a.status, a.started_at, a.deadline_at, a.token_hash,
             e.title, e.join_code, e.duration_minutes
      FROM attempts a
      JOIN events e ON e.id = a.event_id
      WHERE a.id = ?
    `).get(attemptId) || null;
  }

  // Scores every question of the event through the scorer registry and stores
  // the result. Returns { score, max, perQuestion } without any answer keys.
  function submitAttempt(attempt, rawAnswers) {
    const questions = getEventQuestions(attempt.event_id);
    const answers = rawAnswers && typeof rawAnswers === "object" && !Array.isArray(rawAnswers) ? rawAnswers : {};

    const clearAnswers = db.prepare("DELETE FROM answers WHERE attempt_id = ?");
    const insertAnswer = db.prepare(`
      INSERT INTO answers (attempt_id, question_id, question_type, response_json, chosen_index, correct_index, earned_points, max_points, score_status)
      VALUES (@attempt_id, @question_id, @question_type, @response_json, @chosen_index, @correct_index, @earned_points, @max_points, @score_status)
    `);
    const finalizeAttempt = db.prepare(`
      UPDATE attempts
      SET status = 'submitted', submitted_at = ?, score = ?, max_score = ?
      WHERE id = ? AND status = 'started'
    `);

    let score = 0;
    let max = 0;
    const perQuestion = [];

    db.transaction(() => {
      clearAnswers.run(attempt.id);

      questions.forEach(question => {
        const raw = Object.prototype.hasOwnProperty.call(answers, question.id) ? answers[question.id] : undefined;
        const { response, result, legacy } = scoring.scoreResponse(question, raw);

        score += result.earned;
        max += result.max;

        insertAnswer.run({
          attempt_id: attempt.id,
          question_id: question.id,
          question_type: question.type,
          response_json: JSON.stringify(response),
          chosen_index: legacy.chosenIndex,
          correct_index: legacy.correctIndex,
          earned_points: result.earned,
          max_points: result.max,
          score_status: result.status
        });

        perQuestion.push({
          id: question.id,
          title: question.title,
          level: question.level,
          topic: question.topic,
          qType: question.qType,
          type: question.type,
          chosen: response,
          earned: result.earned,
          max: result.max,
          status: result.status
        });
      });

      const updated = finalizeAttempt.run(nowIso(), score, max, attempt.id);

      if (updated.changes !== 1) {
        const error = new Error("This attempt has already been submitted.");
        error.status = 409;
        throw error;
      }
    })();

    return { score, max, perQuestion };
  }

  function getResults(eventId) {
    const attempts = db.prepare(`
      SELECT id, student_name, student_group, status, started_at, deadline_at, submitted_at, score, max_score
      FROM attempts
      WHERE event_id = ?
      ORDER BY started_at DESC
    `).all(eventId);

    const answersByAttempt = db.prepare(`
      SELECT attempt_id, question_id, question_type, response_json, chosen_index, correct_index, earned_points, max_points, score_status
      FROM answers
      WHERE attempt_id IN (SELECT id FROM attempts WHERE event_id = ?)
      ORDER BY attempt_id ASC, id ASC
    `).all(eventId).reduce((acc, row) => {
      if (!acc[row.attempt_id]) {
        acc[row.attempt_id] = [];
      }

      acc[row.attempt_id].push({
        questionId: row.question_id,
        questionType: row.question_type,
        response: row.response_json === null ? null : JSON.parse(row.response_json),
        chosenIndex: row.chosen_index,
        correctIndex: row.correct_index,
        earnedPoints: row.earned_points,
        maxPoints: row.max_points,
        scoreStatus: row.score_status
      });

      return acc;
    }, {});

    return attempts.map(attempt => ({
      ...attempt,
      answers: answersByAttempt[attempt.id] || []
    }));
  }

  function findUserByEmail(email) {
    return db.prepare("SELECT id, email, password_hash, role FROM users WHERE email = ?").get(email) || null;
  }

  function findUserById(userId) {
    return db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(userId) || null;
  }

  function updatePasswordHash(userId, passwordHash) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
  }

  function createUser({ email, password, role = "teacher" }) {
    const result = db.prepare(`
      INSERT INTO users (email, password_hash, role, created_at)
      VALUES (?, ?, ?, ?)
    `).run(String(email).trim().toLowerCase(), hashPassword(password), role, nowIso());

    return Number(result.lastInsertRowid);
  }

  function listOntology() {
    const nodes = db.prepare(`
      SELECT id, kind, label, description, parent_id, sources_json
      FROM ontology_nodes
      ORDER BY position ASC
    `).all();
    const prereqs = db.prepare("SELECT from_id, to_id FROM ontology_edges WHERE kind = 'requires'").all();
    const counts = db.prepare("SELECT node_id, COUNT(*) AS count FROM question_nodes GROUP BY node_id").all()
      .reduce((acc, row) => ({ ...acc, [row.node_id]: row.count }), {});

    return nodes.map(node => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      description: node.description,
      parent: node.parent_id,
      prerequisites: prereqs.filter(edge => edge.from_id === node.id).map(edge => edge.to_id),
      sources: JSON.parse(node.sources_json),
      questionCount: counts[node.id] || 0
    }));
  }

  function listOntologyEdges() {
    return db.prepare("SELECT from_id AS \"from\", to_id AS \"to\", kind FROM ontology_edges ORDER BY kind, from_id, to_id").all();
  }

  function listOutcomes({ level = null, audience = null } = {}) {
    const rows = db.prepare(`
      SELECT o.id, o.statement,
             (SELECT json_group_array(node_id) FROM outcome_nodes n WHERE n.outcome_id = o.id) AS nodes_json,
             (SELECT json_group_array(level) FROM outcome_levels l WHERE l.outcome_id = o.id) AS levels_json,
             (SELECT json_group_array(audience) FROM outcome_audiences au WHERE au.outcome_id = o.id) AS audiences_json,
             (SELECT COUNT(*) FROM question_outcomes qo WHERE qo.outcome_id = o.id) AS question_count
      FROM learning_outcomes o
      WHERE (@level IS NULL OR EXISTS (SELECT 1 FROM outcome_levels l WHERE l.outcome_id = o.id AND l.level = @level))
        AND (@audience IS NULL
             OR NOT EXISTS (SELECT 1 FROM outcome_audiences au WHERE au.outcome_id = o.id)
             OR EXISTS (SELECT 1 FROM outcome_audiences au WHERE au.outcome_id = o.id AND au.audience = @audience))
      ORDER BY o.position ASC
    `).all({ level, audience });

    return rows.map(row => ({
      id: row.id,
      statement: row.statement,
      nodes: JSON.parse(row.nodes_json),
      levels: JSON.parse(row.levels_json),
      audiences: JSON.parse(row.audiences_json),
      questionCount: row.question_count
    }));
  }

  function seed() {
    const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;

    if (userCount === 0) {
      createUser({ email: "teacher@ctquest.local", password: "changeme123" });
    }

    const eventCount = db.prepare("SELECT COUNT(*) AS count FROM events").get().count;

    if (eventCount === 0) {
      const teacher = db.prepare("SELECT id FROM users WHERE email = ?").get("teacher@ctquest.local");

      if (teacher) {
        createEventWithQuestions({
          title: "CT Quest Demo Event",
          joinCode: "DEMO123",
          selectionMode: "ALL",
          durationMinutes: 45,
          createdBy: teacher.id
        });
      }
    }
  }

  return {
    db,
    content,
    seed,
    createUniqueJoinCode,
    previewQuestions,
    createEventWithQuestions,
    getEventById,
    getEventForTeacher,
    listEventsForTeacher,
    getEventQuestions,
    getEventByJoinCode,
    createAttempt,
    getAttempt,
    submitAttempt,
    getResults,
    findUserByEmail,
    findUserById,
    updatePasswordHash,
    createUser,
    listOntology,
    listOntologyEdges,
    listOutcomes,
    close: () => db.close()
  };
}

module.exports = {
  openDatabase,
  syncContent,
  generateJoinCode
};
