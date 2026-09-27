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
const presets = require("./presets");
const policy = require("./policy");
const { studentKey } = policy;

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

// The event columns a teacher may change after creating the event
// (event_setting_changes.field). The question set is not among them: it is a
// snapshot that students' answers refer to.
const SETTING_FIELDS = ["title", "feedback_mode", "navigation_mode", "duration_minutes", "start_at", "end_at"];

// An attempt's deadline: the earlier of start + time limit and the event's
// deadline, or null when neither is set. Used at start and whenever the
// teacher changes either setting.
function attemptDeadline(event, startedAtMs) {
  const candidates = [];

  if (event.duration_minutes) {
    candidates.push(startedAtMs + event.duration_minutes * 60 * 1000);
  }

  if (event.end_at) {
    candidates.push(Date.parse(event.end_at));
  }

  return candidates.length ? new Date(Math.min(...candidates)).toISOString() : null;
}

function auditText(value) {
  return value === null || value === undefined ? null : String(value);
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

// Every preset must match at least one question with its default settings,
// or its card would offer an event that cannot be created. Checked at boot,
// after the content tables are filled, because matching runs as SQL.
function assertPresetsMatch(db, content) {
  const empty = content.presets.filter(preset => {
    const resolved = selection.resolveSelection({ preset: presets.defaultChoice(preset, content) }, content);
    return resolved.errors.length || !selection.selectQuestions(db, resolved.filter).length;
  });

  if (empty.length) {
    throw new Error(`Content is invalid:\n- presets.json: ${empty.map(preset => `preset "${preset.id}" matches no questions with its default settings`).join("\n- ")}`);
  }
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
    assertPresetsMatch(db, content);

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
    feedbackMode = policy.DEFAULT_FEEDBACK_MODE,
    navigationMode = policy.DEFAULT_NAVIGATION_MODE,
    preset = null,
    createdBy
  }) {
    const resolvedFilter = filter || selection.legacyModeToFilter(selectionMode, content);
    const questions = previewQuestions(resolvedFilter);

    if (!questions.length) {
      throw httpError(400, "No questions match that selection.");
    }

    const insertEvent = db.prepare(`
      INSERT INTO events (title, join_code, status, selection_mode, filter_json, duration_minutes, start_at, end_at,
                          feedback_mode, navigation_mode, preset_id, preset_options_json, preset_customised, preset_label, created_by, created_at)
      VALUES (@title, @join_code, 'active', @selection_mode, @filter_json, @duration_minutes, @start_at, @end_at,
              @feedback_mode, @navigation_mode, @preset_id, @preset_options_json, @preset_customised, @preset_label, @created_by, @created_at)
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
        feedback_mode: feedbackMode,
        navigation_mode: navigationMode,
        preset_id: preset ? preset.id : null,
        preset_options_json: preset ? JSON.stringify(preset.options) : null,
        preset_customised: preset && preset.customised ? 1 : 0,
        preset_label: preset ? preset.label : null,
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

  // Where an event's questions came from: { id, options, customised,
  // summary } for a preset, or null (the advanced picker alone, the legacy
  // question set, or an event from before presets were recorded). summary is
  // preset_label, captured when the event was created, so a later rename or
  // removal of the preset in presets.json never changes an older event's card.
  function presetProvenance(row) {
    if (!row.preset_id) {
      return null;
    }

    return {
      id: row.preset_id,
      options: row.preset_options_json ? JSON.parse(row.preset_options_json) : {},
      customised: Boolean(row.preset_customised),
      summary: row.preset_label
    };
  }

  function eventRow(row) {
    if (!row) {
      return null;
    }

    const {
      filter_json: filterJson,
      preset_id: _presetId,
      preset_options_json: _presetOptions,
      preset_customised: _customised,
      preset_label: _presetLabel,
      ...rest
    } = row;
    const filter = filterJson ? JSON.parse(filterJson) : selection.legacyModeToFilter(row.selection_mode, content);
    return { ...rest, filter, filter_summary: selection.summarizeFilter(filter), preset: presetProvenance(row) };
  }

  const EVENT_COLUMNS = "id, title, join_code, status, selection_mode, filter_json, duration_minutes, start_at, end_at, results_released_at, feedback_mode, navigation_mode, preset_id, preset_options_json, preset_customised, preset_label, created_by, created_at";

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
             e.results_released_at, e.feedback_mode, e.navigation_mode, e.preset_id, e.preset_options_json, e.preset_customised, e.preset_label, e.created_at,
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
      SELECT id, title, join_code, status, selection_mode, duration_minutes, start_at, end_at, results_released_at,
             feedback_mode, navigation_mode
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
             e.title, e.join_code, e.duration_minutes, e.start_at, e.end_at, e.results_released_at,
             e.feedback_mode, e.navigation_mode
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
      results_released_at: attempt.results_released_at,
      feedback_mode: attempt.feedback_mode,
      navigation_mode: attempt.navigation_mode
    };
  }

  const insertAnswerRow = db.prepare(`
    INSERT INTO answers (attempt_id, question_id, question_type, response_json, chosen_index, correct_index, earned_points, max_points, score_status, detail_json, committed_at)
    VALUES (@attempt_id, @question_id, @question_type, @response_json, @chosen_index, @correct_index, @earned_points, @max_points, @score_status, @detail_json, @committed_at)
  `);

  // Scores one response through the scorer registry and stores it.
  function storeAnswer(attemptId, question, raw, committedAt = null) {
    const { recorded, result, legacy } = scoring.scoreResponse(question, raw);

    insertAnswerRow.run({
      attempt_id: attemptId,
      question_id: question.id,
      question_type: question.type,
      response_json: JSON.stringify(recorded),
      chosen_index: legacy.chosenIndex,
      correct_index: legacy.correctIndex,
      earned_points: result.earned,
      max_points: result.max,
      score_status: result.status,
      detail_json: result.detail ? JSON.stringify(result.detail) : null,
      committed_at: committedAt
    });
  }

  function committedIds(attemptId) {
    return new Set(db.prepare("SELECT question_id FROM answers WHERE attempt_id = ? AND committed_at IS NOT NULL").all(attemptId)
      .map(row => row.question_id));
  }

  // Commits one answer before submit (policy.locksAnswers). It is final: a
  // second commit, and anything submit later sends for the question, are
  // refused or ignored. Under in-order navigation only the first question
  // not yet committed may be committed. The caller checks the event allows
  // commits and that time is not up. Returns the stored answer in the
  // perQuestion shape; policy.js decides what the student sees of it.
  function commitAnswer(attempt, questionId, raw) {
    const questions = getEventQuestions(attempt.event_id);
    const index = questions.findIndex(question => question.id === questionId);

    if (index < 0) {
      throw httpError(404, "That question is not in this test.");
    }

    db.transaction(() => {
      const current = db.prepare("SELECT status, reset_at FROM attempts WHERE id = ?").get(attempt.id);

      if (current.reset_at) {
        throw httpError(409, "Your teacher reset this attempt. Start the test again.", { code: "attempt-reset" });
      }

      if (current.status !== "started") {
        throw httpError(409, "This attempt has already been submitted.", { code: "already-submitted" });
      }

      const done = committedIds(attempt.id);

      if (done.has(questionId)) {
        throw httpError(409, "This answer is locked, so it cannot be changed.", { code: "answer-locked" });
      }

      if (policy.navigationMode(attempt) === "linear") {
        const next = questions.findIndex(question => !done.has(question.id));

        if (index !== next) {
          throw httpError(409, "This test goes in order. Answer or skip the current question first; earlier ones cannot be changed.", { code: "out-of-order" });
        }
      }

      storeAnswer(attempt.id, questions[index], raw, nowIso());
    })();

    return getCommittedItems(attempt).find(item => item.id === questionId);
  }

  // Scores every question of the event and stores the result. Committed
  // answers stay as they are, whatever the body says about them. Under
  // in-order navigation only the question the student is on (the first not
  // yet committed) takes its answer from the body; the ones after it were
  // never shown, so they are stored blank. The caller shows the student only
  // what policy.js allows.
  //
  // An attempt that was running while the event still had free navigation
  // (the teacher switched it to in order mid-attempt) may hold answers the
  // student gave to any question then, so every uncommitted question takes
  // its answer from the body, as under free navigation.
  function submitAttempt(attempt, rawAnswers, { late = false } = {}) {
    const questions = getEventQuestions(attempt.event_id);
    const answers = rawAnswers && typeof rawAnswers === "object" && !Array.isArray(rawAnswers) ? rawAnswers : {};
    const linear = policy.navigationMode(attempt) === "linear" && !ranUnderFreeNavigation(attempt);

    const clearUncommitted = db.prepare("DELETE FROM answers WHERE attempt_id = ? AND committed_at IS NULL");
    const totals = db.prepare("SELECT COALESCE(SUM(earned_points), 0) AS score, COALESCE(SUM(max_points), 0) AS max FROM answers WHERE attempt_id = ?");
    const finalizeAttempt = db.prepare(`
      UPDATE attempts
      SET status = 'submitted', submitted_at = ?, score = ?, max_score = ?, late = ?
      WHERE id = ? AND status = 'started' AND reset_at IS NULL
    `);

    let result;

    db.transaction(() => {
      clearUncommitted.run(attempt.id);
      const done = committedIds(attempt.id);
      const current = linear ? questions.find(question => !done.has(question.id)) : null;

      questions.forEach(question => {
        if (done.has(question.id)) {
          return;
        }

        const accepted = !linear || question === current;
        const raw = accepted && Object.prototype.hasOwnProperty.call(answers, question.id) ? answers[question.id] : undefined;
        storeAnswer(attempt.id, question, raw);
      });

      result = totals.get(attempt.id);
      const updated = finalizeAttempt.run(nowIso(), result.score, result.max, late ? 1 : 0, attempt.id);

      if (updated.changes !== 1) {
        throw httpError(409, "This attempt has already been submitted.");
      }
    })();

    return { score: result.score, max: result.max };
  }

  // Whether the event's navigation was switched away from free after this
  // attempt started.
  function ranUnderFreeNavigation(attempt) {
    return Boolean(db.prepare(`
      SELECT 1 FROM event_setting_changes
      WHERE event_id = ? AND field = 'navigation_mode' AND old_value = 'free' AND changed_at >= ?
      LIMIT 1
    `).get(attempt.event_id, attempt.started_at));
  }

  function answersFor(attemptId) {
    return db.prepare(`
      SELECT question_id, question_type, response_json, chosen_index, correct_index, earned_points, max_points, score_status, detail_json, committed_at
      FROM answers
      WHERE attempt_id = ?
      ORDER BY id ASC
    `).all(attemptId);
  }

  // One stored answer in the perQuestion shape, from the event snapshot the
  // student answered.
  function resultItem(row, question) {
    const correctText = Array.isArray(question.options) && row.correct_index !== null ? question.options[row.correct_index] : null;

    return {
      id: row.question_id,
      title: question.title || null,
      level: question.level || null,
      topic: question.topic || null,
      qType: question.qType || null,
      type: row.question_type,
      response: row.response_json === null ? null : JSON.parse(row.response_json),
      correctResponse: row.correct_index === null ? scoring.keyResponse(question) : { index: row.correct_index, text: correctText },
      earned: row.earned_points,
      max: row.max_points,
      correct: row.score_status === "scored" ? row.earned_points === row.max_points : null,
      status: row.score_status,
      detail: row.detail_json === null ? null : JSON.parse(row.detail_json)
    };
  }

  // An attempt's stored answers in question order, optionally only the
  // committed ones.
  function attemptItems(attempt, { committedOnly = false } = {}) {
    const questions = getEventQuestions(attempt.event_id);
    const order = new Map(questions.map((question, index) => [question.id, index]));
    const byId = new Map(questions.map(question => [question.id, question]));

    return answersFor(attempt.id)
      .filter(row => !committedOnly || row.committed_at !== null)
      .sort((a, b) => (order.has(a.question_id) ? order.get(a.question_id) : Infinity) - (order.has(b.question_id) ? order.get(b.question_id) : Infinity))
      .map(row => resultItem(row, byId.get(row.question_id) || { id: row.question_id }));
  }

  // The answers committed so far, for an attempt still in progress.
  function getCommittedItems(attempt) {
    return attemptItems(attempt, { committedOnly: true });
  }

  // The full per-question breakdown for one attempt, built from the stored
  // answers and the event snapshot the student answered. policy.js decides
  // whether a student may see it.
  function getAttemptResult(attempt) {
    if (attempt.status !== "submitted") {
      return null;
    }

    const perQuestion = attemptItems(attempt);

    return {
      score: attempt.score,
      max: attempt.max_score,
      pending: perQuestion.filter(item => item.status === "pending").length,
      perQuestion
    };
  }

  function getResults(eventId) {
    const attempts = db.prepare(`
      SELECT id, student_name, student_group, status, started_at, deadline_at, submitted_at, late, reset_at, score, max_score
      FROM attempts
      WHERE event_id = ?
      ORDER BY started_at DESC, id DESC
    `).all(eventId);

    const answersByAttempt = db.prepare(`
      SELECT attempt_id, question_id, question_type, response_json, chosen_index, correct_index, earned_points, max_points, score_status, detail_json, committed_at
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
        detail: row.detail_json === null ? null : JSON.parse(row.detail_json),
        committedAt: row.committed_at
      });

      return acc;
    }, {});

    return attempts.map(attempt => ({
      ...attempt,
      late: Boolean(attempt.late),
      answers: answersByAttempt[attempt.id] || []
    }));
  }

  // ---------- AI-scored answers (src/ai/jobs.js and the teacher review) ----------

  // An attempt's total is always the sum of its answers, so a late AI score
  // or a teacher's override changes the total the student sees. An attempt
  // still in progress has no total yet (an answer committed under "each" can
  // be scored before submit); submitAttempt sums every row when it finishes.
  function recomputeAttemptScore(attemptId) {
    db.prepare(`
      UPDATE attempts
      SET score = (SELECT COALESCE(SUM(earned_points), 0) FROM answers WHERE attempt_id = ?)
      WHERE id = ? AND status = 'submitted'
    `).run(attemptId, attemptId);
  }

  // The oldest pending answers not already being scored. Pending rows are the
  // queue, so after a restart they are simply found again. Answers on a reset
  // attempt are left alone: nobody will see their score, so they are not
  // sent to the AI provider.
  function listPendingAnswers(limit, skipIds = []) {
    const skip = new Set(skipIds);

    return db.prepare(`
      SELECT an.id, an.attempt_id, an.question_id, an.response_json,
             a.event_id, a.student_name, a.student_group
      FROM answers an
      JOIN attempts a ON a.id = an.attempt_id
      WHERE an.score_status = 'pending' AND a.reset_at IS NULL
      ORDER BY an.id ASC
      LIMIT ?
    `).all(limit + skip.size).filter(row => !skip.has(row.id)).slice(0, limit);
  }

  // Stores the job's result for one answer, only if it is still pending (a
  // teacher may have marked it meanwhile), and updates the attempt total.
  function completePendingAnswer(answerId, { status, earned, detail }) {
    return db.transaction(() => {
      const row = db.prepare("SELECT attempt_id FROM answers WHERE id = ? AND score_status = 'pending'").get(answerId);

      if (!row) {
        return false;
      }

      db.prepare("UPDATE answers SET score_status = ?, earned_points = ?, detail_json = ? WHERE id = ?")
        .run(status, earned, detail ? JSON.stringify(detail) : null, answerId);
      recomputeAttemptScore(row.attempt_id);
      return true;
    })();
  }

  // An answer the teacher may mark: any answer of a submitted attempt, or a
  // committed one of an attempt still in progress (so "after each question"
  // with AI off need not leave a student waiting until they submit). Answers
  // on a reset attempt cannot be marked.
  function getMarkableAnswer(eventId, attemptId, questionId) {
    return db.prepare(`
      SELECT an.id, an.attempt_id, an.question_id, an.question_type, an.max_points, an.score_status, an.detail_json
      FROM answers an
      JOIN attempts a ON a.id = an.attempt_id
      WHERE a.event_id = ? AND a.id = ? AND an.question_id = ? AND a.reset_at IS NULL
        AND (a.status = 'submitted' OR (a.status = 'started' AND an.committed_at IS NOT NULL))
    `).get(eventId, attemptId, questionId) || null;
  }

  // A teacher's mark. The AI's record (if any) is kept under the review, so
  // the teacher's view still shows what the model said.
  function reviewAnswer(answerId, { score, feedback, reviewedBy }) {
    return db.transaction(() => {
      const row = db.prepare("SELECT attempt_id, detail_json FROM answers WHERE id = ?").get(answerId);
      const previous = row.detail_json ? JSON.parse(row.detail_json) : {};
      const { review: _oldReview, ...kept } = previous;
      const detail = { ...kept, review: { score, reviewedBy, reviewedAt: nowIso() } };

      if (feedback) {
        detail.review.feedback = feedback;
      }

      db.prepare("UPDATE answers SET score_status = 'scored', earned_points = ?, detail_json = ? WHERE id = ?")
        .run(score, JSON.stringify(detail), answerId);
      recomputeAttemptScore(row.attempt_id);
      return detail;
    })();
  }

  function resetAttempt(eventId, attemptId, userId) {
    const result = db.prepare(`
      UPDATE attempts SET reset_at = ?, reset_by = ?
      WHERE id = ? AND event_id = ? AND reset_at IS NULL
    `).run(nowIso(), userId, attemptId, eventId);

    return result.changes === 1;
  }

  // Applies a teacher's edit to an event's settings. changes maps column
  // names (the fields event_setting_changes allows) to their new values; only
  // those that differ from the stored value are written, each with an audit
  // row. When the time limit or deadline changes, every attempt still in
  // progress gets its deadline recomputed as the earlier of start + time
  // limit and the deadline, the same rule as at start. A deadline that has
  // now passed is not enforced here: the attempt's next commit is refused as
  // time-up, and its submit is stored and flagged late under the usual grace
  // rules. Returns { changes: [{ field, oldValue, newValue }], attemptsUpdated }.
  function updateEventSettings(eventId, userId, changes) {
    return db.transaction(() => {
      const current = db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).get(eventId);
      const at = nowIso();
      const applied = Object.keys(changes)
        .filter(field => SETTING_FIELDS.includes(field) && changes[field] !== current[field])
        .map(field => ({ field, oldValue: current[field], newValue: changes[field] }));
      const insertChange = db.prepare(`
        INSERT INTO event_setting_changes (event_id, changed_by, field, old_value, new_value, changed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      applied.forEach(change => {
        db.prepare(`UPDATE events SET ${change.field} = ? WHERE id = ?`).run(change.newValue, eventId);
        insertChange.run(eventId, userId, change.field, auditText(change.oldValue), auditText(change.newValue), at);
      });

      let attemptsUpdated = 0;

      if (applied.some(change => change.field === "duration_minutes" || change.field === "end_at")) {
        const updated = { ...current, ...changes };
        const setDeadline = db.prepare("UPDATE attempts SET deadline_at = ? WHERE id = ?");

        db.prepare("SELECT id, started_at, deadline_at FROM attempts WHERE event_id = ? AND status = 'started' AND reset_at IS NULL")
          .all(eventId)
          .forEach(attempt => {
            const deadlineAt = attemptDeadline(updated, Date.parse(attempt.started_at));

            if (deadlineAt !== attempt.deadline_at) {
              setDeadline.run(deadlineAt, attempt.id);
              attemptsUpdated += 1;
            }
          });
      }

      return { changes: applied, attemptsUpdated };
    })();
  }

  function listSettingChanges(eventId) {
    return db.prepare(`
      SELECT c.id, c.field, c.old_value, c.new_value, c.changed_at, u.email AS changed_by_email
      FROM event_setting_changes c
      LEFT JOIN users u ON u.id = c.changed_by
      WHERE c.event_id = ?
      ORDER BY c.id DESC
    `).all(eventId);
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
      if (!seedTeacher.password) {
        throw new Error(
          "SEED_TEACHER_PASSWORD must be set to create the first teacher account in an empty production database."
        );
      }

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
    commitAnswer,
    getCommittedItems,
    getAttemptResult,
    getResults,
    recomputeAttemptScore,
    listPendingAnswers,
    completePendingAnswer,
    getMarkableAnswer,
    reviewAnswer,
    resetAttempt,
    releaseResults,
    updateEventSettings,
    listSettingChanges,
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
  SETTING_FIELDS,
  attemptDeadline,
  openDatabase,
  syncContent,
  generateJoinCode
};
