# ADR 0001: CT platform model

- **Status:** Accepted, 2026-09-26. Framework (decision A) and AI data policy (decision B) decided by Akmal on 2026-09-26. The items under "Still open" are not decided.
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

`src/content.js` loads and validates all of it as one unit at boot. Any error (an unknown tag, a key pointing outside the options, a cycle in the ontology, an LO that does not cover a tagged question's level) stops the server with a list of every problem. `db.js` then replaces the content tables with the file contents inside one transaction, so filters run as indexed SQL. Content files are the source of truth; the tables are a read model rebuilt on every boot.

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

`level` stays a first-class field (P5, P6, S1, S2; more can be added in `audiences.json`). `audience` is a second field. RGSynapse Sec 1 questions are `audience: "rgsynapse", level: "S1"`. A plain S1 filter therefore returns both core and RGSynapse S1 questions, and the audience filter tells them apart. This keeps level one filter among several without hiding the new content behind a pseudo-level.

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
| `topic`, `qType`, `details` | no | Display labels kept from v1. `qType` is a puzzle-style label, not the scoring type |
| type-specific | per type | For `mcq`: `options` (at least 2, distinct) and `answer: { index }` |

Reserved types, named so that teachers and content can refer to them. The loader rejects questions of these types until a scorer ships:

- `multi-select`
- `code-trace`: the student types the output
- `parsons`: the student orders code lines
- `short-answer`: matched against accepted answers
- `open-response-ai`: scored by the AI provider against `rubric: [{ id, description, points }]`

### 6. Scorer registry

`src/scoring/index.js` maps each type to an implementation with these methods:

- `validate(question)`: returns a list of errors.
- `toPublic(question)`: an allowlist projection of the fields a student may see.
- `normalizeResponse(raw, question)`: returns the stored response, or `null`.
- `score(question, response)`: returns `{ status, earned, max, correct }`.
- `legacyColumns(question, response)`: optional. Fills the v1 `chosen_index` and `correct_index` columns.

Students only ever receive `toPublic()` output, so a new type's secret fields (`answer`, `rubric`, `solution`) never leave the server unless the type lists them. `status` is `scored` for synchronous types. AI-scored types will store `pending` at submit time and be finalised by a background job to `scored`, or to `needs-review` (see §10), so a submission never waits on a model. The status lives in `answers.score_status`.

To add a type: write `src/scoring/<type>.js`, call `registerType` in `src/scoring/index.js`, add a solver or matcher to the answer-key test, and build its student UI.

### 7. Event selection

`POST /api/events` accepts either the legacy `selectionMode` or a v2 `filter`:

```json
{
  "audiences": ["rgsynapse"],
  "levels": ["S1", "S2"],
  "outcomes": ["LO-AI-REVIEW-1"],
  "nodes": ["practice.testing-debugging"],
  "types": ["mcq"],
  "difficulty": { "min": 2, "max": 4 }
}
```

Every key is optional. Keys combine with AND; values within a key combine with OR. `nodes` includes descendants. Unknown keys, ids, levels or audiences, reserved types, and inverted difficulty bands return 400 with every reason. A filter that matches nothing returns 400.

Backward compatibility: `selectionMode` `ALL` maps to `{ audiences: ["core"] }`, and `P5` to `S2` map to `{ audiences: ["core"], levels: [mode] }`, so old requests and old events mean exactly what they did. New content never leaks into `ALL`. An event stores `selection_mode` (the legacy value, or `FILTER`) and `filter_json` (the canonical filter it was built from). Events still snapshot their questions into `event_questions` at creation, so later content edits never change a running event.

"Capabilities" in goal 5 is read as the ontology nodes a teacher picks (mostly practices) plus the question types, which together decide what an event tests. The picker can present them however works best; the API takes `nodes` and `types`.

`POST /api/question-bank/preview` runs the same selection function as event creation, so its `count` always equals the created event's question count.

### 8. Answer keys, attempts and teachers

- Only `index.html`, `admin.html`, `app.js`, `admin.js` and `style.css` are served from `web/`. Any other path with a dot in its last segment returns 404. Unknown `/api/*` routes return a JSON 404.
- Student responses (join, start, submit) never contain answer fields. The submit response no longer includes `correctIndex`.
- Starting an attempt returns a 32-byte random `token`. Only its SHA-256 hash is stored. Submit requires it in the `X-Attempt-Token` header: 401 if missing, 403 if wrong. Attempts started before the upgrade have no token and cannot be submitted; the student starts again.
- `attempts.deadline_at` is fixed at start. A submission up to `SUBMIT_GRACE_SECONDS` (default 60) after it is accepted and flagged `late`; later than that returns 410. The student page shows a countdown and auto-submits at zero.
- Teachers see and read only events whose `created_by` is their user id. Another teacher's event returns 404, the same as a missing one.
- Passwords are stored as `scrypt$<salt>$<hash>` with a random 16-byte salt per user and compared with `crypto.timingSafeEqual`. Legacy fixed-salt hashes still verify and are rewritten on the next successful login.
- With `NODE_ENV=production`, the server refuses to start without `JWT_SECRET`.

### 9. Storage and migrations

SQLite stays (better-sqlite3 12). Postgres is out of scope; the README documents that path.

Migrations live in `src/migrations/NNN-name.js`, keyed on `PRAGMA user_version`:

1. `baseline`: the v1 schema, `IF NOT EXISTS`. Pre-migration databases report version 0 and already have these tables.
2. `platform-core`: adds `events.filter_json`, `attempts.token_hash` and `attempts.deadline_at` (backfilled). Rebuilds `answers` with a nullable `correct_index` plus `question_type`, `response_json` and `score_status`. Adds the content tables and indexes. Rewrites v1 snapshots (`answerIndex`) to the v2 shape.
3. `fix-answer-keys`: patches P5-01, P6-01, S1-01 and S2-02 inside existing snapshots, only where they still match the v1 content. Past scores are not recomputed.

Each migration runs in a transaction together with its `user_version` bump. Foreign keys are switched off around the run (SQLite ignores that pragma inside a transaction) and `foreign_key_check` must pass before each commit. A database that already holds data is copied with `VACUUM INTO` next to itself (`app.pre-v3-from-v0-<time>.db`) before upgrading. A database newer than the code is refused. Never edit a shipped migration. **Parallel Phase 2 branches that each add migration 4 must renumber one of them at merge.**

Indexes cover every per-request query: events by `created_by`, snapshots by event, attempts by event, answers by attempt, and the content lookups (`bank_questions (audience, level, type, difficulty)`, `question_nodes (node_id)`, `question_outcomes (outcome_id)`, `outcome_levels (level)`, `ontology_edges (to_id, kind)`).

### 10. AI inference extension point (decision B, decided)

Phase 1 ships the interface and guardrails only. No provider is implemented and no request leaves the server. The app is complete without AI.

- **Configuration:** `AI_PROVIDER` (default `none`), `AI_API_KEY` and `AI_MODEL`, from the environment only. An unknown provider, or a provider without a key, fails at startup. `GET /api/catalog` reports `ai.enabled`.
- **Provider interface** (`src/ai/index.js`): `{ name, enabled, complete({ purpose, system, payload, schema, maxTokens }) → { output } }`. Adapters register in `providers`.
- **No student personal data goes to a provider, enforced by structure** (`src/ai/payload.js`). `buildScoringPayload({ question, responseText, redact, outcomes })` is the only way to build a payload. It refuses any other argument, and its output has a fixed shape: `task`, the question's prompt, code, level, audience, max points, LO statements and rubric, plus the response text. There is no field for a name, class group, attempt id, token or email. A test seeds a student name and group and asserts that neither appears anywhere in the serialized payload.
- **Known risk: PII inside the response text.** A student can type their own name, phone number or class into an answer. `scrubResponseText` is the hook for this. It currently redacts email addresses, Singapore phone numbers, NRIC/FIN-shaped ids, and any strings the caller passes in `redact` (the student's own name and group, used locally and never sent). It is a placeholder, not a guarantee: it will miss other people's names, nicknames and indirect identifiers. Phase 2 should decide whether that is acceptable or whether responses need a stronger filter or teacher release first.
- **Structured output only** (`src/ai/schema.js`). The provider must return `{ criterionId, score, feedbackCode, feedback? }`, and no other keys are allowed:
  - `criterionId` is one of the question's rubric ids.
  - `score` is an integer equal to that criterion's points, within 0 to max.
  - `feedbackCode` is one of `correct`, `partially-correct`, `misconception`, `incomplete`, `off-topic` or `needs-teacher-review`.
  - `feedback` is at most 200 characters of single-line plain text.

  `buildScoreSchema(question)` produces the matching JSON Schema for the provider's structured-output mode, and `validateModelScore` checks every reply on receipt.
- **Fallback:** `scoreWithAi` never throws. AI disabled, a rejected payload, a provider error or output that fails validation all give `status: "needs-review"` with zero points and a reason code, and none of the model's text is kept. Unvalidated model output is never stored or shown to a student.
- Tests use a fake provider with good and malformed replies, including an injected extra instruction.

### 11. API for Phase 2 (teacher auth required)

| Endpoint | Returns |
|---|---|
| `GET /api/catalog` | `framework`, `levels`, `audiences`, `questionTypes` (`type`, `label`, `status` active/reserved), `legacySelectionModes`, `ai` |
| `GET /api/ontology` | `framework`, `nodes` (`id`, `kind`, `label`, `description`, `parent`, `prerequisites`, `sources`, `questionCount`), `edges` (`from`, `to`, `kind`) |
| `GET /api/outcomes?level=S1&audience=rgsynapse` | `outcomes` (`id`, `statement`, `nodes`, `levels`, `audiences`, `questionCount`). Both parameters are optional; an unknown value returns 400 |
| `POST /api/question-bank/preview` | Body `{ filter }` or `{ selectionMode }`. Returns `count`, `totalPoints`, `byLevel`, `byType`, `byAudience`, `questions` (summaries: `id`, `title`, `type`, `audience`, `level`, `difficulty`, `points`, `ontology`, `outcomes`, with no prompts or keys), plus the canonical `filter` |
| `POST /api/events` | As before, plus `filter`. Returns the event with `selection_mode`, `filter`, `filter_summary` and `question_count` |
| `GET /api/events` | The caller's events with `filter`, `filter_summary`, `question_count` and `attempt_count` |

Student endpoints are unchanged in shape, except that `POST /api/attempts` adds `attempt.token`, `attempt.deadlineAt` and `serverNow`, and submit requires `X-Attempt-Token` and returns `attempt.late`.

## Still open (for Akmal)

1. **Which AI provider**, and under what data processing terms: where data is processed, retention, and whether it is used for training. The interface is provider-neutral.
2. **Consent for AI scoring of minors:** whether schools or parents opt in per event, per school or per student, and whether AI scoring is on by default for RGSynapse. The ADR fixes *what* may be sent, not *whether* it is sent.
3. **Whether AI feedback text is ever shown to students**, even after validation, or only the feedback code plus teacher-written text. The schema allows up to 200 characters; showing it is a Phase 2 UI decision.
4. **MOE syllabus crosswalk:** add one if schools want LOs reported in syllabus terms.
5. **Admin role:** today every account is scoped to its own events. A head of department who sees all of them needs a role check.

## Consequences

- The DEMO123 flow and the teacher portal work as before. Old events and old API calls keep their meaning.
- Content authors edit JSON and restart. `npm test` then checks the tags, the bands and every answer key.
- Four defective questions are fixed in new events and in existing snapshots. Scores already submitted keep what was recorded.
- In-progress attempts at deploy time (no token) must be restarted.
- The Docker image copies `backend/content`; forgetting it would stop the server at boot.
- New tables and columns come in through migrations. Phase 2 branches must coordinate migration numbers.
