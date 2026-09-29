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

Credentials come from `.env.development`, the file `pnpm run dev` loads: the
plugin reads `SEED_TEACHER_EMAIL` and `SEED_TEACHER_PASSWORD` from it (blank
means `teacher@ctquest.local` / `changeme123`). It reads only that file, never
the repo-root `.env`, which is the production file. A variable exported in the
shell wins over the file, as it does for the backend. Optional overrides, set the
same way: `DEV_JOIN_CODE` (default `DEMO123`), `DEV_STUDENT_NAME` (`Dev
Student`), `DEV_STUDENT_GROUP` (`Dev Class`). `DEV_API_TARGET` (the backend the
dev server proxies to, default `http://localhost:3000`) is read from the
environment only.

The script contains the dev password, so the dev server hands it out only to a
loopback connection with a `localhost` or `*.localhost` Host header. Vite's own
host check runs after plugin middleware, so the plugin does this check itself.

Things that go wrong quietly:

- The seed only applies to an empty database. If your dev database was created
  with another password, the teacher tab shows the normal login form and the
  console says `[dev-login] teacher login failed (401)`. Sign in once by hand, or
  set `SEED_TEACHER_*` to that account.
- Vite reads `.env.development` once, at start, and does not watch it (nodemon
  restarts the backend on a change, so the two can disagree until you restart
  Vite). A variable exported in the shell overrides the file for both sides, and
  the same stray variables break the backend tests (`SEED_TEACHER_*` breaks the
  seeded logins, `AI_*` switches the AI on), so run `pnpm test` with them unset.
- The demo event `DEMO123` is created only when the database has no events.
- The student name is fixed, and a student can only start an event once. A
  second browser profile, a private window or cleared storage gets "You already
  started this test". Set `DEV_STUDENT_NAME` to something else, or reset the
  attempt from the teacher page. Clearing the name field and pressing Start
  refills it from the script.
- A teacher token from a hand sign-in is kept as it is (the check is only that
  the token works), so the tab is the admin only if the token belonged to one.

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
