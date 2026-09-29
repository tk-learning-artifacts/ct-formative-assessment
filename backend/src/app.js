const fs = require("fs");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");
const { loadConfig } = require("./config");
const { openDatabase, attemptDeadline } = require("./db");
const { verifyPassword, hashPassword, createAttemptToken, verifyAttemptToken } = require("./security");
const scoring = require("./scoring");
const selection = require("./selection");
const policy = require("./policy");
const access = require("./access");
const presets = require("./presets");
const overlay = require("./overlay");
const { createAiProvider } = require("./ai");
const { buildOutcomesSummary } = require("./outcomes-summary");
const { createScoringQueue } = require("./ai/jobs");

const webDir = path.resolve(__dirname, "../../web");
const MAX_DURATION_MINUTES = 24 * 60;
const REVIEW_FEEDBACK_MAX_CHARS = 500;

// The files served from web/: its .html, .css and .js files (not build
// config such as vite.config.js), the question-type renderers in
// web/types/, the .js and .css files in web/lib/ (shared with the server)
// and in each folder of web/vendor/ (vendored libraries, ADR 0006), and the
// question visuals: web/visuals/*.js and *.css, the kinds in
// web/visuals/kinds/ and the .webp illustrations in web/visuals/img/ (ADR
// 0007). Derived from the folders, so a new renderer or kind needs no edit
// here. Nothing else (package.json, licence files, dotfiles, backend/) is
// reachable.
function listPublicFiles(dir = webDir) {
  const filesIn = (sub, pattern) => {
    const full = path.join(dir, sub);
    return fs.existsSync(full)
      ? fs.readdirSync(full).filter(name => pattern.test(name) && fs.statSync(path.join(full, name)).isFile()).map(name => `${sub}/${name}`)
      : [];
  };
  const top = fs.readdirSync(dir)
    .filter(name => /\.(html|css|js)$/.test(name) && !/\.config\.js$/.test(name))
    .filter(name => fs.statSync(path.join(dir, name)).isFile());
  const vendorDir = path.join(dir, "vendor");
  const vendor = fs.existsSync(vendorDir)
    ? fs.readdirSync(vendorDir).filter(name => fs.statSync(path.join(vendorDir, name)).isDirectory())
      .flatMap(name => filesIn(`vendor/${name}`, /\.(css|js)$/))
    : [];

  const visuals = filesIn("visuals", /\.(css|js)$/)
    .concat(filesIn("visuals/kinds", /\.js$/), filesIn("visuals/img", /\.webp$/));

  return new Set(top.concat(filesIn("types", /\.js$/), filesIn("lib", /\.(css|js)$/), vendor, visuals).sort());
}

const PUBLIC_FILES = listPublicFiles();
const TYPE_RENDERERS = Array.from(PUBLIC_FILES).filter(name => name.startsWith("types/"));
const VISUAL_KINDS = Array.from(PUBLIC_FILES).filter(name => name.startsWith("visuals/kinds/"));

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

function publicEvent(event) {
  return {
    id: event.id,
    title: event.title,
    joinCode: event.join_code,
    durationMinutes: event.duration_minutes,
    startAt: event.start_at,
    endAt: event.end_at,
    feedbackMode: policy.feedbackMode(event),
    navigationMode: policy.navigationMode(event)
  };
}

// A per-event setting from the request body: the default when left out, an
// error message when it is not one of the allowed values.
function parseSetting(value, allowed, fallback, label) {
  if (value === undefined || value === null || value === "") {
    return { value: fallback };
  }

  return allowed.includes(value) ? { value } : { error: `${label} must be one of: ${allowed.join(", ")}.` };
}

// A time limit from the request body: null for none (left out, empty or 0,
// as the form sends), a number of minutes, or an error message.
function parseDuration(value) {
  const minutes = value ? Number(value) : null;

  if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_DURATION_MINUTES)) {
    return { error: `Duration must be a positive number of minutes, at most ${MAX_DURATION_MINUTES} (24 hours).` };
  }

  return { value: minutes };
}

// A filter with its lists sorted and keys in order, so two filters that
// select the same questions compare equal as JSON.
function canonicalFilter(filter) {
  if (Array.isArray(filter)) {
    return filter.slice().sort();
  }

  if (filter && typeof filter === "object") {
    return Object.keys(filter).sort().reduce((acc, key) => ({ ...acc, [key]: canonicalFilter(filter[key]) }), {});
  }

  return filter;
}

// Which preset an event comes from (ADR 0003 §11), from the create body:
// { preset } alone, or { filter, basedOnPreset } when the teacher opened
// Customise after choosing a card. The event counts as customised only if
// the filter differs from what the preset gives, so opening Customise and
// changing nothing still reads as the preset. The label is presets.json's
// current label and knob wording, captured now: db.js stores it as
// preset_label, so a later rename or removal in presets.json does not change
// what this event's card says. Returns { preset } (null for no preset) or
// { error }.
function presetProvenance(body, filter, content) {
  const fromCard = body.filter === undefined || body.filter === null;
  const choice = fromCard ? body.preset : body.basedOnPreset;

  if (choice === undefined || choice === null) {
    return { preset: null };
  }

  const options = presets.choiceOptions(choice, content);
  const label = presets.describeChoice(content, choice.id, options);

  if (fromCard) {
    return { preset: { id: choice.id, options, customised: false, label } };
  }

  const compiled = selection.resolveSelection({ preset: choice }, content);

  if (compiled.errors.length) {
    return { error: `basedOnPreset: ${compiled.errors.join("; ")}` };
  }

  const customised = JSON.stringify(canonicalFilter(compiled.filter)) !== JSON.stringify(canonicalFilter(filter));
  return { preset: { id: choice.id, options, customised, label } };
}

// What PATCH /api/events/:id accepts, by body key, with the column each one
// sets. Anything else is refused: above all the question set, because
// students' answers refer to that snapshot.
const EDITABLE_SETTINGS = {
  title: "title",
  feedbackMode: "feedback_mode",
  navigationMode: "navigation_mode",
  durationMinutes: "duration_minutes",
  startAt: "start_at",
  endAt: "end_at"
};
const QUESTION_SET_KEYS = ["filter", "preset", "basedOnPreset", "selectionMode", "questionIds", "questions"];

// Validates a settings edit against the event it changes. Returns
// { changes } (column name to new value) or { error }.
function parseSettingsEdit(body, event) {
  const keys = Object.keys(body || {});

  if (keys.some(key => QUESTION_SET_KEYS.includes(key))) {
    return { error: "The questions cannot be changed here. Use PUT /api/events/:id/questions, which works while no attempt is live, or create a new event." };
  }

  if (keys.includes("joinCode")) {
    return { error: "The join code cannot be changed after an event is created, because students who already have it would be stranded." };
  }

  const unknown = keys.filter(key => !Object.prototype.hasOwnProperty.call(EDITABLE_SETTINGS, key));

  if (unknown.length) {
    return { error: `These cannot be changed: ${unknown.join(", ")}. You can change: ${Object.keys(EDITABLE_SETTINGS).join(", ")}.` };
  }

  if (!keys.length) {
    return { error: "Nothing to change." };
  }

  const changes = {};

  if (keys.includes("title")) {
    const title = typeof body.title === "string" ? body.title.trim() : "";

    if (!title) {
      return { error: "Event title is required." };
    }

    changes.title = title;
  }

  if (keys.includes("feedbackMode")) {
    if (!policy.FEEDBACK_MODES.includes(body.feedbackMode)) {
      return { error: `feedbackMode must be one of: ${policy.FEEDBACK_MODES.join(", ")}.` };
    }

    changes.feedback_mode = body.feedbackMode;
  }

  if (keys.includes("navigationMode")) {
    if (!policy.NAVIGATION_MODES.includes(body.navigationMode)) {
      return { error: `navigationMode must be one of: ${policy.NAVIGATION_MODES.join(", ")}.` };
    }

    changes.navigation_mode = body.navigationMode;
  }

  if (keys.includes("durationMinutes")) {
    const duration = parseDuration(body.durationMinutes);

    if (duration.error) {
      return { error: duration.error };
    }

    changes.duration_minutes = duration.value;
  }

  try {
    if (keys.includes("startAt")) {
      changes.start_at = parseOptionalDate(body.startAt, "Start time");
    }

    if (keys.includes("endAt")) {
      changes.end_at = parseOptionalDate(body.endAt, "Deadline");
    }
  } catch (error) {
    return { error: error.message };
  }

  const startAt = keys.includes("startAt") ? changes.start_at : event.start_at;
  const endAt = keys.includes("endAt") ? changes.end_at : event.end_at;

  if (startAt && endAt && Date.parse(startAt) >= Date.parse(endAt)) {
    return { error: "Deadline must be later than the start time." };
  }

  return { changes };
}

// One audit row as the teacher's page shows it.
function settingChangeView(row) {
  return {
    id: row.id,
    field: row.field,
    oldValue: row.old_value,
    newValue: row.new_value,
    changedAt: row.changed_at,
    changedBy: row.changed_by_email
  };
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] || 0) + 1;
    return acc;
  }, {});
}

// An event as the teacher page sees it: whose it is, and whether the
// signed-in account may change it (access.js). The page hides reset,
// release, Edit settings and marking when can_manage is false.
function teacherEvent(event, user) {
  const { created_by: _createdBy, ...rest } = event;
  return {
    ...rest,
    breakdown_released: policy.breakdownReleased(event),
    owned: access.owns(user, event),
    can_manage: access.canManage(user, event)
  };
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
  // Before content is loaded or any question projected: Parsons keys its
  // public line ids and shuffle with this.
  scoring.configure({ secret: config.jwtSecret });

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

  // /admin is the teacher portal's short address.
  app.get(["/admin", "/admin/"], (_req, res) => {
    res.redirect("/admin.html");
  });

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

    let claims;

    try {
      claims = jwt.verify(token, config.jwtSecret);
    } catch (_error) {
      res.status(401).json({ error: "Invalid or expired token." });
      return;
    }

    // The role comes from the database, not the token, so `npm run set-role`
    // takes effect on the account's next request rather than when its 7-day
    // token runs out.
    const user = db.findUserById(claims.sub);

    if (!user) {
      res.status(401).json({ error: "This account no longer exists." });
      return;
    }

    req.user = { sub: user.id, email: user.email, role: user.role };
    next();
  }

  // Loads the event in :id for a teacher route, or answers for it (ADR 0004).
  // Every route that takes an event id goes through here; access.js decides.
  // - Not readable (missing, or another teacher's for a teacher): 404, the
  //   same answer either way, so ids cannot be probed.
  // - Readable but not the caller's to change (an admin on another
  //   teacher's event) when the route changes something: 403.
  function eventForRequest(req, res, { manage = false } = {}) {
    const eventId = Number(req.params.id);
    const event = Number.isInteger(eventId) ? db.getEventById(eventId) : null;
    const level = access.eventAccess(req.user, event);

    if (!level) {
      res.status(404).json({ error: "Event not found." });
      return null;
    }

    if (manage && level !== "manage") {
      res.status(403).json({ error: "Only the teacher who created this event can change it. You can see its results." });
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

  // Quick setup cards: each preset with its knobs, default settings and the
  // number of questions those defaults select (the same path as preview).
  // A "who" or "emphasis" option that can never match a question is left
  // out, so a card never offers a setting that only leads to "No questions
  // match" (the core bank has no perspectives questions, for example).
  app.get("/api/presets", requireAuth, (_req, res) => {
    const emphasis = Object.keys(presets.EMPHASIS).map(id => ({ id, label: presets.EMPHASIS_LABELS[id] }));

    function questionsFor(choice) {
      const resolved = selection.resolveSelection({ preset: choice }, db.content);
      return resolved.errors.length ? [] : db.previewQuestions(resolved.filter);
    }

    res.json({
      shortLength: db.content.presetShortLength,
      emphasis,
      presets: presets.describePresets(db.content).map(preset => {
        const questions = questionsFor(preset.defaults);
        const whoOptions = preset.whoOptions.filter(option => questionsFor({ ...preset.defaults, who: option.value }).length);
        const whoValues = preset.knobs.includes("who") ? whoOptions.map(option => option.value) : [undefined];
        const emphasisOptions = preset.knobs.includes("emphasis")
          ? emphasis.filter(item => whoValues.some(who => questionsFor({ ...preset.defaults, who, emphasis: item.id }).length))
          : [];

        return { ...preset, whoOptions, emphasisOptions, count: questions.length, aiRequired: aiStatus(questions, ai).aiRequired };
      })
    });
  });

  app.post("/api/question-bank/preview", requireAuth, (req, res) => {
    const include = req.body && req.body.include;

    if (include !== undefined && include !== "questions") {
      res.status(400).json({ error: 'Unsupported "include" value.' });
      return;
    }

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
      // include: "questions" swaps the summary list for full teacher views
      // (answer key, rubric and the rest), for the compact question preview
      // in the create-event picker. Same selection as above, so the count
      // matches either way.
      questions: include === "questions"
        ? questions.map(scoring.toTeacherQuestion)
        : questions.map(question => ({
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

  // ---------- Teacher: the question bank overlay (overlay.js) ----------

  // Runs a bank write and answers with the question's fresh entry. A refused
  // write carries its status (400 with the list of validation errors, 404,
  // 409); anything else goes to the error handler.
  function bankWrite(req, res, next, write) {
    try {
      write();
      res.json({ question: db.bank.getBankEntry(req.params.id) });
    } catch (error) {
      if (error.status) {
        res.status(error.status).json({ error: error.message, ...(error.errors ? { errors: error.errors } : {}) });
        return;
      }

      next(error);
    }
  }

  function requireBankEditor(req, res, next) {
    if (!access.canEditBank(req.user)) {
      res.status(403).json({ error: "Only an admin can edit the question bank." });
      return;
    }

    next();
  }

  // Every question, retired ones included: { teacher, public, overlay,
  // original, comments } each. `public` is what a student sees.
  app.get("/api/question-bank", requireAuth, (_req, res) => {
    res.json({ questions: db.bank.listBank() });
  });

  app.patch("/api/question-bank/:id", requireAuth, requireBankEditor, (req, res, next) => {
    const { patch, errors } = overlay.parsePatch(req.body);

    if (errors.length) {
      res.status(400).json({ error: errors.join("; "), errors });
      return;
    }

    bankWrite(req, res, next, () => db.bank.patchQuestion(req.params.id, patch, req.user.sub));
  });

  app.post("/api/question-bank/:id/flag", requireAuth, (req, res, next) => {
    bankWrite(req, res, next, () => db.bank.flagQuestion(req.params.id, req.body && req.body.note, req.user.sub));
  });

  app.delete("/api/question-bank/:id/flag", requireAuth, (req, res, next) => {
    bankWrite(req, res, next, () => db.bank.unflagQuestion(req.params.id, req.user.sub));
  });

  app.post("/api/question-bank/:id/comments", requireAuth, (req, res, next) => {
    bankWrite(req, res, next, () => db.bank.addComment(req.params.id, req.body && req.body.body, req.user.sub));
  });

  app.post("/api/question-bank/:id/retire", requireAuth, requireBankEditor, (req, res, next) => {
    bankWrite(req, res, next, () => db.bank.setRetired(req.params.id, true, req.user.sub));
  });

  app.post("/api/question-bank/:id/restore", requireAuth, requireBankEditor, (req, res, next) => {
    bankWrite(req, res, next, () => db.bank.setRetired(req.params.id, false, req.user.sub));
  });

  // ---------- Teacher: events and results (scoped by access.js) ----------

  // A teacher's own events; an admin's list has every teacher's.
  app.get("/api/events", requireAuth, (req, res) => {
    const events = db.listEvents({ ownerId: access.isAdmin(req.user) ? null : req.user.sub });
    res.json({ events: events.map(event => teacherEvent(event, req.user)) });
  });

  app.post("/api/events", requireAuth, (req, res) => {
    const title = String(req.body.title || "").trim();
    const duration = parseDuration(req.body.durationMinutes);
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

    if (duration.error) {
      res.status(400).json({ error: duration.error });
      return;
    }

    const provenance = presetProvenance(req.body, resolved.filter, db.content);

    if (provenance.error) {
      res.status(400).json({ error: provenance.error });
      return;
    }

    const feedbackMode = parseSetting(req.body.feedbackMode, policy.FEEDBACK_MODES, policy.DEFAULT_FEEDBACK_MODE, "feedbackMode");
    const navigationMode = parseSetting(req.body.navigationMode, policy.NAVIGATION_MODES, policy.DEFAULT_NAVIGATION_MODE, "navigationMode");
    const settingError = feedbackMode.error || navigationMode.error;

    if (settingError) {
      res.status(400).json({ error: settingError });
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
        durationMinutes: duration.value,
        startAt,
        endAt,
        feedbackMode: feedbackMode.value,
        navigationMode: navigationMode.value,
        preset: provenance.preset,
        createdBy: req.user.sub
      });

      const event = teacherEvent(db.getEventById(eventId), req.user);
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
    const event = eventForRequest(req, res);

    if (!event) {
      return;
    }

    res.json({
      event: teacherEvent(event, req.user),
      attempts: db.getResults(event.id),
      settingChanges: db.listSettingChanges(event.id).map(settingChangeView)
    });
  });

  // The event's frozen question snapshot, in order, as full teacher views
  // (answer key, rubric and the teacher-only "details" note included). A
  // read like /results and /outcomes-summary: owner and admin both get it
  // (ADR 0004 §8).
  app.get("/api/events/:id/questions", requireAuth, (req, res) => {
    const event = eventForRequest(req, res);

    if (!event) {
      return;
    }

    res.json({ questions: db.getEventQuestions(event.id).map(scoring.toTeacherQuestion) });
  });

  // Changes an event's settings, even while students are taking it (ADR 0003
  // §10). Owner only (ADR 0004). The question set has its own route, below. policy.js reads the
  // event's current settings on every request, so a student's next request
  // follows the new rules; attempts in progress get their deadline
  // recomputed in the store.
  app.patch("/api/events/:id", requireAuth, (req, res) => {
    const event = eventForRequest(req, res, { manage: true });

    if (!event) {
      return;
    }

    const edit = parseSettingsEdit(req.body, event);

    if (edit.error) {
      res.status(400).json({ error: edit.error });
      return;
    }

    const { changes, attemptsUpdated } = db.updateEventSettings(event.id, req.user.sub, edit.changes);
    const updated = teacherEvent(db.getEventById(event.id), req.user);
    updated.question_count = db.getEventQuestions(event.id).length;

    res.json({ event: updated, changes, attemptsUpdated });
  });

  // Replaces the event's questions with a new selection, chosen the way a new
  // event's are (a preset card, or a filter with an optional basedOnPreset).
  // Owner only (ADR 0004), and only while no attempt is live (ADR 0003 §10):
  // the store refuses with 409 otherwise.
  app.put("/api/events/:id/questions", requireAuth, (req, res) => {
    const event = eventForRequest(req, res, { manage: true });

    if (!event) {
      return;
    }

    // Unlike creating an event, an empty body must not fall back to "all questions".
    if (!["filter", "preset", "selectionMode"].some(key => req.body && req.body[key] !== undefined && req.body[key] !== null)) {
      res.status(400).json({ error: "Choose the questions: a preset, a filter or a question set." });
      return;
    }

    const resolved = selection.resolveSelection(req.body, db.content);

    if (resolved.errors.length) {
      res.status(400).json({ error: resolved.errors.join("; "), errors: resolved.errors });
      return;
    }

    const provenance = presetProvenance(req.body, resolved.filter, db.content);

    if (provenance.error) {
      res.status(400).json({ error: provenance.error });
      return;
    }

    try {
      db.replaceEventQuestions(event.id, req.user.sub, {
        selectionMode: resolved.selectionMode,
        filter: resolved.filter,
        preset: provenance.preset
      });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message || "Could not change the questions." });
      return;
    }

    const updated = teacherEvent(db.getEventById(event.id), req.user);
    const questions = db.getEventQuestions(event.id);
    updated.question_count = questions.length;

    res.json({ event: updated, ...aiStatus(questions, ai) });
  });

  // Per-learning-outcome and per-ontology-node results, for the teacher's
  // picker to report back against what was actually tested.
  app.get("/api/events/:id/outcomes-summary", requireAuth, (req, res) => {
    const event = eventForRequest(req, res);

    if (!event) {
      return;
    }

    res.json(buildOutcomesSummary(db, event.id));
  });

  app.post("/api/events/:id/release", requireAuth, (req, res) => {
    const event = eventForRequest(req, res, { manage: true });

    if (!event) {
      return;
    }

    db.releaseResults(event.id);
    res.json({ event: teacherEvent(db.getEventById(event.id), req.user) });
  });

  app.post("/api/events/:id/attempts/:attemptId/reset", requireAuth, (req, res) => {
    const event = eventForRequest(req, res, { manage: true });

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
  // with. Owner only (ADR 0004); the attempt total is recomputed. A committed answer of
  // an attempt still in progress can be marked too, so a student under
  // "after each question" sees the mark straight away; the attempt's total
  // still only appears once it is submitted.
  app.post("/api/events/:id/attempts/:attemptId/answers/:questionId/review", requireAuth, (req, res) => {
    const event = eventForRequest(req, res, { manage: true });

    if (!event) {
      return;
    }

    const attemptId = Number(req.params.attemptId);
    const answer = Number.isInteger(attemptId) ? db.getMarkableAnswer(event.id, attemptId, String(req.params.questionId)) : null;

    if (!answer) {
      res.status(404).json({ error: "No submitted or committed answer to that question in this event." });
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

  // The visual kinds both pages load (ADR 0007).
  app.get("/api/web-visuals", (_req, res) => {
    res.json({ kinds: VISUAL_KINDS });
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
    const deadlineAt = attemptDeadline(event, startedAtMs);
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

    const questions = db.getEventQuestions(event.id);

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
      questions: db.deliveredQuestions(db.getAttempt(attemptId)).map(scoring.toPublicQuestion),
      questionCount: questions.length,
      progress: policy.studentProgressView(event, [])
    });
  });

  // Resume after a refresh, and fetch results later (including answers that
  // are scored after submission, such as AI-scored ones).
  //
  // ?fields=status is the page's poll: the settings, the deadline, which
  // answers are committed and how their marking stands, and the total
  // policy.js allows, with no question content, key or feedback. The page
  // fetches the full attempt only when something in it has changed.
  app.get("/api/attempts/:id", (req, res) => {
    const fields = req.query.fields;

    if (fields !== undefined && fields !== "status") {
      res.status(400).json({ error: "fields must be \"status\" when set." });
      return;
    }

    const attempt = attemptFromRequest(req, res);

    if (!attempt) {
      return;
    }

    const event = db.attemptEvent(attempt);
    const reset = Boolean(attempt.reset_at);
    const inProgress = !reset && attempt.status === "started";

    if (fields === "status") {
      const result = reset ? null : db.getAttemptResult(attempt);

      res.json({
        attempt: { id: attempt.id, status: attemptSummary(attempt).status, deadlineAt: attempt.deadline_at, late: Boolean(attempt.late) },
        serverNow: new Date().toISOString(),
        progress: inProgress ? policy.studentStatusView(event, db.getCommittedItems(attempt)) : null,
        result: result ? policy.studentTotal(event, result) : null
      });
      return;
    }

    res.json({
      attempt: attemptSummary(attempt),
      serverNow: new Date().toISOString(),
      event: publicEvent(event),
      questions: reset ? [] : db.deliveredQuestions(attempt).map(scoring.toPublicQuestion),
      questionCount: db.getEventQuestions(attempt.event_id).length,
      progress: inProgress ? policy.studentProgressView(event, db.getCommittedItems(attempt)) : null,
      result: reset ? null : policy.studentResultView(event, db.getAttemptResult(attempt))
    });
  });

  // Commits one answer before submit, when the event's settings lock answers
  // question by question (feedback after each question, or in-order
  // navigation). The answer is final. The response carries what policy.js
  // lets the student see of it: its result under "each", otherwise only
  // that it is recorded.
  app.post("/api/attempts/:id/answers/:questionId/commit", (req, res) => {
    const attempt = attemptFromRequest(req, res);

    if (!attempt) {
      return;
    }

    const event = db.attemptEvent(attempt);

    if (!policy.locksAnswers(event)) {
      res.status(409).json({ error: "This test takes all its answers when you submit.", code: "commit-not-used" });
      return;
    }

    const deadlineMs = attempt.deadline_at ? Date.parse(attempt.deadline_at) : null;

    if (deadlineMs !== null && Date.now() > deadlineMs + config.submitGraceMs) {
      res.status(409).json({ error: "Time is up, so answers can no longer be checked one by one. Submit your test.", code: "time-up" });
      return;
    }

    const response = req.body && Object.prototype.hasOwnProperty.call(req.body, "response") ? req.body.response : undefined;
    let item;

    try {
      item = db.commitAnswer(attempt, String(req.params.questionId), response === null ? undefined : response);
    } catch (error) {
      if (!error.status) {
        throw error;
      }

      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }

    scoringQueue.kick();

    // In order, the response brings the question the student moves on to
    // (null after the last), which is all they have of it until now.
    const view = {
      committed: policy.committedAnswerView(event, item),
      progress: policy.studentProgressView(event, db.getCommittedItems(attempt))
    };

    if (policy.navigationMode(event) === "linear") {
      const delivered = db.deliveredQuestions(attempt);
      const next = delivered.find(question => !view.progress.committed.some(entry => entry.questionId === question.id));
      view.next = next ? scoring.toPublicQuestion(next) : null;
    }

    res.json(view);
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
    try {
      db.submitAttempt(attempt, req.body.answers, { late });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.status ? error.message : "Could not save this submission." });
      return;
    }

    scoringQueue.kick();

    const saved = db.getAttempt(attempt.id);
    const event = db.attemptEvent(saved);

    // The submit response carries the total only, as policy.js allows it;
    // the breakdown, when released, comes from GET /api/attempts/:id.
    const total = policy.studentTotal(event, db.getAttemptResult(saved));

    res.json({
      attempt: attemptSummary(saved),
      event: {
        title: saved.title,
        joinCode: saved.join_code,
        durationMinutes: saved.duration_minutes
      },
      result: total
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
