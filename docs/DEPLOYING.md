# Deploying CT Quest to Coolify

CT Quest deploys like any Slate full-stack app: Coolify builds the repo's root
`Dockerfile`, runs one container on port 3000, and its reverse proxy handles
the domain and HTTPS. The general walkthrough is the `deploy` skill in the
Slate repo (`skills/deploy/references/coolify-first-deploy.md`); this page
holds the values specific to this repo.

## Before you start

- The repo is `tk-learning-artifacts/ct-formative-assessment`. Coolify needs a
  GitHub App source with access to the `tk-learning-artifacts` org. If the
  repo doesn't appear in the source's repo picker, grant that source access to
  it on GitHub first.
- Pick a subdomain under a wildcard that already points at the Coolify server,
  so no DNS change is needed.
- Build the image locally once: `docker build -t ctquest .` must exit 0.

## Application settings

| Field | Value |
|---|---|
| Build Pack | Dockerfile |
| Base Directory | blank (the `Dockerfile` is at the repo root) |
| Ports Exposes | `3000` |
| Health Check Path | `/api/health` |
| Domain | `https://<your-subdomain>` |
| Branch | `main` |

## Persistent storage

Add one volume mounted at `/app/backend/data`. The SQLite database
(`app.db`) and the automatic pre-migration backups live there, so it must
survive redeploys.

Use a Docker **volume**, not a bind mount to a host folder. The container runs
as the unprivileged `app` user; a new Docker volume copies the image's
ownership of `/app/backend/data`, while a host folder is usually owned by root
and the server then fails to open the database.

## Environment variables

Copy the values from your local `.env`. Mark the secrets as secret in Coolify.

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Turns on the production start-up checks |
| `JWT_SECRET` | from `.env` | Secret. Changing it later logs every teacher out and loses in-progress Parsons answers |
| `SEED_TEACHER_EMAIL` | from `.env` | Creates the first teacher in an empty database only |
| `SEED_TEACHER_PASSWORD` | from `.env` | Secret. Needed only for the first boot; remove it afterwards |
| `AI_PROVIDER` | `openrouter` | Use `none` to turn AI marking off |
| `AI_API_KEY` | from `.env` | Secret. The OpenRouter key |
| `AI_APP_URL` | `https://<your-subdomain>` | Sent to OpenRouter as the referring site |
| `TZ` | `Asia/Singapore` | Log timestamps only; stored times are UTC |

Leave `PORT` unset (the container listens on 3000) and leave `HOST` unset (the
server must listen on every interface inside the container). `AI_MODEL`,
`AI_CONCURRENCY`, `AI_TIMEOUT_SECONDS` and `SUBMIT_GRACE_SECONDS` have working
defaults.

## First deploy, then verify

1. Deploy and watch the build log. The start-up log should list the applied
   migrations, then `CT Quest server running on http://localhost:3000`.
2. `https://<your-subdomain>/api/health` returns `{"ok":true}`.
3. `https://<your-subdomain>/questions.js` returns 404 (no answer key is
   served).
4. Sign in at `https://<your-subdomain>/admin.html` with the seed teacher.
5. Remove `SEED_TEACHER_PASSWORD` from Coolify and redeploy. From now on,
   change passwords from the container's terminal in Coolify with
   `cd /app/backend && npm run set-password -- <email>`.
6. Create a real event for students rather than using DEMO123.

If the server refuses to start, the log says why: a missing `JWT_SECRET`, a
missing seed password on an empty database, or an account that still uses the
demo password.
