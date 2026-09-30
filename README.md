# CT Quest

A web-based Computational Thinking (CT) formative-assessment platform. Teachers create join-code events and track student results. Students join via a code, complete a timed quiz, and see their score.

Two audiences are supported: the original **core** P5 to S2 Bebras-style puzzles (the default), and **RGSynapse** (Raffles Girls' School Sec 1 and Sec 2, students who already write some Swift and Python and build with AI assistants). Questions are tagged against a CT ontology based on Brennan & Resnick (2012) and against learning outcomes, so events can be built from any mix of level, outcome, CT concept or practice, and question type.

The design decisions are recorded in [docs/adr/0001-ct-platform-model.md](docs/adr/0001-ct-platform-model.md), the per-event feedback and navigation settings and the quick setup presets in [docs/adr/0003-assessment-settings.md](docs/adr/0003-assessment-settings.md), the admin (head of department) role in [docs/adr/0004-admin-role.md](docs/adr/0004-admin-role.md), code-reading questions in [docs/adr/0005-code-reading-questions.md](docs/adr/0005-code-reading-questions.md), the block programming (Scratch-like) question type in [docs/adr/0006-block-programming-questions.md](docs/adr/0006-block-programming-questions.md), visuals in questions (figures drawn from data, and a few generated illustrations) in [docs/adr/0007-question-visuals.md](docs/adr/0007-question-visuals.md), and the look of the pages in [docs/adr/0002-adopt-slate-visual-conventions.md](docs/adr/0002-adopt-slate-visual-conventions.md). Explainers for the concepts it uses are in [docs/learn/](docs/learn/).

---

## Architecture

```
ct-formative-assessment/
├── backend/
│   ├── content/              Server-only content (never served to browsers)
│   │   ├── audiences.json        Levels and audiences
│   │   ├── ontology.json         CT ontology (Brennan & Resnick + CT Quest sub-nodes)
│   │   ├── learning-outcomes.json  LOs mapped to ontology nodes
│   │   ├── legacy-modes.json     Question ids behind the old ALL/P5/P6/S1/S2 modes
│   │   ├── presets.json          Quick setup cards: named filters plus their knobs
│   │   └── questions/            Question banks (core.json, rgsynapse.json, type-samples.json, type-code-reading.json, ai-samples.json, blocks.json)
│   ├── src/
│   │   ├── server.js         Entry point: loads config, starts the app
│   │   ├── app.js            Express app: routes, JWT auth, static allowlist
│   │   ├── config.js         All environment settings, validated at startup
│   │   ├── db.js             Opens SQLite, runs migrations, syncs content, all queries
│   │   ├── content.js        Loads and validates backend/content/
│   │   ├── visuals.js        Loads the visual kinds from web/visuals/kinds/; checks illustration files at boot
│   │   ├── selection.js      Event filters -> question lists (including the balanced question cap)
│   │   ├── presets.js        Quick setup presets: knobs -> event filters
│   │   ├── policy.js         One attempt per student; feedback and navigation modes; what a student may see
│   │   ├── access.js         Who may read or change an event: owner, admin (read-only on others' events)
│   │   ├── outcomes-summary.js  Per-outcome, per-CT-node, per-question and per-attempt results for one event
│   │   ├── security.js       Password hashing, attempt tokens
│   │   ├── scoring/          Scorer registry; one module per question type in scoring/types/
│   │   ├── migrations/       Timestamped migrations, recorded in schema_migrations
│   │   └── ai/               AI scoring (off by default): guarded provider, typed payload, output validation, OpenRouter adapter, background job
│   ├── scripts/
│   │   ├── set-password.js   Set or create a teacher's password
│   │   ├── set-role.js       Make an account an admin or a teacher
│   │   ├── delete-event.js   Delete an event, its attempts and its answers
│   │   └── ai-smoke.js       One live AI scoring request, run by hand
│   ├── test/                 node:test + supertest suite, answer-key solvers, v1 fixture
│   └── data/
│       └── app.db            SQLite database (auto-created, gitignored)
├── web/                      Frontend: plain HTML/CSS/JS, no framework
│   ├── index.html / app.js   Student quiz UI (countdown, auto-submit, resume after refresh)
│   ├── type-registry.js      Loads the question-type renderers
│   ├── types/                One renderer per question type (mcq, code-trace, parsons, code-reading, open-response-ai, blocks)
│   ├── lib/                  Files shared with the server: blocks-engine.js (the block language, run by both sides) and blocks.css
│   ├── visuals/              Question visuals (ADR 0007): visuals.js (registry, projection, <figure> markup), visuals.css, kinds/ (one file per kind, shared with the server) and img/ (the reviewed illustrations, WebP)
│   ├── vendor/               Vendored libraries, never packaged: blockly-13.3.0/ (Apache-2.0, with its licence and provenance)
│   ├── admin.html / admin.js Teacher portal: an event list and a Question bank link in the sidebar; the main area shows the chosen event (summary tiles and collapsible chart sections, a per-student view with AI marking, questions, settings), the new-event form (quick setup, Customise picker, live and question previews), or the whole question bank with answer keys, filterable by audience, level, type, outcome and text
│   ├── charts.js             Inline SVG bar charts and histograms for the results view (no library; UMD so tests can run it)
│   ├── style.css             Shared styles on Slate's theme contract (light only)
│   └── vite.config.js        Dev server config (proxy + multi-page build)
├── docs/adr/                 Architecture decision records
├── docs/learn/               Explainers
├── Dockerfile                Multi-stage production image
├── docker-compose.yml        Single-command deployment
└── nginx.conf                Reference config for future nginx + api split
```

### How it fits together

**Production:** Express serves the `.html`, `.css` and `.js` files in `web/` (except build config such as `vite.config.js`), the renderers in `web/types/`, the `.js` and `.css` files in `web/lib/` and in each folder of `web/vendor/`, and the question visuals (`web/visuals/*.js` and `*.css`, `web/visuals/kinds/*.js`, `web/visuals/img/*.webp`), and handles all `/api/*` routes in a single process on port 3000. The list is derived from the folder at startup. Nothing else in `web/` or `backend/` is reachable over HTTP. Unknown `/api/*` routes return a JSON 404.

**Development:** Vite runs a dev server on port 5173 with hot reload and proxies all `/api/*` requests to the Express backend on port 3000. The two processes run concurrently via `pnpm run dev`.

**Content:** On boot the backend validates everything in `backend/content/` (a bad tag or answer key stops the server with a list of problems) and copies it into indexed SQLite tables, so event filters run as SQL. When an event is created its questions are snapshotted into `event_questions`, so editing content never changes a running event.

**Look.** The pages follow Slate's visual conventions: every colour and font in `web/style.css` is a named token in one `:root` block, so a retint is one edit there. There is no dark mode. Status colours (correct, late, needs marking, released) use four fixed tones, and each is paired with a word.

**Answer keys** stay off every student-facing surface. Students receive each question through its type's public projection, which leaves out `answer`, the teacher-only `details` note and any other marking fields. The teacher who owns an event (or an admin reading it) can see the full question, key included: the create-event preview and the results view both offer a compact question preview, each row expanding to the student view plus the teacher-only material below it.

**Results.** Each student gets one attempt per event (a teacher can reset it), whatever the settings. Each event chooses when students see which answers were right: after each question (the answer then locks), at the end of the test (straight after submit), or when the teacher releases them (the default: the breakdown appears once the deadline `end_at` passes or the teacher presses "Release results"). Each event also chooses free navigation (back, next, skip) or in order (forward only; each question is answered or skipped, and cannot be revisited). The server enforces both: answers are committed one at a time through a token-guarded endpoint when a setting needs it, and `policy.js` decides everything a student sees. Under in order the page holds only the questions up to the one the student is on: start sends the first, and each answer or skip brings the next. Under free navigation the progress dots are buttons that jump to their question.

**The results view.** An event's results open on five tiles (submitted, in progress, mean score, below 50%, needs marking), then collapsible sections: Overview (a histogram of scores, open by default), Questions (average score per question, hardest first, with the question preview inside), Learning outcomes and CT capabilities (a bar per outcome or capability, sub-capabilities indented, with the sortable table behind "Show table"), Students (the attempt list) and Settings history. Which sections are open is kept across re-renders and in the browser's `localStorage`; Expand all and Collapse all work on the top-level sections. Each attempt row has a View button that opens that student's results in a dialog: their score beside the class average, one cell per question (Correct, Part, Wrong, To mark, Skipped), their score per outcome and capability beside the class mean, and a row per question with their answer and the answer key. The AI-marking forms are on those rows, and the attempt row shows "1 needs marking" until they are marked. Every figure comes from `GET /api/events/:id/outcomes-summary` (its `overall`, `questions` and `perAttempt` fields), under one rule set: answers not marked yet are left out of every percentage, reset attempts are dropped and late ones count. A per-student view across events is not built yet.

**Changing settings mid-event.** "Edit settings" on the results view (`PATCH /api/events/:id`, owner only) changes the title, both settings, the time limit, the opening time and the deadline, even after students have started. The questions and the join code cannot change: students' answers refer to the question snapshot, and a changed join code would strand a student who already has the old one. `policy.js` always reads the event's current settings, so the new rule applies from each student's next request: loosening feedback shows results already earned, tightening hides them again until the new rule allows, and no committed answer is ever unlocked. The Edit settings form warns when the chosen feedback timing is stricter than the event's current one, because tightening cannot take back a key a student has already seen. Switching to in order moves a student to their first unanswered question and commits the answers before it; switching to free lets them move among the questions they have not committed. A new time limit or deadline recomputes each running attempt's deadline, and one that has already passed means the next submit is stored and marked late. The student page checks a small status view of the attempt (`?fields=status`: the settings, the deadline, commit and marking status, the total, no questions) after every move and every 30 seconds (fixed, not configurable), and fetches the full attempt only when that has changed, so a running timer updates. Every change is recorded in `event_setting_changes` and listed on the results view. See ADR 0003, section 10.

**Choosing questions.** The teacher's form opens on quick setup cards (presets from `backend/content/presets.json`), each with a short description and a live question count, and up to three coarse knobs: who it is for, which Brennan & Resnick dimension to emphasise, and short (about 10 questions, balanced across levels and outcomes) or full. Choosing a card fills the advanced picker ("Customise") so the teacher can fine-tune from there. Each event records the card and knob values it came from, and whether Customise then changed the questions, along with the card's label and knob wording as they read at the time; the event card says "From preset: …" or "Custom selection", and keeps saying it even if the preset is later renamed or removed from `presets.json`. Beside the live count, "Preview questions" opens a compact, collapsed-by-default list of what is selected so far, one row per question (title, type, level, points, the correct answer in short form); expanding a row shows the full question as a student sees it, with the teacher-only material (the `details` note, rubric, marking flags, a block question's hidden grids and reference solution in words and as Python) below, clearly marked. The same list, of the event's frozen snapshot, sits behind a "Questions" disclosure on the results view.

**Visuals.** 14 questions carry a `visual`: a grid, a row of cells, a network, a flowchart or a table, declared as data in the question and drawn as SVG (or an HTML table) on the page by a small file per kind in `web/visuals/kinds/`, or, for three P5 and S1 questions, a small generated illustration that only sets the scene. The same kind file validates the data at boot, generates the figure's text description (under "Describe the picture", and what screen readers hear), and draws it, so a figure cannot disagree with its description. Each question's answer-key solver checks the visual's data against the prompt. Students get the visual through the kind's allowlist, without its purpose or an illustration's provenance (the generator and prompt used), which the teacher's question preview shows. With the six block stages, 20 of the 69 questions have a visual. See ADR 0007, which also lists them.

**Code reading.** `code-reading` questions show a snippet with line numbers and ask what it does for any input: the student picks a plain-English description and, when there is one, answers a follow-up (another choice, such as which input changes the result, or which line they would change). Each part is marked on its own, so a right description with a missed follow-up earns part marks, and the released breakdown shows both parts beside the key. Words in the code can carry a glossary note, opened by tap, click, hover or Enter. A written "explain it in your own words" task is an `open-response-ai` question with a code block, so it goes through the AI pipeline unchanged. See ADR 0005.

**Block programming.** A `blocks` question gives the student a Blockly editor (vendored, Scratch-style blocks) holding a partly built program whose given blocks cannot be moved, and a stage: a sprite on a grid. Run animates the program on the example grid as often as they like. The server marks the submitted block tree by running it itself, on the example and on hidden grids, with the same engine file (`web/lib/blocks-engine.js`) the page animates with; nothing is ever evaluated, and a step limit stops endless loops. The hidden grids and the reference solution never reach students. See ADR 0006.

**AI-scored answers.** `open-response-ai` questions take a short written answer, scored against a server-only rubric by a model through OpenRouter. Submitting never waits for the model: the answer is stored as pending, a background job in the same process scores it, and the teacher's total rises when it finishes. Until results are released the student sees only the instantly marked part of their total, labelled "Marked so far", so the total cannot reveal whether a written answer earned credit; after release, or under the other feedback timings, it is the full total. The student's name, class and any identifiers they typed are removed before anything is sent. Replies that fail validation, and every answer when AI is off, become "needs review" for the teacher, who can set the score and feedback for any AI-scored answer, including a committed one before the student submits. See "AI scoring" below and the ADR, section 10.

### Database schema

| Table | Purpose |
|---|---|
| `users` | Accounts: email, per-user salted scrypt hash, `role` (`teacher` or `admin`, enforced by triggers) |
| `events` | Join-code sessions: time window, duration, `selection_mode` (legacy mode or `FILTER`), `filter_json`, `results_released_at`, `feedback_mode` (each/end/release), `navigation_mode` (free/linear), `preset_id`, `preset_options_json`, `preset_customised` and `preset_label` (which quick setup card it came from, and its wording as read at creation) |
| `event_setting_changes` | One row per setting changed after creation: event, teacher, field, old and new value, time |
| `event_questions` | Snapshot of each event's questions (v2 shape, answer keys included, server-only) |
| `attempts` | A student's attempt: start/submit times, score, `token_hash`, `deadline_at`, `late`, `student_key` (normalised name + group), `reset_at`/`reset_by` |
| `answers` | Per-question record: `question_type`, `response_json` (what the student chose, with its text), `earned_points`, `score_status`, `detail_json` (structured scoring detail such as AI feedback), `committed_at` (set when the answer was committed on its own before submit), plus the v1 `chosen_index`/`correct_index` |
| `ontology_nodes`, `ontology_edges` | CT ontology nodes; `parent_of` and `requires` edges |
| `learning_outcomes`, `outcome_nodes`, `outcome_levels`, `outcome_audiences` | LOs and their mappings |
| `bank_questions`, `question_nodes`, `question_outcomes` | The question bank and its tags, for filtering |
| `schema_migrations` | Which migrations have been applied |

The content tables are rebuilt from `backend/content/` on every boot; the other tables hold data.

**Migrations.** Files in `backend/src/migrations/` are named `YYYYMMDDHHMM-<slug>.js`, and the name is the migration's id. On start the runner applies, in sorted order, every file not yet recorded in `schema_migrations`, each in its own transaction. Before upgrading a database that already has data, it saves a copy next to it (`app.pre-<id>-from-<id>-<time>.db`). A database created by the original code (no `schema_migrations`, `user_version` 0) upgrades in place without losing data. So does one made by the first review round of this work (`user_version` 3), through a one-off bridge in `src/migrations/legacy/`.

To change the schema, add a new file with the current date and time in its name. Never edit a migration that has shipped. Because ids are timestamps, two branches can each add one; when merging, check only that their order makes sense.

### Authentication

- **Teachers:** JWT. The backend issues a 7-day token on login; protected routes need `Authorization: Bearer <token>`. The secret comes from `JWT_SECRET`, which is required when `NODE_ENV=production`. Teachers only see events they created; another teacher's event answers 404, like a missing one. Passwords created by the original code (one fixed salt) still work and are rehashed with a random salt on the next login.
- **Admins (heads of department):** an account with the `admin` role also sees every teacher's events, with each owner's email, and can open their results, outcomes summary, settings history, attempt details and questions. On events it did not create it is read-only: reset, release, Edit settings and marking answer 403 and are hidden on the page. Its own events work as a teacher's do. The role is read from the database on every request, so a change applies at once. See ADR 0004, which also describes the full-control alternative and how to switch to it.
- **First account:** `SEED_TEACHER_EMAIL` / `SEED_TEACHER_PASSWORD` create the first account in an empty database. That first account is an admin (ADR 0004); later accounts are teachers. In production the server refuses to start with the demo password `changeme123`, without `SEED_TEACHER_PASSWORD` when the database has no teacher yet, or while any stored account still accepts the demo password. Fix an account with `pnpm run set-password <email>`, described below.
- **Students:** no account. Starting an attempt returns a one-off attempt token. The page keeps it in `sessionStorage` and sends it as `X-Attempt-Token` to resume (`GET /api/attempts/:id`) and to submit. Only a hash is stored.
- **Deadlines:** an attempt's deadline is the earlier of start + duration and the event's `end_at`. A submission up to `SUBMIT_GRACE_SECONDS` after it counts as on time; a later one is stored and marked late. The page counts down, auto-submits at zero and retries if the network fails.

---

## Local development (no Docker)

**Requirements:** Node.js 20.14+ and pnpm 12 (`npm install -g pnpm@12.4.1`)

```bash
pnpm install      # installs all workspace deps (backend + web)
cp .env.development.example .env.development   # once; dev settings, gitignored
pnpm run dev      # starts both servers concurrently
pnpm test         # runs the backend test suite
```

The first install builds better-sqlite3's native binding; pnpm only runs dependency build scripts listed under `allowBuilds` in `pnpm-workspace.yaml`.

| Service | URL |
|---|---|
| Student app | http://localhost:5173/ |
| Teacher portal | http://localhost:5173/admin.html |
| Teacher, signed in (dev) | http://teacher.localhost:5173/ |
| Student, form filled in (dev) | http://student.localhost:5173/ |
| API | http://localhost:3000/api/ |

The two `*.localhost` rows sign a tab in for you, so both roles can be open together; see [docs/architecture/LOCAL-DEV.md](docs/architecture/LOCAL-DEV.md).

The backend auto-restarts on file changes (nodemon), including edits to `.env.development`, which `pnpm run dev` loads with Node's `--env-file` flag. The frontend has hot reload (Vite). AI scoring is off in `.env.development` so testing costs nothing; production settings stay in `.env`, which only `docker compose` reads.

### Default credentials (development only)

| | |
|---|---|
| Teacher email | `teacher@ctquest.local` (an admin, as the first account) |
| Teacher password | `changeme123` |
| Demo join code | `DEMO123` |

These are seeded into a fresh database when `SEED_TEACHER_*` are not set. The login form is not prefilled. Production refuses to run while any account still has this password.

### Setting a teacher's password

```bash
pnpm run set-password teacher@school.edu.sg          # prompts twice, input hidden
NEW_PASSWORD='…' pnpm run set-password teacher@school.edu.sg
echo '…' | pnpm run set-password teacher@school.edu.sg
```

Leave out the `--` npm needed: pnpm passes it to the script, which then rejects it.

The account is created if it does not exist. The password is never accepted as a command-line argument. It must be at least 10 characters and not the demo password.

### Starting in production on a database with a demo-password account

Production refuses to start while any stored account still accepts the demo password `changeme123`, which a database from an early deploy can hold (the log says "These accounts still use the demo password"). With a shell, run `set-password` for that account. With no shell, as on a hosted deploy: set `SEED_TEACHER_EMAIL` to that account's email and `SEED_TEACHER_PASSWORD` to a new password of at least 10 characters, and redeploy. The new password replaces the demo one, only on an account that still has the demo password, and the server then starts. Another demo-password account still blocks start-up and is named in the log. Once it is running you may remove `SEED_TEACHER_PASSWORD`.

### Seeded events and removing an event

`backend/content/seeded-events.json` lists events every server has: today the **RGSynapse challenge**, join code `RGSYN2`, 20 questions in a fixed order (10 multiple choice; 10 code tracing, ordering lines, code reading and one block program; difficulty 3 and 4; nothing AI scored). On every start the server creates any listed event whose join code does not exist yet, owned by the first admin, so deploying a build that adds an event to the file adds it to the running server on its next start. An event that exists is never touched again, so teachers' edits to it are kept. `SEED_EVENTS=false` turns this off. Its questions come from the bank by id, so they can be swapped by editing the file before the event is first created, or by "Change questions" on the teacher page afterwards, while no attempt is live.

There is no button to delete an event, because its results go with it. To remove one, copy the database file, then:

```bash
pnpm run delete-event RGSYN2          # shows what would be deleted
pnpm run delete-event RGSYN2 --yes    # deletes it, its attempts and its answers
```

In Docker: `docker compose run --rm app node backend/scripts/delete-event.js RGSYN2 --yes`. A seeded event comes back on the next start if its join code is free, so also remove it from `seeded-events.json` if it should stay gone.

### Making an account an admin

```bash
pnpm run set-role head@school.edu.sg admin      # can read every teacher's events
pnpm run set-role head@school.edu.sg teacher    # back to their own events only
```

The account must already exist (create it with `set-password` first). The change applies on the account's next request, without signing in again. The first account seeded into an empty database is already an admin. In Docker: `docker compose run --rm app node backend/scripts/set-role.js head@school.edu.sg admin`.

---

## Tests

```bash
pnpm test                          # from the repo root
pnpm --filter ct-ability-backend test   # same thing
```

The suite uses Node's built-in test runner (`node:test`) with `supertest` for HTTP requests. Every test builds its app on a fresh database in a temporary directory, passed through `DB_PATH`, and serves it on `127.0.0.1` on a random port (see the comment in `test/helpers.js` for why supertest is not handed the bare Express app). With `NODE_ENV=test`, opening `backend/data/app.db` throws, so tests can never touch real data.

| File | Covers |
|---|---|
| `demo-flow.test.js` | DEMO123 end to end: join, start, submit (total only), the teacher's results, release, breakdown |
| `attempt-policy.test.js` | One attempt per student (name variants), teacher reset, breakdown withheld until release or `end_at`, a four-attempt oracle replay |
| `attempt-token.test.js` | Token required; the same 404 for a wrong token and a missing attempt; resume via GET; deadline capped by `end_at`; late submissions stored |
| `answer-keys.test.js` | Every question's key against a computed answer (see below) |
| `no-answer-leak.test.js` | No answer fields or `details` in any public file or student response; the public file list comes from `web/`; JSON 404 for unknown API routes |
| `teacher-scoping.test.js` | Teachers only see their own events and results |
| `admin-role.test.js` | Every event route under a teacher on their own event, another teacher, an admin on their own event, an admin on a teacher's event (200 on reads, 403 on writes, nothing changed) and a teacher on an admin's event; the admin's event list with owners; the role read per request; the role triggers; the seeded first account is an admin; `set-role` |
| `compose-env.test.js` | `docker-compose.yml` passes every setting `config.js` reads (except `HOST` and `DB_PATH`), so a new setting cannot be dropped silently in Docker |
| `auth.test.js` | `JWT_SECRET` and `SEED_TEACHER_PASSWORD` rules, refusal of the demo password in production, `set-password`, salted hashes and rehash |
| `migration.test.js` | Upgrading `fixtures/v1-app.sql` (made by the original code), chosen-option text kept, events with submissions left as their students saw them, backup, idempotence, rollback |
| `assessment-settings.test.js` | Every feedback and navigation mode: settings stored and validated, no key before the mode allows it, committed answers locked against commit and submit, in-order enforcement and skips, commit guards (token, deadline, submitted, reset), one attempt in every mode, AI answers "being marked" under after-each, pre-existing events unchanged |
| `event-settings-edit.test.js` | `PATCH /api/events/:id`: owner only, validated, question set and join code refused; every mid-event change of feedback and navigation (no unlocking, no key after tightening); deadline recompute and late submits after a shortened deadline; the audit rows; the key after a wrong answer under after-each; marking a committed answer before submit; no AI calls for a reset attempt; preset provenance on create, and its label frozen against a later rename |
| `presets.test.js` | `GET /api/presets`, knobs compiling to filters, card = preview = event count, AI-scored questions only from `aiScored` presets, the balanced `limit`, boot-time validation of `presets.json` |
| `filters.test.js` | Pinned legacy modes, the core-audience default, AI-scored questions opt-in and last, v2 filters, preview = event count, ontology/outcomes/catalog endpoints |
| `question-preview.test.js` | The teacher-only full question views: `POST /api/question-bank/preview` with `include: "questions"` (filter and preset) and `GET /api/events/:id/questions`, both auth-guarded, an unsupported `include` value, the answer key per type, count and order parity with the plain preview and the created event, an attempt token refused as a teacher credential, the student start/resume routes left at exactly `toPublicQuestion`, and the code-reading and blocks teacher views (follow-up keys and glossary; hidden grids, the reference solution and its words and Python) with none of it on the student routes |
| `events.test.js` | Absolute times only, 24-hour duration cap |
| `scoring.test.js` | Types loaded from files, public projection checked for every type, plugging in a new type |
| `visuals.test.js` | Question visuals: boot validation of every kind (unknown kind, missing alt text, missing, oversized or metadata-carrying image, unknown keys, broken grids, graphs, flowcharts and tables), the server refusing bad content, the student projection (no purpose or provenance), no key text or computed numeric answer in a visual, token-only colours, a label and description on every figure, the files served, and an event from start to released breakdown plus the teacher's view |
| `blocks.test.js` | Block programs: shape checks and size limits, the interpreter and its step limit, the given blocks kept in place (and re-checked on the server), offered blocks only, partial credit by grids passed, the block limit, validation of broken questions, no hidden grid or solution in what students get, the served engine being the scorer's own file, the vendored Blockly served with its header, and an HTTP attempt to the released breakdown |
| `question-types.test.js` | Code-trace normalisation and partial credit (blank lines at either end ignored for per-line credit); Parsons scoring, opaque ids and a shuffle that never shows a correct order, both keyed with the server secret (the attacks that recovered the answer unkeyed are replayed); an HTTP attempt from start to released breakdown |
| `code-reading.test.js` | Code-reading validation, the public projection (the follow-up rebuilt from its public fields), per-part marks and the recorded shape; every wrong description fails on some input; the real Python and Swift against the solvers' translations, including the fixed line for a line follow-up; an HTTP attempt to the released breakdown; the preset's card, preview and event counts |
| `new-types-leak.test.js` | Code-reading and blocks under every feedback timing and navigation mode: start, status poll, each commit, resume, submit and the breakdown never carry a hidden grid, the reference solution (as data, words or Python) or a teacher-only field, and the keys (code-reading's follow-up key included) appear only when the timing allows |
| `outcomes-summary.test.js` | Per-outcome and per-node results: rollups, reset, late and unsubmitted attempts, unmarked AI answers left out of the averages, owner scoping; the per-question, overall and per-attempt figures under the same rules (unmarked, reset, late, no submissions, all unmarked, zero-point questions, skipped answers) |
| `charts.test.js` | `web/charts.js`: a text equivalent and value labels on every chart, "below 50%" in words, no inline colour, empty and all-null input, clamping and escaping, histogram bins; loaded by the teacher page only |
| `content.test.js` | Content validation catches bad tags, bands, keys, cycles and legacy modes |
| `ai.test.js` | AI off by default; the guarded provider builds every request; adversarial tests for each way student data could leak; model output validation |
| `ai-openrouter.test.js` | The OpenRouter wire format and data-policy options; good, malformed and schema-breaking replies; timeout; 429 then success; bounded retries (fake `fetch`, no network) |
| `status-and-delivery.test.js` | The status poll (token, fields, no question content or key in any mode, the total after submit); in-order delivery (first question at start, the next on each commit or skip, those reached on resume and after submit, none later in any response), free navigation unchanged, and switches between free and in order mid-attempt |
| `student-total.test.js` | The pre-release total: fixed while AI and teacher marks arrive (AI on and off), blank written answers, in-order commits marked before submit, the full total after release and under `end` and `each` |
| `ai-scoring.test.js` | Pending at submit, background scoring, concurrency cap, restart pickup, AI off, teacher override (owner only), release gating of feedback, and a spy proving a student's name and class never leave the server |

**Computed answer keys.** `test/solvers/` has one solver per question. A solver reads the question's own text (the grid in a visual, the edge list in the prompt, the code) and computes the answer. A question with a structured visual has a solver that checks the visual's data against the prompt, and the test hands it the visual stripped of its data to prove it reads it. The test requires exactly one option to match, and that option must be the key. Run against the original bank, the solvers flag four defects: P6-01, S2-02 and S1-01, plus P5-01 (two options always worked). A test keeps that true. An AI-scored question has no single key, so its solver re-runs the question's code and returns the facts the full-credit rubric criterion relies on; the test checks each fact holds and that the criterion names it.

---

## AI scoring (optional)

AI is off unless you set `AI_PROVIDER`. With it off, everything else works as before; `open-response-ai` answers are labelled "needs review" and the teacher marks them on the results page. AI questions are opt-in: an event filter includes them only when the teacher ticks "Open response (AI scored)" under question types (`types` in the API) or picks the questions by id, and they then come after every other question. Previewing or creating an event that contains AI questions while AI is off returns a warning, which the teacher page shows.

**To enable it:** set `AI_PROVIDER=openrouter` and `AI_API_KEY` to an OpenRouter key (in `.env` for Docker, or the environment). Optionally set `AI_MODEL`; the default is `anthropic/claude-sonnet-5`. Any model you choose must list `structured_outputs` in OpenRouter's model list. Keep prompt logging off in your OpenRouter privacy settings; the app already asks OpenRouter to route only to endpoints that neither collect nor retain data.

**Check it works** with one live request (a made-up answer, no personal data):

```bash
AI_API_KEY=… node backend/scripts/ai-smoke.js            # or pass AIS-S2-01 / AIS-S2-02
```

It prints the model and whether the reply passed validation. `pnpm test` never calls the network.

**Cost.** Each answer is one request of roughly 1,000 input tokens and under 300 output tokens: about $0.003 with the default model at $2 / $10 per million input / output tokens (September 2026). A class of 40 answering three AI questions costs about 40 cents. Failed requests are retried at most twice. `anthropic/claude-haiku-4.5` costs half as much if its marking is good enough for you.

---

## Authoring content

All content is JSON under `backend/content/`. Restart the server (nodemon does this in dev) and run `pnpm test` after any edit.

**Add a question** to a bank in `questions/` (or add a new `questions/<bank>.json` with `{ "bank": "...", "questions": [...] }`):

```json
{
  "id": "RGS-S2-03",
  "type": "mcq",
  "audience": "rgsynapse",
  "level": "S2",
  "title": "Short title",
  "prompt": "Question text. Line breaks are kept.",
  "code": { "language": "python", "source": "print(1 + 1)" },
  "options": ["1", "2", "3", "11"],
  "answer": { "index": 1 },
  "points": 5,
  "difficulty": 3,
  "ontology": ["practice.testing-debugging.tracing"],
  "outcomes": ["LO-CODE-TRACE-1"],
  "crosswalk": { "bebrasCategory": "algorithms-programming" },
  "topic": "Code tracing",
  "qType": "Predict the output",
  "details": "Teacher-facing note on what this checks."
}
```

- `id` is unique across all banks. `code`, `visual` and `art` (a monospaced figure, kept for old events; use a visual instead) are optional.
- `level` must be one of the audience's levels in `audiences.json`.
- Every question needs at least one `ontology` node and one `outcomes` LO, and each LO must cover the question's level and audience.
- `details` is for teachers only and never reaches students.
- `difficulty` is 1 to 5.
- Spread correct answers across positions; the 44 shipped multiple-choice questions have eleven keys at each of positions 0 to 3.
- Adding a core question does not change the legacy `ALL` or single-level modes. They are pinned in `legacy-modes.json`, and only an edit there changes them.

Then **add a solver** in `backend/test/solvers/<bank>.js` keyed by the question id. It gets the question and returns either the answer value (matched against option text or its leading number) or `{ pick: optionText => boolean }`. Parse the numbers from the question's text where you can. For code, either parse what you need or pin the exact source and translate it to JavaScript. Code-reading solvers are specs in `solvers/type-code-reading.js`: the pinned source, a JavaScript translation, inputs, and one claim per option saying what output that description promises; exactly one description's claim must hold on every input. A `line` follow-up gives the replacement line and the behaviour it should produce, and the original code must fail it. Code-trace solvers return the program's output; Parsons solvers get the program built from each accepted order and return what it prints, which must equal `expectedOutput`. Block solvers work out each grid's expectation from the grid alone (the flag and stars reachable, the number of stars to say); the test also runs the question's reference solution through the scorer on every grid, and, when `python3` is installed, runs its Python view on every grid. When `python3` or `swift` is installed, the answer-key test also runs these programs for real. A question that genuinely cannot be computed goes in `NOT_COMPUTABLE` in `test/solvers/index.js` with a reason. `pnpm test` fails if a question has neither.

**Add a visual** (ADR 0007 §7): pick a `purpose` (`information`, `reading-load`, or `context` for an illustration only), then a kind: `grid`, `cells`, `graph`, `flowchart`, `table` or `illustration`. Each kind's fields are listed at the top of its file in `web/visuals/kinds/`. A visual must never show the answer or a step towards it, and must agree with the prompt: update the question's solver to read the visual's data (`visualOf` and `agree` in `solvers/lib.js`). An illustration is a WebP of at most 100 KB and 640 pixels, named after the question (`p5-01.webp`), with no metadata (`cwebp -q 70 -resize 640 0 -metadata none`), an `alt`, and `source: { generator, prompt, date, reviewed: true }`. The server will not start on an unknown kind, a missing alt text or a missing file. A new kind is a new file in `web/visuals/kinds/`; no shared file changes.

**A code-reading question** has `code`, `options` (descriptions of what the code does), `answer: { index, followUp? }`, and optionally `followUp: { kind: "choice", prompt, options, points }` or `{ kind: "line", prompt, points }` (the student picks one of the code's lines; `answer.followUp` is a line number, or a list of them) and `glossary: [{ term, note }]` (each term must appear in the code; one line of at most 200 characters, and it must not give the answer away). The follow-up's points come out of the question's points. Write descriptions that differ in behaviour a test input can show, since the solver has to tell them apart by running the code.

**Add a block programming question** (`"type": "blocks"`, see ADR 0006): give `world: "maze"`, an `example` stage (`grid` rows of `#` wall, `.` floor, `G` flag, `*` star; `start: { x, y, facing }`; `expect` with any of `reachGoal`, `collectAll`, `say`), secret `cases` in the same shape, a `startProgram` with the given blocks marked `"locked": true` (and `"editable": true` where a field may change), the `toolbox` block types, optional `variables`, `stepLimit`, `maxBlocks`, `showPython` and `marking: { "partial": "cases" }`, and a secret `solution`. The block names are in `BLOCKS` in `web/lib/blocks-engine.js`. The server will not start unless the solution passes every stage and the starting program alone fails one. Writing the tree by hand is fiddly; building it in a script and checking it with the scorer's `validate` is quicker.

**Add a quick setup preset** to `presets.json` with `id`, `label`, a one-line `description`, a `filter` (the event filter shape, without `questionIds`) and `knobs` (any of `who`, `emphasis`, `length`). A preset spanning several audiences must offer `who`; one that fixes `nodes` cannot offer `emphasis`; one that names an AI-scored type must say `"aiScored": true`. Every preset must match at least one question with its default settings, or the server will not start. See ADR 0003, section 5.

**Add an ontology node** to `ontology.json` under an existing parent of the same kind. The top two levels are reserved for Brennan & Resnick; CT Quest nodes go below them and cite `{ "framework": "ctquest" }`.

**Add a learning outcome** to `learning-outcomes.json` with `id`, `statement`, `nodes`, `levels` and optional `audiences` (empty means all).

**Vendor a frontend library** under `web/vendor/<name>-<version>/`: its licence beside it, and a header comment in each served file giving the version, source URL, checksum and licence (see the Blockly files). Never load one from a CDN.

**Add a question type:** add `backend/src/scoring/types/<type>.js` (see `mcq.js` for the exports: `publicFields`, `sample`, `validate`, `normalizeResponse`, `recordResponse`, `score`), and `web/types/<type>.js` registering `renderInput`, `readResponse` and `describeResponse` (and a `ready` promise if it loads files of its own, as the block renderer does). Then add a matcher to the answer-key test. No shared file needs editing. See the ADR, section 6.

---

## Deployment with Docker

**Requirements:** Docker with the Compose plugin.

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set a strong `JWT_SECRET` and a `SEED_TEACHER_EMAIL` / `SEED_TEACHER_PASSWORD` for the first teacher. `docker compose` refuses to start without `JWT_SECRET`. The server refuses to start on an empty database without `SEED_TEACHER_PASSWORD`; once the first teacher exists, you can remove it from `.env`.

### 2. Build and start

```bash
docker compose up --build -d
```

- Student app: http://localhost:3000/
- Teacher portal: http://localhost:3000/admin.html

If the volume holds a database from before this version, the teacher account there may still have the demo password. The server then refuses to start and names the account. Fix it and start again:

```bash
docker compose run --rm app node backend/scripts/set-password.js teacher@ctquest.local
docker compose up -d
```

### 3. View logs

```bash
docker compose logs -f
```

### 4. Stop

```bash
docker compose down          # stops containers, preserves data volume
docker compose down -v       # stops containers AND deletes the database
```

### Data persistence

SQLite is stored in a named Docker volume (`db_data`) mounted at `/app/backend/data`. The database survives container restarts and image rebuilds. Only `docker compose down -v` removes it.

Upgrading the image migrates the database in the volume on first start and leaves an `app.pre-…db` backup beside it. To roll back, stop the container and put the backup back as `app.db`. Attempts that were in progress during the upgrade cannot be submitted; those students start again. Events that existed before the upgrade keep showing students their breakdown immediately.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | Yes | — | Secret used to sign JWTs. Use a long random string. The server refuses to start without it when `NODE_ENV=production`. |
| `SEED_TEACHER_EMAIL` | No | `teacher@ctquest.local` | First teacher account, created only in an empty database. |
| `SEED_TEACHER_PASSWORD` | On first production boot | `changeme123` in development | Password for that account. Production refuses the demo password, and refuses to seed an empty database without it. If that account already exists and still accepts the demo password, this password replaces it on start (at least 10 characters). It never changes an account with any other password. |
| `SEED_EVENTS` | No | `true` | Create the events in `backend/content/seeded-events.json` on start (see below). `false` leaves them out. |
| `PORT` | No | `3000` | Port the server listens on. On a host that sets `PORT` for you (Coolify may), set its "Ports Exposes" to the same number, or remove the variable. The container healthcheck follows `PORT`. |
| `HOST` | No | all interfaces | Address to bind, e.g. `127.0.0.1` for a local-only run. |
| `DB_PATH` | No | `backend/data/app.db` | SQLite file location. |
| `SUBMIT_GRACE_SECONDS` | No | `60` | How long after an attempt's deadline a submission still counts as on time. Later ones are stored and marked late. |
| `AI_PROVIDER` | No | `none` | `none` keeps every AI feature off; `openrouter` scores `open-response-ai` answers through OpenRouter. |
| `AI_API_KEY` | With a provider | — | OpenRouter key. Never commit it. |
| `AI_MODEL` | No | `anthropic/claude-sonnet-5` | OpenRouter model id. Must support structured outputs. |
| `AI_CONCURRENCY` | No | `2` | How many answers the background job scores at once (1 to 10). |
| `AI_TIMEOUT_SECONDS` | No | `20` | Timeout for one AI request. |
| `AI_APP_URL` | No | `http://localhost` | Sent to OpenRouter as `HTTP-Referer`, which it uses to name the app. |
| `TZ` | No | `Asia/Singapore` (compose) | Only affects log timestamps. Stored and exchanged times are UTC. |

---

## Production without Docker

```bash
pnpm install
pnpm run set-password teacher@school.edu.sg      # if the database already has the demo account
NODE_ENV=production JWT_SECRET=your-secret SEED_TEACHER_PASSWORD='…' pnpm start
```

The backend serves `web/` as static files on port 3000.

---

## Future: migrating to PostgreSQL

The entire database layer is isolated in `backend/src/db.js`. When ready to migrate:

1. Replace `better-sqlite3` with a Postgres driver (`pg` or `postgres`)
2. Rewrite `db.js` queries using parameterised Postgres syntax (`$1, $2` instead of `?`)
3. Set `DATABASE_URL=postgres://user:password@host/dbname` in the environment
4. Add a `db` service to `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ctquest
      POSTGRES_USER: ctquest
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data

  api:
    build: .
    environment:
      DATABASE_URL: postgres://ctquest:${DB_PASSWORD}@db/ctquest
      JWT_SECRET: ${JWT_SECRET}
    depends_on:
      db:
        condition: service_healthy

volumes:
  pg_data:
```

5. Add an nginx service in front to serve `web/` static files and proxy `/api/*` to the api container — the `nginx.conf` in this repo is a starting point.

Once the API container is stateless (no SQLite file), it can be scaled horizontally with `replicas`.
