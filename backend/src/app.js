const fs = require("fs");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");
const { loadConfig } = require("./config");
const { openDatabase } = require("./db");
const { verifyPassword, hashPassword, createAttemptToken, verifyAttemptToken } = require("./security");
const scoring = require("./scoring");
const selection = require("./selection");
const policy = require("./policy");
const { createAiProvider } = require("./ai");
const { buildOutcomesSummary } = require("./outcomes-summary");
const { createScoringQueue } = require("./ai/jobs");

const webDir = path.resolve(__dirname, "../../web");
const MAX_DURATION_MINUTES = 24 * 60;
const REVIEW_FEEDBACK_MAX_CHARS = 500;

// The files served from web/: its .html, .css and .js files (not build
// config such as vite.config.js) and the question-type renderers in
// web/types/. Derived from the folder, so a new renderer needs no edit here.
// Nothing else (package.json, dotfiles, backend/) is reachable.
function listPublicFiles(dir = webDir) {
  const top = fs.readdirSync(dir)
    .filter(name => /\.(html|css|js)$/.test(name) && !/\.config\.js$/.test(name))
    .filter(name => fs.statSync(path.join(dir, name)).isFile());
  const typesDir = path.join(dir, "types");
  const types = fs.existsSync(typesDir)
    ? fs.readdirSync(typesDir).filter(name => name.endsWith(".js")).map(name => `types/${name}`)
    : [];

  return new Set(top.concat(types).sort());
}

const PUBLIC_FILES = listPublicFiles();
const TYPE_RENDERERS = Array.from(PUBLIC_FILES).filter(name => name.startsWith("types/"));

function normalizeJoinCode(rawCode) {
  return String(rawCode || "").trim().toUpperCase();
}

// Only absolute times are accepted: an ISO 8601 string ending in Z or a UTC
// offset. A bare "2026-10-01T09:00" would be read in the server's time zone
// (UTC in Docker), which is not what a teacher in Singapore meant.
function parseOptionalDate(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const text = String(value).trim();

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    throw new Error(`${fieldName} must be an ISO date-time with a time zone, e.g. 2026-10-01T01:00:00.000Z.`);
  }

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} is not a valid date/time.`);
  }

  return date.toISOString();
}

function ensureEventAccessible(event) {
  const now = Date.now();

  if (!event) {
    return "That join code does not match any active test.";
  }

  if (event.status !== "active") {
    return "This event is not active right now.";
  }

  if (event.start_at && now < Date.parse(event.start_at)) {
    return "This test has not opened yet.";
  }

  if (event.end_at && now > Date.parse(event.end_at)) {
    return "This test is already closed.";
  }

  return null;
}

// The attempt's deadline: the earlier of start + duration and the event's
// end_at, or null when neither is set.
function computeDeadline(event, startedAtMs) {
  const candidates = [];

  if (event.duration_minutes) {
    candidates.push(startedAtMs + event.duration_minutes * 60 * 1000);
  }

  if (event.end_at) {
    candidates.push(Date.parse(event.end_at));
  }

  return candidates.length ? new Date(Math.min(...candidates)).toISOString() : null;
}

function publicEvent(event) {
  return {
    id: event.id,
    title: event.title,
    joinCode: event.join_code,
    durationMinutes: event.duration_minutes,
    startAt: event.start_at,
    endAt: event.end_at
  };
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] || 0) + 1;
    return acc;
  }, {});
}

function teacherEvent(event) {
  const { created_by: _createdBy, ...rest } = event;
  return { ...rest, breakdown_released: policy.breakdownReleased(event) };
}

// Whether a question list needs the AI provider to be scored, and whether it
// is on. Teachers see this before and after creating an event, because with
// AI_PROVIDER=none those answers wait for the teacher to mark them.
function aiStatus(questions, ai) {
  const aiRequired = questions.some(question => Boolean(scoring.getActiveType(question.type).requiresAi));
  const status = { aiRequired, aiEnabled: ai.enabled };

  if (aiRequired && !ai.enabled) {
    status.warning = "Some questions are AI-scored, but AI is off (AI_PROVIDER=none). Those answers will wait for you to mark them by hand.";
  }

  return status;
}

function createApp({ config = loadConfig(), store = null, log = console.log } = {}) {
  const db = store || openDatabase({
    dbPath: config.dbPath,
    seedTeacher: config.seedTeacher,
    isProduction: config.isProduction,
    log
  });
  const ai = createAiProvider(config.ai);
  const scoringQueue = createScoringQueue({ store: db, provider: ai, concurrency: config.ai.concurrency, log });
  const app = express();

  app.locals.store = db;
  app.locals.config = config;
  app.locals.ai = ai;
  app.locals.scoringQueue = scoringQueue;
  scoringQueue.start();

  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    const name = req.path === "/" ? "index.html" : req.path.slice(1);

    if (PUBLIC_FILES.has(name)) {
      res.sendFile(path.join(webDir, name));
      return;
    }

    next();
  });

  function createToken(user) {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role
      },
      config.jwtSecret,
      { expiresIn: "7d" }
    );
  }

  function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    try {
      req.user = jwt.verify(token, config.jwtSecret);
      next();
    } catch (_error) {
      res.status(401).json({ error: "Invalid or expired token." });
    }
  }

  // Loads the teacher's own event or answers 404, the same as a missing one.
  function ownEvent(req, res) {
    const eventId = Number(req.params.id);
    const event = Number.isInteger(eventId) ? db.getEventForTeacher(eventId, req.user.sub) : null;

    if (!event) {
      res.status(404).json({ error: "Event not found." });
      return null;
    }

    return event;
  }

  const ATTEMPT_NOT_FOUND = "Attempt not found, or the attempt token does not match.";

  // Resolves an attempt from :id and the X-Attempt-Token header. A missing
  // attempt and a wrong token get the same 404, so ids cannot be enumerated.
  function attemptFromRequest(req, res) {
    const attemptId = Number(req.params.id);
    const attempt = Number.isInteger(attemptId) ? db.getAttempt(attemptId) : null;
    const token = req.get("X-Attempt-Token");

    if (attempt && !attempt.token_hash) {
      res.status(403).json({ error: "This attempt was started before an upgrade and cannot be continued. Please start the test again." });
      return null;
    }

    if (!token) {
      res.status(401).json({ error: "Attempt token required." });
      return null;
    }

    if (!attempt || !verifyAttemptToken(token, attempt.token_hash)) {
      res.status(404).json({ error: ATTEMPT_NOT_FOUND });
      return null;
    }

    return attempt;
  }

  function attemptSummary(attempt) {
    return {
      id: attempt.id,
      status: attempt.reset_at ? "reset" : attempt.status,
      studentName: attempt.student_name,
      studentGroup: attempt.student_group,
      startedAt: attempt.started_at,
      submittedAt: attempt.submitted_at,
      deadlineAt: attempt.deadline_at,
      late: Boolean(attempt.late)
    };
  }

  // ---------- Teacher auth ----------

  app.post("/api/auth/login", (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const user = db.findUserByEmail(email);
    const check = user ? verifyPassword(password, user.password_hash) : { ok: false };

    if (!check.ok) {
      res.status(401).json({ error: "Incorrect email or password." });
      return;
    }

    if (check.needsRehash) {
      db.updatePasswordHash(user.id, hashPassword(password));
    }

    res.json({
      token: createToken(user),
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    const user = db.findUserById(req.user.sub);

    if (!user) {
      res.status(401).json({ error: "This account no longer exists." });
      return;
    }

    res.json({ user });
  });

  // ---------- Teacher: catalog for the event picker (read-only) ----------

  app.get("/api/catalog", requireAuth, (_req, res) => {
    res.json({
      framework: db.content.framework,
      levels: db.content.levels,
      audiences: db.content.audiences,
      questionTypes: scoring.listTypes(),
      legacySelectionModes: selection.LEGACY_MODES,
      ai: { enabled: ai.enabled, provider: ai.name, model: ai.model }
    });
  });

  app.get("/api/ontology", requireAuth, (_req, res) => {
    res.json({
      framework: db.content.framework,
      nodes: db.listOntology(),
      edges: db.listOntologyEdges()
    });
  });

  app.get("/api/outcomes", requireAuth, (req, res) => {
    const level = req.query.level ? String(req.query.level).trim().toUpperCase() : null;
    const audience = req.query.audience ? String(req.query.audience).trim() : null;

    if (level && !db.content.levels.some(item => item.id === level)) {
      res.status(400).json({ error: `Unknown level "${level}".` });
      return;
    }

    if (audience && !db.content.audiences.some(item => item.id === audience)) {
      res.status(400).json({ error: `Unknown audience "${audience}".` });
      return;
    }

    res.json({ outcomes: db.listOutcomes({ level, audience }) });
  });

  app.post("/api/question-bank/preview", requireAuth, (req, res) => {
    const resolved = selection.resolveSelection(req.body || {}, db.content);

    if (resolved.errors.length) {
      res.status(400).json({ error: resolved.errors.join("; "), errors: resolved.errors });
      return;
    }

    const questions = db.previewQuestions(resolved.filter);

    res.json({
      selectionMode: resolved.selectionMode,
      filter: resolved.filter,
      count: questions.length,
      totalPoints: questions.reduce((sum, question) => sum + question.points, 0),
      byLevel: countBy(questions, "level"),
      byType: countBy(questions, "type"),
      byAudience: countBy(questions, "audience"),
      ...aiStatus(questions, ai),
      questions: questions.map(question => ({
        id: question.id,
        title: question.title,
        type: question.type,
        audience: question.audience,
        level: question.level,
        difficulty: question.difficulty,
        points: question.points,
        ontology: question.ontology,
        outcomes: question.outcomes
      }))
    });
  });

  // ---------- Teacher: events and results (scoped to the signed-in teacher) ----------

  app.get("/api/events", requireAuth, (req, res) => {
    res.json({ events: db.listEventsForTeacher(req.user.sub) });
  });

  app.post("/api/events", requireAuth, (req, res) => {
    const title = String(req.body.title || "").trim();
    const durationMinutes = req.body.durationMinutes ? Number(req.body.durationMinutes) : null;
    const joinCode = normalizeJoinCode(req.body.joinCode) || db.createUniqueJoinCode();

    if (!title) {
      res.status(400).json({ error: "Event title is required." });
      return;
    }

    const resolved = selection.resolveSelection(req.body, db.content);

    if (resolved.errors.length) {
      res.status(400).json({ error: resolved.errors.join("; "), errors: resolved.errors });
      return;
    }

    if (durationMinutes !== null && (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > MAX_DURATION_MINUTES)) {
      res.status(400).json({ error: `Duration must be a positive number of minutes, at most ${MAX_DURATION_MINUTES} (24 hours).` });
      return;
    }

    try {
      const startAt = parseOptionalDate(req.body.startAt, "Start time");
      const endAt = parseOptionalDate(req.body.endAt, "Deadline");

      if (startAt && endAt && Date.parse(startAt) >= Date.parse(endAt)) {
        res.status(400).json({ error: "Deadline must be later than the start time." });
        return;
      }

      const eventId = db.createEventWithQuestions({
        title,
        joinCode,
        selectionMode: resolved.selectionMode,
        filter: resolved.filter,
        durationMinutes,
        startAt,
        endAt,
        createdBy: req.user.sub
      });

      const event = teacherEvent(db.getEventById(eventId));
      const questions = db.getEventQuestions(eventId);
      event.question_count = questions.length;

      res.status(201).json({ event, ...aiStatus(questions, ai) });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        res.status(409).json({ error: "That join code is already in use." });
        return;
      }

      res.status(error.status || 400).json({ error: error.message || "Could not create event." });
    }
  });

  app.get("/api/events/:id/results", requireAuth, (req, res) => {
    const event = ownEvent(req, res);

    if (!event) {
      return;
    }

    res.json({
      event: teacherEvent(event),
      attempts: db.getResults(event.id)
    });
  });

  // Per-learning-outcome and per-ontology-node results, for the teacher's
  // picker to report back against what was actually tested.
  app.get("/api/events/:id/outcomes-summary", requireAuth, (req, res) => {
    const event = ownEvent(req, res);

    if (!event) {
      return;
    }

    res.json(buildOutcomesSummary(db, event.id));
  });

  app.post("/api/events/:id/release", requireAuth, (req, res) => {
    const event = ownEvent(req, res);

    if (!event) {
      return;
    }

    db.releaseResults(event.id);
    res.json({ event: teacherEvent(db.getEventById(event.id)) });
  });

  app.post("/api/events/:id/attempts/:attemptId/reset", requireAuth, (req, res) => {
    const event = ownEvent(req, res);

    if (!event) {
      return;
    }

    const attemptId = Number(req.params.attemptId);

    if (!Number.isInteger(attemptId) || !db.resetAttempt(event.id, attemptId, req.user.sub)) {
      res.status(404).json({ error: "Attempt not found in this event, or already reset." });
      return;
    }

    res.json({ ok: true, attemptId });
  });

  // A teacher marks an AI-scored answer by hand: one still waiting, one the
  // AI could not score (needs-review), or one whose AI score they disagree
  // with. Owner only; the attempt total is recomputed.
  app.post("/api/events/:id/attempts/:attemptId/answers/:questionId/review", requireAuth, (req, res) => {
    const event = ownEvent(req, res);

    if (!event) {
      return;
    }

    const attemptId = Number(req.params.attemptId);
    const answer = Number.isInteger(attemptId) ? db.getSubmittedAnswer(event.id, attemptId, String(req.params.questionId)) : null;

    if (!answer) {
      res.status(404).json({ error: "No submitted answer to that question in this event." });
      return;
    }

    const impl = scoring.getType(answer.question_type);

    if (!impl || !impl.requiresAi) {
      res.status(400).json({ error: "Only AI-scored answers can be marked by hand." });
      return;
    }

    const score = req.body.score;
    const feedback = req.body.feedback === undefined || req.body.feedback === null ? "" : req.body.feedback;

    if (!Number.isInteger(score) || score < 0 || score > answer.max_points) {
      res.status(400).json({ error: `Score must be a whole number from 0 to ${answer.max_points}.` });
      return;
    }

    if (typeof feedback !== "string" || feedback.length > REVIEW_FEEDBACK_MAX_CHARS || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(feedback.replace(/\n/g, " "))) {
      res.status(400).json({ error: `Feedback must be plain text of at most ${REVIEW_FEEDBACK_MAX_CHARS} characters.` });
      return;
    }

    const detail = db.reviewAnswer(answer.id, { score, feedback: feedback.trim(), reviewedBy: req.user.sub });
    const attempt = db.getAttempt(attemptId);

    res.json({
      answer: { questionId: answer.question_id, scoreStatus: "scored", earnedPoints: score, maxPoints: answer.max_points, detail },
      attempt: { id: attemptId, score: attempt.score, maxScore: attempt.max_score }
    });
  });

  // ---------- Students ----------

  // The question-type renderers the student page loads.
  app.get("/api/web-types", (_req, res) => {
    res.json({ renderers: TYPE_RENDERERS });
  });

  app.post("/api/events/join", (req, res) => {
    const event = db.getEventByJoinCode(normalizeJoinCode(req.body.joinCode));
    const accessibilityError = ensureEventAccessible(event);

    if (accessibilityError) {
      res.status(404).json({ error: accessibilityError });
      return;
    }

    res.json({
      event: publicEvent(event),
      questionCount: db.getEventQuestions(event.id).length
    });
  });

  app.post("/api/attempts", (req, res) => {
    const studentName = String(req.body.studentName || "").trim();
    const studentGroup = String(req.body.studentGroup || "").trim();
    const event = db.getEventByJoinCode(normalizeJoinCode(req.body.joinCode));
    const accessibilityError = ensureEventAccessible(event);

    if (accessibilityError) {
      res.status(404).json({ error: accessibilityError });
      return;
    }

    if (!studentName || !studentGroup) {
      res.status(400).json({ error: "Student name and class/group are required." });
      return;
    }

    const startedAtMs = Date.now();
    const deadlineAt = computeDeadline(event, startedAtMs);
    const { token, tokenHash } = createAttemptToken();
    let attemptId;

    try {
      attemptId = db.startAttempt({
        eventId: event.id,
        studentName,
        studentGroup,
        tokenHash,
        startedAt: new Date(startedAtMs).toISOString(),
        deadlineAt
      });
    } catch (error) {
      if (error.status === 409) {
        res.status(409).json({
          error: error.message,
          code: error.code,
          attemptId: error.code === "attempt-in-progress" ? error.attemptId : undefined
        });
        return;
      }
      throw error;
    }

    res.status(201).json({
      attempt: {
        id: attemptId,
        token,
        eventId: event.id,
        studentName,
        studentGroup,
        deadlineAt
      },
      serverNow: new Date(startedAtMs).toISOString(),
      event: publicEvent(event),
      questions: db.getEventQuestions(event.id).map(scoring.toPublicQuestion)
    });
  });

  // Resume after a refresh, and fetch results later (including answers that
  // are scored after submission, such as AI-scored ones).
  app.get("/api/attempts/:id", (req, res) => {
    const attempt = attemptFromRequest(req, res);

    if (!attempt) {
      return;
    }

    const event = db.attemptEvent(attempt);
    const reset = Boolean(attempt.reset_at);

    res.json({
      attempt: attemptSummary(attempt),
      serverNow: new Date().toISOString(),
      event: publicEvent(event),
      questions: reset ? [] : db.getEventQuestions(attempt.event_id).map(scoring.toPublicQuestion),
      result: reset ? null : policy.studentResultView(event, db.getAttemptResult(attempt))
    });
  });

  app.post("/api/attempts/:id/submit", (req, res) => {
    const attempt = attemptFromRequest(req, res);

    if (!attempt) {
      return;
    }

    if (attempt.reset_at) {
      res.status(409).json({ error: "Your teacher reset this attempt. Start the test again." });
      return;
    }

    if (attempt.status === "submitted") {
      res.status(409).json({ error: "This attempt has already been submitted." });
      return;
    }

    // After the grace window the answers are still stored, flagged late for
    // the teacher, rather than thrown away.
    const deadlineMs = attempt.deadline_at ? Date.parse(attempt.deadline_at) : null;
    const late = deadlineMs !== null && Date.now() > deadlineMs + config.submitGraceMs;
    let totals;

    try {
      totals = db.submitAttempt(attempt, req.body.answers, { late });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.status ? error.message : "Could not save this submission." });
      return;
    }

    scoringQueue.kick();

    const saved = db.getAttempt(attempt.id);
    const event = db.attemptEvent(saved);

    // The submit response carries the total only; the breakdown, when
    // released, comes from GET /api/attempts/:id through policy.js.
    res.json({
      attempt: attemptSummary(saved),
      event: {
        title: saved.title,
        joinCode: saved.join_code,
        durationMinutes: saved.duration_minutes
      },
      result: {
        score: totals.score,
        max: totals.max,
        breakdownReleased: policy.breakdownReleased(event)
      }
    });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Unknown API routes get JSON, not the student page.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  // Client-side routes fall back to the student page; paths that look like
  // files (a dot in the last segment, including dotfiles such as /.env) and
  // were not in PUBLIC_FILES are a plain 404.
  app.get("*", (req, res) => {
    if (path.posix.basename(req.path).includes(".")) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }

    res.sendFile(path.join(webDir, "index.html"));
  });

  // Malformed JSON bodies and other thrown errors come back as JSON.
  app.use((error, _req, res, _next) => {
    const status = error.status || error.statusCode || 500;
    res.status(status).json({ error: status === 500 ? "Something went wrong." : error.message });
  });

  return app;
}

module.exports = {
  createApp,
  listPublicFiles,
  PUBLIC_FILES
};
