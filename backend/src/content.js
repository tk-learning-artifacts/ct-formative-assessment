// Loads the server-only content in backend/content/ (audiences, CT ontology,
// learning outcomes, question banks) and validates it as one unit. Invalid
// content stops the server at boot rather than surfacing mid-test.
//
// None of these files is ever served to the browser; question answer keys
// live here and only reach students through a type's toPublic() projection.

const fs = require("fs");
const path = require("path");
const scoring = require("./scoring");

const DEFAULT_CONTENT_DIR = path.resolve(__dirname, "../content");
const NODE_KINDS = ["concept", "practice", "perspective"];

// The ontology is anchored on Brennan & Resnick (2012): the three root nodes
// and their direct children must come from that framework. CT Quest's own
// finer-grained nodes can only sit below them.
const ANCHOR_FRAMEWORK = "brennan-resnick-2012";

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

function findCycle(ids, nextOf) {
  const state = new Map();

  function visit(id, trail) {
    if (state.get(id) === "done") {
      return null;
    }

    if (state.get(id) === "visiting") {
      return trail.slice(trail.indexOf(id)).concat(id);
    }

    state.set(id, "visiting");

    for (const next of nextOf(id)) {
      const cycle = visit(next, trail.concat(id));
      if (cycle) {
        return cycle;
      }
    }

    state.set(id, "done");
    return null;
  }

  for (const id of ids) {
    const cycle = visit(id, []);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

function validateCatalog(catalog, errors) {
  const levelIds = new Set();

  (catalog.levels || []).forEach(level => {
    if (!level.id || levelIds.has(level.id)) {
      errors.push(`audiences.json: level id "${level.id}" is missing or duplicated`);
    }
    levelIds.add(level.id);
  });

  const audienceIds = new Set();

  (catalog.audiences || []).forEach(audience => {
    if (!audience.id || audienceIds.has(audience.id)) {
      errors.push(`audiences.json: audience id "${audience.id}" is missing or duplicated`);
    }
    audienceIds.add(audience.id);

    (audience.levels || []).forEach(level => {
      if (!levelIds.has(level)) {
        errors.push(`audiences.json: audience "${audience.id}" uses unknown level "${level}"`);
      }
    });
  });
}

function checkCrosswalk(crosswalk, allowed, label, errors) {
  if (crosswalk === undefined) {
    return;
  }

  if (!crosswalk || typeof crosswalk !== "object" || Array.isArray(crosswalk)) {
    errors.push(`${label} crosswalk must be an object`);
    return;
  }

  Object.entries(crosswalk).forEach(([key, value]) => {
    if (!allowed[key]) {
      errors.push(`${label} uses unknown crosswalk "${key}"`);
    } else if (!allowed[key].values.includes(value)) {
      errors.push(`${label} crosswalk ${key} "${value}" is not one of: ${allowed[key].values.join(", ")}`);
    }
  });
}

function validateOntology(nodes, framework, errors) {
  const byId = new Map();
  const crosswalks = (framework && framework.crosswalks) || {};

  nodes.forEach(node => {
    if (!node.id || byId.has(node.id)) {
      errors.push(`ontology.json: node id "${node.id}" is missing or duplicated`);
    }
    byId.set(node.id, node);

    if (!NODE_KINDS.includes(node.kind)) {
      errors.push(`ontology.json: node "${node.id}" has kind "${node.kind}", expected one of ${NODE_KINDS.join(", ")}`);
    }

    if (!node.label) {
      errors.push(`ontology.json: node "${node.id}" needs a label`);
    }

    checkCrosswalk(node.crosswalk, crosswalks, `ontology.json: node "${node.id}"`, errors);
  });

  nodes.forEach(node => {
    const parent = node.parent ? byId.get(node.parent) : null;
    const isAnchorLevel = !node.parent || (parent && !parent.parent);
    const citesAnchor = (node.sources || []).some(source => source.framework === ANCHOR_FRAMEWORK);

    if (isAnchorLevel && !citesAnchor) {
      errors.push(`ontology.json: node "${node.id}" is in the top two levels, which are reserved for ${ANCHOR_FRAMEWORK} nodes`);
    }
  });

  nodes.forEach(node => {
    if (node.parent !== null && node.parent !== undefined) {
      const parent = byId.get(node.parent);
      if (!parent) {
        errors.push(`ontology.json: node "${node.id}" has unknown parent "${node.parent}"`);
      } else if (parent.kind !== node.kind) {
        errors.push(`ontology.json: node "${node.id}" (${node.kind}) sits under "${parent.id}" (${parent.kind})`);
      }
    }

    (node.prerequisites || []).forEach(prereq => {
      if (!byId.has(prereq)) {
        errors.push(`ontology.json: node "${node.id}" has unknown prerequisite "${prereq}"`);
      }
    });
  });

  const ids = nodes.map(node => node.id);
  const parentCycle = findCycle(ids, id => {
    const node = byId.get(id);
    return node && node.parent && byId.has(node.parent) ? [node.parent] : [];
  });

  if (parentCycle) {
    errors.push(`ontology.json: parent cycle ${parentCycle.join(" -> ")}`);
  }

  const prereqCycle = findCycle(ids, id => {
    const node = byId.get(id);
    return node ? (node.prerequisites || []).filter(prereq => byId.has(prereq)) : [];
  });

  if (prereqCycle) {
    errors.push(`ontology.json: prerequisite cycle ${prereqCycle.join(" -> ")}`);
  }

  return byId;
}

function validateOutcomes(outcomes, nodeIds, catalog, errors) {
  const levelIds = new Set(catalog.levels.map(level => level.id));
  const audienceIds = new Set(catalog.audiences.map(audience => audience.id));
  const byId = new Map();

  outcomes.forEach(outcome => {
    if (!outcome.id || byId.has(outcome.id)) {
      errors.push(`learning-outcomes.json: outcome id "${outcome.id}" is missing or duplicated`);
    }
    byId.set(outcome.id, outcome);

    if (!outcome.statement) {
      errors.push(`learning-outcomes.json: outcome "${outcome.id}" needs a statement`);
    }

    if (!Array.isArray(outcome.nodes) || !outcome.nodes.length) {
      errors.push(`learning-outcomes.json: outcome "${outcome.id}" must map to at least one ontology node`);
    }

    (outcome.nodes || []).forEach(nodeId => {
      if (!nodeIds.has(nodeId)) {
        errors.push(`learning-outcomes.json: outcome "${outcome.id}" maps to unknown node "${nodeId}"`);
      }
    });

    if (!Array.isArray(outcome.levels) || !outcome.levels.length) {
      errors.push(`learning-outcomes.json: outcome "${outcome.id}" needs at least one level`);
    }

    (outcome.levels || []).forEach(level => {
      if (!levelIds.has(level)) {
        errors.push(`learning-outcomes.json: outcome "${outcome.id}" uses unknown level "${level}"`);
      }
    });

    (outcome.audiences || []).forEach(audience => {
      if (!audienceIds.has(audience)) {
        errors.push(`learning-outcomes.json: outcome "${outcome.id}" uses unknown audience "${audience}"`);
      }
    });
  });

  return byId;
}

function validateQuestion(question, where, ctx, errors) {
  const label = `${where}: question "${question.id}"`;

  if (!question.id || ctx.questionIds.has(question.id)) {
    errors.push(`${label} id is missing or duplicated`);
  }
  ctx.questionIds.add(question.id);

  const impl = scoring.getType(question.type);

  if (!impl) {
    errors.push(`${label} has unknown type "${question.type}"`);
  } else if (impl.status !== "active") {
    errors.push(`${label} uses reserved type "${question.type}", which has no scorer yet`);
  } else {
    impl.validate(question).forEach(message => errors.push(`${label} ${message}`));
  }

  const audience = ctx.audiences.get(question.audience);

  if (!audience) {
    errors.push(`${label} has unknown audience "${question.audience}"`);
  } else if (!audience.levels.includes(question.level)) {
    errors.push(`${label} level "${question.level}" is not offered to audience "${question.audience}"`);
  }

  ["title", "prompt"].forEach(field => {
    if (typeof question[field] !== "string" || !question[field].trim()) {
      errors.push(`${label} needs a ${field}`);
    }
  });

  if (!Number.isInteger(question.points) || question.points <= 0) {
    errors.push(`${label} points must be a positive integer`);
  }

  if (!Number.isInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 5) {
    errors.push(`${label} difficulty must be an integer from 1 to 5`);
  }

  checkCrosswalk(question.crosswalk, ctx.crosswalks, label, errors);

  if (question.code !== undefined && (typeof question.code.source !== "string" || !question.code.language)) {
    errors.push(`${label} code needs a language and a source string`);
  }

  if (!Array.isArray(question.ontology) || !question.ontology.length) {
    errors.push(`${label} must be tagged with at least one ontology node`);
  }

  (question.ontology || []).forEach(nodeId => {
    if (!ctx.nodes.has(nodeId)) {
      errors.push(`${label} is tagged with unknown ontology node "${nodeId}"`);
    }
  });

  if (!Array.isArray(question.outcomes) || !question.outcomes.length) {
    errors.push(`${label} must be tagged with at least one learning outcome`);
  }

  (question.outcomes || []).forEach(outcomeId => {
    const outcome = ctx.outcomes.get(outcomeId);

    if (!outcome) {
      errors.push(`${label} is tagged with unknown learning outcome "${outcomeId}"`);
      return;
    }

    if (!outcome.levels.includes(question.level)) {
      errors.push(`${label} (${question.level}) is tagged with ${outcomeId}, which does not cover that level`);
    }

    if (outcome.audiences && outcome.audiences.length && !outcome.audiences.includes(question.audience)) {
      errors.push(`${label} (${question.audience}) is tagged with ${outcomeId}, which does not cover that audience`);
    }
  });
}

function loadContent(contentDir = DEFAULT_CONTENT_DIR) {
  const catalog = readJson(path.join(contentDir, "audiences.json"));
  const ontology = readJson(path.join(contentDir, "ontology.json"));
  const outcomeFile = readJson(path.join(contentDir, "learning-outcomes.json"));
  const questionsDir = path.join(contentDir, "questions");
  const errors = [];

  catalog.levels = catalog.levels || [];
  catalog.audiences = catalog.audiences || [];
  validateCatalog(catalog, errors);

  const nodes = ontology.nodes || [];
  const nodesById = validateOntology(nodes, ontology.framework, errors);
  const outcomes = outcomeFile.outcomes || [];
  const outcomesById = validateOutcomes(outcomes, new Set(nodesById.keys()), catalog, errors);

  // Files load in name order and questions keep their order inside a file, so
  // "position" is stable and events built from the same filter list the same
  // questions in the same order.
  const bankFiles = fs.readdirSync(questionsDir).filter(name => name.endsWith(".json")).sort();
  const ctx = {
    questionIds: new Set(),
    audiences: new Map(catalog.audiences.map(audience => [audience.id, audience])),
    nodes: nodesById,
    outcomes: outcomesById,
    crosswalks: (ontology.framework && ontology.framework.crosswalks) || {}
  };
  const questions = [];

  bankFiles.forEach(fileName => {
    const bank = readJson(path.join(questionsDir, fileName));
    const where = `questions/${fileName}`;

    (bank.questions || []).forEach(question => {
      validateQuestion(question, where, ctx, errors);
      questions.push({ ...question, bank: bank.bank || path.basename(fileName, ".json") });
    });
  });

  // Legacy selectionMode values, pinned to explicit question ids.
  const legacyFile = readJson(path.join(contentDir, "legacy-modes.json"));
  const legacyModes = legacyFile.modes || {};
  const byId = new Map(questions.map(question => [question.id, question]));

  ["ALL", "P5", "P6", "S1", "S2"].forEach(mode => {
    if (!Array.isArray(legacyModes[mode]) || !legacyModes[mode].length) {
      errors.push(`legacy-modes.json: mode "${mode}" needs a non-empty list of question ids`);
    }
  });

  Object.entries(legacyModes).forEach(([mode, ids]) => {
    (ids || []).forEach(id => {
      const question = byId.get(id);
      if (!question) {
        errors.push(`legacy-modes.json: mode "${mode}" lists unknown question "${id}"`);
      } else if (question.audience !== "core" || (mode !== "ALL" && question.level !== mode)) {
        errors.push(`legacy-modes.json: mode "${mode}" lists "${id}", which is not a core ${mode === "ALL" ? "" : `${mode} `}question`);
      }
    });
  });

  if (errors.length) {
    const error = new Error(`Content in ${contentDir} is invalid:\n- ${errors.join("\n- ")}`);
    error.contentErrors = errors;
    throw error;
  }

  return {
    framework: ontology.framework || null,
    levels: catalog.levels,
    audiences: catalog.audiences,
    nodes,
    outcomes,
    questions,
    legacyModes
  };
}

module.exports = {
  loadContent,
  DEFAULT_CONTENT_DIR
};
