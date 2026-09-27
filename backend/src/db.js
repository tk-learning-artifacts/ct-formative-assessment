const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { migrate } = require("./migrations");
const { loadContent, DEFAULT_CONTENT_DIR } = require("./content");
const { DEFAULT_DB_PATH, DEFAULT_TEACHER_EMAIL, DEFAULT_TEACHER_PASSWORD } = require("./config");
const { hashPassword, verifyPassword } = require("./security");
const scoring = require("./scoring");
const selection = require("./selection");
const { studentKey } = require("./policy");

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

function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
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

function openDatabase({
  dbPath = DEFAULT_DB_PATH,
  contentDir = DEFAULT_CONTENT_DIR,
  seedTeacher = { email: DEFAULT_TEACHER_EMAIL, password: DEFAULT_TEACHER_PASSWORD },
  isProduction = false,
  log = () => {}
} = {}) {
  const resolvedPath = dbPath === ":memory:" ? dbPath : path.resolve(dbPath);

  if (process.env.NODE_ENV === "test" && resolvedPath === DEFAULT_DB_PATH) {
    throw new Error("Tests must not use backend/data/app.db. Set DB_PATH to a temporary file.");
  }

  if (resolvedPath !== ":memory:") {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  // Content is validated before migrating, because migrations may read it
  // (for example, to backfill tags into old snapshots).
  const content = loadContent(contentDir);
  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  let store;

  try {
    const migration = migrate(db, { dbPath: resolvedPath, ctx: { content, log }, log });
    syncContent(db, content);

    store = createStore(db, content);
    store.migration = migration;
    store.seed(seedTeacher);

    if (isProduction) {
      store.assertNoDefaultPasswords();
    }
  } catch (error) {
    db.close();
    throw error;
  }

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
    const resolvedFilter = filter || selection.legacyModeToFilter(selectionMode, content);
    const questions = previewQuestions(resolvedFilter);

    if (!questions.length) {
      throw httpError(400, "No questions match that selection.");
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
    const filter = filterJson ? JSON.parse(filterJson) : selection.legacyModeToFilter(row.selection_mode, content);
    return { ...rest, filter, filter_summary: selection.summarizeFilter(filter) };
  }

  const EVENT_COLUMNS = "id, title, join_code, status, selection_mode, filter_json, duration_minutes, start_at, end_at, results_released_at, created_by, created_at";

  function getEventById(eventId) {
    return eventRow(db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).get(eventId));
  }

  function getEventForTeacher(eventId, userId) {
    const event = getEventById(eventId);
    return event && event.created_by === userId ? event : null;
  }

  function listEventsForTeacher(userId) {
    return db.prepare(`
      SELECT e.id, e.title, e.join_code, e.status, e.selection_mode, e.filter_json, e.duration_minutes, e.start_at, e.end_at,
             e.results_released_at, e.created_at,
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
    return db.prepare(`
      SELECT id, title, join_code, status, selection_mode, duration_minutes, start_at, end_at, results_released_at
      FROM events
      WHERE join_code = ?
    `).get(joinCode) || null;
  }

  // The live attempt for this student in this event, if any. Reset attempts
  // do not count, and neither do unsubmitted attempts from before the
  // upgrade: they have no token, so they can never be finished.
  function findLiveAttempt(eventId, key) {
    return db.prepare(`
      SELECT id, status, deadline_at
      FROM attempts
      WHERE event_id = ? AND student_key = ? AND reset_at IS NULL
        AND NOT (status = 'started' AND token_hash IS NULL)
      ORDER BY id DESC
      LIMIT 1
    `).get(eventId, key) || null;
  }

  // One attempt per student per event. The check and the insert share a
  // transaction, and better-sqlite3 is synchronous, so two simultaneous
  // starts cannot both succeed.
  function startAttempt({ eventId, studentName, studentGroup, tokenHash, startedAt, deadlineAt }) {
    const key = studentKey(studentName, studentGroup);

    return db.transaction(() => {
      const existing = findLiveAttempt(eventId, key);

      if (existing) {
        const inProgress = existing.status === "started" && (!existing.deadline_at || Date.now() <= Date.parse(existing.deadline_at));

        throw httpError(409, existing.status === "submitted"
          ? "You have already submitted this test. Ask your teacher if you need another try."
          : inProgress
            ? "You already started this test. Continue on the device where you started, or ask your teacher to reset your attempt."
            : "Your time for this test has run out. Ask your teacher if you need another try.", {
          code: existing.status === "submitted" ? "already-submitted" : inProgress ? "attempt-in-progress" : "attempt-expired",
          attemptId: existing.id
        });
      }

      const result = db.prepare(`
        INSERT INTO attempts (event_id, student_name, student_group, student_key, status, started_at, token_hash, deadline_at)
        VALUES (?, ?, ?, ?, 'started', ?, ?, ?)
      `).run(eventId, studentName, studentGroup, key, startedAt, tokenHash, deadlineAt);

      return Number(result.lastInsertRowid);
    })();
  }

  function getAttempt(attemptId) {
    return db.prepare(`
      SELECT a.id, a.event_id, a.student_name, a.student_group, a.status, a.started_at, a.submitted_at, a.deadline_at,
             a.late, a.reset_at, a.score, a.max_score, a.token_hash,
             e.title, e.join_code, e.duration_minutes, e.start_at, e.end_at, e.results_released_at
      FROM attempts a
      JOIN events e ON e.id = a.event_id
      WHERE a.id = ?
    `).get(attemptId) || null;
  }

  function attemptEvent(attempt) {
    return {
      id: attempt.event_id,
      title: attempt.title,
      join_code: attempt.join_code,
      duration_minutes: attempt.duration_minutes,
      start_at: attempt.start_at,
      end_at: attempt.end_at,
      results_released_at: attempt.results_released_at
    };
  }

  // Scores every question of the event through the scorer registry and stores
  // the result. The caller shows the student only what policy.js allows.
  function submitAttempt(attempt, rawAnswers, { late = false } = {}) {
    const questions = getEventQuestions(attempt.event_id);
    const answers = rawAnswers && typeof rawAnswers === "object" && !Array.isArray(rawAnswers) ? rawAnswers : {};

    const clearAnswers = db.prepare("DELETE FROM answers WHERE attempt_id = ?");
    const insertAnswer = db.prepare(`
      INSERT INTO answers (attempt_id, question_id, question_type, response_json, chosen_index, correct_index, earned_points, max_points, score_status, detail_json)
      VALUES (@attempt_id, @question_id, @question_type, @response_json, @chosen_index, @correct_index, @earned_points, @max_points, @score_status, @detail_json)
    `);
    const finalizeAttempt = db.prepare(`
      UPDATE attempts
      SET status = 'submitted', submitted_at = ?, score = ?, max_score = ?, late = ?
      WHERE id = ? AND status = 'started' AND reset_at IS NULL
    `);

    let score = 0;
    let max = 0;

    db.transaction(() => {
      clearAnswers.run(attempt.id);

      questions.forEach(question => {
        const raw = Object.prototype.hasOwnProperty.call(answers, question.id) ? answers[question.id] : undefined;
        const { recorded, result, legacy } = scoring.scoreResponse(question, raw);

        score += result.earned;
        max += result.max;

        insertAnswer.run({
          attempt_id: attempt.id,
          question_id: question.id,
          question_type: question.type,
          response_json: JSON.stringify(recorded),
          chosen_index: legacy.chosenIndex,
          correct_index: legacy.correctIndex,
          earned_points: result.earned,
          max_points: result.max,
          score_status: result.status,
          detail_json: result.detail ? JSON.stringify(result.detail) : null
        });
      });

      const updated = finalizeAttempt.run(nowIso(), score, max, late ? 1 : 0, attempt.id);

      if (updated.changes !== 1) {
        throw httpError(409, "This attempt has already been submitted.");
      }
    })();

    return { score, max };
  }

  function answersFor(attemptId) {
    return db.prepare(`
      SELECT question_id, question_type, response_json, chosen_index, correct_index, earned_points, max_points, score_status, detail_json
      FROM answers
      WHERE attempt_id = ?
      ORDER BY id ASC
    `).all(attemptId);
  }

  // The full per-question breakdown for one attempt, built from the stored
  // answers and the event snapshot the student answered. policy.js decides
  // whether a student may see it.
  function getAttemptResult(attempt) {
    if (attempt.status !== "submitted") {
      return null;
    }

    const byId = new Map(getEventQuestions(attempt.event_id).map(question => [question.id, question]));

    const perQuestion = answersFor(attempt.id).map(row => {
      const question = byId.get(row.question_id) || { id: row.question_id };
      const correctText = Array.isArray(question.options) && row.correct_index !== null ? question.options[row.correct_index] : null;

      return {
        id: row.question_id,
        title: question.title || null,
        level: question.level || null,
        topic: question.topic || null,
        qType: question.qType || null,
        type: row.question_type,
        response: row.response_json === null ? null : JSON.parse(row.response_json),
        correctResponse: row.correct_index === null ? null : { index: row.correct_index, text: correctText },
        earned: row.earned_points,
        max: row.max_points,
        correct: row.score_status === "scored" ? row.earned_points === row.max_points : null,
        status: row.score_status,
        detail: row.detail_json === null ? null : JSON.parse(row.detail_json)
      };
    });

    return { score: attempt.score, max: attempt.max_score, perQuestion };
  }

  function getResults(eventId) {
    const attempts = db.prepare(`
      SELECT id, student_name, student_group, status, started_at, deadline_at, submitted_at, late, reset_at, score, max_score
      FROM attempts
      WHERE event_id = ?
      ORDER BY started_at DESC, id DESC
    `).all(eventId);

    const answersByAttempt = db.prepare(`
      SELECT attempt_id, question_id, question_type, response_json, chosen_index, correct_index, earned_points, max_points, score_status, detail_json
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
        scoreStatus: row.score_status,
        detail: row.detail_json === null ? null : JSON.parse(row.detail_json)
      });

      return acc;
    }, {});

    return attempts.map(attempt => ({
      ...attempt,
      late: Boolean(attempt.late),
      answers: answersByAttempt[attempt.id] || []
    }));
  }

  function resetAttempt(eventId, attemptId, userId) {
    const result = db.prepare(`
      UPDATE attempts SET reset_at = ?, reset_by = ?
      WHERE id = ? AND event_id = ? AND reset_at IS NULL
    `).run(nowIso(), userId, attemptId, eventId);

    return result.changes === 1;
  }

  function releaseResults(eventId) {
    db.prepare("UPDATE events SET results_released_at = COALESCE(results_released_at, ?) WHERE id = ?").run(nowIso(), eventId);
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

  // Sets a password, creating the teacher account if it does not exist yet.
  // Returns "updated" or "created".
  function setPassword(email, password) {
    const normalized = String(email).trim().toLowerCase();
    const user = findUserByEmail(normalized);

    if (user) {
      updatePasswordHash(user.id, hashPassword(password));
      return "updated";
    }

    createUser({ email: normalized, password });
    return "created";
  }

  // Production refuses to run while any account still accepts the demo
  // password, whether it was seeded by this code or by the original app.
  function assertNoDefaultPasswords() {
    const offenders = db.prepare("SELECT email, password_hash FROM users").all()
      .filter(user => verifyPassword(DEFAULT_TEACHER_PASSWORD, user.password_hash).ok)
      .map(user => user.email);

    if (offenders.length) {
      throw new Error(
        `These accounts still use the demo password: ${offenders.join(", ")}. ` +
        "Run `npm run set-password -- <email>` (or `node backend/scripts/set-password.js <email>` in the container) before starting in production."
      );
    }
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

  function seed(seedTeacher) {
    const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;

    if (userCount === 0 && seedTeacher) {
      createUser({ email: seedTeacher.email, password: seedTeacher.password });
    }

    const eventCount = db.prepare("SELECT COUNT(*) AS count FROM events").get().count;

    if (eventCount === 0) {
      const teacher = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get();

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
    startAttempt,
    getAttempt,
    attemptEvent,
    submitAttempt,
    getAttemptResult,
    getResults,
    resetAttempt,
    releaseResults,
    findUserByEmail,
    findUserById,
    updatePasswordHash,
    createUser,
    setPassword,
    assertNoDefaultPasswords,
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
