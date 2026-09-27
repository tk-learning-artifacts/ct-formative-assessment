# ADR 0003: Assessment settings and quick setup

- **Status:** Accepted, 2026-09-27 (branch `feat/assessment-settings`; a follow-up round on `feat/settings-tweaks` the same day). Akmal asked for all three parts; the choices below that he did not specify are marked as decided here, and are open to his review. His answers to the three open questions of the first version, and the four from the follow-up round, are in "Decisions on the open questions" and sections 10 and 11.
- **Scope:** Two per-event settings (feedback timing and navigation), a per-question commit endpoint, quick setup presets for choosing questions, a question-count cap on filters, editing an event's settings after creation, and recording which preset an event came from. Builds on ADR 0001 §7 (selection) and §8 (answer-key protection).

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
- The response is `{ committed, progress }`, both built by `policy.js`. `committed` is `{ questionId, skipped }`, plus `result` (the perQuestion shape) only under `each`. Under `linear` it also has `next`: the public projection of the question the student moves on to, or null after the last.

**In-order delivery (decided by Akmal, 2026-09-27).** Under `linear` a student holds only the questions up to the one they are on, so the content of later questions never reaches the browser before the student gets there. `POST /api/attempts` sends the first question, each commit or skip sends the next one as `next`, and `GET /api/attempts/:id` sends the questions reached so far (the committed ones and the current one), including after submit. Both responses carry `questionCount`, the number in the test, so the progress strip still shows every dot. Free navigation sends every question at start, as before. An attempt that ran while the event's navigation was free was sent every question then, so after a switch to in order it keeps them all (the same `event_setting_changes` check as the submit rule in section 10), and only attempts started under in order are staged. A switch back to free sends every question on the student's next full read. The rule is `policy.deliveredQuestionCount`, applied by `db.deliveredQuestions`.

**Submit respects commits.** Committed rows are kept whatever the submit body says about those questions. Under `linear`, only the question the student is on (the first uncommitted one) takes its answer from the body; later questions were never shown, so they are stored blank. The total is the sum of every stored row.

**AI-scored answers under `each`** are stored pending at commit and picked up by the existing background job straight away (the answers table is its queue). Until the job finishes, the student's result says "Being marked", and the page checks back every 15 seconds. With AI off they become "Waiting for your teacher to mark this," as at submit.

### 4. What the student sees, all in `policy.js`

`policy.js` stays the only place that decides this:

- `studentMaySeeBreakdown(event)`: true under `each` and `end` (only submitted attempts have a result, so this means "after submit"), and under `release` once released.
- `committedAnswerView(event, item)`: the result only under `each`.
- `studentProgressView(event, items)`: the settings and committed answers, sent on start (`progress`) and on resume of an attempt in progress (`progress`, otherwise null).
- `studentStatusView(event, items)` (added 2026-09-27): the same for the status poll (section 10), with each committed answer as `{ questionId, skipped }`, plus its marking `status` (`pending`, `scored`, `needs-review`) only under `each`, where the result itself is visible. No result, key or feedback.
- `deliveredQuestionCount(event, …)` (added 2026-09-27): how many questions, from the first, a student may hold (section 3).
- `studentTotal(event, result)` (added 2026-09-27): the total in the submit response and in `result` of `GET /api/attempts/:id`. Once the breakdown is visible it is the full total. Before that, which happens only under `release`, it is the score of the questions marked the moment they were answered (every type without `requiresAi`), with `markedSoFar: true` and `pending` set to the number of non-blank AI-scored answers; the page shows "Marked so far: X / max (N answers still being marked)". Both numbers are fixed at submit, whatever the AI or the teacher does afterwards, because a total that rose when a mark arrived would tell the student whether their written answer earned credit, and so give away part of the breakdown. Hiding the total until release was the alternative; it was rejected (decided here) because an event with no AI-scored questions would lose the total its students see today, and the instant part reveals nothing. Teachers always see the full total.

Each function is given the event as it is now, never as it was when the attempt started, so a teacher's change to the settings (section 10) applies from a student's next request.

`breakdownReleased(event)` keeps its meaning (teacher release or `end_at`), which is what the teacher's page reports for `release` events.

### 5. Quick setup presets

Presets live in `backend/content/presets.json`: each has an `id`, `label`, one-line `description`, a `filter` (the event filter shape), the `knobs` it offers, and optionally `aiScored` and `levelRequired`. At most three knobs:

- `who`: one audience, and optionally one of its levels, written `core` or `core:S1`, offered from the preset's own audiences.
- `emphasis`: `all`, `concepts`, `practices` or `perspectives`, which becomes `filter.nodes` set to that Brennan & Resnick root.
- `length`: `full`, or `short`, which sets `filter.limit` to `shortLength` (10).

A choice `{ id, who?, emphasis?, length? }` compiles to an ordinary filter (`src/presets.js`), which then goes through `selection.resolveSelection` like any other. `POST /api/question-bank/preview` and `POST /api/events` both accept `{ preset }`, so card count, preview count and event count come from one path. `GET /api/presets` (teacher only) returns the presets with their knob options, defaults and default counts. It leaves out a `who` option that matches nothing with the other knobs at their defaults, and an emphasis that matches nothing for any offered `who` (the core bank has no perspectives questions), so a card does not offer a setting that can only fail. A combination of two offered settings can still match nothing; the form then says so and blocks Create.

Checked at boot (`content.js`, then `db.js` once the content tables exist):

- `shortLength` is an integer from 1 to 100, the largest `filter.limit` an event accepts
- each filter is valid as an event filter, with no `questionIds`
- a preset spanning several audiences offers `who`, so every compiled filter has one audience and fits the advanced picker
- a preset that fixes `nodes` cannot offer `emphasis`, and one that fixes `limit` cannot offer `length`
- a preset that names an AI-scored type must say `"aiScored": true`, and one that says so must name one; AI-scored questions stay opt-in
- every preset matches at least one question with its defaults

The shipped presets are: Core CT check (P5 to S2), RGSynapse Sec 1 starter, RGSynapse Sec 2, Debugging and AI-code review (the only one with `aiScored`), Loops and conditionals, Code ordering and tracing practice, and Mixed: everything for a level.

### 6. The question cap

`filter.limit` (an integer from 1 to 100) keeps at most that many of the matched questions: questions are grouped by level and, within a level, by their first learning outcome; groups are interleaved round-robin; the first `limit` are kept, in their original bank order (so AI-scored questions stay last). The same filter always keeps the same questions, and the summary on the event card says "at most N."

### 7. The teacher form

Quick setup cards are the default view, with the chosen card's knobs under it and a line showing the live count, points, AI use and the AI-off warning. Choosing a card or knob fills the advanced picker, which stays available, collapsed, as "Customise"; while it is open it decides the questions, as before. Once the teacher changes anything in Customise, closing it no longer refills the picker from the card, so their edits are there when they reopen it; choosing another card or knob starts again from that card. The picker gains a "Most questions" field for `limit`. The legacy "Question set" select appears only if the presets fail to load, without the three broken RGSynapse options. The legacy `selectionMode` API is unchanged.

The two settings are small radio groups under the event's times. The event card and the results header show both. Under `each` and `end` the results header says when students see their results, and the Release button is hidden, because it would change nothing for students. In the single-column layout (below 1000 px wide) the chosen event's results come first, above the new-event form and the event list, and choosing an event from the list scrolls to them (added 2026-09-27); the desktop layout is unchanged. Only the order on screen moves: the tab order still starts at the form.

### 8. The student page

The page reads the settings from `progress`. Under `linear` there is no Back; Next needs an answer and commits it, and Skip (with a confirmation) commits a blank. Under `each`, Check answer commits and shows the result under the locked answer; a wrong answer shows the correct one beside it. While a commit is in flight the answer area is inert, so the locked answer drawn afterwards is what the server stored. A Skip that meets `time-up` submits with that question blank, whatever was typed into it. If a commit's response is lost and the retry gets `answer-locked`, the page fetches the attempt and shows that question's stored result, rather than moving on. The progress dots are filled when answered, dashed when skipped, square once locked, and faded ahead of the current question under `linear`; the strip also says "N answered, M skipped". Under free navigation each dot is a button (a 32 px target, labelled in words such as "Question 4, answered, locked", with `aria-current="step"` on the current one) that saves the answer on screen, as Next does, and jumps to that question; a committed question opens read-only, as it does through Back and Next. Under `linear` the dots are not interactive. On a phone a long row scrolls sideways, kept scrolled to the current question, instead of taking several lines of the sticky strip. A refresh resumes at the first uncommitted question under `linear`.

### 9. Storage

Migration `202609270609-assessment-settings` adds `events.feedback_mode` (default `release`), `events.navigation_mode` (default `free`), both with CHECK constraints, and `answers.committed_at`. Existing events and answers are unchanged in meaning.

### 10. Editing an event's settings (decided by Akmal, 2026-09-27)

`PATCH /api/events/:id`, owner only (another teacher's event is the same 404 as a missing one), changes any of `title`, `feedbackMode`, `navigationMode`, `durationMinutes`, `startAt` and `endAt`, validated as at creation: absolute ISO times only, and the deadline later than the opening time, checked against the stored value of whichever one is not in the body. `null` or an empty value clears a time limit or a time. Anything else is refused with 400; the question set (`filter`, `preset`, `selectionMode` and similar) has its own message, because students' answers refer to the snapshot in `event_questions`. The response is `{ event, changes, attemptsUpdated }`.

A teacher may edit at any time, including once students have started. What happens to attempts already running or finished:

- **Feedback timing** is read from the event on every request (section 4), so there is nothing to migrate. Loosening (`release` to `end` to `each`) shows a submitted student their breakdown on their next request, and under `each` shows the results of answers already committed. Tightening (`each` to `release`) hides results from then on: committed answers stay committed and locked, and are listed as `{ questionId, skipped }` without a result; a submitted attempt shows its total only until release. If the new pair no longer locks answers (`release` or `end` with `free`), the commit endpoint answers `commit-not-used` and the remaining answers arrive at submit, which keeps every committed row.
- **Navigation, free to in order:** from then on the student cannot go back. The page moves them to the first question with no answer, committed or typed, and commits, in order, the answers they had given before it (the commit endpoint's in-order rule accepts exactly that sequence). Questions they answered further on keep their typed answers. Because the attempt ran while navigation was free, its submit takes the body's answer for every uncommitted question, not only the current one; an attempt that started after the change gets the in-order submit rule in full (`db.submitAttempt` checks `event_setting_changes` for a `navigation_mode` change from `free` after the attempt started).
- **Navigation, in order to free:** the student moves freely among the questions they have not committed. Committed ones stay locked.
- **No change ever unlocks a committed answer.** A second commit is always `answer-locked`, and submit always keeps committed rows.
- **Time limit and deadline:** every attempt still in progress (not submitted, not reset) gets `deadline_at` recomputed as the earlier of its start plus the time limit and the event's deadline, the same rule as at start, or null when neither is set. A deadline that has already passed is not enforced at the moment of the edit: the next commit gets `time-up`, and the page submits; the submit is stored and flagged late under the usual `SUBMIT_GRACE_SECONDS` rule. Nothing is lost. Changing the opening time does not affect attempts that have started.
- **The student page** checks the current settings and deadline after every move between questions and every 30 seconds (every 15 while an answer is being marked) with `GET /api/attempts/:id?fields=status` (added 2026-09-27). That response carries only `attempt` (`id`, `status`, `deadlineAt`, `late`), `serverNow`, `progress` from `policy.studentStatusView` and the total from `policy.studentTotal`, with no question content or key; any other `fields` value is a 400. Only when it differs from what the page holds (a setting, the deadline, a commit, a marking status, or the attempt no longer in progress) does the page fetch the full attempt, so questions are downloaded on first load, on resume and after a change, not on every poll. The results page polls the same way while answers are being marked. The page restarts the timer when the deadline changes, and shows a one-line note on what the teacher changed. It redraws the question only when something it shows has changed, so a student typing is not interrupted by a result arriving for another question. The 30-second interval (decided here, not a placeholder) is fixed and not configurable.
- **Audit trail:** migration `202609271500-event-setting-changes` adds `event_setting_changes` (event, teacher, field, old value, new value, time), one row per field that actually changed; an edit that repeats the stored value writes nothing. `GET /api/events/:id/results` returns them newest first as `settingChanges`, and the results view lists them under "Settings history."

The teacher's "Edit settings" form sits in the results view, with a note on what changes for students in progress and a line saying the questions cannot change. It sends only the fields the teacher touched. Choosing a feedback timing stricter than the event's current one (`each` to `end` to `release`, in that strictness order) shows a one-line warning under the setting: "Students who already saw answers keep what they saw; this only stops showing them from now on." Loosening or leaving it alone shows nothing.

The join code is not in `EDITABLE_SETTINGS`: `PATCH /api/events/:id` refuses a `joinCode` key with its own 400 message, because a student who already has the code would be stranded if it moved.

**Marking before submit (decided here).** Under `each` with AI off, a committed AI-scored answer becomes "Waiting for your teacher" at once. The teacher can now mark a committed answer of an attempt still in progress, so the student sees the mark on their next request. The attempt's total still appears only after submit, which sums every row, marks included; under `release` the student sees only its instantly marked part until release (section 4). Answers on a reset attempt cannot be marked, and the scoring job no longer sends them to the AI provider.

### 11. Preset provenance (decided by Akmal, 2026-09-27)

Migration `202609271501-event-preset-provenance` adds `events.preset_id`, `events.preset_options_json` (the knob values, with defaults filled in for any left out) and `events.preset_customised`. An event created from a card (`{ preset }`) records the preset with `customised` 0. The form sends `{ filter, basedOnPreset }` when Customise is open; the server compiles `basedOnPreset` and sets `customised` only if the filter differs from it (lists compared in any order), so opening Customise and changing nothing still reads as the preset. An event from the advanced picker alone, the legacy question set, or before this migration has no preset.

The teacher event APIs return `preset: { id, options, customised, summary }` or null. `summary` (for example "Loops and conditionals (RGSynapse Secondary 1, short)") leaves out an audience note that says nothing beyond the label, and falls back to the preset id if the preset has since been removed. The event card and results view say "From preset: …", with ", then customised" when that applies, or "Custom selection." Students never see it.

**The label is captured at creation, not looked up (decided by Akmal, 2026-09-27).** Migration `202609271700-preset-label-snapshot` adds `events.preset_label`: the `summary` text as it read the moment the event was made, computed once from `presets.json` at creation time and stored alongside `preset_id`. `summary` above is now this stored value, not a fresh lookup, so renaming or removing a preset in `presets.json` never changes an older event's card. The migration backfills `preset_label` for every event that already has a `preset_id`, from the `presets.json` in place when the migration runs, since that file is the closest available record of what the teacher saw.

## Consequences

- Existing events behave exactly as before: `release` and `free`, no commits.
- Under `each` and `end`, a student can pass the key to classmates still working. That is the teacher's choice, with a warning; one attempt per student still stops the repeated-attempt oracle for the student who saw it.
- Teachers see committed answers of attempts still in progress in `GET /api/events/:id/results` (with `committedAt`); the per-outcome summary still counts submitted attempts only.
- The student breakdown is now in question order even when answers were committed out of order.
- Presets are content: adding or changing one is a JSON edit and a restart, and a bad one stops the server with a list of problems.
- A teacher's mid-event change reaches students within about 30 seconds, or on their next move. Tightening feedback cannot take back a key a student has already seen; it only stops showing it.
- Each running student page makes one small status GET every 30 seconds, with no questions in it. For a class of 40 that is under 2 requests a second. A change of title alone is not in the status response, so it reaches a student on their next full read (a resume, or any other change).
- Under in-order navigation a student cannot read ahead: later questions are not in any response until they reach them.
- Before release, a student's total under `release` leaves out AI-scored questions, so it is lower than the teacher's total for the same attempt until release.
- A preset renamed or removed in `presets.json` leaves the "From preset" line of older events exactly as it read when they were made; only an event created after the change picks up the new wording.
- A join code cannot be reassigned once an event exists. A teacher who wants a different code creates a new event.

## Decisions on the open questions

The first version of this ADR left three questions open. Akmal answered them on 2026-09-27:

1. **Can the teacher change an event's settings after creating it?** Yes, even after students have started. See section 10. The question set stays fixed.
2. **Should `each` show the correct answer after a wrong one?** Yes, as built. `event-settings-edit.test.js` covers it for a committed wrong answer.
3. **Should the event record which preset it came from?** Yes, with the knob values and whether it was customised. See section 11.

A follow-up round on 2026-09-27 raised four more:

4. **Should tightening feedback timing on a live event warn the teacher?** Yes. The Edit settings form warns when the chosen mode is stricter than the event's current one; see section 10.
5. **Should a preset's card wording follow renames in `presets.json`, or freeze at creation?** Freeze. See "The label is captured at creation, not looked up" in section 11.
6. **Should the student page's poll interval change?** No. 30 seconds stays fixed; see section 10.
7. **Can a teacher change an event's join code after creating it?** No. `PATCH /api/events/:id` refuses it with 400, because a student who already has the code would be stranded if it moved. See section 10.
