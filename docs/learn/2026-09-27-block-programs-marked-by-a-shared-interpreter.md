---
title: "Block programs marked by a shared interpreter"
date: 2026-09-27
project: ct-formative-assessment
tags: [interpreters, blockly, server-side-marking, hidden-test-cases, vendoring, accessibility]
status: unread
---

# Block programs marked by a shared interpreter

Think of a driving test. The learner can practise on the car park as often as they like, with an instructor narrating what the car is doing. But the licence depends on the examiner's route, which the learner never sees in advance, driven in the examiner's car. The practice run and the real test only mean the same thing if the car behaves identically in both. CT Quest's new block programming questions work the same way: the student practises on a visible grid, the server examines the program on grids the student never sees, and both use one engine so they cannot disagree.

## What we did

A block question shows a small grid with a sprite, walls, stars and a flag, and beside it a Scratch-style editor holding a half-built program. Some blocks are given and locked in place, drawn with a dashed outline; the student drags blocks from a toolbox into the gaps, presses Run, watches the sprite move, and tries again as often as they like. When they submit, the page sends the program as a tree of plain objects: each block has a type, its field values, the blocks plugged into its slots, and the block under it.

The server treats that tree as untrusted. It checks every block against a fixed list, caps the size at three hundred blocks, and checks that the locked blocks are still where the starting program put them and that every other block is one the question offered. Only then does it run the program, once on the visible example grid and once on each hidden grid, and it marks by how many pass. Nothing is ever handed to `eval` or any other code runner; a small interpreter walks the tree one block at a time.

That interpreter lives in one file, `web/lib/blocks-engine.js`. The browser loads it to animate the Run button, and the server loads the same file with `require` to mark. A test fetches the file the web server hands out and compares it byte for byte with the one the scorer loaded. The file is wrapped so it works in both places: if a CommonJS `module` exists it exports itself, otherwise it sets a browser global.

The editor is Blockly, copied into the repository with its licence and a header recording version and checksum, never loaded from a content delivery network.

## Why this way, and what else was possible

The first decision was one engine instead of two. The alternative is a JavaScript interpreter in the browser and a separate one on the server, kept in line by tests that run both over the same programs and compare results. That works, and it is what you must do when the two sides are different languages. It also invites drift: someone fixes how an empty condition behaves on the server, forgets the client, and a student watches their program succeed while the server marks it as failing. With one file there is nothing to drift. The cost is a constraint: the engine can use nothing that exists only in the browser or only in Node.

The second decision was the step limit. A student can build a loop that never ends, and a server that runs student programs must never hang. Every block costs one step and every pass around a loop costs one more, so even an empty "repeat until" burns steps and stops at five hundred by default. The limit also bounds the work per submission: even a question at the highest allowed limit, five thousand steps on each of eleven grids, is fifty-five thousand tiny steps, a few milliseconds in all. A time limit would be the alternative, but it makes the same program pass on a fast machine and fail on a slow one, which is unacceptable for marking.

The third was hidden grids. If a program were marked only on the grid the student can see, "move, move, turn right, move" would score full marks on a question about conditionals. Hidden grids reward programs that work in general, which is what the Brennan and Resnick framework calls generalisation. The page tells the student how many hidden grids there are but never what they look like, and the released breakdown shows the student's own program, never the reference solution, because that solution would reveal what the hidden grids need.

The fourth was the editor. A custom list-based editor would weigh a few kilobytes and be fully keyboard-driven by design, but nesting an "if" inside a "repeat" with drag, touch and screen-reader support is weeks of work. Blockly's cost is about 640 kilobytes, 180 compressed, loaded only when a block question appears. In return it brings touch dragging, Scratch-shaped blocks, a way to make blocks immovable and undeletable, and, since version 13, keyboard navigation in its core. It has limits, which the decision record lists: keyboard users land in the toolbox first, moving a block steps through every gap in the program, and it does not announce that a block is locked.

## Glossary

Interpreter: a program that runs another program by walking its structure step by step, rather than translating it to machine code first.

Abstract syntax tree (AST): a program stored as nested data, one node per construct; a block program is already one.

Universal Module Definition (UMD): a small wrapper that lets one JavaScript file work as a Node module and as a browser script.

Step limit: a cap on how many operations a run may take, so an endless loop stops safely.

Hidden test cases: inputs the marker uses that the student cannot see, to check a solution works in general.

Vendoring: copying a library's files into your own repository instead of installing it as a package.

Accessible Rich Internet Applications (ARIA): attributes that tell screen readers what a custom control is and what state it is in.
