const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");
const { loadConfig } = require("./config");
const { openDatabase } = require("./db");
const { verifyPassword, hashPassword, createAttemptToken, verifyAttemptToken } = require("./security");
const scoring = require("./scoring");
const selection = require("./selection");
const { createAiProvider } = require("./ai");

const webDir = path.resolve(__dirname, "../../web");

// Only these files from web/ are served. Everything else in that folder
// (package.json, vite.config.js, anything added later) stays private.
const PUBLIC_FILES = new Set(["index.html", "admin.html", "app.js", "admin.js", "style.css"]);

function normalizeJoinCode(rawCode) {
  return String(rawCode || "").trim().toUpperCase();
}

function parseOptionalDate(value, fieldName) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

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

function createApp({ config = loadConfig(), store = null, log = console.log } = {}) {
  const db = store || openDatabase({ dbPath: config.dbPath, log });
  const ai = createAiProvider(config.ai);
  const app = express();

  app.locals.store = db;
  app.locals.config = config;
  app.locals.ai = ai;

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
      ai: { enabled: ai.enabled, provider: ai.name }
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

    if (durationMinutes !== null && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
      res.status(400).json({ error: "Duration must be a positive number of minutes." });
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

      const { created_by: _createdBy, ...event } = db.getEventById(eventId);
      event.question_count = db.getEventQuestions(eventId).length;

      res.status(201).json({ event });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        res.status(409).json({ error: "That join code is already in use." });
        return;
      }

      res.status(error.status || 400).json({ error: error.message || "Could not create event." });
    }
  });

  app.get("/api/events/:id/results", requireAuth, (req, res) => {
    const eventId = Number(req.params.id);
    const found = Number.isInteger(eventId) ? db.getEventForTeacher(eventId, req.user.sub) : null;

    // Another teacher's event looks exactly like a missing one.
    if (!found) {
      res.status(404).json({ error: "Event not found." });
      return;
    }

    const { created_by: _createdBy, ...event } = found;

    res.json({
      event,
      attempts: db.getResults(eventId)
    });
  });

  // ---------- Students ----------

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
    const deadlineAt = event.duration_minutes
      ? new Date(startedAtMs + event.duration_minutes * 60 * 1000).toISOString()
      : null;
    const { token, tokenHash } = createAttemptToken();
    const attemptId = db.createAttempt({
      eventId: event.id,
      studentName,
      studentGroup,
      tokenHash,
      startedAt: new Date(startedAtMs).toISOString(),
      deadlineAt
    });

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

  app.post("/api/attempts/:id/submit", (req, res) => {
    const attemptId = Number(req.params.id);
    const token = req.get("X-Attempt-Token");
    const attempt = Number.isInteger(attemptId) ? db.getAttempt(attemptId) : null;

    if (!attempt) {
      res.status(404).json({ error: "Attempt not found." });
      return;
    }

    if (!token) {
      res.status(401).json({ error: "Attempt token required." });
      return;
    }

    if (!verifyAttemptToken(token, attempt.token_hash)) {
      res.status(403).json({
        error: attempt.token_hash
          ? "This attempt token is not valid."
          : "This attempt was started before an upgrade and cannot be submitted. Please start the test again."
      });
      return;
    }

    if (attempt.status === "submitted") {
      res.status(409).json({ error: "This attempt has already been submitted." });
      return;
    }

    const now = Date.now();
    const deadlineMs = attempt.deadline_at ? Date.parse(attempt.deadline_at) : null;

    if (deadlineMs !== null && now > deadlineMs + config.submitGraceMs) {
      res.status(410).json({ error: "The time limit for this attempt has expired." });
      return;
    }

    let result;

    try {
      result = db.submitAttempt(attempt, req.body.answers);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.status ? error.message : "Could not save this submission." });
      return;
    }

    res.json({
      attempt: {
        id: attempt.id,
        studentName: attempt.student_name,
        studentGroup: attempt.student_group,
        startedAt: attempt.started_at,
        late: deadlineMs !== null && now > deadlineMs
      },
      event: {
        title: attempt.title,
        joinCode: attempt.join_code,
        durationMinutes: attempt.duration_minutes
      },
      result
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
  PUBLIC_FILES
};
