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
//     limit:       10                       at most this many, balanced
//                                           across learning outcomes
//   }
// Keys combine with AND; values inside one key combine with OR. limit applies
// last, to whatever the other keys matched (see balancedPick).
//
// AI-scored types are opt-in: a filter with no types and no questionIds
// leaves them out, so a level or outcome filter never sends a class
// questions that need AI_PROVIDER (or the teacher's hand-marking) unless the
// teacher names the type or the question. Questions are ordered by bank
// position, with AI-scored ones after all the others.
//
// The legacy selectionMode values map onto explicit question ids listed in
// backend/content/legacy-modes.json, so "ALL" still means the original 20
// questions even as the core bank grows. A quick setup preset
// (backend/content/presets.json) compiles to an ordinary filter first.

const scoring = require("./scoring");
const presets = require("./presets");

const LEGACY_MODES = ["ALL", "P5", "P6", "S1", "S2"];
const LIST_KEYS = ["audiences", "questionIds", "levels", "outcomes", "nodes", "types"];
const DEFAULT_AUDIENCES = ["core"];
const MAX_LIMIT = 100;

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
    if (!LIST_KEYS.includes(key) && key !== "difficulty" && key !== "limit") {
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

  if (input.limit !== undefined && input.limit !== null) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      errors.push(`filter.limit must be an integer from 1 to ${MAX_LIMIT}`);
    } else {
      filter.limit = input.limit;
    }
  }

  return { filter: errors.length ? null : filter, errors };
}

// Accepts the body of POST /api/events (or the preview endpoint) and works out
// which filter to use: a v2 filter, a quick setup preset choice, or a legacy
// selectionMode, in that order. Returns { selectionMode, filter, errors }.
function resolveSelection(body, content) {
  if (body.preset !== undefined && body.preset !== null && (body.filter === undefined || body.filter === null)) {
    const compiled = presets.compilePreset(body.preset, content);

    if (compiled.errors.length) {
      return { selectionMode: null, filter: null, errors: compiled.errors };
    }

    const { filter, errors } = normalizeFilter(compiled.filter, content);
    return { selectionMode: "FILTER", filter, errors };
  }

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
  // Retired questions (the overlay) are never selected, not even by id.
  // Only the bank endpoint reads them, through its own query.
  const where = ["q.retired = 0"];
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

  const questions = db.prepare(sql).all(...params, JSON.stringify(aiTypes)).map(row => JSON.parse(row.question_json));
  return filter.limit ? balancedPick(questions, filter.limit) : questions;
}

// Groups items by key, groups in order of first appearance.
function groupBy(items, keyOf) {
  const groups = new Map();

  items.forEach(item => {
    const key = keyOf(item);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  });

  return Array.from(groups.values());
}

// The first item of each list, then the second of each, and so on.
function interleave(lists) {
  const longest = Math.max(0, ...lists.map(list => list.length));
  const order = [];

  for (let round = 0; round < longest; round += 1) {
    lists.forEach(list => {
      if (round < list.length) {
        order.push(list[round]);
      }
    });
  }

  return order;
}

// Keeps at most `limit` questions, spread across levels and, within each
// level, across learning outcomes (a question's first outcome). Each level's
// questions are interleaved by outcome, the levels are interleaved with each
// other, and the first `limit` are kept. The kept questions stay in their
// original bank order, so AI-scored ones are still last. Deterministic: the
// same filter always keeps the same questions.
function balancedPick(questions, limit) {
  if (questions.length <= limit) {
    return questions;
  }

  const indexed = questions.map((question, index) => ({ question, index }));
  const perLevel = groupBy(indexed, item => item.question.level || "")
    .map(items => interleave(groupBy(items, item => (item.question.outcomes && item.question.outcomes[0]) || "")));
  const kept = new Set(interleave(perLevel).slice(0, limit).map(item => item.index));

  return questions.filter((_question, index) => kept.has(index));
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

  if (filter.limit) {
    parts.push(`at most ${filter.limit}`);
  }

  return parts.length ? parts.join(" / ") : "all questions";
}

module.exports = {
  LEGACY_MODES,
  MAX_LIMIT,
  legacyModeToFilter,
  normalizeFilter,
  resolveSelection,
  selectQuestions,
  balancedPick,
  expandNodes,
  aiScoredTypes,
  summarizeFilter
};
