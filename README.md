# CT Quest

A web-based Computational Thinking (CT) formative-assessment platform. Teachers create join-code events and track student results. Students join via a code, complete a timed quiz, and see their score.

Two audiences are supported: the original **core** P5 to S2 Bebras-style puzzles (the default), and **RGSynapse** (Raffles Girls' School Sec 1 and Sec 2, students who already write some Swift and Python and build with AI assistants). Questions are tagged against a CT ontology based on Brennan & Resnick (2012) and against learning outcomes, so events can be built from any mix of level, outcome, CT concept or practice, and question type.

The design decisions are recorded in [docs/adr/0001-ct-platform-model.md](docs/adr/0001-ct-platform-model.md). Explainers for the concepts it uses are in [docs/learn/](docs/learn/).

---

## Architecture

```
ct-formative-assessment/
├── backend/
│   ├── content/              Server-only content (never served to browsers)
│   │   ├── audiences.json        Levels and audiences
│   │   ├── ontology.json         CT ontology (Brennan & Resnick + CT Quest sub-nodes)
│   │   ├── learning-outcomes.json  LOs mapped to ontology nodes
│   │   └── questions/            Question banks (core.json, rgsynapse.json)
│   ├── src/
│   │   ├── server.js         Entry point: loads config, starts the app
│   │   ├── app.js            Express app: routes, JWT auth, static allowlist
│   │   ├── config.js         All environment settings, validated at startup
│   │   ├── db.js             Opens SQLite, runs migrations, syncs content, all queries
│   │   ├── content.js        Loads and validates backend/content/
│   │   ├── selection.js      Event filters -> question lists
│   │   ├── security.js       Password hashing, attempt tokens
│   │   ├── scoring/          Scorer registry (mcq active, other types reserved)
│   │   ├── migrations/       Versioned schema migrations (PRAGMA user_version)
│   │   └── ai/               AI extension point: provider interface, typed payload, output validation (off by default)
│   ├── test/                 node:test + supertest suite, answer-key solvers, v1 fixture
│   └── data/
│       └── app.db            SQLite database (auto-created, gitignored)
├── web/                      Frontend: plain HTML/CSS/JS, no framework
│   ├── index.html / app.js   Student quiz UI (countdown, auto-submit)
│   ├── admin.html / admin.js Teacher portal
│   ├── style.css             Shared styles (dark/light mode)
│   └── vite.config.js        Dev server config (proxy + multi-page build)
├── docs/adr/                 Architecture decision records
├── docs/learn/               Explainers
├── Dockerfile                Multi-stage production image
├── docker-compose.yml        Single-command deployment
└── nginx.conf                Reference config for future nginx + api split
```

### How it fits together

**Production:** Express serves an allowlist of five files from `web/` (`index.html`, `admin.html`, `app.js`, `admin.js`, `style.css`) and handles all `/api/*` routes in a single process on port 3000. Nothing else in `web/` or `backend/` is reachable over HTTP. Unknown `/api/*` routes return a JSON 404.

**Development:** Vite runs a dev server on port 5173 with hot reload and proxies all `/api/*` requests to the Express backend on port 3000. The two processes run concurrently via `npm run dev`.

**Content:** On boot the backend validates everything in `backend/content/` (a bad tag or answer key stops the server with a list of problems) and copies it into indexed SQLite tables, so event filters run as SQL. When an event is created its questions are snapshotted into `event_questions`, so editing content never changes a running event.

**Answer keys** stay on the server. Students receive each question through its type's public projection, which leaves out `answer` and any other marking fields. The submit response reports points per question, not the correct option.

### Database schema

| Table | Purpose |
|---|---|
| `users` | Teacher accounts (email + per-user salted scrypt hash) |
| `events` | Join-code sessions: time window, duration, `selection_mode` (legacy mode or `FILTER`) and `filter_json` |
| `event_questions` | Snapshot of each event's questions (v2 shape, answer keys included, server-only) |
| `attempts` | A student's attempt: start/submit times, score, `token_hash`, `deadline_at` |
| `answers` | Per-question record: `question_type`, `response_json`, `earned_points`, `score_status` (plus the v1 `chosen_index`/`correct_index`) |
| `ontology_nodes`, `ontology_edges` | CT ontology nodes; `parent_of` and `requires` edges |
| `learning_outcomes`, `outcome_nodes`, `outcome_levels`, `outcome_audiences` | LOs and their mappings |
| `bank_questions`, `question_nodes`, `question_outcomes` | The question bank and its tags, for filtering |

The content tables are rebuilt from `backend/content/` on every boot; the other tables hold data.

**Migrations.** The schema version is SQLite's `PRAGMA user_version`. On start, `src/migrations` applies every migration newer than the database, each in its own transaction. Before upgrading a database that already has data, it saves a copy next to it (`app.pre-v3-from-v0-<time>.db`). A database created by the original code (version 0) upgrades in place without losing data. To change the schema, add `src/migrations/00N-name.js` and append it to the list. Never edit a migration that has shipped. Branches that each add the same number must renumber one at merge.

### Authentication

- **Teachers:** JWT. The backend issues a 7-day token on login; protected routes need `Authorization: Bearer <token>`. The secret comes from `JWT_SECRET`, which is required when `NODE_ENV=production`. Teachers only see events they created. Passwords created by the original code (one fixed salt) still work and are rehashed with a random salt on the next login.
- **Students:** no account. Starting an attempt returns a one-off attempt token, which the page sends as `X-Attempt-Token` on submit. Only a hash is stored. A submission is accepted up to `SUBMIT_GRACE_SECONDS` after the deadline; the page counts down and auto-submits at zero.

---

## Local development (no Docker)

**Requirements:** Node.js 20+

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

The backend auto-restarts on file changes (nodemon). The frontend has hot reload (Vite).

### Default credentials

| | |
|---|---|
| Teacher email | `teacher@ctquest.local` |
| Teacher password | `changeme123` |
| Demo join code | `DEMO123` |

These are seeded into a fresh database. The login form is not prefilled; type them in. Change them before deploying.

---

## Tests

```bash
npm test                          # from the repo root
npm test --workspace backend      # same thing
```

The suite uses Node's built-in test runner (`node:test`) with `supertest`, which calls the Express app in-process without opening a port. Every test builds its app on a fresh database in a temporary directory, passed through `DB_PATH`. With `NODE_ENV=test`, opening `backend/data/app.db` throws, so tests can never touch real data.

| File | Covers |
|---|---|
| `demo-flow.test.js` | DEMO123 end to end: join, start, submit, score, the teacher's results |
| `answer-keys.test.js` | Every question's key against a computed answer (see below) |
| `no-answer-leak.test.js` | No answer fields in any public file or student response; old `/questions.js` is 404; JSON 404 for unknown API routes |
| `attempt-token.test.js` | Token required and checked, hash-only storage, grace window, 410 after it |
| `teacher-scoping.test.js` | Teachers only see their own events and results |
| `auth.test.js` | `JWT_SECRET` fail-fast, salted hashes, legacy hash rehash on login |
| `migration.test.js` | Upgrading `fixtures/v1-app.sql` (a dump made by the original code), backup, idempotence, rollback on failure |
| `filters.test.js` | Legacy modes, v2 filters, preview = event count, ontology/outcomes/catalog endpoints |
| `scoring.test.js` | Scorer registry, reserved types, plugging in a new type |
| `content.test.js` | Content validation catches bad tags, bands, keys and cycles |
| `ai.test.js` | AI off by default; payload has no student identifiers; model output validation with a fake provider |

**Computed answer keys.** `test/solvers/` has one solver per question. A solver reads the question's own text (the grid in `art`, the edge list in the prompt, the code) and computes the answer. The test requires exactly one option to match, and that option must be the key. Run against the original bank, the solvers flag four defects: P6-01, S2-02 and S1-01, plus P5-01 (two options always worked). A test keeps that true.

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
- `details` is shown to students as "Focus:", so do not give the answer away in it.
- `difficulty` is 1 to 5.

Then **add a solver** in `backend/test/solvers/<bank>.js` keyed by the question id. It gets the question and returns either the answer value (matched against option text or its leading number) or `{ pick: optionText => boolean }`. Parse the numbers from the question's text where you can. For code, either parse what you need or pin the exact source and translate it to JavaScript. A question that genuinely cannot be computed goes in `NOT_COMPUTABLE` in `test/solvers/index.js` with a reason. `npm test` fails if a question has neither.

**Add an ontology node** to `ontology.json` under an existing parent of the same kind. The top two levels are reserved for Brennan & Resnick; CT Quest nodes go below them and cite `{ "framework": "ctquest" }`.

**Add a learning outcome** to `learning-outcomes.json` with `id`, `statement`, `nodes`, `levels` and optional `audiences` (empty means all).

**Add a question type:** implement `validate`, `toPublic`, `normalizeResponse` and `score` in `backend/src/scoring/<type>.js`, register it in `scoring/index.js`, add a matcher to the answer-key test, and build its student UI. See the ADR, section 6.

---

## Deployment with Docker

**Requirements:** Docker with the Compose plugin.

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set a strong `JWT_SECRET`. This is required — `docker compose` will refuse to start without it.

### 2. Build and start

```bash
docker compose up --build -d
```

- Student app: http://localhost:3000/
- Teacher portal: http://localhost:3000/admin.html

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

Upgrading the image migrates the database in the volume on first start and leaves an `app.pre-v<N>-from-v<M>-<time>.db` backup beside it. To roll back, stop the container and put the backup back as `app.db`. Attempts that were in progress during the upgrade cannot be submitted and must be restarted.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | Yes | — | Secret used to sign JWTs. Use a long random string. The server refuses to start without it when `NODE_ENV=production`. |
| `PORT` | No | `3000` | Port the server listens on inside the container. |
| `DB_PATH` | No | `backend/data/app.db` | SQLite file location. |
| `SUBMIT_GRACE_SECONDS` | No | `60` | How long after an attempt's deadline a submission is still accepted. |
| `AI_PROVIDER` | No | `none` | AI inference provider. `none` keeps every AI feature off; no provider is implemented yet. |
| `AI_API_KEY` | No | — | Key for `AI_PROVIDER`. Required if a provider is set. |
| `AI_MODEL` | No | — | Model name for the provider. |

---

## Production without Docker

```bash
npm install
NODE_ENV=production JWT_SECRET=your-secret npm start
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
