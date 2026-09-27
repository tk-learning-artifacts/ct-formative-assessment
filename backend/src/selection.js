// Turns a teacher's event filter into a list of questions.
//
// Filter shape (every key optional; omitted or empty means "no constraint",
// except audiences, which defaults to ["core"] so a P5 cohort never gets
// RGSynapse questions by accident):
//   {
//     audiences:   ["core"],                question.audience is one of these
//     questionIds: ["P5-01", "P5-02"],      question.id is one of these
//     levels:      ["S1", "S2"],            question.level is one of these
//     outcomes:    ["LO-TRACE-1"],          tagged with at least one of these LOs
//     nodes:       ["concept.loops"],       tagged with one of these ontology nodes
//                                           or any node beneath them
//     types:       ["mcq"],                 question.type is one of these
//     difficulty:  { "min": 1, "max": 3 }   inclusive difficulty band
//   }
// Keys combine with AND; values inside one key combine with OR.
//
// AI-scored types are opt-in: a filter with no types and no questionIds
// leaves them out, so a level or outcome filter never sends a class
// questions that need AI_PROVIDER (or the teacher's hand-marking) unless the
// teacher names the type or the question. Questions are ordered by bank
// position, with AI-scored ones after all the others.
//
// The legacy selectionMode values map onto explicit question ids listed in
// backend/content/legacy-modes.json, so "ALL" still means the original 20
// questions even as the core bank grows.

const scoring = require("./scoring");

const LEGACY_MODES = ["ALL", "P5", "P6", "S1", "S2"];
const LIST_KEYS = ["audiences", "questionIds", "levels", "outcomes", "nodes", "types"];
const DEFAULT_AUDIENCES = ["core"];

function legacyModeToFilter(mode, content) {
  return { audiences: ["core"], questionIds: content.legacyModes[mode].slice() };
}

function cleanList(value) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean)));
}

// Returns { filter, errors }. The returned filter is canonical: only known
// keys, deduplicated lists, empty lists dropped, audiences always present.
function normalizeFilter(input, content) {
  const errors = [];
  const filter = {};

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { filter: null, errors: ["filter must be an object"] };
  }

  Object.keys(input).forEach(key => {
    if (!LIST_KEYS.includes(key) && key !== "difficulty") {
      errors.push(`unknown filter key "${key}"`);
    }
  });

  const known = {
    audiences: new Set(content.audiences.map(audience => audience.id)),
    questionIds: new Set(content.questions.map(question => question.id)),
    levels: new Set(content.levels.map(level => level.id)),
    outcomes: new Set(content.outcomes.map(outcome => outcome.id)),
    nodes: new Set(content.nodes.map(node => node.id))
  };

  LIST_KEYS.forEach(key => {
    const list = cleanList(input[key]);

    if (list === null) {
      errors.push(`filter.${key} must be an array`);
      return;
    }

    if (!list.length) {
      return;
    }

    if (key === "types") {
      list.forEach(type => {
        const impl = scoring.getType(type);
        if (!impl) {
          errors.push(`unknown question type "${type}"`);
        } else if (impl.status !== "active") {
          errors.push(`question type "${type}" is reserved and has no questions yet`);
        }
      });
    } else {
      const unknown = list.filter(id => !known[key].has(id));
      if (unknown.length) {
        errors.push(`unknown ${key}: ${unknown.join(", ")}`);
      }
    }

    filter[key] = list;
  });

  if (!filter.audiences) {
    filter.audiences = DEFAULT_AUDIENCES.slice();
  }

  const difficulty = input.difficulty;

  if (difficulty !== undefined && difficulty !== null) {
    if (typeof difficulty !== "object" || Array.isArray(difficulty)) {
      errors.push("filter.difficulty must be an object like { \"min\": 1, \"max\": 3 }");
    } else {
      const band = {};

      Object.keys(difficulty).forEach(key => {
        if (key !== "min" && key !== "max") {
          errors.push(`unknown filter.difficulty key "${key}"`);
        }
      });

      [["min", difficulty.min], ["max", difficulty.max]].forEach(([name, value]) => {
        if (value === undefined || value === null) {
          return;
        }
        if (!Number.isInteger(value) || value < 1 || value > 5) {
          errors.push(`filter.difficulty.${name} must be an integer from 1 to 5`);
          return;
        }
        band[name] = value;
      });

      if (band.min && band.max && band.min > band.max) {
        errors.push("filter.difficulty.min must not be greater than max");
      }

      if (Object.keys(band).length) {
        filter.difficulty = band;
      }
    }
  }

  return { filter: errors.length ? null : filter, errors };
}

// Accepts the body of POST /api/events (or the preview endpoint) and works out
// which filter to use. Returns { selectionMode, filter, errors }.
function resolveSelection(body, content) {
  if (body.filter !== undefined && body.filter !== null) {
    const { filter, errors } = normalizeFilter(body.filter, content);
    return { selectionMode: "FILTER", filter, errors };
  }

  const mode = String(body.selectionMode || "ALL").trim().toUpperCase();

  if (!LEGACY_MODES.includes(mode)) {
    return { selectionMode: null, filter: null, errors: ["Unsupported selection mode."] };
  }

  return { selectionMode: mode, filter: legacyModeToFilter(mode, content), errors: [] };
}

// Walks down parent_of edges so picking "concept.data" also matches questions
// tagged with "concept.data.structures.paths". Run as its own query: SQLite
// 3.53 stalls when this recursive CTE sits inside the correlated EXISTS below.
function expandNodes(db, nodeIds) {
  return db.prepare(`
    WITH RECURSIVE subtree(id) AS (
      SELECT value FROM json_each(?)
      UNION
      SELECT e.to_id FROM ontology_edges e JOIN subtree s ON e.from_id = s.id
      WHERE e.kind = 'parent_of'
    )
    SELECT id FROM subtree
  `).all(JSON.stringify(nodeIds)).map(row => row.id);
}

// Active types scored by the AI provider (their module sets requiresAi).
function aiScoredTypes() {
  return scoring.listTypes()
    .filter(entry => entry.status === "active" && scoring.getType(entry.type).requiresAi)
    .map(entry => entry.type);
}

function selectQuestions(db, filter) {
  const where = [];
  const params = [];
  const aiTypes = aiScoredTypes();
  const named = key => Boolean(filter[key] && filter[key].length);

  if (aiTypes.length && !named("types") && !named("questionIds")) {
    where.push("q.type NOT IN (SELECT value FROM json_each(?))");
    params.push(JSON.stringify(aiTypes));
  }

  [["audiences", "q.audience"], ["questionIds", "q.id"], ["levels", "q.level"], ["types", "q.type"]].forEach(([key, column]) => {
    if (filter[key] && filter[key].length) {
      where.push(`${column} IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(filter[key]));
    }
  });

  if (filter.difficulty && filter.difficulty.min) {
    where.push("q.difficulty >= ?");
    params.push(filter.difficulty.min);
  }

  if (filter.difficulty && filter.difficulty.max) {
    where.push("q.difficulty <= ?");
    params.push(filter.difficulty.max);
  }

  if (filter.outcomes && filter.outcomes.length) {
    where.push(`EXISTS (
      SELECT 1 FROM question_outcomes qo
      WHERE qo.question_id = q.id AND qo.outcome_id IN (SELECT value FROM json_each(?))
    )`);
    params.push(JSON.stringify(filter.outcomes));
  }

  if (filter.nodes && filter.nodes.length) {
    where.push(`EXISTS (
      SELECT 1 FROM question_nodes qn
      WHERE qn.question_id = q.id AND qn.node_id IN (SELECT value FROM json_each(?))
    )`);
    params.push(JSON.stringify(expandNodes(db, filter.nodes)));
  }

  const sql = `
    SELECT q.question_json
    FROM bank_questions q
    ${where.length ? `WHERE ${where.join("\n      AND ")}` : ""}
    ORDER BY CASE WHEN q.type IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END, q.position ASC
  `;

  return db.prepare(sql).all(...params, JSON.stringify(aiTypes)).map(row => JSON.parse(row.question_json));
}

function summarizeFilter(filter) {
  if (!filter) {
    return null;
  }

  const parts = [];

  LIST_KEYS.forEach(key => {
    if (!filter[key] || !filter[key].length) {
      return;
    }

    parts.push(key === "questionIds" ? `${filter[key].length} chosen questions` : `${key}: ${filter[key].join(", ")}`);
  });

  if (filter.difficulty) {
    parts.push(`difficulty: ${filter.difficulty.min || 1}-${filter.difficulty.max || 5}`);
  }

  return parts.length ? parts.join(" / ") : "all questions";
}

module.exports = {
  LEGACY_MODES,
  legacyModeToFilter,
  normalizeFilter,
  resolveSelection,
  selectQuestions,
  expandNodes,
  aiScoredTypes,
  summarizeFilter
};
