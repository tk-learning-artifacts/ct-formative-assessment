# CT Quest

A web-based Computational Thinking (CT) formative-assessment platform. Teachers create join-code events and track student results. Students join via a code, complete a timed quiz, and see their score.

Two audiences are supported: the original **core** P5 to S2 Bebras-style puzzles (the default), and **RGSynapse** (Raffles Girls' School Sec 1 and Sec 2, students who already write some Swift and Python and build with AI assistants). Questions are tagged against a CT ontology based on Brennan & Resnick (2012) and against learning outcomes, so events can be built from any mix of level, outcome, CT concept or practice, and question type.

The design decisions are recorded in [docs/adr/0001-ct-platform-model.md](docs/adr/0001-ct-platform-model.md), and the look of the pages in [docs/adr/0002-adopt-slate-visual-conventions.md](docs/adr/0002-adopt-slate-visual-conventions.md). Explainers for the concepts it uses are in [docs/learn/](docs/learn/).

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
│   │   └── questions/            Question banks (core.json, rgsynapse.json, type-samples.json, ai-samples.json)
│   ├── src/
│   │   ├── server.js         Entry point: loads config, starts the app
│   │   ├── app.js            Express app: routes, JWT auth, static allowlist
│   │   ├── config.js         All environment settings, validated at startup
│   │   ├── db.js             Opens SQLite, runs migrations, syncs content, all queries
│   │   ├── content.js        Loads and validates backend/content/
│   │   ├── selection.js      Event filters -> question lists
│   │   ├── policy.js         One attempt per student; when students see their breakdown
│   │   ├── outcomes-summary.js  Per-outcome and per-CT-node results for one event
│   │   ├── security.js       Password hashing, attempt tokens
│   │   ├── scoring/          Scorer registry; one module per question type in scoring/types/
│   │   ├── migrations/       Timestamped migrations, recorded in schema_migrations
│   │   └── ai/               AI scoring (off by default): guarded provider, typed payload, output validation, OpenRouter adapter, background job
│   ├── scripts/
│   │   ├── set-password.js   Set or create a teacher's password
│   │   └── ai-smoke.js       One live AI scoring request, run by hand
│   ├── test/                 node:test + supertest suite, answer-key solvers, v1 fixture
│   └── data/
│       └── app.db            SQLite database (auto-created, gitignored)
├── web/                      Frontend: plain HTML/CSS/JS, no framework
│   ├── index.html / app.js   Student quiz UI (countdown, auto-submit, resume after refresh)
│   ├── type-registry.js      Loads the question-type renderers
│   ├── types/                One renderer per question type (mcq, code-trace, parsons, open-response-ai)
│   ├── admin.html / admin.js Teacher portal: event picker with live preview, results, per-outcome summary, AI marking
│   ├── style.css             Shared styles on Slate's theme contract (light only)
│   └── vite.config.js        Dev server config (proxy + multi-page build)
├── docs/adr/                 Architecture decision records
├── docs/learn/               Explainers
├── Dockerfile                Multi-stage production image
├── docker-compose.yml        Single-command deployment
└── nginx.conf                Reference config for future nginx + api split
```

### How it fits together

**Production:** Express serves the `.html`, `.css` and `.js` files in `web/` (except build config such as `vite.config.js`) plus the renderers in `web/types/`, and handles all `/api/*` routes in a single process on port 3000. The list is derived from the folder at startup. Nothing else in `web/` or `backend/` is reachable over HTTP. Unknown `/api/*` routes return a JSON 404.

**Development:** Vite runs a dev server on port 5173 with hot reload and proxies all `/api/*` requests to the Express backend on port 3000. The two processes run concurrently via `npm run dev`.

**Content:** On boot the backend validates everything in `backend/content/` (a bad tag or answer key stops the server with a list of problems) and copies it into indexed SQLite tables, so event filters run as SQL. When an event is created its questions are snapshotted into `event_questions`, so editing content never changes a running event.

**Look.** The pages follow Slate's visual conventions: every colour and font in `web/style.css` is a named token in one `:root` block, so a retint is one edit there. There is no dark mode. Status colours (correct, late, needs marking, released) use four fixed tones, and each is paired with a word.

**Answer keys** stay on the server. Students receive each question through its type's public projection, which leaves out `answer`, the teacher-only `details` note and any other marking fields.

**Results.** Each student gets one attempt per event (a teacher can reset it). On submit the student sees their total. The per-question breakdown appears once the event's deadline (`end_at`) passes or the teacher presses "Release results".

**AI-scored answers.** `open-response-ai` questions take a short written answer, scored against a server-only rubric by a model through OpenRouter. Submitting never waits for the model: the answer is stored as pending, a background job in the same process scores it, and the student's total rises when it finishes. The student's name, class and any identifiers they typed are removed before anything is sent. Replies that fail validation, and every answer when AI is off, become "needs review" for the teacher, who can set the score and feedback for any AI-scored answer. See "AI scoring" below and the ADR, section 10.

### Database schema

| Table | Purpose |
|---|---|
| `users` | Teacher accounts (email + per-user salted scrypt hash) |
| `events` | Join-code sessions: time window, duration, `selection_mode` (legacy mode or `FILTER`), `filter_json`, `results_released_at` |
| `event_questions` | Snapshot of each event's questions (v2 shape, answer keys included, server-only) |
| `attempts` | A student's attempt: start/submit times, score, `token_hash`, `deadline_at`, `late`, `student_key` (normalised name + group), `reset_at`/`reset_by` |
| `answers` | Per-question record: `question_type`, `response_json` (what the student chose, with its text), `earned_points`, `score_status`, `detail_json` (structured scoring detail such as AI feedback), plus the v1 `chosen_index`/`correct_index` |
| `ontology_nodes`, `ontology_edges` | CT ontology nodes; `parent_of` and `requires` edges |
| `learning_outcomes`, `outcome_nodes`, `outcome_levels`, `outcome_audiences` | LOs and their mappings |
| `bank_questions`, `question_nodes`, `question_outcomes` | The question bank and its tags, for filtering |
| `schema_migrations` | Which migrations have been applied |

The content tables are rebuilt from `backend/content/` on every boot; the other tables hold data.

**Migrations.** Files in `backend/src/migrations/` are named `YYYYMMDDHHMM-<slug>.js`, and the name is the migration's id. On start the runner applies, in sorted order, every file not yet recorded in `schema_migrations`, each in its own transaction. Before upgrading a database that already has data, it saves a copy next to it (`app.pre-<id>-from-<id>-<time>.db`). A database created by the original code (no `schema_migrations`, `user_version` 0) upgrades in place without losing data. So does one made by the first review round of this work (`user_version` 3), through a one-off bridge in `src/migrations/legacy/`.

To change the schema, add a new file with the current date and time in its name. Never edit a migration that has shipped. Because ids are timestamps, two branches can each add one; when merging, check only that their order makes sense.

### Authentication

- **Teachers:** JWT. The backend issues a 7-day token on login; protected routes need `Authorization: Bearer <token>`. The secret comes from `JWT_SECRET`, which is required when `NODE_ENV=production`. Teachers only see events they created. Passwords created by the original code (one fixed salt) still work and are rehashed with a random salt on the next login.
- **First account:** `SEED_TEACHER_EMAIL` / `SEED_TEACHER_PASSWORD` create the first teacher in an empty database. In production the server refuses to start with the demo password `changeme123`, without `SEED_TEACHER_PASSWORD` when the database has no teacher yet, or while any stored account still accepts the demo password. Fix an account with `npm run set-password -- <email>`, described below.
- **Students:** no account. Starting an attempt returns a one-off attempt token. The page keeps it in `sessionStorage` and sends it as `X-Attempt-Token` to resume (`GET /api/attempts/:id`) and to submit. Only a hash is stored.
- **Deadlines:** an attempt's deadline is the earlier of start + duration and the event's `end_at`. A submission up to `SUBMIT_GRACE_SECONDS` after it counts as on time; a later one is stored and marked late. The page counts down, auto-submits at zero and retries if the network fails.

---

## Local development (no Docker)

**Requirements:** Node.js 20.14+

```bash
npm install       # installs all workspace deps (backend + web)
npm run dev       # starts both servers concurrently
npm test          # runs the backend test suite
```

| Service | URL |
|---|---|
| Student app | http://localhost:5173/ |
| Teacher portal | http://localhost:5173/admin.html |
| API | http://localhost:3000/api/ |

The backend auto-restarts on file changes (nodemon). The frontend has hot reload (Vite). Set `HOST=127.0.0.1` to keep the backend off the local network.

### Default credentials (development only)

| | |
|---|---|
| Teacher email | `teacher@ctquest.local` |
| Teacher password | `changeme123` |
| Demo join code | `DEMO123` |

These are seeded into a fresh database when `SEED_TEACHER_*` are not set. The login form is not prefilled. Production refuses to run while any account still has this password.

### Setting a teacher's password

```bash
npm run set-password -- teacher@school.edu.sg          # prompts twice, input hidden
NEW_PASSWORD='…' npm run set-password -- teacher@school.edu.sg
echo '…' | npm run set-password -- teacher@school.edu.sg
```

The account is created if it does not exist. The password is never accepted as a command-line argument. It must be at least 10 characters and not the demo password.

---

## Tests

```bash
npm test                          # from the repo root
npm test --workspace backend      # same thing
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
| `auth.test.js` | `JWT_SECRET` and `SEED_TEACHER_PASSWORD` rules, refusal of the demo password in production, `set-password`, salted hashes and rehash |
| `migration.test.js` | Upgrading `fixtures/v1-app.sql` (made by the original code), chosen-option text kept, events with submissions left as their students saw them, backup, idempotence, rollback |
| `filters.test.js` | Pinned legacy modes, the core-audience default, AI-scored questions opt-in and last, v2 filters, preview = event count, ontology/outcomes/catalog endpoints |
| `events.test.js` | Absolute times only, 24-hour duration cap |
| `scoring.test.js` | Types loaded from files, public projection checked for every type, plugging in a new type |
| `question-types.test.js` | Code-trace normalisation and partial credit; Parsons scoring, opaque ids and a shuffle that never shows a correct order, both keyed with the server secret (the attacks that recovered the answer unkeyed are replayed); an HTTP attempt from start to released breakdown |
| `outcomes-summary.test.js` | Per-outcome and per-node results: rollups, reset, late and unsubmitted attempts, unmarked AI answers left out of the averages, owner scoping |
| `content.test.js` | Content validation catches bad tags, bands, keys, cycles and legacy modes |
| `ai.test.js` | AI off by default; the guarded provider builds every request; adversarial tests for each way student data could leak; model output validation |
| `ai-openrouter.test.js` | The OpenRouter wire format and data-policy options; good, malformed and schema-breaking replies; timeout; 429 then success; bounded retries (fake `fetch`, no network) |
| `ai-scoring.test.js` | Pending at submit, background scoring, concurrency cap, restart pickup, AI off, teacher override (owner only), release gating of feedback, and a spy proving a student's name and class never leave the server |

**Computed answer keys.** `test/solvers/` has one solver per question. A solver reads the question's own text (the grid in `art`, the edge list in the prompt, the code) and computes the answer. The test requires exactly one option to match, and that option must be the key. Run against the original bank, the solvers flag four defects: P6-01, S2-02 and S1-01, plus P5-01 (two options always worked). A test keeps that true. An AI-scored question has no single key, so its solver re-runs the question's code and returns the facts the full-credit rubric criterion relies on; the test checks each fact holds and that the criterion names it.

---

## AI scoring (optional)

AI is off unless you set `AI_PROVIDER`. With it off, everything else works as before; `open-response-ai` answers are labelled "needs review" and the teacher marks them on the results page. AI questions are opt-in: an event filter includes them only when the teacher ticks "Open response (AI scored)" under question types (`types` in the API) or picks the questions by id, and they then come after every other question. Previewing or creating an event that contains AI questions while AI is off returns a warning, which the teacher page shows.

**To enable it:** set `AI_PROVIDER=openrouter` and `AI_API_KEY` to an OpenRouter key (in `.env` for Docker, or the environment). Optionally set `AI_MODEL`; the default is `anthropic/claude-sonnet-5`. Any model you choose must list `structured_outputs` in OpenRouter's model list. Keep prompt logging off in your OpenRouter privacy settings; the app already asks OpenRouter to route only to endpoints that neither collect nor retain data.

**Check it works** with one live request (a made-up answer, no personal data):

```bash
AI_API_KEY=… node backend/scripts/ai-smoke.js            # or pass AIS-S2-01 / AIS-S2-02
```

It prints the model and whether the reply passed validation. `npm test` never calls the network.

**Cost.** Each answer is one request of roughly 1,000 input tokens and under 300 output tokens: about $0.003 with the default model at $2 / $10 per million input / output tokens (September 2026). A class of 40 answering three AI questions costs about 40 cents. Failed requests are retried at most twice. `anthropic/claude-haiku-4.5` costs half as much if its marking is good enough for you.

---

## Authoring content

All content is JSON under `backend/content/`. Restart the server (nodemon does this in dev) and run `npm test` after any edit.

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

- `id` is unique across all banks. `art` (monospaced figure) and `code` are optional.
- `level` must be one of the audience's levels in `audiences.json`.
- Every question needs at least one `ontology` node and one `outcomes` LO, and each LO must cover the question's level and audience.
- `details` is for teachers only and never reaches students.
- `difficulty` is 1 to 5.
- Spread correct answers across positions; the 44 shipped multiple-choice questions have eleven keys at each of positions 0 to 3.
- Adding a core question does not change the legacy `ALL` or single-level modes. They are pinned in `legacy-modes.json`, and only an edit there changes them.

Then **add a solver** in `backend/test/solvers/<bank>.js` keyed by the question id. It gets the question and returns either the answer value (matched against option text or its leading number) or `{ pick: optionText => boolean }`. Parse the numbers from the question's text where you can. For code, either parse what you need or pin the exact source and translate it to JavaScript. Code-trace solvers return the program's output; Parsons solvers get the program built from each accepted order and return what it prints, which must equal `expectedOutput`. When `python3` or `swift` is installed, the answer-key test also runs these programs for real. A question that genuinely cannot be computed goes in `NOT_COMPUTABLE` in `test/solvers/index.js` with a reason. `npm test` fails if a question has neither.

**Add an ontology node** to `ontology.json` under an existing parent of the same kind. The top two levels are reserved for Brennan & Resnick; CT Quest nodes go below them and cite `{ "framework": "ctquest" }`.

**Add a learning outcome** to `learning-outcomes.json` with `id`, `statement`, `nodes`, `levels` and optional `audiences` (empty means all).

**Add a question type:** add `backend/src/scoring/types/<type>.js` (see `mcq.js` for the exports: `publicFields`, `sample`, `validate`, `normalizeResponse`, `recordResponse`, `score`), and `web/types/<type>.js` registering `renderInput`, `readResponse` and `describeResponse`. Then add a matcher to the answer-key test. No shared file needs editing. See the ADR, section 6.

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
| `SEED_TEACHER_PASSWORD` | On first production boot | `changeme123` in development | Password for that account. Production refuses the demo password, and refuses to seed an empty database without it. |
| `PORT` | No | `3000` | Port the server listens on. |
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
npm install
npm run set-password -- teacher@school.edu.sg      # if the database already has the demo account
NODE_ENV=production JWT_SECRET=your-secret SEED_TEACHER_PASSWORD='…' npm start
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
