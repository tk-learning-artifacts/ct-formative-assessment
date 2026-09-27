# ADR 0007: Visuals in questions

- **Status:** Accepted, 2026-09-27 (branch `feat/visuals`). Akmal asked for more visuals in the questions, aiming for about a quarter of the bank, with a framework decided before any content changed. The choices below are decided here and open to his review.
- **Scope:** When a question gets a visual, how each kind of visual is produced, stored, validated, projected to students and drawn, accessibility, answer safety, authoring, and the teacher preview. Builds on ADR 0001 §5–6 (question schema, public projection, static allowlist), ADR 0002 (Slate tokens, light only, 390px) and ADR 0006 (the block stage, which is already a visual of this kind).

## Context

Before this change a question could carry `art`, a monospaced text figure. Two questions used it: the P6-01 maze (`S . . .` rows) and the RGS-S2-05 step list. Other questions described structures in prose that a picture carries better: an edge list with costs (S2-02), "A can connect to B and C" (P6-05), a row of numbers to sort, a repeating pattern of shapes, a rule with a branch. The core audience starts at 11 years old, and several prompts ask a P5 reader to hold four or five facts in their head before they reach the question.

The block questions (ADR 0006) already draw their stage as SVG from grid data, with a text description for screen readers. That is the model this ADR generalises.

Two image-capable command-line tools are installed on the author's machine, `agy` (Antigravity) and `codex`. Either can produce a raster illustration from a text prompt.

## Decision

### 1. When a visual earns its place

Every visual declares a `purpose`, one of three:

- **`information`**: the student needs what it shows to answer. A grid, a graph or network, a tree, a flowchart, a table, a state diagram, a sprite stage, a sorting row, a bit pattern.
- **`reading-load`**: the prompt already states everything, and the visual restates the same facts in a form a younger reader takes in faster (a row of shapes instead of "Circle, Circle, Square, …", a branch drawn instead of described).
- **`context`**: a scene that sets up the situation or motivates it. Nothing in it is needed to answer.

Rules, all enforced by review and most by validation:

1. **A visual never contradicts the prompt.** For every structured visual, the question's answer-key solver reads the visual's data and the prompt, and fails if they disagree (§6).
2. **A visual never gives away the answer.** It shows the question's starting state, never a worked step towards the key: no highlighted path, no sorted row, no marked branch. Kind schemas have no field that could mark a solution, and unknown keys are rejected (§5). A test checks that no key text appears in a visual that the prompt does not already contain (§5).
3. **Decoration never adds reading load.** A `context` visual has no text in it, sits small beside the title rather than between the prompt and the options, and is left out entirely where it would push the options off a phone screen.
4. **Context only comes from illustrations, and illustrations are only context.** A structured kind cannot be `context` (if it carries no information, it should not be drawn), and an illustration cannot be `information` or `reading-load` (§2).
5. **One visual per question.** More than one is a sign the question should be split.

A visual is worth adding when at least one of these holds: the structure is spatial or relational (anything with "next to", "connects to", "then", "row", "column"); the prompt lists more than about four facts a student must cross-reference; or the student is P5 or P6 and the prompt is longer than about 40 words. It is not worth adding to a code question whose code is already the structure, to a judgement question (RGS-S1-08, RGS-S2-09), or where the only useful picture would show the answer.

### 2. How visuals are produced, by kind

**Structured visuals are data in the question, drawn by a client-side SVG renderer.** A question carries `visual: { kind: "graph", purpose: "information", ... }` with the kind's own fields. Each kind is one file, `web/visuals/kinds/<kind>.js`, in a small UMD wrapper like `web/lib/blocks-engine.js`: the browser registers it with `CTQuestVisuals`, and the server `require()`s the same file. A kind exports:

- `kind`, `structured: true`, `fields` (the keys it accepts besides the common ones);
- `validate(visual)`: a list of errors, run at boot;
- `describe(visual)`: the long text description, generated from the data;
- `render(visual, h)`: an SVG string. It is a pure function of the data, so it runs under Node in tests as well as in the page.

The kinds built for this change:

| Kind | Draws | Used for |
|---|---|---|
| `grid` | A maze of cells: floor, wall, start, target, each with a letter as well as a fill | P6-01 |
| `cells` | One or more labelled rows of boxes; a box holds text, a shape (circle, square, triangle) or a light or dark fill, optionally numbered | patterns, rows to sort, tiles, strings, lists |
| `graph` | Nodes at given positions and edges between them, directed or not, with optional weights | networks and routes |
| `flowchart` | Start and end terminals, process boxes and yes/no decisions at given grid positions, with labelled arrows (loops included) | rules with branches and loops |
| `table` | A header row and rows of short cells | worked examples, interleaved steps |

Positions are given in the data (a node's `x` and `y`, a flowchart box's `col` and `row`) rather than laid out automatically. An automatic layout would be a library or several hundred lines, and a small change to the data would move everything; a hand-placed figure stays where the author put it.

Why client-side, and not SVG rendered at build time or on the server:

- **Tokens.** The SVG uses class names whose fills and strokes are Slate tokens in `web/visuals/visuals.css`, so a retint of `:root` retints every figure. A build-time SVG file would need its colours baked in, or would have to be inlined to use the page's CSS variables, which is what the client does anyway.
- **No build step.** The app has none (ADR 0002, ADR 0006). A build-time renderer would need a script run after every content edit and generated files committed beside the data, and those can drift from it. Rendering from the data on every load cannot drift.
- **One source for three consumers.** The same file validates at boot, generates the description, and draws. The solvers and tests read the same data the page draws from.
- **Cost.** About 46 KB of script (uncompressed and commented) for the core and all six kind files, plus 4 KB of CSS, loaded once per page. The data per question is a few hundred bytes.

The alternative, rendering on the server and sending markup in the question payload, was also weighed. It saves the client the kind files, but it puts trusted HTML in an API response that the page would have to insert unescaped, and the teacher preview would need a second route for it. The kind files are small enough that shipping them is the simpler path. Build-time rendering remains the better choice if a visual ever needs a heavy library (a graph layout engine, a charting library): generate the SVG once, commit it, and treat it like an illustration file.

**AI-generated raster illustrations** are `kind: "illustration"`, `purpose: "context"` always. They are for younger students and scene-setting only, where exact detail does not matter: a robot packing a box, a cat on a stage, a rocket on a launch pad. The rules:

- Generated once, by the author, never at request time. The generator is `agy` or `codex`; both were tried (§8).
- Reviewed by the author before commit, by looking at the image: rejected if it contains text or numbers, shows a count or an order the question depends on, shows a step towards the answer, or is confusing.
- Stored as optimised WebP under `web/visuals/img/`, 100 KB or less, at most 640 pixels on the longer side, with every metadata chunk stripped (generators embed the prompt and provenance manifests; see §5).
- The file name is the question id in lower case plus an optional `-n`, such as `p5-01.webp`, so the name carries nothing about the content.
- Provenance is recorded in the question, not in the file: `source: { generator, prompt, date, reviewed }`. `source` is teacher-only.

An illustration never carries information the answer depends on. If an image would need to be exact to be useful, it is a structured visual instead.

**The prompt stays complete.** For `reading-load` visuals the prompt text states every fact the visual shows, so the visual is purely additive. For `information` visuals the prompt states everything a sentence can hold without becoming harder to read than the figure (the rule, the start and target, which moves are allowed), and the structure itself (the cells of a maze, the edges of a network) is stated once, in the visual's data. The long description generated from that data is its text equivalent for anyone who cannot see the figure, and it can never disagree with the figure because both come from the same data. Where the prompt does state the structure in words (S2-02 lists every edge and its cost; P6-05 lists every connection), the solver checks the prose and the data give the same structure.

`art` stays supported for questions without a visual and for event snapshots taken before this change, but new content should use a `grid` or `table` visual instead. P6-01 and RGS-S2-05 were converted.

### 3. Accessibility

- **Every visual has a text equivalent.** Structured kinds generate it with `describe()` from the data; illustrations require an `alt` written by the author (at most 250 characters). The server will not start if an illustration has no `alt`, or if a structured kind's description comes out empty.
- **How it is exposed.** The SVG is `role="img"` with `aria-labelledby` pointing at a short label and `aria-describedby` at the long description. The long description is also visible to everyone under a closed "Describe the picture" disclosure, so a student who finds the figure hard to read gets the words without a screen reader. An illustration is `<img alt="…">`.
- **Colour is never the only signal.** Every state has a letter, word or shape as well: walls are dark and marked with nothing walkable, start and target carry S and T, dark tiles are dark by luminance (7:1 against light tiles, so they read in greyscale), decision branches are labelled Yes and No.
- **Contrast against the Slate tokens** (computed from the `:root` values):
  - figure text is `--color-ink` on `--color-bg` or `--color-surface-2` (14.3 and 13.3 to 1), or `--color-bg` on `--color-ink-soft` (7.1 to 1) inside dark cells;
  - lines and arrows that carry meaning (edges, box outlines, cell borders) are `--color-ink-soft` or `--color-muted` (at least 4.9 to 1, above the 3 to 1 non-text minimum);
  - emphasis (start and target, the edge weights' label chips) uses `--color-accent-deep` (6.2 to 6.6 to 1);
  - `--color-line` and `--color-line-strong` (1.2 to 1.9 to 1) are never used for a line that carries meaning.
- **390px.** Every kind scales to the card's width with its `viewBox`, and each kind keeps its natural width small enough (at most about 360 units) that its smallest text stays at or above 12px on a 390px screen. Nothing scrolls sideways. On wider screens a figure is capped at its natural size so it is not blown up.

### 4. Where visuals appear

- **The student question view:** a structured visual sits straight after the prompt, where `art` sat. An illustration sits beside the title, at most 120px high at 1280px and 96px at 390px, floated so the prompt wraps around it.
- **The released breakdown:** each row for a question with a structured visual gets a closed "Show the figure" disclosure, since the student may want to look again at the maze or network next to the key. Illustrations are left out there; they only set the scene. The breakdown builds figures from the questions the attempt response already carries, so nothing new is sent.
- **The teacher's question preview** (`web/admin.js`, both the create-event preview and the results view's Questions disclosure) draws the same figure with the same kind file, plus a teacher-only line: the purpose, and for an illustration its generator, date and the prompt used.

### 5. Answer safety

Visual data and image files are public. The static allowlist serves `web/visuals/*.js`, `web/visuals/*.css`, `web/visuals/kinds/*.js` and `web/visuals/img/*.webp`, and nothing else from that folder. So:

- **The projection is an allowlist, twice.** `visual` is added to `BASE_PUBLIC_FIELDS` deliberately, and `scoring.toPublicQuestion` does not copy it as it stands: it passes it through `visuals.toPublic`, which keeps only `kind`, `caption` and the kind's own `fields`. `purpose` and `source` (the generator, the prompt used, the review date) never reach a student. They are not secret in the sense an answer is, but students have no use for them and the generation prompt could describe more than the picture shows.
- **No answer in the data, the file name or the metadata.** Kind schemas have no field for marking a solution, and validation rejects unknown keys. Image names are the question id. Image files are re-encoded with every chunk except the image data stripped, and a test reads each served image and rejects any text, EXIF, XMP or C2PA chunk.
- **Tests.** `test/visuals.test.js` checks, for every shipped visual: the public projection has only the allowed keys; no key text (an MCQ's correct option, a code-trace output) appears in the public visual or its description unless the prompt already contains it; the rendered SVG contains no hex, `rgb()` or named colour; each image is under the size cap and carries no metadata. The same file starts a real event holding every question with a visual and checks the start response and the released breakdown carry the projected visual and no `purpose` or `source`, while the teacher's question view carries both. `no-answer-leak.test.js` now also fetches the kind files and images (checking the images' content type rather than scanning them as text), and its existing `ANSWER_KEYS` scan of the start, resume and submit responses covers `visual` too. A numeric key the solver computes (P6-01's 6 steps, S2-02's cheapest cost) must not be one of the values a visual draws unless the prompt already contains that number.
- **Solvers read the visual.** Every question with a structured visual has a solver that reads its data and fails without it. The answer-key test checks this by running the solver with the visual removed and expecting it to throw.

### 6. Schema and validation at boot

Common fields on every visual:

| Field | Required | Notes |
|---|---|---|
| `kind` | yes | A kind with a file in `web/visuals/kinds/` |
| `purpose` | yes | `information`, `reading-load` or `context` (§1 rule 4 on which kinds may use which) |
| `caption` | no | One visible line under the figure, at most 120 characters. Must not name the answer |
| `alt` | illustrations only | At most 250 characters |
| `src` | illustrations only | A file name in `web/visuals/img/` |
| `source` | illustrations only | `{ generator, prompt, date, reviewed }`; teacher-only provenance |

`backend/src/visuals.js` loads every kind file at startup, and `content.js` calls it for each question that has a `visual`. The server refuses to start, listing every problem, on: an unknown `kind`; a missing or wrong `purpose`; an unknown key; a kind validator's errors (a non-rectangular grid, an edge to a missing node, a flowchart arrow to a missing box, rows of different widths in a table, text over the length limits); an illustration without `alt`, `source` or `src`, a `src` that is not `<question id>[-n].webp`, or a file that does not exist, is over 100 KB, or is not a WebP; and an empty generated description.

### 7. Authoring

To add a structured visual to a question:

1. Decide the purpose (§1). If the answer can be read off the figure, stop.
2. Pick the kind and write its data next to the prompt. The field lists are at the top of each file in `web/visuals/kinds/`. Keep the prompt complete for `reading-load`, and for `information` keep the sentence facts in the prompt and the structure in the data.
3. Update the question's solver in `backend/test/solvers/` to read the visual's data (with `must(q.visual …)`), and to check it against the prompt where the prompt states the same thing.
4. Run `npm test`. Boot validation, the answer-key test and `visuals.test.js` will catch a broken figure, a solver that ignores it, and a leak.
5. Look at it at 390px and in the teacher preview.

To add an illustration:

1. Check it really is context only (§1 rule 4).
2. Write a prompt with no student data (there is none in content anyway). Ask for a flat illustration, no text, no numbers, a plain light background, and describe only the scene, not the puzzle's answer. The prompts used are in the questions' `source.prompt`.
3. Generate with `agy -p "…" --dangerously-skip-permissions` or `codex exec -s workspace-write "…"` in a scratch directory (§8), look at the result, and reject it if it breaks any rule in §2.
4. Optimise and strip metadata: `cwebp -q 70 -resize 640 0 -metadata none in.png -o web/visuals/img/<id>.webp` (or `sips` to resize first).
5. Add `visual: { kind: "illustration", purpose: "context", src, alt, source }`.

To add a kind: add `web/visuals/kinds/<kind>.js` with the exports in §2 and any styles to `web/visuals/visuals.css`. No shared file changes: the server and both pages find kinds by listing the folder (`GET /api/web-visuals`).

### 8. The generators

Both CLIs were driven non-interactively from a scratch directory outside the repository, with a one-line test first (a red apple on white) to learn how each returns a file:

- `agy -p "<prompt>. Save it as <name>.png in <dir>." --dangerously-skip-permissions` runs an Antigravity agent whose image tool writes a 1024 by 1024 PNG where asked.
- `codex exec --skip-git-repo-check -s workspace-write "<prompt>. Save it as <name>.png in the current directory."` uses Codex's built-in `image_gen` tool (feature `image_generation`), which writes under `~/.codex/generated_images/` and then copies the file into the working directory; about 1254 by 1254 PNG.

Which one was used for which image is recorded per question in `source.generator`, and in the coverage table below.

## Coverage

Applied on 2026-09-27. 14 questions gained a visual; the 6 block questions already had a stage drawn from grid data with a generated text description, which is this ADR's structured model in all but name, so they count. That is **20 of 69 questions (29%)**: 11 structured visuals, 3 illustrations and 6 block stages.

| Question | Audience, level, type | Kind | Purpose | Note |
|---|---|---|---|---|
| P5-01 Packing order | core P5, mcq | illustration | context | codex. Robot, open empty box, sandwich and note beside it; no order shown |
| P5-02 Sticker pattern | core P5, mcq | cells | reading-load | the first six stickers as shapes, numbered, then "…" |
| P5-03 Ticket rule | core P5, mcq | flowchart | reading-load | the rule as one question with Yes and No |
| P6-01 Shortest safe walk | core P6, mcq | grid | information | was `art`; the grid is stated once, in the visual |
| P6-03 Neighbour swaps | core P6, mcq | cells | reading-load | Start and Goal rows |
| P6-05 Two-step routes | core P6, mcq | graph | reading-load | the four connections as lines |
| S1-03 Even-odd machine | core S1, mcq | flowchart | reading-load | the loop and the branch; the solver runs the flowchart |
| TS-PA-01 Countdown to launch | core S1, parsons | illustration | context | agy. A rocket lifting off |
| S2-02 Cheapest route | core S2, mcq | graph | reading-load | directed, weighted; was an edge list only |
| S2-04 Counting blocks | core S2, mcq | cells | reading-load | the code's letters, numbered 1 to 8 |
| CR-P5-01 What does the cat say? | core P5, code-reading | illustration | context | agy. A cat on a stage, empty speech bubble |
| RGS-S2-03 One pass of a sort | RGSynapse S2, mcq | cells | reading-load | `nums` under its indexes 0 to 3 |
| RGS-S2-05 A lost update | RGSynapse S2, mcq | table | information | was `art`; one column per function |
| RGS-S2-08 Spotting the conversion pattern | RGSynapse S2, mcq | table | reading-load | the examples, then `convert(10)` and "?" |
| BLK-P5-01, BLK-P6-01, BLK-S1-01, BLK-S2-01 | core P5 to S2, blocks | block stage (ADR 0006) | information | existing |
| BLK-RGS-S1-01, BLK-RGS-S2-01 | RGSynapse S1, S2, blocks | block stage (ADR 0006) | information | existing |

By audience: 15 of 30 core questions and 5 of 39 RGSynapse questions. No RGSynapse S1 question gained a new visual: its questions are code (the code is the structure) or judgement questions, and the one with a stage (BLK-RGS-S1-01) already counts. Considered and left out: S2-03 (an example move would show that two black tiles is reachable, which rules out an option), P5-05 (an illustration of three switches would carry the count the answer depends on), P6-02 (a picture of a machine would be decoration and nothing more).

Five images were generated in all: one test image from each tool, then the three above, each accepted on first review.

## Consequences

- A new kind is a new file plus CSS; a change to a kind's fields must stay backward compatible, because event snapshots keep the visual data they were created with.
- Illustrations cost a download each (under 100 KB). Pages load them lazily.
- Solvers for questions with structured visuals now depend on the visual data. Removing a visual means editing the solver.
- `art` remains for old snapshots. It could be removed from the schema once no running event uses it.

## Still open

- Whether illustrations should appear at all on the student page for S1 and S2, or only for P5 and P6.
- Whether a teacher should be able to hide visuals for an event (for a test of reading prose, say).
- Whether the maze-style `grid` and the block stage should share a drawing, so they look the same. They are separate today because the block stage animates.
