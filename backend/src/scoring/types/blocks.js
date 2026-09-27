// Block programming (Scratch-like): the student finishes a partly built block
// program so a sprite does its job on a small grid, runs it as often as they
// like, and submits it. The server marks it by running it itself.
//
// The block language lives in web/lib/blocks-engine.js, which the student page
// also loads to animate the stage. Both sides run the same file, so the
// animation and the mark cannot disagree; only the server's run counts. A
// program is a tree of plain objects, never code, and nothing is evaluated.
//
// Content shape:
//   world          "maze" (see WORLDS in the engine)
//   example        public: the stage the student sees and runs, { grid,
//                  start: { x, y, facing }, expect }
//   cases          secret: more stages the program is marked on, never sent
//                  to students. May be empty (a one-grid puzzle).
//   startProgram   public: { scripts } with the given blocks marked
//                  "locked": true (and "editable": true where the student
//                  may still change a field, such as a repeat count)
//   toolbox        public: the block types the student may add
//   variables      optional, public: variable names, each starting at 0
//   stepLimit      optional, public: steps before a run is stopped
//                  (default 500)
//   maxBlocks      optional, public: most blocks the running script may use
//   showPython     optional, public: offer "Show my program as Python"
//   hiddenCases    never in content: the public projection adds the number
//                  of cases, so the page can say how many grids it is
//                  also tried on
//   solution       secret: a reference program; validation runs it on every
//                  stage and it must pass them all
//   marking: { partial: "cases" }
//                  optional; credit for the share of stages passed. The
//                  default is all or nothing.
//
// The response is a program in the same shape. Marking first checks that it
// keeps the given blocks where the starting program has them and uses only
// offered blocks (the editor enforces this; the server checks it again, since
// a request can carry anything), then runs it on the example and every case.

const engine = require("../../../../web/lib/blocks-engine");

const MAX_CASES = 10;
const MAX_VARIABLES = 4;

// The starting program with its locked flags, checked once per question.
const startCache = new WeakMap();

function startProgram(question) {
  if (!startCache.has(question)) {
    startCache.set(question, engine.normalizeWorkspace(question.startProgram, {
      world: question.world,
      variables: question.variables || [],
      keepFlags: true
    }));
  }
  return startCache.get(question);
}

function stagesOf(question) {
  return [question.example].concat(question.cases || []);
}

function runConfig(question) {
  return {
    world: question.world,
    variables: question.variables || [],
    stepLimit: question.stepLimit || engine.LIMITS.defaultStepLimit,
    maxBlocks: question.maxBlocks || null
  };
}

// The locked blocks must form the top of each stack they are in, and an
// unlocked block holds only unlocked blocks. That is what the editor can keep
// fixed: it will not slot a block in above a block that cannot move.
function lockingProblems(workspace) {
  const problems = [];
  const main = engine.mainScript(workspace);

  if (!main || !main.locked) {
    problems.push("blocks startProgram needs exactly one \"when_run\" script, locked");
  }

  function stack(first, parentLocked, where) {
    let seenUnlocked = false;

    for (let block = first; block; block = block.next) {
      if (block.locked && (!parentLocked || seenUnlocked)) {
        problems.push(`blocks startProgram: the locked "${block.type}" at ${where} sits under or inside an unlocked block`);
      }
      if (block.editable && !block.locked) {
        problems.push(`blocks startProgram: "editable" only applies to locked blocks (${block.type} at ${where})`);
      }
      if (!block.locked) {
        seenUnlocked = true;
      }

      Object.keys(block.inputs || {}).forEach(name => stack(block.inputs[name], Boolean(block.locked), `${where} > ${name}`));
    }
  }

  workspace.scripts.forEach((script, i) => stack(script, script.type === "when_run", `script ${i + 1}`));
  return problems;
}

module.exports = {
  type: "blocks",
  status: "active",
  label: "Block program",

  // hiddenCases (how many more stages it is marked on, not what they are)
  // comes from projectPublic; cases and solution never leave the server.
  publicFields: ["world", "example", "startProgram", "toolbox", "variables", "stepLimit", "maxBlocks", "showPython", "hiddenCases"],

  projectPublic(question) {
    return { ...question, hiddenCases: Array.isArray(question.cases) ? question.cases.length : 0 };
  },

  sample: {
    id: "SAMPLE-BLOCKS",
    type: "blocks",
    audience: "core",
    level: "P5",
    title: "Sample",
    prompt: "Add blocks so the sprite reaches the flag.",
    world: "maze",
    example: { grid: ["....G"], start: { x: 0, y: 0, facing: "east" }, expect: { reachGoal: true } },
    cases: [{ grid: ["...G"], start: { x: 0, y: 0, facing: "east" }, expect: { reachGoal: true } }],
    startProgram: {
      scripts: [{ type: "when_run", locked: true, next: { type: "repeat_until", locked: true, inputs: { UNTIL: { type: "at_goal", locked: true } } } }]
    },
    toolbox: ["move_forward", "turn_left", "turn_right"],
    solution: {
      scripts: [{ type: "when_run", next: { type: "repeat_until", inputs: { UNTIL: { type: "at_goal" }, DO: { type: "move_forward" } } } }]
    },
    points: 3,
    difficulty: 1,
    ontology: ["concept.loops"],
    outcomes: ["LO-TRACE-1"]
  },

  validate(question) {
    const errors = [];
    const world = engine.WORLDS[question.world];

    if (!world) {
      return [`blocks world must be one of ${Object.keys(engine.WORLDS).join(", ")}`];
    }

    errors.push(...world.validateStage(question.example, "blocks example"));

    if (question.cases !== undefined && (!Array.isArray(question.cases) || question.cases.length > MAX_CASES)) {
      errors.push(`blocks cases must be a list of at most ${MAX_CASES} stages`);
    } else {
      (question.cases || []).forEach((stage, i) => errors.push(...world.validateStage(stage, `blocks cases[${i}]`)));
    }

    const variables = question.variables;

    if (variables !== undefined && (!Array.isArray(variables) || variables.length > MAX_VARIABLES ||
      variables.some(name => typeof name !== "string" || !engine.VARIABLE_NAME.test(name)) || new Set(variables).size !== variables.length)) {
      errors.push(`blocks variables must be up to ${MAX_VARIABLES} distinct lower-case names`);
    }

    const available = new Set(engine.blocksForWorld(question.world));
    const toolbox = question.toolbox;

    if (!Array.isArray(toolbox) || !toolbox.length || new Set(toolbox).size !== toolbox.length) {
      errors.push("blocks toolbox must list one or more distinct block types");
    } else {
      toolbox.filter(type => !available.has(type) || type === "when_run").forEach(type => {
        errors.push(`blocks toolbox block "${type}" does not exist in the ${question.world} world, or cannot be offered`);
      });
      if (!(variables || []).length && toolbox.some(type => engine.BLOCKS[type] && engine.BLOCKS[type].fields && engine.BLOCKS[type].fields.VAR)) {
        errors.push("blocks toolbox offers a variable block but the question has no variables");
      }
    }

    const { LIMITS } = engine;

    if (question.stepLimit !== undefined && (!Number.isInteger(question.stepLimit) || question.stepLimit < LIMITS.minStepLimit || question.stepLimit > LIMITS.maxStepLimit)) {
      errors.push(`blocks stepLimit must be a whole number from ${LIMITS.minStepLimit} to ${LIMITS.maxStepLimit}`);
    }

    if (question.maxBlocks !== undefined && (!Number.isInteger(question.maxBlocks) || question.maxBlocks < 1 || question.maxBlocks > 100)) {
      errors.push("blocks maxBlocks must be a whole number from 1 to 100");
    }

    if (question.showPython !== undefined && typeof question.showPython !== "boolean") {
      errors.push("blocks showPython must be true or false");
    }

    const marking = question.marking;

    if (marking !== undefined && (!marking || typeof marking !== "object" || Object.keys(marking).some(key => key !== "partial") || marking.partial !== "cases")) {
      errors.push("blocks marking may only be { \"partial\": \"cases\" }");
    }

    if (errors.length) {
      return errors;
    }

    const start = startProgram(question);

    if (start.error) {
      return [`blocks startProgram: ${start.error}`];
    }

    errors.push(...lockingProblems(start.value));

    const solution = engine.normalizeWorkspace(question.solution, { world: question.world, variables: variables || [] });

    if (solution.error) {
      errors.push(`blocks solution: ${solution.error}`);
      return errors;
    }

    if (errors.length) {
      return errors;
    }

    engine.checkScaffold(start.value, solution.value, toolbox).problems
      .forEach(problem => errors.push(`blocks solution: ${problem}`));

    const config = runConfig(question);
    const stages = stagesOf(question);
    const solved = engine.runAll(solution.value, stages, config);

    solved.outcomes.forEach((outcome, i) => {
      if (outcome !== "passed") {
        errors.push(`blocks solution fails ${i === 0 ? "the example" : `cases[${i - 1}]`}: ${engine.OUTCOME_TEXT[outcome] || outcome}`);
      }
    });

    const unchanged = engine.runAll(engine.strip(start.value), stages, config);

    if (unchanged.passed === unchanged.total) {
      errors.push("blocks startProgram already passes every stage; leave a gap for the student");
    }

    return errors;
  },

  // raw: a program. Null unless it is well formed for this question.
  normalizeResponse(raw, question) {
    const result = engine.normalizeWorkspace(raw, { world: question.world, variables: question.variables || [] });
    return result.error ? null : result.value;
  },

  recordResponse(_question, response) {
    return response;
  },

  score(question, response) {
    const max = question.points;

    if (response === null) {
      return { status: "scored", earned: 0, max, correct: false, detail: null };
    }

    const scaffold = engine.checkScaffold(startProgram(question).value, response, question.toolbox);

    if (scaffold.problems.length) {
      return { status: "scored", earned: 0, max, correct: false, detail: { rejected: scaffold.problems.slice(0, 5) } };
    }

    const result = engine.runAll(response, stagesOf(question), runConfig(question));
    const correct = result.passed === result.total;
    const partial = question.marking && question.marking.partial === "cases";
    const detail = { cases: { passed: result.passed, total: result.total }, outcomes: result.outcomes };

    if (correct) {
      return { status: "scored", earned: max, max, correct: true, detail };
    }

    if (!partial) {
      return { status: "scored", earned: 0, max, correct: false, detail };
    }

    // Short of full marks for anything short of every stage, as for the
    // other partial-credit types.
    const earned = Math.max(0, Math.min(max - 1, Math.floor((max * result.passed) / result.total)));
    return { status: "scored", earned, max, correct: false, detail: { ...detail, partial: { casesPassed: result.passed, casesTotal: result.total } } };
  },

  engine
};
