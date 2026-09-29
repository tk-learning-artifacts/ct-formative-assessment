# Local development: a teacher and a student at the same time

This follows Slate ADR 0020 (one dev hostname per role) and the same setup in
my-digital-bootcamp. Slate lives at `/Users/akmal/Projects/slate`.

## The links

Start the app with `pnpm run dev`, then open:

| Tab | Open | Lands as |
|-----|------|----------|
| Teacher | `http://teacher.localhost:5173/` | signed in as the seeded admin, on the teacher page |
| Student | `http://student.localhost:5173/` | the join form with the demo event's code, a name and a class filled in, and "Start test" focused |

`teacher.localhost:5173/admin` works too. Plain `http://localhost:5173/` is
unchanged: nothing is filled in and nobody is signed in.

Students have no accounts in this app. They join an event with a code, a name
and a class, so "login" for a student is a filled-in form and one click, not a
session. Starting the test on every page load would create an attempt each time
and hit the one-attempt-per-student rule, so it is left to the click.

## Why hostnames

`*.localhost` resolves to loopback on macOS and in every current browser, with
no `/etc/hosts` edit, and Vite allows any name under `.localhost` without
touching `server.allowedHosts`. Each hostname is its own origin, so the teacher
token (`ct-quest-token` in localStorage) and the student's saved attempt
(`ct-quest-attempt`) never share a store. The two tabs can be open together and
each keeps its own state through restarts.

Unlike mdb this app has no session cookie, so the split does not fix a
logged-out-on-swap problem. The hostnames are what tell the dev script which
role a tab is for.

## How the sign-in works

`web/vite.config.js` has a plugin, `dev-role-login`, with `apply: 'serve'`. It:

- serves a small script from memory at `/__dev-login.js` and injects it into the
  head of `index.html` and `admin.html`;
- on `teacher.*`, makes sure `localStorage` holds a token that `GET
  /api/auth/me` accepts, and otherwise logs in with the ordinary
  `POST /api/auth/login` and stores the result. It does this with a synchronous
  request, so the token is there before `admin.js` runs and the login form never
  flashes. A stale token is replaced;
- on `student.*`, fills `#joinCode`, `#name` and `#group` when the join form
  appears, only where a field is empty, and focuses the start button.

There is no server-side bypass and no `?role=` parameter. Slate ADR 0020 rules
those out because they put an authentication hole beside the real one. The
teacher path is the same request the login form sends.

Credentials come from the file `pnpm run dev` already loads: the plugin reads
`SEED_TEACHER_EMAIL` and `SEED_TEACHER_PASSWORD` from `.env.development` (blank
means `teacher@ctquest.local` / `changeme123`). Optional overrides, also read
from that file or the environment: `DEV_JOIN_CODE` (default `DEMO123`),
`DEV_STUDENT_NAME` (`Dev Student`), `DEV_STUDENT_GROUP` (`Dev Class`), and
`DEV_API_TARGET` (the backend the dev server proxies to, default
`http://localhost:3000`).

Three things that go wrong quietly:

- The seed only applies to an empty database. If your dev database was created
  with another password, the teacher tab shows the normal login form and the
  console says `[dev-login] teacher login failed (401)`. Sign in once by hand, or
  set `SEED_TEACHER_*` to that account.
- `loadEnv` also reads variables exported in your shell. A stray
  `SEED_TEACHER_*` in the shell overrides the file, exactly as it does for the
  backend, so both sides agree, but the values may not be what you expect. The
  same stray variables break the backend tests (`SEED_TEACHER_*` breaks the
  seeded logins, `AI_*` switches the AI on), so run `pnpm test` with them unset.
- The demo event `DEMO123` is created only when the database has no events.

## It cannot reach production

The plugin does not exist in a build, and the script is not a file under `web/`,
so it is not in the backend's public-file allowlist or the Docker image. Check
after changing the plugin: `cd web && node_modules/.bin/vite build`, then
`grep -rc 'dev-login\|changeme' dist` must find nothing. Do not add a
`dev-login.js` under `web/`: the backend serves what is there, and the script
carries credentials.

## When to stay on plain localhost

Service workers and anything else that needs a secure context are less
consistent under `*.localhost` outside Chromium, so test those on plain
`localhost`.
