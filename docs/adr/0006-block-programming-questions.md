# ADR 0006: Block programming questions

- **Status:** Accepted, 2026-09-27 (branch `feat/blocks`). Akmal asked for a question type in which students complete a program in a Scratch-like environment, run it and have it marked. He left the editor, the world and the details to this work; the choices below are decided here and open to his review.
- **Scope:** A new active question type, `blocks`: the editor, the world the program acts on, the program format, how the given blocks are kept in place, running with a step limit, marking on the server, what students are and are not sent, boot-time validation, the six shipped questions, and the student page at 390px, by touch and by keyboard. Builds on ADR 0001 §5–6 (the question schema and the scorer registry). ADR 0005 is the code-reading type, written in parallel on `feat/code-reading`.

## Context

Every existing type asks a student to choose, type or order something the author has fixed. A block question asks them to build part of a program and see it run, which is how the core audience (P5 to S2) first meets programming in Scratch, and a way to connect blocks to Python for RGSynapse students.

Three requirements shape it. The program must be marked on the server, never trusted from the page. The grids the program is marked on, and the author's reference solution, must never reach a student. And the page has no build step, no framework and no packages: a library can only arrive as a vendored static file (Slate ADR 0005, "vendored, never packaged").

## Decision

### 1. Editor: Blockly 13.3.0, vendored, with the zelos renderer

`web/vendor/blockly-13.3.0/` holds `blockly_compressed.js` and `msg-en.js` from the npm package `blockly` 13.3.0 (Apache-2.0), unmodified below a header comment that records the source URL, the tarball's sha512 integrity (checked against the registry's), each file's sha256 before the header was added, and the licence. The licence text is beside them. The renderer loads Blockly the first time a block question is shown, so pages without one never download it. There is no CDN.

The zelos renderer draws Scratch-shaped blocks. Colours follow Scratch's categories (events, motion, looks, control, sensing, operators, variables), darkened so the white block text clears 4.5:1 on each. Sounds, the trashcan, comments, collapsing and disabling are off; a block dragged back to the toolbox is deleted.

**Why Blockly.** It already does the three things that are expensive to build well. It handles touch natively (verified below). Version 13 has keyboard navigation and ARIA labels built into core, where earlier versions needed a plugin. And a block can be made immovable, undeletable and uneditable, which is how the given blocks stay put (§4). The cost is size: about 640 KB, or 180 KB gzipped, loaded once and cached.

**Alternative: a small custom block UI.** A list-based editor like the Parsons one (buttons to add, move and nest) would be under 20 KB, fully keyboard-accessible by construction, and styled with the rest of the app. But it would not look or feel like Scratch, which is the point for the core audience, and nesting (an `if` inside a `repeat`, a condition in a slot) is where a hand-built editor gets hard: drop targets, insertion markers, touch dragging, and screen-reader wording for each. That is several weeks of work to reach what Blockly already has. It is the better choice if Blockly's size or keyboard model proves a problem in class; the engine (§3) does not depend on Blockly, so the editor could be swapped without touching marking.

**Alternative: scratch-blocks** (Scratch's own fork of Blockly). It looks exactly like Scratch, but it is a fork of an old Blockly with a build that expects the Scratch GUI, has weaker keyboard support, and is maintained for Scratch rather than for embedding. Zelos gives the Scratch shape on current Blockly.

### 2. The world: a sprite on a grid ("maze")

The stage is a grid of cells: `#` wall, `.` floor, `G` the flag, `*` a star. The sprite starts at `start: { x, y, facing }` (columns and rows from 0 at the top left) and can move forward, turn left or right, and pick up a star. It can sense a path ahead, to the left or to the right, whether it is at the flag, and whether it is on a star. Outside the grid counts as wall, and moving into a wall stops the program (a crash, which fails the stage, as in Blockly Games' maze). A stage's `expect` says what passing means when the program ends: `reachGoal` (on the flag), `collectAll` (every star picked up) and `say` (the last thing said), in any combination. Grids are 1 to 12 cells each way. It is drawn as SVG, with a text description of the grid for screen readers.

The Scratch concepts are all present: sequences, loops (`repeat N times`, `repeat until`), conditionals (`if`, `if … else`, `not`, `and`, `or`, comparisons), variables (`set`, `change`, the variable itself, arithmetic), and events, though only one: "when Run clicked" starts the only script that runs. Loose blocks elsewhere are ignored, as in Scratch.

**More worlds.** `WORLDS` in the engine maps a world name to how a stage is validated, how the state starts, what each action and sensor does, and how the end is checked. A world's own blocks carry `world: "<name>"` in the block list; the control, operator and variable blocks are shared. A turtle-drawing world, for instance, would add `pen_down`, `forward_by` and an `expect` of the shape drawn. The renderer would need a matching stage drawing, which is the one part not yet split out per world.

### 3. One engine, run by both sides

`web/lib/blocks-engine.js` is plain JavaScript in a small UMD wrapper: it is a global (`CTQuestBlocks`) in the browser and a CommonJS module under Node. The scorer (`backend/src/scoring/types/blocks.js`) requires it, and the renderer loads it from `/lib/blocks-engine.js`. `web/` as a whole is an ES-module package (for Vite), so `web/lib/package.json` marks that folder CommonJS. The Dockerfile already copies `web/`.

It holds the block list, the program checks, the interpreter, the given-blocks rule (§4), and the text and Python views. Because both sides run the same file, the animation a student watches and the mark the server records come from the same code, and a test checks the served file is byte-for-byte the one the scorer requires. The page's run is only for the animation; the server's run is the one that counts.

**Alternative: two implementations and tests that they agree.** That is the fallback the brief allowed if a shared file were awkward. It was not: the engine needs nothing from either environment.

**Programs are data.** A program is `{ scripts: [block, ...] }` and a block is `{ type, fields, inputs, next }`, a plain tree, never code, and nothing is ever evaluated. Before anything runs, `normalizeWorkspace` checks it against the block list: known types, the right kind in each slot (a stacking block under a stacking block, a condition in a condition slot), field values within range, variable names the question declares, and at most 300 blocks, 30 scripts and 40 levels of nesting. Anything else makes the response unusable, which scores 0 and is stored as no answer. Unknown keys are dropped.

**Running.** The interpreter walks the tree. Every block run costs one step, and so does every pass round a loop, so `repeat until` with an empty body still runs out. The limit is 500 steps by default (a question may set 50 to 5,000), after which the run stops with "Ran out of steps (it may loop forever)". Numbers are clamped to plus or minus a million. Variables start at 0 and live in an object without a prototype, so a variable called `constructor` is just a number. An empty condition is false, an empty number 0.

### 4. The starting program and the given blocks

Each question has a `startProgram` in the same shape, with the given blocks marked `"locked": true` and, where the student may still change a field (the repeat count in "Climb the stairs"), `"editable": true`. The editor loads locked blocks as immovable, undeletable and, unless editable, uneditable, and draws them with a dashed outline.

Blockly will not slot a block in above an immovable one, so a student can fill only three kinds of gap: an empty statement slot (the inside of a given `repeat`), the end of a stack, and an empty value slot (the condition of a given `if`). Validation therefore requires the locked blocks to sit at the top of each stack they are in, with no locked block under or inside an unlocked one, and exactly one locked "when Run clicked" script.

**The server applies the same rule.** A request can carry any program, so marking first checks the response against the starting program: in each stack, the locked blocks at its top are the same blocks, in the same places, with the same field values unless editable; a locked block in a slot is still there; and every other block in the running script is one the toolbox offers (or an unlocked block from the starting program). A response that breaks this scores 0, and the teacher's detail lists why. This matters most for questions like "Climb the stairs", whose block limit only makes sense if the given `repeat` is kept.

When the editor reloads a saved answer, the same check tells it which blocks stand for the given ones, and it locks those again.

The **toolbox** is a list of block types (`toolbox`), shown as one flyout without categories. `maxBlocks` optionally limits the blocks in the running script, shown under the editor as "Blocks used: 5 of at most 5"; over the limit, every stage fails.

### 5. Marking, and what stays secret

A question has one public `example` stage and zero to ten secret `cases`. Marking runs the program on the example and on every case. It is correct only if all pass. With `marking: { partial: "cases" }`, it earns `floor(points × passed ÷ total)`, capped one below full marks, like the other partial-credit types; otherwise it is all or nothing.

The scorer's detail records `{ cases: { passed, total }, outcomes }` (each stage's result: passed, crashed, step-limit, not-at-goal, stars-left, wrong-say, too-many-blocks) for the teacher, and `{ partial: { casesPassed, casesTotal } }` when partial marking applies, which `policy.js` passes to the student after release as it does for the other types. The per-stage outcomes stay with the teacher.

Students receive `world`, `example`, `startProgram`, `toolbox`, `variables`, `stepLimit`, `maxBlocks`, `showPython` and `hiddenCases`, the number of cases (not what they are), so the page can say "Your program is also tried on 3 other grids you can't see". `cases`, `solution`, `marking` and `details` are not in the type's `publicFields`, so the registry's allowlist never copies them. The registry test that adds every secret field to each type's sample covers this type automatically, and `blocks.test.js` checks every shipped question's projection and the full start-to-breakdown HTTP flow.

The type has **no `keyResponse`**, so the released breakdown shows the student's own program as text and never a correct one. Showing the reference solution would give away the answer to the hidden grids, and a block program has many correct forms anyway.

### 6. Validation at boot

`validate` rejects a question unless: the world exists; the example and each case are valid stages (rectangular grid, known characters, at most one flag, a start on a floor cell, an `expect` its grid can satisfy); the toolbox names only blocks of that world, never "when Run clicked", and no variable block without variables; the starting program is well formed and follows the locking rule; the reference `solution` is well formed, keeps the given blocks, uses only offered blocks, and **passes every stage**; and the starting program on its own **fails at least one**, so there is something to do. `stepLimit`, `maxBlocks`, `showPython` and `marking` are checked for type and range.

The answer-key test adds two checks per question. Its solver (`test/solvers/blocks.js`) works out each stage's expectation from the grid alone, without the interpreter: a breadth-first search says whether the flag and every star can be reached, and the counting question's answer is the number of stars on its path. And when `python3` is installed, the question's Python view of the solution is run by real Python against a Python copy of the maze world, on every stage, and must end where the engine's run ends.

### 7. The questions

Six, in `questions/blocks.json`, each tagged with Brennan & Resnick nodes and outcomes, and each with a reference solution:

- **To the flag** (core P5, sequences): four moves given; finish the route with turns.
- **Climb the stairs** (core P6, loops, at most 5 blocks): put one step inside the given `repeat` and set its count.
- **Follow the winding path** (core S1, conditionals): fill the `else` of a given corridor follower so it turns towards the path; three hidden corridors bend both ways and two start facing a wall. Partial credit.
- **Star collector** (core S2): pick up every star and reach the flag on corridors with stars in different places, one on the starting square. Partial credit.
- **Count the stars** (RGSynapse S1, variables): count stars along a straight path and say the total; hidden paths have 0, 8 and 1 stars, so saying the example's 3 earns one of five points. Python view.
- **Solve any maze** (RGSynapse S2, iterating): write the loop body that finds the flag in any maze without loops (a wall follower); a corridor follower passes two of the four mazes. Python view.

Two outcomes were added: `LO-BLOCKS-1` (core, P5 to S2: complete a block program so it works on every grid it is tested on) and `LO-BLOCKS-2` (RGSynapse S1 and S2: use a variable and conditions, and read the program as Python). A "Block programming (Scratch-like)" preset selects the type for either audience. Block questions are not opt-in: like the code-trace and Parsons samples, they appear in any filter that does not name types, including the "Loops and conditionals" and "Mixed" cards.

### 8. The student page

The stage (with Run and Reset, a status line read out by screen readers, and "To pass: …") sits with the question; the editor sits in the answer card. At 390px they stack, stage above editor, and the editor grows to 480px because its toolbox runs across the top. Run animates each move and turn (a quarter second each, instantly under reduced motion) and highlights the block being run. A crash shakes the sprite and says so; a passing example outlines the stage. Students can run as often as they like. An untouched starting program counts as unanswered. "Start again" restores the starting program. "Read my program as text" gives the Scratch-style text of the program, and questions with `showPython` add "Show my program as Python" (read only; nothing runs it). A committed answer's editor is read-only.

**Checked in headless Chrome at 1280px and 390px** (a scratch profile, no console errors, no horizontal overflow): a mouse drag from the toolbox connects under the given blocks; dragging a given block does nothing; a touch drag under touch emulation drops a block into an `if`'s slot; the answer survives a reload; under "after each question", a checked answer's editor is read-only while Run still works; submit and the breakdown; the teacher's results and outcome summary.

**Keyboard.** Blockly 13's built-in navigation works for the whole task, checked with real key events: Tab lands in the toolbox, the arrow keys choose a block, Enter takes a copy, the arrow keys move it from gap to gap, Enter drops it; W jumps to the program, the arrows move between its blocks, and Enter on a number edits it. The page lists these keys under "Using the keyboard". Where it falls short:

- Tab lands in the toolbox, not the program, and the first press of the arrow keys can seem to do nothing until focus is where the student expects.
- Moving a block steps through every possible connection in the program, so a long program takes many presses.
- The spoken labels are Blockly's own ("if, Empty, then, has input"). It does not announce that a block is given and cannot move; only the dashed outline shows that.
- The stage itself is a picture with a text description, not something to explore cell by cell.

None of this was tried with a real screen reader or on an iPad; both should be before relying on it in class.

### 9. Files

New: `backend/src/scoring/types/blocks.js`, `web/types/blocks.js`, `web/lib/blocks-engine.js`, `web/lib/blocks.css`, `web/lib/package.json`, `web/vendor/blockly-13.3.0/*`, `backend/content/questions/blocks.json`, `backend/test/blocks.test.js`, `backend/test/solvers/blocks.js`.

Shared, and kept small: the static allowlist in `backend/src/app.js` also serves `.js` and `.css` from `web/lib/` and from each folder of `web/vendor/`; `web/type-registry.js` waits for a renderer's optional `ready` promise (the block renderer loads its engine), so describing an answer never races the engine loading; `presets.json` and `learning-outcomes.json` gained entries; the answer-key test gained a `blocks` check and a real-Python run, and `solvers/index.js` lists the new solvers. Tests that pinned how many questions a default filter returns now filter on `mcq`, or list the new type.

## Consequences

- A new world means a new `WORLDS` entry, its blocks, and a stage drawing in the renderer.
- Blockly is 640 KB to download once per device. Upgrading it means replacing the vendored files and their header, and re-running the browser checks, because its keyboard model is still changing between major versions.
- The block list is shared by content already in events (`event_questions` snapshots). Removing or renaming a block type would make old snapshots and stored answers unreadable; add blocks, do not rename them.
- Teachers see the per-stage outcomes in the results JSON but the teacher page does not show them yet; it shows the score. A per-type teacher view (being added on `feat/question-preview`) could show the program text and the outcomes.

## Still open

- Whether block questions should be opt-in, as AI-scored ones are, so a teacher building a "Loops and conditionals" event for a room without devices suited to dragging does not get them by default.
- Whether the breakdown should show a reference solution after release. It does not, to keep the hidden grids' answer private.
- A second world (turtle drawing) and a second event block ("when the sprite bumps a wall") would widen what can be asked.
