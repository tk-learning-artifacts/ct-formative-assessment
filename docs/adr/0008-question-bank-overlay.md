# ADR 0008: A database overlay for reviewing and editing the question bank

- **Status:** Accepted, 2026-09-29. Akmal decided the storage (an overlay in SQLite, not edits to the JSON), the editable fields, and admin-only edits. The details below that he did not specify are decided here and open to his review.
- **Scope:** How teachers flag, comment on, edit and retire bank questions, and how the teacher page shows a question as a student sees it. Builds on ADR 0004 (roles) and ADR 0007 (visuals).

## Context

Questions are JSON files in `backend/content/questions/`, loaded at start-up and copied into `bank_questions`. The question bank on the teacher page was an answer-key inspector. Its author wanted to review every question as a student would see it, and to flag questions and adjust their metadata without a code change.

## Decision

### 1. The JSON stays the source of truth; edits are an overlay in SQLite

The app never writes `backend/content/`. A table `question_overrides`, keyed by question id, holds nullable overrides of level, points, topic, qType, difficulty, ontology, outcomes and the teacher-only details note, plus retired and flagged state. `applyOverride` lays the non-null fields over the JSON question. Start-up applies it before filling `bank_questions`, and `refreshQuestion` rewrites one question's rows after each edit, so SQL selection sees merged values. The table has no foreign key to `bank_questions`, because start-up rebuilds that table each boot.

The alternatives were writing back to the JSON (only works beside the repo, not in the Docker deploy, and churns the files) and keeping flags in the database but metadata in JSON (two places to look). A later step can export overrides back into the JSON.

### 2. Edits are validated as the JSON is

A patched question passes the same `validateQuestion` and the type's own check as content does, so an edit cannot produce a question the loader would reject. Points are capped at 100, strings at 100 characters (details 5000) and lists at 50. An override the JSON later makes invalid is skipped at boot, logged, and reported as `stale` on the bank entry, and clearing the bad field repairs it.

### 3. Edits reach only events created afterwards

An event copies each question into `event_questions` when it is created, and an answer stores its own `max_points`. Scoring, results and outcome summaries read those copies, so changing points or level cannot alter an existing event or attempt. The interface says so wherever it offers an edit.

### 4. Retiring hides a question from new events

`bank_questions.retired` is set from the overlay. Every selection path adds `retired = 0`, including explicit question ids. The bank still lists retired questions, and the picker's counts leave them out. Retiring or editing is refused (409) if it would leave a preset with no question. Because a later content edit could still empty a preset, start-up logs that case when retirements are involved and carries on, so the running app can restore the question.

### 5. Who may do what

Any signed-in teacher reads the bank, flags a question and adds a comment (append-only, with the author). Only an admin edits metadata or retires and restores (ADR 0004 §9). Every write goes into `question_override_changes`, one row per changed field.

### 6. The review pane reuses the student renderers

`web/question-view.js` draws the question and answer cards for both the student page and the teacher page, so the review view cannot drift from what students see. `GET /api/question-bank` returns for each question the teacher shape, the public (student) shape from `toPublicQuestion`, the overlay, the original values and the comments. The pane shows one question at a time, because the student renderers use fixed element ids and Blockly mounts an editor per question. Nothing entered in the pane is sent or stored.

## Consequences

- A teacher can step through the whole bank with the keyboard, see each question as a student does, and reveal the key on demand.
- A stale override or a retirement never stops the app from starting.
- Edits made on one server are not in git. Moving them into the JSON is a manual step until an export exists.
- Comments have a `resolved_at` column but no route to set it yet.
