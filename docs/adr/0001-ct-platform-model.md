# ADR 0001: CT platform model

- **Status:** Accepted, 2026-09-26; revised after review on 2026-09-27. Akmal decided the framework (decision A) and the AI data policy (decision B) on 2026-09-26, and the provider, consent, feedback visibility, capabilities and answer-key protection policy on 2026-09-27. Only the items under "Still open" remain undecided.
- **Scope:** Phase 1, the shared core. Phase 2 (new question-type UIs, the teacher's LO/capability picker, Sec 1/2 content, the AI feature) builds on the schema and API fixed here.

## Context

CT Quest began as a single 20-question Bebras-style multiple-choice quiz (5 each for P5, P6, S1, S2) with a teacher portal. It is growing into a general computational thinking (CT) formative-assessment platform:

1. A second audience, **RGSynapse**: Raffles Girls' School Sec 1 and Sec 2 students who already know some Swift and Python and build with AI assistants ("vibe coding"). The original P5 to S2 flow stays the default and stays simple.
2. Scale beyond one hard-coded bank.
3. Room for new question types, including AI-scored ones later.
4. An ontology of CT, stored as data, that questions map onto.
5. Teachers choose learning outcomes (LOs) and capabilities when creating an event.

Before this change the question bank lived in `web/questions.js`, which `express.static` published with every answer key. Events could only pick `ALL/P5/P6/S1/S2`. The schema was created with `CREATE TABLE IF NOT EXISTS`, which cannot add columns to the database already in the Docker volume.

## Decision

### 1. Content is data, loaded from `backend/content/`

Everything that describes *what* is assessed lives in JSON under `backend/content/`, never in `web/` and never hard-coded in logic:

| File | Holds |
|---|---|
| `audiences.json` | Levels (P5, P6, S1, S2, in order) and audiences (`core`, `rgsynapse`) with the levels each offers |
| `ontology.json` | The CT ontology: framework metadata, crosswalk vocabularies, nodes |
| `learning-outcomes.json` | LOs mapped to ontology nodes, with level and audience bands |
| `questions/*.json` | Question banks, one file per bank (`core.json`, `rgsynapse.json`) |
| `legacy-modes.json` | The question ids each legacy `selectionMode` (`ALL`, `P5` to `S2`) stands for |

`src/content.js` loads and validates all of it as one unit at boot. Any error stops the server with a list of every problem: an unknown tag, a key pointing outside the options, a cycle in the ontology, an LO that does not cover a tagged question's level, or a legacy mode listing a non-core question. `db.js` then replaces the content tables with the file contents inside one transaction, so filters run as indexed SQL. Content files are the source of truth; the tables are a read model rebuilt on every boot.

Question order is stable: files load in name order, and questions keep their order within a file. That order is `bank_questions.position`, and every selection is sorted by it.

### 2. The CT ontology

Nodes have `id`, `kind` (`concept`, `practice` or `perspective`), `label`, `description`, `parent` (one parent or `null`), `prerequisites` (a list of node ids), `sources` (`{framework, term}` citations) and an optional `crosswalk`.

Edges are derived from those fields into `ontology_edges`:
- `parent_of`: from the parent to the child. A filter on a node also matches questions tagged with any descendant.
- `requires`: from a node to each prerequisite. Stored for the picker and future sequencing; no Phase 1 logic reads it.

The validator rejects unknown parents or prerequisites, cycles in either graph, and a child whose kind differs from its parent's.

**Framework (decision A, decided): Brennan & Resnick (2012).** The three root nodes and their direct children are Brennan & Resnick's dimensions and nothing else. The validator enforces this: any node in the top two levels must cite `brennan-resnick-2012`.

- Concepts: sequences, loops, events, parallelism, conditionals, operators, data.
- Practices: experimenting and iterating (the paper's "being incremental and iterative"), testing and debugging, reusing and remixing, abstracting and modularizing.
- Perspectives: expressing, connecting, questioning.

CT Quest adds finer-grained sub-nodes below these where the existing questions or the Sec 1/2 content need them. Each cites the `ctquest` framework. Examples: `concept.operators.logic`; `concept.data.representation.binary`, `.text` and `.encryption`; `concept.data.structures.paths` and `.search-sort`; `practice.testing-debugging.tracing`, `.edge-cases` and `.reviewing-ai-code`; `practice.reusing-remixing.translating` and `.ai-assisted`; `practice.abstracting-modularizing.decomposition`, `.generalisation` and `.invariants`; `perspective.questioning.ai-output`.

Crosswalks are secondary tags, not structure. `framework.crosswalks` declares each vocabulary and its allowed values. Nodes and questions may carry `crosswalk: { bebrasCategory }`, and nodes may carry `crosswalk: { bebrasSkill }`. The validator rejects unknown vocabularies and values. Nothing filters on crosswalks in Phase 1.

Alternatives considered:

- **Bebras two-dimensional categorisation** (Dagiene, Sentance & Stupuriene, 2017): informatics domains crossed with CT skills (abstraction, algorithmic thinking, decomposition, evaluation, generalisation). It fits the original 20 puzzles, which are Bebras-style. But it categorises tasks rather than describing learning, it has no practices or perspectives for debugging or working with AI, and its domain axis is about computing topics rather than thinking. Kept as a crosswalk.
- **Singapore MOE Computing syllabus** (lower and upper secondary Computing): locally recognisable to teachers. But it is a syllabus of topics and programming content for students who take Computing, it does not cover P5/P6, and it changes by syllabus revision. Mapping LOs to it is a good Phase 2 addition as another crosswalk if schools ask for it.
- **A blend** (the original proposal): more coverage, but two top-level vocabularies make the picker harder to explain, and it invites arguments about where a node belongs. Anchoring on one framework and adding sub-nodes gives the same coverage with a single tree.

Changing framework later means editing `ontology.json`, `learning-outcomes.json` and the question tags, then restarting. No code or migration changes. Event snapshots keep the tags they were created with.

### 3. Learning outcomes

Each LO has `id`, `statement`, `nodes` (at least one ontology node), `levels` (at least one level) and `audiences` (optional; empty means every audience). They are stored in `learning_outcomes`, `outcome_nodes`, `outcome_levels` and `outcome_audiences`. A question tagged with an LO must fall inside that LO's level and audience bands; the validator checks this. There are 13 LOs in Phase 1: 9 for the core audience only, 3 for RGSynapse only, and `LO-DEBUG-1`, which covers both.

### 4. Audience and level

`level` stays a first-class field (P5, P6, S1, S2; more can be added in `audiences.json`). `audience` is a second field. RGSynapse Sec 1 questions are `audience: "rgsynapse", level: "S1"`. A filter that names no audience gets `["core"]`, so a P5 or S1 cohort never receives RGSynapse questions by accident; naming `["core", "rgsynapse"]` returns both. Level stays one filter among several, and the new content does not need a pseudo-level.

### 5. Question schema v2

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique across all banks, e.g. `P6-01`, `RGS-S1-02` |
| `type` | yes | A registered, active type. `mcq` now |
| `audience`, `level` | yes | Level must be offered by the audience |
| `title`, `prompt` | yes | Plain text; `prompt` keeps line breaks |
| `art` | no | Monospaced figure (grids and similar) |
| `code` | no | `{ language, source }`, shown in a code block |
| `points` | yes | Positive integer |
| `difficulty` | yes | Integer 1 to 5. Initial values follow level (P5=1 ... S2=4) and should be recalibrated from response data |
| `ontology` | yes | At least one node id |
| `outcomes` | yes | At least one LO id |
| `crosswalk` | no | `{ bebrasCategory }` |
| `topic`, `qType` | no | Display labels kept from v1. `qType` is a puzzle-style label, not the scoring type |
| `details` | no | Teacher-only focus note. Never sent to students, because it often names the method or the answer |
| type-specific | per type | For `mcq`: `options` (at least 2, distinct) and `answer: { index }` |

Correct-answer positions in the shipped banks are balanced (six keys at each of positions 0 to 3), so "always pick B" earns nothing in particular.

Reserved types have a module file each but no scorer, and the loader rejects questions that use them:

- `multi-select`
- `code-trace`: the student types the output
- `parsons`: the student orders code lines
- `short-answer`: matched against accepted answers
- `open-response-ai`: scored by the AI provider against `rubric: [{ id, description, points }]`

### 6. Question types as plug-ins

**Server.** Each type is one module in `src/scoring/types/<type>.js`. `src/scoring/index.js` loads every file in that folder, so adding a type means adding a file. An active type exports:

- `type`, `label`, `status: "active"`
- `publicFields`: what a student sees beyond the shared `BASE_PUBLIC_FIELDS`
- `sample`: a valid example, used by tests that run over every type
- `validate(question)`: returns a list of errors
- `normalizeResponse(raw, question)`: the value to score, or `null`
- `recordResponse(question, response)`: the JSON stored in `answers.response_json`. It must describe what the student saw; MCQ stores `{ index, text }`
- `score(question, response)`: returns `{ status, earned, max, correct, detail }`
- `legacyColumns` (optional): fills the v1 `chosen_index` and `correct_index` columns

A reserved type exports only `type`, `status: "reserved"`, `label` and `description`. Students only ever receive the base fields plus the type's `publicFields`, so secret fields (`answer`, `rubric`, `solution`, `details`) never leave the server unless a type lists them. A test builds each active type's `sample` with every secret field added and asserts the projection drops them all.

`status` is `scored` for synchronous types. AI-scored types store `pending` at submit, and a background job later sets `scored` or `needs-review` and fills `answers.detail_json` (§10), so a submission never waits on a model.

**Client.** `web/type-registry.js` loads every renderer in `web/types/`, as listed by `GET /api/web-types` (derived from the folder). A renderer registers `renderInput(question, response, h)`, `readResponse(container, question)` and `describeResponse(response, h)`, and the student page and the results view dispatch through it. `web/types/mcq.js` is the first renderer. The static allowlist is derived from `web/` too: its `.html`, `.css` and `.js` files except `*.config.js`, plus `web/types/*.js`.

To add a type: add `backend/src/scoring/types/<type>.js`, `web/types/<type>.js`, and a solver or matcher in the answer-key test. No shared file changes.

### 7. Event selection

`POST /api/events` accepts either the legacy `selectionMode` or a v2 `filter`:

```json
{
  "audiences": ["rgsynapse"],
  "questionIds": ["RGS-S1-01", "RGS-S2-02"],
  "levels": ["S1", "S2"],
  "outcomes": ["LO-AI-REVIEW-1"],
  "nodes": ["practice.testing-debugging"],
  "types": ["mcq"],
  "difficulty": { "min": 2, "max": 4 }
}
```

Every key is optional, and a missing or empty `audiences` becomes `["core"]`. Keys combine with AND; values within a key combine with OR. `nodes` includes descendants. The following return 400 with every reason:

- unknown keys, ids, levels or audiences
- reserved types
- a `difficulty` that is not an object, or an inverted band
- a filter that matches nothing

Backward compatibility: each legacy `selectionMode` maps to `{ audiences: ["core"], questionIds: [...] }` using the ids pinned in `legacy-modes.json` (the original 20 for `ALL`, five per level otherwise). Adding core questions therefore never changes what `ALL` or `S1` selects, and a test covers exactly that. An event stores `selection_mode` (the legacy value, or `FILTER`) and `filter_json` (the canonical filter it was built from). Events snapshot their questions into `event_questions` at creation, so later content edits never change a running event.

"Capabilities" in goal 5 means the ontology nodes a teacher picks plus the question types, which together decide what an event tests (decided 2026-09-27). The API takes `nodes` and `types`.

`POST /api/question-bank/preview` runs the same selection function as event creation, so its `count` always equals the created event's question count.

Event times must be absolute ISO 8601 strings with `Z` or an offset. A bare `2026-10-01T09:00` is rejected, because the server (UTC in Docker) would read it in its own zone. The teacher page converts `datetime-local` input with `new Date(value).toISOString()`. `durationMinutes` is capped at 1440 (24 hours).

### 8. Answer keys, attempts, results and teachers

**Static files and responses**
- Only the files described in §6 are served from `web/`. Any other path with a dot in its last segment returns 404. Unknown `/api/*` routes return a JSON 404.
- Join, start, resume and submit responses never contain answer fields, `details`, or per-question correctness before release.

**Attempt tokens**
- Starting an attempt returns a 32-byte random `token`; only its SHA-256 hash is stored.
- Submit and `GET /api/attempts/:id` require it in `X-Attempt-Token`. A missing token is 401. A wrong token and a non-existent attempt get the same 404 body, so attempt ids cannot be enumerated.
- An attempt from before the upgrade (no stored token) gets a 403 telling the student to start again. That check runs before the token check so the message is reachable. Such attempts do not count towards the one-attempt rule.

**Deadlines**
- `attempts.deadline_at` is fixed at start as the earlier of start + duration and the event's `end_at`, and is set whenever either exists.
- A submission within `SUBMIT_GRACE_SECONDS` (default 60) of the deadline counts as on time. A later one is still stored, with `attempts.late = 1`, and teachers see it marked late.
- The student page shows a countdown and auto-submits at zero. Failed submissions (network errors or 5xx) are retried with backoff (1, 2, 4, 8, 15, 30 … 60 s). Students can submit from any question, with a confirmation when some are unanswered.
- The token, answers and position are kept in `sessionStorage`, so a refresh resumes the same attempt through `GET /api/attempts/:id`. Storage access is wrapped in try/catch, and the test still works without it.

**Answer-key protection (decided by Akmal, 2026-09-27; all in `src/policy.js`)**
- **One attempt per student per event.** A student is their name plus class group, normalised with NFKC, trimmed, internal whitespace collapsed and lower-cased (`attempts.student_key`).
  - A second start returns 409 with a code: `already-submitted`, `attempt-expired`, or `attempt-in-progress`.
  - For `attempt-in-progress` the response includes the attempt id, so a tab that holds that attempt's token resumes it. Without the token the student must ask the teacher.
  - The check and the insert share one synchronous transaction, so two simultaneous starts cannot both succeed.
- **Teacher reset.** `POST /api/events/:id/attempts/:attemptId/reset` (owner only) sets `reset_at` and `reset_by`. The attempt is kept for the record and can no longer be submitted, and the student may start again.
- **Results release.** On submit the student sees only the total. The per-question breakdown is returned by `GET /api/attempts/:id` only once `end_at` has passed or the teacher calls `POST /api/events/:id/release` (sets `events.results_released_at`). The breakdown covers which questions were right, the chosen and correct options, and AI feedback in `detail_json`.
  - Before release the student page says the teacher will release the breakdown.
  - Events that existed before the migration are marked released, so their behaviour does not change.
- Together these stop the repeated-attempt oracle: with one attempt and no per-question feedback, four submissions of all-0s, all-1s, all-2s and all-3s under one name get one total and three 409s. A test checks this.

**Teachers and secrets**
- Teachers see and act on only events whose `created_by` is their user id. Another teacher's event returns 404, the same as a missing one.
- Passwords are stored as `scrypt$<salt>$<hash>` with a random 16-byte salt per user and compared with `crypto.timingSafeEqual`. Legacy fixed-salt hashes still verify and are rewritten on the next successful login.
- `SEED_TEACHER_EMAIL` and `SEED_TEACHER_PASSWORD` create the first account in an empty database.
- With `NODE_ENV=production` the server refuses to start in any of these cases:
  - `JWT_SECRET` is missing
  - `SEED_TEACHER_PASSWORD` is missing or equals the demo password `changeme123`
  - any stored account still verifies against the demo password, including one seeded by the original code
- `npm run set-password -- <email>` fixes an account. It reads the password from `NEW_PASSWORD` or stdin (hidden prompt on a terminal), never argv.

### 9. Storage and migrations

SQLite stays (better-sqlite3 12.9). Postgres is out of scope; the README documents that path.

Migrations live in `src/migrations/YYYYMMDDHHMM-<slug>.js`. The file name is the id. The runner loads the folder, runs files in sorted order, and records each id in `schema_migrations(id, applied_at)`, skipping ids already recorded. Timestamped names mean two Phase 2 branches can each add a migration without fighting over "number 4". When merging, check only that their relative order is right.

1. `202609260000-baseline`: the original schema, `IF NOT EXISTS`. Databases made by the original code have these tables, no `schema_migrations` table and `user_version` 0, so they upgrade from here like a fresh database.
2. `202609260100-platform-core`:
   - `events.filter_json`, and `results_released_at` (set for every existing event).
   - `attempts.token_hash`, `deadline_at` (backfilled as the earlier of start + duration and `end_at`), `late`, `student_key` (backfilled), `reset_at` and `reset_by`.
   - `answers` rebuilt with a nullable `correct_index` plus `question_type`, `response_json`, `score_status` and `detail_json`. Migrated MCQ rows record `{ index, text }`, the chosen option's text from the snapshot the student answered.
   - The content tables and indexes.
   - v1 snapshots rewritten to the v2 shape, with ontology and outcome tags backfilled from the bank question of the same id.
3. `202609260200-fix-answer-keys`: patches P5-01, P6-01, S1-01 and S2-02 inside snapshots, but only for events with no submitted attempts. An event that already has submissions keeps the snapshot its students saw, so the snapshot, the stored answers (which also carry the chosen text) and the awarded scores stay consistent, and the teacher's view never pairs an old answer with changed option text. The cost: further students on such an event still see the flawed question, and the teacher should start a new event. The migration logs each event it leaves unpatched.

Each migration runs in a transaction together with its `schema_migrations` row. Foreign keys are switched off around the run (SQLite ignores that pragma inside a transaction), and `foreign_key_check` must pass before each commit. Migrations receive `ctx.content`, the validated content, for lookups like the tag backfill.

A database that already holds data is copied with `VACUUM INTO` next to itself (`app.pre-<latest>-from-<last>-<time>.db`) before upgrading. The runner refuses a database that records a migration this code does not know, and a pre-review database numbered only by `user_version`. Never edit a shipped migration.

Indexes cover every per-request query:
- events by `created_by`, snapshots by event, attempts by event and by `(event_id, student_key)`, answers by attempt;
- the content lookups: `bank_questions (audience, level, type, difficulty)`, `question_nodes (node_id)`, `question_outcomes (outcome_id)`, `outcome_levels (level)`, `ontology_edges (to_id, kind)`.

### 10. AI inference extension point (decision B, decided)

Phase 1 ships the interface and guardrails only. No provider adapter is implemented and no request leaves the server. The app is complete without AI.

- **Configuration:** `AI_PROVIDER` (default `none`), `AI_API_KEY` and `AI_MODEL`, from the environment only. An unknown provider, or a provider without a key, fails at startup. `GET /api/catalog` reports `ai.enabled`.
- **Guarded provider** (`src/ai/index.js`). An adapter registers as `providers[name] = config => ({ complete(request) })`, but callers never see it. `createAiProvider` returns a frozen object whose only method is `score(payload)`.
  - It accepts exactly one argument, and only a payload made by `buildScoringPayload` (tracked in a `WeakSet` and deep-frozen).
  - It builds the whole request itself: `{ system: SCORING_SYSTEM_PROMPT, payload, schema: buildScoreSchema(from the payload), maxTokens }`.
  - Callers cannot pass a system prompt, a schema or any other key.
  - `scoreWithAi` refuses unknown arguments too.
- **No student personal data goes to a provider, enforced by structure** (`src/ai/payload.js`). `buildScoringPayload({ store, eventId, questionId, responseText, studentName, studentGroup })` takes ids, not content.
  - It looks up the question in the event snapshot (or the bank) and the LO statements in the validated content. A caller-supplied question or outcome object is refused.
  - The output shape is fixed: `task`, the question's prompt, code, level, audience, max points, LO statements and rubric, plus the scrubbed response text. There is no field for a name, class group, attempt id, token or email.
  - `studentName` and `studentGroup` are required, are used only to scrub, and are never sent.
- **Known risk: personal data inside the response text.** `scrubResponseText` redacts:
  - email addresses
  - NRIC/FIN-shaped ids
  - phone numbers (`+65 9123 4567`, `+6591234567`, `9123-4567`, other `+` international numbers)
  - the student's name and group, whole and each part with at least two letters. Matching is Unicode-aware, on letter boundaries (`(?<![\p{L}\p{N}\p{M}])…`), and on plain substrings for scripts written without spaces, such as Chinese or Thai.

  It will still miss other people's names, nicknames and indirect identifiers, and very short name parts can over-redact ordinary words. Adversarial tests cover each hole found in review.
- **Structured output only** (`src/ai/schema.js`). The provider must return `{ criterionId, score, feedbackCode, feedback? }`, and no other keys are allowed:
  - `criterionId` is one of the question's rubric ids.
  - `score` is an integer equal to that criterion's points, within 0 to max.
  - `feedbackCode` is one of `correct`, `partially-correct`, `misconception`, `incomplete`, `off-topic` or `needs-teacher-review`.
  - `feedback` is at most 200 characters of single-line plain text. Control, format (bidi overrides, zero-width), line/paragraph separator, private-use and unassigned characters, and `<` `>`, are rejected.

  `buildScoreSchema` produces the matching JSON Schema, and `validateModelScore` checks every reply on receipt.
- **Fallback:** `scoreWithAi` never throws. AI disabled, a rejected payload, a provider error, or output that fails validation all give `status: "needs-review"`, zero points and `detail: { ai: "needs-review", reason }`, and none of the model's text is kept. A validated score gives `detail: { ai: "scored", criterionId, score, feedbackCode, feedback? }`, stored in `answers.detail_json` and shown to the student only after results release.

### 11. API for Phase 2

Teacher endpoints (JWT required, scoped to the caller's own events):

| Endpoint | Returns |
|---|---|
| `GET /api/catalog` | `framework`, `levels`, `audiences`, `questionTypes` (`type`, `label`, `status` active/reserved), `legacySelectionModes`, `ai` |
| `GET /api/ontology` | `framework`, `nodes` (`id`, `kind`, `label`, `description`, `parent`, `prerequisites`, `sources`, `questionCount`), `edges` (`from`, `to`, `kind`) |
| `GET /api/outcomes?level=S1&audience=rgsynapse` | `outcomes` (`id`, `statement`, `nodes`, `levels`, `audiences`, `questionCount`). Both parameters are optional; an unknown value returns 400 |
| `POST /api/question-bank/preview` | Body `{ filter }` or `{ selectionMode }`. Returns `count`, `totalPoints`, `byLevel`, `byType`, `byAudience`, `questions` (summaries: `id`, `title`, `type`, `audience`, `level`, `difficulty`, `points`, `ontology`, `outcomes`; no prompts or keys) and the canonical `filter` |
| `POST /api/events` | As before, plus `filter`. Returns the event with `selection_mode`, `filter`, `filter_summary`, `results_released_at`, `breakdown_released` and `question_count` |
| `GET /api/events` | The caller's events with `filter`, `filter_summary`, `results_released_at`, `question_count` and `attempt_count` |
| `GET /api/events/:id/results` | The event, plus every attempt (including reset ones) with `late`, `reset_at` and per-answer `response`, `scoreStatus` and `detail` |
| `POST /api/events/:id/release` | Releases the per-question breakdown to students |
| `POST /api/events/:id/attempts/:attemptId/reset` | Resets one attempt so the student can start again |

Student endpoints:

| Endpoint | Notes |
|---|---|
| `GET /api/web-types` | Renderer files the student page loads |
| `POST /api/events/join` | Event summary and question count |
| `POST /api/attempts` | 201 with `attempt` (`id`, `token`, `deadlineAt`), `serverNow`, `event`, `questions`; 409 with `code` for a second start |
| `GET /api/attempts/:id` | Needs `X-Attempt-Token`. `attempt` (`status`: started/submitted/reset, `deadlineAt`, `late`), `serverNow`, `event`, `questions`, and `result` (`score`, `max`, `breakdownReleased`, and `perQuestion` once released) |
| `POST /api/attempts/:id/submit` | Needs `X-Attempt-Token`. Returns `attempt` and `result` with `score`, `max` and `breakdownReleased` only |

## Decided after review (2026-09-27)

1. **AI provider: OpenRouter.** The Phase 2 adapter calls OpenRouter's chat completions API with a JSON-schema response format built by `buildScoreSchema`. The key is read from the environment (`AI_API_KEY`); in local development it lives at `~/.config/openrouter/key` and is never committed. Any model reached through OpenRouter must support structured output, and the validator still checks every reply.
2. **Consent is out of scope for the app.** Akmal holds consent for the cohorts using it, and AI scores are formative only: they carry no consequence for the student. The app still enforces decision B (no personal data in payloads, structured output only).
3. **Students see the validated AI feedback text** (at most 200 characters, single line) alongside the feedback code, once results are released. Only text that passed `validateModelScore` is ever shown; anything else stays `needs-review` for the teacher.
4. **"Capabilities" means ontology nodes plus question types**, as sections 2, 5 and 7 describe.
5. **Answer-key protection:** one attempt per student per event, with teacher reset. The per-question breakdown is withheld until `end_at` or a teacher release (§8).

## Still open

1. **MOE syllabus crosswalk:** add one if schools want LOs reported in syllabus terms.
2. **Admin role:** today every account is scoped to its own events. A head of department who sees all of them needs a role check.

## Consequences

- The DEMO123 flow and the teacher portal work as before for teachers. Students now get one attempt per event, and on new events they see their breakdown only after release.
- Old events keep their meaning: pinned legacy modes, the audience defaulting to core, and pre-migration events marked released.
- Content authors edit JSON and restart. `npm test` then checks the tags, the bands, the legacy modes and every answer key.
- Four defective questions are fixed in new events and in existing events without submissions. Events with submissions keep what their students saw.
- In-progress attempts at deploy time have no token; the student starts again.
- Production needs `JWT_SECRET` and `SEED_TEACHER_PASSWORD`, and no account may still use the demo password.
- The Docker image copies `backend/content` and `backend/scripts`; forgetting `content` would stop the server at boot.
- New tables and columns come in through timestamped migrations recorded in `schema_migrations`.
