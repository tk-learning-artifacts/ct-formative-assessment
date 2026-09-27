# ADR 0003: Assessment settings and quick setup

- **Status:** Accepted, 2026-09-27 (branch `feat/assessment-settings`). Akmal asked for all three parts; the choices below that he did not specify are marked as decided here, and are open to his review.
- **Scope:** Two per-event settings (feedback timing and navigation), a per-question commit endpoint, quick setup presets for choosing questions, and a question-count cap on filters. Builds on ADR 0001 §7 (selection) and §8 (answer-key protection).

## Context

ADR 0001 §8 protects the answer key with one attempt per student plus a withheld breakdown: on submit a student sees only their total, and the per-question breakdown waits for the deadline or a teacher release. That suits a check that several classes sit over a week. It does not suit a practice lesson, where the teacher wants students to see right away what they got wrong, or a test where the teacher wants students to work through the questions in order without going back.

Separately, the teacher form offered a basic "Question set" select (the pinned legacy levels) and an advanced picker with six kinds of control. Most events need neither extreme. Three of the select's options (the RGSynapse ones, `RGS:S1,S2`, `RGS:S1` and `RGS:S2`) were never accepted by the API, so choosing them failed with "Unsupported selection mode."

## Decision

### 1. Feedback timing, per event

`events.feedback_mode` is one of:

- `release` (the default, and every existing event): the ADR 0001 behaviour. The breakdown appears after `end_at` or a teacher release.
- `end`: the breakdown shows as soon as the student submits.
- `each`: the student commits each answer on its own and sees that question's result at once: right or wrong, their answer against the correct one, and AI or teacher feedback. The answer then locks.

One attempt per student holds in every mode. The teacher form shows a warning under `each` and `end`: the key reaches a student before everyone has finished, so in a live session it can spread between students.

### 2. Navigation, per event

`events.navigation_mode` is one of:

- `free` (the default, and every existing event): back, next, skip and come back.
- `linear`: forward only, with no back button. Every question is committed as the student leaves it.

**Skip rule (decided here).** Under `linear` a student may skip a question explicitly, with a confirmation. A skip commits a blank answer, which scores zero, and the question cannot be revisited. Forcing an answer was the alternative; it was rejected because it pushes a student who does not know into guessing, which hides exactly what a formative check should show. The teacher sees a skip as "No answer."

The combination `each` + `free` locks answers on commit, but the student may still move freely among the questions they have not committed.

### 3. The per-question commit

`POST /api/attempts/:id/answers/:questionId/commit`, body `{ "response": <raw response> }`, `X-Attempt-Token` required (401 without, the same 404 as any wrong token or unknown attempt otherwise). `response: null` or no response is a skip.

- It is used only when a setting needs it (`policy.locksAnswers`: `each`, or `linear`). Otherwise it returns 409 `commit-not-used`, so `release` + `free` and `end` + `free` still take every answer at submit, as before.
- The answer is scored and stored in `answers` with `committed_at` set. It is final: a second commit returns 409 `answer-locked`.
- Under `linear` only the first uncommitted question may be committed; anything else returns 409 `out-of-order`.
- It refuses a submitted attempt (409 `already-submitted`), a reset one (409 `attempt-reset`), a question not in the event (404), and any commit after the deadline plus `SUBMIT_GRACE_SECONDS` (409 `time-up`; the page then submits).
- The response is `{ committed, progress }`, both built by `policy.js`. `committed` is `{ questionId, skipped }`, plus `result` (the perQuestion shape) only under `each`.

**Submit respects commits.** Committed rows are kept whatever the submit body says about those questions. Under `linear`, only the question the student is on (the first uncommitted one) takes its answer from the body; later questions were never shown, so they are stored blank. The total is the sum of every stored row.

**AI-scored answers under `each`** are stored pending at commit and picked up by the existing background job straight away (the answers table is its queue). Until the job finishes, the student's result says "Being marked", and the page checks back every 15 seconds. With AI off they become "Waiting for your teacher to mark this," as at submit.

### 4. What the student sees, all in `policy.js`

`policy.js` stays the only place that decides this:

- `studentMaySeeBreakdown(event)`: true under `each` and `end` (only submitted attempts have a result, so this means "after submit"), and under `release` once released.
- `committedAnswerView(event, item)`: the result only under `each`.
- `studentProgressView(event, items)`: the settings and committed answers, sent on start (`progress`) and on resume of an attempt in progress (`progress`, otherwise null).

`breakdownReleased(event)` keeps its meaning (teacher release or `end_at`), which is what the teacher's page reports for `release` events.

### 5. Quick setup presets

Presets live in `backend/content/presets.json`: each has an `id`, `label`, one-line `description`, a `filter` (the event filter shape), the `knobs` it offers, and optionally `aiScored` and `levelRequired`. At most three knobs:

- `who`: one audience, and optionally one of its levels, written `core` or `core:S1`, offered from the preset's own audiences.
- `emphasis`: `all`, `concepts`, `practices` or `perspectives`, which becomes `filter.nodes` set to that Brennan & Resnick root.
- `length`: `full`, or `short`, which sets `filter.limit` to `shortLength` (10).

A choice `{ id, who?, emphasis?, length? }` compiles to an ordinary filter (`src/presets.js`), which then goes through `selection.resolveSelection` like any other. `POST /api/question-bank/preview` and `POST /api/events` both accept `{ preset }`, so card count, preview count and event count come from one path. `GET /api/presets` (teacher only) returns the presets with their knob options, defaults and default counts. It leaves out a `who` option that matches nothing with the other knobs at their defaults, and an emphasis that matches nothing for any offered `who` (the core bank has no perspectives questions), so a card does not offer a setting that can only fail. A combination of two offered settings can still match nothing; the form then says so and blocks Create.

Checked at boot (`content.js`, then `db.js` once the content tables exist):

- each filter is valid as an event filter, with no `questionIds`
- a preset spanning several audiences offers `who`, so every compiled filter has one audience and fits the advanced picker
- a preset that fixes `nodes` cannot offer `emphasis`, and one that fixes `limit` cannot offer `length`
- a preset that names an AI-scored type must say `"aiScored": true`, and one that says so must name one; AI-scored questions stay opt-in
- every preset matches at least one question with its defaults

The shipped presets are: Core CT check (P5 to S2), RGSynapse Sec 1 starter, RGSynapse Sec 2, Debugging and AI-code review (the only one with `aiScored`), Loops and conditionals, Code ordering and tracing practice, and Mixed: everything for a level.

### 6. The question cap

`filter.limit` (an integer from 1 to 100) keeps at most that many of the matched questions: questions are grouped by level and, within a level, by their first learning outcome; groups are interleaved round-robin; the first `limit` are kept, in their original bank order (so AI-scored questions stay last). The same filter always keeps the same questions, and the summary on the event card says "at most N."

### 7. The teacher form

Quick setup cards are the default view, with the chosen card's knobs under it and a line showing the live count, points, AI use and the AI-off warning. Choosing a card fills the advanced picker, which stays available, collapsed, as "Customise"; while it is open it decides the questions, as before. The picker gains a "Most questions" field for `limit`. The legacy "Question set" select appears only if the presets fail to load, without the three broken RGSynapse options. The legacy `selectionMode` API is unchanged.

The two settings are small radio groups under the event's times. The event card and the results header show both. Under `each` and `end` the results header says when students see their results, and the Release button is hidden, because it would change nothing for students.

### 8. The student page

The page reads the settings from `progress`. Under `linear` there is no Back; Next needs an answer and commits it, and Skip (with a confirmation) commits a blank. Under `each`, Check answer commits and shows the result under the locked answer. The progress dots are filled when answered, dashed when skipped, square once locked, and faded ahead of the current question under `linear`; the strip also says "N answered, M skipped". A refresh resumes at the first uncommitted question under `linear`.

### 9. Storage

Migration `202609270609-assessment-settings` adds `events.feedback_mode` (default `release`), `events.navigation_mode` (default `free`), both with CHECK constraints, and `answers.committed_at`. Existing events and answers are unchanged in meaning.

## Consequences

- Existing events behave exactly as before: `release` and `free`, no commits.
- Under `each` and `end`, a student can pass the key to classmates still working. That is the teacher's choice, with a warning; one attempt per student still stops the repeated-attempt oracle for the student who saw it.
- Teachers see committed answers of attempts still in progress in `GET /api/events/:id/results` (with `committedAt`); the per-outcome summary still counts submitted attempts only.
- The student breakdown is now in question order even when answers were committed out of order.
- Presets are content: adding or changing one is a JSON edit and a restart, and a bad one stops the server with a list of problems.

## Open questions

1. Should the teacher be able to change the settings after creating an event, before anyone starts? Today they are fixed at creation, like the questions.
2. Should `each` show the key after a wrong answer, or only "incorrect" and let the student try again (for no marks)? Today it shows the key, as asked.
3. Should the event record which preset it came from? Today it records the filter only.
