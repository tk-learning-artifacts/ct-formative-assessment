// Block programming renderer. The question card shows the stage (the example
// grid) with Run and Reset; the answer card holds a Blockly editor with the
// starting program, its given blocks locked, and a toolbox of the blocks the
// question offers. Run animates the program on the stage using the shared
// engine (lib/blocks-engine.js), which is also what the server marks with.
//
// Blockly (vendor/blockly-13.3.0/) is loaded the first time a block question
// is shown, so other questions never download it. The page rebuilds a
// question's HTML on every render, so editors are mounted by watching the
// document for their placeholders and disposed of when those leave it.
// After each change the widget fires a bubbling "change", which the page
// listens for to save the answer.

(function () {
  const BLOCKLY_DIR = "/vendor/blockly-13.3.0/";
  const CELL = 40;
  const STEP_MS = 320;

  // Scratch's category hues, darkened so white text on each clears 4.5:1.
  const COLOURS = {
    events: "#8F6400",
    motion: "#2F6FD6",
    looks: "#7348C8",
    control: "#B35F00",
    sensing: "#1F7FA8",
    operators: "#2E8540",
    variables: "#B83A5E"
  };

  const EXPECT_TEXT = {
    reachGoal: () => "end on the flag",
    collectAll: () => "pick up every star",
    say: value => `say ${value} at the end`
  };

  const FACING_WORDS = { north: "up", east: "right", south: "down", west: "left" };
  const FACING_DEGREES = { north: -90, east: 0, south: 90, west: 180 };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
  }

  function loadStyle(href) {
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }
  }

  // The engine is small and needed to describe answers in the breakdown, so
  // it loads with the renderer (the registry waits for it). Blockly is big
  // and waits until an editor is shown.
  loadStyle("/lib/blocks.css");
  const engineReady = loadScript("/lib/blocks-engine.js").catch(error => console.error(error));
  let blocklyReady = null;

  function engine() {
    return window.CTQuestBlocks;
  }

  function loadBlockly() {
    if (!blocklyReady) {
      blocklyReady = engineReady
        .then(() => loadScript(`${BLOCKLY_DIR}blockly_compressed.js`))
        .then(() => loadScript(`${BLOCKLY_DIR}msg-en.js`))
        .then(defineBlocks);
    }
    return blocklyReady;
  }

  // ---------- Blockly block definitions, built from the engine's list ----------

  let theme = null;

  function defineBlocks() {
    const { BLOCKS } = engine();
    const Blockly = window.Blockly;

    const definitions = Object.keys(BLOCKS).map(type => {
      const def = BLOCKS[type];
      const args = [];
      const message = def.message.replace(/%([A-Z]+)/g, (_all, name) => {
        const field = def.fields && def.fields[name];
        const input = def.inputs && def.inputs[name];

        if (field && field.kind === "int") {
          args.push({ type: "field_number", name, value: field.default, min: field.min, max: field.max, precision: 1 });
        } else if (field && field.kind === "choice") {
          args.push({ type: "field_dropdown", name, options: field.options.map(option => [option, option]) });
        } else if (field && field.kind === "variable") {
          // Filled per question: the dropdown lists that question's names.
          args.push({ type: "field_dropdown", name, options: blockVariableOptions });
        } else if (input && input.kind === "statement") {
          args.push({ type: "input_statement", name });
        } else if (input) {
          args.push({ type: "input_value", name, check: input.kind === "boolean" ? "Boolean" : "Number" });
        }

        return `%${args.length}`;
      });

      const json = { type, message0: message, args0: args, colour: COLOURS[def.category], tooltip: "", inputsInline: true };

      if (def.kind === "hat") {
        json.nextStatement = null;
        json.hat = "cap";
      } else if (def.kind === "statement") {
        json.previousStatement = null;
        json.nextStatement = null;
      } else {
        json.output = def.kind === "boolean" ? "Boolean" : "Number";
      }

      return json;
    });

    Blockly.common.defineBlocksWithJsonArray(definitions);

    theme = Blockly.Theme.defineTheme("ctquest-blocks", {
      base: Blockly.Themes.Zelos,
      componentStyles: {
        workspaceBackgroundColour: "#FFFDF7",
        toolboxBackgroundColour: "#F4E9CE",
        flyoutBackgroundColour: "#F4E9CE",
        flyoutOpacity: 1,
        scrollbarColour: "#C9AD6E",
        insertionMarkerColour: "#19222C",
        insertionMarkerOpacity: 0.3,
        cursorColour: "#19222C"
      },
      fontStyle: { family: "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif", weight: "600", size: 12 }
    });
  }

  // The variable dropdown's options come from whichever question is being
  // mounted; Blockly calls this when it builds the field.
  let currentVariables = [];

  function blockVariableOptions() {
    const names = currentVariables.length ? currentVariables : ["n"];
    return names.map(name => [name, name]);
  }

  // ---------- The stage ----------

  function stageSvg(stage, idPrefix) {
    const rows = stage.grid.length;
    const cols = stage.grid[0].length;
    const cells = [];

    stage.grid.forEach((row, y) => {
      Array.from(row).forEach((cell, x) => {
        const px = x * CELL;
        const py = y * CELL;
        cells.push(`<rect class="bk-cell ${cell === "#" ? "bk-cell--wall" : "bk-cell--floor"}" x="${px}" y="${py}" width="${CELL}" height="${CELL}" />`);

        if (cell === "G") {
          cells.push(`
            <g class="bk-flag" transform="translate(${px + 12} ${py + 8})">
              <rect x="0" y="0" width="3" height="25" rx="1" />
              <path d="M3 1 L20 7 L3 13 Z" />
            </g>`);
        }
        if (cell === "*") {
          cells.push(`<path class="bk-star" data-star="${x},${y}" transform="translate(${px + CELL / 2} ${py + CELL / 2})"
            d="M0,-13 L3.8,-4.2 L13,-4 L5.8,2 L8.1,11 L0,6 L-8.1,11 L-5.8,2 L-13,-4 L-3.8,-4.2 Z" />`);
        }
      });
    });

    const start = stage.start;

    return `
      <svg class="bk-stage__svg" viewBox="-2 -2 ${cols * CELL + 4} ${rows * CELL + 4}" role="img" aria-labelledby="${idPrefix}-desc">
        <desc id="${idPrefix}-desc">${escapeHtml(describeStage(stage))}</desc>
        ${cells.join("")}
        <g class="bk-sprite" data-bk-sprite style="transform: translate(${start.x * CELL + CELL / 2}px, ${start.y * CELL + CELL / 2}px)">
          <g class="bk-sprite__body" data-bk-sprite-body style="transform: rotate(${FACING_DEGREES[start.facing]}deg)">
            <circle r="13" />
            <path d="M6 -7 L16 0 L6 7 Z" />
            <circle class="bk-sprite__eye" cx="4" cy="-4" r="2.2" />
            <circle class="bk-sprite__eye" cx="4" cy="4" r="2.2" />
          </g>
          <g class="bk-bubble" data-bk-bubble hidden>
            <rect x="8" y="-38" rx="7" width="40" height="22" />
            <text x="28" y="-23" text-anchor="middle" data-bk-bubble-text></text>
          </g>
        </g>
      </svg>
    `;
  }

  // Words for the grid, for screen readers: size, where the sprite starts,
  // the flag and the stars, counting columns and rows from 1.
  function describeStage(stage) {
    const rows = stage.grid.length;
    const cols = stage.grid[0].length;
    const spots = { G: [], "*": [] };

    stage.grid.forEach((row, y) => Array.from(row).forEach((cell, x) => {
      if (spots[cell]) {
        spots[cell].push(`column ${x + 1} row ${y + 1}`);
      }
    }));

    const parts = [`A grid ${cols} columns wide and ${rows} rows high.`,
      `The sprite starts at column ${stage.start.x + 1} row ${stage.start.y + 1}, facing ${FACING_WORDS[stage.start.facing]}.`];

    if (spots.G.length) {
      parts.push(`The flag is at ${spots.G[0]}.`);
    }
    if (spots["*"].length) {
      parts.push(`Stars at ${spots["*"].join(", ")}.`);
    }

    const walls = stage.grid.map((row, y) => Array.from(row).map((cell, x) => (cell === "#" ? `${x + 1},${y + 1}` : null)).filter(Boolean)).flat();
    parts.push(walls.length ? `Walls at (column,row): ${walls.join("; ")}.` : "There are no walls inside the grid.");
    return parts.join(" ");
  }

  function goalText(expect) {
    const goals = Object.keys(expect).map(key => EXPECT_TEXT[key](expect[key]));
    return goals.length > 1 ? `${goals.slice(0, -1).join(", ")} and ${goals[goals.length - 1]}` : goals[0];
  }

  // ---------- Mounted editors ----------

  // Question id -> { question, response } from the latest renderInput, read
  // when the placeholder appears.
  const pending = new Map();
  // Question id -> the live editor.
  const editors = new Map();

  function startWorkspace(question) {
    return engine().normalizeWorkspace(question.startProgram, {
      world: question.world,
      variables: question.variables || [],
      keepFlags: true
    }).value;
  }

  // The program in the editor, as the engine reads it. ids: keep block ids
  // (for highlighting while running).
  function currentProgram(editor, ids) {
    const state = window.Blockly.serialization.workspaces.save(editor.workspace);
    const result = engine().normalizeWorkspace(engine().fromBlocklyState(state), {
      world: editor.question.world,
      variables: editor.question.variables || [],
      keepIds: ids,
      keepFlags: true
    });
    return result.error ? null : result.value;
  }

  // What to load: a saved answer, with its given blocks locked again, or
  // the starting program.
  function initialState(question, response) {
    const start = startWorkspace(question);

    if (response && typeof response === "object") {
      const saved = engine().normalizeWorkspace(response, { world: question.world, variables: question.variables || [], keepFlags: true });

      if (saved.value) {
        const scaffold = engine().checkScaffold(start, saved.value, question.toolbox);
        if (!scaffold.problems.length) {
          return engine().toBlocklyState(saved.value, scaffold.locked);
        }
      }
    }

    return engine().toBlocklyState(start, null);
  }

  function toolboxFor(question) {
    return {
      kind: "flyoutToolbox",
      contents: question.toolbox.flatMap(type => {
        // One "get" block per variable, so each name is ready to drag.
        if (type === "get_var") {
          return (question.variables || []).map(name => ({ kind: "block", type, fields: { VAR: name } }));
        }
        return [engine().toolboxBlock(type, question.variables || [])];
      })
    };
  }

  function isNarrow(el) {
    return el.clientWidth < 520;
  }

  // Given blocks get a dashed outline, so students can tell them apart.
  function markGiven(workspace) {
    workspace.getAllBlocks(false).forEach(block => {
      const root = block.getSvgRoot && block.getSvgRoot();
      if (root) {
        root.classList.toggle("bk-given", !block.isMovable() && !block.isShadow());
      }
    });
  }

  async function mount(el) {
    el.setAttribute("data-bk-mounted", "");
    const questionId = el.getAttribute("data-bk-workspace");
    const entry = pending.get(questionId);

    if (!entry) {
      return;
    }

    try {
      await loadBlockly();
    } catch (error) {
      el.innerHTML = `<p class="error-text">The block editor could not load. Check your connection and reload the page.</p>`;
      return;
    }

    if (!el.isConnected) {
      return;
    }

    const Blockly = window.Blockly;
    const { question } = entry;
    const narrow = isNarrow(el);
    const readOnly = Boolean(el.closest("[data-locked]"));

    el.textContent = "";
    currentVariables = question.variables || [];

    const workspace = Blockly.inject(el, {
      toolbox: readOnly ? undefined : toolboxFor(question),
      renderer: "zelos",
      theme,
      readOnly,
      sounds: false,
      trashcan: false,
      comments: false,
      disable: false,
      collapse: false,
      horizontalLayout: narrow,
      toolboxPosition: "start",
      move: { scrollbars: true, drag: true, wheel: false },
      zoom: { controls: !readOnly, wheel: false, pinch: true, startScale: narrow ? 0.7 : 0.8, minScale: 0.4, maxScale: 1.6 },
      grid: { spacing: 24, length: 2, colour: "#EFE4C8", snap: false }
    });

    const editor = { el, question, workspace, loading: true, run: null };
    editors.set(question.id, editor);

    Blockly.serialization.workspaces.load(initialState(question, entry.response), workspace);
    editor.loading = false;
    markGiven(workspace);
    updateViews(editor);

    workspace.addChangeListener(event => {
      if (editor.loading || event.isUiEvent || workspace.isDragging()) {
        return;
      }
      updateViews(editor);
      el.closest("[data-blocks]").dispatchEvent(new Event("change", { bubbles: true }));
    });

    editor.resize = new ResizeObserver(() => Blockly.svgResize(workspace));
    editor.resize.observe(el);
  }

  function dispose(questionId, editor) {
    stopRun(editor);
    if (editor.resize) {
      editor.resize.disconnect();
    }
    editor.workspace.dispose();
    editors.delete(questionId);
  }

  // Mounts new placeholders and drops editors whose element has gone.
  function scan() {
    editors.forEach((editor, questionId) => {
      if (!editor.el.isConnected) {
        dispose(questionId, editor);
      }
    });
    document.querySelectorAll("[data-bk-workspace]:not([data-bk-mounted])").forEach(mount);
  }

  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });

  // The block count, and the text and Python views, after each change.
  function updateViews(editor) {
    const widget = editor.el.closest("[data-blocks]");
    const program = currentProgram(editor, false);

    if (!widget || !program) {
      return;
    }

    const used = engine().blocksUsed(program);
    const max = editor.question.maxBlocks;
    const count = widget.querySelector("[data-bk-count]");
    count.textContent = max ? `Blocks used: ${used} of at most ${max}` : `Blocks used: ${used}`;
    count.classList.toggle("bk-count--over", Boolean(max && used > max));

    const text = widget.querySelector("[data-bk-text]");
    if (text) {
      text.textContent = engine().toText(program);
    }

    const python = widget.querySelector("[data-bk-python]");
    if (python) {
      python.textContent = engine().toPython(program);
    }
  }

  // ---------- Running on the stage ----------

  function stageParts(questionId) {
    const stage = document.querySelector(`[data-bk-stage="${CSS.escape(questionId)}"]`);
    return stage && {
      stage,
      sprite: stage.querySelector("[data-bk-sprite]"),
      body: stage.querySelector("[data-bk-sprite-body]"),
      bubble: stage.querySelector("[data-bk-bubble]"),
      bubbleText: stage.querySelector("[data-bk-bubble-text]"),
      status: stage.querySelector("[data-bk-status]"),
      runButton: stage.querySelector("[data-bk-run]")
    };
  }

  function placeSprite(parts, frame, degrees) {
    parts.sprite.style.transform = `translate(${frame.x * CELL + CELL / 2}px, ${frame.y * CELL + CELL / 2}px)`;
    parts.body.style.transform = `rotate(${degrees}deg)`;
  }

  function say(parts, text) {
    if (text === null || text === undefined || text === "") {
      parts.bubble.setAttribute("hidden", "");
      return;
    }
    parts.bubbleText.textContent = text;
    const width = Math.max(28, 12 + String(text).length * 8);
    parts.bubble.querySelector("rect").setAttribute("width", String(width));
    parts.bubbleText.setAttribute("x", String(8 + width / 2));
    parts.bubble.removeAttribute("hidden");
  }

  function resetStage(questionId, question) {
    const parts = stageParts(questionId);
    if (!parts) {
      return;
    }
    const start = question.example.start;
    parts.stage.classList.remove("bk-stage--crashed", "bk-stage--passed");
    parts.stage.querySelectorAll("[data-star]").forEach(star => star.classList.remove("bk-star--taken"));
    placeSprite(parts, start, FACING_DEGREES[start.facing]);
    say(parts, null);
    parts.status.textContent = "";
  }

  function stopRun(editor) {
    if (editor && editor.run) {
      clearTimeout(editor.run.timer);
      editor.run = null;
      if (editor.workspace && !editor.workspace.isDisposed?.()) {
        editor.workspace.highlightBlock(null);
      }
    }
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function runProgram(questionId) {
    const editor = editors.get(questionId);
    const parts = stageParts(questionId);

    if (!editor || !parts) {
      if (parts) {
        parts.status.textContent = "The block editor is still loading.";
      }
      return;
    }

    stopRun(editor);
    resetStage(questionId, editor.question);

    const question = editor.question;
    const program = currentProgram(editor, true);
    const result = engine().run(program, question.example, {
      world: question.world,
      variables: question.variables || [],
      stepLimit: question.stepLimit,
      record: true
    });

    const tooMany = question.maxBlocks && engine().blocksUsed(program) > question.maxBlocks;
    let degrees = FACING_DEGREES[question.example.start.facing];
    let facing = question.example.start.facing;
    let i = 0;
    const delay = reducedMotion() ? 60 : STEP_MS;

    parts.status.textContent = "Running…";
    editor.run = { timer: null };

    function finish() {
      editor.workspace.highlightBlock(null);
      editor.run = null;

      const passed = result.outcome === "passed";
      parts.stage.classList.toggle("bk-stage--passed", passed && !tooMany);
      parts.stage.classList.toggle("bk-stage--crashed", result.outcome === "crashed");

      const steps = `${result.steps} step${result.steps === 1 ? "" : "s"}`;
      parts.status.textContent = passed
        ? tooMany
          ? `The example works, but it uses more than ${question.maxBlocks} blocks. Try a loop.`
          : `The example works (${steps}).${question.hiddenCases ? ` When you submit, it is also tried on ${question.hiddenCases} more grid${question.hiddenCases === 1 ? "" : "s"}.` : ""}`
        : `${engine().OUTCOME_TEXT[result.outcome] || "Not yet"} (${steps}).`;
    }

    function next() {
      if (!editor.run) {
        return;
      }
      if (i >= result.frames.length) {
        finish();
        return;
      }

      const frame = result.frames[i];
      i += 1;

      if (frame.block) {
        editor.workspace.highlightBlock(frame.block);
      }

      if (frame.facing !== facing) {
        const turn = (["north", "east", "south", "west"].indexOf(frame.facing) - ["north", "east", "south", "west"].indexOf(facing) + 4) % 4;
        degrees += turn === 3 ? -90 : turn * 90;
        facing = frame.facing;
      }

      placeSprite(parts, frame, degrees);

      if (frame.event === "pickup") {
        const star = parts.stage.querySelector(`[data-star="${frame.x},${frame.y}"]`);
        if (star) {
          star.classList.add("bk-star--taken");
        }
      }
      if (frame.event === "say") {
        say(parts, frame.said);
      }
      if (frame.event === "crash") {
        parts.stage.classList.add("bk-stage--crashed");
      }

      editor.run.timer = setTimeout(next, delay);
    }

    next();
  }

  document.addEventListener("click", event => {
    const button = event.target.closest && event.target.closest("[data-bk-action]");
    if (!button) {
      return;
    }

    const questionId = button.getAttribute("data-bk-question");
    const action = button.getAttribute("data-bk-action");
    const editor = editors.get(questionId);

    if (action === "run") {
      runProgram(questionId);
    } else if (action === "reset") {
      stopRun(editor);
      if (editor) {
        resetStage(questionId, editor.question);
      }
    } else if (action === "start-over" && editor && !editor.el.closest("[data-locked]")) {
      if (window.confirm("Start again from the given blocks? Your changes will be lost.")) {
        stopRun(editor);
        editor.workspace.clear();
        window.Blockly.serialization.workspaces.load(engine().toBlocklyState(startWorkspace(editor.question), null), editor.workspace);
        markGiven(editor.workspace);
      }
    }
  });

  window.CTQuestTypes.register("blocks", {
    ready: engineReady,

    // The stage and its controls sit with the question.
    renderContext(question, h) {
      const id = h.escapeHtml(question.id);
      const example = question.example;

      return `
        <div class="bk-stage" data-bk-stage="${id}">
          <div class="bk-stage__frame">${stageSvg(example, `bk-${id}`)}</div>
          <div class="bk-stage__bar">
            <button type="button" class="btn btn--primary bk-run" data-bk-action="run" data-bk-question="${id}" data-bk-run>&#9654; Run</button>
            <button type="button" class="btn btn--secondary" data-bk-action="reset" data-bk-question="${id}">Reset</button>
          </div>
          <p class="bk-status" data-bk-status role="status" aria-live="polite"></p>
          <p class="bk-goal"><strong>To pass:</strong> ${h.escapeHtml(goalText(example.expect))}.${question.hiddenCases
            ? ` Your program is also tried on ${question.hiddenCases} other grid${question.hiddenCases === 1 ? "" : "s"} you can't see, so make it work in general.`
            : ""}</p>
        </div>
      `;
    },

    renderInput(question, response, h) {
      const id = h.escapeHtml(question.id);
      pending.set(question.id, { question, response });

      return `
        <div class="bk" data-blocks>
          <p class="answer-label">Finish the program</p>
          <p class="bk-help">Drag blocks from the toolbox into the gaps. Blocks with a dashed outline are given and stay where they are. Run it on the grid as often as you like, then submit.</p>
          <div class="bk-workspace" data-bk-workspace="${id}" aria-label="Block editor"><p class="muted small bk-loading">Loading the block editor…</p></div>
          <div class="bk-meta">
            <span class="bk-count muted small" data-bk-count></span>
            <button type="button" class="btn btn--secondary bk-start-over" data-bk-action="start-over" data-bk-question="${id}">Start again</button>
          </div>
          <details class="bk-view">
            <summary>Read my program as text</summary>
            <pre class="bk-code" data-bk-text></pre>
          </details>
          ${question.showPython ? `
          <details class="bk-view">
            <summary>Show my program as Python</summary>
            <pre class="bk-code" data-bk-python></pre>
          </details>` : ""}
          <details class="bk-view bk-keys">
            <summary>Using the keyboard</summary>
            <ul>
              <li>Tab to the editor. The arrow keys move between blocks and the gaps in them.</li>
              <li><kbd>T</kbd> opens the toolbox; choose a block with the arrow keys and press <kbd>Enter</kbd> to take it.</li>
              <li>Move it with the arrow keys to the gap you want and press <kbd>Enter</kbd> to drop it, or <kbd>Esc</kbd> to cancel.</li>
              <li><kbd>M</kbd> picks up the block you are on to move it; <kbd>Delete</kbd> removes it; <kbd>Enter</kbd> on a number or menu edits it.</li>
              <li><kbd>W</kbd> goes back to your program. Tab on to leave the editor.</li>
            </ul>
          </details>
        </div>
      `;
    },

    // The program without the editor's ids or locks, or null while it is
    // still the starting program (so an untouched question counts as not
    // answered). undefined while the editor is loading.
    readResponse(container, question) {
      const editor = editors.get(question.id);

      if (!editor || !container.contains(editor.el) || !engine()) {
        return undefined;
      }

      const program = currentProgram(editor, false);

      if (!program) {
        return undefined;
      }

      const plain = engine().strip(program);
      const start = engine().strip(startWorkspace(question));
      return JSON.stringify(plain) === JSON.stringify(start) ? null : withShadows(program);
    },

    // Stored responses are programs. The leading line break puts the program
    // under its label in the breakdown.
    describeResponse(response) {
      if (!response || !Array.isArray(response.scripts)) {
        return "No answer";
      }
      return engine() ? `\n${engine().toText(response)}` : "A block program";
    }
  });

  // Keeps the shadow marks (so a reloaded default stays a default) and drops
  // the lock marks, which the server ignores and the editor re-derives.
  function withShadows(program) {
    return JSON.parse(JSON.stringify(program, (key, value) => (key === "locked" || key === "editable" || key === "id" ? undefined : value)));
  }
})();
