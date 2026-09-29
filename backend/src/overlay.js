// The question bank overlay. Questions live in backend/content/questions/*.json
// and the app never writes those files. Teachers' edits (level, points, topic,
// question type tag, difficulty, ontology, outcomes, the teacher note) and
// retirements are rows in question_overrides, laid over the JSON when the
// bank tables are filled (syncContent) and again after each write
// (refreshQuestion), so the SQL filters in selection.js see the merged values.
//
// A NULL column in question_overrides means "no override". Events copy a
// question's JSON into event_questions when they are created, so an edit only
// reaches events created after it.

const presets = require("./presets");
const selection = require("./selection");
const scoring = require("./scoring");
const { validateQuestion, questionContext } = require("./content");

// The fields an admin may override: the API name, the column, and whether the
// column holds JSON.
const FIELDS = [
  { key: "level", column: "level", check: isShortString },
  { key: "points", column: "points", check: value => Number.isInteger(value) && value <= POINTS_MAX },
  { key: "topic", column: "topic", check: isShortString },
  { key: "qType", column: "q_type", check: isShortString },
  { key: "difficulty", column: "difficulty", check: Number.isInteger },
  { key: "ontology", column: "ontology_json", json: true, check: isStringList },
  { key: "outcomes", column: "outcomes_json", json: true, check: isStringList },
  { key: "details", column: "details", check: value => typeof value === "string" && value.length <= DETAILS_MAX }
];

const AUDIT_COLUMN = { level: "level", points: "points", topic: "topic", qType: "q_type", difficulty: "difficulty", ontology: "ontology", outcomes: "outcomes", details: "details" };
const FLAG_NOTE_MAX = 1000;
const COMMENT_MAX = 2000;
const POINTS_MAX = 100;
const DETAILS_MAX = 5000;
const SHORT_MAX = 100;
const LIST_MAX = 50;

function isShortString(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= SHORT_MAX;
}

function isStringList(value) {
  return Array.isArray(value) && value.length <= LIST_MAX && value.every(item => typeof item === "string" && item.length <= SHORT_MAX);
}

function nowIso() {
  return new Date().toISOString();
}

function httpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function auditText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

// The row's overridden values by API name; null where there is no override.
function readOverride(row) {
  const values = {};

  FIELDS.forEach(field => {
    const raw = row ? row[field.column] : null;
    values[field.key] = raw === null || raw === undefined ? null : (field.json ? JSON.parse(raw) : raw);
  });

  return values;
}

// The question with the row's non-null fields laid over it. Pure: neither
// argument is changed.
function applyOverride(question, row) {
  const merged = { ...question };
  const values = readOverride(row);

  FIELDS.forEach(field => {
    if (values[field.key] !== null) {
      merged[field.key] = values[field.key];
    }
  });

  return merged;
}

// The editable fields as the JSON has them (undefined becomes null).
function editableFields(question) {
  const values = {};
  FIELDS.forEach(field => {
    values[field.key] = question[field.key] === undefined ? null : question[field.key];
  });
  return values;
}

// Checks a PATCH body: only editable fields, each the right shape or null
// (clear). Whether the value makes sense for the question (a real node, a
// level the audience offers) is validateQuestion's job on the merged result.
function parsePatch(body) {
  const errors = [];
  const patch = {};

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { patch, errors: ["Send an object with the fields to change."] };
  }

  Object.keys(body).forEach(key => {
    const field = FIELDS.find(item => item.key === key);

    if (!field) {
      errors.push(`"${key}" cannot be edited. Editable fields: ${FIELDS.map(item => item.key).join(", ")}.`);
    } else if (body[key] !== null && !field.check(body[key])) {
      errors.push(`"${key}" has the wrong type or is empty.`);
    } else {
      patch[key] = body[key];
    }
  });

  if (!errors.length && !Object.keys(patch).length) {
    errors.push("Send at least one field to change.");
  }

  return { patch, errors };
}

// The question's own errors after the override: validateQuestion on the
// merged question (which runs the type's own validate), against the rest of
// the content. Empty when the merged question is valid.
function mergedErrors(merged, content, context) {
  const errors = [];
  const ctx = context || questionContext(content);
  // validateQuestion records the id it has seen to catch duplicates in the
  // files; a reused context must forget it, or the second check would fail.
  ctx.questionIds.clear();

  try {
    validateQuestion(merged, "override", ctx, errors);
  } catch (error) {
    errors.push(`question "${merged.id}" could not be checked: ${error.message}`);
  }

  return errors;
}

// Presets that match no question with their default settings. Boot refuses to
// start with any (db.js), so a write that would create one is refused.
function presetsWithoutQuestions(db, content) {
  return content.presets.filter(preset => {
    const resolved = selection.resolveSelection({ preset: presets.defaultChoice(preset, content) }, content);
    return resolved.errors.length || !selection.selectQuestions(db, resolved.filter).length;
  });
}

// Overrides by question id, for syncContent.
function loadOverrides(db) {
  return new Map(db.prepare("SELECT * FROM question_overrides").all().map(row => [row.question_id, row]));
}

// What syncContent stores for a question: the merged question, or the
// original with `errors` when the override no longer passes validation (the
// JSON changed under it). A stale override is skipped, not fatal.
function effectiveQuestion(question, row, content, context) {
  if (!row) {
    return { question, errors: [] };
  }

  const merged = applyOverride(question, row);
  const errors = mergedErrors(merged, content, context);
  return errors.length ? { question, errors } : { question: merged, errors: [] };
}

// Rewrites the tag rows (question_nodes, question_outcomes) for one question.
function writeTags(db, question) {
  db.prepare("DELETE FROM question_nodes WHERE question_id = ?").run(question.id);
  db.prepare("DELETE FROM question_outcomes WHERE question_id = ?").run(question.id);
  const insertNode = db.prepare("INSERT OR IGNORE INTO question_nodes (question_id, node_id) VALUES (?, ?)");
  const insertOutcome = db.prepare("INSERT OR IGNORE INTO question_outcomes (question_id, outcome_id) VALUES (?, ?)");
  question.ontology.forEach(nodeId => insertNode.run(question.id, nodeId));
  question.outcomes.forEach(outcomeId => insertOutcome.run(question.id, outcomeId));
}

function createOverlay(db, content, { stale = new Map(), log = () => {} } = {}) {
  const originals = new Map(content.questions.map(question => [question.id, question]));
  const context = questionContext(content);

  function requireQuestion(id) {
    const original = originals.get(id);

    if (!original) {
      throw httpError(404, "That question does not exist.");
    }

    return original;
  }

  // Runs a write in one transaction. When it is refused after refreshQuestion
  // ran, the rollback restores the tables but not the stale marker, so the
  // question is refreshed again from what the tables now hold.
  function guarded(id, write) {
    try {
      return db.transaction(write)();
    } catch (error) {
      refreshQuestion(id);
      throw error;
    }
  }

  function overrideRow(id) {
    return db.prepare("SELECT * FROM question_overrides WHERE question_id = ?").get(id) || null;
  }

  // Rewrites one question's bank_questions, question_nodes and
  // question_outcomes rows from the JSON plus its override, in one
  // transaction (joining the caller's, if there is one).
  function refreshQuestion(id) {
    const original = requireQuestion(id);

    db.transaction(() => {
      const row = overrideRow(id);
      const { question, errors } = effectiveQuestion(original, row, content, context);

      if (errors.length) {
        stale.set(id, errors);
      } else {
        stale.delete(id);
      }

      db.prepare(`
        UPDATE bank_questions
        SET level = ?, difficulty = ?, points = ?, question_json = ?, retired = ?
        WHERE id = ?
      `).run(question.level, question.difficulty, question.points, JSON.stringify(question), row && row.retired_at ? 1 : 0, id);
      writeTags(db, question);
    })();
  }

  function assertPresetsStillMatch(action) {
    const empty = presetsWithoutQuestions(db, content);

    if (empty.length) {
      throw httpError(409, `${action} would leave ${empty.map(preset => `the "${preset.label || preset.id}" preset`).join(" and ")} with no questions.`);
    }
  }

  function record(questionId, userId, field, oldValue, newValue, at) {
    db.prepare(`
      INSERT INTO question_override_changes (question_id, changed_by, field, old_value, new_value, changed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(questionId, userId, field, auditText(oldValue), auditText(newValue), at);
  }

  function ensureRow(id) {
    db.prepare("INSERT OR IGNORE INTO question_overrides (question_id) VALUES (?)").run(id);
  }

  // Applies a PATCH (already shaped by parsePatch): each key a new override,
  // null to clear. Refused with 400 and the error list when the merged
  // question is invalid, and with 409 when it would empty a preset.
  function patchQuestion(id, patch, userId) {
    const original = requireQuestion(id);

    return guarded(id, () => {
      const row = overrideRow(id);
      const before = readOverride(row);
      const after = { ...before, ...patch };
      const draft = { ...(row || {}) };
      FIELDS.forEach(field => {
        draft[field.column] = after[field.key] === null ? null : (field.json ? JSON.stringify(after[field.key]) : after[field.key]);
      });
      const errors = mergedErrors(applyOverride(original, draft), content, context);

      if (errors.length) {
        throw httpError(400, errors.join("; "), { errors });
      }

      const at = nowIso();
      ensureRow(id);
      const changed = FIELDS.filter(field => JSON.stringify(before[field.key]) !== JSON.stringify(after[field.key]));

      changed.forEach(field => {
        db.prepare(`UPDATE question_overrides SET ${field.column} = ? WHERE question_id = ?`).run(draft[field.column], id);
        record(id, userId, AUDIT_COLUMN[field.key], before[field.key], after[field.key], at);
      });

      if (changed.length) {
        db.prepare("UPDATE question_overrides SET updated_by = ?, updated_at = ? WHERE question_id = ?").run(userId, at, id);
        refreshQuestion(id);
        assertPresetsStillMatch("That change");
      }

      return changed.map(field => field.key);
    });
  }

  // Flags a question (or updates the note of an existing flag).
  function flagQuestion(id, note, userId) {
    requireQuestion(id);
    const text = typeof note === "string" && note.trim() ? note.trim() : null;

    if (text && text.length > FLAG_NOTE_MAX) {
      throw httpError(400, `The note may be at most ${FLAG_NOTE_MAX} characters.`);
    }

    db.transaction(() => {
      const row = overrideRow(id);
      const at = nowIso();
      ensureRow(id);
      db.prepare("UPDATE question_overrides SET flagged_at = ?, flagged_by = ?, flag_note = ? WHERE question_id = ?").run(at, userId, text, id);
      record(id, userId, "flag", row && row.flagged_at ? (row.flag_note || "flagged") : null, text || "flagged", at);
    })();
  }

  function unflagQuestion(id, userId) {
    requireQuestion(id);

    db.transaction(() => {
      const row = overrideRow(id);

      if (!row || !row.flagged_at) {
        return;
      }

      db.prepare("UPDATE question_overrides SET flagged_at = NULL, flagged_by = NULL, flag_note = NULL WHERE question_id = ?").run(id);
      record(id, userId, "flag", row.flag_note || "flagged", null, nowIso());
    })();
  }

  function addComment(id, body, userId) {
    requireQuestion(id);
    const text = typeof body === "string" ? body.trim() : "";

    if (!text) {
      throw httpError(400, "A comment needs some text.");
    }

    if (text.length > COMMENT_MAX) {
      throw httpError(400, `A comment may be at most ${COMMENT_MAX} characters.`);
    }

    db.transaction(() => {
      const at = nowIso();
      db.prepare("INSERT INTO question_comments (question_id, author_id, body, created_at) VALUES (?, ?, ?, ?)").run(id, userId, text, at);
      record(id, userId, "comment", null, text, at);
    })();
  }

  // Retires or restores a question. Retiring is refused (409) when it would
  // leave a preset with no questions.
  function setRetired(id, retired, userId) {
    requireQuestion(id);

    guarded(id, () => {
      const row = overrideRow(id);

      if (Boolean(row && row.retired_at) === retired) {
        return;
      }

      const at = nowIso();
      ensureRow(id);
      db.prepare("UPDATE question_overrides SET retired_at = ?, retired_by = ? WHERE question_id = ?").run(retired ? at : null, retired ? userId : null, id);
      record(id, userId, "retired", retired ? "0" : "1", retired ? "1" : "0", at);
      refreshQuestion(id);

      if (retired) {
        assertPresetsStillMatch("Retiring this question");
      }
    });
  }

  function overlayView(row, staleErrors) {
    if (!row) {
      return null;
    }

    const email = userId => {
      const user = userId ? db.prepare("SELECT email FROM users WHERE id = ?").get(userId) : null;
      return user ? user.email : null;
    };

    return {
      ...readOverride(row),
      retired: Boolean(row.retired_at),
      retiredAt: row.retired_at,
      retiredBy: email(row.retired_by),
      flagged: Boolean(row.flagged_at),
      flaggedAt: row.flagged_at,
      flaggedBy: email(row.flagged_by),
      flagNote: row.flag_note,
      updatedAt: row.updated_at,
      updatedBy: email(row.updated_by),
      stale: staleErrors || null
    };
  }

  // One bank entry: { teacher, public, overlay, original, comments }.
  // `public` is what a student is shown for the merged question (an
  // allowlist projection, so no answer key); `original` is the editable
  // fields as the JSON has them, to show what an override changed.
  function entryFor(question, row, comments) {
    return {
      teacher: scoring.toTeacherQuestion(question),
      public: scoring.toPublicQuestion(question),
      overlay: overlayView(row, stale.get(question.id)),
      original: editableFields(originals.get(question.id)),
      comments
    };
  }

  function commentsByQuestion(id = null) {
    const rows = db.prepare(`
      SELECT c.id, c.question_id, u.email AS author, c.body, c.created_at, c.resolved_at
      FROM question_comments c JOIN users u ON u.id = c.author_id
      ${id ? "WHERE c.question_id = ?" : ""}
      ORDER BY c.id ASC
    `).all(...(id ? [id] : []));
    const byQuestion = new Map();

    rows.forEach(({ question_id: questionId, ...comment }) => {
      if (!byQuestion.has(questionId)) {
        byQuestion.set(questionId, []);
      }
      byQuestion.get(questionId).push(comment);
    });

    return byQuestion;
  }

  // The bank endpoint's own query: the only reader of retired questions.
  function listBank() {
    const rows = loadOverrides(db);
    const comments = commentsByQuestion();

    return db.prepare("SELECT question_json FROM bank_questions ORDER BY position ASC").all()
      .map(({ question_json: json }) => {
        const question = JSON.parse(json);
        return entryFor(question, rows.get(question.id) || null, comments.get(question.id) || []);
      });
  }

  function getBankEntry(id) {
    requireQuestion(id);
    const stored = db.prepare("SELECT question_json FROM bank_questions WHERE id = ?").get(id);
    return entryFor(JSON.parse(stored.question_json), overrideRow(id), commentsByQuestion(id).get(id) || []);
  }

  return {
    refreshQuestion,
    patchQuestion,
    flagQuestion,
    unflagQuestion,
    addComment,
    setRetired,
    listBank,
    getBankEntry
  };
}

module.exports = {
  FIELDS,
  applyOverride,
  readOverride,
  parsePatch,
  mergedErrors,
  presetsWithoutQuestions,
  loadOverrides,
  effectiveQuestion,
  writeTags,
  createOverlay
};
