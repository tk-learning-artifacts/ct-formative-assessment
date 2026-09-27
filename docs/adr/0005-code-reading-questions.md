# ADR 0005: Code-reading questions

- **Status:** Accepted, 2026-09-27. Built on branch `feat/code-reading`, merged with the teacher question preview and ADR 0006 (block programming) on `int/types-preview`, where the preview gained code-reading rows.
- **Scope:** A new question type, `code-reading`, its renderer, ten questions (eight of the new type and two written "explain it" questions of the existing `open-response-ai` type), two learning outcomes, a quick setup preset and the tests.

## Context

Akmal asked for questions that show students a snippet and ask what it does, to build code-reading literacy. `code-trace` already asks for the exact output of one run. Reading asks for the purpose: what the code does for any input. The brief offered three response formats: (a) pick the best plain-English description, (b) a short written explanation scored by AI, and (c) a structured task that pairs a description with a follow-up such as which input changes the result or which line to change. It suggested one type with a multiple-choice description and an optional AI-scored written part, and left the decision open.

Two other sessions are working in parallel (a teacher question preview and another new type), so the change had to stay in new files plus small shared edits.

## Decision

### 1. One automatic type: a description plus an optional follow-up

`code-reading` is format (c), which contains (a) as its first part. The student picks the description of what the code does, and, when the question has one, answers a follow-up worth its own points:

- `choice`: another set of options, typically "which input would change the result", "which call gives back 0" or "what does it give back for an empty list";
- `line`: which one line of the code they would change to get a stated behaviour. The options are generated from the code's non-blank lines and shown as "Line 3" with the line's text, so the student answers with ordinary radio buttons rather than by clicking inside the code.

Content shape: `code` (required), `options` (the descriptions), `answer: { index, followUp? }`, optional `followUp: { kind, prompt, options?, points }` and optional `glossary: [{ term, note }]`. For a `line` follow-up, `answer.followUp` may be a list of lines, any of which earns the mark. Validation rejects a key inside `followUp`, a follow-up worth every point or none, a line key on a blank line, a glossary term that is not in the code and a glossary note over 200 characters or on two lines.

**Why not plain `mcq` with a code block?** Format (a) alone would be exactly that, and the existing banks already do it (RGS-S1-04 and others). A separate type earns its place through the follow-up and its partial credit, line numbers and glossary on the code, validation that a code-reading question has code, and a type filter so a teacher can ask for "Code reading" by name in the picker and in the preset.

### 2. Written explanations stay `open-response-ai` questions

The "explain it in your own words" part is not inside `code-reading`. It is an ordinary `open-response-ai` question with a code block (two ship: CR-AI-S1-01 and CR-AI-S2-01).

Putting an AI-scored part inside the new type would have meant one answer row holding an instant score and a pending one. The AI pipeline assumes one status per answer throughout: the background job overwrites `earned_points` with the AI's score, the teacher override sets the whole question's score, `policy.studentTotal` leaves a whole AI-type question out of the pre-release total, and the teacher page lists answers by `questionType === "open-response-ai"`. Changing each of those was a large edit to shared files, during parallel work, to code that carries the AI data policy. Keeping the written part as its own question inherits all of it unchanged: redaction, the typed payload, schema-validated output, needs-review when AI is off, teacher override, and AI questions being opt-in and last in an event.

The cost is that the two parts are separate questions. The written questions use different snippets from the multiple-choice ones on purpose: shown after a set of descriptions of the same code, a student could copy the right one into their explanation.

### 3. Reading support

- **Line numbers**, drawn as code-trace draws them (hidden from screen readers and from copying).
- **Glossary**: each term is marked in the code with a dotted underline and is a real button. A tap, click or Enter pins its note under the code; a mouse hover shows it until the pointer leaves; Escape closes it; the note sits in a live region so screen readers announce it. Only the first mark of each term is a tab stop, so a term used on every line adds one stop. Touch uses the click path only (hover is limited to `pointerType === "mouse"`), so a tap does not show and then immediately hide the note.
- To mark terms inside the code, `renderCode` now receives the question as a third argument. It is optional, so existing renderers are unaffected.

### 4. Scoring and partial credit

The description is worth `points - followUp.points`, the follow-up its own points, each all or nothing and marked independently. Every shipped question is 3 points: 2 for the description and 1 for the follow-up. A student who reads the purpose right but misses the follow-up keeps 2 of 3.

`correct` means both parts right. When two parts exist and one was missed, `detail` is `{ partial: { parts: [{ part: "describe", earned, max }, { part: "followUp", earned, max }] } }`, which `policy.studentFeedback` already passes through as partial-credit detail. A response is `{ choice, followUp }` with either part optional, stored as `{ choice: { index, text }, followUp: { index, text } | { line, text } }`, so the record says what the student saw. `keyResponse` returns the same shape (the first accepted line for a multi-line key).

**After release** the breakdown shows the score ("2/3", "Part marks"), then "Your answer" and "Correct answer", each with a "What it does:" line and a "Follow-up:" line, so the missed part is the line that differs. Under "after each question" the same panel appears under the checked answer.

### 5. Keys are computed by running the code

Each question has a spec in `test/solvers/type-code-reading.js` that pins the exact source and gives a JavaScript translation, a set of inputs, and one claim per option: a function saying whether an output is what that description promises. The answer-key test requires exactly one description's claim to hold on every input and that it is the key, and does the same for a `choice` follow-up, whose options are parsed and run ("which list makes it say 7"). For a `line` follow-up the spec gives the replacement line and a goal. The code with that line replaced must meet the goal on every input, and the original must fail it on at least one. When more than one line fixes the code on its own, the spec lists each fix, every one must work, and the key lists all their lines (CR-RGS-S2-01 accepts line 3 or line 5). An option with no claim, for example after its text was edited, fails the test.

`test/code-reading.test.js` runs the real Python and Swift where `python3` and `swift` are installed. It runs each program on the same inputs, compares the output with the translation, and runs the program with the follow-up line replaced to confirm the fix works. The pseudocode and Scratch-style questions have no interpreter, so their translation stands, pinned to the source. The written questions' solvers return the facts their full-credit criterion names, as in `ai-samples.js`.

### 6. Content, outcomes and preset

- Eight `code-reading` questions in `questions/type-code-reading.json`:
  - core, one per level: Scratch-style text at P5 and P6, pseudocode at S1 and S2;
  - RGSynapse: two Python questions at S1 and S2, one Swift question at S1, including an AI-written function whose tie and all-negative behaviour the student has to read.
- Correct descriptions sit twice at each of positions 0 to 3.
- Two new outcomes, add-only:
  - `LO-READ-1`: core, P5 to S2;
  - `LO-READ-RGS-1`: RGSynapse, S1 and S2.
  - Both map to tracing and generalisation. The RGSynapse one also maps to questioning AI output.
- Questions carry these outcomes plus existing ones where they fit (LO-TRACE-1, LO-COND-1, LO-DEBUG-1, LO-SPEC-1, LO-GENERALISE-1), and Brennan & Resnick concept and practice nodes.
- A preset, "Reading code: what does it do?", with the `who` knob. It is automatic only, so it needs no AI. The written questions reach an event when a teacher ticks the AI type.
- The bank file sorts after `core.json` and `rgsynapse.json`, so mixed events still open with the original questions.

### 7. Teacher view

The teacher's results show each attempt's total and the outcomes summary, as for other automatic types. The response records hold both parts for any later per-question view. This type exports no `teacherView`: the stored question already holds everything a teacher needs, and the compact question preview in `admin.html` draws it with line numbers, both parts with their points and keys marked, and the glossary notes.

## Consequences

- Shared files edited:
  - `web/app.js`: one argument added;
  - `web/type-registry.js`: a comment;
  - `web/style.css`: one appended block;
  - `backend/content/learning-outcomes.json` and `presets.json`: additions;
  - `test/solvers/index.js`: one import;
  - `test/answer-keys.test.js`: a `code-reading` check, with `keyProblem` taking an optional solved value;
  - `filters.test.js`, `presets.test.js` and `content.test.js`: counts that grew with the new bank. The legacy modes are unchanged.
- The loops preset now offers every core level, because each core level has a code-reading loop question.
- Written explanations and their MCQ counterpart are separate questions. If Akmal wants them as one question later, the AI pipeline has to learn about answers with more than one part (see the list above).
