// The block language used by "blocks" questions: which blocks exist, what a
// program looks like, how it runs on a world, and how it reads as text or
// Python. One file, loaded by both sides: the student page runs it to animate
// the stage, and the server requires it to mark (backend/src/scoring/types/
// blocks.js). Because both sides run this same code, the animation a student
// watches and the result the server records cannot disagree. The server's
// result is the one that counts.
//
// Nothing here evaluates code. A program is data: a tree of plain objects,
// checked against the block list below before it is run, and walked by a
// small interpreter with a step limit.
//
// A program (a "workspace") is { scripts: [block, ...] }. A block is
//   { type, fields?: { NAME: value }, inputs?: { NAME: block }, next?: block }
// plus, on the client only, id (for highlighting), locked, editable and
// shadow. Only the script under the "when Run clicked" block runs; loose
// blocks elsewhere are ignored, as in Scratch.
//
// Worlds: the blocks that act on the world (move, turn, sensors) belong to
// it, and WORLDS says how a stage is built, drawn and checked. The MVP has
// one, "maze": a sprite on a grid. A new world adds an entry to WORLDS and its
// blocks to BLOCKS; the control, operator and variable blocks are shared.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CTQuestBlocks = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LIMITS = {
    maxBlocks: 300,       // blocks in a whole workspace
    maxDepth: 40,         // nesting of inputs inside inputs
    maxScripts: 30,       // top-level stacks
    maxIdLength: 40,
    defaultStepLimit: 500,
    minStepLimit: 50,
    maxStepLimit: 5000,
    maxNumber: 1000000    // numbers are clamped to plus or minus this
  };

  // kind: "hat" (starts a script), "statement" (stacks), "boolean" or
  // "number" (reporters that plug into an input).
  // message: the block's words, with %NAME where a field or input goes.
  // fields: int { min, max, default }, choice { options }, variable.
  // inputs: "statement", "boolean" or "number"; shadow is the default a
  // toolbox block carries in that slot.
  const BLOCKS = {
    when_run: { kind: "hat", category: "events", message: "when Run clicked" },

    move_forward: { kind: "statement", category: "motion", world: "maze", message: "move forward" },
    turn_left: { kind: "statement", category: "motion", world: "maze", message: "turn left ↺" },
    turn_right: { kind: "statement", category: "motion", world: "maze", message: "turn right ↻" },
    pick_up: { kind: "statement", category: "motion", world: "maze", message: "pick up star" },
    path_ahead: { kind: "boolean", category: "sensing", world: "maze", message: "path ahead?" },
    path_left: { kind: "boolean", category: "sensing", world: "maze", message: "path to the left?" },
    path_right: { kind: "boolean", category: "sensing", world: "maze", message: "path to the right?" },
    at_goal: { kind: "boolean", category: "sensing", world: "maze", message: "at the flag?" },
    on_star: { kind: "boolean", category: "sensing", world: "maze", message: "on a star?" },

    say: {
      kind: "statement", category: "looks", message: "say %VALUE",
      inputs: { VALUE: { kind: "number", shadow: { type: "number", fields: { NUM: 0 } } } }
    },

    repeat_times: {
      kind: "statement", category: "control", message: "repeat %TIMES times %DO",
      fields: { TIMES: { kind: "int", min: 0, max: 20, default: 4 } },
      inputs: { DO: { kind: "statement" } }
    },
    repeat_until: {
      kind: "statement", category: "control", message: "repeat until %UNTIL %DO",
      inputs: { UNTIL: { kind: "boolean" }, DO: { kind: "statement" } }
    },
    if_then: {
      kind: "statement", category: "control", message: "if %IF then %THEN",
      inputs: { IF: { kind: "boolean" }, THEN: { kind: "statement" } }
    },
    if_else: {
      kind: "statement", category: "control", message: "if %IF then %THEN else %ELSE",
      inputs: { IF: { kind: "boolean" }, THEN: { kind: "statement" }, ELSE: { kind: "statement" } }
    },

    not: { kind: "boolean", category: "operators", message: "not %BOOL", inputs: { BOOL: { kind: "boolean" } } },
    and: { kind: "boolean", category: "operators", message: "%A and %B", inputs: { A: { kind: "boolean" }, B: { kind: "boolean" } } },
    or: { kind: "boolean", category: "operators", message: "%A or %B", inputs: { A: { kind: "boolean" }, B: { kind: "boolean" } } },
    compare: {
      kind: "boolean", category: "operators", message: "%A %OP %B",
      fields: { OP: { kind: "choice", options: ["=", "<", ">"] } },
      inputs: {
        A: { kind: "number", shadow: { type: "number", fields: { NUM: 0 } } },
        B: { kind: "number", shadow: { type: "number", fields: { NUM: 0 } } }
      }
    },
    arith: {
      kind: "number", category: "operators", message: "%A %OP %B",
      fields: { OP: { kind: "choice", options: ["+", "-", "×"] } },
      inputs: {
        A: { kind: "number", shadow: { type: "number", fields: { NUM: 0 } } },
        B: { kind: "number", shadow: { type: "number", fields: { NUM: 0 } } }
      }
    },
    number: { kind: "number", category: "operators", message: "%NUM", fields: { NUM: { kind: "int", min: -999, max: 999, default: 0 } } },

    get_var: { kind: "number", category: "variables", message: "%VAR", fields: { VAR: { kind: "variable" } } },
    set_var: {
      kind: "statement", category: "variables", message: "set %VAR to %VALUE",
      fields: { VAR: { kind: "variable" } },
      inputs: { VALUE: { kind: "number", shadow: { type: "number", fields: { NUM: 0 } } } }
    },
    change_var: {
      kind: "statement", category: "variables", message: "change %VAR by %BY",
      fields: { VAR: { kind: "variable" } },
      inputs: { BY: { kind: "number", shadow: { type: "number", fields: { NUM: 1 } } } }
    }
  };

  const STACKING = new Set(["hat", "statement"]);
  const FACINGS = ["north", "east", "south", "west"];
  const STEP = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
  const VARIABLE_NAME = /^[a-z][a-z0-9_]{0,19}$/;
  const PYTHON_WORDS = new Set(["and", "or", "not", "if", "else", "for", "while", "in", "is", "def", "return", "pass", "print", "range", "true", "false", "none"]);

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function clampNumber(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(-LIMITS.maxNumber, Math.min(LIMITS.maxNumber, value));
  }

  function blocksForWorld(world) {
    return Object.keys(BLOCKS).filter(type => !BLOCKS[type].world || BLOCKS[type].world === world);
  }

  // ---------- Worlds ----------

  function cellAt(stage, x, y) {
    if (y < 0 || y >= stage.grid.length || x < 0 || x >= stage.grid[0].length) {
      return "#";
    }
    return stage.grid[y][x];
  }

  function turned(facing, by) {
    return FACINGS[(FACINGS.indexOf(facing) + by + 4) % 4];
  }

  const WORLDS = {
    // A sprite on a grid of cells: "#" wall, "." floor, "G" the flag, "*" a
    // star. Outside the grid counts as wall. The sprite starts at
    // start { x, y, facing }; x counts columns from 0 on the left, y rows
    // from 0 at the top. Moving into a wall stops the program (a crash).
    // expect says what counts as passing when the program ends:
    //   reachGoal: true   the sprite ends on the flag
    //   collectAll: true  every star has been picked up
    //   say: "3"          the last thing said
    maze: {
      label: "Maze",

      validateStage(stage, where) {
        const errors = [];

        if (!isObject(stage)) {
          return [`${where} must be an object`];
        }

        const grid = stage.grid;

        if (!Array.isArray(grid) || grid.length < 1 || grid.length > 12 || grid.some(row => typeof row !== "string")) {
          return [`${where}.grid must be 1 to 12 strings`];
        }

        const width = grid[0].length;

        if (width < 2 || width > 12 || grid.some(row => row.length !== width)) {
          errors.push(`${where}.grid rows must all be 2 to 12 characters long`);
        }

        if (grid.some(row => /[^#.G*]/.test(row))) {
          errors.push(`${where}.grid may only use "#", ".", "G" and "*"`);
        }

        const goals = grid.join("").split("G").length - 1;
        const stars = grid.join("").split("*").length - 1;

        if (goals > 1) {
          errors.push(`${where}.grid has more than one flag (G)`);
        }

        const start = stage.start;

        if (!isObject(start) || !Number.isInteger(start.x) || !Number.isInteger(start.y) || !FACINGS.includes(start.facing)) {
          errors.push(`${where}.start needs integer x and y and a facing of ${FACINGS.join(", ")}`);
        } else if (!errors.length && cellAt(stage, start.x, start.y) === "#") {
          errors.push(`${where}.start is on a wall or outside the grid`);
        }

        const expect = stage.expect;
        const known = ["reachGoal", "collectAll", "say"];

        if (!isObject(expect) || !Object.keys(expect).length || Object.keys(expect).some(key => !known.includes(key))) {
          errors.push(`${where}.expect needs one or more of ${known.join(", ")}`);
        } else {
          if (expect.reachGoal !== undefined && (expect.reachGoal !== true || goals !== 1)) {
            errors.push(`${where}.expect.reachGoal must be true, and the grid needs a flag (G)`);
          }
          if (expect.collectAll !== undefined && (expect.collectAll !== true || stars < 1)) {
            errors.push(`${where}.expect.collectAll must be true, and the grid needs a star (*)`);
          }
          if (expect.say !== undefined && (typeof expect.say !== "string" || !expect.say.length || expect.say.length > 30)) {
            errors.push(`${where}.expect.say must be a short string`);
          }
        }

        return errors;
      },

      createState(stage) {
        return {
          x: stage.start.x,
          y: stage.start.y,
          facing: stage.start.facing,
          collected: [],
          said: null
        };
      },

      snapshot(state) {
        return { x: state.x, y: state.y, facing: state.facing, collected: state.collected.length, said: state.said };
      },

      // Returns the frame event, or throws a stop for a crash.
      act(type, state, stage) {
        if (type === "move_forward") {
          const [dx, dy] = STEP[state.facing];
          if (cellAt(stage, state.x + dx, state.y + dy) === "#") {
            return "crash";
          }
          state.x += dx;
          state.y += dy;
          return "move";
        }

        if (type === "turn_left" || type === "turn_right") {
          state.facing = turned(state.facing, type === "turn_left" ? -1 : 1);
          return "turn";
        }

        if (type === "pick_up") {
          const key = `${state.x},${state.y}`;
          if (cellAt(stage, state.x, state.y) === "*" && !state.collected.includes(key)) {
            state.collected.push(key);
            return "pickup";
          }
          return "pickup-nothing";
        }

        return null;
      },

      sense(type, state, stage) {
        const look = by => {
          const [dx, dy] = STEP[turned(state.facing, by)];
          return cellAt(stage, state.x + dx, state.y + dy) !== "#";
        };

        switch (type) {
          case "path_ahead": return look(0);
          case "path_left": return look(-1);
          case "path_right": return look(1);
          case "at_goal": return cellAt(stage, state.x, state.y) === "G";
          case "on_star": return cellAt(stage, state.x, state.y) === "*" && !state.collected.includes(`${state.x},${state.y}`);
          default: return false;
        }
      },

      // Why a finished program failed, or null when it passed.
      check(expect, state, stage) {
        if (expect.reachGoal && cellAt(stage, state.x, state.y) !== "G") {
          return "not-at-goal";
        }
        if (expect.collectAll) {
          const stars = stage.grid.join("").split("*").length - 1;
          if (state.collected.length < stars) {
            return "stars-left";
          }
        }
        if (expect.say !== undefined && state.said !== expect.say) {
          return "wrong-say";
        }
        return null;
      }
    }
  };

  const OUTCOME_TEXT = {
    passed: "Passed",
    crashed: "Bumped into a wall",
    "step-limit": "Ran out of steps (it may loop forever)",
    "not-at-goal": "Finished away from the flag",
    "stars-left": "Left stars behind",
    "wrong-say": "Said the wrong thing at the end",
    "no-program": "No blocks under \"when Run clicked\"",
    "too-many-blocks": "Used more blocks than allowed"
  };

  // ---------- Checking a program's shape ----------

  // Checks raw data against BLOCKS and returns a clean copy, or
  // { error } for anything that is not a well-formed program.
  // options: world, variables (the names a variable field may use),
  // keepIds (keep block ids, for highlighting), keepFlags (keep locked,
  // editable and shadow, for loading into the editor).
  function normalizeWorkspace(raw, options) {
    const opts = options || {};
    const variables = new Set(opts.variables || []);
    const counter = { blocks: 0 };

    if (!isObject(raw) || !Array.isArray(raw.scripts)) {
      return { error: "a program must be { scripts: [...] }" };
    }

    if (raw.scripts.length > LIMITS.maxScripts) {
      return { error: `a program may have at most ${LIMITS.maxScripts} scripts` };
    }

    function fail(message) {
      throw new Error(message);
    }

    function one(rawBlock, want, depth) {
      if (!isObject(rawBlock)) {
        fail("each block must be an object");
      }
      if (depth > LIMITS.maxDepth) {
        fail(`blocks may be nested at most ${LIMITS.maxDepth} deep`);
      }

      counter.blocks += 1;
      if (counter.blocks > LIMITS.maxBlocks) {
        fail(`a program may have at most ${LIMITS.maxBlocks} blocks`);
      }

      const type = rawBlock.type;
      const def = typeof type === "string" && Object.prototype.hasOwnProperty.call(BLOCKS, type) ? BLOCKS[type] : null;

      if (!def) {
        fail(`unknown block "${String(type).slice(0, 40)}"`);
      }
      if (def.world && def.world !== opts.world) {
        fail(`block "${type}" is not part of the ${opts.world} world`);
      }
      if (want === "statement" ? def.kind !== "statement" : want === "top" ? false : def.kind !== want) {
        fail(`block "${type}" cannot go where a ${want === "statement" ? "stacking" : want} block goes`);
      }

      const block = { type };

      if (opts.keepIds && typeof rawBlock.id === "string" && rawBlock.id.length <= LIMITS.maxIdLength) {
        block.id = rawBlock.id;
      }
      if (opts.keepFlags) {
        ["locked", "editable", "shadow"].forEach(flag => {
          if (rawBlock[flag] === true) {
            block[flag] = true;
          }
        });
      }

      const rawFields = isObject(rawBlock.fields) ? rawBlock.fields : {};
      Object.keys(def.fields || {}).forEach(name => {
        const spec = def.fields[name];
        let value = rawFields[name];

        if (spec.kind === "int") {
          value = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
          if (value === undefined) {
            value = spec.default;
          }
          if (!Number.isInteger(value) || value < spec.min || value > spec.max) {
            fail(`${type}.${name} must be a whole number from ${spec.min} to ${spec.max}`);
          }
        } else if (spec.kind === "choice") {
          if (value === undefined) {
            value = spec.options[0];
          }
          if (!spec.options.includes(value)) {
            fail(`${type}.${name} must be one of ${spec.options.join(" ")}`);
          }
        } else if (spec.kind === "variable") {
          if (typeof value !== "string" || !variables.has(value)) {
            fail(`${type}.${name} names a variable this question does not have`);
          }
        }

        block.fields = block.fields || {};
        block.fields[name] = value;
      });

      const rawInputs = isObject(rawBlock.inputs) ? rawBlock.inputs : {};
      Object.keys(def.inputs || {}).forEach(name => {
        const child = rawInputs[name];
        if (child === undefined || child === null) {
          return;
        }
        const kind = def.inputs[name].kind;
        block.inputs = block.inputs || {};
        block.inputs[name] = kind === "statement" ? chain(child, depth + 1) : one(child, kind, depth + 1);
      });

      return block;
    }

    // A stack: the first block and everything hanging off .next, walked in a
    // loop so a long stack does not deepen the recursion.
    function chain(rawFirst, depth, top) {
      const first = one(rawFirst, top ? "top" : "statement", depth);
      let tail = first;
      let rawTail = rawFirst;

      while (rawTail.next !== undefined && rawTail.next !== null) {
        if (!STACKING.has(BLOCKS[tail.type].kind)) {
          fail(`block "${tail.type}" cannot have a block under it`);
        }
        rawTail = rawTail.next;
        tail.next = one(rawTail, "statement", depth);
        tail = tail.next;
      }

      return first;
    }

    try {
      return { value: { scripts: raw.scripts.map(script => chain(script, 0, true)) } };
    } catch (error) {
      return { error: error.message };
    }
  }

  // The same program without ids or flags: what the server stores, and what
  // two programs are compared by.
  function strip(workspace) {
    return JSON.parse(JSON.stringify(workspace, (key, value) => (["id", "locked", "editable", "shadow"].includes(key) ? undefined : value)));
  }

  function walkBlock(block, visit) {
    for (let current = block; current; current = current.next) {
      visit(current);
      Object.keys(current.inputs || {}).forEach(name => walkBlock(current.inputs[name], visit));
    }
  }

  function walkWorkspace(workspace, visit) {
    ((workspace && workspace.scripts) || []).forEach(script => walkBlock(script, visit));
  }

  function countBlocks(block) {
    let count = 0;
    walkBlock(block, () => { count += 1; });
    return count;
  }

  // The script that runs: the one topped by "when Run clicked". Null unless
  // there is exactly one.
  function mainScript(workspace) {
    const hats = ((workspace && workspace.scripts) || []).filter(script => script.type === "when_run");
    return hats.length === 1 ? hats[0] : null;
  }

  // Blocks in the running script, not counting the hat.
  function blocksUsed(workspace) {
    const script = mainScript(workspace);
    return script ? countBlocks(script) - 1 : 0;
  }

  // ---------- The given blocks ----------

  // Checks that a program keeps the question's locked blocks where the
  // starting program put them, and uses only blocks the question offers.
  // This is the rule the editor enforces (a locked block cannot be moved,
  // deleted or edited, and nothing can be slotted in above one), applied
  // again on the server to whatever was submitted:
  //   in each stack, the locked blocks at its top are the same blocks, in
  //   the same places, with the same field values unless marked editable;
  //   a locked block's inputs follow the same rule, and a locked block
  //   plugged into an input must still be there;
  //   every other block is in the toolbox, or was one of the unlocked
  //   blocks in the starting program.
  // Returns { problems, locked } where locked maps each of the program's
  // blocks that stands for a locked starting block to that block (the
  // editor re-locks them when it loads a saved answer).
  function checkScaffold(start, program, toolbox) {
    const problems = [];
    const locked = new Map();
    const allowed = new Set(toolbox || []);

    walkWorkspace(start, block => {
      if (!block.locked) {
        allowed.add(block.type);
      }
    });

    function sameBlock(given, got, where) {
      if (!got || got.type !== given.type) {
        problems.push(`${where}: the given "${given.type}" block is missing or was replaced`);
        return;
      }

      locked.set(got, given);

      if (!given.editable) {
        Object.keys(given.fields || {}).forEach(name => {
          if ((got.fields || {})[name] !== given.fields[name]) {
            problems.push(`${where}: the given "${given.type}" block was edited`);
          }
        });
      }

      Object.keys(given.inputs || {}).forEach(name => {
        const kind = BLOCKS[given.type].inputs[name].kind;
        const inner = given.inputs[name];
        const gotInner = (got.inputs || {})[name];

        if (kind === "statement") {
          sameStack(inner, gotInner, `${where} > ${name}`);
        } else if (inner.locked) {
          sameBlock(inner, gotInner, `${where} > ${name}`);
        }
      });
    }

    function sameStack(given, got, where) {
      let n = 0;
      for (let a = given, b = got; a && a.locked; a = a.next, b = b && b.next, n += 1) {
        sameBlock(a, b, `${where} [${n + 1}]`);
      }
    }

    const givenMain = mainScript(start);
    const gotMain = mainScript(program);

    if (!gotMain) {
      problems.push("there must be exactly one \"when Run clicked\" script");
      return { problems, locked };
    }

    if (givenMain) {
      sameStack(givenMain, gotMain, "main script");
    }

    walkBlock(gotMain, block => {
      if (!locked.has(block) && !allowed.has(block.type)) {
        problems.push(`the "${block.type}" block is not offered in this question`);
      }
    });

    return { problems: Array.from(new Set(problems)), locked };
  }

  // ---------- Running ----------

  function Stop(outcome) {
    this.outcome = outcome;
  }

  // Runs the main script on one stage. Returns
  //   { outcome, steps, state, frames }
  // outcome is "passed" or a failure reason (see OUTCOME_TEXT). frames, when
  // options.record is set, list each thing the sprite did, for animation:
  //   { event, block, step, x, y, facing, collected, said }
  // Every block run costs a step, and so does every pass round a loop, so a
  // loop with nothing inside it still runs out of steps.
  function run(workspace, stage, options) {
    const opts = options || {};
    const world = WORLDS[opts.world || "maze"];
    const stepLimit = opts.stepLimit || LIMITS.defaultStepLimit;
    const state = world.createState(stage);
    // No prototype, so a variable called "constructor" is just a number.
    const vars = Object.create(null);
    const frames = [];
    let steps = 0;

    (opts.variables || []).forEach(name => { vars[name] = 0; });

    function tick() {
      steps += 1;
      if (steps > stepLimit) {
        throw new Stop("step-limit");
      }
    }

    function record(event, block) {
      if (opts.record) {
        frames.push({ event, block: block.id || null, step: steps, ...world.snapshot(state) });
      }
    }

    function number(block) {
      if (!block) {
        return 0;
      }
      switch (block.type) {
        case "number": return block.fields.NUM;
        case "get_var": return vars[block.fields.VAR] || 0;
        case "arith": {
          const a = number(block.inputs && block.inputs.A);
          const b = number(block.inputs && block.inputs.B);
          const op = block.fields.OP;
          return clampNumber(op === "+" ? a + b : op === "-" ? a - b : a * b);
        }
        default: return 0;
      }
    }

    function truth(block) {
      if (!block) {
        return false;
      }
      const inputs = block.inputs || {};
      switch (block.type) {
        case "not": return !truth(inputs.BOOL);
        case "and": return truth(inputs.A) && truth(inputs.B);
        case "or": return truth(inputs.A) || truth(inputs.B);
        case "compare": {
          const a = number(inputs.A);
          const b = number(inputs.B);
          const op = block.fields.OP;
          return op === "=" ? a === b : op === "<" ? a < b : a > b;
        }
        default: return world.sense(block.type, state, stage);
      }
    }

    function stack(first) {
      for (let block = first; block; block = block.next) {
        statement(block);
      }
    }

    function statement(block) {
      tick();
      const inputs = block.inputs || {};

      switch (block.type) {
        case "when_run":
          return;
        case "repeat_times":
          for (let i = 0; i < block.fields.TIMES; i += 1) {
            if (i > 0) {
              tick();
            }
            stack(inputs.DO);
          }
          return;
        case "repeat_until":
          while (!truth(inputs.UNTIL)) {
            stack(inputs.DO);
            tick();
          }
          return;
        case "if_then":
          if (truth(inputs.IF)) {
            stack(inputs.THEN);
          }
          return;
        case "if_else":
          stack(truth(inputs.IF) ? inputs.THEN : inputs.ELSE);
          return;
        case "say":
          state.said = inputs.VALUE ? String(number(inputs.VALUE)) : "";
          record("say", block);
          return;
        case "set_var":
          vars[block.fields.VAR] = number(inputs.VALUE);
          return;
        case "change_var":
          vars[block.fields.VAR] = clampNumber((vars[block.fields.VAR] || 0) + number(inputs.BY));
          return;
        default: {
          const event = world.act(block.type, state, stage);
          if (event === "crash") {
            record("crash", block);
            throw new Stop("crashed");
          }
          if (event) {
            record(event, block);
          }
        }
      }
    }

    const script = mainScript(workspace);

    if (!script) {
      return { outcome: "no-program", steps, state, frames };
    }

    let outcome;

    try {
      stack(script);
      outcome = world.check(stage.expect, state, stage) || "passed";
    } catch (error) {
      if (!(error instanceof Stop)) {
        throw error;
      }
      outcome = error.outcome;
    }

    return { outcome, steps, state, frames, variables: vars };
  }

  // Runs a program against each stage. config: { world, variables,
  // stepLimit, maxBlocks }. Returns { passed, total, outcomes }.
  function runAll(workspace, stages, config) {
    const tooMany = config.maxBlocks && blocksUsed(workspace) > config.maxBlocks;
    const outcomes = stages.map(stage => (tooMany
      ? "too-many-blocks"
      : run(workspace, stage, { world: config.world, variables: config.variables, stepLimit: config.stepLimit }).outcome));

    return { passed: outcomes.filter(outcome => outcome === "passed").length, total: stages.length, outcomes };
  }

  // ---------- Reading a program as text ----------

  function fill(message, parts) {
    return message.replace(/%([A-Z]+)/g, (_all, name) => (parts[name] !== undefined ? parts[name] : ""))
      .replace(/\s+/g, " ").trim();
  }

  function reporterText(block) {
    if (!block) {
      return "( )";
    }
    const def = BLOCKS[block.type];
    const parts = {};
    Object.keys(def.fields || {}).forEach(name => { parts[name] = String(block.fields[name]); });
    Object.keys(def.inputs || {}).forEach(name => { parts[name] = reporterText(block.inputs && block.inputs[name]); });
    const text = fill(def.message, parts);
    return def.kind === "boolean" ? `<${text}>` : `(${text})`;
  }

  // Scratch-style words, one block a line, indented inside loops and ifs.
  // For the results breakdown and anywhere the editor is not loaded.
  function toText(workspace) {
    const script = mainScript(workspace);
    const lines = [];

    function stackText(first, depth) {
      if (!first) {
        lines.push(`${"  ".repeat(depth)}(nothing)`);
        return;
      }
      for (let block = first; block; block = block.next) {
        const def = BLOCKS[block.type];
        const parts = {};
        Object.keys(def.fields || {}).forEach(name => { parts[name] = String(block.fields[name]); });
        const bodies = [];
        Object.keys(def.inputs || {}).forEach(name => {
          if (def.inputs[name].kind === "statement") {
            parts[name] = "";
            bodies.push(name);
          } else {
            parts[name] = reporterText(block.inputs && block.inputs[name]);
          }
        });

        if (block.type === "if_else") {
          lines.push(`${"  ".repeat(depth)}if ${parts.IF} then`);
          stackText(block.inputs && block.inputs.THEN, depth + 1);
          lines.push(`${"  ".repeat(depth)}else`);
          stackText(block.inputs && block.inputs.ELSE, depth + 1);
        } else {
          lines.push(`${"  ".repeat(depth)}${fill(def.message, parts)}`);
          bodies.forEach(name => stackText(block.inputs && block.inputs[name], depth + 1));
        }
      }
    }

    if (!script) {
      return "(no \"when Run clicked\" script)";
    }

    stackText(script, 0);
    return lines.join("\n");
  }

  // ---------- Reading a program as Python ----------

  function pythonName(name) {
    return PYTHON_WORDS.has(name) ? `${name}_` : name;
  }

  function pythonExpr(block, empty) {
    if (!block) {
      return empty;
    }
    const inputs = block.inputs || {};
    const binary = (a, op, b, emptyValue) => {
      const wrap = inner => (inner && ["and", "or", "compare", "arith"].includes(inner.type) ? `(${pythonExpr(inner, emptyValue)})` : pythonExpr(inner, emptyValue));
      return `${wrap(a)} ${op} ${wrap(b)}`;
    };

    switch (block.type) {
      case "number": return String(block.fields.NUM);
      case "get_var": return pythonName(block.fields.VAR);
      case "arith": return binary(inputs.A, block.fields.OP === "×" ? "*" : block.fields.OP, inputs.B, "0");
      case "compare": return binary(inputs.A, block.fields.OP === "=" ? "==" : block.fields.OP, inputs.B, "0");
      case "and": return binary(inputs.A, "and", inputs.B, "False");
      case "or": return binary(inputs.A, "or", inputs.B, "False");
      case "not": {
        const inner = inputs.BOOL;
        const text = pythonExpr(inner, "False");
        return inner && ["and", "or", "compare"].includes(inner.type) ? `not (${text})` : `not ${text}`;
      }
      default: return `${block.type}()`;
    }
  }

  // The running script as Python, for students who know it. Read-only: it
  // shows what the blocks mean, and nothing ever runs it.
  function toPython(workspace) {
    const script = mainScript(workspace);
    const lines = [];

    function body(first, depth) {
      const before = lines.length;
      for (let block = first; block; block = block.next) {
        line(block, depth);
      }
      if (lines.length === before) {
        lines.push(`${"    ".repeat(depth)}pass`);
      }
    }

    function line(block, depth) {
      const pad = "    ".repeat(depth);
      const inputs = block.inputs || {};

      switch (block.type) {
        case "when_run":
          return;
        case "repeat_times":
          lines.push(`${pad}for _ in range(${block.fields.TIMES}):`);
          body(inputs.DO, depth + 1);
          return;
        case "repeat_until": {
          const condition = inputs.UNTIL;
          const text = pythonExpr(condition, "False");
          lines.push(`${pad}while not ${condition && ["and", "or", "compare"].includes(condition.type) ? `(${text})` : text}:`);
          body(inputs.DO, depth + 1);
          return;
        }
        case "if_then":
          lines.push(`${pad}if ${pythonExpr(inputs.IF, "False")}:`);
          body(inputs.THEN, depth + 1);
          return;
        case "if_else":
          lines.push(`${pad}if ${pythonExpr(inputs.IF, "False")}:`);
          body(inputs.THEN, depth + 1);
          lines.push(`${pad}else:`);
          body(inputs.ELSE, depth + 1);
          return;
        case "say":
          lines.push(`${pad}say(${inputs.VALUE ? pythonExpr(inputs.VALUE, "0") : "\"\""})`);
          return;
        case "set_var":
          lines.push(`${pad}${pythonName(block.fields.VAR)} = ${pythonExpr(inputs.VALUE, "0")}`);
          return;
        case "change_var":
          lines.push(`${pad}${pythonName(block.fields.VAR)} += ${pythonExpr(inputs.BY, "0")}`);
          return;
        default:
          lines.push(`${pad}${block.type}()`);
      }
    }

    if (!script) {
      return "# no \"when Run clicked\" script";
    }

    for (let block = script.next; block; block = block.next) {
      line(block, 0);
    }

    return lines.length ? lines.join("\n") : "# no blocks yet";
  }

  // ---------- Blockly's saved format ----------
  // The editor saves and loads Blockly's JSON state. These two functions
  // turn it into a program and back; they are plain data transforms.

  function fromBlocklyState(state) {
    const top = (state && state.blocks && state.blocks.blocks) || [];

    function convert(raw) {
      if (!isObject(raw)) {
        return null;
      }
      const block = { type: raw.type };
      if (raw.id) {
        block.id = raw.id;
      }
      if (raw.shadow) {
        block.shadow = true;
      }
      if (isObject(raw.fields)) {
        block.fields = { ...raw.fields };
      }
      if (isObject(raw.inputs)) {
        Object.keys(raw.inputs).forEach(name => {
          const slot = raw.inputs[name] || {};
          const child = slot.block ? convert(slot.block) : slot.shadow ? { ...convert(slot.shadow), shadow: true } : null;
          if (child) {
            block.inputs = block.inputs || {};
            block.inputs[name] = child;
          }
        });
      }
      if (raw.next && raw.next.block) {
        block.next = convert(raw.next.block);
      }
      return block;
    }

    return { scripts: top.map(convert).filter(Boolean) };
  }

  // lockedMap: the program's blocks to lock, each mapped to the starting
  // block it stands for (from checkScaffold), or null to use each block's
  // own locked and editable flags (the starting program).
  function toBlocklyState(workspace, lockedMap) {
    function convert(block) {
      const out = { type: block.type };
      const given = lockedMap ? lockedMap.get(block) : block.locked ? block : null;

      if (block.id) {
        out.id = block.id;
      }
      if (given) {
        out.movable = false;
        out.deletable = false;
        out.editable = Boolean(given.editable);
      }
      if (block.fields) {
        out.fields = { ...block.fields };
      }
      const def = BLOCKS[block.type];
      Object.keys(def.inputs || {}).forEach(name => {
        const child = block.inputs && block.inputs[name];
        if (child) {
          out.inputs = out.inputs || {};
          out.inputs[name] = child.shadow ? { shadow: convert(child) } : { block: convert(child) };
        }
      });
      if (block.next) {
        out.next = { block: convert(block.next) };
      }
      return out;
    }

    return {
      blocks: {
        languageVersion: 0,
        blocks: workspace.scripts.map((script, i) => ({ ...convert(script), x: 24, y: 24 + i * 140 }))
      }
    };
  }

  // The toolbox block for a type, with default values in its slots.
  function toolboxBlock(type, variables) {
    const def = BLOCKS[type];
    const block = { kind: "block", type };

    Object.keys(def.fields || {}).forEach(name => {
      if (def.fields[name].kind === "variable" && variables && variables.length) {
        block.fields = block.fields || {};
        block.fields[name] = variables[0];
      }
    });
    Object.keys(def.inputs || {}).forEach(name => {
      const shadow = def.inputs[name].shadow;
      if (shadow) {
        block.inputs = block.inputs || {};
        block.inputs[name] = { shadow: { type: shadow.type, fields: { ...shadow.fields } } };
      }
    });

    return block;
  }

  return {
    LIMITS,
    BLOCKS,
    WORLDS,
    OUTCOME_TEXT,
    FACINGS,
    VARIABLE_NAME,
    blocksForWorld,
    normalizeWorkspace,
    strip,
    walkWorkspace,
    mainScript,
    blocksUsed,
    checkScaffold,
    run,
    runAll,
    toText,
    toPython,
    fromBlocklyState,
    toBlocklyState,
    toolboxBlock
  };
}));
